// core/module-config.js
// What a module SAYS about itself: its name, and what settings it accepts.
//
// Note this file no longer stores any values. A module's settings are now
// held on the instance that uses them, inside the face — so the same module
// can be configured differently for each tile that shows it.

const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const priority = require("./priority");
const widgetTypes = require("./widget-types");

function modulesDir() {
	return paths.modulesDir();
}

// A module's manifest: a readable name and description, from a module.json
// in its folder. Mirrors how themes describe themselves in theme.json.
// Falls back to the folder name so a module without one still works.
function readManifest(moduleId) {
	const manifestPath = path.join(modulesDir(), moduleId, "module.json");

	// `provides` lists the block types this module can emit — "background",
	// "image", and so on. It lets OmniCore offer only the modules that could
	// actually do a job: a wallpaper picker shouldn't list Docker.
	const blank = {
		id: moduleId,
		name: moduleId,
		description: "",
		provides: [],
		tile: true,
		background: false,
		widgets: []
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
			tile: parsed.tile !== false,
			// Does this module keep running between requests, rather than
			// only when a display asks it for something? Said outright
			// rather than guessed from whether index.js happens to export a
			// `start` -- so it can be read without running any of the
			// module's code, and shown to somebody before they install it.
			// Only an exact `true` counts. See core/background.js.
			background: parsed.background === true,
			// The different shapes this module can show its data in -- a
			// month grid and an agenda list, say. Empty for a module that
			// offers no choice, which is nearly all of them. Checked here,
			// once, so nothing downstream has to wonder whether an entry is
			// usable. See core/widget-types.js.
			widgets: widgetTypes.readWidgets(moduleId, parsed.widgets)
		};
	} catch (error) {
		return blank;
	}
}

// What settings a module accepts, from its settings.json.
// Returns an empty list if it has none — plenty of modules need nothing.
//
// For a module that offers widget types, every field comes back with a
// clean `widgets` tag saying which types it belongs to, and a field that
// doesn't say is left out (with a warning in the log). A module without
// widget types gets its fields back exactly as written.
function readSchema(moduleId) {
	const schemaPath = path.join(modulesDir(), moduleId, "settings.json");

	if (!fs.existsSync(schemaPath)) {
		return [];
	}

	let fields;

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		fields = Array.isArray(parsed.settings) ? parsed.settings : [];
	} catch (error) {
		console.log(`  Unreadable settings.json in module: ${moduleId}`);
		return [];
	}

	const manifest = readManifest(moduleId);

	if (widgetTypes.offersChoice(manifest)) {
		return widgetTypes.moduleFields(moduleId, fields, manifest.widgets);
	}

	// No choice of widget types, so a `widgets` tag means nothing here.
	// Taken off so it can't change how the form is drawn: a module like
	// this gets exactly the form it always did.
	return fields.map((field) => {
		if (!field || typeof field !== "object" || !("widgets" in field)) {
			return field;
		}

		const { widgets, ...rest } = field;
		return rest;
	});
}

// Which widget type an instance shows, from its stored settings. For a
// module that offers no choice this is just the module's own id.
function widgetTypeOf(moduleId, stored) {
	return widgetTypes.resolve(readManifest(moduleId), stored && stored[widgetTypes.KEY]);
}

// What input controls a module wants — a button to tap, for now — from
// its input.json. Empty means the module has no input face at all, same
// "missing file means none of this" pattern as settings.json.
function readInputSchema(moduleId) {
	const schemaPath = path.join(modulesDir(), moduleId, "input.json");

	if (!fs.existsSync(schemaPath)) {
		return [];
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		return Array.isArray(parsed.controls) ? parsed.controls : [];
	} catch (error) {
		console.log(`  Unreadable input.json in module: ${moduleId}`);
		return [];
	}
}

// An instance's stored settings, with the schema's defaults filling any gap.
// A setting the user never touched still arrives with a sensible value.
//
// A module that offers widget types also gets `widgetType`: the one this
// instance shows. It's always one the module offers right now -- a stored
// type that's since been renamed or removed becomes the module's first.
// That one value is how the module knows which shape to draw; it simply
// reads it and branches. A module without widget types never sees it.
function applyDefaults(moduleId, stored) {
	const schema = readSchema(moduleId);
	const manifest = readManifest(moduleId);
	const config = {};

	if (widgetTypes.offersChoice(manifest)) {
		config[widgetTypes.KEY] = widgetTypes.resolve(
			manifest,
			stored && stored[widgetTypes.KEY]
		);
	}

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
	const manifest = readManifest(moduleId);
	const clean = {};

	// The picked widget type, if this module offers a choice and the value
	// is one it actually offers. Anything else is left out, and the
	// instance shows the module's first type -- never an id that would
	// leave the module guessing.
	if (
		widgetTypes.offersChoice(manifest) &&
		values &&
		manifest.widgets.some((widget) => widget.id === values[widgetTypes.KEY])
	) {
		clean[widgetTypes.KEY] = values[widgetTypes.KEY];
	}

	for (const field of schema) {
		if (!values || values[field.key] === undefined) {
			continue;
		}

		let value = values[field.key];

		if (field.type === "number") {
			// A box left empty means "not set", so the default applies --
			// not zero, which is what Number("") would quietly make it
			if (value === "" || value === null) continue;

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
			// "Set coordinates here", with the boxes left empty. Kept as
			// manual with no coordinates, which the module receives as
			// null ("no location") -- not as 0, 0, a real spot in the
			// Atlantic, which is what converting the empty boxes gave.
			const blank = (part) => part === undefined || part === null || part === "";

			if (value && value.mode === "manual" && (blank(value.latitude) || blank(value.longitude))) {
				clean[field.key] = { mode: "manual" };
				continue;
			}

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

module.exports = {
	readManifest,
	readSchema,
	readInputSchema,
	applyDefaults,
	cleanConfig,
	widgetTypeOf
};