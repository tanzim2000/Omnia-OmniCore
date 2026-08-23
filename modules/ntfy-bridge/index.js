// modules/ntfy-bridge/index.js
// Shows recent notifications from an ntfy topic.
// Read-only — it reads messages, it never sends them.

const { fetchCached } = require("../../core/module-fetch");

// Turn a timestamp into "3m", "2h", "4d" — short enough for a tile
function timeAgo(seconds) {
	const elapsed = Math.floor(Date.now() / 1000) - seconds;

	if (elapsed < 60) return "now";
	if (elapsed < 3600) return Math.floor(elapsed / 60) + "m";
	if (elapsed < 86400) return Math.floor(elapsed / 3600) + "h";
	return Math.floor(elapsed / 86400) + "d";
}

module.exports = async function ntfyBridge(config) {
	if (!config.topic) {
		return {
			title: "Notifications",
			primary: "—",
			secondary: "No topic set",
			details: [{ label: "Set a topic", value: "in Settings" }],
			updated: new Date().toISOString()
		};
	}

	const url =
		config.server + "/" + config.topic + "/json?poll=1&since=" + config.since;

	// ntfy streams one JSON object per line, so read it as text
	const { data, stale } = await fetchCached(url, {
		as: "text",
		cacheSeconds: Number(config.refreshMinutes) * 60
	});

	if (data === null) {
		return {
			title: "Notifications",
			primary: "—",
			secondary: "Not reachable",
			details: [{ label: "Server", value: config.server }],
			updated: new Date().toISOString()
		};
	}

	let messages;

	try {
		messages = data
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => JSON.parse(line))
			// ntfy also sends keepalive and open events — we only want
			// actual messages
			.filter((entry) => entry.event === "message")
			.reverse(); // newest first
	} catch (error) {
		return {
			title: "Notifications",
			primary: "—",
			secondary: "Unreadable reply",
			details: [{ label: "Server", value: config.server }],
			updated: new Date().toISOString()
		};
	}

	return {
		title: "Notifications",
		primary: String(messages.length),
		secondary: config.topic + (stale ? " (last known)" : ""),
		details: messages.slice(0, config.limit).map((message) => ({
			label: timeAgo(message.time),
			value: message.title || message.message || ""
		})),
		updated: new Date().toISOString()
	};
};