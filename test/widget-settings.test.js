// test/widget-settings.test.js
// A widget's page, as v1.19.8 draws it.
//
//   - Labels that follow the widget's settings: a module can suggest one
//     (module.exports.label), the label the user types wins, and clearing
//     it goes back to the suggestion. With no suggestion, the module's name.
//   - The refresh setting (refreshMinutes): spotted by Core, drawn in a box
//     of its own with "minutes" beside it, and never under a minute.
//   - A number setting with a "unit" gets it beside the box.
//
// The modules here are written by the test, so nothing depends on what's
// published, and no location needs the network: the one location used is
// typed in by hand ("Set coordinates here").

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir, themesDir } = helpers;
const faceStore = require("../core/face-store");
const moduleConfig = require("../core/module-config");
const instanceLabel = require("../core/instance-label");
const { startFace } = require("../core/face-loader");

const ADMIN = 3000;
const WIZARD = 3999;
let cookie;

// A module that suggests its own label: "Near <place>", or the location's
// name, or nothing. It has a refresh setting and a number with a unit.
const SUGGESTS = "ws-suggests";
// One that suggests nothing: it's called by its name
const PLAIN = "ws-plain";
// One whose label function throws: it's called by its name too
const BROKEN = "ws-broken";
// A theme with something to set per widget, so the page has two columns
const THEME = "ws-theme";

function writeModule(id, manifest, settings, code) {
	const dir = path.join(modulesDir, id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest));
	fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ settings }));
	fs.writeFileSync(path.join(dir, "index.js"), code);
}

function writeFixtures() {
	writeModule(
		SUGGESTS,
		{ name: "Suggests", description: "Names itself" },
		[
			{ key: "place", type: "text", label: "Place" },
			{ key: "where", type: "location", label: "Where" },
			{ key: "distance", type: "number", label: "Distance", unit: "km", default: 5 },
			{ key: "refreshMinutes", type: "number", label: "Every so often", default: 15, help: "Picked by the module" }
		],
		`module.exports = async function () { return { title: "From the tile", content: [] }; };
module.exports.label = function (config) {
	if (config.place) return "Near " + config.place + "\\n  ";
	if (config.where && config.where.label) return config.where.label;
	return "";
};
`
	);

	writeModule(
		PLAIN,
		{ name: "Plain", description: "No suggestion" },
		[{ key: "refreshMinutes", type: "number", default: 0 }],
		'module.exports = async function () { return { content: [] }; };\n'
	);

	writeModule(
		BROKEN,
		{ name: "Broken label", description: "Throws" },
		[],
		`module.exports = async function () { return { content: [] }; };
module.exports.label = function () { throw new Error("nope"); };
`
	);

	const themeDir = path.join(themesDir, THEME);
	fs.mkdirSync(themeDir, { recursive: true });
	fs.writeFileSync(path.join(themeDir, "index.html"), "<html><body></body></html>");
	fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({ name: "WS Theme" }));
	fs.writeFileSync(
		path.join(themeDir, "instance-settings.json"),
		JSON.stringify({ settings: [{ key: "size", type: "select", label: "Tile size", options: ["Small", "Large"], default: "Small" }] })
	);
}

test.after(() => {
	for (const id of [SUGGESTS, PLAIN, BROKEN]) {
		fs.rmSync(path.join(modulesDir, id), { recursive: true, force: true });
	}
	fs.rmSync(path.join(themesDir, THEME), { recursive: true, force: true });
});

async function get(port, address) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, { headers: { cookie } });
	return { status: response.status, html: await response.text() };
}

async function post(address, body) {
	const response = await fetch(`http://127.0.0.1:${ADMIN}${address}`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	return { status: response.status, json: await response.json() };
}

// 4001 has the theme (two columns); 4002 has none (one column)
let withTheme;
let noTheme;

test("boots signed in, with a face that has a theme and one that hasn't", async () => {
	resetState();
	writeFixtures();

	withTheme = faceStore.createFace("", "", THEME, []);
	noTheme = faceStore.createFace("", "", null, []);

	require("../core/admin-face")();
	require("../core/wizard-face")();
	await waitForPort(ADMIN);
	await waitForPort(WIZARD);
	cookie = await signIn(ADMIN);
});

// --- Labels ------------------------------------------------------------------

test("labels: a widget added from its face's page has no label of its own", async () => {
	const added = await post(`/faces/${withTheme.id}/modules`, { module: SUGGESTS });
	assert.equal(added.status, 200);

	const instance = faceStore.findFace(withTheme.id).instances[0];
	assert.equal(instance.label, "", "nothing stored: it follows its settings");
});

test("labels: with nothing typed, the module's suggestion names it everywhere", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	faceStore.updateInstance(withTheme.id, instance.id, { config: { place: "the lake" } });

	const page = await get(ADMIN, `/faces/${withTheme.id}/modules/${instance.id}`);
	assert.equal(page.status, 200);

	// Tidied: one line, no trailing spaces
	assert.ok(page.html.includes("<h1>Near the lake</h1>"));
	assert.match(page.html, /<input type="text" id="label" value=""\s*placeholder="Near the lake">/);
	assert.ok(page.html.includes("which follows this widget&#39;s settings") || page.html.includes("which follows this widget's settings"));

	const list = await get(ADMIN, `/faces/${withTheme.id}/modules`);
	assert.ok(list.html.includes("<strong>Near the lake</strong>"));
});

test("labels: the location's name comes through for a module to use", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	faceStore.updateInstance(withTheme.id, instance.id, {
		config: { where: { mode: "manual", latitude: 50.45, longitude: -104.6, label: "Regina" } }
	});

	assert.equal(await instanceLabel.labelFor(faceStore.findFace(withTheme.id).instances[0]), "Regina");
});

test("labels: the tile's title follows too, ahead of the tile's own", async () => {
	const face = faceStore.findFace(withTheme.id);
	await startFace(face);
	await waitForPort(face.id);

	const instance = face.instances[0];
	const tile = await (await fetch(`http://127.0.0.1:${face.id}/api/${instance.id}`)).json();
	assert.equal(tile.title, "Regina");
});

test("labels: one typed by the user wins, and clearing it follows the settings again", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	const base = `/faces/${withTheme.id}/modules/${instance.id}`;

	await post(base, { label: "Mine", config: {}, themeConfig: {} });
	const typed = await get(ADMIN, base);
	assert.ok(typed.html.includes("<h1>Mine</h1>"));
	assert.match(typed.html, /id="label" value="Mine"/);

	const tile = await (await fetch(`http://127.0.0.1:${withTheme.id}/api/${instance.id}`)).json();
	assert.equal(tile.title, "Mine");

	await post(base, { label: "  ", config: { place: "the hills" }, themeConfig: {} });
	const cleared = await get(ADMIN, base);
	assert.ok(cleared.html.includes("<h1>Near the hills</h1>"), "spaces alone are no label");
});

test("labels: a module that suggests nothing, or fails to, is called by its name", async () => {
	const plain = await post(`/faces/${noTheme.id}/modules`, { module: PLAIN });
	const broken = await post(`/faces/${noTheme.id}/modules`, { module: BROKEN });
	assert.equal(plain.status, 200);
	assert.equal(broken.status, 200);

	const [first, second] = faceStore.findFace(noTheme.id).instances;

	const plainPage = await get(ADMIN, `/faces/${noTheme.id}/modules/${first.id}`);
	assert.ok(plainPage.html.includes("<h1>Plain</h1>"));
	assert.ok(plainPage.html.includes('placeholder="Plain"'));
	assert.ok(!plainPage.html.includes("which follows this widget"), "nothing to follow, so it doesn't say so");

	const brokenPage = await get(ADMIN, `/faces/${noTheme.id}/modules/${second.id}`);
	assert.equal(brokenPage.status, 200, "a throwing label costs nothing but the suggestion");
	assert.ok(brokenPage.html.includes("<h1>Broken label</h1>"));
});

test("labels: a suggestion is kept to one short line", async () => {
	const instance = { module: SUGGESTS, label: "", config: { place: "x".repeat(200) } };
	const label = await instanceLabel.labelFor(instance);

	assert.equal(Array.from(label).length, instanceLabel.SUGGESTION_LONGEST);
	assert.ok(!/\n/.test(label));
});

// --- The Refresh box ---------------------------------------------------------

// The HTML of the segment that starts with <h2>name</h2>, up to the next
// segment
function segmentNamed(html, name) {
	const at = html.indexOf(`<h2>${name}</h2>`);
	if (at === -1) return null;
	const start = html.lastIndexOf('<div class="segment', at);
	const next = html.indexOf('<div class="segment', at);
	return html.slice(start, next === -1 ? undefined : next);
}

test("refresh: its own box, worded by Core, with minutes beside it and a floor", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	const { html } = await get(ADMIN, `/faces/${withTheme.id}/modules/${instance.id}`);

	const box = segmentNamed(html, "Refresh");
	assert.ok(box, "a Refresh box");
	assert.ok(box.includes('class="segment refresh-segment"'));
	assert.ok(box.includes("<label>Refresh every</label>"), "Core's wording, not the module's");
	assert.ok(!html.includes("Every so often"));
	assert.match(box, /<div class="unit-row"><input type="number" data-key="refreshMinutes" data-scope="module" data-type="number" min="1" value="15"><span class="unit">minutes<\/span><\/div>/);
	assert.ok(box.includes("Picked by the module"), "the module's own help line stays");

	// And not among the module's settings
	const settings = segmentNamed(html, "Settings") || html.slice(html.indexOf("Settings</h2>"), html.indexOf("refresh-segment"));
	assert.ok(!settings.includes('data-key="refreshMinutes"'));
});

test("refresh: under the theme's box when there is one, columns level", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	const { html } = await get(ADMIN, `/faces/${withTheme.id}/modules/${instance.id}`);

	assert.ok(html.includes('<div class="bento-row two face-columns">'));
	assert.match(
		html,
		/<div class="bento-column"><div class="segment">\s*<h2>In WS Theme<\/h2>[\s\S]*?<\/div>\s*<div class="segment refresh-segment">/
	);
});

test("refresh: under the module's settings when there's no theme box", async () => {
	const instance = faceStore.findFace(noTheme.id).instances[0];
	const { html } = await get(ADMIN, `/faces/${noTheme.id}/modules/${instance.id}`);

	assert.ok(html.includes('<div class="bento-row top">'));
	assert.ok(!html.includes('<div class="bento-row two face-columns">'), "one column");
	assert.ok(html.indexOf("<h2 style=\"margin-bottom:14px\">Settings</h2>") < html.indexOf("refresh-segment"));
	// The only setting it had was refresh, so the Settings box says so
	assert.ok(html.includes("This module has nothing else to configure."));
});

test("refresh: under a minute isn't saved, and isn't handed to the module", () => {
	const field = { key: "refreshMinutes", type: "number", default: 15 };

	// Saving: anything under a minute is left out, so the default applies
	for (const bad of ["0", "-5", "0.5", "", "abc", null]) {
		const clean = moduleConfig.cleanConfig(SUGGESTS, { refreshMinutes: bad });
		assert.ok(!("refreshMinutes" in clean), JSON.stringify(bad));
	}
	assert.equal(moduleConfig.cleanConfig(SUGGESTS, { refreshMinutes: "5" }).refreshMinutes, 5);
	assert.equal(moduleConfig.cleanConfig(SUGGESTS, { refreshMinutes: "1" }).refreshMinutes, 1);

	// Running: a value saved before v1.19.8 becomes the default...
	assert.equal(moduleConfig.applyDefaults(SUGGESTS, { refreshMinutes: 0 }).refreshMinutes, 15);
	// ...and a module whose own default is under a minute gets the floor
	assert.equal(moduleConfig.applyDefaults(PLAIN, {}).refreshMinutes, moduleConfig.REFRESH_FLOOR);

	// Only refreshMinutes: another number can be 0
	assert.equal(moduleConfig.cleanConfig(SUGGESTS, { distance: "0" }).distance, 0);
	assert.equal(moduleConfig.isRefreshField(field), true);
	assert.equal(moduleConfig.isRefreshField({ key: "refreshMinutes", type: "text" }), false);
});

// --- A number with a unit ----------------------------------------------------

test("unit: a number setting with a unit has it beside the box", async () => {
	const instance = faceStore.findFace(withTheme.id).instances[0];
	const { html } = await get(ADMIN, `/faces/${withTheme.id}/modules/${instance.id}`);

	assert.match(html, /<div class="unit-row"><input type="number" data-key="distance"[^>]*><span class="unit">km<\/span><\/div>/);
	assert.ok(!/data-key="distance"[^>]*min="1"/.test(html), "the floor is only for refresh");
});

test("unit: the setup wizard draws refresh and units the same way", async () => {
	const { html } = await get(WIZARD, "/faces/new");

	assert.ok(html.includes('field.key === "refreshMinutes"'), "spots the refresh setting");
	assert.ok(html.includes('label: "Refresh every", unit: "minutes"'));
	assert.ok(html.includes('\' min="1"\''));
	assert.ok(html.includes('<div class="unit-row">'));
	assert.ok(html.includes('label: "",'), "a new widget starts with no label of its own");
});
