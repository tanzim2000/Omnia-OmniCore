// core/upgrades.js
// Bringing the data up to date with the version that's running (since
// 1.20.0).
//
// THE IDEA
//
// OmniCore's data (settings, faces, module memory) is written by one
// version and may be read by a newer one. Usually nothing changes. When a
// version does change how something is stored, it brings a STEP: a small
// function that converts the data from the old way to the new one. Steps
// run here, when OmniCore starts, before anything reads the data:
//
//   1. data/data-version.json says which version last brought the data up
//      to date ("1.20.0", say).
//   2. Every step for a version after that one, and no later than the one
//      running now, runs in order, oldest first.
//   3. After each step the file is moved on to that step's version, so a
//      step that fails is the one tried again next time, never one that
//      already worked.
//   4. Finally the file says the running version.
//
// The NEW version does this, never the old one: only the new version
// knows the new way. A major upgrade backs the data up before it switches
// (core-updater.js), and if the new version doesn't come up healthy, the
// old one comes back with that backup, not with half-converted data.
//
// THE SAFETY NET
//
// Data last brought up to date by a newer major version than the one
// running (2.x data, 1.x running) is refused: start() throws
// DataFromNewerVersion, and OmniCore doesn't start. That only happens when
// somebody forces an old image onto new data; carrying on could damage it.
//
// ADDING A STEP
//
// Add it to STEPS below: the version that brings it, what it does in one
// line, and run(dataDir). A step must be safe to run twice (it may be
// stopped halfway, by a power cut say, and run again on the next start),
// and it only ever touches files under dataDir.

const fs = require("fs");
const path = require("path");
const semver = require("semver");

const paths = require("./paths");
const omnicoreVersion = require("./version");

// No version has changed how anything is stored yet. 2.0.0 didn't either:
// its settings are only new ones, and readSettings fills those in from
// their defaults for a file written by 1.x.
const STEPS = [];

// What a development build calls itself here: the version its source says
// (package.json), since it has no release tag
function runningVersion() {
	const comparable = omnicoreVersion.comparableVersion();
	if (comparable) return comparable;
	return semver.valid(semver.coerce(require("../package.json").version)) || "0.0.0";
}

function versionFile(dataDir) {
	return path.join(dataDir, "data-version.json");
}

// Which version last brought the data up to date.
//
// No file: either a fresh install (nothing to convert, so it's as new as
// the running version) or data from before 1.20.0, which never wrote one.
// Any of OmniCore's own files there means the latter, and 1.0.0 is the
// honest answer: every step since then still has to run.
function storedVersion(dataDir, running) {
	try {
		const saved = JSON.parse(fs.readFileSync(versionFile(dataDir), "utf-8"));
		const version = semver.valid(semver.coerce(saved && saved.version));
		if (version) return version;
	} catch (error) {
		// No file, or not one we can read: decided below
	}

	const ours = ["settings.json", "faces.json", "admin.json"];
	const lived = ours.some((name) => fs.existsSync(path.join(dataDir, name)));
	return lived ? "1.0.0" : running;
}

function saveVersion(dataDir, version) {
	fs.mkdirSync(dataDir, { recursive: true });
	const file = versionFile(dataDir);
	// Written beside and then moved into place, so a power cut never
	// leaves half a file
	fs.writeFileSync(file + ".new", JSON.stringify({ version, at: new Date().toISOString() }, null, "\t"));
	fs.renameSync(file + ".new", file);
}

class DataFromNewerVersion extends Error {
	constructor(dataVersion, running) {
		super(
			`This data was last used by OmniCore ${dataVersion}, and this is ${running}. ` +
				`An older OmniCore can't safely use data a newer major version has changed. ` +
				`Use OmniCore ${semver.major(dataVersion)}.x, or restore a backup from data/backups.`
		);
		this.name = "DataFromNewerVersion";
		this.dataVersion = dataVersion;
		this.running = running;
	}
}

// Bring the data up to date. Returns what ran: { from, to, ran: [versions] }.
// `steps` and `dataDir` are for the tests; OmniCore itself passes neither.
function start(options) {
	const given = options || {};
	const dataDir = given.dataDir || paths.dataDir();
	const steps = given.steps || STEPS;
	const running = given.running || runningVersion();
	const from = storedVersion(dataDir, running);

	if (semver.major(from) > semver.major(running)) {
		throw new DataFromNewerVersion(from, running);
	}

	const due = steps
		.filter((step) => semver.gt(step.version, from) && semver.lte(step.version, running))
		.sort((a, b) => semver.compare(a.version, b.version));

	const ran = [];
	for (const step of due) {
		console.log(`Bringing the data up to ${step.version}: ${step.about}`);
		step.run(dataDir);
		saveVersion(dataDir, step.version);
		ran.push(step.version);
	}

	// Never moved backwards: a newer 1.x's data read by an older 1.x keeps
	// saying the newer one, so its steps aren't run twice later
	if (semver.gt(running, from)) saveVersion(dataDir, running);
	else if (!fs.existsSync(versionFile(dataDir))) saveVersion(dataDir, from);

	return { from, to: semver.gt(running, from) ? running : from, ran };
}

module.exports = { start, storedVersion, DataFromNewerVersion, STEPS };
