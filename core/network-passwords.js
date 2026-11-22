// core/network-passwords.js
// Saved Wi-Fi passwords (since 2.0.0), kept encrypted, for the Guest
// Wi-Fi widget and the Network page.
//
// WHY OMNICORE KEEPS THEM AT ALL
//
// The server's own Wi-Fi settings never hold a password as it was typed:
// wpa_supplicant and NetworkManager are given the key worked out from it
// (see network-setup.js). That's right for joining, but a guest's phone
// needs the password itself to join. So OmniCore keeps its own copy, and
// only of passwords it was given:
//
//   - every network joined through OmniCore (Manual Setup, OmniSync, the
//     Network page), saved once the join has worked
//   - any network typed in on the Network page, for guests ("Add")
//
// A network the server joined some other way (set up in the operating
// system) has nothing here until somebody adds it.
//
// HOW THEY'RE KEPT
//
// Each password is encrypted on its own with AES-256-GCM, with a fresh
// random 12-byte nonce every time it's written. The network's name and
// security type are bound to it as "additional data", so an entry can't
// be moved onto another network's name without failing to open.
//
//   data/network-passwords.json   the list: names, security type, and
//                                 each password encrypted
//   data/network-passwords.key    the 32-byte key, made the first time a
//                                 password is saved
//
// Both are written readable by their owner only (mode 600).
//
// WHAT THAT PROTECTS AGAINST, HONESTLY
//
// The key sits on the same disk as the list, because OmniCore has to open
// a password by itself to draw a guest's QR code (nobody is there to type
// anything in). So this keeps the passwords out of anything that only gets
// the list: a copied settings folder, a backup of the list without its
// key, a file shown on screen while fixing something. Someone with the
// whole disk has both files, and can open them.
//
// IN MEMORY
//
// Only the encrypted list is ever held. A password is opened when it's
// needed (a QR code being drawn, the Network page's Show), used, and not
// kept anywhere afterwards.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const LIST_FILE = "network-passwords.json";
const KEY_FILE = "network-passwords.key";

// The security types a saved network can have, the same words Manual
// Setup uses: no password, WPA/WPA2 (a password), WPA3 only (a password)
const AUTHS = ["open", "psk", "sae"];

// How long the server's own network name is remembered for the widget,
// so drawing a tile doesn't start a helper every time a screen refreshes
const CURRENT_KEPT_MS = 5 * 60 * 1000;

function listPath() {
	return path.join(paths.dataDir(), LIST_FILE);
}

function keyPath() {
	return path.join(paths.dataDir(), KEY_FILE);
}

// ---------------------------------------------------------------------
// The files

// The encrypted list as it is on disk. Anything unreadable counts as an
// empty list (and is written over by the next save), never an error.
function readList() {
	try {
		const parsed = JSON.parse(fs.readFileSync(listPath(), "utf-8"));
		const networks = Array.isArray(parsed && parsed.networks) ? parsed.networks : [];
		return networks.filter(
			(entry) =>
				entry &&
				typeof entry.ssid === "string" &&
				entry.ssid.length &&
				AUTHS.includes(entry.auth)
		);
	} catch (error) {
		return [];
	}
}

// Written to a new file first, then moved over the old one, so a power
// cut in the middle can't leave half a list
function writeList(networks) {
	fs.mkdirSync(paths.dataDir(), { recursive: true });
	const temporary = listPath() + ".new";
	// A leftover from a write that never finished would keep its own
	// permissions: gone first, so the new file is made with mode 600
	fs.rmSync(temporary, { force: true });
	fs.writeFileSync(temporary, JSON.stringify({ version: 1, networks }, null, "\t"), { mode: 0o600 });
	fs.renameSync(temporary, listPath());
}

// The key, or null if there isn't one yet. `make` creates it when it's
// missing (only saving does that: reading never needs a new key).
function readKey(make) {
	try {
		const key = fs.readFileSync(keyPath());
		if (key.length === 32) return key;
	} catch (error) {
		// Not there yet
	}
	if (!make) return null;

	fs.mkdirSync(paths.dataDir(), { recursive: true });
	const key = crypto.randomBytes(32);
	// "w" with mode 600: readable by OmniCore's own user only
	fs.writeFileSync(keyPath(), key, { mode: 0o600 });
	return key;
}

// ---------------------------------------------------------------------
// Locking and opening one password

// What ties an encrypted password to its network: its name and type
function boundTo(ssid, auth) {
	return Buffer.from(JSON.stringify([ssid, auth]), "utf-8");
}

function seal(key, ssid, auth, password) {
	const nonce = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
	cipher.setAAD(boundTo(ssid, auth));
	const data = Buffer.concat([cipher.update(Buffer.from(password, "utf-8")), cipher.final()]);
	return {
		nonce: nonce.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		data: data.toString("base64")
	};
}

// The password, or null if it can't be opened (no key, a different key,
// or a changed entry: GCM refuses all three)
function open(key, entry) {
	if (entry.auth === "open") return "";
	if (!key || !entry.sealed) return null;
	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(entry.sealed.nonce, "base64"));
		decipher.setAAD(boundTo(entry.ssid, entry.auth));
		decipher.setAuthTag(Buffer.from(entry.sealed.tag, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(entry.sealed.data, "base64")), decipher.final()]).toString("utf-8");
	} catch (error) {
		return null;
	}
}

// ---------------------------------------------------------------------
// What the rest of OmniCore uses

// What's wrong with a network to save, in words for the page, or null.
// The same limits as joining (network-setup.js's problemWith), so a
// password that could be joined with can always be saved, and the other
// way round.
function problemWith(network) {
	return require("./network-setup").problemWith(network || {});
}

// Save (or replace) a network's password. Returns true when saved.
// Throws with a `status` for something the page should say.
function save(ssid, password, auth) {
	const problem = problemWith({ ssid, password, auth });
	if (problem) throw Object.assign(new Error(problem), { status: 400 });

	const entry = { ssid, auth, saved: new Date().toISOString() };
	if (auth !== "open") entry.sealed = seal(readKey(true), ssid, auth, password);

	// One entry per name: a new password replaces the old one
	const networks = readList().filter((other) => other.ssid !== ssid);
	networks.push(entry);
	writeList(networks);
	return true;
}

// The saved networks, by name: never a password. `readable` is false for
// one that can't be opened any more (its key was lost): it has to be
// added again.
function list() {
	const key = readKey(false);
	return readList()
		.map((entry) => ({
			ssid: entry.ssid,
			auth: entry.auth,
			saved: entry.saved || null,
			readable: open(key, entry) !== null
		}))
		.sort((a, b) => a.ssid.localeCompare(b.ssid));
}

function has(ssid) {
	return readList().some((entry) => entry.ssid === ssid);
}

// A saved network with its password opened: { ssid, auth, password }, or
// null when there's none or it can't be opened. Only for the moment it's
// needed: callers use it and let it go.
function reveal(ssid) {
	const entry = readList().find((other) => other.ssid === ssid);
	if (!entry) return null;
	const password = open(readKey(false), entry);
	if (password === null) return null;
	return { ssid: entry.ssid, auth: entry.auth, password };
}

// Forget a saved password. True if there was one.
function forget(ssid) {
	const networks = readList();
	const kept = networks.filter((entry) => entry.ssid !== ssid);
	if (kept.length === networks.length) return false;
	writeList(kept);
	return true;
}

// What a Wi-Fi QR code holds, the way phones read it (the format ZXing
// started and phone cameras follow):
//
//   WIFI:T:WPA;S:<name>;P:<password>;;     a network with a password
//   WIFI:T:nopass;S:<name>;;               an open network
//
// A backslash, ; , : or " in the name or password has a backslash put in
// front of it, so it can't end a part early. WPA3 networks say WPA too:
// phones that know WPA3 work it out when they join.
function escapeForQr(text) {
	return String(text).replace(/([\\;,:"])/g, "\\$1");
}

function qrValue(network) {
	if (!network) return null;
	if (network.auth === "open") return `WIFI:T:nopass;S:${escapeForQr(network.ssid)};;`;
	return `WIFI:T:WPA;S:${escapeForQr(network.ssid)};P:${escapeForQr(network.password)};;`;
}

// The network the server is on, by name, or null. Remembered for a few
// minutes; told straight away when OmniCore joins one (noteCurrent).
let current = null; // { ssid, at }

function noteCurrent(ssid) {
	current = { ssid: ssid || null, at: Date.now() };
}

async function currentSsid(deps = {}) {
	const now = (deps.now || Date.now)();
	if (current && now - current.at < CURRENT_KEPT_MS) return current.ssid;
	let ssid = null;
	try {
		const found = await (deps.probe || ((options) => require("./network-helper").probe(options)))({ fresh: false });
		const card = found && found.available ? (found.wifi || []).find((wifi) => wifi.connected) : null;
		ssid = card ? card.ssid || null : null;
	} catch (error) {
		ssid = null;
	}
	current = { ssid, at: now };
	return ssid;
}

// For the tests: forget the remembered network name
function reset() {
	current = null;
}

module.exports = {
	LIST_FILE,
	KEY_FILE,
	CURRENT_KEPT_MS,
	listPath,
	keyPath,
	save,
	list,
	has,
	reveal,
	forget,
	escapeForQr,
	qrValue,
	noteCurrent,
	currentSsid,
	reset
};
