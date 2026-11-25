// test/corner-buttons.test.js
// In short: The round button in the top corner
//
// The round button in the top-right corner, since v1.19.7.
//
//   - The welcome face's Settings button, a gear, which opens the admin
//     face. It sits in the corner itself since 2.0.0.
//   - The Light / Dark / Device switch that sat beside it (and on the
//     sign-in page) is gone: Light and Dark went away in 2.0.0, and the
//     font colour picks the everyday colours instead.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");

const { resetState, waitForPort } = helpers;
const theme = require("../core/ui-theme");
const faceStore = require("../core/face-store");

const ADMIN = 3000;
const WELCOME = 4000;

async function html(port) {
	const response = await fetch(`http://127.0.0.1:${port}/`);
	return response.text();
}

test("boots the admin face (signed out) and the welcome face", async () => {
	resetState();
	// Two faces, so the welcome face lists them rather than heading
	// straight for the only one
	faceStore.createFace("", "", null, []);
	faceStore.createFace("", "", null, []);

	require("../core/admin-face")();
	require("../core/control-face")();
	await waitForPort(ADMIN);
	await waitForPort(WELCOME);
});

// --- The switch is gone ------------------------------------------------------

test("switch: on neither the sign-in page nor the welcome face", async () => {
	for (const port of [ADMIN, WELCOME]) {
		const page = await html(port);
		assert.ok(!page.includes("mode-switch"), `no switch (${port})`);
		assert.ok(!page.includes("data-mode-current"));
		assert.ok(!page.includes("function setUiMode"), "and no script setting a cookie");
	}

	const css = theme.uiStyles();
	assert.ok(!css.includes(".mode-switch"), "nor its rules");
	assert.ok(!css.includes(".top-right-second"));
});

// --- The welcome face --------------------------------------------------------

test("welcome face: Settings in the corner", async () => {
	const page = await html(WELCOME);

	assert.match(
		page,
		/<button type="button" class="floating top-right corner-button"\s*onclick="goToSettings\(\)" aria-label="Settings" title="Settings">/
	);

	// Settings opens the admin face, on whatever address this page was
	// opened on (faceUrl), which asks to sign in first if need be
	assert.ok(page.includes("function goToSettings() { omniGo(faceUrl(3000)); }"), "with the page fade since v2");
});

test("welcome face: the corner button's place and size", () => {
	const css = theme.uiStyles();

	assert.match(css, /\.floating\.top-right \{ top: 1\.5em; right: 1\.5em; \}/);
	assert.match(css, /\.corner-button \{\s*width: 2\.75em;\s*height: 2\.75em;/);
});
