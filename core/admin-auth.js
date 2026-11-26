// core/admin-auth.js
// Login for the admin face.
//
// Since 2.0.0 there's an admin PASSWORD and nothing else: no account, no
// username. When OmniCore comes as an operating system, the system's own
// users will decide who can do what (and several admins come then). An
// install from before keeps its password: the stored hash was only ever
// of the password, so the username it also saved is simply ignored.
//
// Passwords are never stored — only a scrypt hash of them. scrypt is
// deliberately slow and memory-hungry, which is what makes guessing a
// stolen hash impractical. Each password gets its own random salt, so two
// people choosing the same password still get different hashes.
//
// Sessions are kept in memory only, so restarting OmniCore signs everyone
// out. For a home server that's a reasonable trade.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

function adminPath() {
	return path.join(paths.dataDir(), "admin.json");
}

const SESSION_COOKIE = "omnicore_session";
const MIN_PASSWORD_LENGTH = 8;

// Live session tokens. Lost on restart, by design.
const sessions = new Set();

// Has the admin password been made yet?
function isSetUp() {
	return fs.existsSync(adminPath());
}

function readAdmin() {
	return JSON.parse(fs.readFileSync(adminPath(), "utf-8"));
}

// Hash a password with the given salt. 64 bytes out.
function hashPassword(password, salt) {
	return crypto.scryptSync(password, salt, 64).toString("hex");
}

// Make the admin password. Only works once: there's no way to overwrite
// it through this, which stops anyone who reaches the setup page later
// from taking OmniCore over.
function createAdmin(password) {
	if (isSetUp()) {
		return { error: "The admin password is already set." };
	}

	if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
		return {
			error: "Password must be at least " + MIN_PASSWORD_LENGTH + " characters"
		};
	}

	const salt = crypto.randomBytes(16).toString("hex");

	fs.mkdirSync(path.dirname(adminPath()), { recursive: true });

	fs.writeFileSync(
		adminPath(),
		JSON.stringify(
			{
				salt: salt,
				hash: hashPassword(password, salt)
			},
			null,
			"\t"
		)
	);

	return { ok: true };
}

// Check a password against the stored one
function verify(password) {
	if (!isSetUp() || typeof password !== "string") {
		return false;
	}

	const admin = readAdmin();
	const attempt = Buffer.from(hashPassword(password, admin.salt), "hex");
	const stored = Buffer.from(admin.hash, "hex");

	if (attempt.length !== stored.length) {
		return false;
	}

	// Compare in constant time. A normal === would return faster on an
	// early mismatch, and that timing difference can leak the hash.
	return crypto.timingSafeEqual(attempt, stored);
}

function createSession() {
	const token = crypto.randomBytes(32).toString("hex");
	sessions.add(token);
	return token;
}

function destroySession(token) {
	sessions.delete(token);
}

// Pull a named cookie out of the request
function readCookie(req, name) {
	const header = req.headers.cookie || "";

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;

		if (part.slice(0, separator).trim() === name) {
			return part.slice(separator + 1).trim();
		}
	}

	return null;
}

function isLoggedIn(req) {
	const token = readCookie(req, SESSION_COOKIE);
	return token !== null && sessions.has(token);
}

// Send the session cookie. HttpOnly means page JavaScript can't read it,
// which blocks a whole class of token theft. SameSite=Strict means the
// browser won't attach it to requests coming from other sites.
function setSessionCookie(res, token) {
	res.setHeader(
		"Set-Cookie",
		SESSION_COOKIE + "=" + token +
			"; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800"
	);
}

function clearSessionCookie(res) {
	res.setHeader(
		"Set-Cookie",
		SESSION_COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
	);
}

// The same check, for someone already signed in who is asked again
// before something sensitive (the Network page's Show, for a saved Wi-Fi
// password). Kept under its own name for the places that ask that way.
function verifyPassword(password) {
	return verify(password);
}

module.exports = {
	isSetUp,
	createAdmin,
	verify,
	verifyPassword,
	createSession,
	destroySession,
	isLoggedIn,
	readCookie,
	setSessionCookie,
	clearSessionCookie,
	SESSION_COOKIE
};