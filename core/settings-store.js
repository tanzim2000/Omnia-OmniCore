// core/settings-store.js
// OmniCore's own settings — the ones that apply to the whole install
// rather than to any single face.
//
// Kept separate from face settings and module settings because they answer
// a different question: not "how should this dashboard look" but "what is
// OmniCore allowed to do".

const fs = require("fs");
const path = require("path");

const settingsPath = path.join(__dirname, "..", "data", "settings.json");

// Anything not yet saved falls back to these
const DEFAULTS = {
	// Location services are on by default — most people want a dashboard
	// that just knows where it is. Turning this off means OmniCore never
	// looks up or hands out a location at all.
	locationEnabled: true,

	// "auto"   work it out from the server's IP address
	// "manual" use the coordinates below
	locationMode: "auto",

	latitude: null,
	longitude: null,
	locationLabel: "",

	// Where to look for modules and themes that can be installed. A
	// setting rather than a constant so an install can be pointed at a
	// fork, a private list, or a local file during development —
	// blank means use the project's own registry.
	registryUrl: ""
};

function readSettings() {
	if (!fs.existsSync(settingsPath)) {
		return { ...DEFAULTS };
	}

	try {
		const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		return { ...DEFAULTS, ...saved };
	} catch (error) {
		// A corrupt settings file shouldn't stop OmniCore starting
		return { ...DEFAULTS };
	}
}

function writeSettings(changes) {
	const settings = { ...readSettings(), ...changes };

	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"));

	return settings;
}

module.exports = { readSettings, writeSettings, DEFAULTS };