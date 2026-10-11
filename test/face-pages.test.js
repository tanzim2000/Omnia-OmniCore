// test/face-pages.test.js
// The v1.19.5 page changes: a face's page, the faces list, the Updates
// page's layout, and the About page's pill.
//
//   - A face with no theme opens its page instead of crashing it
//   - A face's page lists its facts: its number, its Outport, how many
//     screens are showing it, its Inport and that Inport's branches
//   - "Showing on" really counts the screens connected to the face
//   - The faces list has no segment around its heading or its button
//   - A development build's Updates page is one column; a release's isn't
//   - A development build's About page says so where "All systems
//     healthy" would be, and its version card shows only the number

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir } = helpers;
const faceStore = require("../core/face-store");
const { startFace } = require("../core/face-loader");
const sourceVersion = require("../package.json").version;

const ADMIN = 3000;
const ABOUT = 1303;
let cookie;

// Runs with OMNICORE_VERSION set to `version`, or unset for undefined
// (a development build), and puts it back afterwards
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

async function get(port, address) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, {
		headers: { cookie }
	});

	return { status: response.status, html: await response.text() };
}

// A module that takes input (it has an input.json), so a face holding it
// has an Inport. Nothing published declares one yet, so it's written here.
function writeInputModule() {
	const dir = path.join(modulesDir, "face-pages-input");

	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ name: "Input", description: "Has a button" }));
	fs.writeFileSync(
		path.join(dir, "input.json"),
		JSON.stringify({ controls: [{ key: "tap", type: "button", label: "Tap" }] })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		'module.exports = async function () { return { title: "Input", content: [] }; };\n'
	);
}

test("boots signed in, with a face that has no theme and one that takes input", async () => {
	resetState();
	writeInputModule();

	// 4001: no theme at all, the face that used to crash its page
	faceStore.createFace("", "", null, []);

	// 4002: two instances that take input, so its Inport has two branches
	faceStore.createFace("", "", null, [
		{ module: "face-pages-input", config: {} },
		{ module: "face-pages-input", config: {} }
	]);

	require("../core/admin-face")();
	require("../core/about-face")();
	await waitForPort(ADMIN);
	await waitForPort(ABOUT);
	cookie = await signIn(ADMIN);
});

// --- A face with no theme ---------------------------------------------------

test("no theme: the face's page opens and says there's no theme", async () => {
	const { status, html } = await get(ADMIN, "/faces/4001");

	assert.equal(status, 200, "the page opens rather than crashing");
	assert.ok(html.includes("<h1>Face 001</h1>"));
	assert.match(html, /<strong>Theme<\/strong>\s*<span>No theme<\/span>/);
});

test("no theme: its theme page offers to choose one, and saving theme settings is refused", async () => {
	const page = await get(ADMIN, "/faces/4001/theme");
	assert.equal(page.status, 200);
	assert.ok(page.html.includes("Choose a theme"));
	assert.ok(page.html.includes("hasn't been given a theme yet"));

	const save = await fetch(`http://127.0.0.1:${ADMIN}/faces/4001/theme`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: "{}"
	});
	assert.equal(save.status, 409);

	// Nothing was stored under a theme called "null"
	assert.deepEqual(faceStore.findFace(4001).themeConfigs, {});
});

// --- A face's facts ---------------------------------------------------------

// The label and value of each fact on a face's page, in order
function factsOf(html) {
	return [...html.matchAll(/<span class="fact-label">([^<]*)<\/span>\s*<span class="fact-value"[^>]*>([^<]*)<\/span>/g)].map(
		(match) => [match[1], match[2]]
	);
}

test("facts: a face with nothing taking input has no Inport", async () => {
	const { html } = await get(ADMIN, "/faces/4001");

	assert.deepEqual(factsOf(html), [
		["Face ID", "001"],
		["Outport", "4001"],
		["Showing on", "No screens right now"],
		["Inport", "None"]
	]);
});

test("facts: a face with two modules taking input has an Inport with two branches", async () => {
	const { html } = await get(ADMIN, "/faces/4002");

	assert.deepEqual(factsOf(html), [
		["Face ID", "002"],
		["Outport", "4002"],
		["Showing on", "No screens right now"],
		["Inport", "2002"],
		["Inport branches", "2"]
	]);
});

test("facts: the facts and the Modules / Theme links are two segments", async () => {
	const { html } = await get(ADMIN, "/faces/4001");

	// One column holding both, beside the name form
	assert.match(html, /<div class="bento-column">\s*<div class="segment">\s*<h1>Face 001<\/h1>\s*<div class="facts">/);
	assert.match(html, /<\/div>\s*<\/div>\s*<div class="segment">\s*<a class="row" href="\/faces\/4001\/modules">/);
});

test("showing on: counts the screens that have the face open, live", async () => {
	const face = faceStore.findFace(4001);
	await startFace(face);
	await waitForPort(4001);

	const count = async () =>
		(await (await fetch(`http://127.0.0.1:${ADMIN}/faces/4001/displays`, { headers: { cookie } })).json()).count;

	assert.equal(await count(), 0);

	// A screen showing the face holds its /events stream open. Two of them:
	const screens = [new AbortController(), new AbortController()];
	for (const screen of screens) {
		await fetch("http://127.0.0.1:4001/events", { signal: screen.signal });
	}

	assert.equal(await count(), 2);

	const page = await get(ADMIN, "/faces/4001");
	assert.ok(factsOf(page.html).some(([label, value]) => label === "Showing on" && value === "2 screens"));

	// A screen going away drops out of the count
	screens[0].abort();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(await count(), 1);

	screens[1].abort();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(await count(), 0);
});

test("showing on: the no-theme screen connects too, so it's counted", async () => {
	// What a display on 4001 shows right now, with no theme
	const html = await (await fetch("http://127.0.0.1:4001/")).text();

	assert.ok(html.includes("Please select a theme") || html.includes("No Theme available."));
	assert.ok(html.includes('new EventSource('), "the screen opens the live connection");
});

// --- The faces list ---------------------------------------------------------

test("faces list: heading on the page, the list, and the button where the capsule goes", async () => {
	const { html } = await get(ADMIN, "/faces");

	assert.match(html, /<div class="settings-head">\s*<h1>Faces<\/h1>/);
	assert.match(html, /<div class="bento">\s*<div class="list">/);
	assert.match(html, /<div class="page-dock">\s*<button class="glass dock-button" onclick="goToWizard\(\)">\s*Create a new face/);

	// No segment around either of them any more
	assert.ok(!html.includes('<div class="segment">'), "no segments on this page");
});

// --- The Updates page -------------------------------------------------------

test("updates: a development build stacks its segments, whatever the screen", () =>
	withVersion(undefined, async () => {
		const { html } = await get(ADMIN, "/updates");

		assert.ok(html.includes('<div class="bento-row">'), "one column");
		assert.ok(!/bento-row (two|three)/.test(html.replace(/\/\*[\s\S]*?\*\//g, "").split("<body")[1]), "never side by side");
	}));

test("updates: a release keeps its segments side by side", () =>
	withVersion("v1.19.3", async () => {
		const { html } = await get(ADMIN, "/updates");

		assert.ok(html.includes('<div class="bento-row two top">'));
	}));

test("updates: the notes scroll inside their segment", async () => {
	const { html } = await get(ADMIN, "/updates");
	const rule = html.match(/\.changelog \{([^}]*)\}/);

	assert.ok(rule, "the notes have a rule of their own");
	assert.match(rule[1], /overflow-y: auto/);
	assert.match(rule[1], /max-height:/);
});

// --- The About page ---------------------------------------------------------

test("about: a development build says so in place of All systems healthy", () =>
	withVersion(undefined, async () => {
		const { html } = await get(ABOUT, "/");

		assert.ok(html.includes("Development build"));
		assert.ok(!html.includes("All systems healthy"));

		// The version card: the number alone, the dev mark already said above
		assert.ok(html.includes(`<div class="card-value">${sourceVersion}</div>`));
		assert.ok(!html.includes('<span class="badge">dev</span>'));
	}));

test("about: a release still says All systems healthy", () =>
	withVersion("v1.19.3", async () => {
		const { html } = await get(ABOUT, "/");

		assert.ok(html.includes("All systems healthy"));
		assert.ok(!html.includes("Development build"));
		assert.ok(html.includes('<div class="card-value">1.19.3</div>'));
	}));
