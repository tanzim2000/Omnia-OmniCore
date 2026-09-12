// test/helpers.js
// Shared machinery for the smoke suite.
//
// Every test here talks to a REAL running server over REAL HTTP, and
// that's deliberate rather than incidental. The bug that prompted this
// whole suite (Installed Resources crashing once a theme was installed)
// would not have been caught by a test that only checked each file
// require()s without throwing -- nothing threw until the route actually
// ran. See docs/planning/resilience-architecture.md.
//
// Everything the suite creates -- faces, installed modules, accounts --
// lives in its own throwaway directory, never in the real project's
// data/modules/themes folders. Without this, running npm test locally
// silently overwrote real local state more than once: a real face
// ("Smoke Test Face") and a real module ("Failing Module") both leaked
// into a genuine development environment, because the tests that
// created them had nowhere else to write.
//
// This is the actual fix, not a workaround around it: every core file
// now resolves its paths through core/paths.js, which checks the three
// environment variables set below before falling back to the real
// project folders. Setting them here, and only here, before anything
// else runs, is what makes a test run and a real npm start two
// genuinely separate things rather than one silently overwriting the
// other. A fresh, uniquely-named directory every run, rather than one
// fixed sandbox path reused each time, so a crashed previous run can
// never leave behind state the next run accidentally inherits.

const fs = require("fs");
const os = require("os");
const path = require("path");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-test-"));

process.env.OMNICORE_DATA_DIR = path.join(sandbox, "data");
process.env.OMNICORE_MODULES_DIR = path.join(sandbox, "modules");
process.env.OMNICORE_THEMES_DIR = path.join(sandbox, "themes");

const root = path.join(__dirname, "..");
const dataDir = process.env.OMNICORE_DATA_DIR;
const modulesDir = process.env.OMNICORE_MODULES_DIR;
const themesDir = process.env.OMNICORE_THEMES_DIR;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(modulesDir, { recursive: true });
fs.mkdirSync(themesDir, { recursive: true });

// Anything OmniCore persists, wiped between runs. Safe to do this
// bluntly now -- this is the sandbox, never a real project folder, so
// there's nothing here a previous run left behind that matters.
function resetState() {
	for (const name of [
		"faces.json",
		"admin.json",
		"settings.json",
		"installed.json",
		"update-checks.json"
	]) {
		try {
			fs.unlinkSync(path.join(dataDir, name));
		} catch (error) {
			// Wasn't there. That's the desired state anyway.
		}
	}

	fs.rmSync(path.join(dataDir, "faces"), { recursive: true, force: true });
}

// Everything the registry install test downloaded, cleared from the
// sandbox between runs. No .gitkeep handling needed here the way the
// real modules/themes folders need it -- this directory isn't tracked
// by git at all.
function clearInstalled() {
	for (const dir of [modulesDir, themesDir]) {
		if (!fs.existsSync(dir)) {
			continue;
		}

		for (const entry of fs.readdirSync(dir)) {
			fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
		}
	}
}

// A face's server is listening before its start function resolves, but
// the admin/control/wizard faces don't hand back a promise -- they just
// call app.listen. Poll until something answers rather than sleeping a
// fixed guess, which is either too slow or flaky depending on the
// machine.
async function waitForPort(port, timeoutMs) {
	const deadline = Date.now() + (timeoutMs || 8000);

	while (Date.now() < deadline) {
		try {
			await fetch(`http://127.0.0.1:${port}/`, {
				signal: AbortSignal.timeout(500)
			});
			return true;
		} catch (error) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	throw new Error(`Nothing answered on port ${port} within the timeout`);
}

// Creates the admin account and returns a cookie for it. Almost every
// admin route is gated, so this is the prerequisite for testing any of
// them.
async function signIn(port) {
	const response = await fetch(`http://127.0.0.1:${port || 3000}/setup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username: "test", password: "test-password-123" }),
		redirect: "manual"
	});

	const cookie = (response.headers.get("set-cookie") || "").split(";")[0];

	if (!cookie) {
		throw new Error("Setup did not return a session cookie");
	}

	return cookie;
}

// A module that throws on purpose. The registry-driven tests cover the
// happy path with real published modules; this covers what a real
// published module won't reliably give you -- confirmation that one
// module failing produces an error envelope rather than taking the
// whole face down. Lands in the sandbox's modules folder, same as
// everything else the suite creates.
function writeFailingModule(id) {
	const dir = path.join(modulesDir, id);

	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "Failing Module", description: "Throws on purpose" })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		'module.exports = async function () {\n' +
			'\tthrow new Error("Deliberate failure, for the smoke suite");\n' +
			"};\n"
	);

	return dir;
}

module.exports = {
	root,
	dataDir,
	modulesDir,
	themesDir,
	resetState,
	clearInstalled,
	waitForPort,
	signIn,
	writeFailingModule
};