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

const fs = require("fs");
const path = require("path");

const storePath = path.join(__dirname, "..", "data", "update-checks.json");

function read() {
	if (!fs.existsSync(storePath)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(storePath, "utf-8"));
	} catch (error) {
		// A corrupt record just means "never checked" -- which is
		// wrong but harmless, and self-corrects on the next check.
		return {};
	}
}

function write(data) {
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	fs.writeFileSync(storePath, JSON.stringify(data, null, "\t"));
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
function lastResult() {
	const data = read();

	return {
		lastCheckedAt: data.lastCheckedAt || null,
		lastCheckSucceeded: data.lastCheckSucceeded !== false,
		lastCheckError: data.lastCheckError || null,
		latestVersion: data.latestVersion || null,
		updateAvailable: Boolean(data.updateAvailable)
	};
}

module.exports = { recordCheck, lastResult };