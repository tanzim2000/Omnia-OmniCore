// modules/disk-space/index.js
// Reports free space on a filesystem.
// Read-only, and entirely local — no network, no external service.
//
// Uses fs.statfs, which asks the operating system directly. That's more
// reliable than shelling out to `df` and parsing its text output, since
// df's formatting differs between systems.

const fs = require("fs");
const { readConfig } = require("../../core/module-config");

const MODULE_ID = "disk-space";

function formatBytes(bytes) {
	const gb = bytes / 1024 / 1024 / 1024;

	if (gb >= 1024) {
		return (gb / 1024).toFixed(1) + " TB";
	}

	return gb.toFixed(1) + " GB";
}

module.exports = function diskSpaceModule(app, options) {
	app.get("/api/disk-space", async (req, res) => {
		const config = readConfig(MODULE_ID);

		try {
			const stats = await fs.promises.statfs(config.path);

			// Sizes come back as counts of blocks, so multiply by block size
			const total = stats.blocks * stats.bsize;
			const free = stats.bfree * stats.bsize;

			// bavail is what a normal user can actually use — some space is
			// reserved for root, so it's usually a bit less than bfree
			const available = stats.bavail * stats.bsize;
			const used = total - free;

			const percentUsed = total === 0 ? 0 : Math.round((used / total) * 100);

			res.json({
				title: "Disk",
				primary: percentUsed + "%",
				secondary: "used",
				details: [
					{ label: "Free", value: formatBytes(available) },
					{ label: "Used", value: formatBytes(used) },
					{ label: "Total", value: formatBytes(total) },
					{ label: "Path", value: config.path }
				],
				updated: new Date().toISOString()
			});
		} catch (error) {
			res.json({
				title: "Disk",
				primary: "—",
				secondary: "Can't read",
				details: [{ label: "Path", value: config.path }],
				updated: new Date().toISOString()
			});
		}
	});
};