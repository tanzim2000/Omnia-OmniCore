// core/theme-loader.js
// Finds installed themes and reads what they say about themselves.
//
// A theme is a folder of static files. It may contain:
//
//   theme.json               name and description
//   settings.json            what the THEME can be configured with
//   instance-settings.json   what the theme wants configured PER INSTANCE
//   index.html               the page itself
//
// The two schemas answer different questions. settings.json is "how should
// this dashboard look" — one answer per face. instance-settings.json is
// "how should this particular tile be shown" — one answer per module
// instance. A theme that sizes things in named steps declares one kind of
// field there; a theme that uses a number declares another; a theme that
// works it out for itself declares nothing and the control never appears.
//
// Themes declare their settings exactly the way modules do, and OmniCore
// renders the form. A theme never ships a settings UI — that's what keeps
// every settings page consistent no matter who wrote the theme.

const fs = require("fs");
const path = require("path");
const priority = require("./priority");

const themesDir = path.join(__dirname, "..", "themes");

function themeDir(themeId) {
	return path.join(themesDir, themeId);
}

// A theme's name and description, falling back to its folder name
function readManifest(themeId) {
	const manifestPath = path.join(themeDir(themeId), "theme.json");

	if (!fs.existsSync(manifestPath)) {
		return { id: themeId, name: themeId, description: "" };
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

		return {
			id: themeId,
			name: parsed.name || themeId,
			description: parsed.description || ""
		};
	} catch (error) {
		return { id: themeId, name: themeId, description: "" };
	}
}

// Every theme installed on this OmniCore
function listThemes() {
	if (!fs.existsSync(themesDir)) {
		return [];
	}

	return fs
		.readdirSync(themesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => readManifest(entry.name));
}

// What settings a theme accepts. Empty list if it has none.
function readSchema(themeId) {
	const schemaPath = path.join(themeDir(themeId), "settings.json");

	if (!fs.existsSync(schemaPath)) {
		return [];
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		return parsed.settings || [];
	} catch (error) {
		console.log(`  Unreadable settings.json in theme: ${themeId}`);
		return [];
	}
}

// Layer stored values over a schema's defaults. Shared by both schemas —
// a face's theme settings and an instance's.
function fill(schema, stored) {
	const config = {};

	for (const field of schema) {
		const value =
			stored && stored[field.key] !== undefined
				? stored[field.key]
				: field.default;

		// Reconciled against what the theme declares now, the same way a
		// module's priority field is
		config[field.key] =
			field.type === "priority"
				? priority.normalize(value, field.options)
				: value;
	}

	return config;
}

// Keep only what a schema declared, converted to the declared type, since
// form fields arrive as strings
function tidy(schema, values) {
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
			value = priority.normalize(value, field.options);
		}

		clean[field.key] = value;
	}

	return clean;
}

// A face's stored theme settings, with the schema's defaults filling gaps
function applyDefaults(themeId, stored) {
	return fill(readSchema(themeId), stored);
}

// Tidy values coming from a theme's settings form
function cleanConfig(themeId, values) {
	return tidy(readSchema(themeId), values);
}

// What a theme wants configured for each module instance — its size,
// usually. Empty list if the theme sizes things for itself.
function readInstanceSchema(themeId) {
	const schemaPath = path.join(themeDir(themeId), "instance-settings.json");

	if (!fs.existsSync(schemaPath)) {
		return [];
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		return parsed.settings || [];
	} catch (error) {
		console.log(`  Unreadable instance-settings.json in theme: ${themeId}`);
		return [];
	}
}

// Layer an instance's stored theme settings over that schema's defaults
// The settings a new instance should start with.
//
// A module can say in its manifest that it doesn't want a tile — a
// wallpaper source has nothing useful to show. But "hidden" is spelled
// differently by every theme: one has a Hidden option, another uses zero,
// a third sizes everything itself. So a theme marks which of its own
// values means hidden, and OmniCore uses that. No theme has to know about
// modules, and OmniCore doesn't have to understand any theme's scale.
function instanceDefaults(themeId, wantsTile) {
	const schema = readInstanceSchema(themeId);
	const config = {};

	for (const field of schema) {
		config[field.key] =
			wantsTile === false && field.hiddenValue !== undefined
				? field.hiddenValue
				: field.default;
	}

	return config;
}

function applyInstanceDefaults(themeId, stored) {
	return fill(readInstanceSchema(themeId), stored);
}

// Tidy values from an instance's theme settings form
function cleanInstanceConfig(themeId, values) {
	return tidy(readInstanceSchema(themeId), values);
}

module.exports = {
	listThemes,
	readManifest,
	readSchema,
	applyDefaults,
	cleanConfig,
	readInstanceSchema,
	instanceDefaults,
	applyInstanceDefaults,
	cleanInstanceConfig
};
