// core/update-store.js
// When OmniCore last looked for an update, and what it found.
//
// Small and separate from settings-store.js on purpose: settings are
// choices a person made, this is a record of something that happened.
// Mixing the two would mean a "reset settings" someday also wiping
// history that isn't a setting at all.
//
// Deliberately not a record of every check ever run -- only the most
// recent. A log of "found nothing" every six hours forever is a file
// that grows without anyone ever reading it.

const semver = require("semver");

const fs = require("fs");
const path = require("path");
const paths = require("./paths");

function storePath() {
	return path.join(paths.dataDir(), "update-checks.json");
}

function read() {
	if (!fs.existsSync(storePath())) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(storePath(), "utf-8"));
	} catch (error) {
		// A corrupt record just means "never checked" -- which is
		// wrong but harmless, and self-corrects on the next check.
		return {};
	}
}

function write(data) {
	fs.mkdirSync(path.dirname(storePath()), { recursive: true });
	fs.writeFileSync(storePath(), JSON.stringify(data, null, "\t"));
	return data;
}

// Called after every check, scheduled or manual, whether or not
// anything was found. "We looked and there was nothing" is exactly as
// worth recording as "we found something" -- without it, a page can't
// tell the difference between up to date and never checked.
function recordCheck({ latestVersion, updateAvailable, error }) {
	const existing = read();

	return write({
		...existing,
		lastCheckedAt: new Date().toISOString(),
		lastCheckSucceeded: !error,
		lastCheckError: error || null,
		latestVersion: latestVersion || null,
		updateAvailable: Boolean(updateAvailable)
	});
}

// What the last check concluded, without going near the network. The
// About face's indicator dot reads this rather than triggering its own
// check -- rendering a page should never cost an HTTP call to GitHub.
// What the last check concluded, without going near the network. The
// About face's indicator dot reads this rather than triggering its own
// check — rendering a page should never cost an HTTP call to GitHub.
//
// `updateAvailable` is recomputed fresh here against whatever's
// actually running right now, rather than trusting the flag stored at
// check time. This file lives in the same volume a self-update swap
// carries forward, so a record written just before a successful swap
// would otherwise keep saying "an update is available" even after this
// container has already become that update — comparing against a
// memory of a version that no longer exists.
function lastResult(runningVersion) {
	const data = read();
	const latestVersion = data.latestVersion || null;
	const running = runningVersion
		? semver.valid(semver.coerce(runningVersion))
		: null;

	const updateAvailable = Boolean(
		latestVersion && running && semver.gt(latestVersion, running)
	);

	return {
		lastCheckedAt: data.lastCheckedAt || null,
		lastCheckSucceeded: data.lastCheckSucceeded !== false,
		lastCheckError: data.lastCheckError || null,
		latestVersion,
		updateAvailable
	};
}

// ---------------------------------------------------------------------
// Modules and themes
//
// The same idea for the other kind of update: what the last check of
// installed modules and themes did. Kept in the same file under its own
// key -- recordCheck above spreads whatever is already there, so neither
// record ever wipes the other.
//
//   checkedAt  when it ran
//   error      why it couldn't run at all (the registry unreachable), or null
//   applied    [{ kind, id, ref }] -- installed by this check
//   skipped    [{ kind, id, ref, reason }] -- found but not installed, and
//              why: usually "needs a newer OmniCore". `ref` is the commit it
//              wanted, so a page can tell whether that's since been installed
//              some other way.
function recordResourceCheck({ applied, skipped, error }) {
	const existing = read();

	return write({
		...existing,
		resources: {
			checkedAt: new Date().toISOString(),
			error: error || null,
			applied: Array.isArray(applied) ? applied : [],
			skipped: Array.isArray(skipped) ? skipped : []
		}
	});
}

// The last modules-and-themes check, or null if none has run yet. Read
// from disk only -- showing it never costs a trip to the registry.
function lastResourceCheck() {
	return read().resources || null;
}

module.exports = { recordCheck, lastResult, recordResourceCheck, lastResourceCheck };