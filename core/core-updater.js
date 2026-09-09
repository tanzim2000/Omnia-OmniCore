// core/core-updater.js
// The two halves of OmniCore updating itself, deliberately kept separate:
//
//   checkForUpdate()  — a plain HTTPS call. Works even without the Docker
//                        socket mounted, because knowing an update exists
//                        shouldn't require the permission to apply one.
//   applyUpdate()     — needs the Docker socket. Does the actual swap.
//
// This split is what makes the socket genuinely optional the way
// docker-compose.yml promises: remove that one line and OmniCore still
// tells you an update exists — it just can't install it for you anymore.

const https = require("https");
const semver = require("semver");
const Docker = require("dockerode");

const omnicoreVersion = require("./version");

// Same repo the Dockerfile and publish workflow already point at. Not
// read from settings — unlike the module/theme registry, there's only
// ever one place OmniCore itself is published from.
const REPO_OWNER = "tanzim2000";
const REPO_NAME = "Omnia-OmniCore";

// How long a newly swapped-in version gets to report healthy before it's
// treated as broken and rolled back. Generous on purpose: a cold start
// brings up every configured face first, and a machine with a dozen
// faces is slower than a laptop with one. Short enough that a genuinely
// broken update doesn't sit there unreachable for long.
const ROLLBACK_WINDOW_SECONDS = 90;
const ROLLBACK_POLL_SECONDS = 5;

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		https.get(
			url,
			{ headers: { "User-Agent": "OmniCore", Accept: "application/vnd.github+json" } },
			(response) => {
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`${url} responded ${response.statusCode}`));
					return;
				}

				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
					} catch (error) {
						reject(error);
					}
				});
				response.on("error", reject);
			}
		).on("error", reject);
	});
}

// Every real release tag on the repo, e.g. "v1.2.0" — GitHub's tags API,
// unauthenticated. Public, and checked once every few hours, so the
// anonymous rate limit is nowhere close to a concern.
async function fetchReleaseTags() {
	const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/tags?per_page=100`;
	const tags = await fetchJson(url);

	if (!Array.isArray(tags)) {
		return [];
	}

	return tags
		.map((tag) => tag.name)
		.filter((name) => semver.valid(semver.coerce(name)));
}

// The newest tag that's still the same major version OmniCore is
// currently running — never a future major, for exactly the reason
// docker-compose.yml pins the image to ":<major>" rather than ":latest":
// a breaking version should never arrive as something that just happens
// silently.
async function fetchLatestCompatibleTag() {
	const running = omnicoreVersion.comparableVersion();
	if (!running) {
		return null; // dev build — nothing to compare against
	}

	const tags = await fetchReleaseTags();
	const sameMajor = tags.filter(
		(name) => semver.major(semver.coerce(name)) === semver.major(running)
	);

	if (sameMajor.length === 0) {
		return null;
	}

	sameMajor.sort((a, b) => semver.rcompare(semver.coerce(a), semver.coerce(b)));
	return sameMajor[0];
}

// { updateAvailable, currentVersion, latestVersion } — or null on a dev
// build, where the question doesn't really mean anything.
async function checkForUpdate() {
	const running = omnicoreVersion.comparableVersion();
	if (!running) {
		return null;
	}

	const latestTag = await fetchLatestCompatibleTag();
	if (!latestTag) {
		return { updateAvailable: false, currentVersion: running, latestVersion: null };
	}

	const latest = semver.coerce(latestTag).version;

	return {
		updateAvailable: semver.gt(latest, running),
		currentVersion: running,
		latestVersion: latest
	};
}

// Talks to the Docker Engine API over the socket mounted into the
// container at /var/run/docker.sock (see docker-compose.yml). Never
// constructed until applyUpdate() actually needs it — checkForUpdate()
// above has no dependency on this at all, which is what keeps update
// *checking* working even when someone has deliberately removed that
// socket mount.
function connectToDocker() {
	return new Docker({ socketPath: "/var/run/docker.sock" });
}

// Which container OmniCore is running as, found without any name having
// to be hardcoded or configured. Docker sets a container's hostname to
// its own short container ID by default — unless something overrides it
// with an explicit `hostname:`, which docker-compose.yml deliberately
// does not do, specifically so this keeps working.
async function getSelfContainer(docker) {
	const container = docker.getContainer(require("os").hostname());
	const info = await container.inspect();
	return { container, info };
}

// Pulls an image reference and waits for the pull to actually finish —
// dockerode's .pull() only hands back a stream of progress events, not a
// promise, so this is the difference between "the download started" and
// "the download is done and it's safe to read the result".
function pullImage(docker, imageRef) {
	return new Promise((resolve, reject) => {
		docker.pull(imageRef, (error, stream) => {
			if (error) {
				reject(error);
				return;
			}

			docker.modem.followProgress(stream, (finishError) => {
				if (finishError) {
					reject(finishError);
					return;
				}
				resolve();
			});
		});
	});
}

// Everything about the current container worth carrying over to its
// replacement. Deliberately narrow: PortBindings and Binds are what make
// the new container reachable at the same address with the same data;
// RestartPolicy is what makes it come back after a host reboot the same
// way the old one did.
//
// Env is deliberately NOT copied. The old container's Env includes
// OMNICORE_VERSION baked in from ITS OWN image at build time — copying
// it forward would stamp the new container with the old version number,
// which would make every future check think no update ever happened.
// Leaving Env unset means the new image's own baked-in ENV applies
// exactly the way it would on a fresh install.
function hostConfigToCarryOver(info) {
	const hostConfig = info.HostConfig || {};

	return {
		Binds: hostConfig.Binds || [],
		PortBindings: hostConfig.PortBindings || {},
		RestartPolicy: hostConfig.RestartPolicy || { Name: "unless-stopped" }
	};
}

// The actual swap. Returns what happened; throws only for something
// genuinely unrecoverable (no socket, a Docker API error) — an
// already-up-to-date install is a normal, successful outcome, not an
// error.
async function applyUpdate() {
	const docker = connectToDocker();

	let self;
	try {
		self = await getSelfContainer(docker);
	} catch (error) {
		throw new Error(
			`Can't reach the Docker socket to self-update — is ` +
				`/var/run/docker.sock mounted? (${error.message})`
		);
	}

	const originalName = self.info.Name.replace(/^\//, "");
	const imageRef = self.info.Config.Image; // e.g. "ghcr.io/tanzim2000/omnia-omnicore:1"
	const runningImageId = self.info.Image; // resolved image ID, not the tag string

	await pullImage(docker, imageRef);

	const pulled = await docker.getImage(imageRef).inspect();
	if (pulled.Id === runningImageId) {
		return { updated: false, reason: "already running the newest image" };
	}

	const previousName = `${originalName}-previous`;
	const incomingName = `${originalName}-incoming`;
	// Where a version that failed its health check gets parked. Kept
	// rather than deleted, so a bad update can actually be investigated
	// afterward instead of vanishing along with the evidence.
	const failedName = `${originalName}-failed`;

	// Only one rollback generation is kept — a backup from the update
	// before last would otherwise collide with this one's name and block
	// the swap.
	for (const staleName of [previousName, incomingName, failedName]) {
		try {
			await docker.getContainer(staleName).remove({ force: true });
		} catch (error) {
			// Nothing by that name yet — the normal case, not a problem.
		}
	}

	// Helper containers from previous updates are no longer
	// auto-removed (their logs are the only record of what happened
	// during a swap), so they're cleared here instead -- one update
	// later, when nobody needs them any more.
	try {
		const stale = await docker.listContainers({
			all: true,
			filters: { name: [`${originalName}-updater-`] }
		});

		for (const container of stale) {
			await docker.getContainer(container.Id).remove({ force: true });
		}
	} catch (error) {
		// Cleanup failing is never a reason to block an update.
	}

	await docker.createContainer({
		name: incomingName,
		Image: imageRef,
		HostConfig: hostConfigToCarryOver(self.info)
	});

	// The part explained above: OmniCore cannot perform "stop old, start
	// new" itself, because it dies partway through its own first step.
	// A separate, short-lived container does the actual swap instead —
	// it isn't affected by this container being stopped, so it survives
	// to finish the job.
	//
	// It also survives long enough to WATCH the result, which is what
	// makes rollback automatic rather than something a person has to
	// know to do. The new container carries the HEALTHCHECK baked into
	// the image (see Dockerfile), so Docker itself decides whether it
	// came up able to do its job -- the helper just reads that verdict
	// rather than reimplementing its own HTTP polling.
	//
	// If it never reaches healthy inside the window, the helper puts
	// everything back exactly as it was. The failure this closes: a
	// swap that half-worked used to leave OmniCore down with nothing
	// bringing it back.
	//
	// "docker:cli" — Docker's own official CLI-only image — rather than
	// a pinned version. Unlike OmniCore's own image, where a floating tag
	// is a deliberate compatibility promise, this is disposable
	// infrastructure glue that runs a few commands and exits; there is
	// nothing here for a version to be incompatible with.
	const helperScript = `
set -e

docker stop ${originalName}
docker rename ${originalName} ${previousName}
docker rename ${incomingName} ${originalName}
docker start ${originalName}

# Wait for the new version to prove itself. Polling Docker's own health
# status rather than curling the app directly: the HEALTHCHECK is baked
# into the image, so this stays correct even if the endpoint moves.
waited=0
while [ $waited -lt ${ROLLBACK_WINDOW_SECONDS} ]; do
	state=$(docker inspect --format '{{.State.Health.Status}}' ${originalName} 2>/dev/null || echo "missing")

	if [ "$state" = "healthy" ]; then
		echo "New version is healthy after $\{waited\}s"
		exit 0
	fi

	# An image with no HEALTHCHECK at all reports no health state.
	# Treated as success rather than rolled back: an older OmniCore
	# predating the healthcheck is not a broken one, and rolling back
	# every such update would be worse than the problem.
	if [ "$state" = "missing" ]; then
		if docker inspect --format '{{.State.Running}}' ${originalName} | grep -q true; then
			echo "No healthcheck to read; container is running, accepting"
			exit 0
		fi
	fi

	sleep ${ROLLBACK_POLL_SECONDS}
	waited=$((waited + ${ROLLBACK_POLL_SECONDS}))
done

# Never got there. Put back exactly what was working before.
echo "New version never became healthy in ${ROLLBACK_WINDOW_SECONDS}s, rolling back"
docker stop ${originalName} || true
docker rename ${originalName} ${failedName}
docker rename ${previousName} ${originalName}
docker start ${originalName}
echo "Rolled back. The failed version is kept as ${failedName}."
`;

	await pullImage(docker, "docker:cli");

	const helper = await docker.createContainer({
		name: `${originalName}-updater-${Date.now()}`,
		Image: "docker:cli",
		Entrypoint: ["sh", "-c"],
		Cmd: [helperScript],
		HostConfig: {
			Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
			// Kept rather than auto-removed: if an update went wrong,
			// this container's logs are the only record of what
			// happened, and they'd vanish exactly when they're most
			// needed. Cleaned up on the next update instead.
			AutoRemove: false
		}
	});

	await helper.start();

	// From here on, this process is on borrowed time — the helper is
	// about to stop this very container. Nothing after this point is
	// guaranteed to run, which is exactly why every step that matters
	// (creating the new container, removing stale backups) already
	// happened above, not here.
	return {
		updated: true,
		from: runningImageId,
		to: pulled.Id,
		rollback: `docker start ${previousName}`
	};
}

module.exports = {
	checkForUpdate,
	fetchLatestCompatibleTag,
	applyUpdate,
	REPO_OWNER,
	REPO_NAME
};