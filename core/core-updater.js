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
//
// Two things can ask for an update to be applied: the scheduler (every
// six hours) and the "Update now" button on the Updates page. Both come
// through applyUpdate(), and applyUpdate() lets only one run at a time
// -- see "One update at a time" below.

const https = require("https");
const os = require("os");
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
//
// Lined up with the image's HEALTHCHECK (see Dockerfile): checked often
// during its first 60 seconds, then every 30. 150 seconds covers the
// checks at 90 and 120 too, so a version that takes a little over a
// minute to come up isn't rolled back for being slow.
const ROLLBACK_WINDOW_SECONDS = 150;
const ROLLBACK_POLL_SECONDS = 5;

// Longest a download may take before the update is given up. Nothing is
// swapped by then, so giving up is safe -- and without a limit, a stalled
// download would hold the one-update-at-a-time lock until OmniCore
// restarted, and every later update would be refused.
const PULL_TIMEOUT_MS = 20 * 60 * 1000;

// The short-lived container that does the swap (see swapContainer).
// Docker's own official CLI-only image.
const HELPER_IMAGE = "docker:cli";

// After the swap has been handed to the helper container, this process
// is about to be stopped and nothing should start a second update. If
// for some reason it is never stopped (the helper died before it got
// that far), the lock lets go after this long rather than blocking
// updates until somebody restarts OmniCore by hand.
const HANDED_OVER_LOCK_MS = 10 * 60 * 1000;

// Labels Docker Compose puts on the containers it creates. Compose finds
// "its" container by these, not by name -- so a container made without
// them is invisible to it, and `docker compose up -d` then tries to
// create a second one with the same name and fails with "container name
// already in use". Everything starting with this is carried over.
const COMPOSE_LABEL_PREFIX = "com.docker.compose.";

// The one Compose label that must NOT be carried over as it was: which
// image the container was made from. Compose compares it with the image
// it would use now, and recreates the container when they differ. The
// new container is made from the new image, so it says so.
const COMPOSE_IMAGE_LABEL = "com.docker.compose.image";

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

// Same as fetchJson but for plain text. The changelog is a Markdown
// file, not an API response, so it needs its own reader rather than
// being parsed as JSON.
function fetchText(url) {
	return new Promise((resolve, reject) => {
		https.get(
			url,
			{ headers: { "User-Agent": "OmniCore" } },
			(response) => {
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`${url} responded ${response.statusCode}`));
					return;
				}

				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () =>
					resolve(Buffer.concat(chunks).toString("utf-8"))
				);
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
// constructed until something actually needs it — checkForUpdate()
// above has no dependency on this at all, which is what keeps update
// *checking* working even when someone has deliberately removed that
// socket mount.
//
// OMNICORE_DOCKER_SOCKET exists for the tests, which run a real swap
// against a Docker on another path. Nothing else sets it.
function connectToDocker() {
	return new Docker({
		socketPath: process.env.OMNICORE_DOCKER_SOCKET || "/var/run/docker.sock"
	});
}

// Which container OmniCore is running as, found without any name having
// to be hardcoded or configured. Docker sets a container's hostname to
// its own short container ID by default — unless something overrides it
// with an explicit `hostname:`, which docker-compose.yml deliberately
// does not do, specifically so this keeps working.
async function getSelfContainer(docker) {
	const container = docker.getContainer(os.hostname());
	const info = await container.inspect();
	return { container, info };
}

// Pulls an image reference and waits for the pull to actually finish —
// dockerode's .pull() only hands back a stream of progress events, not a
// promise, so this is the difference between "the download started" and
// "the download is done and it's safe to read the result".
function pullImage(docker, imageRef) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Downloading ${imageRef} took longer than ${PULL_TIMEOUT_MS / 60000} minutes`));
		}, PULL_TIMEOUT_MS);
		timer.unref();

		const finish = (error) => {
			clearTimeout(timer);
			if (error) reject(error);
			else resolve();
		};

		docker.pull(imageRef, (error, stream) => {
			if (error) {
				finish(error);
				return;
			}

			docker.modem.followProgress(stream, (finishError) => finish(finishError));
		});
	});
}

// The helper image, made ready to use. Pulled fresh each time when
// possible -- a Docker CLI from years ago can be too old to talk to a
// newer Docker -- but the copy already on the machine will do when the
// pull fails. That pull comes from Docker Hub, which turns away
// anonymous downloads past a limit ("429 Too Many Requests"); an update
// shouldn't fail over a helper image that's already sitting there.
async function readyHelperImage(docker, imageRef) {
	try {
		await pullImage(docker, imageRef);
		return;
	} catch (error) {
		try {
			await docker.getImage(imageRef).inspect();
			console.log(`  Couldn't refresh ${imageRef} (${error.message}); using the copy already here`);
		} catch (missing) {
			throw error;
		}
	}
}

// The replacement container is made to be the old one with a new image.
// Everything somebody set up for it -- in docker-compose.yml or on a
// `docker run` line -- has to survive the swap: if it didn't, Compose
// (which still sees the same file, so has no reason to recreate it) would
// leave it quietly missing. What belongs to the IMAGE must not survive:
// the new image brings its own.
//
// The functions below split one from the other.

// The host side, all of it: volumes (Binds and Mounts, exactly as they
// are), ports, restart policy, network, and anything else that was set --
// extra hosts, devices, limits, log settings. None of that comes from an
// image, so all of it carries over as it was. The same approach Watchtower
// takes.
//
// A container that somehow has none of it still gets a working minimum.
function hostConfigToCarryOver(info) {
	return {
		...(info.HostConfig || {}),
		Binds: (info.HostConfig && info.HostConfig.Binds) || [],
		PortBindings: (info.HostConfig && info.HostConfig.PortBindings) || {},
		RestartPolicy: (info.HostConfig && info.HostConfig.RestartPolicy) || { Name: "unless-stopped" }
	};
}

// The labels somebody set (a reverse proxy's routing labels, say), plus
// Compose's own -- the ones that tell Compose the container is its own,
// see COMPOSE_LABEL_PREFIX above.
//
// A container's labels also include every label of its image (the
// version, the source repo); those are left for the new image to supply.
// So: what the container has that its old image didn't give it, with the
// one Compose label naming the image pointed at the new one.
function carriedLabels(containerLabels, imageLabels, newImageId) {
	const fromImage = imageLabels || {};
	const carried = {};

	for (const [name, value] of Object.entries(containerLabels || {})) {
		if (fromImage[name] !== value || name.startsWith(COMPOSE_LABEL_PREFIX)) {
			carried[name] = value;
		}
	}

	if (COMPOSE_IMAGE_LABEL in carried) {
		carried[COMPOSE_IMAGE_LABEL] = newImageId;
	}

	return carried;
}

// The environment variables somebody set themselves, in docker-compose.yml
// (TZ, say) -- carried over, since the new container should behave the
// way the old one did.
//
// The rest of a container's variables come from its image: PATH, Node's
// version, and OMNICORE_VERSION, baked in at build time. Those must NOT be
// copied. The old image's OMNICORE_VERSION would stamp the new container
// with the old version number, and every future check would think no
// update ever happened. So: what the container has that its image didn't
// give it, minus OMNICORE_VERSION whatever happens.
function userEnvironment(containerEnv, imageEnv) {
	const fromImage = new Set(Array.isArray(imageEnv) ? imageEnv : []);

	return (Array.isArray(containerEnv) ? containerEnv : []).filter(
		(entry) =>
			!fromImage.has(entry) && !String(entry).startsWith("OMNICORE_VERSION=")
	);
}

// What the container runs, and as whom, when somebody changed it
// (`command:`, `entrypoint:`, `user:` in docker-compose.yml). Left out when
// it's what the old image said anyway -- then the new image's own choice
// applies, which matters if a new version starts differently.
function carriedOverrides(config, imageConfig) {
	const image = imageConfig || {};
	const carried = {};

	for (const key of ["Cmd", "Entrypoint", "User", "WorkingDir"]) {
		const value = (config || {})[key];

		if (value !== undefined && value !== null && value !== "" &&
			JSON.stringify(value) !== JSON.stringify(image[key])) {
			carried[key] = value;
		}
	}

	return carried;
}

// The networks the container is on, as Docker wants them at creation
// (the main one, with its aliases) and after it (any others, joined one by
// one -- creating a container on several networks at once isn't something
// every Docker version accepts).
//
// The container's own short ID is dropped from the aliases: Docker adds
// that itself, and the old ID would point at the wrong container.
function networksToCarryOver(info) {
	const networks = (info.NetworkSettings && info.NetworkSettings.Networks) || {};
	const main = info.HostConfig && info.HostConfig.NetworkMode;
	const ownId = String(info.Id || "").slice(0, 12);

	const endpoint = (settings) => {
		const aliases = ((settings && settings.Aliases) || []).filter((alias) => alias !== ownId);
		return aliases.length ? { Aliases: aliases } : {};
	};

	const atCreate = main && networks[main]
		? { EndpointsConfig: { [main]: endpoint(networks[main]) } }
		: undefined;

	const afterwards = Object.keys(networks)
		.filter((name) => name !== main)
		.map((name) => ({ name, endpoint: endpoint(networks[name]) }));

	return { atCreate, afterwards };
}

// The shell lines that join the new container to its other networks
// (see networksToCarryOver). Network names and aliases are plain words
// in practice; anything else is skipped rather than put in a shell
// command.
function networkJoinLines(afterwards) {
	const plain = (text) => /^[A-Za-z0-9_.-]+$/.test(String(text));

	return afterwards
		.filter((network) => plain(network.name))
		.map((network) => {
			const aliases = (network.endpoint.Aliases || [])
				.filter(plain)
				.map((alias) => `--alias ${alias} `)
				.join("");

			return `docker network connect ${aliases}${network.name} "$ORIGINAL" || put_back "Couldn't join the network ${network.name}"`;
		})
		.join("\n");
}

// Where the Docker socket is on the host. Usually /var/run/docker.sock,
// but not always (rootless Docker, colima). OmniCore itself reached Docker
// through whatever was mounted at /var/run/docker.sock inside it, so the
// helper gets that same source.
function dockerSocketSource(info) {
	const target = "/var/run/docker.sock";
	const hostConfig = info.HostConfig || {};

	for (const bind of hostConfig.Binds || []) {
		const [source, destination] = String(bind).split(":");
		if (destination === target) return source;
	}

	for (const mount of hostConfig.Mounts || []) {
		if (mount && mount.Target === target && mount.Source) return mount.Source;
	}

	for (const mount of info.Mounts || []) {
		if (mount && mount.Destination === target && mount.Source) return mount.Source;
	}

	return target;
}

// ---------------------------------------------------------------------
// One update at a time
//
// The button and the scheduler both end up in applyUpdate(), and so do a
// double-click and two open tabs. Two swaps at once would fight over the
// same container names, so only the first gets to run; anything asking
// while it does is told an update is already under way.
//
// `progress` is what the Updates page shows while it waits:
//
//   phase   "idle"         nothing happening
//           "downloading"  pulling the new image (the slow part)
//           "switching"    handed to the helper container; this process
//                          is about to be stopped and replaced
//           "failed"       stopped before anything was swapped. `error`
//                          says why. Kept until the next attempt.
//   target  the version being installed, when known
//   error   why it failed, or null
//   note    why it finished without swapping ("already running the
//           newest image"), or null
let busy = false;
let progress = { phase: "idle", target: null, error: null, note: null };

function setProgress(phase, extra) {
	progress = { phase, target: progress.target, error: null, note: null, ...extra };
}

function currentProgress() {
	return { ...progress, busy };
}

// Can this OmniCore install an update itself? { ready, reason }.
//
// Two reasons it can't: a development build (there's no published
// release to swap to, and swapping out a container someone is working
// on would be harmful), and no way to reach Docker (the socket line was
// taken out of docker-compose.yml, or OmniCore isn't in a container at
// all). Both are legitimate setups, not faults -- the Updates page says
// which one it is instead of offering a button that can only fail.
async function applyReadiness() {
	if (omnicoreVersion.isDevBuild()) {
		return {
			ready: false,
			reason: "This is a development build, which doesn't update itself."
		};
	}

	try {
		await getSelfContainer(connectToDocker());
	} catch (error) {
		return {
			ready: false,
			reason:
				"OmniCore can't reach Docker, so it can't install updates itself. " +
				"Update by hand with: docker compose pull && docker compose up -d"
		};
	}

	return { ready: true, reason: null };
}

// Apply an update, if one is there to apply. Returns what happened:
//
//   { updated: true, ... }                the swap is under way
//   { updated: false, reason }            nothing to do (already newest)
//   { updated: false, busy: true, reason } another update is running
//
// and throws when it couldn't be done (no socket, a Docker error), with
// progress left at "failed" so the page can say why.
//
// `target` is only for the progress line ("Installing 1.19.1").
async function applyUpdate(target) {
	if (busy) {
		return {
			updated: false,
			busy: true,
			reason: "An update is already being installed."
		};
	}

	busy = true;
	progress = { phase: "downloading", target: target || null, error: null, note: null };

	let result;

	try {
		result = await swapContainer();
	} catch (error) {
		busy = false;
		setProgress("failed", { error: error.message });
		throw error;
	}

	if (!result.updated) {
		busy = false;

		// The check said a newer version exists (it reads GitHub's
		// release tags), yet the image downloaded is the one already
		// running. That happens when a release is tagged but its image
		// hasn't been built and published yet -- worth saying, since
		// "already up to date" next to "version X is available" would
		// read as a contradiction.
		setProgress("idle", {
			note: target
				? `The download for ${target} isn't ready yet: it's been released, ` +
				  `but its image hasn't been published. Try again later.`
				: "OmniCore is already running the newest version."
		});
		return result;
	}

	// Handed over: this process is about to be stopped. The lock stays
	// held so nothing starts a second swap in the seconds that leaves --
	// with a way out in case the stop never comes.
	setProgress("switching");

	setTimeout(() => {
		busy = false;
		setProgress("failed", {
			error:
				"The switch to the new version never happened. OmniCore is still " +
				"on the version it had; trying again is safe."
		});
	}, HANDED_OVER_LOCK_MS).unref();

	return result;
}

// The actual swap. Returns what happened; throws only for something
// genuinely unrecoverable (no socket, a Docker API error) — an
// already-up-to-date install is a normal, successful outcome, not an
// error.
async function swapContainer() {
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

	// What the old image itself set, so the functions above can tell that
	// apart from what somebody set by hand. An old image that's somehow
	// gone counts as having set nothing -- everything is then kept except
	// OMNICORE_VERSION, which is the one that matters.
	let runningImageConfig = {};
	try {
		const runningImage = await docker.getImage(runningImageId).inspect();
		runningImageConfig = runningImage.Config || {};
	} catch (error) {
		// Nothing to subtract
	}

	const previousName = `${originalName}-previous`;
	const incomingName = `${originalName}-incoming`;
	// Where a version that failed is put while the old one comes back.
	// Removed by the helper once its logs are copied into the helper's
	// own (see the script below).
	const failedName = `${originalName}-failed`;

	// Leftovers from an earlier update that was interrupted would collide
	// with these names and block the swap.
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

	// Everything that can fail is done BEFORE the replacement container
	// is made. The replacement carries Compose's labels (see
	// carriedLabels), and one left lying around after a failed update is
	// a second container Compose would take for OmniCore: the next
	// `docker compose up -d` started it and removed the real one.
	await readyHelperImage(docker, HELPER_IMAGE);

	const networks = networksToCarryOver(self.info);

	const incoming = await docker.createContainer({
		name: incomingName,
		Image: imageRef,
		...carriedOverrides(self.info.Config, runningImageConfig),
		Env: userEnvironment(self.info.Config.Env, runningImageConfig.Env),
		Labels: carriedLabels(self.info.Config.Labels, runningImageConfig.Labels, pulled.Id),
		HostConfig: hostConfigToCarryOver(self.info),
		NetworkingConfig: networks.atCreate
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
	// Anything going wrong after the old version is stopped -- the new
	// one won't start, a rename fails, it never turns healthy, Docker
	// calls it unhealthy -- puts the old one back. `step` records how far
	// the swap got, so put_back undoes exactly that much: an OmniCore
	// left stopped is never restarted by Docker (`unless-stopped` treats
	// it as stopped on purpose), not even after a reboot.
	//
	// Either way only ONE OmniCore container is left at the end. Both the
	// old and the new one carry Compose's labels, and Compose finding two
	// containers for one service is exactly the confusion the labels are
	// there to prevent. So:
	//
	//   healthy       the old one ("-previous") is removed
	//   put back      the new one is removed -- after its last log lines
	//                 are printed into the helper's own log, which is
	//                 kept until the next update. That log is the record
	//                 of what went wrong.
	//
	// "docker:cli" — Docker's own official CLI-only image — rather than
	// a pinned version. Unlike OmniCore's own image, where a floating tag
	// is a deliberate compatibility promise, this is disposable
	// infrastructure glue that runs a few commands and exits; there is
	// nothing here for a version to be incompatible with.
	const helperScript = `
ORIGINAL=${originalName}
PREVIOUS=${previousName}
INCOMING=${incomingName}
FAILED=${failedName}

# This container's health as Docker sees it: healthy, unhealthy,
# starting, "none" for an image without a HEALTHCHECK, "missing" when
# the container isn't there at all
health() {
	docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing
}

# Undo the swap as far as it got, start the old version, and keep the
# new one's last words in this log
put_back() {
	echo "$1 -- putting the old version back"

	if [ "$step" -ge 3 ]; then
		docker stop "$ORIGINAL" >/dev/null 2>&1
		docker rename "$ORIGINAL" "$FAILED" || docker rm -f "$ORIGINAL"
	fi

	if [ "$step" -ge 2 ]; then
		docker rename "$PREVIOUS" "$ORIGINAL"
	fi

	docker start "$ORIGINAL" || docker start "$PREVIOUS"

	echo "Put back. The new version's last log lines:"
	docker logs --tail 200 "$FAILED" 2>&1 || docker logs --tail 200 "$INCOMING" 2>&1
	docker rm -f "$FAILED" "$INCOMING" >/dev/null 2>&1
	exit 1
}

step=0
docker stop "$ORIGINAL" || put_back "Couldn't stop the old version"
step=1
docker rename "$ORIGINAL" "$PREVIOUS" || put_back "Couldn't rename the old version"
step=2
docker rename "$INCOMING" "$ORIGINAL" || put_back "Couldn't rename the new version"
step=3
${networkJoinLines(networks.afterwards)}
docker start "$ORIGINAL" || put_back "The new version wouldn't start"

# Wait for the new version to prove itself. Polling Docker's own health
# status rather than curling the app directly: the HEALTHCHECK is baked
# into the image, so this stays correct even if the endpoint moves.
waited=0
while [ $waited -lt ${ROLLBACK_WINDOW_SECONDS} ]; do
	state=$(health "$ORIGINAL")

	if [ "$state" = "healthy" ]; then
		break
	fi

	# Docker's own verdict that it failed: the image's healthcheck
	# allows a start-up period first, so "unhealthy" only ever means it
	# came up and then kept failing. No point waiting out the rest of
	# the window with every screen blank.
	if [ "$state" = "unhealthy" ] || [ "$state" = "missing" ]; then
		put_back "The new version is $state"
	fi

	# An image with no HEALTHCHECK at all has nothing to wait for.
	# Running counts as success: an older OmniCore predating the
	# healthcheck is not a broken one.
	if [ "$state" = "none" ]; then
		if docker inspect --format '{{.State.Running}}' "$ORIGINAL" | grep -q true; then
			echo "No healthcheck to read; the new version is running, keeping it"
			break
		fi

		put_back "The new version stopped"
	fi

	sleep ${ROLLBACK_POLL_SECONDS}
	waited=$((waited + ${ROLLBACK_POLL_SECONDS}))
done

# One last look: it may have turned healthy during the last sleep
state=$(health "$ORIGINAL")

if [ "$state" != "healthy" ] && [ "$state" != "none" ]; then
	put_back "The new version wasn't healthy after ${ROLLBACK_WINDOW_SECONDS}s (last: $state)"
fi

echo "The new version is in place after $\{waited\}s"
docker rm -f "$PREVIOUS" >/dev/null 2>&1
exit 0
`;

	const helperName = `${originalName}-updater-${Date.now()}`;

	try {
		const helper = await docker.createContainer({
			name: helperName,
			Image: HELPER_IMAGE,
			Entrypoint: ["sh", "-c"],
			Cmd: [helperScript],
			HostConfig: {
				// The same Docker OmniCore itself talks to
				Binds: [`${dockerSocketSource(self.info)}:/var/run/docker.sock`],
				// Kept rather than auto-removed: if an update went wrong,
				// this container's logs are the only record of what
				// happened, and they'd vanish exactly when they're most
				// needed. Cleaned up on the next update instead.
				AutoRemove: false
			}
		});

		await helper.start();
	} catch (error) {
		// The helper never got going, so nothing was swapped. Take the
		// replacement away again rather than leave it for Compose to find.
		try {
			await incoming.remove({ force: true });
		} catch (cleanupError) {
			// Removed at the start of the next update anyway
		}

		throw error;
	}

	// From here on, this process is on borrowed time — the helper is
	// about to stop this very container. Nothing after this point is
	// guaranteed to run, which is exactly why every step that matters
	// (creating the new container, removing stale backups) already
	// happened above, not here.
	return {
		updated: true,
		from: runningImageId,
		to: pulled.Id,
		log: `docker logs ${helperName}`
	};
}

// This container's own health, as Docker sees it: "starting",
// "healthy", "unhealthy" -- or null when there's no way to know (no
// Docker socket, or not in a container at all).
//
// The Updates page asks for this while it waits for a new version to
// come up. A new version answering isn't enough on its own: it's only
// kept once Docker calls it healthy, and until then it can still be
// rolled back.
async function selfHealth() {
	try {
		const self = await getSelfContainer(connectToDocker());
		const health = self.info.State && self.info.State.Health;

		return health && health.Status ? health.Status : null;
	} catch (error) {
		return null;
	}
}

// The changelog entry for one version, pulled from the repo rather
// than from inside this image.
//
// It has to come over the network for the version being offered --
// that release's notes cannot possibly exist inside a container built
// before it. Reading the CURRENT version's notes the same way, rather
// than from the local CHANGELOG.md, keeps one mechanism instead of two
// that can disagree.
async function fetchChangelogEntry(tag) {
	const url =
		`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/` +
		`${encodeURIComponent(tag)}/CHANGELOG.md`;

	let raw;

	try {
		raw = await fetchText(url);
	} catch (error) {
		return null;
	}

	// Everything between this version's heading and the next one.
	const bare = String(tag).replace(/^v/, "");
	const pattern = new RegExp(
		`^## v?${bare.replace(/\./g, "\\.")}\\s*$([\\s\\S]*?)(?=^## |\\Z)`,
		"m"
	);
	const match = raw.match(pattern);

	return match ? match[1].trim() : null;
}

// When the running container was created. This is "last updated"
// without needing to record anything ourselves: a self-update replaces
// the container, so its creation time IS the moment this version took
// over.
//
// Null without a Docker socket, which is a legitimate setup rather
// than a fault.
async function runningSince() {
	try {
		const docker = connectToDocker();
		const self = await getSelfContainer(docker);

		return self.info.Created || null;
	} catch (error) {
		return null;
	}
}

module.exports = {
	checkForUpdate,
	fetchChangelogEntry,
	runningSince,
	fetchLatestCompatibleTag,
	applyUpdate,
	applyReadiness,
	currentProgress,
	selfHealth,
	hostConfigToCarryOver,
	carriedLabels,
	carriedOverrides,
	userEnvironment,
	networksToCarryOver,
	dockerSocketSource,
	REPO_OWNER,
	REPO_NAME
};