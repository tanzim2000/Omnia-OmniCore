// modules/system-stats/index.js
// Reports how the machine running OmniCore is doing.
// Backend only — it returns data in the standard display envelope and
// takes no view on how any of it should look. That's the theme's job.

const os = require("os");
const { readConfig } = require("../../core/module-config");

const MODULE_ID = "system-stats";

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

			const usage = 100 - (idleDiff / totalDiff) * 100;
			resolve(Math.round(usage));
		}, 200);
	});
}

module.exports = function systemStatsModule(app, options) {
	app.get("/api/system-stats", async (req, res) => {
		const config = readConfig(MODULE_ID);

		const usedMemory = os.totalmem() - os.freemem();
		const cpu = await cpuUsage();

		res.json({
			title: config.label || "System",
			primary: cpu + "%",
			secondary: "CPU",
			details: [
				{
					label: "Memory",
					value: formatBytes(usedMemory) + " / " + formatBytes(os.totalmem())
				},
				{ label: "Uptime", value: formatUptime(os.uptime()) },
				{ label: "Host", value: os.hostname() },
				{ label: "Cores", value: String(os.cpus().length) }
			],
			updated: new Date().toISOString()
		});
	});
};