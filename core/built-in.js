// core/built-in.js
// Widgets that ship inside OmniCore itself (since 2.0.0), as opposed to
// modules installed from a Registry.
//
// WHY ANY WIDGET IS BUILT IN
//
// Nearly every widget belongs in a Registry: it can be updated on its own,
// removed, and written by anyone. A built-in widget is for the rare one
// that needs something only Core should ever hold. The first is Guest
// Wi-Fi: it draws a QR code from a saved Wi-Fi password, and that password
// never leaves Core (network-passwords.js). A module from a Registry would
// have to be handed the password to do the same job.
//
// HOW IT FITS IN
//
// A built-in widget is an ordinary module folder (module.json, index.js,
// settings) kept in core/built-in/ instead of the modules folder, so
// everything that draws, configures and names modules works on it
// unchanged. What's different:
//
//   - It's offered when adding a widget to a face, beside the installed
//     modules, but it isn't "installed": it isn't listed under Installed
//     Resources, can't be removed, and updates with OmniCore itself.
//   - Its settings can be a settings.js instead of settings.json: a
//     function that returns the list of fields when the form is drawn, so
//     a choice can list something that changes (Guest Wi-Fi's saved
//     networks). Only built-in widgets get this. A module from a Registry
//     is never run just to draw its settings form.
//   - Its id starts with "omnicore-", and a built-in widget always wins
//     over a module folder of the same name, so nothing installed can
//     stand in for it.

const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const BUILT_IN_DIR = path.join(__dirname, "built-in");

// The built-in widgets' ids: their folder names
function ids() {
	try {
		return fs
			.readdirSync(BUILT_IN_DIR, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name.startsWith("omnicore-"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		return [];
	}
}

function isBuiltIn(moduleId) {
	return typeof moduleId === "string" && ids().includes(moduleId);
}

// Where a module's files are: its built-in folder, or the modules folder
function folderOf(moduleId) {
	return isBuiltIn(moduleId) ? path.join(BUILT_IN_DIR, moduleId) : path.join(paths.modulesDir(), moduleId);
}

module.exports = { BUILT_IN_DIR, ids, isBuiltIn, folderOf };
