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