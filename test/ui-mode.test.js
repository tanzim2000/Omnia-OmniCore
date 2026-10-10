// test/ui-mode.test.js
// Light and dark, since v1.19.2.
//
// Two separate choices live here:
//   - how OmniCore's own pages look, chosen per BROWSER in a cookie
//     (omnicore_ui_mode), following the device until one is picked;
//   - how notifications look on a face's screen, chosen per FACE
//     (notificationMode), dark unless changed.
//
// Plus the two small pieces that came with them: the light/dark switch
// on the sign-in page, and the Show / Hide button on password boxes.

const helpers = require("./helpers");

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");

const { resetState, waitForPort, signIn, themesDir } = helpers;
const theme = require("../core/ui-theme");
const notifications = require("../core/notifications");
const faceStore = require("../core/face-store");
const renderFallbackPage = require("../core/fallback-page");

const PORT = 3000;
const LIGHT_BG = "--bg: " + theme.PALETTES.light.bg;
const DARK_BG = "--bg: " + theme.PALETTES.dark.bg;
let cookie;

// A throwaway theme with one password setting, so the schema renderer's
// password box can be seen on a real page
const TEST_THEME = "ui-mode-test-theme";
const testThemeDir = path.join(themesDir, TEST_THEME);

function writeTestTheme() {
	fs.mkdirSync(testThemeDir, { recursive: true });
	fs.writeFileSync(path.join(testThemeDir, "index.html"), "<html><body></body></html>");
	fs.writeFileSync(path.join(testThemeDir, "theme.json"), JSON.stringify({ name: "UI mode test" }));
	fs.writeFileSync(
		path.join(testThemeDir, "settings.json"),
		JSON.stringify({ settings: [{ key: "token", type: "password", label: "API token" }] })
	);
}

test.after(() => {
	fs.rmSync(testThemeDir, { recursive: true, force: true });
});

async function get(urlPath, extraCookie) {
	const header = [cookie, extraCookie].filter(Boolean).join("; ");
	const response = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
		headers: header ? { cookie: header } : {}
	});

	return { status: response.status, html: await response.text() };
}

// --- The stylesheet on its own ----------------------------------------

test("ui mode: with no choice made, the page carries both and the device picks", () => {
	const css = theme.uiStyles();

	assert.ok(css.includes(DARK_BG), "dark first");
	assert.ok(css.includes("@media (prefers-color-scheme: light)"));
	assert.ok(css.indexOf(LIGHT_BG) > css.indexOf("prefers-color-scheme: light"), "light inside the query");
});

test("ui mode: a forced mode carries only that palette", () => {
	const light = theme.uiStyles({ forceMode: "light" });
	assert.ok(light.includes(LIGHT_BG));
	assert.ok(!light.includes(DARK_BG));
	assert.ok(!light.includes("prefers-color-scheme"));

	const dark = theme.uiStyles({ forceMode: "dark" });
	assert.ok(dark.includes(DARK_BG));
	assert.ok(!dark.includes(LIGHT_BG));
});

test("ui mode: the cookie is read strictly", () => {
	const read = (header) => theme.uiModeFromRequest({ headers: { cookie: header } });

	assert.equal(read("omnicore_ui_mode=light"), "light");
	assert.equal(read("a=b; omnicore_ui_mode=dark; c=d"), "dark");
	assert.equal(read("omnicore_ui_mode=LIGHT"), null, "exactly light or dark");
	assert.equal(read("omnicore_ui_mode=};body{display:none"), null);
	assert.equal(read("other_ui_mode=light"), null);
	assert.equal(read(""), null);
	assert.equal(theme.uiModeFromRequest({ headers: {} }), null);
});

test("ui mode: the setting is gone from a fresh install", () => {
	resetState();
	const { readSettings } = require("../core/settings-store");
	assert.equal(readSettings().uiMode, undefined);
});

// --- Over HTTP ---------------------------------------------------------

test("ui mode: boots", async () => {
	resetState();
	writeTestTheme();
	require("../core/admin-face")();
	await waitForPort(PORT);
});

test("sign-in page: the light/dark switch and the password Show button", async () => {
	// First run: the setup screen shares the same template
	const setup = await get("/");
	assert.ok(setup.html.includes("Set up OmniCore"));
	assert.ok(setup.html.includes("data-mode-switch"), "switch on setup");
	assert.ok(setup.html.includes('class="password-field"'), "password box on setup");
	assert.ok(setup.html.includes('autocomplete="new-password"'));

	cookie = await signIn(PORT);

	// Signed out again: the sign-in screen
	const signedOut = await fetch(`http://127.0.0.1:${PORT}/`);
	const html = await signedOut.text();

	assert.ok(html.includes("data-mode-switch"), "the switch");
	assert.ok(html.includes('class="floating top-right mode-switch"'), "top-right");
	assert.ok(html.includes('class="icon-sun"') && html.includes('class="icon-moon"'));
	assert.ok(html.includes("function setUiMode"), "and the script that sets the cookie");
	assert.ok(
		html.includes('<button type="button" class="password-toggle" data-password-toggle'),
		"Show / Hide inside the password box"
	);
	assert.ok(html.includes('autocomplete="current-password"'));
});

test("ui mode: the page follows this browser's cookie", async () => {
	const none = await get("/");
	assert.ok(none.html.includes("prefers-color-scheme: light"), "no cookie: the device decides");

	const light = await get("/", "omnicore_ui_mode=light");
	assert.ok(light.html.includes(LIGHT_BG));
	assert.ok(!light.html.includes("prefers-color-scheme"));

	const dark = await get("/", "omnicore_ui_mode=dark");
	assert.ok(dark.html.includes(DARK_BG));
	assert.ok(!dark.html.includes(LIGHT_BG));

	const junk = await get("/", "omnicore_ui_mode=purple");
	assert.ok(junk.html.includes("prefers-color-scheme: light"), "junk counts as no choice");
});

test("settings: the Appearance tile has Dark, Light and Device, marked for this browser", async () => {
	const device = await get("/");
	assert.ok(device.html.includes('data-mode="device"'));
	assert.ok(device.html.includes("Device (Active)"), "no cookie: Device");
	assert.ok(!device.html.includes("Dark (Active)"));
	assert.ok(device.html.includes("Saved in this browser only"));

	const light = await get("/", "omnicore_ui_mode=light");
	assert.ok(light.html.includes("Light (Active)"));
	assert.ok(!light.html.includes("Device (Active)"));

	// Picking one sets the cookie in the page; nothing is posted
	assert.ok(light.html.includes("setUiMode(preview.dataset.mode)"));
});

test("face: notifications are dark until changed, and only light or dark is kept", async () => {
	const face = faceStore.createFace("Kitchen", "", TEST_THEME, []);
	assert.equal(face.notificationMode, "dark", "a new face starts dark");

	const page = await get(`/faces/${face.id}`);
	assert.equal(page.status, 200);
	assert.ok(page.html.includes("<h2>Notifications</h2>"));
	assert.ok(page.html.includes('data-note-mode="dark"') && page.html.includes('data-note-mode="light"'));
	assert.ok(page.html.includes("Dark (Active)"));
	assert.ok(!page.html.includes('data-note-mode="device"'), "no Device choice here");

	const post = (body) =>
		fetch(`http://127.0.0.1:${PORT}/faces/${face.id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie },
			body: JSON.stringify(body)
		});

	assert.equal((await post({ notificationMode: "light" })).status, 200);
	assert.equal(faceStore.findFace(face.id).notificationMode, "light");
	assert.equal(faceStore.findFace(face.id).name, "Kitchen", "the name is left alone");

	await post({ notificationMode: "sepia" });
	assert.equal(faceStore.findFace(face.id).notificationMode, "light", "junk ignored");

	const after = await get(`/faces/${face.id}`);
	assert.ok(after.html.includes("Light (Active)"));
});

test("face: the overlay takes the face's mode", () => {
	const fg = (css) => css.match(/--omni-note-fg: ([^;]+);/)[1];

	assert.equal(fg(notifications.overlayStyles("light")), theme.PALETTES.light.fg);
	assert.equal(fg(notifications.overlayStyles("dark")), theme.PALETTES.dark.fg);
	assert.equal(fg(notifications.overlayStyles()), theme.PALETTES.dark.fg, "a face made before v1.19.2");

	const fallback = renderFallbackPage([], { notificationMode: "light" });
	assert.ok(fallback.includes("--omni-note-fg: " + theme.PALETTES.light.fg));
});

test("settings form: a password setting gets the Show button too", async () => {
	const face = faceStore.createFace("Hall", "", TEST_THEME, []);
	const { status, html } = await get(`/faces/${face.id}/theme`);

	assert.equal(status, 200);
	assert.match(
		html,
		/<div class="password-field"><input type="password" data-key="token"[^>]*><button type="button" class="password-toggle"/
	);
});