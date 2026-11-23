// core/control-face.js
// The welcome face, on port 4000. OmniView talks to this to discover
// and pick which dashboard face to display.
//
// It used to host the setup wizard too. That moved to its own face on
// 3999 (core/wizard-face.js) so this one could become a pure picker:
// nothing here can create, change, or delete anything, which is what
// makes it safe to leave open on a wall display or hand to OmniView.
//
// STYLING: its own stylesheet rather than the shared Default UI, even
// though it currently looks identical to it. That's deliberate -- this
// is the screen a person is most likely to want to make their own, so
// it's kept independently customisable rather than locked to whatever
// the admin UI looks like. See
// docs/planning/default-ui-architecture.md.

const { attachBackdropRoute } = require("./backdrop");
const { ICON_LINK, attachIconRoute } = require("./icon");
const { pageStart } = require("./page-motion");
const express = require("express");
const faceStore = require("./face-store");
const {
	uiStyles,
	styleTag,
	rememberUiMode,
	modeSwitch,
	MODE_SWITCH_SCRIPT,
	UI_MODE_SCRIPT
} = require("./ui-theme");
const { attachFontRoute } = require("./font-service");
const {
	portLinkScript,
	escapeHtml,
	WELCOME_PORT,
	WIZARD_PORT,
	ADMIN_PORT
} = require("./face-links");

// The round Settings button in the top-right, beside the Light / Dark /
// Device switch. A gear, the same size and look as the switch. It opens
// the admin face, which asks to sign in first if this browser hasn't.
function settingsButton() {
	return `
	<button type="button" class="floating top-right-second corner-button"
		onclick="goToSettings()" aria-label="Settings" title="Settings">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="3"></circle>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
		</svg>
	</button>`;
}

// How long the single-face case waits before going there on its own.
const AUTO_ADVANCE_SECONDS = 30;


function page(title, body, script) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	${ICON_LINK}
	${styleTag(uiStyles())}
</head>
<body class="welcome-page">
${pageStart()}
	${body}
	<script>${script || ""}</script>
</body>
</html>`;
}

function startControlFace() {
	const app = express();
	// The browser tab's icon (core/icon.js)
	attachIconRoute(app);

	// The network stream for the status drawer and the takeover (see
	// network-status.js)
	require("./network-status").attach(app, "other");

	app.use(express.json());

	// Light or dark for whichever browser is asking. See ui-theme.js.
	app.use(rememberUiMode);

	// The picture behind OmniCore's own pages, when one is set. See
	// backdrop.js.
	attachBackdropRoute(app);

	// Serves the chosen UI font from this face's own origin
	attachFontRoute(app);

	// Liveness. Deliberately a real capability check, not just "this
	// process answered" -- reading the faces store proves OmniCore can
	// still do its actual job, which is what Docker's restart policy
	// can't tell on its own. `restart: unless-stopped` only fires when
	// a process genuinely dies; a hung-but-alive one never triggers it.
	//
	// Lives on the welcome face because it's the one face guaranteed to
	// exist regardless of configuration, and it's already
	// unauthenticated by design, so a health probe needs no special
	// exemption to reach it.
	//
	// Also the signal self-update's rollback watches: see
	// core/core-updater.js. If a newly swapped-in container can't reach
	// healthy, that's what triggers reverting to the previous one.
	app.get("/health", (req, res) => {
		try {
			const faces = faceStore.readFaces();

			res.json({
				status: "ok",
				faces: faces.length,
				version: process.env.OMNICORE_VERSION || "dev"
			});
		} catch (error) {
			// Store unreadable means OmniCore is running but can't
			// function -- exactly the case a plain process check misses.
			res.status(503).json({ status: "unhealthy", error: error.message });
		}
	});

	// Machine-readable face registry — this is what OmniView calls
	app.get("/faces", (req, res) => {
		res.json(faceStore.readFaces());
	});

	// The picker itself. Three genuinely different situations:
	//
	//   no faces   nothing to pick, so don't ask — go straight to the
	//              wizard and start building one
	//   one face   show it, but don't make someone walk over and tap a
	//              button they had no real choice about; auto-advance
	//   many       show the list, no timer. There's nothing safe to
	//              guess at once there's more than one.
	app.get("/", (req, res) => {
		const faces = faceStore.readFaces();

		if (faces.length === 0) {
			// Redirect happens in the browser rather than server-side,
			// because only the browser knows what host it reached us on
			// — the wizard is on a different port, and a Codespaces URL
			// isn't something the server can reconstruct.
			res.send(
				page(
					"OmniCore",
					`<div class="panel"><h1>Setting up…</h1>
					<p class="lede">Taking you to create your first face.</p></div>`,
					portLinkScript +
						`location.replace(faceUrl(${WIZARD_PORT}) + "/faces/new");`
				)
			);
			return;
		}

		const list = faces
			.map(
				(face) => `
			<div class="segment clickable face" onclick="goToFace(${face.id})">
				<strong>${escapeHtml(faceStore.faceLabel(face))}</strong>
				<span>Outport ${face.id} · ${escapeHtml(face.theme || "no theme")}</span>
			</div>`
			)
			.join("");

		const single = faces.length === 1;

		const body = `
			<div class="panel">
				<h1>Welcome!</h1>
				<p class="lede">Choose your dashboard.</p>
			</div>
			<div class="face-list">${list}</div>
			<div class="actions">
				<button class="glass" onclick="goToWizard()">
					Create a new face
				</button>
			</div>
			${settingsButton()}
			${modeSwitch()}
			${
				single
					? `<div class="timer" id="timer" title="Opening ${escapeHtml(
							faces[0].name
					  )} shortly">
					<div class="timer-lamp" id="lamp" style="--remaining: 1"></div>
				</div>`
					: ""
			}`;

		const script =
			portLinkScript +
			`
			function goToFace(port) { omniGo(faceUrl(port)); }
			function goToWizard() {
				omniGo(faceUrl(${WIZARD_PORT}) + "/faces/new");
			}
			function goToSettings() { omniGo(faceUrl(${ADMIN_PORT})); }

			// The Light / Dark / Device switch (see ui-theme.js). Pressing
			// it, or Settings, cancels the auto-advance below like any
			// other touch does.
			${UI_MODE_SCRIPT}
			${MODE_SWITCH_SCRIPT}
		` +
			(single
				? `
			// Only one face exists, so there's no real choice to make —
			// drain the lamp and go there. Any interaction at all cancels
			// it: someone who touched the screen is deciding for
			// themselves, and shouldn't be overridden mid-thought.
			var remaining = ${AUTO_ADVANCE_SECONDS};
			var lamp = document.getElementById("lamp");
			var timer = document.getElementById("timer");
			var onlyFace = ${faces[0].id};

			var tick = setInterval(function () {
				remaining -= 1;
				lamp.style.setProperty("--remaining", remaining / ${AUTO_ADVANCE_SECONDS});

				if (remaining <= 0) {
					clearInterval(tick);
					omniGo(faceUrl(onlyFace));
				}
			}, 1000);

			function cancelAutoAdvance() {
				clearInterval(tick);
				if (timer) { timer.remove(); }
			}

			["pointerdown", "keydown", "wheel", "touchstart"].forEach(
				function (event) {
					window.addEventListener(event, cancelAutoAdvance, { once: true });
				}
			);
		`
				: "");

		res.send(page("OmniCore Control", body, script));
	});

	app.listen(WELCOME_PORT, () => {
		console.log(`Welcome face listening on port ${WELCOME_PORT}`);
	});
}

module.exports = startControlFace;