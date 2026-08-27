// modules/system-stats/index.js
// Reports how the machine running OmniCore is doing.
//
// A module is one function: it's handed its settings and returns data.
// It never renders anything and never touches routing — the theme decides
// how this looks, OmniCore decides where it lives.
//
// RICHNESS
//
// Five distinct facts rather than a list of rows, so which of them matter
// is a setting rather than a decision made here. Whatever the user puts at
// the top of "Info order" survives the smallest tile; the rest appear as
// the tile grows.

const os = require("os");
const { visible } = require("../../core/priority");

// Turn raw bytes into something readable, e.g. "3.1 GB"
function formatBytes(bytes) {
	const gb = bytes / 1024 / 1024 / 1024;
	return gb.toFixed(1) + " GB";
}

// Turn seconds into "4d 2h" / "2h 15m" / "45m"
function formatUptime(seconds) {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

// os.cpus() gives cumulative tick counts since boot, not a live
// percentage — so we take one snapshot, wait briefly, take another, and
// compare the difference to work out how busy the CPU was in between.
function cpuSnapshot() {
	let idle = 0;
	let total = 0;

	for (const cpu of os.cpus()) {
		for (const type of Object.keys(cpu.times)) {
			total += cpu.times[type];
		}
		idle += cpu.times.idle;
	}

	return { idle, total };
}

function cpuUsage() {
	return new Promise((resolve) => {
		const start = cpuSnapshot();

		setTimeout(() => {
			const end = cpuSnapshot();

			const idleDiff = end.idle - start.idle;
			const totalDiff = end.total - start.total;

			// No measurable time passed — report 0 rather than dividing by zero
			if (totalDiff === 0) {
				resolve(0);
				return;
			}

			resolve(Math.round(100 - (idleDiff / totalDiff) * 100));
		}, 200);
	});
}

module.exports = async function systemStats(config, richness) {
	const usedMemory = os.totalmem() - os.freemem();
	const cpu = await cpuUsage();

	// Everything this module can say: a name and a value for each.
	//
	// Note there is no notion here of a value that "reads fine without its
	// label". That is a judgement about how something LOOKS, and it
	// belongs to whichever theme is drawing the tile — not to this file.
	// A module hands over the name and the value as separate things and
	// lets the theme decide what to do with them.
	const pieces = {
		"CPU": cpu + "%",
		"Memory": formatBytes(usedMemory) + " / " + formatBytes(os.totalmem()),
		"Uptime": formatUptime(os.uptime()),
		"Host": os.hostname(),
		"Cores": String(os.cpus().length)
	};

	const showing = visible(config.fieldOrder, richness);

		const content = showing
		.map((name, position) => {
			const value = pieces[name];

			// Named in the setting but unknown here means the setting
			// and this file have drifted. Skip rather than crash.
			if (value === undefined) {
				return null;
			}

			// Always both halves, always separate. A theme is then free
			// to show the name, hide it, or place it elsewhere — none
			// of which is this module's business.
			const block = { type: "pair", label: name, value: value };

			// Position in the user's order IS importance, so the first
			// piece is flagged as the one worth reading from across a
			// room. What "primary" looks like is the theme's decision.
			if (position === 0) {
				block.emphasis = "primary";
			}

			return block;
		})
		.filter(Boolean);

	return {
		title: "System",
		content: content,
		updated: new Date().toISOString()
	};
};