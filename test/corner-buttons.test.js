// test/corner-buttons.test.js
// The round buttons in the top-right corner, since v1.19.7.
//
//   - The Light / Dark / Device switch, on the sign-in page and the
//     welcome face: it shows the choice in force and each tap moves to
//     the next, Device forgetting the browser's choice.
//   - The welcome face's Settings button beside it, which opens the
//     admin face.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const { resetState, waitForPort } = helpers;
const theme = require("../core/ui-theme");
const faceStore = require("../core/face-store");

const ADMIN = 3000;
const WELCOME = 4000;
const COOKIE = "omnicore_ui_mode";

async function html(port, mode) {
	const response = await fetch(`http://127.0.0.1:${port}/`, {
		headers: mode ? { cookie: `${COOKIE}=${mode}` } : {}
	});
	return response.text();
}

// The switch's button tag, as the page has it
function switchTag(page) {
	const match = page.match(/<button type="button" class="floating top-right mode-switch"[^>]*>/);
	assert.ok(match, "the switch is on the page");
	return match[0];
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

// --- The switch --------------------------------------------------------------

test("switch: shows the choice in force, and says what a tap gives", async () => {
	for (const port of [ADMIN, WELCOME]) {
		const device = switchTag(await html(port));
		assert.match(device, /data-mode-current="device"/, `no cookie is Device (${port})`);
		assert.match(device, /aria-label="Appearance: Device\. Tap for Light\."/);

		const light = switchTag(await html(port, "light"));
		assert.match(light, /data-mode-current="light"/);
		assert.match(light, /Tap for Dark\./);

		const dark = switchTag(await html(port, "dark"));
		assert.match(dark, /data-mode-current="dark"/);
		assert.match(dark, /Tap for Device\./);

		// A hand-edited cookie is no choice at all
		assert.match(switchTag(await html(port, "sepia")), /data-mode-current="device"/);
	}
});

test("switch: all three icons are drawn, and the stylesheet shows the one in force", async () => {
	const page = await html(ADMIN);

	for (const icon of ["icon-sun", "icon-moon", "icon-device"]) {
		assert.ok(page.includes(`class="${icon}"`), icon);
	}

	const css = theme.uiStyles();
	assert.match(css, /\.mode-switch svg \{ display: none; \}/);
	assert.match(css, /\.mode-switch\[data-mode-current="light"\] \.icon-sun,/);
	assert.match(css, /\.mode-switch\[data-mode-current="dark"\] \.icon-moon,/);
	assert.match(css, /\.mode-switch\[data-mode-current="device"\] \.icon-device \{ display: block; \}/);
});

// Runs the switch's own script against a stand-in page: a button showing
// `current`, and a setUiMode that records what it was asked for
function tapFrom(current) {
	let clicked;
	let asked;

	const button = {
		getAttribute: (name) => (name === "data-mode-current" ? current : null),
		addEventListener: (event, handler) => {
			if (event === "click") clicked = handler;
		}
	};

	vm.runInNewContext(theme.MODE_SWITCH_SCRIPT, {
		document: { querySelector: () => button },
		setUiMode: (mode) => {
			asked = mode;
		}
	});

	clicked();
	return asked;
}

test("switch: a tap moves Light, then Dark, then Device, then Light again", () => {
	assert.deepEqual(theme.MODE_CHOICES, ["light", "dark", "device"]);
	assert.equal(tapFrom("light"), "dark");
	assert.equal(tapFrom("dark"), "device");
	assert.equal(tapFrom("device"), "light");
});

test("switch: Device forgets the browser's choice", () => {
	// setUiMode with anything but light or dark deletes the cookie
	const set = [];
	const context = { document: {}, location: { reload() {} } };

	Object.defineProperty(context.document, "cookie", {
		set: (value) => set.push(value),
		get: () => ""
	});

	vm.runInNewContext(theme.UI_MODE_SCRIPT + "\nsetUiMode('device');", context);

	assert.equal(set.length, 1);
	assert.match(set[0], new RegExp(`^${COOKIE}=; Path=/; Max-Age=0`));
});

// --- The welcome face --------------------------------------------------------

test("welcome face: the switch in the corner and Settings beside it", async () => {
	const page = await html(WELCOME);

	assert.ok(page.includes('class="floating top-right mode-switch"'));
	assert.match(
		page,
		/<button type="button" class="floating top-right-second corner-button"\s*onclick="goToSettings\(\)" aria-label="Settings" title="Settings">/
	);

	// Settings opens the admin face, on whatever address this page was
	// opened on (faceUrl), which asks to sign in first if need be
	assert.ok(page.includes("function goToSettings() { location.href = faceUrl(3000); }"));

	// And the switch works here: the scripts that set the cookie
	assert.ok(page.includes("function setUiMode"));
	assert.ok(page.includes('getAttribute("data-mode-current")'));
});

test("welcome face: the second button sits one button's width from the corner", () => {
	const css = theme.uiStyles();

	assert.match(css, /\.floating\.top-right \{ top: 1\.5em; right: 1\.5em; \}/);
	assert.match(css, /\.floating\.top-right-second \{ top: 1\.5em; right: calc\(1\.5em \+ 2\.75em \+ 0\.75em\); \}/);
	assert.match(css, /\.mode-switch,\s*\.corner-button \{\s*width: 2\.75em;\s*height: 2\.75em;/);
});
