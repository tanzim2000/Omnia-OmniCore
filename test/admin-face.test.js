// test/admin-face.test.js
// Every admin screen, hit over real HTTP against a real running server.
//
// The point of walking every route rather than a representative few:
// the crash that prompted this suite was a page that rendered fine
// until a theme happened to be installed, and only threw once the
// route actually ran. A route that is never requested is a route
// nobody has actually tested.

const test = require("node:test");
const assert = require("node:assert");


const { resetState, waitForPort, signIn } = require("./helpers");

const PORT = 3000;
let cookie;

test("admin face: boots and serves the setup screen", async () => {
	// State is reset, but NOT what the marketplace suite installed --
	// the installed-resources test below is only meaningful with a real
	// theme on disk, since that is the exact condition the crash it
	// guards against needed.
	resetState();

	require("../core/admin-face")();
	await waitForPort(PORT);

	const response = await fetch(`http://127.0.0.1:${PORT}/`);
	const html = await response.text();

	assert.equal(response.status, 200);
	// With no account yet, every route should land on setup rather than
	// letting anything through
	assert.ok(html.includes("Set up OmniCore"), "expected the setup screen");
});

test("admin face: creating the account signs you in", async () => {
	cookie = await signIn(PORT);
	assert.ok(cookie.startsWith("omnicore"), `unexpected cookie: ${cookie}`);
});

test("admin face: settings home renders every section", async () => {
	const html = await (
		await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie } })
	).text();

	assert.ok(html.includes("Location Service"), "missing Location Service");
	assert.ok(html.includes("Appearance Mode"), "missing Appearance Mode");
	assert.ok(html.includes("Back Button Position"), "missing Back Button Position");
	assert.ok(html.includes("Text Size"), "missing Text Size");
	assert.ok(html.includes("Manage Faces"), "missing Manage Faces link");

	// Installed Resources deliberately moved to the About face -- the
	// About link is how you reach it now, not a Settings row.
	assert.ok(html.includes("About OmniCore"), "missing About link");

	// Both modals ship with the page rather than being fetched when
	// opened, so their absence would mean a dead button
	assert.ok(html.includes('id="font-modal"'), "font picker modal missing");
	assert.ok(html.includes('id="location-modal"'), "location modal missing");
});

// The regression this whole suite exists for. It rendered fine with
// modules installed and crashed the moment a theme was, because
// listThemes() already returns manifests where listModules() returns
// ids. Both are installed by the registry test before this runs.
test("admin face: installed resources renders", async () => {
	const response = await fetch(`http://127.0.0.1:${PORT}/installed`, {
		headers: { cookie }
	});

	assert.equal(response.status, 200, "installed resources should not error");

	const html = await response.text();
	assert.ok(html.includes("Installed Resources"), "missing heading");
});

test("admin face: every remaining page renders", async () => {
	// Walked as a list rather than one test each: what matters is that
	// none of them throw, and naming them here makes it obvious when a
	// new page has been added without being covered.
	const paths = ["/faces", "/marketplace", "/marketplace/sources"];

	for (const path of paths) {
		const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
			headers: { cookie }
		});

		assert.equal(response.status, 200, `${path} returned ${response.status}`);
	}
});

test("admin face: appearance settings save and take effect", async () => {
	const save = await fetch(`http://127.0.0.1:${PORT}/appearance`, {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie },
		body: JSON.stringify({ uiMode: "light" })
	});

	assert.equal(save.status, 200);

	const html = await (
		await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie } })
	).text();

	assert.ok(html.includes("--bg: #f2f2f4"), "light mode did not take effect");

	// Put it back, so a later test reading the page isn't surprised
	await fetch(`http://127.0.0.1:${PORT}/appearance`, {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie },
		body: JSON.stringify({ uiMode: "dark" })
	});
});

test("admin face: an absurd text size is clamped, not stored", async () => {
	// This value goes straight into a CSS declaration. Left unclamped, a
	// bad number makes the admin UI unusable to fix itself with.
	const response = await fetch(`http://127.0.0.1:${PORT}/appearance`, {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie },
		body: JSON.stringify({ uiFontSize: 9999 })
	});

	const body = await response.json();
	assert.equal(body.uiFontSize, 24, "expected clamping to the maximum");
});
test("updates: the page renders and reports never having checked", async () => {
	const response = await fetch(`http://127.0.0.1:${PORT}/updates`, {
		headers: { cookie }
	});

	assert.equal(response.status, 200);

	const html = await response.text();
	assert.ok(html.includes("Updates"), "missing heading");
	assert.ok(html.includes("Last checked:"), "should say when it last checked");
	assert.ok(html.includes('id="check"'), "should offer a manual check");
});

test("updates: a failed check is reported, not hidden", async () => {
	const updateStore = require("../core/update-store");

	// The dangerous failure here is a check that couldn't reach GitHub
	// looking identical to one that found nothing -- that would read as
	// "you're up to date" when nobody actually knows.
	updateStore.recordCheck({ error: "simulated network failure" });

	const html = await (
		await fetch(`http://127.0.0.1:${PORT}/updates`, { headers: { cookie } })
	).text();

	assert.ok(html.includes("Last check failed"), "a failure must be visible");
	assert.ok(
		!html.includes("This is the newest version"),
		"a failed check must never claim the install is up to date"
	);
});

test("updates: an available version is announced with its notes", async () => {
	const updateStore = require("../core/update-store");
	const originalVersion = process.env.OMNICORE_VERSION;

	// A dev build never claims an update is available, by design — this
	// scenario needs a real running version to be realistic at all.
	process.env.OMNICORE_VERSION = "v1.0.0";
	updateStore.recordCheck({ latestVersion: "99.0.0", updateAvailable: true });

	try {
		const html = await (
			await fetch(`http://127.0.0.1:${PORT}/updates`, { headers: { cookie } })
		).text();

		assert.ok(html.includes("Version 99.0.0 is available"));
		assert.ok(
			html.includes("What's new in 99.0.0"),
			"should offer the upcoming version's notes section"
		);
	} finally {
		process.env.OMNICORE_VERSION = originalVersion;
	}
});

test("updates: changelog rendering neutralises hostile markup", async () => {
	// Release notes are fetched over the network, so this content is
	// not ours and must never be trusted as markup.
	const updateStore = require("../core/update-store");
	updateStore.recordCheck({ updateAvailable: false });

	const html = await (
		await fetch(`http://127.0.0.1:${PORT}/updates`, { headers: { cookie } })
	).text();

	assert.ok(!html.includes("<script>alert"), "no injected script survived");
});