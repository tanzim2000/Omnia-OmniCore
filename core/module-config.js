// core/module-config.js
// What a module SAYS about itself: its name, and what settings it accepts.
//
// Note this file no longer stores any values. A module's settings are now
// held on the instance that uses them, inside the face — so the same module
// can be configured differently for each tile that shows it.

const fs = require("fs");
const path = require("path");
const priority = require("./priority");

const modulesDir = path.join(__dirname, "..", "modules");

// A module's manifest: a readable name and description, from a module.json
// in its folder. Mirrors how themes describe themselves in theme.json.
// Falls back to the folder name so a module without one still works.
function readManifest(moduleId) {
	const manifestPath = path.join(modulesDir, moduleId, "module.json");

	// `provides` lists the block types this module can emit — "background",
	// "image", and so on. It lets OmniCore offer only the modules that could
	// actually do a job: a wallpaper picker shouldn't list Docker.
	const blank = {
		id: moduleId,
		name: moduleId,
		description: "",
		provides: [],
		tile: true
	};

	if (!fs.existsSync(manifestPath)) {
		return blank;
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

		return {
			id: moduleId,
			name: parsed.name || moduleId,
			description: parsed.description || "",
			provides: Array.isArray(parsed.provides) ? parsed.provides : [],
			// Some modules work behind the scenes — a wallpaper source has
			// nothing useful to show in a tile of its own, and giving it one
			// just wastes a slot. They can still be switched on per instance.
			tile: parsed.tile !== false
		};
	} catch (error) {
		return blank;
	}
}

// What settings a module accepts, from its settings.json.
// Returns an empty list if it has none — plenty of modules need nothing.
function readSchema(moduleId) {
	const schemaPath = path.join(modulesDir, moduleId, "settings.json");

	if (!fs.existsSync(schemaPath)) {
		return [];
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		return parsed.settings || [];
	} catch (error) {
		console.log(`  Unreadable settings.json in module: ${moduleId}`);
		return [];
	}
}

// An instance's stored settings, with the schema's defaults filling any gap.
// A setting the user never touched still arrives with a sensible value.
function applyDefaults(moduleId, stored) {
	const schema = readSchema(moduleId);
	const config = {};

	for (const field of schema) {
		const value =
			stored && stored[field.key] !== undefined
				? stored[field.key]
				: field.default;

		// A priority field is reconciled against what the module declares
		// right now, so a module that has since gained or lost an item
		// still receives a complete, current list
		config[field.key] =
			field.type === "priority"
				? priority.normalize(value, field.options)
				: value;
	}

	return config;
}

// Tidy up values coming from a settings form: keep only keys the module
// actually declared, and convert them to the declared type, since form
// fields arrive as strings.
function cleanConfig(moduleId, values) {
	const schema = readSchema(moduleId);
	const clean = {};

	for (const field of schema) {
		if (!values || values[field.key] === undefined) {
			continue;
		}

		let value = values[field.key];

		if (field.type === "number") {
			value = Number(value);
			if (Number.isNaN(value)) continue;
		}

		if (field.type === "boolean") {
			value = value === true || value === "true" || value === "on";
		}

		if (field.type === "priority") {
			// Arrives from the form as a JSON string in a hidden input.
			// Normalising here means a tampered or stale order can never
			// reach a module — it always gets the full declared list.
			value = priority.normalize(value, field.options);
		}

		if (field.type === "location") {
			// Either "use OmniCore's location", or coordinates typed in here
			value =
				value && value.mode === "manual"
					? {
							mode: "manual",
							latitude: Number(value.latitude),
							longitude: Number(value.longitude),
							label: value.label || ""
					  }
					: { mode: "core" };

			if (
				value.mode === "manual" &&
				(Number.isNaN(value.latitude) || Number.isNaN(value.longitude))
			) {
				continue; // incomplete coordinates — leave the old value alone
			}
		}

		clean[field.key] = value;
	}

	return clean;
}

module.exports = { readManifest, readSchema, applyDefaults, cleanConfig };