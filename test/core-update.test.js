// test/core-update.test.js
// OmniCore updating itself: the "Update now" button and what's behind it.
//
// The real swap needs a real Docker and a real published image, which a
// test run doesn't have. Everything up to the swap is tested here
// against a stand-in Docker -- a tiny HTTP server on a socket, answering
// the few calls OmniCore makes -- so the parts most likely to go wrong
// in daily use are covered for real:
//
//   - only one update can run at a time (button, scheduler, double-click)
//   - a failure lets go of that lock and says why
//   - the button is only offered when there is an update, and can't be
//     pressed where it can only fail (no Docker, development build)
//   - what the replacement container is given: Compose's labels, the
//     variables somebody set themselves, the same volumes and network
//
// The swap itself was checked by hand against a real Docker; see the
// v1.19.1 changelog entry.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const { resetState, waitForPort, signIn } = helpers;

// The stand-in Docker listens here, and OmniCore is told to use it
const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fake-docker-")), "docker.sock");
process.env.OMNICORE_DOCKER_SOCKET = socketPath;

const coreUpdater = require("../core/core-updater");
const updateStore = require("../core/update-store");

const PORT = 3000;
const IMAGE = "fake/omnicore:1";

// How the stand-in behaves right now. Changed by each test.
//
//   reachable   false: no Docker at all (the socket isn't even there)
//   inspectMs   how long "who am I?" takes -- long enough to keep an
//               update running while a second one is attempted
//   inspectFails  answer "who am I?" with an error
//   pullMs      how long the download takes
//   health      what Docker says about this container's health
let fake = { inspectMs: 0, inspectFails: false, pullMs: 0, health: "healthy" };
let server = null;

function startFakeDocker() {
	server = http.createServer((req, res) => {
		const url = decodeURIComponent(req.url);

		const send = (status, body) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};

		// Who am I? (getSelfContainer)
		if (req.method === "GET" && url.includes(`/containers/${os.hostname()}/json`)) {
			setTimeout(() => {
				if (fake.inspectFails) {
					send(500, { message: "simulated Docker error" });
					return;
				}

				send(200, {
					Name: "/omnicore",
					Image: "sha256:running",
					Created: "2026-10-01T00:00:00Z",
					Config: { Image: IMAGE, Env: [], Labels: {} },
					HostConfig: {},
					State: { Health: { Status: fake.health } }
				});
			}, fake.inspectMs);
			return;
		}

		// Pull: one progress line, then done
		if (req.method === "POST" && url.includes("/images/create")) {
			setTimeout(() => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "Image is up to date" }) + "\n");
			}, fake.pullMs || 0);
			return;
		}

		// The pulled image is the one already running: nothing to swap
		if (req.method === "GET" && url.includes(`/images/${IMAGE}/json`)) {
			send(200, { Id: "sha256:running" });
			return;
		}

		send(404, { message: `no fake for ${req.method} ${url}` });
	});

	return new Promise((resolve) => server.listen(socketPath, resolve));
}

function stopFakeDocker() {
	return new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}

		server.close(() => {
			server = null;
			resolve();
		});
	});
}

// ---------------------------------------------------------------------
// What the replacement container is given

test("labels: what somebody set and Compose's own are carried, the image's are not", () => {
	const labels = coreUpdater.carriedLabels(
		{
			"com.docker.compose.project": "omnicore",
			"com.docker.compose.service": "omnicore",
			"com.docker.compose.container-number": "1",
			"com.docker.compose.config-hash": "abc",
			"com.docker.compose.image": "sha256:old",
			// Set in docker-compose.yml, for a reverse proxy
			"traefik.enable": "true",
			// From the old image: the new image has its own
			"org.opencontainers.image.version": "v1.19.0"
		},
		{ "org.opencontainers.image.version": "v1.19.0" },
		"sha256:new"
	);

	assert.deepEqual(labels, {
		"com.docker.compose.project": "omnicore",
		"com.docker.compose.service": "omnicore",
		"com.docker.compose.container-number": "1",
		"com.docker.compose.config-hash": "abc",
		"com.docker.compose.image": "sha256:new",
		"traefik.enable": "true"
	});
});

test("labels: a container nobody labelled gets none", () => {
	assert.deepEqual(coreUpdater.carriedLabels({ a: "b" }, { a: "b" }, "x"), {});
	assert.deepEqual(coreUpdater.carriedLabels(undefined, undefined, "x"), {});
});

test("overrides: a changed command or user is carried, the image's own isn't", () => {
	assert.deepEqual(
		coreUpdater.carriedOverrides(
			{ Cmd: ["node", "start.OmniCore"], User: "1000", WorkingDir: "/app", Entrypoint: null },
			{ Cmd: ["node", "start.OmniCore"], User: "", WorkingDir: "/app" }
		),
		{ User: "1000" }
	);
});

test("networks: the main one at creation, the others joined after, without the old id", () => {
	const networks = coreUpdater.networksToCarryOver({
		Id: "abcdef1234567890",
		HostConfig: { NetworkMode: "omnicore_default" },
		NetworkSettings: {
			Networks: {
				omnicore_default: { Aliases: ["omnicore", "abcdef123456"] },
				proxy: { Aliases: null }
			}
		}
	});

	assert.deepEqual(networks.atCreate, { EndpointsConfig: { omnicore_default: { Aliases: ["omnicore"] } } });
	assert.deepEqual(networks.afterwards, [{ name: "proxy", endpoint: {} }]);
});

test("helper: reaches the same Docker OmniCore does", () => {
	assert.equal(
		coreUpdater.dockerSocketSource({ HostConfig: { Binds: ["/run/user/1000/docker.sock:/var/run/docker.sock:rw"] } }),
		"/run/user/1000/docker.sock"
	);
	assert.equal(coreUpdater.dockerSocketSource({}), "/var/run/docker.sock");
});

test("environment: only what somebody set by hand, never the old version number", () => {
	const imageEnv = ["PATH=/usr/bin", "NODE_VERSION=20.20.2", "OMNICORE_VERSION=v1.19.0"];
	const containerEnv = [
		"PATH=/usr/bin",
		"NODE_VERSION=20.20.2",
		"OMNICORE_VERSION=v1.19.0",
		"TZ=America/Regina"
	];

	assert.deepEqual(coreUpdater.userEnvironment(containerEnv, imageEnv), ["TZ=America/Regina"]);

	// Even with the old image gone (nothing to subtract), the version
	// number is never carried
	assert.deepEqual(coreUpdater.userEnvironment(["OMNICORE_VERSION=v1.0.0", "A=1"], null), ["A=1"]);
	assert.deepEqual(coreUpdater.userEnvironment(undefined, undefined), []);
});

test("host config: all of it is kept, with a working minimum", () => {
	const hostConfig = {
		Binds: ["/var/run/docker.sock:/var/run/docker.sock:rw"],
		Mounts: [{ Type: "volume", Source: "omnicore_omnicore-data", Target: "/app/data" }],
		PortBindings: { "3000/tcp": [{ HostPort: "3000" }] },
		RestartPolicy: { Name: "unless-stopped" },
		NetworkMode: "omnicore_default",
		ExtraHosts: ["printer:192.168.1.50"]
	};

	assert.deepEqual(coreUpdater.hostConfigToCarryOver({ HostConfig: hostConfig }), hostConfig);

	assert.deepEqual(coreUpdater.hostConfigToCarryOver({}), {
		Binds: [],
		PortBindings: {},
		RestartPolicy: { Name: "unless-stopped" }
	});
});

// ---------------------------------------------------------------------
// One update at a time

test("lock: a second update while one runs is told it's busy, and a failure lets go", async () => {
	await startFakeDocker();
	fake = { inspectMs: 400, inspectFails: true, pullMs: 0, health: "healthy" };

	const first = coreUpdater.applyUpdate("9.9.9");

	// The lock is taken before anything is waited on
	assert.equal(coreUpdater.currentProgress().busy, true);
	assert.equal(coreUpdater.currentProgress().phase, "downloading");
	assert.equal(coreUpdater.currentProgress().target, "9.9.9");

	const second = await coreUpdater.applyUpdate("9.9.9");
	assert.equal(second.updated, false);
	assert.equal(second.busy, true);

	await assert.rejects(first, /simulated Docker error/);

	const after = coreUpdater.currentProgress();
	assert.equal(after.busy, false, "a failure must let go of the lock");
	assert.equal(after.phase, "failed");
	assert.match(after.error, /simulated Docker error/);
});

test("lock: nothing newer to download lets go too, and says why", async () => {
	fake = { inspectMs: 0, inspectFails: false, pullMs: 0, health: "healthy" };

	const result = await coreUpdater.applyUpdate("9.9.9");

	assert.equal(result.updated, false);

	const after = coreUpdater.currentProgress();
	assert.equal(after.busy, false);
	assert.equal(after.phase, "idle");
	assert.match(after.note, /9\.9\.9 isn't ready yet/, "a released version without an image says so");
});

// ---------------------------------------------------------------------
// The Updates page

let cookie;

async function get(url, withCookie) {
	return fetch(`http://127.0.0.1:${PORT}${url}`, {
		headers: withCookie === false ? {} : { cookie }
	});
}

test("setup: the admin face is up", async () => {
	resetState();
	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("/version: open without signing in, and says which start of OmniCore this is", async () => {
	process.env.OMNICORE_VERSION = "v1.19.1";

	const first = await (await get("/version", false)).json();
	const second = await (await get("/version", false)).json();

	assert.equal(first.version, "1.19.1");
	assert.match(first.bootId, /^[0-9a-f]{16}$/);
	assert.equal(first.bootId, second.bootId, "the same start of OmniCore keeps its name");
	assert.equal(first.health, "healthy");
});

test("updates page: no Update now button without an update", async () => {
	process.env.OMNICORE_VERSION = "v1.19.1";
	updateStore.recordCheck({ latestVersion: "1.19.1", updateAvailable: false });

	const html = await (await get("/updates")).text();

	assert.ok(html.includes("This is the newest version"));
	assert.ok(!html.includes('id="apply"'), "nothing to install, so no button");
});

test("updates page: an update with Docker reachable can be installed", async () => {
	process.env.OMNICORE_VERSION = "v1.19.1";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: true });

	const html = await (await get("/updates")).text();

	assert.ok(html.includes("Update to 1.20.0 now"));
	assert.match(html, /<button class="glass glass-block" id="apply">/, "pressable");

	// It asks first, in a pop-up of its own rather than the browser's
	assert.ok(html.includes("function confirmDialog"));
	assert.ok(html.includes("confirmDialog({"));
	assert.ok(!/[^.\w]confirm\(/.test(html.replace(/function confirmDialog[\s\S]*$/, "")), "no browser confirm()");
});

test("updates page: without Docker the button is there but can't be pressed, and says why", async () => {
	await stopFakeDocker();

	process.env.OMNICORE_VERSION = "v1.19.1";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: true });

	const html = await (await get("/updates")).text();

	assert.match(html, /id="apply" disabled/);
	assert.ok(html.includes("can&#39;t reach Docker") || html.includes("can't reach Docker"));
	assert.ok(html.includes("docker compose pull"));

	const response = await fetch(`http://127.0.0.1:${PORT}/updates/apply`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: "{}"
	});

	assert.equal(response.status, 409);
	assert.match((await response.json()).error, /can't reach Docker/);

	// And /version says it can't know the health, rather than guessing
	assert.equal((await (await get("/version", false)).json()).health, null);
});

test("updates page: a development build never installs", async () => {
	process.env.OMNICORE_VERSION = "dev";

	const response = await fetch(`http://127.0.0.1:${PORT}/updates/apply`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: "{}"
	});

	assert.equal(response.status, 409);
	assert.match((await response.json()).error, /development build/);
});

test("update now: starts, answers straight away, and the page can follow it", async () => {
	await startFakeDocker();
	fake = { inspectMs: 0, inspectFails: false, pullMs: 0, health: "healthy" };

	process.env.OMNICORE_VERSION = "v1.19.1";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: true });

	const response = await fetch(`http://127.0.0.1:${PORT}/updates/apply`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: "{}"
	});

	assert.equal(response.status, 202);

	// The stand-in has nothing newer, so it ends without swapping
	let progress;

	for (let tries = 0; tries < 50; tries++) {
		progress = await (await get("/updates/progress")).json();
		if (!progress.busy) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	assert.equal(progress.busy, false);
	assert.equal(progress.target, "1.20.0");
	assert.match(progress.note, /1\.20\.0 isn't ready yet/);
});

test("update now: refused while another update is running", async () => {
	// A slow download keeps the first update going while the button is
	// pressed again
	fake = { inspectMs: 0, inspectFails: false, pullMs: 1500, health: "healthy" };

	process.env.OMNICORE_VERSION = "v1.19.1";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: true });

	const running = coreUpdater.applyUpdate("1.20.0");

	const response = await fetch(`http://127.0.0.1:${PORT}/updates/apply`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: "{}"
	});

	assert.equal(response.status, 409);
	assert.equal((await response.json()).busy, true, "told it's already under way");

	await running;
	assert.equal(coreUpdater.currentProgress().busy, false);
});

test("update now: signed out, nothing can be started", async () => {
	const response = await fetch(`http://127.0.0.1:${PORT}/updates/apply`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}"
	});

	const text = await response.text();
	assert.ok(text.includes("Sign in"), "the sign-in page, not an update");
});

test("teardown", async () => {
	await stopFakeDocker();
});