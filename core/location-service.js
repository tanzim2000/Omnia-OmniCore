// core/location-service.js
// OmniCore's location service.
//
// A dashboard often wants to know where it is — weather, prayer times,
// sunrise and sunset all depend on it. Rather than every module working
// that out separately, OmniCore establishes it once and hands it out.
//
// That means one switch controls the whole install. Turn location services
// off and OmniCore never looks up a location and never hands one out; a
// module asking for it gets nothing back and has to cope.
//
// Worth being precise about how strong that guarantee is:
//
//   THEMES are genuinely sandboxed. They're static files with no server
//   side, so the only data they can reach is what a face hands them. If
//   OmniCore doesn't expose a location, a theme has no way to get one.
//
//   MODULES are trusted backend code, like any Node program. A module
//   *could* call a geolocation service itself, the same way it could read
//   any file or open any socket. This service makes doing the right thing
//   the easy path — it isn't a sandbox, and shouldn't be described as one.

const { fetchCached } = require("./module-fetch");
const { readSettings } = require("./settings-store");
const { readSchema } = require("./module-config");

// A home server's IP address rarely changes, so there's no reason to look
// this up often. Six hours.
const LOOKUP_CACHE_SECONDS = 6 * 60 * 60;

// HTTPS and no API key. Deliberately not one of the http-only providers —
// sending the server's address in plaintext to find out where it is would
// be a poor trade for a project like this.
const LOOKUP_URL = "https://ipwho.is/";

// Where OmniCore believes it is. Returns null when location services are
// off, or when the lookup failed and nothing manual was set.
async function getLocation() {
	const settings = readSettings();

	if (!settings.locationEnabled) {
		return null;
	}

	if (settings.locationMode === "manual") {
		if (settings.latitude === null || settings.longitude === null) {
			return null;
		}

		return {
			latitude: Number(settings.latitude),
			longitude: Number(settings.longitude),
			label: settings.locationLabel || "",
			source: "manual"
		};
	}

	// Automatic: work it out from the server's public IP
	const { data } = await fetchCached(LOOKUP_URL, {
		cacheSeconds: LOOKUP_CACHE_SECONDS,
		timeoutSeconds: 5
	});

	// Be defensive — a provider changing its response shape shouldn't
	// produce a location made of undefined
	if (
		!data ||
		data.success === false ||
		typeof data.latitude !== "number" ||
		typeof data.longitude !== "number"
	) {
		return null;
	}

	return {
		latitude: data.latitude,
		longitude: data.longitude,
		label: [data.city, data.region].filter(Boolean).join(", "),
		source: "auto"
	};
}

// Turn a module's location settings into actual coordinates before the
// module ever sees them.
//
// A module declares a field of type "location" and receives
// { latitude, longitude, label } — or null. It never learns whether that
// came from OmniCore or from coordinates typed in by hand, which is the
// point: modules don't implement location logic, they just use it.
async function resolveLocations(moduleId, config) {
	const schema = readSchema(moduleId);

	for (const field of schema) {
		if (field.type !== "location") {
			continue;
		}

		const value = config[field.key] || {};

		if (value.mode === "manual") {
			config[field.key] =
				value.latitude === undefined || value.latitude === ""
					? null
					: {
							latitude: Number(value.latitude),
							longitude: Number(value.longitude),
							label: value.label || ""
					  };
			continue;
		}

		// Anything else means "use OmniCore's location"
		config[field.key] = await getLocation();
	}

	return config;
}

// Look up cities by name, so nobody has to go and find coordinates by
// hand. Same provider as the weather module, free and keyless.
//
// This works even with location services switched off — it's the user
// typing a place name, not OmniCore working out where it is.
async function searchCities(query) {
	if (!query || query.trim().length < 2) {
		return [];
	}

	const url =
		"https://geocoding-api.open-meteo.com/v1/search?count=6&name=" +
		encodeURIComponent(query.trim());

	const { data } = await fetchCached(url, {
		cacheSeconds: 24 * 60 * 60, // place coordinates don't move
		timeoutSeconds: 5
	});

	if (!data || !Array.isArray(data.results)) {
		return [];
	}

	return data.results.map((place) => ({
		// admin1 is the state or province — worth showing, since plenty of
		// city names repeat across a country
		label: [place.name, place.admin1, place.country]
			.filter(Boolean)
			.join(", "),
		latitude: place.latitude,
		longitude: place.longitude
	}));
}

module.exports = { getLocation, resolveLocations, searchCities };