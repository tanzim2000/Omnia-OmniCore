// modules/ntfy-bridge/index.js
// Shows recent notifications from an ntfy topic.
// Read-only — it reads messages, it never sends them.

const { fetchCached } = require("../../core/module-fetch");
const { share } = require("../../core/priority");

// Turn a timestamp into "3m", "2h", "4d" — short enough for a tile
function timeAgo(seconds) {
	const elapsed = Math.floor(Date.now() / 1000) - seconds;

	if (elapsed < 60) return "now";
	if (elapsed < 3600) return Math.floor(elapsed / 60) + "m";
	if (elapsed < 86400) return Math.floor(elapsed / 3600) + "h";
	return Math.floor(elapsed / 86400) + "d";
}

module.exports = async function ntfyBridge(config, richness) {
	if (!config.topic) {
		return {
			title: "Notifications",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "No topic set" }
			],
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
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "Not reachable" },
				{ type: "pair", label: "Server", value: config.server }
			],
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
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "Unreadable reply" },
				{ type: "pair", label: "Server", value: config.server }
			],
			updated: new Date().toISOString()
		};
	}

	// RICHNESS
	//
	// Every row is the same kind of thing — one message — so there is
	// nothing for a user to reorder. Richness decides how many fit. The
	// count leads at every size.
	const content = [
		{ type: "text", emphasis: "primary", value: String(messages.length) }
	];

	if (richness >= 25) {
		content.push({
			type: "text",
			emphasis: "secondary",
			value: config.topic + (stale ? " (last known)" : "")
		});
	}

	// The user's own limit is the ceiling; richness decides how much of it
	// this tile earns. minimum 0 so a tile with room only for the count
	// shows only the count.
	const room = share(
		Math.min(messages.length, Number(config.limit)),
		richness,
		{ minimum: 0 }
	);

	for (const message of messages.slice(0, room)) {
		content.push({
			type: "pair",
			label: timeAgo(message.time),
			value: message.title || message.message || ""
		});
	}

	return {
		title: "Notifications",
		content: content,
		updated: new Date().toISOString()
	};
};