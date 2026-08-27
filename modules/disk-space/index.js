// modules/disk-space/index.js
// Reports free space on a filesystem. Entirely local — no network.
//
// Uses fs.statfs, which asks the operating system directly. That's more
// reliable than shelling out to `df` and parsing its text output, since
// df's formatting differs between systems.
//
// RICHNESS
//
// Like the weather module, this one has a handful of distinct facts rather
// than a list of rows, so which of them matter is a setting rather than a
// decision made here. Whatever the user puts at the top of "Info order"
// survives the smallest tile; the rest appear as the tile grows.

const fs = require("fs");
const { visible } = require("../../core/priority");

function formatBytes(bytes) {
	const gb = bytes / 1024 / 1024 / 1024;

	if (gb >= 1024) {
		return (gb / 1024).toFixed(1) + " TB";
	}

	return gb.toFixed(1) + " GB";
}

module.exports = async function diskSpace(config, richness) {
	try {
		const stats = await fs.promises.statfs(config.path);

		// Sizes come back as counts of blocks, so multiply by block size
		const total = stats.blocks * stats.bsize;
		const free = stats.bfree * stats.bsize;

		// bavail is what a normal user can actually use — some space is
		// reserved for root, so it's usually a bit less than bfree
		const available = stats.bavail * stats.bsize;
		const used = total - free;

			// Everything this module can say: a name and a value for each.
		//
			// Note there is no notion here of a value that "reads fine without its
			// label". That is a judgement about how something LOOKS, and it
			// belongs to whichever theme is drawing the tile — not to this file.
			// A module hands over the name and the value as separate things and
			// lets the theme decide what to do with them.
		const pieces = {
			"Percent used":
				(total === 0 ? 0 : Math.round((used / total) * 100)) + "%",
			"Free": formatBytes(available),
			"Used": formatBytes(used),
			"Total": formatBytes(total),
			"Path": config.path
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
			title: "Disk",
			content: content,
			updated: new Date().toISOString()
		};
	} catch (error) {
		// Usually a path that doesn't exist, or one OmniCore can't read
		return {
			title: "Disk",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "Can't read" },
				{ type: "pair", label: "Path", value: config.path }
			],
			updated: new Date().toISOString()
		};
	}
};