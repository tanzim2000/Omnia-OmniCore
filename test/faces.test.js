// test/faces.test.js
// The faces themselves: creating one through the wizard, rendering it,
// the welcome face's three cases, and what happens when a module
// throws.

const test = require("node:test");
const assert = require("node:assert");


const faceStore = require("../core/face-store");
const { startFace, refresh } = require("../core/face-loader");
const { startInputFace, stopInputFace } = require("../core/input-face-loader");
const moduleStorage = require("../core/module-storage");
const {
	resetState,
	waitForPort,
	writeFailingModule
} = require("./helpers");

const WELCOME_PORT = 4000;
const WIZARD_PORT = 3999;

// Running the whole suite in order leaves these already installed by
// the marketplace tests. Installing them here too means this file can
// also be run on its own, which matters when chasing one failure --
// installEntry with update=true is a no-op-ish overwrite, not an error,
// when something is already there.
test("faces: the modules these tests need are installed", async () => {
	const marketplace = require("../core/marketplace");

	for (const [kind, id] of [["module", "weather"], ["theme", "windows8"]]) {
		if (!require("fs").existsSync(
			require("path").join(__dirname, "..", kind === "theme" ? "themes" : "modules", id)
		)) {
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

test("input face: a tap reaches the module and persists", async () => {
	const fs = require("fs");
	const path = require("path");
	const { modulesDir } = require("./helpers");

	// A module with an input face, written here rather than pulled from
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

	const instance = {
		id: "smoke-input-module-test",
		module: "smoke-input-module",
		label: "Smoke Input",
		inputPort: 5001
	};

	await startInputFace(4001, instance);
	await waitForPort(5001);

	const page = await (await fetch("http://127.0.0.1:5001/")).text();
	assert.ok(page.includes("Tap"), "the button did not render");
	assert.ok(page.includes('type="number"'), "the number field did not render");

	// A button press carries no value; a number press carries one.
	await fetch("http://127.0.0.1:5001/input", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key: "tap" })
	});

	await fetch("http://127.0.0.1:5001/input", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key: "amount", value: 20.5 })
	});

	const stored = moduleStorage.readInstanceData(4001, instance.id);

	assert.equal(stored.entries.length, 2, "both inputs should have persisted");
	assert.equal(stored.entries[0].value, 1, "a tap should record 1");
	assert.equal(stored.entries[1].value, 20.5, "a decimal amount should survive");

	stopInputFace(5001);
});