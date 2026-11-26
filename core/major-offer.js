// core/major-offer.js
// What's offered when a new major version is out: its own document, then
// a closing part of OmniCore's own saying what happens to the data and to
// docker-compose.yml. Read all the way down before Upgrade can be pressed.
//
// Shown in two places: the settings home's pop-up (admin-face.js,
// GET /updates/major) and Getting Started's Updates step
// (getting-started-page.js). One copy here, so both say the same.

const updateStore = require("./update-store");
const upgradeNotes = require("./upgrade-notes");
const coreUpdater = require("./core-updater");
const omnicoreVersion = require("./version");

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

// The major version the last check found, or null
function nextMajor() {
	const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
	return updateStore.lastResult(running).nextMajor || null;
}

// { status, body }: 404 with { error } when there's none on offer,
// otherwise 200 with { version, html, offReason }. offReason is why
// Upgrade can't be pressed at all (no Docker, a development build, nothing
// to read), or null.
async function build() {
	const next = nextMajor();

	if (!next) {
		return { status: 404, body: { error: "There's no new major version to upgrade to." } };
	}

	const [notes, readiness] = await Promise.all([upgradeNotes.fetchUpgradeNotes(next), coreUpdater.applyReadiness()]);
	const compose = readiness.ready ? await coreUpdater.checkComposeFile(next) : { state: "unknown" };

	const ours = [`<h3>Before ${escapeHtml(next)} starts</h3>`];
	ours.push(
		`<p>OmniCore copies your data to <code>data/backups/before-${escapeHtml(next)}</code> first. ` +
			`If ${escapeHtml(next)} doesn't start properly, the version you have now comes back on its own, ` +
			`with that copy of your data.</p>`
	);
	if (compose.state === "ready") {
		ours.push(
			`<p>Once ${escapeHtml(next)} is running, OmniCore changes one line in <code>${escapeHtml(compose.file)}</code>, ` +
				`<code>${escapeHtml(compose.from)}</code> to <code>${escapeHtml(compose.to)}</code>, so Docker Compose keeps the new version. ` +
				`A copy of the file is kept beside it. You don't need to change anything.</p>`
		);
	} else if (compose.state === "manual") {
		ours.push(
			`<p><strong>One thing to do by hand, this time only.</strong> OmniCore can't reach <code>${escapeHtml(compose.file)}</code> ` +
				`to keep it in step, so after upgrading, change <code>${escapeHtml(compose.from)}</code> to ` +
				`<code>${escapeHtml(compose.to)}</code> in it. Until then, <code>docker compose up -d</code> would start the old version again, ` +
				`which won't start on data ${escapeHtml(next)} has brought up to date.</p>`
		);
	}

	const offReason = !notes
		? `What's changing in ${next} couldn't be loaded from GitHub. Try again in a moment.`
		: omnicoreVersion.isDevBuild()
		? "This is a development build, which doesn't update itself."
		: !readiness.ready
		? "Updates are turned off on this install: OmniCore has no access to Docker, so it can't install a new version itself."
		: null;

	return {
		status: 200,
		body: {
			version: next,
			html: (notes ? notes.html : `<p class="lede">${escapeHtml(offReason)}</p>`) + `<div class="major-ours">${ours.join("")}</div>`,
			offReason
		}
	};
}

// Starts the upgrade to the major version on offer, once somebody has
// read it and pressed Upgrade. { status, body }, answered straight away:
// the page follows it at the update's progress.
async function start(asked) {
	const next = nextMajor();
	if (!next || String(asked || "") !== next) {
		return { status: 409, body: { error: "That isn't the major version on offer. Reload the page." } };
	}

	const readiness = await coreUpdater.applyReadiness();
	if (!readiness.ready) return { status: 409, body: { error: readiness.reason } };
	if (coreUpdater.currentProgress().busy) {
		return { status: 409, body: { busy: true, error: "An update is already being installed." } };
	}

	coreUpdater
		.applyMajorUpgrade(next)
		.then((result) => {
			console.log(result.updated ? `  Upgrade to ${next} started. What happened next: ${result.log}` : `  Upgrade to ${next}: ${result.reason}`);
		})
		.catch((error) => {
			console.log(`  Upgrade to ${next} failed: ${error.message}`);
		});

	return { status: 202, body: { ok: true } };
}

module.exports = { build, start, nextMajor };
