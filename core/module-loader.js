// core/module-loader.js
// Finds installed modules and loads them.
//
// THE MODULE CONTRACT
//
// A module is a folder in modules/ whose index.js exports one function:
//
//     module.exports = async function (config) {
//         return { title, primary, secondary, details, updated };
//     };
//
// It is given its settings and returns data. That's all. It does not
// register routes, does not touch Express, and does not render anything —
// OmniCore owns the routing, and the theme decides how any of it looks.
//
// Because a module is just a function, the same module can be used many
// times over on one face with different settings each time. That's what
// makes two weather tiles for two cities possible.

const fs = require("fs");
const path = require("path");

const modulesDir = path.join(__dirname, "..", "modules");

// Every module installed on this OmniCore
function listModules() {
	if (!fs.existsSync(modulesDir)) {
		return [];
	}

	return fs
		.readdirSync(modulesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

// Load a module's function. Returns null if it's missing or won't load —
// a broken module shouldn't stop OmniCore from starting.
function loadModule(moduleId) {
	const modulePath = path.join(modulesDir, moduleId);

	if (!fs.existsSync(modulePath)) {
		return null;
	}

	try {
		const loaded = require(modulePath);
		return typeof loaded === "function" ? loaded : null;
	} catch (error) {
		console.log(`  Module failed to load: ${moduleId} — ${error.message}`);
		return null;
	}
}

module.exports = { listModules, loadModule };