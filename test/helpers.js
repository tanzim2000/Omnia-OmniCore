// test/helpers.js
// Shared machinery for the smoke suite.
//
// Every test here talks to a REAL running server over REAL HTTP, and
// that's deliberate rather than incidental. The bug that prompted this
// whole suite (Installed Resources crashing once a theme was installed)
// would not have been caught by a test that only checked each file
// require()s without throwing -- nothing threw until the route actually
// ran. See docs/planning/resilience-architecture.md.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const modulesDir = path.join(root, "modules");
const themesDir = path.join(root, "themes");

// Anything OmniCore persists, wiped between runs. Without this a test
// would pass or fail depending on what a previous run happened to leave
// behind, which is the fastest way to make a suite untrustworthy.
function resetState() {
	for (const name of ["faces.json", "admin.json", "settings.json", "installed.json"]) {
		try {
			fs.unlinkSync(path.join(dataDir, name));
		} catch (error) {
			// Wasn't there. That's the desired state anyway.
		}
	}

	fs.rmSync(path.join(dataDir, "faces"), { recursive: true, force: true });
}

// Everything the registry install test downloaded. Removed afterward so
// a developer running the suite locally doesn't silently end up with a
// modules/ folder full of things they never chose to install.
function clearInstalled() {
	for (const dir of [modulesDir, themesDir]) {
		if (!fs.existsSync(dir)) {
			continue;
		}

		for (const entry of fs.readdirSync(dir)) {
			if (entry === ".gitkeep") {
				continue;
			}

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
// whole face down.
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