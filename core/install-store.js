// core/install-store.js
// A record of what OmniCore actually installed, and from where — kept
// separately from modules/ and themes/ themselves, which are just code on
// disk with no memory of their own origin.
//
// Why this has to exist: listAvailable() (in marketplace.js) has always
// decided "is this installed?" purely by whether the folder exists. That
// answers "do I have SOMETHING here" but not "is it still the same commit
// the registry currently points at" — and without that second answer,
// there is no way to ever say "an update is available". This file is what
// makes that question answerable.

const fs = require("fs");
const path = require("path");
const paths = require("./paths");

function storePath() {
	return path.join(paths.dataDir(), "installed.json");
}

// { "module:weather": { kind, id, ref, minOmniCore, installedAt, updatedAt } }
// Keyed by "kind:id" so a module and a theme can never collide even if
// they happened to share an id.
function readAll() {
	if (!fs.existsSync(storePath())) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(storePath(), "utf-8"));
	} catch (error) {
		// A corrupt record shouldn't stop OmniCore starting — worst case,
		// every install briefly looks unrecorded again until reinstalled
		// or the next successful write.
		return {};
	}
}

function writeAll(all) {
	fs.mkdirSync(path.dirname(storePath()), { recursive: true });
	fs.writeFileSync(storePath(), JSON.stringify(all, null, "\t"));
}

function key(kind, id) {
	return `${kind}:${id}`;
}

// What OmniCore recorded about one installed item, or null if it was never
// recorded — true for anything installed before this file existed, and
// for anything a person dropped into modules/ or themes/ by hand rather
// than through the Marketplace. Both are legitimate; neither has a record
// to compare against, so update-checking simply has nothing to say about
// them until they're reinstalled once through the Marketplace.
function get(kind, id) {
	return readAll()[key(kind, id)] || null;
}

// Every recorded install, as a flat list — what the update checker walks
// to ask "does the registry's ref for this still match what I have?"
function listAll() {
	return Object.values(readAll());
}

// Called once an install or update actually succeeds — never before, so a
// failed download can't leave behind a record of something that isn't
// really there.
function record(kind, id, { ref, minOmniCore }) {
	const all = readAll();
	const existing = all[key(kind, id)];
	const now = new Date().toISOString();

	all[key(kind, id)] = {
		kind,
		id,
		ref,
		minOmniCore: minOmniCore || null,
		installedAt: existing ? existing.installedAt : now,
		updatedAt: now
	};

	writeAll(all);
	return all[key(kind, id)];
}

// Called when something is removed, so a stale record can't outlive the
// folder it described and later be mistaken for something still installed.
function forget(kind, id) {
	const all = readAll();
	delete all[key(kind, id)];
	writeAll(all);
}

module.exports = { get, record, forget, listAll };