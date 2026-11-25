// core/settings-store.js
// OmniCore's own settings — the ones that apply to the whole install
// rather than to any single face.
//
// Kept separate from face settings and module settings because they answer
// a different question: not "how should this dashboard look" but "what is
// OmniCore allowed to do".

const fs = require("fs");
const path = require("path");
const paths = require("./paths");

function settingsPath() {
	return path.join(paths.dataDir(), "settings.json");
}

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

	// --- Place search (since v2) ---------------------------------------
	// Which service a "Search for a city" box asks: the Primary first,
	// the Secondary when the Primary finds nothing, can't be reached, or
	// needs a key that isn't saved. "none" for no Secondary. Both default
	// to services that need no key. See place-search.js.
	placeSearchPrimary: "open-meteo",
	placeSearchSecondary: "nominatim",

	// Keys for the services that need one, by service: { geonames: "..." }.
	// Never sent back to a page once saved, never logged.
	placeSearchKeys: {},

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

	// Light or dark is NOT here any more (it was `uiMode` until
	// v1.19.2, then a cookie per browser until 2.0.0). An old settings
	// file that still has uiMode in it is harmless: nothing reads it.
	//
	// Since 2.0.0 everything below about how the pages look (the font,
	// its size, the Back button's corner, the background, the glass, the
	// font colour) is an appearance profile's: an .ocap file each
	// browser picks (profiles.js). The values here are what an install
	// had before profiles, which the first profile is made from, and
	// what's used if no profile can be read at all.

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
	backButtonCorner: "bottom-right",

	// --- Background and glass (since v2) -----------------------------
	// What's behind OmniCore's own pages: "plain" is the Default (black,
	// or Beige Cream with black text), "picture", "animated" and
	// "video" a file, "colour" one colour (backgroundColor). See
	// backdrop.js for what each means.
	backgroundKind: "plain",
	backgroundType: "",
	backgroundFile: "",
	backgroundStill: "",
	// Worked out from the picture once, when it was picked: its dominant
	// colour and its most vibrant one (for the tint), and how dark its
	// darker parts, how bright its brighter parts and how bright it is
	// overall (for Auto, which keeps the text readable)
	backgroundColor: "",
	backgroundVibrant: "",
	backgroundLow: 0,
	backgroundHigh: 0,
	backgroundMean: 0,
	// Picture brightness: -50 (50% darker) to +50 (50% brighter), 0 being
	// the picture as it is (Original)
	pictureBrightness: 0,

	// The frosted glass of every segment: its blur (0-40 px), a tint
	// ("none", "dominant" or "vibrant" (the background's own colours), or a
	// colour like "#7aa2ff") at a strength of 0-100 (%), and a Dim (0-100%),
	// darkness added to the tint.
	//
	// One Auto looks after Blur, Tint strength and Dim (glassAuto). A slider
	// moved by hand is pinned (glassPinned: "blur", "tintStrength", "dim")
	// and keeps the value here; Auto works the others out. With Auto off,
	// all three are these values. See backdrop.js.
	glassAuto: true,
	glassPinned: [],
	glassBlur: 20,
	glassTint: "none",
	glassTintStrength: 12,
	glassDim: 0,

	// The text over a picture or a colour: "white" or "black". Core
	// switches it when the glass or the background changes and the text
	// can't be read otherwise (backdrop.js). The glass looks the same
	// either way.
	fontColour: "white",

	// --- Notifications ----------------------------------------------
	// Live here rather than in a face or a theme because the overlay is
	// Core's, not a theme's. Every display showing a face draws it -- see
	// notifications.js.

	// Off means Core sends nothing at all, and no display shows
	// anything, regardless of what raised it.
	notificationsEnabled: true,

	// What happens to a notification raised while no display is
	// watching. False drops it, which is the honest default for a wall
	// display: arriving to twenty stale notifications from overnight is
	// worse than having missed them. True holds them for the next
	// display that connects.
	notificationsStoreWhileAsleep: false,

	// The ceiling on what gets held while asleep, so a module stuck in a
	// loop can't fill the disk. Oldest are dropped first.
	notificationsStoredMax: 20,

	// Nothing below this priority is shown at all. 1 shows everything;
	// 5 shows only the most urgent. See PRIORITY_SECONDS in
	// notifications.js for what each level means.
	notificationsMinimumPriority: 1
};

// The settings file as it is, with nothing from a profile: what the
// install itself says. (profiles.js reads this, to find its default.)
function readStoredSettings() {
	if (!fs.existsSync(settingsPath())) {
		return { ...DEFAULTS };
	}

	try {
		const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
		return { ...DEFAULTS, ...saved };
	} catch (error) {
		// A corrupt settings file shouldn't stop OmniCore starting
		return { ...DEFAULTS };
	}
}

function writeStoredSettings(changes) {
	const settings = { ...readStoredSettings(), ...changes };

	fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
	fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, "\t"));

	return settings;
}

// The profile the browser asking now uses, if there is one that can be
// read (profiles.js). Required here rather than at the top, because
// profiles.js reads this file too.
function currentProfile() {
	try {
		return require("./profiles").current();
	} catch (error) {
		return null;
	}
}

// Everything, as the page being drawn should see it: the install's own
// settings, with the look (the font, the background, the glass...) from
// the profile this browser uses. `profile` says which one: { id, name }.
function readSettings() {
	const stored = readStoredSettings();
	const profile = currentProfile();
	if (!profile || !profile.valid) return stored;
	return { ...stored, ...profile.values, profile: { id: profile.id, name: profile.name } };
}

// Saves some settings. The look's (profiles.js KEYS) go into the profile
// this browser uses, which every device using it then sees; the rest into
// the settings file. With no profile at all, everything goes in the file.
function writeSettings(changes) {
	const profile = currentProfile();
	if (!profile || !profile.valid) {
		writeStoredSettings(changes);
		return readSettings();
	}

	const { KEYS, update } = require("./profiles");
	const look = {};
	const rest = {};
	for (const [name, value] of Object.entries(changes || {})) {
		if (KEYS.includes(name)) look[name] = value;
		else if (name !== "profile") rest[name] = value;
	}

	if (Object.keys(look).length) update(profile.id, look);
	if (Object.keys(rest).length) writeStoredSettings(rest);
	return readSettings();
}

module.exports = { readSettings, writeSettings, readStoredSettings, writeStoredSettings, DEFAULTS };
