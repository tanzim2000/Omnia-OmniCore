// test/widgets.test.js
// Widget types: one module offering more than one shape for its data (a
// month grid and an agenda list, say), picked per instance.
//
// Everything here is written to the sandbox by the test itself -- a
// calendar-like module that offers two widget types, a plain module that
// offers none, and a small theme that tries to tag its settings (which a
// theme can't do: widget types are the module's business alone).
// No network. The wizard, a dashboard face and the admin face are all
// real servers, talked to over real HTTP, the same as the rest of the
// suite.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir, themesDir } = helpers;
const widgetTypes = require("../core/widget-types");
const moduleConfig = require("../core/module-config");
const themeLoader = require("../core/theme-loader");
const faceStore = require("../core/face-store");

const ADMIN_PORT = 3000;
const WIZARD_PORT = 3999;

// ---- fixtures

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, "\t"));
}

// A module offering two widget types. Its settings cover every case the
// tagging rules have to handle, good and bad. Its tile just reports what
// it was given, so a test can see exactly what reached the module.
function writeCalendar() {
	const dir = path.join(modulesDir, "calendar");

	writeJson(path.join(dir, "module.json"), {
		name: "Calendar",
		description: "Two ways to look at the same days",
		provides: ["text"],
		widgets: [
			{ id: "month-view", name: "Month View", description: "The whole month at once" },
			// A name that would end the wizard's <script> if written raw
			{ id: "agenda-view", name: "Agenda View</script><b>" }
		]
	});

	writeJson(path.join(dir, "settings.json"), {
		settings: [
			{ key: "source", label: "Calendar address", type: "url", default: "", widgets: "all" },
			{ key: "place", label: "Where", type: "location", widgets: "all" },
			{ key: "weekNumbers", label: "Week numbers", type: "boolean", default: false, widgets: ["month-view"] },
			{ key: "days", label: "Days ahead", type: "number", default: 7, widgets: ["agenda-view"] },
			// One real id and one that doesn't exist: kept, for the real one
			{ key: "firstDay", label: "Week starts on", type: "select", options: ["Sunday", "Monday"], default: "Sunday", widgets: ["month-view", "year-view"] },
			// Every one of these is wrong in its own way, and must be left out
			{ key: "untagged", label: "No tag", type: "text", default: "" },
			{ key: "ghost", label: "Only for a type that doesn't exist", type: "text", default: "", widgets: ["year-view"] },
			{ key: "garbled", label: "A tag that's neither shape", type: "text", default: "", widgets: { "month-view": true } },
			{ key: "widgetType", label: "Fighting OmniCore for its own key", type: "text", default: "", widgets: "all" }
		]
	});

	fs.writeFileSync(
		path.join(dir, "index.js"),
		`module.exports = async function (config) {
			return {
				title: "Calendar",
				content: [{ type: "text", value: JSON.stringify(config) }]
			};
		};`
	);
}

// A module with no widget types, written the way every module was before
// they existed. A stray "widgets" tag on its field means nothing here.
function writePlain() {
	const dir = path.join(modulesDir, "plain");

	writeJson(path.join(dir, "module.json"), { name: "Plain", provides: ["text"] });
	writeJson(path.join(dir, "settings.json"), {
		settings: [
			{ key: "word", label: "Word", type: "text", default: "hello" },
			{ key: "tagged", label: "Tagged anyway", type: "text", default: "x", widgets: ["nothing"] },
			{ key: "sneaky", label: "Quote in a tag", type: "text", default: "", widgets: ['x" onfocus="alert(1)'] }
		]
	});
	fs.writeFileSync(
		path.join(dir, "index.js"),
		`module.exports = async function (config) {
			return { title: "Plain", content: [{ type: "text", value: JSON.stringify(config) }] };
		};`
	);
}

// A theme that tries to tag its per-instance settings with widget types,
// the way a module can. A theme can't: it never learns which widget type
// a tile shows. Every one of these tags must be ignored, so every field
// shows on every tile.
function writeTheme() {
	const dir = path.join(themesDir, "tagtheme");

	writeJson(path.join(dir, "theme.json"), { name: "Tag Theme" });
	// A tag here that tries to break out of its attribute must not reach
	// the page either.
	writeJson(path.join(dir, "settings.json"), {
		settings: [
			{ key: "accent", label: "Accent", type: "text", default: "", widgets: ['x" autofocus onfocus="alert(1)'] }
		]
	});
	writeJson(path.join(dir, "instance-settings.json"), {
		settings: [
			{ key: "size", label: "Size", type: "select", options: ["small", "large"], default: "small" },
			{ key: "monthSize", label: "Month grid size", type: "select", options: ["4x4", "6x6"], default: "4x4", widgets: ["month-view"] },
			{ key: "broken", label: "Broken tag", type: "text", default: "b", widgets: 7 }
		]
	});
	fs.writeFileSync(path.join(dir, "index.html"), "<!DOCTYPE html><title>Tag Theme</title>");
}

// What OmniCore logs while `fn` runs
function captureLog(fn) {
	const lines = [];
	const original = console.log;

	console.log = (...args) => lines.push(args.join(" "));

	try {
		fn();
	} finally {
		console.log = original;
	}

	return lines;
}

test("setup: fixtures are written", () => {
	resetState();
	writeCalendar();
	writePlain();
	writeTheme();
});

// ---- reading what a module declares

test("widget types: a module's list is checked, and one type alone is no choice", () => {
	assert.deepEqual(widgetTypes.readWidgets("m", undefined), [], "none declared");

	const lines = captureLog(() => {
		assert.deepEqual(widgetTypes.readWidgets("m1", "month-view"), [], "not a list");

		const read = widgetTypes.readWidgets("m2", [
			{ id: "a", name: "  A  " },
			{ id: "a", name: "A again" },
			{ id: "has space" },
			{ id: '"><script>' },
			null,
			{ id: "b" }
		]);

		assert.deepEqual(read, [
			{ id: "a", name: "A", description: "" },
			{ id: "b", name: "b", description: "" }
		], "bad and repeated ids skipped, a missing name falls back to the id");

		assert.deepEqual(
			widgetTypes.readWidgets("m3", [{ id: "only", name: "Only" }]),
			[],
			"a single widget type offers no choice"
		);
	});

	assert.ok(lines.some((line) => line.includes("m1") && line.includes("isn't a list")));
	assert.ok(lines.some((line) => line.includes("m2") && line.includes("listed twice")));
	assert.ok(lines.some((line) => line.includes("m2") && line.includes("unusable id")));
	assert.ok(lines.some((line) => line.includes("m3") && line.includes("only one widget type")));
});

test("widget types: the manifest carries them, and a module without any is unchanged", () => {
	const calendar = moduleConfig.readManifest("calendar");

	assert.deepEqual(calendar.widgets.map((widget) => widget.id), ["month-view", "agenda-view"]);
	assert.equal(calendar.widgets[0].description, "The whole month at once");
	assert.equal(calendar.widgets[1].description, "", "a description is optional");
	assert.ok(widgetTypes.offersChoice(calendar));

	const plain = moduleConfig.readManifest("plain");

	assert.deepEqual(plain.widgets, []);
	assert.ok(!widgetTypes.offersChoice(plain));
	assert.deepEqual(widgetTypes.typesOf(plain), ["plain"], "its one type is named after it");
});

test("settings: every field says which widget types it's for, or it's dropped with a warning", () => {
	let schema;
	const lines = captureLog(() => {
		schema = moduleConfig.readSchema("calendar");
	});

	assert.deepEqual(
		schema.map((field) => [field.key, field.widgets]),
		[
			["source", "all"],
			["place", "all"],
			["weekNumbers", ["month-view"]],
			["days", ["agenda-view"]],
			["firstDay", ["month-view"]]
		]
	);

	for (const key of ["untagged", "ghost", "garbled", "widgetType"]) {
		assert.ok(
			lines.some((line) => line.includes(`"${key}"`) && line.includes("skipped")),
			`no warning for ${key}`
		);
	}

	assert.ok(lines.some((line) => line.includes('"firstDay"') && line.includes('"year-view"')));

	// Asking again doesn't fill the log again. readSchema runs on every
	// tile request, so this is the difference between one line and
	// thousands.
	const again = captureLog(() => moduleConfig.readSchema("calendar"));
	assert.deepEqual(again, [], "the same warning was logged twice");
});

test("settings: a module without widget types keeps every field, and a stray tag is taken off", () => {
	const schema = moduleConfig.readSchema("plain");

	assert.deepEqual(schema.map((field) => field.key), ["word", "tagged", "sneaky"]);
	assert.ok(
		schema.every((field) => !("widgets" in field)),
		"a tag means nothing without widget types, so it can't change the form"
	);
});

test("widgets attribute: only plain ids ever reach the page", () => {
	assert.equal(widgetTypes.widgetsAttribute({ widgets: ["a", "b-c"] }), ' data-widgets="a|b-c"');
	assert.equal(widgetTypes.widgetsAttribute({ widgets: ['x" onfocus="alert(1)'] }), "");
	assert.equal(widgetTypes.widgetsAttribute({ widgets: ["ok", 5] }), "");
	assert.equal(widgetTypes.widgetsAttribute({ widgets: "all" }), "");
	assert.equal(widgetTypes.widgetsAttribute({}), "");
});

// ---- the stored value

test("config: the picked widget type is always one the module offers", () => {
	assert.equal(
		moduleConfig.applyDefaults("calendar", {}).widgetType,
		"month-view",
		"nothing stored means the first one"
	);
	assert.equal(
		moduleConfig.applyDefaults("calendar", { widgetType: "agenda-view" }).widgetType,
		"agenda-view"
	);
	assert.equal(
		moduleConfig.applyDefaults("calendar", { widgetType: "year-view" }).widgetType,
		"month-view",
		"a type the module dropped falls back to its first"
	);

	// Every field's value is there whichever type is picked, so switching
	// back finds things the way they were left
	const config = moduleConfig.applyDefaults("calendar", { widgetType: "agenda-view", weekNumbers: true });
	assert.equal(config.weekNumbers, true, "a month-view value survives agenda-view being picked");
	assert.equal(config.days, 7);

	assert.ok(
		!("widgetType" in moduleConfig.applyDefaults("plain", {})),
		"a module without widget types never sees the key"
	);
});

test("config: saving keeps a real widget type, converts the rest, and refuses an invented one", () => {
	assert.deepEqual(
		moduleConfig.cleanConfig("calendar", {
			widgetType: "agenda-view",
			days: "5",
			weekNumbers: "true",
			untagged: "should not be kept"
		}),
		{ widgetType: "agenda-view", weekNumbers: true, days: 5 }
	);

	assert.ok(
		!("widgetType" in moduleConfig.cleanConfig("calendar", { widgetType: "year-view" })),
		"an id the module doesn't offer isn't stored"
	);

	assert.ok(
		!("widgetType" in moduleConfig.cleanConfig("plain", { widgetType: "anything" })),
		"nor is one for a module that offers no choice"
	);
});

test("config: an empty number box means unset, and empty coordinates mean no location, not 0, 0", () => {
	const clean = moduleConfig.cleanConfig("calendar", {
		days: "",
		place: { mode: "manual", latitude: "", longitude: "" }
	});

	assert.ok(!("days" in clean), "left out, so the default applies");
	assert.equal(moduleConfig.applyDefaults("calendar", clean).days, 7);
	assert.deepEqual(clean.place, { mode: "manual" }, "manual, with nothing to place it");

	const half = moduleConfig.cleanConfig("calendar", {
		place: { mode: "manual", latitude: "50.4", longitude: "" }
	});
	assert.deepEqual(half.place, { mode: "manual" }, "half a coordinate is no coordinate");

	const full = moduleConfig.cleanConfig("calendar", {
		place: { mode: "manual", latitude: "50.4", longitude: "-104.6" }
	});
	assert.deepEqual(full.place, { mode: "manual", latitude: 50.4, longitude: -104.6, label: "" });
});

// ---- the theme's side

test("theme: a widgets tag in a theme's file is ignored, and every field applies to every tile", () => {
	let schema;
	const lines = captureLog(() => {
		schema = themeLoader.readInstanceSchema("tagtheme");
	});

	assert.deepEqual(schema.map((field) => field.key), ["size", "monthSize", "broken"], "nothing is dropped");
	assert.ok(schema.every((field) => !("widgets" in field)), "every tag is taken off");
	assert.deepEqual(lines, [], "and nothing is logged about it");

	assert.ok(
		themeLoader.readSchema("tagtheme").every((field) => !("widgets" in field)),
		"the face-wide settings lose theirs too"
	);

	assert.deepEqual(
		themeLoader.applyInstanceDefaults("tagtheme", {}),
		{ size: "small", monthSize: "4x4", broken: "b" }
	);
});

// ---- the wizard, a real face, and the admin face

let face;

test("wizard: hands the browser the widget types and OmniCore's own picker", async () => {
	require("../core/wizard-face")();
	await waitForPort(WIZARD_PORT);

	const html = await (await fetch(`http://127.0.0.1:${WIZARD_PORT}/faces/new`)).text();

	assert.ok(html.includes('"Month View"'), "the widget types are in the page's data");
	assert.ok(!html.includes("Agenda View</script>"), "a name can't end the page's script");
	assert.ok(html.includes("Agenda View\\u003c/script>"), "it's written so only JavaScript reads it");
	assert.ok(!html.includes("function appliesTo("), "the theme-filtering rule is gone");
	assert.ok(html.includes("function widgetsAttribute("), "the shared tagging rule is in the page");
	assert.ok(html.includes("function pickerHtml("), "and the shared picker");
	assert.ok(html.includes("function applyWidgetFilter("), "and the script that drives it");
});

test("wizard: a face is created with the picked widget type, cleaned like any save", async () => {
	const response = await fetch(`http://127.0.0.1:${WIZARD_PORT}/faces`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: "Widget Face",
			theme: "tagtheme",
			instances: [
				{
					module: "calendar",
					label: "Agenda",
					config: { widgetType: "agenda-view", days: "3", weekNumbers: true },
					themeConfig: { size: "large", monthSize: "6x6" }
				},
				{
					module: "calendar",
					label: "Invented",
					config: { widgetType: "year-view", days: "", place: { mode: "manual", latitude: "", longitude: "" } },
					themeConfig: {}
				},
				{ module: "plain", label: "Plain", config: { widgetType: "nope" }, themeConfig: {} }
			],
			themeConfig: {}
		})
	});

	assert.equal(response.status, 200);
	face = await response.json();

	const stored = faceStore.findFace(face.id);
	const [agenda, invented, plain] = stored.instances;

	assert.deepEqual(agenda.config, { widgetType: "agenda-view", weekNumbers: true, days: 3 }, "the number arrives as a number");
	assert.ok(!("widgetType" in invented.config), "an invented widget type isn't stored");
	assert.ok(!("days" in invented.config), "an empty number box is unset, not zero");
	assert.deepEqual(invented.config.place, { mode: "manual" }, "and empty coordinates aren't 0, 0");
	assert.ok(!("widgetType" in plain.config), "nor one for a module without a choice");
	assert.deepEqual(agenda.themeConfigs.tagtheme, { size: "large", monthSize: "6x6" }, "the theme's values are kept as given");
});

test("dashboard: the module gets its widget type, and the theme never learns it", async () => {
	await waitForPort(face.id);

	const identity = await (await fetch(`http://127.0.0.1:${face.id}/identity`)).json();
	const [agenda, invented, plain] = identity.instances;

	for (const instance of [agenda, invented, plain]) {
		assert.ok(!("widgetType" in instance), "no widget type is handed to the theme");
		assert.ok(!("config" in instance), "nor the module's own settings, which would carry it");
	}

	assert.deepEqual(agenda.themeConfig, { size: "large", monthSize: "6x6", broken: "b" });
	assert.deepEqual(invented.themeConfig, { size: "small", monthSize: "4x4", broken: "b" });
	assert.deepEqual(plain.themeConfig, { size: "small", monthSize: "4x4", broken: "b" }, "the same fields on every tile");

	const tile = await (
		await fetch(`http://127.0.0.1:${face.id}/api/${encodeURIComponent(agenda.id)}?richness=50`)
	).json();
	const received = JSON.parse(tile.content[0].value);

	assert.equal(received.widgetType, "agenda-view", "the module is told which shape to draw");
	assert.equal(received.days, 3);

	const inventedTile = await (
		await fetch(`http://127.0.0.1:${face.id}/api/${encodeURIComponent(invented.id)}?richness=50`)
	).json();
	assert.equal(JSON.parse(inventedTile.content[0].value).place, null, "no location, rather than the Atlantic");
});

let cookie;

async function adminPage(url) {
	const response = await fetch(`http://127.0.0.1:${ADMIN_PORT}${url}`, { headers: { cookie } });
	assert.equal(response.status, 200, `${url} answered ${response.status}`);
	return response.text();
}

// A field's wrapper on the page, found by its key
function fieldTag(html, key) {
	const at = html.indexOf(`data-key="${key}"`);
	assert.ok(at !== -1, `no field ${key} on the page`);
	return html.slice(html.lastIndexOf('<div class="field"', at), at);
}

test("admin: the picker sits at the top, and fields say which widget types they're for", async () => {
	require("../core/admin-face")();
	await waitForPort(ADMIN_PORT);
	cookie = await signIn(ADMIN_PORT);

	const instances = faceStore.findFace(face.id).instances;
	const html = await adminPage(`/faces/${face.id}/modules/${encodeURIComponent(instances[0].id)}`);

	const picker = html.indexOf('class="widget-picker"');
	assert.ok(picker !== -1, "no picker");
	assert.ok(picker < html.indexOf('id="label"'), "the picker comes before the rest of the form");

	assert.ok(
		/class="widget-choice active"[^>]*data-widget-choice="agenda-view"/.test(html),
		"the stored type is the one lit up"
	);
	assert.ok(html.includes("<small>The whole month at once</small>"), "a description is shown");
	assert.ok(html.includes('data-type="widgetType" value="agenda-view"'), "and saved like any field");

	assert.ok(fieldTag(html, "weekNumbers").includes('data-widgets="month-view"'));
	assert.ok(fieldTag(html, "days").includes('data-widgets="agenda-view"'));
	assert.ok(!fieldTag(html, "source").includes("data-widgets"), "an \"all\" field is never hidden");

	// The theme's fields are all there, and none of them can be hidden by
	// the picker: the tag the theme tried to give one is gone
	for (const key of ["size", "monthSize", "broken"]) {
		assert.ok(!fieldTag(html, key).includes("data-widgets"), `the theme's ${key} isn't tied to a widget type`);
	}
	assert.ok(!html.includes('data-key="untagged"'), "a dropped module field never reaches the form");

	assert.ok(html.includes("function applyWidgetFilter("), "the picker's script is on the page");
});

test("admin: a module without widget types gets no picker", async () => {
	const instances = faceStore.findFace(face.id).instances;
	const html = await adminPage(`/faces/${face.id}/modules/${encodeURIComponent(instances[2].id)}`);

	assert.ok(!html.includes('class="widget-picker"'));
	assert.ok(!html.includes('data-key="widgetType"'), "no widget type is stored from this page");
	assert.ok(html.includes('data-key="monthSize"'), "every theme field is offered here too");
	for (const key of ["word", "tagged", "sneaky"]) {
		assert.ok(
			!fieldTag(html, key).includes("data-widgets"),
			`the module's own ${key} field isn't tagged, stray tag or not`
		);
	}
	assert.ok(!html.includes("onfocus"), "a quote in a tag never reaches the page");
});

test("admin: a theme's face-wide settings can't smuggle a tag onto the page either", async () => {
	const html = await adminPage(`/faces/${face.id}/theme`);

	assert.ok(html.includes('data-key="accent"'), "the field is there");
	assert.ok(!html.includes("onfocus"), "its hostile tag isn't");
});

test("admin: switching widget type is just saving a setting", async () => {
	const instances = faceStore.findFace(face.id).instances;
	const base = `http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules/${encodeURIComponent(instances[0].id)}`;

	const save = (config) =>
		fetch(base, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie },
			body: JSON.stringify({ label: "Agenda", config, themeConfig: { size: "large", monthSize: "6x6" } })
		});

	assert.equal((await save({ widgetType: "month-view", days: "3", weekNumbers: true })).status, 200);

	let stored = faceStore.findFace(face.id).instances[0];
	assert.equal(stored.config.widgetType, "month-view");
	assert.equal(stored.config.days, 3, "the agenda's setting is kept while month view is picked");

	const list = await adminPage(`/faces/${face.id}/modules`);
	assert.ok(list.includes("Calendar · Month View"), "the list says which one it is");
	assert.ok(list.includes("Plain</span>"), "and nothing extra for a module without a choice");

	// An invented id is refused rather than stored
	await save({ widgetType: "year-view" });
	stored = faceStore.findFace(face.id).instances[0];
	assert.ok(!("widgetType" in stored.config));
	assert.equal(moduleConfig.widgetTypeOf("calendar", stored.config), "month-view");
});