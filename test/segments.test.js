// test/segments.test.js
// One box, one name, in one place.
//
// Before v1.19.2 the same box was written three times under two names:
// .card in ui-theme.js, .tile in admin-face.js, and another .tile in
// wizard-face.js -- same colour, same border, same corners, slightly
// different padding. They're one .segment now, defined once in
// ui-theme.js, so changing how every box looks (its colour, frosted
// glass) is one change in one file.
//
// These read the source files as well as the pages, because the way
// this goes wrong again is someone writing a fresh "box" rule into one
// face's own stylesheet. That shows up in the source long before it
// shows up as a page that looks slightly different from the others.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort } = helpers;

const core = path.join(__dirname, "..", "core");

// Every file that draws the Default UI. about-face.css is here for the
// units check; it's left out of the name checks on purpose, since the
// About page's own small boxes are called .card.
const UI_FILES = [
	"ui-theme.js",
	"admin-face.js",
	"wizard-face.js",
	"control-face.js",
	"input-face-page.js",
	"fallback-page.js",
	"notifications.js"
];

function source(file) {
	return fs.readFileSync(path.join(core, file), "utf8");
}

test("the shared theme defines the segment, with frosted glass off by default", () => {
	resetState();
	const { uiStyles } = require("../core/ui-theme");
	const css = uiStyles();

	assert.match(css, /\n\t\.segment \{/, "the segment rule");
	assert.match(css, /\.segment\.clickable:hover/, "the clickable kind glows or lifts");
	assert.match(css, /--segment-bg: /);
	assert.match(css, /--segment-border: /);
	assert.match(css, /--segment-blur: none;/, "flat until someone turns frosting on");
	assert.match(css, /backdrop-filter: var\(--segment-blur\)/);
});

test("no face writes its own box any more", () => {
	for (const file of UI_FILES) {
		const text = source(file);

		// A rule for the old names: ".tile {", ".card {", ".tile h2", ...
		assert.doesNotMatch(text, /^\s*\.(tile|card)\b[^-\n]*\{/m, `${file} still styles an old box name`);
		// The old names used in markup
		assert.doesNotMatch(text, /class="(tile|card)\b/, `${file} still uses an old box name in a page`);
		assert.doesNotMatch(text, /'<div class="tile/, `${file} still builds an old box name`);
		// The old colour variables
		assert.doesNotMatch(text, /--card-(bg|border)/, `${file} still reads an old colour variable`);
	}
});

test("padding and corners are in em, so they grow with the text size setting", () => {
	// px stays fine for borders, shadows and the like -- only padding
	// and corner radius were moved. A px value here would stay the same
	// size while the text around it grows.
	const files = [...UI_FILES, "about-face.css"];

	for (const file of files) {
		const offenders = source(file)
			.split("\n")
			.map((line, index) => ({ line, number: index + 1 }))
			.filter(({ line }) => /(padding[\w-]*|radius)\s*:[^;"]*\d+px/.test(line));

		assert.deepEqual(
			offenders.map(({ number, line }) => `${file}:${number}: ${line.trim()}`),
			[],
			`${file} still has px padding or radius`
		);
	}
});

test("about face: its small fact boxes are .card, in its own stylesheet", async () => {
	process.env.OMNICORE_VERSION = "v1.19.2-test";
	require("../core/about-face")();
	await waitForPort(1303);

	const html = await (await fetch("http://127.0.0.1:1303/")).text();
	assert.ok(html.includes('class="cards"'), "the row of cards");
	assert.ok(html.includes('class="card"'), "a plain card");
	assert.ok(html.includes('class="card card-button" id="resources-card"'), "the one that leads somewhere");
	assert.ok(html.includes('class="card-label"') && html.includes('class="card-value"'));
	assert.doesNotMatch(html, /class="stats?\b/, "nothing left under the old name");

	const css = await (await fetch("http://127.0.0.1:1303/about.css")).text();
	assert.match(css, /^\.card \{/m);
	assert.match(css, /backdrop-filter: var\(--segment-blur\)/, "frosted glass reaches it too");
	assert.match(css, /var\(--segment-bg\)/, "and the shared colours");
	assert.doesNotMatch(css, /\.stat\b/);
});

test("the coloured buttons and the toolbar row live in the shared theme", () => {
	const { uiStyles } = require("../core/ui-theme");
	const css = uiStyles();

	assert.match(css, /\n\t\.btn-glossy \{/, "the coloured button");
	assert.match(css, /\n\t\.btn-glossy-green \{/);
	assert.match(css, /\n\t\.btn-glossy-neutral \{/);
	assert.match(css, /\n\t\.toolbar \{/, "the toolbar row");
	assert.match(css, /\n\t\.toolbar-note \{/);

	// The green button reads its own colours, so making it calmer never
	// dims "good" status text or a switch that's turned on
	assert.match(css, /--success-button: /);
	assert.match(css, /background: var\(--success-button\);/);
	assert.match(css, /--success: #3ed67a;/, "dark-mode status green unchanged");

	// Defined once: not again in the admin face's own stylesheet, along
	// with the old one-off .btn and its own copy of the tab switch
	const admin = source("admin-face.js");
	assert.doesNotMatch(admin, /^\s*\.btn-glossy[\w-]*\s*\{/m, "admin-face.js redefines .btn-glossy");
	assert.doesNotMatch(admin, /^\s*\.btn\s*\{/m, "admin-face.js still has its own .btn");
	assert.doesNotMatch(admin, /^\s*\.tab-btn\b[^{]*\{/m, "admin-face.js still restyles the tab switch");
});

test("the green button: glossy and darker in dark mode, flat with white text in light", () => {
	const { PALETTES } = require("../core/ui-theme");

	assert.match(PALETTES.dark.successButton, /#1f9a53.*#177a41/);
	assert.notEqual(PALETTES.dark.successButtonShadow, "none");

	assert.equal(PALETTES.light.successButton, "#2fae63");
	assert.equal(PALETTES.light.successButtonText, "#fff");
	assert.equal(PALETTES.light.successButtonShadow, "none");
});

test("theme: a capsule section can be marked dangerous, red with a red halo", () => {
	const { uiStyles } = require("../core/ui-theme");
	const css = uiStyles();

	assert.match(css, /\.dock button\.danger \{ color: var\(--danger\); \}/);
	assert.match(
		css,
		/\.dock button\.danger:hover,\s*\.dock button\.danger:focus-visible \{[^}]*color-mix\(in srgb, var\(--danger\) 55%, transparent\)/
	);
	assert.match(css, /\.dock button:disabled \{/, "Save while saving looks pressed-out");
});