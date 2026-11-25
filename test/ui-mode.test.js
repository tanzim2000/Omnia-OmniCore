// test/ui-mode.test.js
// In short: White or black text, no Light or Dark
//
// Light and dark, since v1.19.2, and how they went away in 2.0.0.
//
// Two separate choices live here:
//   - how OmniCore's own pages look. Until 2.0.0 that was Light or Dark,
//     chosen per BROWSER in a cookie (omnicore_ui_mode). Now the font
//     colour (Settings, Appearance) picks the everyday colours: white
//     text, the dark set; black text, the light set. The old cookie is
//     never read.
//   - how notifications look on a face's screen, chosen per FACE
//     (notificationMode), dark unless changed. Still here.
//
// Plus the Show / Hide button on password boxes.

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

const { writeSettings } = require("../core/settings-store");

test("ui mode: a fresh install is white text on black, with no device query", () => {
	resetState();
	const css = theme.uiStyles();

	assert.ok(css.includes(DARK_BG), "the dark set");
	assert.ok(!css.includes("prefers-color-scheme"), "the device never decides");
	assert.equal(theme.colourSet(), "dark");
});

test("ui mode: black text on the Default background is Beige Cream", () => {
	resetState();
	writeSettings({ fontColour: "black" });
	const css = theme.uiStyles();
	const root = css.slice(0, css.indexOf(":root.font-white"));

	assert.ok(root.includes(LIGHT_BG), "the light set in force");
	assert.ok(!root.includes(DARK_BG));
	assert.equal(theme.colourSet(), "light");
	assert.ok(root.includes("transform: scale(1.02)"), "a box lifts on a hover rather than glowing");
	resetState();
});

test("ui mode: on the Default background, both sets wait under the font classes", () => {
	// So picking the font colour on the Appearance tab shows the whole
	// page in it before it's saved, by a class and nothing else
	resetState();
	const css = theme.uiStyles();
	const white = css.match(/:root\.font-white \{([^}]*)\}/)[1];
	const black = css.match(/:root\.font-black \{([^}]*)\}/)[1];

	assert.ok(white.includes(DARK_BG));
	assert.ok(black.includes(LIGHT_BG));
	assert.ok(black.includes("--curtain: " + theme.DEFAULT_LIGHT));
	assert.ok(css.includes(":root.font-black .segment.clickable:hover"), "the lift, for black text");
	assert.ok(css.includes(":root.font-white .segment.clickable:hover"), "the glow, for white text");
});

test("ui mode: over a picture the font classes carry only the text's colours", () => {
	resetState();
	writeSettings({ backgroundKind: "colour", backgroundColor: "#3d5a99", backgroundLow: 0.1, backgroundHigh: 0.1, backgroundMean: 0.1 });
	const css = theme.uiStyles();
	const black = css.match(/:root\.font-black \{([^}]*)\}/)[1];

	assert.ok(black.includes("--fg: " + theme.PALETTES.light.fg));
	assert.ok(!black.includes("--bg:"), "the glass and the page stay as they are");

	// The green button (Save) is solid green with white words over a
	// picture or a colour, so it reads over a warm one too
	assert.match(css, /:root \.btn-glossy-green \{\s*color: #fff;\s*background: #17803f;/);
	assert.match(css, /:root \.btn-glossy-green:hover:not\(:disabled\) \{ background: #1c9149; \}/);
	resetState();
	assert.ok(!theme.uiStyles().includes(":root .btn-glossy-green"), "on the Default background it's as it was");
});

test("ui mode: a forced set carries only that palette", () => {
	resetState();
	const light = theme.uiStyles({ forceSet: "light" });
	const lightRoot = light.slice(0, light.indexOf(":root.font-white"));
	assert.ok(lightRoot.includes(LIGHT_BG));
	assert.ok(!lightRoot.includes(DARK_BG));

	const dark = theme.uiStyles({ forceSet: "dark" });
	const darkRoot = dark.slice(0, dark.indexOf(":root.font-white"));
	assert.ok(darkRoot.includes(DARK_BG));
	assert.ok(!darkRoot.includes(LIGHT_BG));
});

test("ui mode: the cookie and the switch are gone", () => {
	assert.equal(theme.uiModeFromRequest, undefined);
	assert.equal(theme.rememberUiMode, undefined);
	assert.equal(theme.modeSwitch, undefined);
	assert.equal(theme.UI_MODE_SCRIPT, undefined);
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

test("sign-in page: no light/dark switch, and the password Show button", async () => {
	// First run: the setup screen shares the same template
	const setup = await get("/");
	assert.ok(setup.html.includes("Set up OmniCore"));
	assert.ok(!setup.html.includes("data-mode-switch"), "no switch on setup");
	assert.ok(setup.html.includes('class="password-field"'), "password box on setup");
	assert.ok(setup.html.includes('autocomplete="new-password"'));

	cookie = await signIn(PORT);

	// Signed out again: the sign-in screen
	const signedOut = await fetch(`http://127.0.0.1:${PORT}/`);
	const html = await signedOut.text();

	assert.ok(!html.includes("data-mode-switch"), "no switch");
	assert.ok(!html.includes("function setUiMode"), "and no script setting a cookie");
	assert.ok(
		html.includes('<button type="button" class="password-toggle" data-password-toggle'),
		"Show / Hide inside the password box"
	);
	assert.ok(html.includes('autocomplete="current-password"'));
});

test("ui mode: a browser's old Light or Dark cookie is never read", async () => {
	const none = await get("/");
	const light = await get("/", "omnicore_ui_mode=light");

	assert.ok(none.html.includes(DARK_BG));
	assert.ok(light.html.includes(DARK_BG), "white text on black, as the font colour says");
	assert.ok(!light.html.includes("prefers-color-scheme"));
});

test("settings: no Appearance Mode box; the font colour is offered on the Default background too", async () => {
	const page = await get("/");
	assert.ok(!page.html.includes('data-mode="device"'));
	assert.ok(!page.html.includes("Device (Active)"));
	assert.ok(page.html.includes("White, on black"), "what the font colour gives here");
	assert.ok(page.html.includes('data-font="black"'), "both to pick from");
	assert.ok(page.html.includes("--swatch-picture:" + theme.DEFAULT_LIGHT), "black text shown on Beige Cream");
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