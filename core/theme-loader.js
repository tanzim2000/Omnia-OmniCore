// core/theme-loader.js
// Finds installed themes and reads what they say about themselves.
//
// A theme is a folder of static files. It may contain:
//
//   theme.json      name and description
//   settings.json   what it can be configured with
//   index.html      the page itself
//
// Themes declare their settings exactly the way modules do, and OmniCore
// renders the form. A theme never ships a settings UI — that's what keeps
// every settings page consistent no matter who wrote the theme.

const fs = require("fs");
const path = require("path");

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

// A face's stored theme settings, with the schema's defaults filling gaps
function applyDefaults(themeId, stored) {
	const schema = readSchema(themeId);
	const config = {};

	for (const field of schema) {
		config[field.key] =
			stored && stored[field.key] !== undefined
				? stored[field.key]
				: field.default;
	}

	return config;
}

// Tidy values coming from a settings form: keep only what the theme
// declared, converted to the declared type
function cleanConfig(themeId, values) {
	const schema = readSchema(themeId);
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

		clean[field.key] = value;
	}

	return clean;
}

module.exports = {
	listThemes,
	readManifest,
	readSchema,
	applyDefaults,
	cleanConfig
};