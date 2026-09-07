// core/control-face.js
// The welcome face, on port 4000. OmniVision talks to this to discover
// and pick which dashboard face to display.
//
// It used to host the setup wizard too. That moved to its own face on
// 3999 (core/wizard-face.js) so this one could become a pure picker:
// nothing here can create, change, or delete anything, which is what
// makes it safe to leave open on a wall display or hand to OmniVision.
//
// STYLING: its own stylesheet rather than the shared Default UI, even
// though it currently looks identical to it. That's deliberate -- this
// is the screen a person is most likely to want to make their own, so
// it's kept independently customisable rather than locked to whatever
// the admin UI looks like. See
// docs/planning/default-ui-architecture.md.

const express = require("express");
const faceStore = require("./face-store");
const { uiStyles } = require("./ui-theme");
const {
	portLinkScript,
	escapeHtml,
	WELCOME_PORT,
	WIZARD_PORT
} = require("./face-links");

// How long the single-face case waits before going there on its own.
const AUTO_ADVANCE_SECONDS = 30;

const styles = `
	body {
		min-height: 100vh;
		padding: 3em 1.5em;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.75em;
	}

	.panel { width: 100%; max-width: 460px; }

	h1 { font-weight: 300; font-size: 1.75em; margin: 0; }
	.lede { color: var(--fg-muted); font-size: 0.875em; margin: 0.6em 0 0 0; }

	.actions { display: flex; gap: 0.75em; justify-content: center; }

	/* ---------------------------------------------------------------
	   The auto-advance timer: a small round lamp under a domed glass
	   lens, echoing the glossy buttons rather than introducing a new
	   visual idiom. The amber wedge drains as the seconds run out, so
	   the redirect is never a surprise.

	   Fixed bottom-left, always. The floating back button deliberately
	   only offers bottom-right and top-left, so the two can never
	   collide.
	   --------------------------------------------------------------- */
	.timer {
		position: fixed;
		bottom: 1.5em;
		left: 1.5em;
		width: 3.2em;
		height: 3.2em;
		border-radius: 50%;
		border: 1px solid var(--glass-border);
		background: var(--card-bg);
		backdrop-filter: blur(12px);
		overflow: hidden;
		z-index: 50;
	}

	/* The lamp itself. A conic gradient is what makes the wedge: the
	   filled portion is amber, the rest is nothing, and shrinking the
	   angle drains it like a pie chart losing its slice. */
	.timer-lamp {
		position: absolute;
		inset: 0.45em;
		border-radius: 50%;
		background: conic-gradient(
			#ffb43a calc(var(--remaining) * 1turn),
			rgba(255, 180, 58, 0.12) 0
		);
		box-shadow: 0 0 0.75em rgba(255, 180, 58, 0.35);
		transition: background 1s linear;
	}

	/* The dome: a sheen across the upper half, same treatment the glass
	   buttons get, so the lamp reads as sitting under a lens. */
	.timer::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, var(--glass-sheen), transparent
		);
		pointer-events: none;
	}

	.face {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		margin-bottom: 0.6em;
	}

	.face span { color: var(--fg-muted); font-size: 0.8em; }
`;

function page(title, body, script) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${uiStyles()}${styles}</style>
</head>
<body>
	${body}
	<script>${script || ""}</script>
</body>
</html>`;
}

function startControlFace() {
	const app = express();
	app.use(express.json());

	// Machine-readable face registry — this is what OmniVision calls
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
			<div class="card face" onclick="goToFace(${face.id})">
				<strong>${escapeHtml(face.name)}</strong>
				<span>port ${face.id} · ${escapeHtml(face.theme || "no theme")}</span>
			</div>`
			)
			.join("");

		const single = faces.length === 1;

		const body = `
			<div class="panel"><h1>Faces</h1></div>
			<div class="panel list">${list}</div>
			<div class="actions">
				<button class="glass" onclick="goToWizard()">
					Create a new face
				</button>
			</div>
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
			function goToFace(port) { location.href = faceUrl(port); }
			function goToWizard() {
				location.href = faceUrl(${WIZARD_PORT}) + "/faces/new";
			}
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
					location.href = faceUrl(onlyFace);
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