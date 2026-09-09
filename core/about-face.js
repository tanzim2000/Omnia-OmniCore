// core/about-face.js
// A small, static face on port 1303 — chosen deliberately, not
// sequentially: 1303 (তেরশ তিন) was a stage name from music production
// days in Bangladesh, said quickly a small joke on "thirteen co-wives."
//
// Genuinely its own face rather than a route on the admin face, same
// reasoning as the wizard getting its own port: it has nothing to do
// with configuring anything, holds no state, and needing to log in to
// read "what is this thing" would be a strange requirement for exactly
// the page meant to answer that question for someone who hasn't yet.
// Unauthenticated on purpose, same trust model as the welcome face.

const express = require("express");
const { uiStyles } = require("./ui-theme");
const { portLinkScript, escapeHtml } = require("./face-links");

const PORT = 1303;

function page(version) {
	const body = `
		<div class="panel" style="text-align:center">
			<h1>OmniCore</h1>
			<p class="lede">
				A modular, config-driven backend for building your own home
				dashboard ecosystem.
			</p>
		</div>

		<div class="panel card" style="text-align:center">
			<strong>Version</strong>
			<p class="lede" style="margin-top:6px">${escapeHtml(version)}</p>
		</div>

		<div class="panel" style="text-align:center">
			<a class="glass" href="https://github.com/tanzim2000/Omnia-OmniCore"
				target="_blank" rel="noopener"
				style="display:block;text-align:center;box-sizing:border-box;margin-bottom:10px">
				Source on GitHub
			</a>
			<button class="glass" onclick="backToSettings()"
				style="display:block;width:100%;text-align:center;box-sizing:border-box">
				Back to Settings
			</button>
		</div>

		<div class="panel" style="text-align:center">
			<span class="muted" style="font-size:0.85em">
				Built by Tanzim Ahmed (Thirteen03)
			</span>
		</div>`;

	const script =
		portLinkScript +
		`
		// A plain relative link would be broken here -- this face lives on
		// a different port from the admin face entirely, so getting back
		// needs the same cross-port trick the wizard already uses.
		function backToSettings() {
			location.href = faceUrl(3000);
		}
	`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>About — OmniCore</title>
	<style>
${uiStyles()}
		body {
			min-height: 100vh;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 1.25em;
			padding: 2em 1.5em;
		}
		.panel { width: 100%; max-width: 460px; box-sizing: border-box; }
	</style>
</head>
<body>
	${body}
	<script>${script}</script>
</body>
</html>`;
}

function startAboutFace() {
	const app = express();

	app.get("/", (req, res) => {
		res.send(page(process.env.OMNICORE_VERSION || "dev"));
	});

	app.listen(PORT, () => {
		console.log(`About face listening on port ${PORT}`);
	});
}

module.exports = startAboutFace;