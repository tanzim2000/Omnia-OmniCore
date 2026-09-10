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

const express = require("express");
const faceStore = require("./face-store");
const { uiStyles } = require("./ui-theme");
const { attachFontRoute } = require("./font-service");
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
	   The face picker: a fixed-height framed region, not a box that
	   grows to fit its content -- one face or twenty, the frame is
	   the same size, with a visible border so its edge is obvious.
	   Content sits centered within it; only becomes actually
	   scrollable once it genuinely overflows.

	   Generously padded on the sides on purpose: a card's hover glow
	   paints outside the card's own box, and this container clips
	   anything crossing its edge the moment overflow-y is set at
	   all -- not enough horizontal room here and the glow gets cut
	   off exactly where it should be brightest.
	   --------------------------------------------------------------- */
	.face-list {
		width: 100%;
		max-width: 640px;
		height: min(620px, 62vh);
		border: 1px solid var(--card-border);
		border-radius: var(--radius);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75em;
		padding: 2em 3em;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.face-list::-webkit-scrollbar { width: 8px; }
	.face-list::-webkit-scrollbar-track { background: transparent; }
	.face-list::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 4px;
	}

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
		/* Spacing between cards comes from .face-list's own gap now,
		   not a margin on each card -- otherwise the last card would
		   carry unwanted space below it too */
		width: 100%;
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
			<div class="card face" onclick="goToFace(${face.id})">
				<strong>${escapeHtml(face.name)}</strong>
				<span>port ${face.id} · ${escapeHtml(face.theme || "no theme")}</span>
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