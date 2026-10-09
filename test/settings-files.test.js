// test/settings-files.test.js
// A module's or a theme's settings files are somebody else's JSON. One
// bad entry in them -- a stray null, a number, a field with no key -- must
// cost that entry and nothing else: the settings pages still open, the
// tile still renders, and the rest of the fields still work.
//
// Also here: a field that depends on a checkbox (showWhen with
// { equals: true }), which needs the checkbox's ticked state rather than
// its value.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir, themesDir } = helpers;
const moduleConfig = require("../core/module-config");
const themeLoader = require("../core/theme-loader");
const faceStore = require("../core/face-store");
const { startFace } = require("../core/face-loader");

const ADMIN_PORT = 3000;

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, "\t"));
}

// A module whose files have one of every kind of bad entry, between good
// ones
function writeMessyModule() {
	const dir = path.join(modulesDir, "messy");

	writeJson(path.join(dir, "module.json"), { name: "Messy", provides: ["text"] });

	writeJson(path.join(dir, "settings.json"), {
		settings: [
			null,
			7,
			["a", "list"],
			{ label: "No key at all", type: "text" },
			{ key: "", label: "An empty key", type: "text" },
			{ key: "mode", label: "Mode", type: "select", options: ["a", null, { x: 1 }, "b", 3], default: "a" },
			{ key: "order", label: "Order", type: "priority", options: "not a list" },
			{ key: "on", label: "Turned on", type: "boolean", default: false },
			{ key: "detail", label: "Only when on", type: "text", default: "", showWhen: { key: "on", equals: true } },
			{ key: "loose", label: "A showWhen that names nothing", type: "text", default: "", showWhen: "on" },
			{ key: "never", label: "A showWhen with nothing to compare", type: "text", default: "", showWhen: { key: "on" } }
		]
	});

	writeJson(path.join(dir, "input.json"), {
		controls: [null, { key: "go", type: "button", label: "Go" }]
	});

	fs.writeFileSync(
		path.join(dir, "index.js"),
		`module.exports = async function (config) {
			return { title: "Messy", content: [{ type: "text", value: JSON.stringify(config) }] };
		};`
	);
}

function writeMessyTheme() {
	const dir = path.join(themesDir, "messytheme");

	writeJson(path.join(dir, "theme.json"), { name: "Messy Theme" });
	writeJson(path.join(dir, "settings.json"), {
		settings: [null, { key: "accent", label: "Accent", type: "text", default: "red" }]
	});
	writeJson(path.join(dir, "instance-settings.json"), {
		settings: [
			null,
			{ key: "size", label: "Size", type: "select", options: ["small", null, "large"], default: "small" }
		]
	});
	fs.writeFileSync(path.join(dir, "index.html"), "<html><body>messy</body></html>");
}

let face;
let instanceId;
let cookie;

test("setup: fixtures are written", async () => {
	resetState();
	writeMessyModule();
	writeMessyTheme();

	face = faceStore.createFace("Messy Face", "", "messytheme", [
		{ module: "messy", config: {} }
	]);
	instanceId = faceStore.findFace(face.id).instances[0].id;
	await startFace(face);
});

test("settings.json: bad entries are dropped, good ones kept and tidied", () => {
	const fields = moduleConfig.readSchema("messy");

	assert.deepEqual(
		fields.map((field) => field.key),
		["mode", "order", "on", "detail", "loose", "never"],
		"null, a number, a list, no key and an empty key are all gone"
	);

	const mode = fields.find((field) => field.key === "mode");
	assert.deepEqual(mode.options, ["a", "b", 3], "only text and numbers are choices");

	const order = fields.find((field) => field.key === "order");
	assert.deepEqual(order.options, [], "options that aren't a list become an empty one");

	const detail = fields.find((field) => field.key === "detail");
	assert.deepEqual(detail.showWhen, { key: "on", equals: true }, "a good showWhen is kept");

	const loose = fields.find((field) => field.key === "loose");
	assert.equal(loose.showWhen, undefined, "a showWhen naming nothing is taken off");

	const never = fields.find((field) => field.key === "never");
	assert.equal(never.showWhen, undefined, "a showWhen without equals would hide its field for good");
});

test("input.json and a theme's files: the same", () => {
	assert.deepEqual(moduleConfig.readInputSchema("messy").map((c) => c.key), ["go"]);
	assert.deepEqual(themeLoader.readSchema("messytheme").map((f) => f.key), ["accent"]);

	const instanceFields = themeLoader.readInstanceSchema("messytheme");
	assert.deepEqual(instanceFields.map((f) => f.key), ["size"]);
	assert.deepEqual(instanceFields[0].options, ["small", "large"]);
});

test("defaults and saving work with the bad entries gone", () => {
	assert.doesNotThrow(() => moduleConfig.applyDefaults("messy", {}));
	assert.doesNotThrow(() => moduleConfig.cleanConfig("messy", { mode: "b", on: "true" }));
	assert.doesNotThrow(() => themeLoader.applyDefaults("messytheme", {}));
	assert.doesNotThrow(() => themeLoader.applyInstanceDefaults("messytheme", {}));

	const config = moduleConfig.applyDefaults("messy", {});
	assert.equal(config.mode, "a");
});

test("the tile still renders", async () => {
	await waitForPort(face.id);

	const response = await fetch(`http://127.0.0.1:${face.id}/api/${instanceId}?richness=50`);
	assert.equal(response.status, 200);

	const body = await response.json();
	assert.equal(body.title, "Messy");
});

async function adminPage(url) {
	const response = await fetch(`http://127.0.0.1:${ADMIN_PORT}${url}`, { headers: { cookie } });
	assert.equal(response.status, 200, `${url} answered ${response.status}`);
	return response.text();
}

test("admin: every settings page opens", async () => {
	require("../core/admin-face")();
	await waitForPort(ADMIN_PORT);
	cookie = await signIn(ADMIN_PORT);

	await adminPage(`/faces/${face.id}`);
	await adminPage(`/faces/${face.id}/theme`);
	await adminPage(`/faces/${face.id}/modules`);

	const html = await adminPage(`/faces/${face.id}/modules/${encodeURIComponent(instanceId)}`);

	// The select only offers the real choices
	assert.ok(html.includes('<option value="b"'));
	assert.ok(!html.includes('<option value="null"'));
	assert.ok(!html.includes("[object Object]"));
});

test("admin: a field that depends on a checkbox says so, and the page checks the tick", async () => {
	const html = await adminPage(`/faces/${face.id}/modules/${encodeURIComponent(instanceId)}`);

	// The dependent field carries the checkbox's key and "true"
	assert.match(html, /data-when-key="on"\s+data-when-is="true"/);

	// And the page compares a checkbox by whether it's ticked, not by its
	// .value (always "on")
	assert.ok(html.includes('control.type === "checkbox"'));
	assert.ok(html.includes("String(control.checked)"));
});