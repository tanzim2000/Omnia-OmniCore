// core/module-config.js
// Handles module settings.
//
// A module DECLARES what settings it has, in a settings.json inside its own
// folder. It never ships a form or any HTML — the admin face renders the UI,
// which is what keeps every settings page looking the same.
//
// The VALUES the user picks are stored separately, under data/module-config/,
// not in the module's folder. That way updating a module from the marketplace
// replaces its code without wiping the user's settings.

const fs = require("fs");
const path = require("path");

const modulesDir = path.join(__dirname, "..", "modules");
const configDir = path.join(__dirname, "..", "data", "module-config");

// A module's manifest: a readable name and description, from a module.json
// in its folder. Mirrors how themes describe themselves in theme.json.
// Falls back to the folder name so a module without one still works.
function readManifest(moduleId) {
	const manifestPath = path.join(modulesDir, moduleId, "module.json");

	if (!fs.existsSync(manifestPath)) {
		return { id: moduleId, name: moduleId, description: "" };
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

		return {
			id: moduleId,
			name: parsed.name || moduleId,
			description: parsed.description || ""
		};
	} catch (error) {
		return { id: moduleId, name: moduleId, description: "" };
	}
}

// Read a module's declared settings. Returns null if it has none —
// a module without settings simply has no settings page.
function readSchema(moduleId) {
	const schemaPath = path.join(modulesDir, moduleId, "settings.json");

	if (!fs.existsSync(schemaPath)) {
		return null;
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		return parsed.settings || [];
	} catch (error) {
		console.log(`  Unreadable settings.json in module: ${moduleId}`);
		return null;
	}
}

// The values the user has actually saved, if any
function savedValues(moduleId) {
	const valuesPath = path.join(configDir, moduleId + ".json");

	if (!fs.existsSync(valuesPath)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(valuesPath, "utf-8"));
	} catch (error) {
		return {};
	}
}

// A module's current settings: saved values layered over the schema's
// defaults, so a setting the user never touched still has a sensible value.
//
// Modules should call this on every request rather than once at startup —
// that's what lets a settings change take effect without a restart.
function readConfig(moduleId) {
	const schema = readSchema(moduleId) || [];
	const saved = savedValues(moduleId);
	const config = {};

	for (const field of schema) {
		config[field.key] =
			saved[field.key] !== undefined ? saved[field.key] : field.default;
	}

	return config;
}

// Save settings for a module. Only keys the module actually declared are
// written, so nothing unexpected ends up in the file.
function writeConfig(moduleId, values) {
	const schema = readSchema(moduleId) || [];
	const clean = {};

	for (const field of schema) {
		if (values[field.key] === undefined) {
			continue;
		}

		let value = values[field.key];

		// Form fields arrive as strings — convert to the declared type
		if (field.type === "number") {
			value = Number(value);
			if (Number.isNaN(value)) continue;
		}

		if (field.type === "boolean") {
			value = value === true || value === "true" || value === "on";
		}

		clean[field.key] = value;
	}

	fs.mkdirSync(configDir, { recursive: true });

	fs.writeFileSync(
		path.join(configDir, moduleId + ".json"),
		JSON.stringify(clean, null, "\t")
	);

	return clean;
}

module.exports = { readManifest, readSchema, readConfig, writeConfig };