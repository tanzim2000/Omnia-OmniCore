// test/dialog.test.js
// The question pop-ups every Default UI page carries since v1.19.8
// (DIALOG_SCRIPT in core/ui-theme.js): confirmDialog, which the admin face
// has used since before they were shared, and askDialog, which asks for
// something to be typed in (an API key, say).
//
// The script is run against a small stand-in for a page, just enough of
// the DOM for it to build its panel, so clicks and keys can be pressed
// without a browser.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const helpers = require("./helpers");
const theme = require("../core/ui-theme");

// --- A very small page --------------------------------------------------

function fakeElement(tag) {
	const listeners = {};

	const element = {
		tagName: tag.toUpperCase(),
		children: [],
		className: "",
		textContent: "",
		value: "",
		disabled: false,
		attributes: {},
		parent: null,
		setAttribute(name, value) {
			this.attributes[name] = String(value);
		},
		appendChild(child) {
			child.parent = this;
			this.children.push(child);
			return child;
		},
		remove() {
			if (this.parent) {
				this.parent.children = this.parent.children.filter((c) => c !== this);
			}
			this.parent = null;
		},
		addEventListener(event, handler) {
			(listeners[event] = listeners[event] || []).push(handler);
		},
		fire(event, extra) {
			for (const handler of listeners[event] || []) {
				handler(Object.assign({ target: element, preventDefault() {} }, extra));
			}
		},
		focus() {
			page.document.activeElement = element;
		},
		// Every element under this one, this one first
		all() {
			return [this].concat(...this.children.map((child) => child.all()));
		}
	};

	return element;
}

let page;

function newPage() {
	const documentListeners = {};

	page = {
		document: {
			activeElement: null,
			body: fakeElement("body"),
			createElement: fakeElement,
			addEventListener(event, handler) {
				(documentListeners[event] = documentListeners[event] || []).push(handler);
			},
			removeEventListener(event, handler) {
				documentListeners[event] = (documentListeners[event] || []).filter((h) => h !== handler);
			},
			key(name) {
				for (const handler of documentListeners.keydown || []) {
					handler({ key: name, preventDefault() {} });
				}
			}
		}
	};

	vm.createContext(page);
	vm.runInContext(theme.DIALOG_SCRIPT, page);
	return page;
}

// What's on screen right now
function panel() {
	return page.document.body.all().find((element) => element.className === "modal");
}

function buttons() {
	return panel().all().filter((element) => element.tagName === "BUTTON");
}

function input() {
	return panel().all().find((element) => element.tagName === "INPUT");
}

function open() {
	return page.document.body.children.length > 0;
}

// --- confirmDialog ------------------------------------------------------

test("confirmDialog: title, text, Cancel then the confirm button", () => {
	newPage();
	page.confirmDialog({ title: "Delete this face?", text: "Can't be undone.", confirm: "Delete", danger: true });

	assert.equal(panel().attributes.role, "dialog");
	assert.ok(panel().all().some((e) => e.tagName === "H2" && e.textContent === "Delete this face?"));
	assert.ok(panel().all().some((e) => e.className === "dialog-text" && e.textContent === "Can't be undone."));

	const [cancel, confirm] = buttons();
	assert.equal(cancel.textContent, "Cancel");
	assert.equal(confirm.textContent, "Delete");
	assert.equal(confirm.className, "glass glass-danger");

	// An Enter pressed out of habit lands on Cancel, not the yes
	assert.equal(page.document.activeElement, cancel);
	assert.equal(input(), undefined, "no box to type in");
});

test("confirmDialog: the confirm button is true, and the pop-up goes", async () => {
	newPage();
	const answer = page.confirmDialog({ title: "Sure?" });
	buttons()[1].fire("click");

	assert.equal(await answer, true);
	assert.ok(!open());
});

test("confirmDialog: Cancel, Escape and a click outside are all false", async () => {
	for (const how of ["cancel", "escape", "outside"]) {
		newPage();
		const answer = page.confirmDialog({ title: "Sure?" });

		if (how === "cancel") buttons()[0].fire("click");
		if (how === "escape") page.document.key("Escape");
		if (how === "outside") page.document.body.children[0].fire("click");

		assert.equal(await answer, false, how);
		assert.ok(!open(), how);
	}
});

test("confirmDialog: a click inside the panel isn't a no", () => {
	newPage();
	page.confirmDialog({ title: "Sure?" });
	page.document.body.children[0].fire("click", { target: panel() });

	assert.ok(open());
});

// --- askDialog ------------------------------------------------------------

test("askDialog: a box to type in, which has the focus, and a confirm button that waits for it", () => {
	newPage();
	page.askDialog({ title: "Your API key", placeholder: "Paste it here", confirm: "Save", secret: true });

	const box = input();
	assert.equal(box.type, "password", "secret hides what's typed");
	assert.equal(box.placeholder, "Paste it here");
	assert.equal(page.document.activeElement, box);

	const confirm = buttons()[1];
	assert.equal(confirm.textContent, "Save");
	assert.equal(confirm.disabled, true, "nothing typed, nothing to save");

	box.value = "   ";
	box.fire("input");
	assert.equal(confirm.disabled, true, "spaces aren't something");

	box.value = "abc";
	box.fire("input");
	assert.equal(confirm.disabled, false);
});

test("askDialog: answers what was typed, trimmed, by button or Enter", async () => {
	newPage();
	let answer = page.askDialog({ title: "Key" });
	input().value = "  abc123  ";
	input().fire("input");
	buttons()[1].fire("click");
	assert.equal(await answer, "abc123");

	newPage();
	answer = page.askDialog({ title: "Key" });
	input().value = "xyz";
	input().fire("input");
	page.document.key("Enter");
	assert.equal(await answer, "xyz");
	assert.ok(!open());
});

test("askDialog: Enter with nothing typed does nothing; Cancel and Escape are null", async () => {
	newPage();
	page.askDialog({ title: "Key" });
	page.document.key("Enter");
	assert.ok(open(), "still waiting");

	newPage();
	let answer = page.askDialog({ title: "Key" });
	buttons()[0].fire("click");
	assert.equal(await answer, null);

	newPage();
	answer = page.askDialog({ title: "Key" });
	page.document.key("Escape");
	assert.equal(await answer, null);
});

test("askDialog: a plain box unless asked to hide it", () => {
	newPage();
	page.askDialog({ title: "Name", value: "Regina" });

	assert.equal(input().type, "text");
	assert.equal(input().value, "Regina", "can start with something in it");
	assert.equal(buttons()[1].disabled, false);
});

// --- Where it's carried ---------------------------------------------------

test("every admin page and the wizard carry it, and only once", async () => {
	helpers.resetState();
	require("../core/admin-face")();
	require("../core/wizard-face")();
	await helpers.waitForPort(3000);
	await helpers.waitForPort(3999);

	for (const port of [3000, 3999]) {
		const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
		const count = html.split("function confirmDialog").length - 1;

		assert.equal(count, 1, `port ${port}`);
		assert.ok(html.includes("function askDialog"), `port ${port}`);
	}
});
