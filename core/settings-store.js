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

	// Registries to check for installable modules and themes, beyond the
	// project's own built-in one — which is never in this list, and is
	// never removable. Adding a source means trusting whoever runs it to
	// review what gets listed there the way the built-in one is reviewed;
	// see the warning shown before one is ever added.
	registrySources: [],

	// --- The Default UI ---------------------------------------------
	// How OmniCore's own built-in pages look: admin faces (3xxx), the
	// welcome face (4000), the setup wizard (3999), and input faces
	// (5xxx). Dashboard faces (4001-4999) are NOT covered by any of
	// this — their appearance belongs entirely to whichever theme
	// they're running. See docs/planning/default-ui-architecture.md.

	// "dark" | "light". One universal toggle for every face above.
	uiMode: "dark",

	// Font family for those same pages. Empty means the system's own
	// font, which is what a fresh install uses — nothing is downloaded
	// until someone actually picks something.
	uiFontFamily: "",

	// Base font size in pixels. Everything else scales in `em` from
	// this, so one number changes the whole UI's density.
	uiFontSize: 16,

	// Which corner the floating back button sits in: "bottom-right" or
	// "top-left". Deliberately NOT bottom-left, which is reserved for
	// the welcome face's auto-advance timer.
	backButtonCorner: "bottom-right"
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