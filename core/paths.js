// core/paths.js
// Where OmniCore's own state lives on disk — one place, rather than
// thirteen files each independently computing __dirname/../data.
//
// Every path here can be overridden by an environment variable, which
// exists for exactly one reason: the test suite. Without this, a test
// that creates a face or installs a module has nowhere to write except
// the real project folders — which is exactly what happened, more than
// once: "Smoke Test Face" and a fake failing module both leaked into
// real local state because the tests that created them had no sandbox
// of their own to write into instead.
//
// Nothing in the shipped app ever sets these three variables — only
// test/helpers.js does, and only for the process running the tests.
//
// Deliberately exported as functions, not constants computed once at
// require() time. Every file that used to do
//   const dataPath = path.join(__dirname, "..", "data", "x.json");
// at the top of the file would keep whatever value was true the moment
// it first got require()'d, no matter what an environment variable
// said afterward — Node caches the module, not just the path. Calling
// a function fresh on every use is what makes the override actually
// reliable, regardless of which file happens to get required first.

const path = require("path");

const ROOT = path.join(__dirname, "..");

function dataDir() {
	return process.env.OMNICORE_DATA_DIR || path.join(ROOT, "data");
}

function modulesDir() {
	return process.env.OMNICORE_MODULES_DIR || path.join(ROOT, "modules");
}

function themesDir() {
	return process.env.OMNICORE_THEMES_DIR || path.join(ROOT, "themes");
}

module.exports = { dataDir, modulesDir, themesDir };