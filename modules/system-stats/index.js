// modules/system-stats/index.js
// Reports how the machine running OmniCore is doing.
//
// A module is one function: it's handed its settings and returns data.
// It never renders anything and never touches routing — the theme decides
// how this looks, OmniCore decides where it lives.

const os = require("os");

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

module.exports = async function systemStats(config) {
	const usedMemory = os.totalmem() - os.freemem();
	const cpu = await cpuUsage();

	return {
		title: "System",
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
	};
};