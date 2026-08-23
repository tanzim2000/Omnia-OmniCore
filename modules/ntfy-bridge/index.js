// modules/ntfy-bridge/index.js
// Shows recent notifications from an ntfy topic.
// Read-only — it reads messages, it never sends them.
//
// Settings live in config.json next to this file, so the module is
// self-contained and can ship with sensible defaults.

const fs = require("fs");
const path = require("path");

// Read settings once at startup
const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Turn a timestamp into "3m", "2h", "4d" — short enough for a tile
function timeAgo(seconds) {
	const elapsed = Math.floor(Date.now() / 1000) - seconds;

	if (elapsed < 60) return "now";
	if (elapsed < 3600) return Math.floor(elapsed / 60) + "m";
	if (elapsed < 86400) return Math.floor(elapsed / 3600) + "h";
	return Math.floor(elapsed / 86400) + "d";
}

module.exports = function ntfyBridgeModule(app, options) {
	app.get("/api/ntfy-bridge", async (req, res) => {
		const url =
			config.server + "/" + config.topic +
			"/json?poll=1&since=" + config.since;

		try {
			const response = await fetch(url);
			const text = await response.text();

			// ntfy returns one JSON object per line, not a JSON array
			const messages = text
				.split("\n")
				.filter((line) => line.trim() !== "")
				.map((line) => JSON.parse(line))
				// ntfy also sends keepalive and open events — we only want
				// actual messages
				.filter((entry) => entry.event === "message")
				.reverse(); // newest first

			res.json({
				title: "Notifications",
				primary: String(messages.length),
				secondary: config.topic,
				details: messages.slice(0, config.limit).map((message) => ({
					label: timeAgo(message.time),
					value: message.title || message.message || ""
				})),
				updated: new Date().toISOString()
			});
		} catch (error) {
			res.json({
				title: "Notifications",
				primary: "—",
				secondary: "Not reachable",
				details: [
					{ label: "Server", value: config.server }
				],
				updated: new Date().toISOString()
			});
		}
	});
};