// test/network-passwords.test.js
// In short: Saved Wi-Fi passwords, kept encrypted
//
// Saved Wi-Fi passwords (since 2.0.0), kept encrypted for the Guest Wi-Fi
// widget and the Network page.
//
//   - A password is never written as it was typed: each one is sealed
//     with AES-256-GCM, a fresh nonce every time, tied to its network's
//     name and type
//   - Both files are readable by their owner only
//   - The list holds names; a password is only opened when asked for
//   - A lost or changed key, or an edited entry, opens nothing
//   - What a guest's QR code holds, with the special characters escaped
//   - The server's own network is remembered for a few minutes

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// A data folder of its own, before anything reads where data lives
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-passwords-"));
process.env.OMNICORE_DATA_DIR = dataDir;

const passwords = require("../core/network-passwords");

const SECRET = "correct horse battery staple";

test("a saved password is sealed, never written as typed", () => {
	assert.equal(passwords.save("Home 5G", SECRET, "psk"), true);

	const onDisk = fs.readFileSync(passwords.listPath(), "utf-8");
	assert.ok(onDisk.includes("Home 5G"), "the name is there, for the list");
	assert.ok(!onDisk.includes(SECRET), "the password is not");
	assert.ok(!onDisk.includes(Buffer.from(SECRET).toString("base64")), "not even in base64");

	const entry = JSON.parse(onDisk).networks[0];
	assert.equal(entry.auth, "psk");
	assert.equal(Buffer.from(entry.sealed.nonce, "base64").length, 12, "a 12-byte nonce");
	assert.equal(Buffer.from(entry.sealed.tag, "base64").length, 16, "GCM's 16-byte tag");
	assert.equal(fs.readFileSync(passwords.keyPath()).length, 32, "a 256-bit key");
});

test("both files are readable by their owner only", { skip: process.platform === "win32" }, () => {
	assert.equal(fs.statSync(passwords.listPath()).mode & 0o777, 0o600);
	assert.equal(fs.statSync(passwords.keyPath()).mode & 0o777, 0o600);
});

test("a fresh nonce every time, so the same password never looks the same", () => {
	passwords.save("Twice", SECRET, "psk");
	const first = JSON.parse(fs.readFileSync(passwords.listPath(), "utf-8")).networks.find((n) => n.ssid === "Twice").sealed;
	passwords.save("Twice", SECRET, "psk");
	const second = JSON.parse(fs.readFileSync(passwords.listPath(), "utf-8")).networks.find((n) => n.ssid === "Twice").sealed;
	assert.notEqual(first.nonce, second.nonce);
	assert.notEqual(first.data, second.data);
	assert.equal(passwords.list().filter((n) => n.ssid === "Twice").length, 1, "one entry per name: a new password replaces the old");
});

test("the list has names and types, never a password", () => {
	passwords.save("Café Libre", "", "open");
	const listed = passwords.list();
	assert.deepEqual(
		listed.map((n) => [n.ssid, n.auth, n.readable]),
		[["Café Libre", "open", true], ["Home 5G", "psk", true], ["Twice", "psk", true]],
		"sorted by name"
	);
	assert.ok(!JSON.stringify(listed).includes(SECRET));
	assert.equal(passwords.has("Home 5G"), true);
	assert.equal(passwords.has("Nowhere"), false);
});

test("a password is opened only when asked for", () => {
	assert.deepEqual(passwords.reveal("Home 5G"), { ssid: "Home 5G", auth: "psk", password: SECRET });
	assert.deepEqual(passwords.reveal("Café Libre"), { ssid: "Café Libre", auth: "open", password: "" });
	assert.equal(passwords.reveal("Nowhere"), null);
});

test("only what could be joined with can be saved", () => {
	assert.throws(() => passwords.save("Home", "short", "psk"), (error) => error.status === 400 && /8 to 63/.test(error.message));
	assert.throws(() => passwords.save("", SECRET, "psk"), /Choose/);
	assert.throws(() => passwords.save("Work", SECRET, "unsupported"), /can't join/);
	assert.doesNotThrow(() => passwords.save("WPA3 Only", "a long WPA3 password", "sae"));
	assert.equal(passwords.reveal("WPA3 Only").password, "a long WPA3 password");
});

test("an entry moved onto another name, or edited, opens nothing", () => {
	const saved = JSON.parse(fs.readFileSync(passwords.listPath(), "utf-8"));
	const home = saved.networks.find((n) => n.ssid === "Home 5G");

	// Home's sealed password, put under another network's name
	const moved = { ...saved, networks: [...saved.networks, { ...home, ssid: "Neighbour" }] };
	fs.writeFileSync(passwords.listPath(), JSON.stringify(moved));
	assert.equal(passwords.reveal("Neighbour"), null, "the name is part of what's sealed");
	assert.equal(passwords.list().find((n) => n.ssid === "Neighbour").readable, false);

	// One byte of the sealed password changed
	const data = Buffer.from(home.sealed.data, "base64");
	data[0] ^= 1;
	const edited = { ...saved, networks: saved.networks.map((n) => (n.ssid === "Home 5G" ? { ...n, sealed: { ...n.sealed, data: data.toString("base64") } } : n)) };
	fs.writeFileSync(passwords.listPath(), JSON.stringify(edited));
	assert.equal(passwords.reveal("Home 5G"), null);

	fs.writeFileSync(passwords.listPath(), JSON.stringify(saved));
	assert.equal(passwords.reveal("Home 5G").password, SECRET, "back as it was, it opens again");
});

test("without its key, nothing opens; the names stay, to be added again", () => {
	const key = fs.readFileSync(passwords.keyPath());
	fs.rmSync(passwords.keyPath());
	assert.equal(passwords.reveal("Home 5G"), null);
	assert.equal(passwords.list().find((n) => n.ssid === "Home 5G").readable, false);
	assert.equal(passwords.list().find((n) => n.ssid === "Café Libre").readable, true, "an open network has nothing to open");

	fs.writeFileSync(passwords.keyPath(), key, { mode: 0o600 });
	assert.equal(passwords.reveal("Home 5G").password, SECRET);
});

test("forgetting takes the entry out", () => {
	assert.equal(passwords.forget("Twice"), true);
	assert.equal(passwords.forget("Twice"), false, "nothing left to forget");
	assert.equal(passwords.has("Twice"), false);
});

test("an unreadable list is an empty list, written over by the next save", () => {
	const saved = fs.readFileSync(passwords.listPath());
	fs.writeFileSync(passwords.listPath(), "{ not json");
	assert.deepEqual(passwords.list(), []);
	fs.writeFileSync(passwords.listPath(), saved);
});

test("what a guest's QR code holds", () => {
	assert.equal(passwords.qrValue({ ssid: "Home", auth: "psk", password: "12345678" }), "WIFI:T:WPA;S:Home;P:12345678;;");
	assert.equal(passwords.qrValue({ ssid: "W3", auth: "sae", password: "a long one" }), "WIFI:T:WPA;S:W3;P:a long one;;", "WPA3 says WPA too");
	assert.equal(passwords.qrValue({ ssid: "Café", auth: "open", password: "" }), "WIFI:T:nopass;S:Café;;");
	assert.equal(
		passwords.qrValue({ ssid: 'a;b,c:d"e\\f', auth: "psk", password: "p;w,d:x\"y\\z" }),
		'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w\\,d\\:x\\"y\\\\z;;',
		"each special character gets a backslash in front"
	);
	assert.equal(passwords.qrValue(null), null);
});

test("the server's own network: looked at once, remembered for a few minutes", async () => {
	passwords.reset();
	let looked = 0;
	let clock = 1000;
	const deps = {
		now: () => clock,
		probe: async () => {
			looked++;
			return { available: true, wifi: [{ name: "wlan0", connected: true, ssid: "Home 5G" }] };
		}
	};
	assert.equal(await passwords.currentSsid(deps), "Home 5G");
	assert.equal(await passwords.currentSsid(deps), "Home 5G");
	assert.equal(looked, 1, "remembered");
	clock += passwords.CURRENT_KEPT_MS;
	await passwords.currentSsid(deps);
	assert.equal(looked, 2, "looked at again after a few minutes");

	// Told straight away when OmniCore joins a network
	passwords.noteCurrent("New Place");
	assert.equal(await passwords.currentSsid({ ...deps, now: Date.now }), "New Place");

	// No helper, no Wi-Fi: nothing
	passwords.reset();
	assert.equal(await passwords.currentSsid({ probe: async () => ({ available: false }) }), null);
	passwords.reset();
	assert.equal(await passwords.currentSsid({ probe: async () => { throw new Error("no docker"); } }), null);
});

test.after(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
});
