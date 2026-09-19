// test/marketplace.test.js
// Downloads and installs everything the real registry lists, then
// confirms an installed module actually renders.
//
// This is the only test in the suite that reaches the network, and
// that's a deliberate tradeoff rather than an oversight: it means a
// GitHub or registry hiccup can block a good release. Accepted because
// the alternative -- a local fixture standing in for a real install --
// tests the fixture, not the pipeline. Every previous dev session used
// the local symlink workflow, so marketplace.js's actual
// download-extract-install path had never run end to end before this.
//
// See docs/planning/resilience-architecture.md.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const marketplace = require("../core/marketplace");
const { listModules } = require("../core/module-loader");
const themeLoader = require("../core/theme-loader");
const { makeModuleApi } = require("../core/module-api");
const { loadModule } = require("../core/module-loader");
const { modulesDir, themesDir, clearInstalled, resetState } = require("./helpers");

// Downloads are network-bound and there can be a dozen of them.
const NETWORK_TIMEOUT_MS = 120000;

let registry;

test("marketplace: the real registry is reachable and populated", async () => {
	resetState();
	clearInstalled();

	registry = await marketplace.listAvailable();

	assert.ok(
		registry.modules.length > 0,
		"the registry listed no modules at all, which is never right"
	);

	// A source that failed to fetch is reported rather than thrown, so
	// it would otherwise pass silently with an empty list.
	assert.deepEqual(
		registry.sourceFailures || [],
		[],
		"a registry source failed to fetch"
	);
});

test(
	"marketplace: every listed module installs",
	{ timeout: NETWORK_TIMEOUT_MS },
	async () => {
		for (const entry of registry.modules) {
			await marketplace.installEntry("module", entry.id, true);

			assert.ok(
				fs.existsSync(path.join(modulesDir, entry.id)),
				`${entry.id} reported success but nothing landed on disk`
			);
		}

		// listModules() is what every other part of OmniCore uses to
		// answer "what's installed" -- agreeing with the filesystem is
		// the thing actually worth asserting.
		const installed = listModules();

		for (const entry of registry.modules) {
			assert.ok(
				installed.includes(entry.id),
				`${entry.id} is on disk but listModules() doesn't see it`
			);
		}
	}
);

test(
	"marketplace: every listed theme installs",
	{ timeout: NETWORK_TIMEOUT_MS },
	async () => {
		for (const entry of registry.themes) {
			await marketplace.installEntry("theme", entry.id, true);

			assert.ok(
				fs.existsSync(path.join(themesDir, entry.id)),
				`${entry.id} reported success but nothing landed on disk`
			);
		}

		const installed = themeLoader.listThemes().map((manifest) => manifest.id);

		for (const entry of registry.themes) {
			assert.ok(
				installed.includes(entry.id),
				`${entry.id} is on disk but listThemes() doesn't see it`
			);
		}
	}
);

// Themes and modules must agree about symlinks, because the documented
// way to develop either one is to link its repo into themes/ or
// modules/ rather than copy it. listModules() resolved symlinks from the
// start; listThemes() did not, so a developer who linked both in found
// their modules listed and their theme missing, with the face reporting
// "no theme is installed" and nothing anywhere saying why.
test("themes: a symlinked theme folder is visible, same as a symlinked module", () => {
	const source = path.join(themesDir, "symlink-source");

	fs.mkdirSync(source, { recursive: true });
	fs.writeFileSync(
		path.join(source, "theme.json"),
		JSON.stringify({ name: "Linked Theme" })
	);
	fs.writeFileSync(path.join(source, "index.html"), "<html></html>");

	const link = path.join(themesDir, "symlink-linked");
	fs.rmSync(link, { recursive: true, force: true });
	fs.symlinkSync(source, link);

	const listed = themeLoader.listThemes().map((manifest) => manifest.id);

	assert.ok(
		listed.includes("symlink-linked"),
		"a symlinked theme was invisible -- this is the bug that made a " +
			"linked theme report as not installed at all"
	);

	// A link pointing at nothing, and a link pointing at a plain file,
	// must both still be excluded -- exactly as they would be without a
	// symlink involved at all.
	const dangling = path.join(themesDir, "symlink-dangling");
	fs.rmSync(dangling, { recursive: true, force: true });
	fs.symlinkSync(path.join(themesDir, "does-not-exist"), dangling);

	const plainFile = path.join(themesDir, "symlink-plain-source.txt");
	fs.writeFileSync(plainFile, "not a theme");

	const toFile = path.join(themesDir, "symlink-to-file");
	fs.rmSync(toFile, { recursive: true, force: true });
	fs.symlinkSync(plainFile, toFile);

	const after = themeLoader.listThemes().map((manifest) => manifest.id);

	assert.ok(!after.includes("symlink-dangling"), "a dangling symlink was listed");
	assert.ok(!after.includes("symlink-to-file"), "a symlink to a file was listed");
});

test("marketplace: an installed module actually runs", async () => {
	// weather is the one polled rather than all of them: it's small,
	// needs no API key, and every other module goes through the exact
	// same loader. Installing them all proves the pipeline; running one
	// proves what it installed is genuinely usable.
	const moduleFn = loadModule("weather");

	assert.equal(
		typeof moduleFn,
		"function",
		"weather installed but did not load as a function"
	);

	const envelope = await moduleFn(
		{ location: { latitude: 50.45, longitude: -104.6, label: "Regina" } },
		50,
		makeModuleApi(4001, "weather-smoke-test")
	);

	assert.ok(envelope.title, "envelope has no title");
	assert.ok(Array.isArray(envelope.content), "envelope content is not an array");
	assert.ok(envelope.updated, "envelope has no updated timestamp");
});

test("marketplace: installing something not in the registry is refused", async () => {
	await assert.rejects(
		() => marketplace.installEntry("module", "definitely-not-a-real-module", true),
		/not in the registry/,
		"expected a clear refusal, not a silent no-op"
	);
});