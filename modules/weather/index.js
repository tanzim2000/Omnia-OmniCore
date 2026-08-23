// modules/weather/index.js
// Current conditions from Open-Meteo.
// Read-only. Open-Meteo needs no API key and no account, which is why it's
// a good fit for something people self-host.

const { readConfig } = require("../../core/module-config");

const MODULE_ID = "weather";

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

module.exports = function weatherModule(app, options) {
	app.get("/api/weather", async (req, res) => {
		const config = readConfig(MODULE_ID);

		const fahrenheit = config.units === "Fahrenheit";
		const degrees = fahrenheit ? "°F" : "°C";

		const url =
			"https://api.open-meteo.com/v1/forecast" +
			"?latitude=" + encodeURIComponent(config.latitude) +
			"&longitude=" + encodeURIComponent(config.longitude) +
			"&current=temperature_2m,apparent_temperature,relative_humidity_2m," +
			"weather_code,wind_speed_10m" +
			"&daily=temperature_2m_max,temperature_2m_min" +
			"&forecast_days=1&timezone=auto" +
			(fahrenheit
				? "&temperature_unit=fahrenheit&wind_speed_unit=mph"
				: "");

		try {
			const response = await fetch(url);
			const data = await response.json();

			const now = data.current;
			const today = data.daily;

			res.json({
				title: config.label || "Weather",
				primary: Math.round(now.temperature_2m) + degrees,
				secondary: describe(now.weather_code),
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
						value:
							Math.round(now.wind_speed_10m) +
							(fahrenheit ? " mph" : " km/h")
					}
				],
				updated: new Date().toISOString()
			});
		} catch (error) {
			res.json({
				title: config.label || "Weather",
				primary: "—",
				secondary: "Not reachable",
				details: [{ label: "Source", value: "Open-Meteo" }],
				updated: new Date().toISOString()
			});
		}
	});
};