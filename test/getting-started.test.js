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
