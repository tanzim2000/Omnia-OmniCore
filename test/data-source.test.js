// test/data-source.test.js
// A widget can say where its data came from (since v1.19.8): a
// `data-source` at the top level of what a module returns, next to
// `title`, passed through to the theme as it was said.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, modulesDir } = require("./helpers");
const faceStore = require("../core/face-store");
const { startFace, dataSourceOf } = require("../core/face-loader");
const { contentTag } = require("../core/content-tag");

// A module that returns whatever source its setting says, so one module
// can try every case
function writeSourcedModule() {
	const dir = path.join(modulesDir, "sourced");

	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "Sourced", description: "Names its source", provides: ["pair"] })
	);
	// Only settings a module declares reach it
	fs.writeFileSync(
		path.join(dir, "settings.json"),
		JSON.stringify({ settings: [{ key: "source", label: "Source", type: "text" }] })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async function (config) {\n" +
			"\tconst envelope = { title: 'Weather', content: [{ type: 'pair', label: 'Temperature', value: '8°C' }] };\n" +
			"\tif (config.source !== undefined) envelope['data-source'] = config.source;\n" +
			"\treturn envelope;\n" +
			"};\n"
	);
}

test("dataSourceOf: one plain line, or nothing", () => {
	assert.equal(dataSourceOf({ "data-source": "Environment Canada" }), "Environment Canada");
	assert.equal(dataSourceOf({ "data-source": "  MET Norway\n (yr.no) " }), "MET Norway (yr.no)");

	for (const nothing of [undefined, null, "", "   ", 42, { name: "x" }, ["x"]]) {
		assert.equal(dataSourceOf({ "data-source": nothing }), null, JSON.stringify(nothing));
	}

	assert.equal(dataSourceOf(null), null);
	assert.equal(dataSourceOf({}), null);

	const long = dataSourceOf({ "data-source": "x".repeat(300) });
	assert.equal(long.length, 100);
	assert.ok(long.endsWith("..."));
});

test("content tag: unchanged without a source, and a new source is a change", () => {
	const blocks = [{ type: "pair", label: "Temperature", value: "8°C" }];

	// Exactly the tag a widget always had, so no theme sees a change
	// just because OmniCore was updated
	assert.equal(contentTag("Weather", blocks, null), contentTag("Weather", blocks));
	assert.equal(contentTag("Weather", blocks, undefined), contentTag("Weather", blocks));

	assert.notEqual(contentTag("Weather", blocks, "Open-Meteo"), contentTag("Weather", blocks));
	assert.notEqual(
		contentTag("Weather", blocks, "Open-Meteo"),
		contentTag("Weather", blocks, "Environment Canada")
	);
});

test("a face passes the source to its theme, only when there is one", async () => {
	resetState();
	writeSourcedModule();

	const face = faceStore.createFace("Source test", "", null, [
		{ module: "sourced", label: "With", config: { source: "Environment Canada" } },
		{ module: "sourced", label: "Without", config: {} },
		{ module: "sourced", label: "Blank", config: { source: "   " } }
	]);

	await startFace(face);
	await waitForPort(face.id);

	const read = async (instance) =>
		(await fetch(`http://127.0.0.1:${face.id}/api/${instance.id}?richness=50`)).json();

	const [withSource, without, blank] = face.instances;

	const named = await read(withSource);
	assert.equal(named["data-source"], "Environment Canada");
	assert.equal(named.title, "With");
	assert.ok(Array.isArray(named.content));
	assert.ok(named.updated, "updated is still there, as before");

	assert.ok(!("data-source" in (await read(without))), "no source, no field");
	assert.ok(!("data-source" in (await read(blank))), "a blank source is no source");
});
