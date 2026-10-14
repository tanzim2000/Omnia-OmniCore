// test/ask-first.test.js
// A select setting whose options can ask before they're taken (since
// v1.19.8), such as a weather service that needs an API key: what a
// settings file may say, and what reaches the page.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const helpers = require("./helpers");
const { usableFields } = require("../core/schema-fields");
const { cleanAsk, askAttribute, ASK_FIRST_SCRIPT } = require("../core/ask-first");

const SOURCE = {
	key: "source",
	label: "Source",
	type: "select",
	options: ["Open-Meteo", "OpenWeatherMap", "Google Weather"],
	default: "Open-Meteo",
	ask: {
		OpenWeatherMap: {
			question: "Do you have an OpenWeatherMap API key?",
			text: "It's free, from openweathermap.org.",
			into: "owmKey",
			prompt: "Your OpenWeatherMap API key",
			placeholder: "Paste it here"
		}
	}
};

const KEY = {
	key: "owmKey",
	label: "API key",
	type: "password",
	showWhen: { key: "source", equals: "OpenWeatherMap" }
};

// --- What a settings file may say ----------------------------------------

test("a good ask is kept as it was written", () => {
	const [source] = usableFields("Test", [SOURCE, KEY]);
	assert.deepEqual(source.ask, SOURCE.ask);
});

test("only options the select really has, each with a question", () => {
	const warnings = [];
	const ask = cleanAsk(
		{
			key: "source",
			type: "select",
			options: ["A", "B", "C"],
			ask: {
				A: { question: "Sure?" },
				B: { text: "no question" },
				C: "not an object",
				D: { question: "not an option" }
			}
		},
		["source"],
		(message) => warnings.push(message)
	);

	assert.deepEqual(ask, { A: { question: "Sure?" } });
	assert.equal(warnings.length, 3);
});

test("`into` has to be another setting in the same list", () => {
	const warnings = [];
	const field = {
		key: "source",
		type: "select",
		options: ["A", "B", "C"],
		ask: {
			A: { question: "?", into: "apiKey" },
			B: { question: "?", into: "missing" },
			C: { question: "?", into: "source" }
		}
	};

	const ask = cleanAsk(field, ["source", "apiKey"], (message) => warnings.push(message));

	assert.equal(ask.A.into, "apiKey");
	assert.ok(!("into" in ask.B), "a setting that doesn't exist: only the question");
	assert.ok(!("into" in ask.C), "not into itself");
	assert.equal(warnings.length, 2);
});

test("only a select asks; a broken ask is taken off and the field kept", () => {
	const fields = usableFields("Test", [
		{ key: "name", type: "text", ask: { x: { question: "?" } } },
		{ key: "mode", type: "select", options: ["a"], ask: "yes please" },
		{ key: "other", type: "select", options: ["a"], ask: { b: { question: "?" } } }
	]);

	assert.equal(fields.length, 3, "every field is still there");
	for (const field of fields) {
		assert.ok(!("ask" in field), field.key);
	}
});

test("long words are cut, and unknown parts left out", () => {
	const ask = cleanAsk(
		{
			key: "s",
			type: "select",
			options: ["A"],
			ask: { A: { question: "q".repeat(500), text: "t".repeat(900), extra: "<script>" } }
		},
		["s"],
		() => {}
	);

	assert.equal(ask.A.question.length, 160);
	assert.equal(ask.A.text.length, 400);
	assert.ok(!("extra" in ask.A));
});

// --- The page -------------------------------------------------------------

test("the select carries its asks into the page, escaped", () => {
	const escape = (text) =>
		String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	const attribute = askAttribute({ ...SOURCE, ask: { A: { question: 'Say "yes" <b>' } } }, escape);

	assert.match(attribute, /^ data-ask="/);
	assert.ok(!attribute.slice(" data-ask=\"".length, -1).includes('"'), "no bare quote inside");
	assert.ok(!attribute.includes("<b>"));

	assert.equal(askAttribute({ key: "x", type: "select", options: ["a"] }, escape), "", "nothing to ask");
});

test("the widget page and the wizard both draw a select that asks", async () => {
	helpers.resetState();

	// A module with a choice that asks first
	const dir = path.join(helpers.modulesDir, "asking");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ name: "Asking", provides: ["text"] }));
	fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ settings: [SOURCE, KEY] }));
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async () => ({ title: 'Asking', content: [{ type: 'text', value: 'ok' }] });\n"
	);

	require("../core/admin-face")();
	require("../core/wizard-face")();
	await helpers.waitForPort(3000);
	await helpers.waitForPort(3999);

	// The wizard draws its forms in the browser, from the module list it
	// was given: the ask has to be in that list, and the script with it
	const wizard = await (await fetch("http://127.0.0.1:3999/")).text();
	assert.ok(wizard.includes("function setUpAskFirst"));
	assert.ok(wizard.includes("Do you have an OpenWeatherMap API key?"));
	assert.ok(wizard.includes("setUpAskFirst();"));

	// A widget's own page
	const cookie = await helpers.signIn(3000);
	const faceStore = require("../core/face-store");
	const face = faceStore.createFace("Ask", "", null, [{ module: "asking", config: {} }]);
	const instance = face.instances[0];

	const html = await (
		await fetch(`http://127.0.0.1:3000/faces/${face.id}/modules/${instance.id}`, { headers: { cookie } })
	).text();

	assert.match(html, /<select data-key="source" data-scope="module" data-type="select" data-ask="[^"]*OpenWeatherMap[^"]*">/);
	assert.match(html, /data-key="owmKey"[^>]*data-type="password"/);
	assert.ok(html.includes("function setUpAskFirst"));
	assert.ok(html.includes("function askDialog"));
});

// --- In the browser ---------------------------------------------------------

// The script against a stand-in page: one select, one key box, and
// dialogs that answer whatever this test says
function pageWith({ yes, typed, keyValue }) {
	const listeners = {};
	const events = [];

	const select = {
		value: "Open-Meteo",
		dataset: { ask: JSON.stringify(SOURCE.ask), scope: "module" },
		addEventListener: (event, handler) => (listeners[event] = handler),
		dispatchEvent: (event) => {
			events.push(["select", event.type, select.value]);
			if (listeners[event.type]) listeners[event.type](event);
		}
	};

	const key = {
		value: keyValue || "",
		type: "password",
		dispatchEvent: (event) => events.push(["key", event.type, key.value])
	};

	const asked = [];

	const context = {
		CSS: { escape: (text) => text },
		Event: function (type) {
			this.type = type;
		},
		document: {
			querySelectorAll: (selector) => (selector === "select[data-ask]" ? [select] : []),
			querySelector: (selector) => (selector.includes('data-key="owmKey"') && selector.includes('data-scope="module"') ? key : null)
		},
		confirmDialog: async (options) => {
			asked.push(["confirm", options.title, options.confirm, options.cancel]);
			return yes;
		},
		askDialog: async (options) => {
			asked.push(["ask", options.title, options.secret]);
			return typed;
		}
	};

	vm.runInNewContext(ASK_FIRST_SCRIPT, context);

	// Pick an option the way a person does: the value changes, then
	// "change" fires
	async function pick(option) {
		select.value = option;
		await listeners.change();
	}

	return { select, key, asked, events, pick };
}

test("No puts the choice back", async () => {
	const page = pageWith({ yes: false });
	await page.pick("OpenWeatherMap");

	assert.deepEqual(page.asked, [["confirm", "Do you have an OpenWeatherMap API key?", "Yes", "No"]]);
	assert.equal(page.select.value, "Open-Meteo");
	assert.ok(page.events.some(([who, type]) => who === "select" && type === "change"), "the page is told");
});

test("Yes asks for the key, and it goes into the key setting", async () => {
	const page = pageWith({ yes: true, typed: "abc123" });
	await page.pick("OpenWeatherMap");

	assert.deepEqual(page.asked[1], ["ask", "Your OpenWeatherMap API key", true]);
	assert.equal(page.select.value, "OpenWeatherMap");
	assert.equal(page.key.value, "abc123");
});

test("Yes, then cancelling the key, puts the choice back too", async () => {
	const page = pageWith({ yes: true, typed: null });
	await page.pick("OpenWeatherMap");

	assert.equal(page.select.value, "Open-Meteo");
	assert.equal(page.key.value, "");
});

test("nothing is asked when the key is already there, or the option doesn't ask", async () => {
	const withKey = pageWith({ yes: false, keyValue: "saved-key" });
	await withKey.pick("OpenWeatherMap");
	assert.deepEqual(withKey.asked, []);
	assert.equal(withKey.select.value, "OpenWeatherMap");

	const plain = pageWith({ yes: false });
	await plain.pick("Google Weather");
	assert.deepEqual(plain.asked, []);
	assert.equal(plain.select.value, "Google Weather");
});

test("after a Yes, going away and back asks nothing (the key is kept)", async () => {
	const page = pageWith({ yes: true, typed: "abc123" });
	await page.pick("OpenWeatherMap");
	await page.pick("Open-Meteo");
	await page.pick("OpenWeatherMap");

	assert.equal(page.asked.length, 2, "asked once: the question and the key");
	assert.equal(page.select.value, "OpenWeatherMap");
});
