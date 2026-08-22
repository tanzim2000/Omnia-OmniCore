// core/module-loader.js
// Modules are backend-only capabilities. They never render anything —
// themes consume module data and decide how it looks.
// A module is any subfolder of modules/ exporting a function (app, options).

const fs = require("fs");
const path = require("path");

const modulesDir = path.join(__dirname, "..", "modules");

// Every module available on this OmniCore install
function listModules() {
	if (!fs.existsSync(modulesDir)) {
		return [];
	}

	return fs
		.readdirSync(modulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

// Mount only the modules a specific face has listed in its identity
function mountModules(app, moduleIds) {
	for (const moduleId of moduleIds) {
		const modulePath = path.join(modulesDir, moduleId);

		if (!fs.existsSync(modulePath)) {
			console.log(`  Module not found, skipping: ${moduleId}`);
			continue;
		}

		const moduleFn = require(modulePath);
		moduleFn(app, {});
		console.log(`  Mounted module: ${moduleId}`);
	}
}

module.exports = { listModules, mountModules };