// core/resource-scheduler.js
// Runs the "silently install compatible updates" half of auto-update on a
// timer. Everything it does was already possible by hand through
// marketplace.checkForUpdates() / applyAvailableUpdates() — this is only
// the part that means nobody has to remember to click it.

const marketplace = require("./marketplace");

// Checked once shortly after startup, then on this interval. Six hours is
// frequent enough that a new compatible version doesn't sit unapplied for
// long, without hammering the registry on every restart of a container
// that might restart often during normal use (a host reboot, a Docker
// update).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Startup runs immediately after every face is already up, not before —
// an update check should never be what a dashboard is waiting on to
// appear on screen.
const STARTUP_DELAY_MS = 30 * 1000;

async function runOnce() {
	let result;

	try {
		result = await marketplace.applyAvailableUpdates();
	} catch (error) {
		// A registry that's down or unreachable is not a reason to stop
		// trying again next interval — it's just this attempt that failed.
		console.log(`  Resource update check failed: ${error.message}`);
		return;
	}

	for (const item of result.applied) {
		console.log(`  Updated ${item.kind} "${item.id}" to ${item.ref}`);
	}

	for (const item of result.skipped) {
		console.log(
			`  Skipped update for ${item.kind} "${item.id}": ${item.reason}`
		);
	}

	if (result.applied.length === 0 && result.skipped.length === 0) {
		console.log("  Resource check: everything installed is current");
	}
}

// Called once from start.OmniCore. Fire-and-forget by design — nothing
// waiting on OmniCore to finish starting should ever block on this.
function start() {
	setTimeout(runOnce, STARTUP_DELAY_MS);
	setInterval(runOnce, CHECK_INTERVAL_MS);
}

module.exports = { start, runOnce, CHECK_INTERVAL_MS };