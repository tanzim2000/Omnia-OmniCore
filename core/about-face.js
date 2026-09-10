// core/about-face.js
// The About face, on port 1303.
//
// This is the centre of the ecosystem rather than a utility screen:
// Omnia is the umbrella, OmniCore is the piece of it running here, and
// this page is where the whole thing introduces itself. It's why the
// ambient colour is stronger here than anywhere else in OmniCore, and
// why the wordmark gets its own typeface.
//
// Genuinely its own face rather than a route on the admin face: it
// holds no state, configures nothing, and requiring a login to read
// what OmniCore even is would be a strange requirement for exactly the
// page meant to answer that for someone who hasn't set an account up
// yet. Unauthenticated on purpose, same trust model as the welcome
// face.
//
// Styling lives in core/about-face.css — a real file, served at
// /about.css, so this page's look can be changed without touching any
// JavaScript.

const express = require("express");
const fs = require("fs");
const path = require("path");

const { uiStyles } = require("./ui-theme");
const { portLinkScript, escapeHtml } = require("./face-links");
const systemInfo = require("./system-info");
const updateStore = require("./update-store");
const fontService = require("./font-service");

const PORT = 1303;
const ADMIN_PORT = 3000;

// A simple four-point star. Deliberately drawn here rather than
// embedding anyone's actual trademarked logo file, which isn't ours to
// ship in this repo.
const CLAUDE_MARK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-label="Claude" role="img">
	<path d="M12 2c.4 4.6 1.4 6.9 3.5 8.5C17.1 11.7 19 12 22 12c-3 0-4.9.3-6.5 1.5C13.4 15.1 12.4 17.4 12 22c-.4-4.6-1.4-6.9-3.5-8.5C6.9 12.3 5 12 2 12c3 0 4.9-.3 6.5-1.5C10.6 8.9 11.6 6.6 12 2z"/>
</svg>`;

const HEALTHY_RING = `<svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">
	<circle cx="18" cy="18" r="15" fill="none" stroke="rgba(62,214,122,0.25)" stroke-width="4"/>
	<circle cx="18" cy="18" r="15" fill="none" stroke="#3ed67a" stroke-width="4"
		stroke-dasharray="94.2 94.2" stroke-linecap="round" transform="rotate(-90 18 18)"/>
	<path d="M12 18l4 4 8-8" stroke="#3ed67a" stroke-width="2.5" fill="none"
		stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const OS_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
	stroke="currentColor" stroke-width="1.6" aria-hidden="true">
	<circle cx="12" cy="12" r="9"/>
	<path d="M9 10h.01M15 10h.01M8 15c1.2 1 2.4 1.5 4 1.5s2.8-.5 4-1.5"/>
</svg>`;

const RUNTIME_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
	stroke="currentColor" stroke-width="1.6" aria-hidden="true">
	<rect x="3" y="9" width="18" height="7" rx="1.5"/>
	<path d="M7 9V6a2 2 0 012-2h6a2 2 0 012 2v3"/>
</svg>`;

// A stat only appears if OmniCore could actually answer it. A blank
// where a number should be says nothing useful; leaving the tile out
// says "this isn't available here", which is true.
function stat(label, value) {
	if (value === null || value === undefined) {
		return "";
	}

	return `
		<div class="stat">
			<div class="stat-label">${escapeHtml(label)}</div>
			<div class="stat-value">${escapeHtml(String(value))}</div>
		</div>`;
}

function systemRow(icon, label, value) {
	if (!value) {
		return "";
	}

	return `
		<div class="system-row">
			${icon}
			<div>
				<div class="system-label">${escapeHtml(label)}</div>
				<div class="system-value">${escapeHtml(value)}</div>
			</div>
		</div>`;
}

// The version tile, which is also the way through to the updates page
// on the admin face. Deliberately looks identical to the tiles beside
// it whether or not there's anything to find -- the only tell is a
// small dot when an update is genuinely waiting.
//
// It reads the LAST RECORDED check rather than running one: rendering
// a page should never cost a call to GitHub, and the scheduler is
// already checking every six hours anyway.
//
// The link goes to the admin face, not anywhere on this one. Anything
// with real depth belongs behind the login that already exists there;
// this face stays public and read-only.
function versionStat(info) {
	const update = updateStore.lastResult(info.version);
	const dot = update.updateAvailable
		? '<span class="update-dot" title="An update is available"></span>'
		: "";

	return `
		<a class="stat stat-link" id="version-tile" href="#">
			<div class="stat-label">OmniCore${dot}</div>
			<div class="stat-value">${escapeHtml(info.version.replace(/^v/, ""))}</div>
		</a>`;
}

function renderPage(info) {
	const runtime = info.runtime
		? `${info.runtime.name}${info.runtime.version ? " v" + info.runtime.version : ""}`
		: null;

	const health = info.healthy
		? `<div class="health ok">${HEALTHY_RING} All systems healthy</div>`
		: `<div class="health bad">Something isn't right</div>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>About — OmniCore</title>
	<style>${uiStyles()}</style>
	<link rel="stylesheet" href="/about.css">
</head>
<body>
	<h1 class="omnia-title">Omnia</h1>

	${health}

	<div class="stats">
		${versionStat(info)}
		${stat("Resources", info.resources)}
		${stat("Dashboards", info.dashboards)}
	</div>

	<div class="system">
		${systemRow(OS_ICON, "Host OS", info.operatingSystem)}
		${systemRow(RUNTIME_ICON, "Container runtime", runtime)}
	</div>

	<div class="actions">
		<a class="glass" href="https://github.com/tanzim2000/Omnia-OmniCore"
			target="_blank" rel="noopener">Source on GitHub</a>
		<button class="glass" disabled>Donate</button>
	</div>

	<div class="credits">
		<span>Architected by Tanzim Ahmed (Thirteen03), built by</span>
		${CLAUDE_MARK}
		<span>Claude</span>
	</div>

	<button class="floating bottom-right" id="back" aria-label="Back">&#8592;</button>

	<script>
		${portLinkScript}

		// Guarded rather than assumed to exist: a script that runs before
		// its own elements are parsed throws on the first line and
		// silently kills everything after it in the same block -- which
		// is exactly what happened here before this fix. The button now
		// comes before this script in the HTML, but the guard stays as a
		// second line of defence against the same mistake recurring.
		var back = document.getElementById("back");
		if (back) {
			back.addEventListener("click", function () {
				location.href = faceUrl(${ADMIN_PORT});
			});
		}

		var versionTile = document.getElementById("version-tile");
		if (versionTile) {
			versionTile.addEventListener("click", function (event) {
				event.preventDefault();
				location.href = faceUrl(${ADMIN_PORT}) + "/updates";
			});
		}
	</script>
</body>
</html>`;
}

function startAboutFace() {
	const app = express();

	// Served from a real file rather than inlined, so the stylesheet
	// stays editable on its own.
	app.get("/about.css", (req, res) => {
		res.type("text/css");
		res.sendFile(path.join(__dirname, "about-face.css"));
	});

	// The wordmark's typeface. Same rule as every other font in
	// OmniCore: downloaded once and served from here, never fetched
	// from a CDN when the page renders, so this works with no internet.
	// Missing simply means the wordmark falls back to a system serif.
	app.get("/omnia-title.woff2", (req, res) => {
		const file = path.join(__dirname, "..", "data", "omnia-title.woff2");

		if (!fs.existsSync(file)) {
			res.status(404).end();
			return;
		}

		res.type("font/woff2");
		res.sendFile(file);
	});

	fontService.attachFontRoute(app);

	// Fire and forget: the page renders in a fallback serif until this
	// lands, and never waits on it. Attempted on every start so a box
	// that had no internet the first time picks it up later.
	fontService.ensureTitleFont();

	app.get("/", async (req, res) => {
		res.send(renderPage(await systemInfo.readAll()));
	});

	app.listen(PORT, () => {
		console.log(`About face listening on port ${PORT}`);
	});
}

module.exports = startAboutFace;