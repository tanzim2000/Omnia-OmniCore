// test/info-order.test.js
// Info order lists (a module's `priority` settings), as v2 draws them.
//
//   - Four items or fewer: the rows, with a grip to drag and arrows. On a
//     widget's page, in a box of their own beside the settings, which
//     hides as a whole when the setting does (showWhen).
//   - More than four: one button with the order in short form, which
//     opens the whole list in a pop-up. Among the settings, as before.
//   - The wizard draws them with the very same function, sent to it as
//     source, and the order is stored the same way: JSON in a hidden
//     input that the save code reads like any other field.
//   - The scripts on both pages still parse once all that source is put
//     together.
//
// The modules here are written by the test, so nothing depends on what's
// published.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { resetState, waitForPort, signIn, modulesDir } = helpers;
const faceStore = require("../core/face-store");
const priorityUi = require("../core/priority-ui");

const ADMIN = 3000;
const WIZARD = 3999;
let cookie;

// Three items (a box of its own), shown only for one choice of "mode"
const SHORT = "io-short";
// Eleven items (a button), and a second list of exactly four
const LONG = "io-long";

const ELEVEN = ["Temperature", "Condition", "Alert", "Feels like", "Wind", "Gusts", "Humidity", "Pressure", "UV", "Rain", "Snow"];

function writeModule(id, manifest, settings) {
	const dir = path.join(modulesDir, id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest));
	fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ settings }));
	fs.writeFileSync(path.join(dir, "index.js"), "module.exports = async function () { return { content: [] }; };\n");
}

test.after(() => {
	for (const id of [SHORT, LONG]) {
		fs.rmSync(path.join(modulesDir, id), { recursive: true, force: true });
	}
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

// Rows actually on the page. The page's script holds the same markup as
// text ('... data-priority-item="' + name), so a quote right after the
// opening one means it's the script, not a row.
const rowsOn = (html) => (html.match(/data-priority-item="[^'"]/g) || []).length;
const buttonOn = (html) => html.includes("data-priority-open><span");

// Every inline script on a page, checked to be valid JavaScript (parsed,
// not run)
function assertScriptsParse(html, where) {
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	assert.ok(scripts.length > 0, `${where} has scripts`);
	for (const source of scripts) {
		assert.doesNotThrow(() => new vm.Script(source), `${where}: a script that doesn't parse`);
	}
}

// --- The drawing, on its own -------------------------------------------------

test("summary: three or fewer written out, more as the first three and a count", () => {
	assert.equal(priorityUi.prioritySummary(["A"]), "A");
	assert.equal(priorityUi.prioritySummary(["A", "B", "C"]), "A, B, C");
	assert.equal(priorityUi.prioritySummary(["A", "B", "C", "D"]), "A, B, C and 1 more");
	assert.equal(priorityUi.prioritySummary(ELEVEN), "Temperature, Condition, Alert and 8 more");
});

test("drawing: four items are rows, five are a button", () => {
	const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
	const field = { key: "order", label: "Info order", type: "priority" };

	const four = priorityUi.priorityFieldHtml(field, ["A", "B", "C", "D"], "module", escape);
	assert.ok(four.startsWith("<div data-priority>"));
	assert.equal((four.match(/data-priority-item=/g) || []).length, 4);
	assert.equal((four.match(/data-priority-grip/g) || []).length, 4, "a grip on every row");
	assert.ok(four.includes('data-priority-move="up"') && four.includes('data-priority-move="down"'), "the arrows are kept");
	assert.ok(!four.includes("data-priority-open"));

	const five = priorityUi.priorityFieldHtml(field, ["A", "B", "C", "D", "E"], "module", escape);
	assert.ok(five.includes("data-priority-long"));
	assert.ok(five.includes('data-priority-title="Info order"'));
	assert.ok(five.includes("<span class=\"priority-summary\" data-priority-summary>A, B, C and 2 more</span>"));
	assert.ok(!five.includes("data-priority-item="), "no rows on the page: they're in the pop-up");

	// The order is stored the same way either way
	for (const html of [four, five]) {
		assert.match(html, /<input type="hidden" data-key="order" data-scope="module" data-type="priority" value="\[&quot;A&quot;/);
	}
});

test("drawing: an item's name can't break out of the page", () => {
	const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const html = priorityUi.priorityFieldHtml({ key: "k" }, ['<b>"x"</b>'], "module", escape);
	assert.ok(!html.includes("<b>"));
	assert.ok(html.includes("&lt;b&gt;&quot;x&quot;&lt;/b&gt;"));
});

test("the cut-off is four", () => {
	assert.equal(priorityUi.INLINE_MAX, 4);
});

// --- The pages ---------------------------------------------------------------

let face;

test("boots signed in, with a face holding both modules", async () => {
	resetState();

	writeModule(SHORT, { name: "Short order", description: "Three things" }, [
		{ key: "mode", type: "select", label: "Mode", options: ["Simple", "Other"], default: "Simple" },
		{ key: "order", type: "priority", label: "Show first", options: ["One", "Two", "Three"], showWhen: { key: "mode", equals: "Simple" } }
	]);

	writeModule(LONG, { name: "Long order", description: "Eleven things" }, [
		{ key: "order", type: "priority", label: "Info order", options: ELEVEN, help: "What shows first" },
		{ key: "four", type: "priority", label: "Four of them", options: ["W", "X", "Y", "Z"] }
	]);

	face = faceStore.createFace("", "", null, []);

	require("../core/admin-face")();
	require("../core/wizard-face")();
	await waitForPort(ADMIN);
	await waitForPort(WIZARD);
	cookie = await signIn(ADMIN);

	assert.equal((await post(`/faces/${face.id}/modules`, { module: SHORT })).status, 200);
	assert.equal((await post(`/faces/${face.id}/modules`, { module: LONG })).status, 200);
});

test("widget page: a short list gets a box of its own, which hides with its setting", async () => {
	const instance = faceStore.findFace(face.id).instances.find((i) => i.module === SHORT);
	const { status, html } = await get(ADMIN, `/faces/${face.id}/modules/${instance.id}`);
	assert.equal(status, 200);

	const box = html.match(/<div class="segment order-segment"([^>]*)>\s*<h2>([^<]*)<\/h2>/);
	assert.ok(box, "a box of its own");
	assert.equal(box[2], "Show first", "headed with the setting's label");
	assert.ok(box[1].includes('data-when-key="mode"') && box[1].includes('data-when-is="Simple"'), "it hides as a whole");

	// Two columns now: the settings, and the box beside them
	assert.ok(html.includes('<div class="bento-row two face-columns">'));
	assert.equal(rowsOn(html), 3);
	assert.ok(!buttonOn(html), "no button for three items");
	assertScriptsParse(html, "the widget page");
});

test("widget page: a long list is a button among the settings, a list of four is a box", async () => {
	const instance = faceStore.findFace(face.id).instances.find((i) => i.module === LONG);
	const { html } = await get(ADMIN, `/faces/${face.id}/modules/${instance.id}`);

	// The button is inside the Settings box, with its label and help
	const settings = html.slice(html.indexOf("<h2 style=\"margin-bottom:14px\">Settings</h2>"), html.indexOf("order-segment"));
	assert.ok(settings.includes("<label>Info order</label>"));
	assert.ok(buttonOn(settings));
	assert.ok(settings.includes("Temperature, Condition, Alert and 8 more"));
	assert.ok(settings.includes("What shows first"));

	// Exactly four: still a box with rows
	assert.ok(html.includes("<h2>Four of them</h2>"));
	assert.equal(rowsOn(html), 4, "only the short list's rows are on the page");
	assertScriptsParse(html, "the widget page");
});

test("widget page: a saved order comes back, in that order, in short form", async () => {
	const instance = faceStore.findFace(face.id).instances.find((i) => i.module === LONG);
	const base = `/faces/${face.id}/modules/${instance.id}`;
	const reordered = ["Wind", "Rain", ...ELEVEN.filter((item) => item !== "Wind" && item !== "Rain")];

	const saved = await post(base, { label: "", config: { order: JSON.stringify(reordered) }, themeConfig: {} });
	assert.equal(saved.status, 200);

	const { html } = await get(ADMIN, base);
	assert.ok(html.includes("Wind, Rain, Temperature and 8 more"));
	assert.deepEqual(faceStore.findFace(face.id).instances.find((i) => i.id === instance.id).config.order, reordered);
});

test("wizard: draws Info order with the same function, and its script parses", async () => {
	const { html } = await get(WIZARD, "/faces/new");

	assert.ok(html.includes(priorityUi.priorityFieldHtml.toString()), "the same function, sent as source");
	assert.ok(html.includes(priorityUi.PRIORITY_SCRIPT), "the same browser code");
	assert.ok(html.includes(".priority-open"), "and the same look");
	assert.ok(!/function syncPriority\(container\) \{\s*const rows = Array\.prototype/.test(html), "the wizard's old copy is gone");
	assertScriptsParse(html, "the wizard");
});

test("the browser code: drags with pointer events, a finger only by the grip, and a pop-up with Done and Cancel", () => {
	const source = priorityUi.PRIORITY_SCRIPT;
	for (const piece of ['"pointerdown"', '"pointermove"', '"pointerup"', '"pointercancel"', 'event.pointerType !== "mouse"', "[data-priority-grip]", '"Done"', '"Cancel"', '"Escape"']) {
		assert.ok(source.includes(piece), `has ${piece}`);
	}
	assert.ok(priorityUi.PRIORITY_CSS.includes("touch-action: none"), "the grip keeps a finger for dragging");
});
