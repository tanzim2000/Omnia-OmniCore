// test/marketplace-pages.test.js
// The Marketplace pages, drawn in the Default UI (v1.19.2).
//
// marketplace.test.js covers the registry itself -- fetching it, and
// installing from it -- against the real thing. This file is only about
// what the pages show, so the registry is replaced with a small fixed
// one: two modules (one already installed) and one theme. That keeps
// these tests fast, means they never touch the network, and lets them
// make the registry fail on purpose to see the error page.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");

const { resetState, waitForPort, signIn } = helpers;
const marketplace = require("../core/marketplace");

const PORT = 3000;
let cookie;

// The stand-in registry
const REGISTRY = {
	modules: [
		{
			id: "weather",
			name: "Weather",
			author: "tanzim2000",
			description: "Current conditions from Open-Meteo",
			emits: ["pair", "text"],
			repo: "https://github.com/tanzim2000/Omnia-Essentials",
			ref: "fab9118965abcdef",
			installed: true
		},
		{
			id: "world-clock",
			name: "World Clock",
			author: "tanzim2000",
			description: "The current time, here or somewhere else",
			installed: false
		}
	],
	themes: [
		{
			id: "windows8",
			name: "Windows 8",
			author: "tanzim2000",
			description: "Asymmetric tile grid",
			installed: false
		}
	],
	sourceFailures: []
};

const realListAvailable = marketplace.listAvailable;
const realFetchDetailExtras = marketplace.fetchDetailExtras;

// Swapped in for the whole file, and back afterwards. `failing` makes the
// registry unreachable for one test.
let failing = false;

marketplace.listAvailable = async () => {
	if (failing) {
		throw new Error("Connection timed out");
	}

	return JSON.parse(JSON.stringify(REGISTRY));
};

marketplace.fetchDetailExtras = async () => ({
	completeDescription: "First paragraph.\n\nSecond paragraph.",
	screenshots: []
});

test.after(() => {
	marketplace.listAvailable = realListAvailable;
	marketplace.fetchDetailExtras = realFetchDetailExtras;
});

async function get(path) {
	const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
		headers: { Cookie: cookie }
	});

	return { status: response.status, html: await response.text() };
}

test("marketplace pages: boots signed in", async () => {
	resetState();
	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("marketplace home: header, pinned toolbar, and one row per listing", async () => {
	const { status, html } = await get("/marketplace");
	assert.equal(status, 200);

	// The header, with Sources as a glass button
	assert.ok(html.includes('class="segment market-head"'), "the header segment");
	assert.ok(html.includes('<a class="glass market-action" href="/marketplace/sources">Sources</a>'));

	// Search, the shared Modules / Themes switch, and the count, in the
	// shared toolbar row
	assert.ok(html.includes('class="segment toolbar market-toolbar"'), "the toolbar");
	assert.ok(html.includes('class="tabs"'), "the shared switch");
	assert.ok(html.includes("data-market-search"), "the search box");
	assert.ok(html.includes("2 items available"), "the count, for the Modules tab");

	// A row per listing, in the grid that fits as many columns as it can
	assert.ok(html.includes('class="market-list"'));
	assert.equal((html.match(/class="segment clickable market-item"/g) || []).length, 3);
	assert.ok(html.includes('<div class="market-by">by tanzim2000</div>'), "the author line");

	// Installed is a green label, not a button; Install is a glass button
	assert.ok(
		html.includes('<span class="btn-glossy btn-glossy-green market-action">&#10003; Installed</span>'),
		"Installed"
	);
	assert.ok(
		html.includes('<button type="button" class="glass market-action" data-install="world-clock" data-kind="module">Install</button>'),
		"Install"
	);

	// The old grid that scrolled inside itself is gone
	assert.doesNotMatch(html, /market-grid|market-wide|class="btn"/);
});

test("marketplace home: an unreachable registry says so, with a way to retry", async () => {
	failing = true;

	try {
		const { status, html } = await get("/marketplace");
		assert.equal(status, 200, "the page itself still loads");
		assert.ok(html.includes('class="segment market-error"'));
		assert.ok(html.includes("Can't reach the registry"));
		assert.ok(html.includes("Connection timed out"));
		assert.ok(html.includes('onclick="location.reload()">Retry</button>'));
		assert.ok(!html.includes('class="segment toolbar market-toolbar"'), "nothing to search");
	} finally {
		failing = false;
	}
});

test("marketplace: a listing's own page has no inline back link, and its button works", async () => {
	const { status, html } = await get("/marketplace/modules/weather");
	assert.equal(status, 200);

	assert.ok(!html.includes("&larr; Marketplace"), "the floating back button is enough");
	assert.ok(html.includes('class="floating'), "and it's there");
	assert.ok(html.includes('class="market reading"'));
	assert.ok(html.includes("<h1>Weather</h1>"));
	assert.ok(html.includes('href="/marketplace/authors/tanzim2000"'), "the author links to their page");
	assert.ok(html.includes('class="segment market-about"'));
	assert.ok(html.includes("<p>First paragraph.</p><p>Second paragraph.</p>"));
	assert.ok(html.includes("<h2>Emits</h2>") && html.includes("<h2>Source</h2>"));
	assert.ok(html.includes('class="bento-row two top"'), "Emits and Source side by side");
	assert.ok(html.includes("btn-glossy-green market-action"), "Installed");

	const theme = await get("/marketplace/themes/windows8");
	assert.equal(theme.status, 200);
	assert.ok(theme.html.includes('data-install="windows8" data-kind="theme"'));
	assert.ok(theme.html.includes('"/marketplace/install"'), "its Install button is wired up");
	assert.ok(!theme.html.includes("<h2>Emits</h2>"), "a theme emits nothing");
});

test("marketplace: an author's page groups their listings, and Install works there too", async () => {
	const { status, html } = await get("/marketplace/authors/tanzim2000");
	assert.equal(status, 200);

	assert.ok(html.includes("<h1>tanzim2000</h1>"));
	assert.ok(html.includes("3 listed"));
	assert.ok(html.includes('<h2 class="market-section">Modules</h2>'));
	assert.ok(html.includes('<h2 class="market-section">Themes</h2>'));

	// Before v1.19.2 this page sent no script, so its Install buttons
	// did nothing when clicked
	assert.ok(html.includes('"/marketplace/install"'), "the install script is on the page");

	const nobody = await get("/marketplace/authors/nobody");
	assert.equal(nobody.status, 200);
	assert.ok(nobody.html.includes("Nothing listed by nobody."));
	assert.ok(!nobody.html.includes('class="market-section"'), "no empty headings");
});

test("marketplace: pages that need the registry show the retry box when it's down", async () => {
	failing = true;

	try {
		for (const path of ["/marketplace/modules/weather", "/marketplace/authors/tanzim2000"]) {
			const { status, html } = await get(path);
			assert.equal(status, 502, path);
			assert.ok(html.includes('class="segment market-error"'), path);
			assert.ok(html.includes(">Retry</button>"), path);
		}
	} finally {
		failing = false;
	}
});

test("marketplace sources: segments, the shared toolbar row, and the warning", async () => {
	const { status, html } = await get("/marketplace/sources");
	assert.equal(status, 200);

	assert.ok(html.includes('class="market reading"'));
	assert.ok(html.includes('class="market-source"'), "one line per registry");
	assert.ok(html.includes('<div class="toolbar">'), "the address box and its button share a row");
	assert.ok(html.includes('class="glass market-action" data-reveal-warning'));
	assert.ok(html.includes('class="market-warning" data-warning hidden'));
	assert.ok(html.includes('class="btn-glossy btn-glossy-green" data-warning-cancel'));
	assert.ok(html.includes('class="market-warning-actions"'));
	assert.doesNotMatch(html, /class="btn"|market-wide|style="display: flex/);
});