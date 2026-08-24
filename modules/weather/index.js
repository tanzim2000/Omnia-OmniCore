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

const { fetchCached } = require("../../core/module-fetch");

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

module.exports = async function weather(config) {
	const fahrenheit = config.units === "Fahrenheit";
	const degrees = fahrenheit ? "°F" : "°C";

	// OmniCore resolves the location setting before we see it. Null means
	// there's no location to work with — either location services are off,
	// or detection failed and nothing was set by hand.
	if (!config.location) {
		return {
			title: "Weather",
			primary: "—",
			secondary: "No location",
			details: [{ label: "Set a location", value: "in Settings" }],
			updated: new Date().toISOString()
		};
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
		return {
			title: "Weather",
			primary: "—",
			secondary: "Not reachable",
			details: [{ label: "Source", value: "Open-Meteo" }],
			updated: new Date().toISOString()
		};
	}

	const now = data.current;
	const today = data.daily;

	return {
		title: "Weather",
		primary: Math.round(now.temperature_2m) + degrees,
		// Say so when we're showing an older reading, rather than quietly
		// presenting it as current
		secondary: describe(now.weather_code) + (stale ? " (last known)" : ""),
		details: [
			{
				label: "Feels like",
				value: Math.round(now.apparent_temperature) + degrees
			},
			{
				label: "High / low",
				value:
					Math.round(today.temperature_2m_max[0]) + degrees + " / " +
					Math.round(today.temperature_2m_min[0]) + degrees
			},
			{ label: "Humidity", value: now.relative_humidity_2m + "%" },
			{
				label: "Wind",
				value: Math.round(now.wind_speed_10m) + (fahrenheit ? " mph" : " km/h")
			}
		],
		updated: new Date().toISOString()
	};
};