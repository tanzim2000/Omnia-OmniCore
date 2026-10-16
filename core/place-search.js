// core/place-search.js
// Looking places up by name: "Bekkestua" in, a few matches with their
// coordinates out. Used wherever OmniCore offers "Search for a city": the
// Location Service on the settings page, a widget's location setting, and
// the setup wizard. One function serves all three, so a change here is a
// change everywhere.
//
// WHY MORE THAN ONE SERVICE
//
// Until v2 this asked Open-Meteo only. Open-Meteo is free and needs no key,
// but it only knows cities and towns: nothing for Bekkestua, and Bærum
// only as the village Bærums verk. Services built on OpenStreetMap know
// villages, neighbourhoods and stations. Others need a key but have more.
// No single one is best for everyone, so the person picks:
//
//   Primary     asked first
//   Secondary   asked when the Primary finds nothing, can't be reached,
//               refuses its key, or needs a key that isn't saved. Can be
//               None.
//
// Default: Open-Meteo, then Nominatim. Both without a key, so a fresh
// install finds small places without anyone signing up for anything.
//
// WHAT LEAVES THE MACHINE
//
// Only what the person typed, sent to the service picked, when Search is
// pressed (never as they type: Nominatim forbids that outright, and it
// would send half-typed words to someone else for nothing). Along with it
// goes OmniCore's User-Agent, and the key for a service that needs one.
// Nothing about where OmniCore itself is.
//
// KEYS
//
// Kept in OmniCore's settings (placeSearchKeys), never sent back to a page
// once saved, never written to the log. They travel in the request to the
// one service they belong to, and nowhere else.
//
// BEING A GOOD CLIENT
//
// - Answers are kept for a day (places don't move), so the same search
//   twice is one request. Kept here rather than in module-fetch.js, which
//   keeps every answer it ever got: fine for a module asking the same few
//   addresses, not for everything anyone ever typed.
// - Nominatim allows one request a second from the whole application, and
//   Geocode.maps.co's free plan the same. A request to either waits until a
//   second has passed since the last one.
// - Every request says it comes from OmniCore (the User-Agent), which
//   Nominatim requires.
//
// Every service's answer is turned into the same shape:
//
//   { label: "Bekkestua, Bærum, Akershus, Norway", latitude, longitude }

const { DEFAULT_USER_AGENT } = require("./module-fetch");

// How long an answer is kept, and how many are kept at most (the oldest
// goes first)
const KEEP_MS = 24 * 60 * 60 * 1000;
const KEEP_MOST = 500;

// How long a service gets to answer
const TIMEOUT_MS = 6000;

// Matches shown at most
const LIMIT = 6;

// Credit for data from OpenStreetMap. Its licence (ODbL) asks for it
// wherever the data is shown.
const OSM_CREDIT = {
	text: "© OpenStreetMap contributors",
	url: "https://www.openstreetmap.org/copyright"
};

// "Bekkestua", "Bærum", "", "Bærum", "Norway" -> "Bekkestua, Bærum, Norway".
// Empty parts and repeats (a village whose city is itself) are left out.
function joinLabel(parts) {
	const kept = [];

	for (const part of parts) {
		const text = typeof part === "string" ? part.trim() : "";
		if (text && !kept.includes(text)) kept.push(text);
	}

	return kept.join(", ");
}

// A number from an answer, or null. Some services send "59.91" as text.
function coordinate(value) {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isFinite(number) ? number : null;
}

// One match, or null when it's missing something it can't do without
function place(label, latitude, longitude) {
	const lat = coordinate(latitude);
	const lon = coordinate(longitude);

	if (!label || lat === null || lon === null) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

	return { label, latitude: lat, longitude: lon };
}

// Nominatim, LocationIQ and Geocode.maps.co all answer in Nominatim's
// shape: a list, each with lat, lon (as text), a name and an address
function nominatimPlaces(data) {
	if (!Array.isArray(data)) return null;

	return data.map((item) => {
		const address = item.address || {};
		// The place's own name: `name` from Nominatim and Geocode.maps.co,
		// otherwise the start of the full address (LocationIQ has no `name`)
		const own =
			item.name || address.name || String(item.display_name || "").split(",")[0];

		return place(
			joinLabel([
				own,
				address.municipality || address.city || address.town,
				address.state || address.county,
				address.country
			]) || item.display_name,
			item.lat,
			item.lon
		);
	});
}

// The seven services, in the order they're offered. (Google was one until
// v2 was finished: its terms want results shown on a Google Map and limit
// how long they're kept, and a picked place stays in the settings, so
// OmniCore couldn't keep them. A Google choice saved before then is
// treated as unknown: the default Primary, or no Secondary.)
//
//   name       what the person sees
//   key        what to ask for, for a service that needs one; absent for
//              one that doesn't
//   about      one line on the settings page: what it's like, what it costs
//   signUp     where to get the key
//   credit     shown under the matches it found; `osm` adds OpenStreetMap's
//   gapMs      the shortest time between two requests to it
//   address    the request for a search, as { url, headers }
//   read       its answer -> a list of places, or null when it isn't an
//              answer at all. May throw a { status } for an answer that's
//              really a refusal (GeoNames says "no" with a 200).
const SERVICES = [
	{
		id: "open-meteo",
		name: "Open-Meteo",
		about: "No key. Cities and towns anywhere in the world, but often not villages or neighbourhoods.",
		credit: { text: "Places from Open-Meteo", url: "https://open-meteo.com/" },
		address: (query) => ({
			url:
				"https://geocoding-api.open-meteo.com/v1/search?language=en&count=" + LIMIT +
				"&name=" + encodeURIComponent(query)
		}),
		read: (data) => {
			if (!data || typeof data !== "object") return null;
			// No matches is an answer without `results` at all
			return (data.results || []).map((item) =>
				place(joinLabel([item.name, item.admin1, item.country]), item.latitude, item.longitude)
			);
		}
	},
	{
		id: "nominatim",
		name: "Nominatim (OpenStreetMap)",
		about: "No key. OpenStreetMap's own search: villages, neighbourhoods and stations too. At most one search a second, which OmniCore keeps to.",
		terms: "https://operations.osmfoundation.org/policies/nominatim/",
		credit: { text: "Search by Nominatim", url: "https://nominatim.org/", osm: true },
		gapMs: 1000,
		address: (query) => ({
			url:
				"https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=" +
				LIMIT + "&q=" + encodeURIComponent(query)
		}),
		read: nominatimPlaces
	},
	{
		id: "photon",
		name: "Photon (komoot)",
		about: "No key. OpenStreetMap places, run by komoot for reasonable use.",
		credit: { text: "Search by Photon", url: "https://photon.komoot.io/", osm: true },
		address: (query) => ({
			url: "https://photon.komoot.io/api/?lang=en&limit=" + LIMIT + "&q=" + encodeURIComponent(query)
		}),
		read: (data) => {
			if (!data || !Array.isArray(data.features)) return null;
			return data.features.map((feature) => {
				const where = feature.properties || {};
				const point = (feature.geometry && feature.geometry.coordinates) || [];
				// GeoJSON puts longitude first
				return place(
					joinLabel([where.name, where.city, where.state || where.county, where.country]),
					point[1],
					point[0]
				);
			});
		}
	},
	{
		id: "geonames",
		name: "GeoNames",
		key: "username",
		about: "Needs a free GeoNames account, with its free web services turned on in the account's settings. Its username is the key.",
		signUp: "https://www.geonames.org/login",
		credit: { text: "Places from GeoNames", url: "https://www.geonames.org/" },
		address: (query, key) => ({
			url:
				"https://secure.geonames.org/searchJSON?style=MEDIUM&lang=en&maxRows=" + LIMIT +
				"&q=" + encodeURIComponent(query) + "&username=" + encodeURIComponent(key)
		}),
		read: (data) => {
			if (!data || typeof data !== "object") return null;
			// GeoNames says no with a 200 and a status. 10 is a username
			// that doesn't exist or hasn't turned web services on; 18, 19
			// and 20 are its daily, hourly and weekly limits.
			if (data.status && typeof data.status === "object") {
				const value = Number(data.status.value);
				throw { status: value === 10 ? 401 : [18, 19, 20].includes(value) ? 429 : 500 };
			}
			if (!Array.isArray(data.geonames)) return null;
			return data.geonames.map((item) =>
				place(joinLabel([item.name, item.adminName1, item.countryName]), item.lat, item.lng)
			);
		}
	},
	{
		id: "locationiq",
		name: "LocationIQ",
		key: "API key",
		about: "Needs a free API key. 5,000 searches a day. OpenStreetMap places, and it asks to be credited.",
		signUp: "https://locationiq.com/register",
		credit: { text: "Search by LocationIQ.com", url: "https://locationiq.com/", osm: true },
		address: (query, key) => ({
			url:
				"https://us1.locationiq.com/v1/search?format=json&addressdetails=1&normalizecity=1&accept-language=en&limit=" +
				LIMIT + "&q=" + encodeURIComponent(query) + "&key=" + encodeURIComponent(key)
		}),
		// Nothing found is a 404 from LocationIQ, not an empty list. That's
		// turned into an empty list below (see NOT_FOUND_IS_EMPTY).
		read: nominatimPlaces
	},
	{
		id: "geoapify",
		name: "Geoapify",
		key: "API key",
		about: "Needs a free API key. 3,000 searches a day. OpenStreetMap places, and it asks to be credited.",
		signUp: "https://myprojects.geoapify.com/",
		credit: { text: "Powered by Geoapify", url: "https://www.geoapify.com/", osm: true },
		address: (query, key) => ({
			url:
				"https://api.geoapify.com/v1/geocode/search?format=json&lang=en&limit=" + LIMIT +
				"&text=" + encodeURIComponent(query) + "&apiKey=" + encodeURIComponent(key)
		}),
		read: (data) => {
			if (!data || !Array.isArray(data.results)) return null;
			return data.results.map((item) =>
				place(
					joinLabel([item.name || item.city || item.address_line1, item.city, item.state || item.county, item.country]) ||
						item.formatted,
					item.lat,
					item.lon
				)
			);
		}
	},
	{
		id: "geocode-maps-co",
		name: "Geocode.maps.co",
		key: "API key",
		about: "Needs a free API key. OpenStreetMap places; the free plan allows one search a second, which OmniCore keeps to.",
		signUp: "https://geocode.maps.co/join/",
		credit: { text: "Search by Geocode.maps.co", url: "https://geocode.maps.co/", osm: true },
		gapMs: 1000,
		// The key goes in a header rather than the address, which the
		// service allows
		address: (query, key) => ({
			url:
				"https://geocode.maps.co/search?format=jsonv2&addressdetails=1&accept-language=en&limit=" +
				LIMIT + "&q=" + encodeURIComponent(query),
			headers: { Authorization: "Bearer " + key }
		}),
		read: nominatimPlaces
	}
];

// A service that answers "nothing found" with a 404 instead of an empty
// list
const NOT_FOUND_IS_EMPTY = ["locationiq"];

const DEFAULT_PRIMARY = "open-meteo";
const DEFAULT_SECONDARY = "nominatim";

function serviceById(id) {
	return SERVICES.find((service) => service.id === id) || null;
}

// The Primary and Secondary actually in use, from what's saved. An unknown
// Primary is the default one; an unknown Secondary, or one the same as the
// Primary, is none.
function chosen(settings) {
	const saved = settings || {};
	const primary = serviceById(saved.placeSearchPrimary) || serviceById(DEFAULT_PRIMARY);

	const secondaryId =
		saved.placeSearchSecondary === undefined ? DEFAULT_SECONDARY : saved.placeSearchSecondary;
	const secondary = serviceById(secondaryId);

	return {
		primary,
		secondary: secondary && secondary.id !== primary.id ? secondary : null
	};
}

// The key saved for a service, or "" when there isn't one
function keyFor(service, settings) {
	const keys = (settings && settings.placeSearchKeys) || {};
	const key = keys[service.id];
	return typeof key === "string" ? key.trim() : "";
}

// --- Asking a service --------------------------------------------------------

const kept = new Map(); // "<service> <key> <query>" -> { places, at }
const lastAsked = new Map(); // service id -> when it was last asked

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The network request itself. Replaced in the tests, which use saved
// answers rather than the real services.
async function request(url, headers) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: { "User-Agent": DEFAULT_USER_AGENT, ...(headers || {}) },
			signal: controller.signal
		});
		let data = null;
		try {
			data = await response.json();
		} catch (error) {
			data = null;
		}
		return { status: response.status, data };
	} finally {
		clearTimeout(timer);
	}
}

let send = request;

// Ask one service. Always resolves, to one of:
//
//   { outcome: "found", places }
//   { outcome: "nothing" }          it answered, with no matches
//   { outcome: "no-key" }           it needs a key and none is saved
//   { outcome: "key-refused" }      it said the key is wrong
//   { outcome: "busy" }             it said too many searches
//   { outcome: "unreachable" }      no answer, or not one it could read
async function ask(service, query, settings) {
	const key = service.key ? keyFor(service, settings) : "";

	if (service.key && !key) {
		return { outcome: "no-key" };
	}

	// The same search to the same service, with the same key, within a
	// day: the answer from last time
	const memo = service.id + " " + key + " " + query.toLowerCase();
	const before = kept.get(memo);

	if (before && before.at + KEEP_MS > Date.now()) {
		return before.places.length
			? { outcome: "found", places: before.places }
			: { outcome: "nothing" };
	}

	// Services that allow only so many requests a second
	if (service.gapMs) {
		const wait = (lastAsked.get(service.id) || 0) + service.gapMs - Date.now();
		lastAsked.set(service.id, Date.now() + Math.max(0, wait));
		if (wait > 0) await sleep(wait);
	}

	const { url, headers } = service.address(query, key);
	let answer;

	try {
		answer = await send(url, headers);
	} catch (error) {
		return { outcome: "unreachable" };
	}

	if (answer.status === 401 || answer.status === 403) return { outcome: "key-refused" };
	if (answer.status === 429) return { outcome: "busy" };

	let places;

	if (answer.status === 404 && NOT_FOUND_IS_EMPTY.includes(service.id)) {
		places = [];
	} else if (answer.status < 200 || answer.status >= 300) {
		return { outcome: "unreachable" };
	} else {
		try {
			places = service.read(answer.data);
		} catch (refusal) {
			const status = refusal && refusal.status;
			return { outcome: status === 401 ? "key-refused" : status === 429 ? "busy" : "unreachable" };
		}
	}

	if (!Array.isArray(places)) return { outcome: "unreachable" };

	// Whatever couldn't be read is left out, and two matches that read the
	// same (a village and its station) are shown once
	const seen = new Set();
	const clean = places.filter((match) => {
		if (!match || seen.has(match.label)) return false;
		seen.add(match.label);
		return true;
	}).slice(0, LIMIT);

	// Keep it, dropping the oldest when there are too many
	kept.set(memo, { places: clean, at: Date.now() });
	if (kept.size > KEEP_MOST) kept.delete(kept.keys().next().value);

	return clean.length ? { outcome: "found", places: clean } : { outcome: "nothing" };
}

// --- The search ----------------------------------------------------------------

// Why the Primary didn't do, in words, for the line under the matches
const BECAUSE = {
	nothing: (name) => `${name} found nothing`,
	"no-key": (name) => `${name} has no key saved`,
	"key-refused": (name) => `${name} refused its key`,
	busy: (name) => `${name} said too many searches`,
	unreachable: (name) => `${name} couldn't be reached`
};

// What the page is told: the credit for whoever answered, ready to show
function creditFor(service) {
	return {
		text: service.credit.text,
		url: service.credit.url,
		osm: service.credit.osm ? OSM_CREDIT : null
	};
}

// Search for a place by name. `settings` is OmniCore's (readSettings()).
//
// Resolves to:
//   places      the matches, possibly none
//   service     { id, name } of whoever found them, or null
//   credit      what to show under them (see creditFor), or null
//   note        a line saying the Secondary was asked and why, or why
//               nothing could be found; null when the Primary just
//               answered
async function searchPlaces(query, settings) {
	const text = typeof query === "string" ? query.trim().slice(0, 200) : "";

	if (text.length < 2) {
		return { places: [], service: null, credit: null, note: null };
	}

	const { primary, secondary } = chosen(settings);
	const first = await ask(primary, text, settings);

	if (first.outcome === "found") {
		return {
			places: first.places,
			service: { id: primary.id, name: primary.name },
			credit: creditFor(primary),
			note: null
		};
	}

	const why = BECAUSE[first.outcome](primary.name);

	if (!secondary) {
		return {
			places: [],
			service: null,
			credit: null,
			note: first.outcome === "nothing" ? null : why + "."
		};
	}

	const second = await ask(secondary, text, settings);

	if (second.outcome === "found") {
		return {
			places: second.places,
			service: { id: secondary.id, name: secondary.name },
			credit: creditFor(secondary),
			note: `${why}, so ${secondary.name} was asked.`
		};
	}

	return {
		places: [],
		service: null,
		credit: null,
		note:
			first.outcome === "nothing" && second.outcome === "nothing"
				? `Neither ${primary.name} nor ${secondary.name} found it.`
				: `${why}, and ${BECAUSE[second.outcome](secondary.name)}.`
	};
}

// --- The setting -----------------------------------------------------------------

// What may be saved, from what a page sent. Unknown services are ignored;
// a key is only kept for a service that takes one, trimmed and at most 200
// characters. An empty key box means "leave the saved key as it is";
// `removeKeys` lists the ones to forget.
function cleanSetting(body, current) {
	const sent = body && typeof body === "object" ? body : {};
	const saved = current || {};
	const changes = {};

	if (serviceById(sent.primary)) {
		changes.placeSearchPrimary = sent.primary;
	}

	if (sent.secondary === "none" || serviceById(sent.secondary)) {
		changes.placeSearchSecondary = sent.secondary;
	}

	// A Secondary the same as the Primary is no Secondary
	const primary = changes.placeSearchPrimary || saved.placeSearchPrimary || DEFAULT_PRIMARY;
	const secondary =
		changes.placeSearchSecondary !== undefined
			? changes.placeSearchSecondary
			: saved.placeSearchSecondary;
	if (secondary === primary) {
		changes.placeSearchSecondary = "none";
	}

	const keys = { ...((saved.placeSearchKeys && typeof saved.placeSearchKeys === "object") ? saved.placeSearchKeys : {}) };
	let keysChanged = false;

	if (sent.keys && typeof sent.keys === "object") {
		for (const [id, value] of Object.entries(sent.keys)) {
			const service = serviceById(id);
			if (!service || !service.key || typeof value !== "string") continue;
			const key = value.trim().slice(0, 200);
			if (key) {
				keys[id] = key;
				keysChanged = true;
			}
		}
	}

	if (Array.isArray(sent.removeKeys)) {
		for (const id of sent.removeKeys) {
			if (typeof id === "string" && keys[id] !== undefined) {
				delete keys[id];
				keysChanged = true;
			}
		}
	}

	if (keysChanged) {
		changes.placeSearchKeys = keys;
	}

	return changes;
}

// For the settings page: every service, and whether a key is saved for
// it. Never the key itself.
function servicesForPage(settings) {
	return SERVICES.map((service) => ({
		id: service.id,
		name: service.name,
		about: service.about,
		key: service.key || null,
		signUp: service.signUp || null,
		terms: service.terms || null,
		keySaved: service.key ? Boolean(keyFor(service, settings)) : false
	}));
}

// A line for the settings page when what's saved won't work as it reads:
// a Primary that needs a key with none saved. Null when all is well.
function warningFor(settings) {
	const { primary, secondary } = chosen(settings);

	if (primary.key && !keyFor(primary, settings)) {
		return secondary && !(secondary.key && !keyFor(secondary, settings))
			? `${primary.name} has no key saved, so every search goes straight to ${secondary.name}.`
			: `${primary.name} has no key saved, and there's nothing to fall back on, so searches find nothing.`;
	}

	if (secondary && secondary.key && !keyFor(secondary, settings)) {
		return `${secondary.name} has no key saved, so it's never asked.`;
	}

	return null;
}

// For the tests: answer from saved files instead of the network, and
// start from a clean slate
function setRequestForTests(fake) {
	send = fake || request;
	kept.clear();
	lastAsked.clear();
}

module.exports = {
	SERVICES,
	DEFAULT_PRIMARY,
	DEFAULT_SECONDARY,
	searchPlaces,
	chosen,
	cleanSetting,
	servicesForPage,
	warningFor,
	joinLabel,
	setRequestForTests
};
