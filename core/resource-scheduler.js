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

const BAR_WIDTH = 24;

function bar(fraction) {
	const filled = Math.round(BAR_WIDTH * fraction);
	return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

// Clears whatever's on the current line without leaving a leftover
// fragment behind if the new text is shorter than the old.
function clearLine() {
	process.stdout.write("\r" + " ".repeat(70) + "\r");
}

// Only ever drawn on a real terminal. Piped output (a log file, `docker
// logs`) doesn't overwrite a line on \r -- it just prints every one of
// them as its own character, which would fill logs with garbage rather
// than showing a bar. Falls back to a single plain line instead.
function isInteractive() {
	return Boolean(process.stdout.isTTY);
}

// A real countdown -- the 30 seconds is an exact, known quantity, so
// animating it is just showing the truth, not decorating it.
//
// Deliberately does NOT paint its first frame synchronously. Every face
// this is started after (control, wizard, about, admin) calls
// app.listen(), whose own "listening" callback is asynchronous --
// scheduled for a later tick, not printed immediately even though
// starting each face finishes synchronously right away. Painting the
// first frame the instant this function is called could race ahead of
// those still-pending callbacks and print before them, which is exactly
// the collision this whole feature was built to avoid. Waiting for the
// first real tick, the same one second every later frame waits for,
// gives them however long they need to actually finish, regardless of
// how fast or slow the machine is -- a fixed small delay would only
// ever be a guess at that.
function countdown(totalMs, onDone) {
	if (!isInteractive()) {
		console.log("  Checking for resource updates shortly...");
		setTimeout(onDone, totalMs);
		return;
	}

	const totalSeconds = Math.round(totalMs / 1000);
	let remaining = totalSeconds;

	const draw = () => {
		const fraction = 1 - remaining / totalSeconds;
		process.stdout.write(
			`\r  Checking for resource updates [${bar(fraction)}]`
		);
	};

	const tick = setInterval(() => {
		remaining -= 1;

		if (remaining <= 0) {
			clearInterval(tick);
			clearLine();
			onDone();
			return;
		}

		draw();
	}, 1000);
}

// A spinner rather than a bar during the registry fetch: its duration is
// genuinely unknown, so a percentage here would be invented, not
// measured. A spinner only ever claims "this is happening," which is
// the honest amount to claim.
function startSpinner(label) {
	if (!isInteractive()) {
		console.log(`  ${label}`);
		return () => {};
	}

	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let i = 0;

	const tick = setInterval(() => {
		process.stdout.write(`\r  ${frames[i % frames.length]} ${label}`);
		i += 1;
	}, 80);

	return () => {
		clearInterval(tick);
		clearLine();
	};
}

// A real bar, since this loop has real countable steps -- shown only
// when there's more than one, since a bar over a single item says
// nothing a plain line doesn't already say.
function progressReporter() {
	if (!isInteractive()) {
		return null;
	}

	return (index, total, label) => {
		if (total <= 1) {
			return;
		}

		process.stdout.write(
			`\r  Updating ${index}/${total} [${bar(index / total)}] ${label}`
		);
	};
}

async function runOnce({ interactive } = {}) {
	const stopSpinner = interactive
		? startSpinner("Fetching the registry...")
		: null;

	let result;

	try {
		result = await marketplace.applyAvailableUpdates(
			interactive ? progressReporter() : undefined
		);
	} catch (error) {
		if (stopSpinner) stopSpinner();
		// A registry that's down or unreachable is not a reason to stop
		// trying again next interval — it's just this attempt that failed.
		console.log(`  Resource update check failed: ${error.message}`);
		return;
	}

	if (stopSpinner) stopSpinner();

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
//
// Only the very first, startup run gets the live countdown and spinner —
// someone is plausibly watching a terminal right after `npm start`, but
// nobody is realistically watching six hours later, and printing a
// slowly-ticking bar into a long-running background log would just be
// noise at that point.
function start() {
	countdown(STARTUP_DELAY_MS, () => runOnce({ interactive: true }));
	setInterval(() => runOnce({ interactive: false }), CHECK_INTERVAL_MS);
}

module.exports = { start, runOnce, CHECK_INTERVAL_MS };