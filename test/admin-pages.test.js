// test/admin-pages.test.js
// Every page under a face, as segments in the Default UI's look, with a
// working way back.
//
// Before v1.19.1 the pages one click deep under a face (a module's
// settings, Add a module, Change theme) were still built from the old
// plain blocks while the pages above them were tiles (segments since
// v1.19.2), and the theme page
// had no back button at all. These check the whole branch, so a page
// added later in the old style shows up here.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir, themesDir } = helpers;
const faceStore = require("../core/face-store");
const { writeSettings, readSettings } = require("../core/settings-store");

const PORT = 3000;

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, "\t"));
}

let face;
let instanceId;
let cookie;

test("setup: a face with a module and a theme that both have settings", async () => {
	resetState();

	const moduleDir = path.join(modulesDir, "tidy");
	writeJson(path.join(moduleDir, "module.json"), { name: "Tidy", description: "A module with settings", provides: ["text"] });
	writeJson(path.join(moduleDir, "settings.json"), {
		settings: [{ key: "city", label: "City", type: "text", default: "Regina" }]
	});
	fs.writeFileSync(
		path.join(moduleDir, "index.js"),
		'module.exports = async () => ({ title: "Tidy", content: [] });'
	);

	const themeDir = path.join(themesDir, "tiles");
	writeJson(path.join(themeDir, "theme.json"), { name: "Tiles Theme" });
	writeJson(path.join(themeDir, "settings.json"), {
		settings: [{ key: "accent", label: "Accent", type: "text", default: "blue" }]
	});
	writeJson(path.join(themeDir, "instance-settings.json"), {
		settings: [{ key: "size", label: "Size", type: "select", options: ["small", "large"], default: "small" }]
	});
	fs.writeFileSync(path.join(themeDir, "index.html"), "<html><body>tiles</body></html>");

	face = faceStore.createFace("Tidy Face", "", "tiles", [{ module: "tidy", config: {} }]);
	instanceId = faceStore.findFace(face.id).instances[0].id;

	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

async function html(url) {
	const response = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers: { cookie } });
	return { status: response.status, text: await response.text() };
}

// The floating back button's destination on a page
function backTarget(page) {
	const match = /class="floating [^"]*"\s+onclick="location\.href='([^']*)'"/.exec(page);
	return match ? match[1] : null;
}

test("every page under a face is segments, with a way back up", async () => {
	const base = `/faces/${face.id}`;
	const instance = `${base}/modules/${encodeURIComponent(instanceId)}`;

	const pages = [
		[base, "/faces"],
		[`${base}/theme`, base],
		[`${base}/theme/change`, `${base}/theme`],
		[`${base}/modules`, base],
		[`${base}/modules/add`, `${base}/modules`],
		[instance, `${base}/modules`]
	];

	for (const [url, back] of pages) {
		const page = await html(url);

		assert.equal(page.status, 200, `${url} answered ${page.status}`);
		assert.ok(page.text.includes('class="bento'), `${url} isn't a bento`);
		assert.ok(page.text.includes('class="segment'), `${url} isn't segments`);
		assert.ok(!page.text.includes('class="tile'), `${url} still has the old box name`);
		assert.ok(!page.text.includes('class="panel'), `${url} still has old plain blocks`);
		assert.equal(backTarget(page.text), back, `${url} should lead back to ${back}`);
	}
});

test("a module's settings page: its own segment, the theme's segment, and Save | Remove", async () => {
	const page = (await html(`/faces/${face.id}/modules/${encodeURIComponent(instanceId)}`)).text;

	assert.ok(page.includes("<h2 style=\"margin-bottom:14px\">Settings</h2>"));
	assert.ok(page.includes("In Tiles Theme"), "the theme's own segment");
	assert.ok(page.includes('data-key="city"'), "the module's field");
	assert.ok(page.includes('data-key="size"') && page.includes('data-scope="theme"'), "the theme's field");

	// Save | Remove in one capsule (the wizard's .dock) under the
	// segments, Remove in red (v1.19.4)
	assert.match(
		page,
		/<div class="page-dock">\s*<div class="dock">\s*<button type="button" id="save">Save<\/button>\s*<button type="button" class="danger" id="remove">Remove<\/button>/
	);
	assert.ok(!page.includes("Remove from this face"));
	assert.ok(!page.includes("glass-danger\" id=\"remove"), "not the old red button");

	// Removing asks first, in the Default UI's own pop-up
	assert.ok(page.includes("confirmDialog({"));
	assert.ok(!page.includes('confirm("Remove'), "not the browser's confirm box");
});

test("a theme without per-module settings leaves the module's segment the whole row", async () => {
	fs.unlinkSync(path.join(themesDir, "tiles", "instance-settings.json"));

	const page = (await html(`/faces/${face.id}/modules/${encodeURIComponent(instanceId)}`)).text;

	assert.ok(!page.includes("In Tiles Theme"));
	assert.ok(page.includes('class="bento-row top"'), "one segment, no two-column row");
});

test("not found: a segment with a way back", async () => {
	const page = await html(`/faces/${face.id}/modules/no-such-instance`);

	assert.equal(page.status, 404);
	assert.ok(page.text.includes('class="bento narrow"'));
	assert.equal(backTarget(page.text), `/faces/${face.id}/modules`);
});

test("signed out: the sign-in page is a segment, and signing in returns to the page asked for", async () => {
	const response = await fetch(`http://127.0.0.1:${PORT}/updates`);
	const page = await response.text();

	assert.ok(page.includes('class="bento narrow"'));
	assert.ok(page.includes("Sign in"));
	assert.ok(page.includes("location.reload()"), "back to /updates, not the home page");
});

test("back button top-left: every page keeps room at the top for it", async () => {
	const settings = readSettings();
	writeSettings({ ...settings, backButtonCorner: "top-left" });

	try {
		const page = (await html(`/faces/${face.id}/modules`)).text;

		assert.ok(page.includes('class="floating top-left"'));
		assert.ok(
			page.includes("body:has(> .floating.top-left) { padding-top: calc(1.5em + 3.4em + 1.5em); }"),
			"room reserved under the button"
		);
	} finally {
		writeSettings({ ...readSettings(), backButtonCorner: "bottom-right" });
	}

	const page = (await html(`/faces/${face.id}/modules`)).text;
	assert.ok(page.includes('class="floating bottom-right"'));
	assert.ok(page.includes("body:has(> .floating.bottom-right) { padding-bottom:"));
});

test("a POST that isn't JSON changes nothing, even signed in", async () => {
	// What a page on another port (a dashboard running a theme's script)
	// can send with the cookie attached: a plain form-style POST
	for (const url of ["/updates/apply", "/updates/check", "/installed/check", `/faces/${face.id}`]) {
		const response = await fetch(`http://127.0.0.1:${PORT}${url}`, {
			method: "POST",
			headers: { cookie, "Content-Type": "text/plain" },
			body: "{}"
		});

		assert.equal(response.status, 415, `${url} answered ${response.status}`);
	}
});