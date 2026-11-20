// core/omnisync.js
// What OmniCore and OmniSync say to each other when a server has lost its
// Wi-Fi (since 2.0.0). The full description, for whoever builds OmniSync,
// is docs/OmniSync-setup.md; this file is OmniCore's half of it.
//
// THE IDEA
//
// The server runs a Wi-Fi network of its own for a while (the setup
// hotspot, network-hotspot.js) and shows a QR code. OmniSync scans it, joins
// the hotspot, and sends the home Wi-Fi's name and password to OmniCore
// across it. OmniCore joins that network (network-setup.js).
//
// WHAT THE QR CODE HOLDS
//
// "OMNISYNC:1:" and then, encrypted, the hotspot's name and password, where
// OmniCore answers on it (10.42.0.1, port 3000), a session id, and a
// public key made for this one session. The screen never shows the
// hotspot's name or password in words.
//
// The QR code's encryption uses a key every copy of OmniSync knows
// (QR_KEY below). That keeps an ordinary camera app from reading it; it is
// NOT a secret from someone who takes OmniSync apart. What actually
// protects the hotspot is that its password changes every time and is only
// on the screen: you have to be standing in front of it.
//
// WHAT COMES BACK
//
// OmniSync makes a key pair of its own (X25519), works out a shared secret
// with OmniCore's public key from the QR code, and encrypts the home
// Wi-Fi's details with it (AES-256-GCM, key from HKDF-SHA256). Only this
// OmniCore, in this session, can read them: not someone listening on the
// hotspot, not another server, and not later. A session is used once.

const crypto = require("crypto");

const PREFIX = "OMNISYNC:1:";

// The key the QR code is encrypted with: the same in every OmniCore and
// every OmniSync (see the top: it hides, it doesn't protect)
const QR_KEY = crypto.createHash("sha256").update("OmniSync setup QR, version 1").digest();

// Where OmniCore answers on its own hotspot
const HOTSPOT_ADDRESS = "10.42.0.1";
const HOTSPOT_PORT = 3000;

// The 12 bytes that start every X25519 public key in DER (SPKI) form,
// before the 32 bytes of the key itself
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");

function base64url(buffer) {
	return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
	if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url");
	return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// A random name and password for the hotspot. Letters and digits only,
// without the ones easily mistaken for each other.
function randomText(length) {
	const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	const bytes = crypto.randomBytes(length);
	return Array.from(bytes, (byte) => letters[byte % letters.length]).join("");
}

// One session: everything for one round of the hotspot
function createSession() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
	const raw = publicKey.export({ type: "spki", format: "der" }).subarray(X25519_SPKI.length);
	return {
		id: base64url(crypto.randomBytes(12)),
		ssid: `OmniCore-${randomText(6)}`,
		password: randomText(16),
		publicKey: base64url(raw),
		privateKey,
		used: false,
		createdAt: Date.now()
	};
}

// What goes in the QR code
function qrText(session) {
	const plain = JSON.stringify({
		v: 1,
		ssid: session.ssid,
		password: session.password,
		host: HOTSPOT_ADDRESS,
		port: HOTSPOT_PORT,
		session: session.id,
		key: session.publicKey
	});
	const nonce = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", QR_KEY, nonce);
	const sealed = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final(), cipher.getAuthTag()]);
	return PREFIX + base64url(Buffer.concat([nonce, sealed]));
}

// OmniSync's side of reading the QR code (for the tests, and as the
// worked example in docs/OmniSync-setup.md)
function readQr(text) {
	if (!String(text).startsWith(PREFIX)) throw new Error("Not an OmniSync code");
	const all = fromBase64url(String(text).slice(PREFIX.length));
	const decipher = crypto.createDecipheriv("aes-256-gcm", QR_KEY, all.subarray(0, 12));
	decipher.setAuthTag(all.subarray(all.length - 16));
	return JSON.parse(Buffer.concat([decipher.update(all.subarray(12, all.length - 16)), decipher.final()]).toString("utf-8"));
}

// The key both sides work out: X25519, then HKDF-SHA256 with the session
// id as the salt
function sharedKey(privateKey, theirRawPublic, sessionId) {
	const theirs = crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, theirRawPublic]), format: "der", type: "spki" });
	const secret = crypto.diffieHellman({ privateKey, publicKey: theirs });
	return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.from(sessionId, "utf-8"), Buffer.from("OmniSync Wi-Fi, version 1", "utf-8"), 32));
}

// What OmniSync sent back, read: { ssid, password, auth? }. Throws if it
// isn't for this session, was already used, or doesn't decrypt.
function readReply(session, body) {
	if (!session || session.used) throw new Error("No setup is waiting for this");
	if (!body || body.session !== session.id) throw new Error("This is for another setup");
	const theirs = fromBase64url(body.key);
	const nonce = fromBase64url(body.nonce);
	const data = fromBase64url(body.data);
	if (theirs.length !== 32 || nonce.length !== 12 || data.length < 17 || data.length > 4096) throw new Error("Not a setup reply");
	const key = sharedKey(session.privateKey, theirs, session.id);
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
	decipher.setAuthTag(data.subarray(data.length - 16));
	const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf-8");
	session.used = true;
	const parsed = JSON.parse(plain);
	return { ssid: parsed.ssid, password: parsed.password, auth: parsed.auth };
}

// OmniSync's side of replying (the tests, and the worked example)
function makeReply(qr, network) {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
	const raw = publicKey.export({ type: "spki", format: "der" }).subarray(X25519_SPKI.length);
	const key = sharedKey(privateKey, fromBase64url(qr.key), qr.session);
	const nonce = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
	const sealed = Buffer.concat([cipher.update(JSON.stringify(network), "utf-8"), cipher.final(), cipher.getAuthTag()]);
	return { session: qr.session, key: base64url(raw), nonce: base64url(nonce), data: base64url(sealed) };
}

module.exports = {
	PREFIX,
	HOTSPOT_ADDRESS,
	HOTSPOT_PORT,
	createSession,
	qrText,
	readQr,
	readReply,
	makeReply,
	randomText
};
