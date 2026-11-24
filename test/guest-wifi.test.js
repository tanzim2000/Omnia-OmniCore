// test/guest-wifi.test.js
// In short: The Guest Wi-Fi widget
//
// The Guest Wi-Fi widget (since 2.0.0), the first widget built into
// OmniCore rather than installed from a Registry.
//
//   - A built-in widget is offered when adding a widget, but isn't
//     "installed": not in the installed list, and nothing installed can
//     stand in for it
//   - Its settings list the saved networks as they are when the form is
//     drawn; a module from a Registry never has code run for its form
//   - What it shows: the code, then the name and a line as there's room,
//     the password as text only when asked for
//   - A theme that can't draw the code prints the network's name, never
//     the code's contents
//   - With no saved password, or no Wi-Fi, it says so in words

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Folders of its own, before anything reads where data and modules live
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-guest-data-"));
const modulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-guest-modules-"));
process.env.OMNICORE_DATA_DIR = dataDir;
process.env.OMNICORE_MODULES_DIR = modulesDir;

const builtIn = require("../core/built-in");
const moduleLoader = require("../core/module-loader");
const moduleConfig = require("../core/module-config");
const passwords = require("../core/network-passwords");
const { toBlocks } = require("../core/envelope");

const ID = "omnicore-guest-wifi";

test("offered with the installed modules, but not installed itself", () => {
	fs.mkdirSync(path.join(modulesDir, "weather"));
	fs.writeFileSync(path.join(modulesDir, "weather", "index.js"), "module.exports = async () => ({ title: 'Weather', content: [] });");

	assert.deepEqual(builtIn.ids(), [ID]);
	assert.deepEqual(moduleLoader.listModules(), ["weather"], "Installed Resources and updates see installed modules only");
	assert.deepEqual(moduleLoader.listAvailable(), ["weather", ID], "adding a widget offers both");
	assert.equal(typeof moduleLoader.loadModule(ID), "function");
	assert.equal(moduleConfig.readManifest(ID).name, "Guest Wi-Fi");
});

test("nothing installed can stand in for it", () => {
	// A module folder with the same name, installed from somewhere
	const impostor = path.join(modulesDir, ID);
	fs.mkdirSync(impostor);
	fs.writeFileSync(path.join(impostor, "module.json"), JSON.stringify({ name: "Not the real one" }));
	fs.writeFileSync(path.join(impostor, "index.js"), "module.exports = async () => ({ title: 'impostor' });");

	assert.equal(moduleConfig.readManifest(ID).name, "Guest Wi-Fi");
	assert.equal(moduleLoader.listAvailable().filter((id) => id === ID).length, 1, "listed once");
	assert.notEqual(moduleLoader.loadModule(ID).toString(), "async () => ({ title: 'impostor' })");
	fs.rmSync(impostor, { recursive: true });
});

test("a module from a Registry never has code run to draw its settings form", () => {
	const folder = path.join(modulesDir, "sneaky");
	fs.mkdirSync(folder);
	fs.writeFileSync(path.join(folder, "settings.js"), "global.sneakyRan = true; module.exports = () => ({ settings: [{ key: 'x', type: 'text' }] });");
	assert.deepEqual(moduleConfig.readSchema("sneaky"), [], "settings.js is only read for a built-in widget");
	assert.equal(global.sneakyRan, undefined);
});

test("only a built-in widget can have Add a network around you", () => {
	const folder = path.join(modulesDir, "copycat");
	fs.mkdirSync(folder);
	fs.writeFileSync(
		path.join(folder, "settings.json"),
		JSON.stringify({ settings: [{ key: "add", type: "wifi-add" }, { key: "name", type: "text" }] })
	);
	assert.deepEqual(moduleConfig.readSchema("copycat").map((field) => field.key), ["name"], "dropped from anyone else's");
	const own = moduleConfig.readSchema(ID).find((field) => field.type === "wifi-add");
	assert.equal(own.into, "network", "and it fills in the network list");
});

test("its settings list the saved networks as they are right now", () => {
	const networkField = () => moduleConfig.readSchema(ID).find((field) => field.key === "network");
	assert.deepEqual(networkField().options, ["The network the server is on"]);
	assert.equal(networkField().default, "The network the server is on");

	passwords.save("Home 5G", "correct horse battery", "psk");
	passwords.save("Cafe", "", "open");
	assert.deepEqual(networkField().options, ["The network the server is on", "Cafe", "Home 5G"], "the moment they're saved");

	const config = moduleConfig.applyDefaults(ID, {});
	assert.deepEqual(config, { network: "The network the server is on", showPassword: false });
	assert.deepEqual(moduleConfig.cleanConfig(ID, { network: "Home 5G", showPassword: "on", addNetwork: "x" }), { network: "Home 5G", showPassword: true }, "the button is never saved");
});

test("the code, then the name, then a line, as there's room; the password only when asked", async () => {
	const widget = moduleLoader.loadModule(ID);
	const small = await widget({ network: "Home 5G", showPassword: false }, 20);
	assert.deepEqual(small.content.map((block) => block.type), ["qr"]);
	assert.equal(small.content[0].value, "WIFI:T:WPA;S:Home 5G;P:correct horse battery;;");

	const middle = await widget({ network: "Home 5G", showPassword: false }, 50);
	assert.deepEqual(middle.content.map((block) => block.type), ["qr", "text"]);
	assert.equal(middle.content[1].value, "Home 5G");

	const roomy = await widget({ network: "Home 5G", showPassword: false }, 90);
	assert.deepEqual(roomy.content.map((block) => block.type), ["qr", "text", "text"]);
	assert.ok(!JSON.stringify(roomy.content.slice(1)).includes("correct horse"), "the password is only inside the code");

	const shown = await widget({ network: "Home 5G", showPassword: true }, 20);
	assert.deepEqual(shown.content.at(-1), { type: "pair", label: "Password", value: "correct horse battery" });

	const open = await widget({ network: "Cafe", showPassword: true }, 20);
	assert.equal(open.content[0].value, "WIFI:T:nopass;S:Cafe;;");
	assert.equal(open.content.at(-1).value, "None");
});

test("a theme that can't draw the code prints the name, never the code's contents", async () => {
	const widget = moduleLoader.loadModule(ID);
	const blocks = toBlocks(await widget({ network: "Home 5G" }, 20));
	assert.equal(blocks[0].text, "Home 5G");
	assert.ok(blocks[0].svg && blocks[0].svg.startsWith("<svg"), "Core draws the code");
	assert.ok(!blocks[0].svg.includes("correct horse"), "the drawing is squares, never text");

	// Any other qr block still prints what's in it, as before
	assert.equal(toBlocks({ content: [{ type: "qr", value: "https://example.com", label: "Open" }] })[0].text, "Open: https://example.com");
});

test("the server's own network: whichever it's on", async () => {
	const widget = moduleLoader.loadModule(ID);
	passwords.noteCurrent("Home 5G");
	const own = await widget({ network: "The network the server is on" }, 50);
	assert.equal(own.content[1].value, "Home 5G");

	passwords.noteCurrent("Somewhere Else");
	const unknown = await widget({ network: "The network the server is on" }, 50);
	assert.deepEqual(unknown.content.map((block) => block.value), [
		"Somewhere Else",
		"OmniCore has no saved password for this network. Add it on the Network page, in Settings."
	]);

	passwords.noteCurrent(null);
	const offline = await widget({}, 50);
	assert.equal(offline.content[0].value, "Not on Wi-Fi");
	passwords.reset();
});

test("its name in lists: the network, when one is picked", async () => {
	const widget = moduleLoader.loadModule(ID);
	assert.equal(await widget.label({ network: "Home 5G" }), "Guest Wi-Fi: Home 5G");
	assert.equal(await widget.label({ network: "The network the server is on" }), "");
});

test("its words have no em dashes", () => {
	const folder = builtIn.folderOf(ID);
	for (const file of ["index.js", "settings.js", "module.json"]) {
		assert.ok(!fs.readFileSync(path.join(folder, file), "utf-8").includes("—"), file);
	}
});

test.after(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
	fs.rmSync(modulesDir, { recursive: true, force: true });
});
