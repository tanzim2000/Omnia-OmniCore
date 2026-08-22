// core/module-loader.js
// Auto-discovers modules by scanning the modules/ folder — no config editing
// needed to add a new module. config.moduleOverrides is only for optional
// per-module tweaks: disabling one, or passing custom options.

const fs = require("fs");
const path = require("path");

function loadModules(app, config) {
	const modulesDir = path.join(__dirname, "..", "modules");

	// Every subfolder inside modules/ is treated as a module
	const discoveredModules = fs
		.readdirSync(modulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	const overrides = config.moduleOverrides || {};

	for (const moduleName of discoveredModules) {
		const override = overrides[moduleName] || {};

		if (override.enabled === false) {
			console.log(`Skipping disabled module: ${moduleName}`);
			continue;
		}

		const modulePath = path.join(modulesDir, moduleName);
		const moduleFn = require(modulePath);

		moduleFn(app, override.options || {});

		console.log(`Loaded module: ${moduleName}`);
	}
}

module.exports = loadModules;