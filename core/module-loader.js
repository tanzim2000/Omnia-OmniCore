// core/module-loader.js
// Reads the config file and loads only the modules marked "enabled": true.
// This is what makes OmniCore "config-driven" instead of hardcoded —
// adding/removing a module later means editing the config, not this file.

const fs = require("fs");
const path = require("path");

function loadModules(app) {
	// Read and parse the config file
	const configPath = path.join(__dirname, "..", "config", "omnicore.config.json");
	const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

	// Loop through every module listed in the config
	for (const [moduleName, moduleConfig] of Object.entries(config.modules)) {
		if (!moduleConfig.enabled) {
			console.log(`Skipping disabled module: ${moduleName}`);
			continue; // skip to the next module
		}

		// Dynamically require the module's folder — Node resolves
		// modules/system-stats/index.js automatically
		const modulePath = path.join(__dirname, "..", "modules", moduleName);
		const moduleFn = require(modulePath);

		// Each module must export a function that takes (app, options)
		// and registers its own routes/logic onto the shared Express app
		moduleFn(app, moduleConfig.options);

		console.log(`Loaded module: ${moduleName}`);
	}
}

module.exports = loadModules;