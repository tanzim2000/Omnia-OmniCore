// core/module-loader.js
// Finds installed modules and loads them.
//
// THE MODULE CONTRACT
//
// A module is a folder in modules/ whose index.js exports one function:
//
//     module.exports = async function (config, richness) {
//         return { title, content: [ ...blocks ], updated };
//     };
//
// It is given its settings and how much content there is room for, and it
// returns data. That's all. It does not register routes, does not touch
// Express, and does not render anything — OmniCore owns the routing, and
// the theme decides how any of it looks.
//
// RICHNESS is a number from 1 to 100, and every module is expected to
// honour it. The scale belongs to the module: it decides for itself what
// 10 means versus 90, and how many steps it has in between. A clock might
// have two — the time, or the time with a date. A calendar might have
// twenty, one per extra event shown.
//
// The theme decides which number to ask for, based on how much room it has
// given that instance. So a module never learns what theme is asking or
// what that theme calls its sizes, and a theme never learns what any
// particular module's content means. Both sides only deal in one number.
//
// More steps means more room for a theme to work with, not a better
// module — two well-chosen steps beat twenty arbitrary ones.
//
// Because a module is just a function, the same module can be used many
// times over on one face with different settings each time. That's what
// makes two weather tiles for two cities possible.

const fs = require("fs");
const path = require("path");
const paths = require("./paths");

function modulesDir() {
	return paths.modulesDir();
}

// Every module installed on this OmniCore
//
// A symlinked module folder — the common local-development setup, where
// a module lives in its own repo and is linked into modules/ rather than
// copied — needs special handling here. Node's own Dirent type reports
// a symlink as neither a directory nor a file; it deliberately doesn't
// follow the link just to answer that question. Left unhandled, that
// makes a perfectly real, working module silently invisible.
function listModules() {
	if (!fs.existsSync(modulesDir())) {
		return [];
	}

	return fs
		.readdirSync(modulesDir(), { withFileTypes: true })
		.filter((entry) => {
			if (entry.isDirectory()) {
				return true;
			}

			if (!entry.isSymbolicLink()) {
				return false;
			}

			// Resolve it ourselves. A dangling symlink (whatever it once
			// pointed at is gone) or one pointing at a plain file rather
			// than a folder is correctly excluded here, same as either
			// case already would be without a symlink involved at all.
			try {
				return fs
					.statSync(path.join(modulesDir(), entry.name))
					.isDirectory();
			} catch (error) {
				return false;
			}
		})
		.map((entry) => entry.name);
}

// Load a module's function. Returns null if it's missing or won't load —
// a broken module shouldn't stop OmniCore from starting.
function loadModule(moduleId) {
	const modulePath = path.join(modulesDir(), moduleId);

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