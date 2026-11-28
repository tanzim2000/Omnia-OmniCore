// test/getting-started.test.js
// In short: Face:3999's wizards, and the admin password
//
// Phase C of 2.0.0: the wizards live on Face:3999, each at its own
// address, and OmniCore has an admin password rather than an account.
//
//   - 3999/create-dashboard is Create Dashboard (the face wizard); its old
//     address still arrives there; 3999/ on its own says it's nothing
//   - signing in is a password only; an install from before keeps its
//     password, whatever username it had

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { resetState, waitForPort } = helpers;
const paths = require("../core/paths");
const auth = require("../core/admin-auth");

async function get(port, address, options) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, { redirect: "manual", ...(options || {}) });
	return { status: response.status, location: response.headers.get("location"), html: await response.text() };
}

async function post(port, address, body) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body || {})
	});
	return { status: response.status, body: await response.json().catch(() => ({})), cookie: response.headers.get("set-cookie") };
}

test("boots the admin face, the welcome face and the wizards", async () => {
	resetState();
	require("../core/admin-face")();
	require("../core/control-face")();
	require("../core/wizard-face")();
	await waitForPort(3000);
	await waitForPort(3999);
	await waitForPort(4000);
});

// --- Face:3999's addresses ----------------------------------------------------

test("3999: Create Dashboard at its own address, the old one arriving there", async () => {
	const wizard = await get(3999, "/create-dashboard");
	assert.equal(wizard.status, 200);
	assert.ok(wizard.html.includes('class="wizard-page"'));

	const old = await get(3999, "/faces/new");
	assert.equal(old.status, 302);
	assert.equal(old.location, "/create-dashboard");
});

test("3999: the port on its own isn't an address, and says so", async () => {
	const nothing = await get(3999, "/");
	assert.equal(nothing.status, 404);
	assert.ok(nothing.html.includes("There's nothing at this address"));
	assert.ok(nothing.html.includes("that's a bug"));
	assert.ok(nothing.html.includes("function faceUrl(port)"), "its button can reach the dashboards");
});

test("3999: nothing in OmniCore sends anyone to the port on its own", () => {
	for (const file of ["admin-face.js", "control-face.js", "wizard-face.js"]) {
		const source = fs.readFileSync(path.join(__dirname, "..", "core", file), "utf-8");
		assert.doesNotMatch(source, /faceUrl\(\$\{WIZARD_PORT\}\)(?! \+ "\/(create-dashboard|getting-started))/, file);
		assert.ok(!source.includes('faceUrl(${WIZARD_PORT}) + "/faces/new"'), file);
	}
});

// --- The admin password ------------------------------------------------------------

test("password: made once, with no username, and it signs in", async () => {
	const page = await get(3000, "/");
	assert.ok(page.html.includes("Make the admin password"));
	assert.ok(!page.html.includes('id="username"'), "no username");

	assert.equal((await post(3000, "/setup", { password: "short" })).status, 400);
	const made = await post(3000, "/setup", { password: "a-long-password-1" });
	assert.equal(made.status, 200);
	assert.match(made.cookie, /^omnicore_session=/);

	const saved = JSON.parse(fs.readFileSync(path.join(paths.dataDir(), "admin.json"), "utf-8"));
	assert.deepEqual(Object.keys(saved).sort(), ["hash", "salt"], "a password's hash, nothing else");
	assert.equal((await post(3000, "/setup", { password: "another-password-2" })).status, 400, "only once");

	assert.equal((await post(3000, "/login", { password: "wrong-password" })).status, 401);
	assert.equal((await post(3000, "/login", { password: "a-long-password-1" })).status, 200);

	const signIn = await get(3000, "/");
	assert.ok(signIn.html.includes('autocomplete="current-password"'));
	assert.ok(!signIn.html.includes('id="username"'));
});

test("password: an install from before keeps its password, whatever its username", async () => {
	// admin.json as an older OmniCore wrote it
	const salt = crypto.randomBytes(16).toString("hex");
	fs.writeFileSync(
		path.join(paths.dataDir(), "admin.json"),
		JSON.stringify({ username: "tanzim", salt, hash: crypto.scryptSync("old-password-123", salt, 64).toString("hex") })
	);

	assert.equal(auth.verify("old-password-123"), true);
	assert.equal(auth.verify("tanzim"), false);
	assert.equal((await post(3000, "/login", { password: "old-password-123" })).status, 200);
	// An older sign-in page still sending a username is fine too
	assert.equal((await post(3000, "/login", { username: "anything", password: "old-password-123" })).status, 200);
	assert.equal(auth.verifyPassword("old-password-123"), true);
});

// --- The datasheet ---------------------------------------------------------------

const gettingStarted = require("../core/getting-started");
const { wifiWords } = require("../core/getting-started-page");
const theme = require("../core/ui-theme");

function sheetFile() {
	return gettingStarted.datasheetPath();
}

function writeSheet(sheet) {
	fs.writeFileSync(sheetFile(), JSON.stringify(sheet));
}

test("datasheet: every step to do on a fresh install, Welcome first and Done last", () => {
	fs.rmSync(path.join(paths.dataDir(), "admin.json"), { force: true });
	fs.rmSync(sheetFile(), { force: true });

	assert.equal(gettingStarted.needed(), true);
	assert.deepEqual(gettingStarted.plan(), ["welcome", "admin-password", "wifi", "location", "updates", "look", "modules", "first-dashboard", "done"]);
});

test("datasheet: a step is done by its record at its version, or by checking for itself", () => {
	writeSheet({ steps: { welcome: { version: 1 }, wifi: { version: 1 }, location: { version: 0 } } });
	// Welcome seen (the wizard carrying on), Wi-Fi done, Location's record an older version's
	assert.deepEqual(gettingStarted.plan(), ["admin-password", "location", "updates", "look", "modules", "first-dashboard", "done"]);

	// The admin password is checked for real, whatever the record says
	writeSheet({ steps: { "admin-password": { version: 1 } } });
	assert.ok(gettingStarted.plan().includes("admin-password"));
	auth.createAdmin("a-long-password-1");
	assert.ok(!gettingStarted.plan().includes("admin-password"));

	// Only the step that can be skipped can be
	assert.throws(() => gettingStarted.record("wifi", { skipped: true }), /can't be skipped/);
	assert.throws(() => gettingStarted.record("nonsense"), /no step/);
});

test("datasheet: Done lets the device go and says Welcome again next time", () => {
	writeSheet({ steps: { welcome: { version: 1 } }, holder: { token: "x", seen: Date.now() } });
	for (const id of ["wifi", "location", "updates", "look", "first-dashboard"]) gettingStarted.record(id);
	assert.equal(gettingStarted.needed(), true, "Modules is still to do");
	gettingStarted.record("modules", { skipped: true });
	assert.equal(gettingStarted.readDatasheet().steps.modules.skipped, true, "skipping counts as done");
	assert.equal(gettingStarted.needed(), false, "Welcome and Done alone are never a reason to run");
	gettingStarted.record("done");

	const sheet = gettingStarted.readDatasheet();
	assert.equal(sheet.holder, null);
	assert.equal(sheet.steps.welcome, undefined);
	assert.equal(sheet.steps.done.version, 1);
	assert.deepEqual(gettingStarted.plan(), []);
});

// --- One device at a time ----------------------------------------------------------

function cookieOf(response) {
	return (response.headers.get("set-cookie") || "").split(",").map((one) => one.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function page(port, address, cookie) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, { headers: { accept: "text/html", cookie: cookie || "" }, redirect: "manual" });
	return { status: response.status, html: await response.text() };
}

async function claim(port, password, cookie) {
	return fetch(`http://127.0.0.1:${port}/getting-started/claim`, {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: cookie || "" },
		body: JSON.stringify({ password })
	});
}

let holder = "";

test("gate: on a fresh install, every page asks to connect, and nothing else gets through", async () => {
	process.env.OMNICORE_GETTING_STARTED = "on";
	fs.rmSync(path.join(paths.dataDir(), "admin.json"), { force: true });
	fs.rmSync(sheetFile(), { force: true });

	for (const port of [3000, 3999, 4000]) {
		const { status, html } = await page(port, "/");
		assert.equal(status, 423, `port ${port}`);
		assert.ok(html.includes("Please connect to your OmniCore with a browser or via OmniSync to get started."));
		assert.ok(html.includes(">Okay</button>"));
		assert.ok(!html.includes('id="password"'), "no password to ask for yet");
		assert.ok(html.includes("prefers-color-scheme: light"), "following the device's own setting");
	}

	const api = await fetch("http://127.0.0.1:3000/faces", { headers: { accept: "application/json" } });
	assert.equal(api.status, 423);
	assert.equal((await fetch("http://127.0.0.1:3000/ui-font.woff2")).status, 404, "what a page draws with stays open");
});

test("gate: Okay makes this browser the one, and other screens are told", async () => {
	const okay = await claim(4000);
	assert.equal(okay.status, 200);
	holder = cookieOf(okay);
	assert.match(holder, /^omnicore_setup=[0-9a-f]{64}$/);
	assert.match(okay.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Path=\//);

	// The holder: from any page, back to the wizard; the wizard itself
	const elsewhere = await page(3000, "/", holder);
	assert.ok(elsewhere.html.includes('location.replace(faceUrl(3999) + "/getting-started")'));
	const wizard = await page(3999, "/getting-started", holder);
	assert.equal(wizard.status, 200);
	assert.ok(wizard.html.includes('<body class="getting-started">'));
	assert.ok(wizard.html.includes('data-step="welcome"') && wizard.html.includes('data-step="admin-password"'));
	assert.ok(!wizard.html.includes("<div class=\"omni-backdrop\""), "nothing behind it");

	// Anyone else
	const other = await page(4000, "/");
	assert.ok(other.html.includes("OmniCore is being set up on another device."));
	assert.ok(other.html.includes(">Use this screen instead</button>"));
	const wizardForOther = await page(3999, "/getting-started");
	assert.equal(wizardForOther.status, 423);
});

test("gate: once the password exists, taking over asks for it", async () => {
	const made = await fetch("http://127.0.0.1:3999/getting-started/password", {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: holder },
		body: JSON.stringify({ password: "a-long-password-1" })
	});
	assert.equal(made.status, 200);
	assert.match(made.headers.get("set-cookie"), /omnicore_session=/, "and the device making it is signed in");

	const other = await page(4000, "/");
	assert.ok(other.html.includes('id="password"'));
	assert.equal((await claim(4000, "wrong-password")).status, 403);

	const taken = await claim(4000, "a-long-password-1");
	assert.equal(taken.status, 200);
	const before = holder;
	holder = cookieOf(taken);
	assert.equal((await page(3999, "/getting-started", before)).status, 423, "the first device has to ask again");
	assert.equal((await page(3999, "/getting-started", holder)).status, 200);
});

test("gate: a device that goes quiet lets go", () => {
	const sheet = gettingStarted.readDatasheet();
	sheet.holder.seen = Date.now() - gettingStarted.IDLE_MS - 1000;
	writeSheet(sheet);
	assert.equal(gettingStarted.holderState({ headers: { cookie: holder } }), "free");
	sheet.holder.seen = Date.now();
	writeSheet(sheet);
	assert.equal(gettingStarted.holderState({ headers: { cookie: holder } }), "holder");
});

// --- The steps --------------------------------------------------------------------------

async function step(body) {
	const response = await fetch("http://127.0.0.1:3999/getting-started/step", {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: holder },
		body: JSON.stringify(body)
	});
	return response.status;
}

test("steps: recorded one at a time, and the wizard carries on from there", async () => {
	assert.equal(await step({ id: "welcome" }), 200);
	assert.equal(await step({ id: "wifi", skipped: true }), 400, "not the one that can be skipped");
	assert.equal(await step({ id: "wifi" }), 200);

	const location = await fetch("http://127.0.0.1:3999/getting-started/location", {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: holder },
		body: JSON.stringify({ locationEnabled: true, locationMode: "manual", locationLabel: "Regina", latitude: "50.45", longitude: "-104.61" })
	});
	assert.equal(location.status, 200);
	const { readSettings } = require("../core/settings-store");
	assert.equal(readSettings().latitude, 50.45);
	assert.equal(await step({ id: "location" }), 200);

	// A reload: on at Updates, without Welcome
	const wizard = await page(3999, "/getting-started", holder);
	assert.ok(!wizard.html.includes('data-step="welcome"'));
	assert.ok(!wizard.html.includes('data-step="location"'));
	assert.match(wizard.html, /var PLAN = \["updates","look","modules","first-dashboard","done"\]/);
});

test("steps: Updates, then Done opens OmniCore again", async () => {
	const checked = await fetch("http://127.0.0.1:3999/getting-started/updates/check", { method: "POST", headers: { cookie: holder } });
	assert.equal(checked.status, 200);
	assert.match((await checked.json()).line, /development build/);

	assert.equal(await step({ id: "updates" }), 200);

	// Your look: the Appearance tab itself, its routes under
	// /getting-started, for this device only
	const look = await page(3999, "/getting-started", holder);
	assert.ok(look.html.includes('<section class="gs-sheet gs-wide" data-step="look"'));
	assert.ok(look.html.includes('<div class="home-bento">'));
	assert.ok(look.html.includes('id="glass"') && look.html.includes('id="background"') && look.html.includes('id="size"'));
	assert.ok(look.html.includes('const BASE = "/getting-started";'));
	assert.ok(look.html.includes('id="background-modal"') && look.html.includes('id="font-modal"'), "its pop-ups");
	assert.ok(!look.html.includes('id="open-profiles"'), "no profile strip: this is the first");
	assert.ok(look.html.includes("window.omniAppearanceSave"), "Next saves what Save would");

	const colour = await fetch("http://127.0.0.1:3999/getting-started/background/colour", {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: holder },
		body: JSON.stringify({ color: "#3d5a99" })
	});
	assert.equal(colour.status, 200);
	const { readSettings } = require("../core/settings-store");
	assert.equal(readSettings().backgroundColor, "#3d5a99");
	const stranger = await fetch("http://127.0.0.1:3999/getting-started/background/colour", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ color: "#ff0000" })
	});
	assert.equal(stranger.status, 423, "nobody else");
	assert.equal(await step({ id: "look" }), 200);

	// Modules: the one that can be skipped
	assert.equal(await step({ id: "modules", skipped: true }), 200);

	// First dashboard: what it can be made of, and making it
	const parts = await (await fetch("http://127.0.0.1:3999/getting-started/dashboard", { headers: { cookie: holder } })).json();
	assert.equal(typeof parts.existing, "number");
	assert.ok(Array.isArray(parts.themes) && Array.isArray(parts.modules));
	const badTheme = await fetch("http://127.0.0.1:3999/getting-started/dashboard", {
		method: "POST",
		headers: { "Content-Type": "application/json", cookie: holder },
		body: JSON.stringify({ name: "Hallway", theme: "no-such-theme", modules: [] })
	});
	assert.equal(badTheme.status, 400);
	if (parts.themes.length) {
		const faceStore = require("../core/face-store");
		const before = faceStore.readFaces().length;
		const made = await fetch("http://127.0.0.1:3999/getting-started/dashboard", {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie: holder },
			body: JSON.stringify({ name: "Hallway", theme: parts.themes[0].id, modules: parts.modules.map((each) => each.id).concat("not-installed") })
		});
		assert.equal(made.status, 200);
		const faces = faceStore.readFaces();
		assert.equal(faces.length, before + 1);
		assert.equal(faces[faces.length - 1].name, "Hallway");
		assert.ok(!faces[faces.length - 1].instances.some((each) => each.module === "not-installed"), "only what's installed");
	}
	assert.equal(await step({ id: "first-dashboard" }), 200);

	assert.equal(await step({ id: "done" }), 200);
	assert.equal(gettingStarted.needed(), false);

	const open = await page(4000, "/");
	assert.equal(open.status, 200, "every page open again");
	const after = await page(3999, "/getting-started");
	assert.ok(after.html.includes("OmniCore is set up. Taking you to Settings"));
	assert.equal(await step({ id: "wifi" }), 409, "and the wizard's routes refuse");
	process.env.OMNICORE_GETTING_STARTED = "off";
});

// --- Pieces -----------------------------------------------------------------------------

test("pieces: from the Look step on, the page is in the profile's own look", () => {
	const { ownLook } = require("../core/getting-started-page");
	assert.equal(ownLook(["look", "modules", "done"]), true);
	assert.equal(ownLook(["first-dashboard", "done"]), true);
	assert.equal(ownLook(["updates", "look", "done"]), false, "the device's own until then");
	assert.equal(ownLook(["welcome", "admin-password", "done"]), false);
});

test("pieces: the Wi-Fi step's words", () => {
	assert.equal(wifiWords({ available: true, card: { connected: true, ssid: "Home", bars: 4 } }).line, "Connected to Home, with a strong signal.");
	assert.equal(wifiWords({ available: true, card: { connected: true, ssid: "Home", bars: 1 } }).line, "Connected to Home, with a weak signal.");
	assert.equal(wifiWords({ available: true, cable: true, card: null }).line, "Connected by cable.");
	assert.match(wifiWords({ available: false, message: "No Wi-Fi tools." }).note, /^No Wi-Fi tools\. Its network is looked after/);
	assert.equal(wifiWords(null).line, "OmniCore is online.");
});

test("pieces: the device's own dark or light, with nothing behind the page", () => {
	const css = theme.uiStyles({ device: true });
	assert.ok(css.includes("@media (prefers-color-scheme: light)"));
	assert.ok(css.includes(theme.DEFAULT_LIGHT));
	assert.ok(!theme.uiStyles().includes("@media (prefers-color-scheme: light) {\n\t\t:root"), "only for these pages");
	const start = require("../core/page-motion").pageStart({ plain: true });
	assert.ok(!start.includes("<div class=\"omni-backdrop\""));
});
