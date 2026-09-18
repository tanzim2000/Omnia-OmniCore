// test/faces.test.js
// The faces themselves: creating one through the wizard, rendering it,
// the welcome face's three cases, and what happens when a module
// throws.

const test = require("node:test");
const assert = require("node:assert");


const faceStore = require("../core/face-store");
const notifications = require("../core/notifications");
const { startFace, refresh } = require("../core/face-loader");
const {
	startInputFace,
	stopInputFace,
	refreshInputFace
} = require("../core/input-face-loader");
const moduleStorage = require("../core/module-storage");
const {
	resetState,
	waitForPort,
	writeFailingModule,
	modulesDir,
	themesDir
} = require("./helpers");

const WELCOME_PORT = 4000;
const WIZARD_PORT = 3999;

// Running the whole suite in order leaves these already installed by
// the marketplace tests. Installing them here too means this file can
// also be run on its own, which matters when chasing one failure --
// installEntry with update=true is a no-op-ish overwrite, not an error,
// when something is already there.
//
// Check the directory the suite ACTUALLY runs against (a temp one, set
// by OMNICORE_MODULES_DIR in helpers), not the repo's own modules/
// folder. Those are usually the same shape -- the repo's is empty and
// gitignored -- which is why looking at the wrong one went unnoticed.
// It stops being harmless the moment a developer symlinks their module
// repo into modules/ to work on it, which is the documented local setup:
// the repo folder then looks populated, this test concludes there's
// nothing to install, and the temp directory the face actually reads
// from stays empty. The wizard then finds no installed modules, silently
// drops the instance it was asked to create, and every test downstream
// fails on a face with nothing on it.
test("faces: the modules these tests need are installed", async () => {
	const marketplace = require("../core/marketplace");
	const fs = require("fs");
	const path = require("path");

	for (const [kind, id] of [["module", "weather"], ["theme", "windows8"]]) {
		const root = kind === "theme" ? themesDir : modulesDir;

		if (!fs.existsSync(path.join(root, id))) {
			await marketplace.installEntry(kind, id, true);
		}
	}
});

test("welcome face: with no faces, it sends you to the wizard", async () => {
	resetState();

	require("../core/control-face")();
	require("../core/wizard-face")();

	await waitForPort(WELCOME_PORT);
	await waitForPort(WIZARD_PORT);

	const html = await (await fetch(`http://127.0.0.1:${WELCOME_PORT}/`)).text();

	// Redirects in the browser rather than server-side, because only the
	// browser knows what host it reached OmniCore on.
	assert.ok(
		html.includes(`faceUrl(${WIZARD_PORT})`),
		"expected a redirect to the wizard, since there is nothing to pick"
	);
	assert.ok(
		!html.includes('class="timer"'),
		"there should be no countdown when there is nothing to count down to"
	);
});

test("wizard: creates a face end to end", async () => {
	const response = await fetch(`http://127.0.0.1:${WIZARD_PORT}/faces`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: "Smoke Test Face",
			title: "Smoke",
			theme: "windows8",
			instances: [{ module: "weather", config: {} }],
			themeConfig: {}
		})
	});

	assert.equal(response.status, 200, "face creation failed");

	const face = await response.json();
	assert.ok(face.id >= 4001, `unexpected port: ${face.id}`);

	// The store is the real record -- a response body proves the route
	// answered, not that anything persisted.
	const stored = faceStore.readFaces();
	assert.equal(stored.length, 1, "the face did not persist");
	assert.equal(stored[0].name, "Smoke Test Face");
});

test("dashboard face: serves its instance data over HTTP", async () => {
	const face = faceStore.readFaces()[0];
	await waitForPort(face.id);

	const instance = face.instances[0];
	const response = await fetch(
		`http://127.0.0.1:${face.id}/api/${instance.id}?richness=50`
	);

	assert.equal(response.status, 200);

	const envelope = await response.json();
	assert.ok(envelope.title, "no title in the envelope");
	assert.ok(Array.isArray(envelope.content), "content is not an array");
});

// The change signal, and the promise that it costs old themes nothing.
//
// The second of these two is the one that would actually hurt if it
// broke: every theme written before tagging existed sends no
// If-None-Match and treats a non-OK response as a dead tile, so an
// uninvited 304 would blank a tile whose data was perfectly fine.
test("dashboard face: tags content so a theme can tell new data from the same data", async () => {
	const face = faceStore.readFaces()[0];
	await waitForPort(face.id);

	const instance = face.instances[0];
	const url = `http://127.0.0.1:${face.id}/api/${instance.id}?richness=50`;

	const first = await fetch(url);
	const tag = first.headers.get("etag");

	assert.ok(tag, "no ETag on the response");

	// Same content, asked for again. The tag has to match even though
	// `updated` is a fresh timestamp every call -- if it didn't, the
	// whole thing would be useless for exactly the modules that poll
	// fastest.
	const second = await fetch(url);

	assert.equal(
		second.headers.get("etag"),
		tag,
		"unchanged content produced a different tag"
	);

	// Asking the conditional question gets the short answer
	const conditional = await fetch(url, {
		headers: { "If-None-Match": tag }
	});

	assert.equal(conditional.status, 304, "expected a 304 for a matching tag");

	// A tag that doesn't match gets the real thing
	const stale = await fetch(url, {
		headers: { "If-None-Match": '"not-the-current-tag"' }
	});

	assert.equal(stale.status, 200, "a stale tag should get the full body");
	assert.ok((await stale.json()).content, "no content in the full response");
});

test("dashboard face: a theme that knows nothing about tags is unaffected", async () => {
	const face = faceStore.readFaces()[0];
	await waitForPort(face.id);

	const instance = face.instances[0];
	const url = `http://127.0.0.1:${face.id}/api/${instance.id}?richness=50`;

	// No If-None-Match, twice -- which is every theme written before any
	// of this existed, on every poll it has ever made.
	for (const attempt of [1, 2]) {
		const response = await fetch(url);

		assert.equal(
			response.status,
			200,
			`request ${attempt} did not get a 200 -- an old theme would show this tile as dead`
		);

		const envelope = await response.json();
		assert.ok(envelope.title, `request ${attempt} had no title`);
		assert.ok(
			Array.isArray(envelope.content),
			`request ${attempt} had no content array`
		);
	}
});

// Notifications. The second of these is the one that matters most: a
// face opened in an ordinary browser tab must never receive one, and
// that has to hold without Core checking anything -- a plain browser
// simply never asks.
test("notifications: an OmniView receives one, a plain browser does not", async () => {
	const face = faceStore.readFaces()[0];
	await waitForPort(face.id);

	function listen(asOmniView) {
		return new Promise((resolve) => {
			const received = [];
			const path = asOmniView ? "/events?client=omniview" : "/events";

			const req = require("http").get(
				{ port: face.id, path: path },
				(res) => {
					res.on("data", (chunk) => {
						const text = chunk.toString();
						if (text.includes("event: notification")) {
							received.push(text.split("data: ")[1].split("\n")[0]);
						}
					});
				}
			);

			setTimeout(() => resolve({ received, req }), 400);
		});
	}

	const omniview = await listen(true);
	const plain = await listen(false);

	notifications.notify(face.id, {
		title: "Container stopped",
		description: "immich-server exited unexpectedly",
		priority: 5
	});

	await new Promise((resolve) => setTimeout(resolve, 300));

	assert.equal(omniview.received.length, 1, "OmniView got no notification");

	const note = JSON.parse(omniview.received[0]);
	assert.equal(note.title, "Container stopped");
	assert.equal(note.priority, 5);
	assert.equal(note.seconds, 60, "priority 5 should hold for a minute");

	assert.equal(
		plain.received.length,
		0,
		"a plain browser tab received a notification -- it never should"
	);

	omniview.req.destroy();
	plain.req.destroy();
});

test("notifications: priorities map to the documented durations", () => {
	assert.deepEqual(notifications.PRIORITY_SECONDS, {
		1: 10,
		2: 15,
		3: 30,
		4: 45,
		5: 60
	});

	// A nonsense priority becomes the middle one rather than failing --
	// a notification that didn't show because its priority was "high"
	// would be worse than one that showed for thirty seconds
	assert.equal(notifications.resolvePriority("high"), 3);
	assert.equal(notifications.resolvePriority(9), 3);
	assert.equal(notifications.resolvePriority(4), 4);
});

test("notifications: a title is required", () => {
	const face = faceStore.readFaces()[0];
	assert.equal(notifications.notify(face.id, { description: "no title" }), false);
});

test("dashboard face: a module that throws does not take the face down", async () => {
	writeFailingModule("smoke-failing-module");

	const face = faceStore.readFaces()[0];
	const instance = faceStore.addInstance(
		face.id,
		"smoke-failing-module",
		"",
		{},
		{}
	);

	// A running face holds its own copy of its config -- writing to the
	// store alone doesn't reach it. This is exactly what admin-face.js
	// calls refresh() for after every change, and skipping it here is
	// what made this test fail the first time.
	refresh(face.id);

	// A module's mistake should cost it its own tile and nothing more.
	const response = await fetch(
		`http://127.0.0.1:${face.id}/api/${instance.id}?richness=50`
	);

	assert.notEqual(response.status, 500, "a bad module took the whole route down");

	const envelope = await response.json();
	assert.ok(envelope.content, "expected an error envelope, not nothing");
	assert.ok(
		envelope.content.some((block) => block.text === "Module error"),
		"the envelope should say what went wrong"
	);

	// And the face is still serving everything else afterward
	const healthy = await fetch(
		`http://127.0.0.1:${face.id}/api/${face.instances[0].id}?richness=50`
	);
	assert.equal(healthy.status, 200, "the face stopped serving other modules");

	faceStore.removeInstance(face.id, instance.id);
	refresh(face.id);
});

test("welcome face: with one face, it offers the countdown", async () => {
	const html = await (await fetch(`http://127.0.0.1:${WELCOME_PORT}/`)).text();

	assert.ok(html.includes('class="timer"'), "expected the auto-advance timer");
	assert.ok(html.includes("conic-gradient"), "expected the draining wedge");
	assert.ok(
		html.includes("cancelAutoAdvance"),
		"the countdown must be cancellable by interacting"
	);
});

test("welcome face: with several faces, there is no countdown", async () => {
	faceStore.createFace("Second Face", "", "windows8", []);

	const html = await (await fetch(`http://127.0.0.1:${WELCOME_PORT}/`)).text();

	assert.ok(
		!html.includes('class="timer"'),
		"nothing is safe to auto-pick once there is more than one face"
	);
	assert.ok(html.includes("Smoke Test Face"), "first face missing from the list");
	assert.ok(html.includes("Second Face"), "second face missing from the list");
});

test("welcome face: the machine-readable registry still answers", async () => {
	// This is what OmniView actually calls. It matters more than the
	// HTML page does.
	const faces = await (
		await fetch(`http://127.0.0.1:${WELCOME_PORT}/faces`)
	).json();

	assert.ok(Array.isArray(faces), "expected an array of faces");
	assert.equal(faces.length, 2);
});

// The signal Docker's HEALTHCHECK reads, and the one self-update's
// rollback watches to decide whether a new version came up correctly.
// If this stops answering, a bad update would never get rolled back.
test("welcome face: reports healthy when it can do its job", async () => {
	const response = await fetch(`http://127.0.0.1:${WELCOME_PORT}/health`);

	assert.equal(response.status, 200);

	const body = await response.json();
	assert.equal(body.status, "ok");
	assert.equal(typeof body.faces, "number", "should report how many faces exist");
	assert.ok(body.version, "should report which version is running");
});

test("welcome face: reports unhealthy when the store is unreadable", async () => {
	const fs = require("fs");
	const path = require("path");
	const { dataDir } = require("./helpers");

	const facesFile = path.join(dataDir, "faces.json");
	const good = fs.readFileSync(facesFile, "utf-8");

	// A running-but-broken OmniCore is exactly what a plain process
	// check misses and this endpoint exists to catch.
	fs.writeFileSync(facesFile, "not valid json {{{");

	try {
		const response = await fetch(`http://127.0.0.1:${WELCOME_PORT}/health`);

		assert.equal(response.status, 503, "a broken store must not report healthy");
		assert.equal((await response.json()).status, "unhealthy");
	} finally {
		fs.writeFileSync(facesFile, good);
	}
});

test("about face: boots and serves without needing to log in", async () => {
	process.env.OMNICORE_VERSION = "v1.10.2-test";
	require("../core/about-face")();
	await waitForPort(1303);

	const response = await fetch("http://127.0.0.1:1303/");
	const html = await response.text();

	assert.equal(response.status, 200);
	// Shown without the leading "v" -- the label next to it already
	// says OmniCore, so the prefix adds nothing
	assert.ok(html.includes(">1.10.2-test<"), "should show the running version");
	assert.ok(
		html.includes("github.com/tanzim2000/Omnia-OmniCore"),
		"should link to the real repo"
	);
	assert.ok(
		html.includes("faceUrl(3000)"),
		"the back link needs the cross-port helper, since this is a different port entirely"
	);
	assert.ok(html.includes("Dashboards"), "should report the dashboard count");
	assert.ok(
		html.includes("Architected by Tanzim Ahmed"),
		"credits should be present"
	);
});

test("about face: serves its stylesheet as a real separate file", async () => {
	const response = await fetch("http://127.0.0.1:1303/about.css");

	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type"), /text\/css/);

	const css = await response.text();
	assert.ok(css.includes(".omnia-title"), "the wordmark rule should be in here");
	assert.ok(
		css.includes("@font-face"),
		"the wordmark font is declared in the stylesheet, not inline"
	);
});

test("about face: reports real system facts", async () => {
	const systemInfo = require("../core/system-info");
	const info = await systemInfo.readAll();

	// The OS is read from a real file rather than assumed, so this
	// asserts it found something rather than a specific distribution
	assert.ok(info.operatingSystem, "should detect the host OS");
	assert.equal(typeof info.healthy, "boolean");
	assert.equal(typeof info.dashboards, "number");

	// No Docker socket in a test run is normal, and must be a null
	// rather than a thrown error
	assert.ok(
		info.runtime === null || typeof info.runtime === "object",
		"a missing container runtime should be null, not a crash"
	);
});

test("inport: a tap reaches the right module and persists", async () => {
	const fs = require("fs");
	const path = require("path");
	const { modulesDir } = require("./helpers");

	// A module that takes input, written here rather than pulled from
	// the registry because nothing published declares one yet.
	const dir = path.join(modulesDir, "smoke-input-module");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "Smoke Input", description: "Has a button" })
	);
	fs.writeFileSync(
		path.join(dir, "input.json"),
		JSON.stringify({
			controls: [
				{ key: "tap", type: "button", label: "Tap" },
				{ key: "amount", type: "number", label: "Amount" }
			]
		})
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		`module.exports = async function (config, richness, omni) {
	const data = omni.storage.read();
	return {
		title: "Smoke Input",
		content: [{ type: "text", value: String((data.entries || []).length) }],
		updated: new Date().toISOString()
	};
};

module.exports.onInput = async function (payload, omni) {
	const data = omni.storage.read();
	const entries = data.entries || [];
	entries.push({ key: payload.key, value: payload.value === undefined ? 1 : payload.value });
	omni.storage.write({ entries });
};
`
	);

	// Two instances of it on one face, which is the case the Inport
	// model exists for: they share one port and are told apart by path.
	const face = faceStore.createFace("Inport Face", "", "windows8", [
		{ module: "smoke-input-module", config: {} },
		{ module: "smoke-input-module", config: {} }
	]);

	await startInputFace(face);

	const port = faceStore.inportFor(face.id);
	await waitForPort(port);

	// The port is arithmetic, not allocated -- 4001 pairs with 2001 and
	// nothing had to remember that.
	assert.equal(port, faceStore.inportFor(face.id), "inport must be stable");
	assert.equal(
		faceStore.faceIdFromPort(port),
		faceStore.faceIdFromPort(face.id),
		"a face's two ports must share an id"
	);

	const stored = faceStore.findFace(face.id);
	const [first, second] = stored.instances;

	// Two of them, so the root offers a choice rather than guessing
	const root = await (await fetch(`http://127.0.0.1:${port}/`)).text();
	assert.ok(root.includes(first.id), "the picker should link the first instance");
	assert.ok(root.includes(second.id), "the picker should link the second instance");

	// One instance's own page
	const page = await (await fetch(`http://127.0.0.1:${port}/${first.id}`)).text();
	assert.ok(page.includes("Tap"), "the button did not render");
	assert.ok(page.includes('type="number"'), "the number field did not render");

	// A button press carries no value; a number press carries one.
	await fetch(`http://127.0.0.1:${port}/${first.id}/input`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key: "tap" })
	});

	await fetch(`http://127.0.0.1:${port}/${first.id}/input`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key: "amount", value: 20.5 })
	});

	// And one for the OTHER instance, on the same port -- if paths
	// weren't genuinely routing these apart, this would land in the
	// first instance's storage instead of its own.
	await fetch(`http://127.0.0.1:${port}/${second.id}/input`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key: "tap" })
	});

	const firstData = moduleStorage.readInstanceData(face.id, first.id);
	const secondData = moduleStorage.readInstanceData(face.id, second.id);

	assert.equal(firstData.entries.length, 2, "both inputs should have persisted");
	assert.equal(firstData.entries[0].value, 1, "a tap should record 1");
	assert.equal(firstData.entries[1].value, 20.5, "a decimal amount should survive");
	assert.equal(
		secondData.entries.length,
		1,
		"the other instance should have its own separate storage"
	);

	stopInputFace(face.id);
});

test("inport: only listens when the face has something taking input", async () => {
	// A face of display-only modules has no reason to hold an open,
	// unauthenticated port waiting for input that can never arrive.
	const face = faceStore.createFace("Quiet Face", "", "windows8", [
		{ module: "weather", config: {} }
	]);

	await startInputFace(face);

	const port = faceStore.inportFor(face.id);
	const reachable = await fetch(`http://127.0.0.1:${port}/`)
		.then(() => true)
		.catch(() => false);

	assert.equal(reachable, false, "a face with no input should not be listening");

	// Adding the first input-capable module is what opens it -- this is
	// the case that would otherwise need a restart to take effect.
	faceStore.addInstance(face.id, "smoke-input-module", "", {}, {});
	await refreshInputFace(faceStore.findFace(face.id));
	await waitForPort(port);

	const nowReachable = await fetch(`http://127.0.0.1:${port}/`)
		.then((response) => response.status === 200)
		.catch(() => false);

	assert.equal(nowReachable, true, "adding an input module should open the inport");

	stopInputFace(face.id);
});