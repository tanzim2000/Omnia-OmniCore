// core/theme-loader.js
// Auto-discovers themes by scanning the themes/ folder — dropping a theme
// folder in is enough for it to become available for faces to use.

const fs = require("fs");
const path = require("path");

function listThemes() {
	const themesDir = path.join(__dirname, "..", "themes");

	if (!fs.existsSync(themesDir)) {
		return [];
	}

	return fs
		.readdirSync(themesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const manifestPath = path.join(themesDir, entry.name, "theme.json");

			// A theme without a manifest still counts — fall back to its folder name
			let manifest = { name: entry.name };
			if (fs.existsSync(manifestPath)) {
				manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			}

			return {
				id: entry.name, // folder name is the theme's ID
				name: manifest.name || entry.name,
				description: manifest.description || ""
			};
		});
}

module.exports = { listThemes };