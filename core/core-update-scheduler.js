// core/core-update-scheduler.js
// Runs OmniCore's own update check on a timer, and applies it when
// possible. Deliberately separate from resource-scheduler.js (which does
// the same job for modules and themes) — these two update completely
// different things through completely different mechanisms, and mixing
// them into one file would make it harder to reason about which failure
// belongs to which.

const coreUpdater = require("./core-updater");
const omnicoreVersion = require("./version");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // same cadence as resource-scheduler
const STARTUP_DELAY_MS = 45 * 1000; // after resource-scheduler's own delay

async function runOnce() {
	// A dev build (docker-compose.dev.yml, or a bare local clone) has no
	// real release to compare against, and self-recreating a container
	// someone is actively editing would be actively harmful rather than
	// merely useless.
	if (omnicoreVersion.isDevBuild()) {
		return;
	}

	let status;
	try {
		status = await coreUpdater.checkForUpdate();
	} catch (error) {
		console.log(`  Core update check failed: ${error.message}`);
		return;
	}

	if (!status || !status.updateAvailable) {
		console.log(
			`  Core check: running ${status ? status.currentVersion : "?"} — current`
		);
		return;
	}

	console.log(
		`  Core update available: ${status.currentVersion} → ${status.latestVersion}`
	);

	try {
		const result = await coreUpdater.applyUpdate();

		if (!result.updated) {
			console.log(`  Core update: ${result.reason}`);
			return;
		}

		// Realistically, nothing after applyUpdate() resolving is likely to
		// run — the helper container it launched is usually already
		// stopping this process by the time control gets back here. This
		// log line is best-effort, not load-bearing.
		console.log(
			`  Core update applied: ${result.from} → ${result.to}. ` +
				`Roll back with: ${result.rollback}`
		);
	} catch (error) {
		// No socket mounted, or a Docker API error — either way, this is
		// exactly the case docker-compose.yml documents: OmniCore keeps
		// running on the version it has, and says so plainly instead of
		// applying anything.
		console.log(
			`  Core update available but couldn't be applied automatically: ` +
				`${error.message}`
		);
		console.log(
			`  Update by hand with: docker compose pull && docker compose up -d`
		);
	}
}

function start() {
	setTimeout(runOnce, STARTUP_DELAY_MS);
	setInterval(runOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, runOnce, CHECK_INTERVAL_MS };