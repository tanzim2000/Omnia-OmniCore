// test/dev-build.test.js
// What a development build and a face's number look like (v1.19.4).
//
// A dev build (npm start from a clone) isn't a release, so it shows the
// version the source says it is, with a `dev` badge, and its Updates page
// leaves out everything about checking for updates. A face is numbered by
// its ID ("Face 001"), not by its port ("4001").

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");

const { resetState, waitForPort, signIn } = helpers;
const omnicoreVersion = require("../core/version");
const faceStore = require("../core/face-store");
const coreUpdater = require("../core/core-updater");
const { versionHtml } = require("../core/ui-theme");
const sourceVersion = require("../package.json").version;

const fs = require("fs");
const path = require("path");

const PORT = 3000;
let cookie;

// A small stand-in theme for the face these tests make, removed after
const themeDir = path.join(helpers.themesDir, "dev-build-test-theme");
test.after(() => fs.rmSync(themeDir, { recursive: true, force: true }));

// Runs with OMNICORE_VERSION set to `version` (or not set at all for
// undefined), and puts it back. Assigning undefined to an environment
// variable stores the text "undefined", so unset has to be a delete.
async function withVersion(version, run) {
	const original = process.env.OMNICORE_VERSION;

	if (version === undefined) {
		delete process.env.OMNICORE_VERSION;
	} else {
		process.env.OMNICORE_VERSION = version;
	}

	try {
		await run();
	} finally {
		if (original === undefined) {
			delete process.env.OMNICORE_VERSION;
		} else {
			process.env.OMNICORE_VERSION = original;
		}
	}
}

async function get(path) {
	const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
		headers: { cookie }
	});

	return { status: response.status, html: await response.text() };
}

// --- The version, as shown ---------------------------------------------

test("version: a dev build shows the source's version and is marked dev", () =>
	withVersion(undefined, () => {
		assert.deepEqual(omnicoreVersion.displayVersion(), { number: sourceVersion, dev: true });
		assert.equal(versionHtml(), `${sourceVersion} <span class="badge">dev</span>`);

		// Showing a number must not turn it into something comparable
		assert.equal(omnicoreVersion.isDevBuild(), true);
		assert.equal(omnicoreVersion.comparableVersion(), null);
	}));

test("version: a release shows its own number and no badge", () =>
	withVersion("v1.19.3", () => {
		assert.deepEqual(omnicoreVersion.displayVersion(), { number: "1.19.3", dev: false });
		assert.equal(versionHtml(), "1.19.3");
	}));

test("changelog: an entry is cut out between its heading and the next", () => {
	const raw = "# Changelog\n\n## v2.0.0\n\nNew thing\n\n### Fixed\n\n- A bug\n\n## v1.9.0\n\nOlder\n";

	assert.equal(coreUpdater.changelogEntry(raw, "v2.0.0"), "New thing\n\n### Fixed\n\n- A bug");
	assert.equal(coreUpdater.changelogEntry(raw, "2.0.0"), "New thing\n\n### Fixed\n\n- A bug");
	assert.equal(coreUpdater.changelogEntry(raw, "3.0.0"), null);

	// A capital Z used to end an entry early, and the oldest entry (with
	// no heading after it) used to never match
	const zs = "## v2.0.0\n\nZebra notes and Zones\n\n## v1.0.0\n\nOldest, by Zed\n";
	assert.equal(coreUpdater.changelogEntry(zs, "2.0.0"), "Zebra notes and Zones");
	assert.equal(coreUpdater.changelogEntry(zs, "1.0.0"), "Oldest, by Zed");

	// The real file has an entry for the version the source claims to be
	assert.ok(coreUpdater.localChangelogEntry(sourceVersion), "this version's own notes");
	assert.equal(coreUpdater.localChangelogEntry("0.0.1"), null);
});

// --- Face numbers --------------------------------------------------------

test("faces: a face is numbered by its ID, three digits", () => {
	assert.equal(faceStore.faceNumber(4001), "001");
	assert.equal(faceStore.faceNumber(4012), "012");
	assert.equal(faceStore.faceNumber(4123), "123");
	assert.equal(faceStore.faceNumber(4999), "999");
	assert.equal(faceStore.defaultFaceName(4001), "Face 001");
});

test("faces: the old automatic name is shown as the new one, a chosen name is kept", () => {
	// Before v1.19.4 an unnamed face was saved as its port
	assert.equal(faceStore.faceLabel({ id: 4001, name: "Face 4001" }), "Face 001");
	assert.equal(faceStore.faceLabel({ id: 4003, name: "" }), "Face 003");
	assert.equal(faceStore.faceLabel({ id: 4003 }), "Face 003");

	// Someone's own name is never touched, even one that looks similar
	assert.equal(faceStore.faceLabel({ id: 4001, name: "Kitchen" }), "Kitchen");
	assert.equal(faceStore.faceLabel({ id: 4001, name: "Face 4002" }), "Face 4002");
	assert.equal(faceStore.faceLabel({ id: 4001, name: "Face 001" }), "Face 001");
});

test("faces: new faces start as Face 001, 002, and blank goes back to it", () => {
	resetState();

	const first = faceStore.createFace("", "", null, []);
	const second = faceStore.createFace("   ", "", null, []);

	assert.equal(first.name, "Face 001");
	assert.equal(second.name, "Face 002");

	faceStore.updateFace(second.id, { name: "Hall" });
	assert.equal(faceStore.findFace(second.id).name, "Hall");

	faceStore.updateFace(second.id, { name: "  " });
	assert.equal(faceStore.findFace(second.id).name, "Face 002");
});

test("faces: the ports line names the Outport, and the Inport only when it listens", () => {
	// No modules: nothing takes input
	assert.equal(faceStore.portsLine({ id: 4001, instances: [] }), "Outport 4001");
});

// --- The pages ---------------------------------------------------------------

test("dev build: boots signed in, with a face saved the old way", async () => {
	resetState();

	// A face made before v1.19.4, named after its port, on a small
	// stand-in theme (the face page needs one to name)
	fs.mkdirSync(themeDir, { recursive: true });
	fs.writeFileSync(path.join(themeDir, "index.html"), "<html><body></body></html>");
	fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({ name: "Test theme" }));
	fs.mkdirSync(helpers.dataDir, { recursive: true });
	fs.writeFileSync(
		path.join(helpers.dataDir, "faces.json"),
		JSON.stringify({ faces: [{ id: 4001, name: "Face 4001", title: "", theme: "dev-build-test-theme", themeConfigs: {}, themeStates: {}, instances: [] }] })
	);

	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("faces: the pages say Face 001 and Outport 4001, never Face 4001", async () => {
	const list = await get("/faces");
	assert.ok(list.html.includes("<strong>Face 001</strong>"));
	assert.ok(list.html.includes("Outport 4001 · 0 modules"));
	assert.ok(!list.html.includes("Face 4001"));

	const page = await get("/faces/4001");
	assert.ok(page.html.includes("<h1>Face 001</h1>"));
	assert.ok(page.html.includes("Outport 4001"));
	assert.ok(!page.html.includes("Running on port"));
	assert.ok(page.html.includes('id="name" value="Face 001"'));
	assert.match(page.html, /Blank falls back to\s+Face 001\./);
	assert.ok(!page.html.includes("Face 4001"));

	// The saved record itself was not rewritten by looking at it
	assert.equal(faceStore.findFace(4001).name, "Face 4001");
});

test("dev build: Settings and Updates show the version with a dev badge", () =>
	withVersion(undefined, async () => {
		const settings = await get("/");
		assert.ok(settings.html.includes(`OmniCore ${sourceVersion} <span class="badge">dev</span>`));

		const updates = await get("/updates");
		assert.equal(updates.status, 200);
		assert.ok(updates.html.includes(`OmniCore ${sourceVersion} <span class="badge">dev</span>`));
	}));

test("dev build: the Updates page has nothing about checking, and shows this build's notes", () =>
	withVersion(undefined, async () => {
		const { html } = await get("/updates");

		// Looked for as page text and markup, not as bare words: the
		// shared stylesheet mentions "Check now" in a comment
		for (const gone of ["Last checked:", "Running since:", "No check has run yet", 'id="check"', ">Check now<", 'id="apply"', "Development build"]) {
			assert.ok(!html.includes(gone), `${gone} should not be on a dev build's page`);
		}

		// What's in this build, from its own CHANGELOG.md
		assert.ok(html.includes(`What's in ${sourceVersion}`));
		assert.ok(html.includes('<div class="changelog">'), "the notes themselves");
		assert.ok(!html.includes("has no notes for its version"), "not the fallback line");
		assert.ok(!html.includes("What's in dev"));
	}));

test("release: the Updates page is unchanged, and has no badge", () =>
	withVersion("v1.19.3", async () => {
		const settings = await get("/");
		assert.ok(settings.html.includes("OmniCore 1.19.3"));
		assert.ok(!settings.html.includes('<span class="badge">'));

		const { html } = await get("/updates");
		assert.ok(html.includes("OmniCore 1.19.3"));
		assert.ok(html.includes("Last checked:") && html.includes("Running since:"));
		assert.ok(html.includes('id="check"'));
		assert.ok(!html.includes('<span class="badge">'));
	}));