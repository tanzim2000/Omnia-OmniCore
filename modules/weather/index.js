// modules/weather/index.js
// Current conditions from Open-Meteo. No API key, no account.
//
// One function: settings in, data out. Because it's just a function, a face
// can use it several times over with different coordinates — one tile per
// city — with no special handling here.
//
// Requests go through OmniCore's shared fetch helper, so results are cached
// and calls time out. Each instance's coordinates produce a different URL,
// so instances cache separately without any effort on our part.
//
// RICHNESS
//
// This module has six pieces of information and shows as many of them as
// the tile has room for. Which ones go first is NOT decided here — it's a
// setting. The user drags "Info order" into whatever order they like, and
// whatever sits at the top survives even the smallest tile.
//
// That's why there are no hardcoded richness thresholds below. The shared
// helper spreads the 1-100 scale across however many items there are and
// hands back the ones to show, in the user's own order. With six items and
// the windows8 theme, that works out roughly as:
//
//   Small  (10)   1 item
//   Medium (35)   2 items
//   Wide   (65)   4 items
//   Large  (95)   all six
//
// A module still owns what its content means — this one just lets the
// person looking at the wall decide what they care about most.

const { fetchCached } = require("../../core/module-fetch");
const { visible } = require("../../core/priority");

// Open-Meteo reports conditions as WMO weather codes — numbers, not words.
// This turns them into something readable.
const WEATHER_CODES = {
	0: "Clear",
	1: "Mainly clear",
	2: "Partly cloudy",
	3: "Overcast",
	45: "Fog",
	48: "Freezing fog",
	51: "Light drizzle",
	53: "Drizzle",
	55: "Heavy drizzle",
	56: "Freezing drizzle",
	57: "Freezing drizzle",
	61: "Light rain",
	63: "Rain",
	65: "Heavy rain",
	66: "Freezing rain",
	67: "Freezing rain",
	71: "Light snow",
	73: "Snow",
	75: "Heavy snow",
	77: "Snow grains",
	80: "Light showers",
	81: "Showers",
	82: "Heavy showers",
	85: "Snow showers",
	86: "Snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm, hail",
	99: "Thunderstorm, hail"
};

function describe(code) {
	return WEATHER_CODES[code] || "Unknown";
}

// Every failure returns a real envelope rather than throwing. A tile that
// says why it's empty is more useful than one that vanishes.
function problem(reason) {
	return {
		title: "Weather",
		content: [
			{ type: "text", emphasis: "primary", value: "—" },
			{ type: "text", emphasis: "secondary", value: reason }
		],
		updated: new Date().toISOString()
	};
}

module.exports = async function weather(config, richness) {
	const fahrenheit = config.units === "Fahrenheit";
	const degrees = fahrenheit ? "°F" : "°C";

	// OmniCore resolves the location setting before we see it. Null means
	// there's no location to work with — either location services are off,
	// or detection failed and nothing was set by hand.
	if (!config.location) {
		return problem("No location");
	}

	const url =
		"https://api.open-meteo.com/v1/forecast" +
		"?latitude=" + encodeURIComponent(config.location.latitude) +
		"&longitude=" + encodeURIComponent(config.location.longitude) +
		"&current=temperature_2m,apparent_temperature,relative_humidity_2m," +
		"weather_code,wind_speed_10m" +
		"&daily=temperature_2m_max,temperature_2m_min" +
		"&forecast_days=1&timezone=auto" +
		(fahrenheit ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "");

	const { data, stale } = await fetchCached(url, {
		cacheSeconds: Number(config.refreshMinutes) * 60
	});

	if (!data || !data.current) {
		return problem("Not reachable");
	}

	const now = data.current;
	const today = data.daily;

	// Everything this module can say: a name and a value for each, keyed
	// by the names used in the setting.
	//
	// Note there is no notion here of a value that "reads fine without its
	// label". That is a judgement about how something LOOKS, and it
	// belongs to whichever theme is drawing the tile — not to this file.
	// A module's job is to hand over the name and the value as separate
	// things and let the theme decide what to do with them.
	const pieces = {
		"Temperature": Math.round(now.temperature_2m) + degrees,
		"Condition": describe(now.weather_code),
		"Feels like": Math.round(now.apparent_temperature) + degrees,
		"High / low":
			Math.round(today.temperature_2m_max[0]) + degrees + " / " +
			Math.round(today.temperature_2m_min[0]) + degrees,
		"Humidity": now.relative_humidity_2m + "%",
		"Wind": Math.round(now.wind_speed_10m) + (fahrenheit ? " mph" : " km/h")
	};

	// Which pieces to show, in the order the user put them in
	const showing = visible(config.fieldOrder, richness);

	const content = showing
		.map((name, position) => {
			const value = pieces[name];

			// A piece named in the setting but missing here would mean the
			// setting and this file have drifted apart. Skip, don't crash.
			if (value === undefined) {
				return null;
			}

			// Always both halves, always separate. A theme is then free to
			// show the name, hide it, or put it somewhere else entirely —
			// none of which is this module's business.
			const block = { type: "pair", label: name, value: value };

			// Position in the user's order IS importance, so the first
			// piece is flagged as the one worth reading from across a
			// room. What "primary" looks like — bigger, bolder, no label
			// at all — is the theme's decision, not ours.
			if (position === 0) {
				block.emphasis = "primary";
			}

			return block;
		})
		.filter(Boolean);

	// Say so when this is an older reading rather than quietly presenting
	// it as current. This isn't one of the pieces above — it's a caveat
	// about the data, not something the user chose to see, so it sits
	// outside the ordering and doesn't take a slot from it.
	//
	// It goes out as a pair like everything else. A single text block here
	// would make this module stop being pair-only, and a theme that lays
	// pairs out its own way would fall back to a different layout the
	// moment the network hiccuped — the tile would visibly change shape
	// for a reason that has nothing to do with what it's showing.
	if (stale) {
		content.push({
			type: "pair",
			label: "Reading",
			value: "last known"
		});
	}

	return {
		title: "Weather",
		content: content,
		updated: new Date().toISOString()
	};
};