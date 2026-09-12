// core/ui-theme.js
// The "Default" UI — one shared stylesheet for every page OmniCore
// renders itself: admin faces (3xxx), the welcome face (4000), the
// setup wizard (3999), and input faces (5xxx).
//
// Internally "fallback", called "Default" anywhere a person sees it.
// See docs/planning/default-ui-architecture.md for the reasoning behind
// each element.
//
// This is NOT a dashboard theme and doesn't try to be — it knows
// nothing about rendering `text`/`pair`/`time`/`graphdata` content
// blocks. Dashboard faces (4001-4999) belong entirely to whichever
// theme they're running, and nothing in this file touches them.
//
// Before this existed, the same black-background/glass-button look was
// hand-written four separate times (fallback-page, admin-face,
// control-face, input-face-page) and had already drifted between them:
// different padding, different font sizes, one with a transition the
// others lacked. Everything here exists so that never happens again.

const { readSettings } = require("./settings-store");

// The system stack a fresh install uses, and the fallback behind any
// downloaded font — if a chosen font ever fails to load, the UI stays
// readable rather than falling back to something arbitrary.
const SYSTEM_FONT =
	'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Everything colour-ish lives here rather than being written inline
// anywhere, so light mode is a matter of swapping this table and
// nothing else.
const PALETTES = {
	dark: {
		bg: "#000",
		fg: "#fff",
		fgMuted: "rgba(255, 255, 255, 0.6)",
		glassBg: "rgba(255, 255, 255, 0.06)",
		glassBgHover: "rgba(255, 255, 255, 0.12)",
		glassBorder: "rgba(255, 255, 255, 0.15)",
		glassSheen: "rgba(255, 255, 255, 0.14)",
		glassSheenStrong: "rgba(255, 255, 255, 0.28)",
		// A real halo, not an elevation shadow -- research into working
		// examples showed rest-state glows commonly sit around 0.4-0.5
		// alpha, roughly double what a first guess tends to land on.
		glow: "rgba(255, 255, 255, 0.3)",
		glowStrong: "rgba(255, 255, 255, 0.55)",
		ambientA: "rgba(255, 255, 255, 0.05)",
		ambientB: "rgba(120, 160, 255, 0.05)",
		cardBg: "rgba(255, 255, 255, 0.04)",
		cardBorder: "rgba(255, 255, 255, 0.1)",
		flash: "rgba(255, 255, 255, 0.35)",
		scrollThumb: "rgba(255, 255, 255, 0.2)",

		// A quieter border than the glass one, for things that group
		// content rather than invite a click
		border: "rgba(255, 255, 255, 0.12)",
		hoverSubtle: "rgba(255, 255, 255, 0.05)",
		inputBg: "rgba(255, 255, 255, 0.04)",
		// A recessed well (the corner map): lighter than the surface
		// around it, since on a dark background that's what reads as
		// sunken. A flat black value used everywhere regardless of
		// theme looked fine here by accident, then read as a muddy,
		// disabled-looking patch once the same value landed on a
		// light background.
		wellBg: "rgba(255, 255, 255, 0.05)",

		// Semantic colours. Without these as variables, every warning
		// and success message would stay dark-mode-coloured on a light
		// page, which is exactly the drift this refactor exists to stop.
		danger: "#ff6b6b",
		dangerText: "#ffd6d6",
		dangerBg: "rgba(70, 8, 8, 0.9)",
		dangerBorder: "rgba(255, 70, 70, 0.4)",
		success: "#3ed67a",
		successHover: "#2ab264",
		successText: "#eafff2",
		disabled: "#2c2c2c",
		disabledText: "#545454"
	},
	light: {
		bg: "#f2f2f4",
		fg: "#111",
		fgMuted: "rgba(0, 0, 0, 0.55)",
		glassBg: "rgba(255, 255, 255, 0.75)",
		glassBgHover: "rgba(255, 255, 255, 0.95)",
		glassBorder: "rgba(0, 0, 0, 0.12)",
		glassSheen: "rgba(255, 255, 255, 0.9)",
		glassSheenStrong: "rgba(255, 255, 255, 1)",
		// A plain white glow disappears against a pale page the same
		// way it did on cards before that got fixed -- tinted dark/blue
		// instead, so it reads the same way a glow should: visible
		// against whatever's behind it.
		glow: "rgba(50, 60, 100, 0.22)",
		glowStrong: "rgba(50, 60, 100, 0.4)",
		ambientA: "rgba(120, 140, 255, 0.06)",
		ambientB: "rgba(255, 190, 120, 0.06)",
		cardBg: "rgba(255, 255, 255, 0.7)",
		cardBorder: "rgba(0, 0, 0, 0.08)",
		flash: "rgba(0, 0, 0, 0.15)",
		scrollThumb: "rgba(0, 0, 0, 0.25)",

		border: "rgba(0, 0, 0, 0.12)",
		hoverSubtle: "rgba(0, 0, 0, 0.04)",
		inputBg: "rgba(255, 255, 255, 0.9)",
		// Darker than the surface around it here, for the same reason
		// the dark-mode value goes lighter: whichever direction reads
		// as sunken against that particular background.
		wellBg: "rgba(0, 0, 0, 0.06)",

		// Darker than their dark-mode counterparts on purpose: the same
		// red that reads clearly against black is far too pale to read
		// against a near-white page.
		danger: "#c0392b",
		dangerText: "#7a1c12",
		dangerBg: "rgba(255, 235, 233, 0.95)",
		dangerBorder: "rgba(192, 57, 43, 0.35)",
		success: "#1f9a53",
		successHover: "#177a41",
		successText: "#0c3d22",
		disabled: "#d6d6d8",
		disabledText: "#9a9a9e"
	}
};

// A chosen font is downloaded and served by OmniCore itself rather than
// pulled from Google's CDN on every page load — so the admin UI stays
// usable with no internet at all. See the font route in admin-face.js.
function fontStack(settings) {
	if (!settings.uiFontFamily) {
		return SYSTEM_FONT;
	}

	// The downloaded family first, the system stack behind it — a font
	// that failed to download leaves a readable page, not a broken one.
	return `"${settings.uiFontFamily}", ${SYSTEM_FONT}`;
}

// The @font-face rule for a downloaded font, or nothing at all when
// the install is still on the system font.
function fontFace(settings) {
	if (!settings.uiFontFamily) {
		return "";
	}

	return `
	@font-face {
		font-family: "${settings.uiFontFamily}";
		src: url("/ui-font.woff2") format("woff2");
		font-display: swap;
	}`;
}

// Everything above, plus the components, as one stylesheet. Pages drop
// this into a <style> tag rather than each writing their own CSS.
function uiStyles(options) {
	const settings = readSettings();
	const palette = PALETTES[settings.uiMode] || PALETTES.dark;
	const isLight = settings.uiMode === "light";

	// A page can force dark regardless of the setting — used by nothing
	// today, but it's the seam an input face would use once input faces
	// can pick their own theme.
	const forced = options && options.forceMode;
	const active = forced ? PALETTES[forced] || palette : palette;
	const lightMode = forced ? forced === "light" : isLight;

	return `
	${fontFace(settings)}

	:root {
		--bg: ${active.bg};
		--fg: ${active.fg};
		--fg-muted: ${active.fgMuted};

		--glass-bg: ${active.glassBg};
		--glass-bg-hover: ${active.glassBgHover};
		--glass-border: ${active.glassBorder};
		--glass-sheen: ${active.glassSheen};
		--glass-sheen-strong: ${active.glassSheenStrong};
		--glow: ${active.glow};
		--glow-strong: ${active.glowStrong};

		--card-bg: ${active.cardBg};
		--card-border: ${active.cardBorder};

		--flash: ${active.flash};
		--scroll-thumb: ${active.scrollThumb};

		--border: ${active.border};
		--hover-subtle: ${active.hoverSubtle};
		--input-bg: ${active.inputBg};
		--well-bg: ${active.wellBg};

		--danger: ${active.danger};
		--danger-text: ${active.dangerText};
		--danger-bg: ${active.dangerBg};
		--danger-border: ${active.dangerBorder};
		--success: ${active.success};
		--success-hover: ${active.successHover};
		--success-text: ${active.successText};
		--disabled: ${active.disabled};
		--disabled-text: ${active.disabledText};

		--font: ${fontStack(settings)};
		--font-size: ${Number(settings.uiFontSize) || 16}px;

		--radius: 12px;
	}

	* { box-sizing: border-box; }

	body {
		background: var(--bg);
		/* Soft, mostly-invisible blobs behind the content -- not
		   decoration for its own sake, but what backdrop-filter needs
		   to actually have something to blur. Without this, blurring a
		   flat solid colour returns the same flat solid colour, so the
		   whole "frosted glass" effect below contributes nothing at all
		   -- exactly what was happening before this existed. */
		background-image:
			radial-gradient(circle at 15% 20%, ${active.ambientA}, transparent 42%),
			radial-gradient(circle at 85% 75%, ${active.ambientB}, transparent 46%);
		background-attachment: fixed;
		color: var(--fg);
		font-family: var(--font);
		font-size: var(--font-size);
		margin: 0;
	}

	/* ---------------------------------------------------------------
	   Glossy button — the primary clickable thing throughout.
	   Deliberately glossy so it reads as clickable from across a room,
	   not just up close at a desk.

	   The glossiness has to hold up on its own, not lean entirely on
	   backdrop-filter -- a beveled edge (the inset highlight/shadow
	   below) reads as a lit, raised surface regardless of what's behind
	   it; the blur is a bonus on top of that, not the whole effect.
	   --------------------------------------------------------------- */
	.glass {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		/* Two layers at rest: the insets are the bevel that makes it
		   read as glass regardless of what's behind it -- that's
		   surface material, not glow, and stays visible always. The
		   actual glow (a colored halo) is added only on :hover /
		   :focus-visible below -- a glow that's always on reads as
		   noise, not as feedback for anything. */
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2);
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		padding: 0.9em 1.9em;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.1s ease,
			box-shadow 0.2s ease;
	}

	/* :focus-visible alongside :hover, not instead of it -- a glow
	   that only ever fires on mouse hover leaves keyboard navigation
	   with no feedback at all */
	.glass:hover,
	.glass:focus-visible {
		background: var(--glass-bg-hover);
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2),
			0 0 30px var(--glow-strong);
	}

	.glass:active { transform: scale(0.97); }

	/* The reflection: a light sheen across the upper half, stronger
	   than a hairline so it reads clearly even with nothing behind the
	   element for the blur to catch */
	.glass::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 55%;
		background: linear-gradient(
			to bottom, var(--glass-sheen-strong), transparent
		);
		pointer-events: none;
	}

	/* ---------------------------------------------------------------
	   Card — flat and transparent, for showcasing things: marketplace
	   listings, lists of installed resources.
	   --------------------------------------------------------------- */
	.card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius);
		padding: 1em 1.2em;
		cursor: pointer;
		transition: box-shadow 0.25s ease, transform 0.25s ease,
			background 0.25s ease;
	}

	${
		lightMode
			? `/* Light mode: a card lifts slightly rather than glowing —
	   a glow reads as nothing against a pale background. */
	.card:hover,
	.card:focus-visible {
		transform: scale(1.02);
		background: var(--glass-bg-hover);
	}`
			: `/* Dark mode: a card glows rather than moving — motion is
	   unnecessary when light alone reads clearly against black.
	   Values taken from working reference examples rather than a
	   first guess: a visible glow sits close to 0.5 alpha at its
	   core, not 0.1-0.25. */
	.card:hover,
	.card:focus-visible {
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55),
			0 0 32px rgba(255, 255, 255, 0.45),
			0 0 70px rgba(255, 255, 255, 0.2);
		background: var(--glass-bg-hover);
	}`
	}

	/* ---------------------------------------------------------------
	   Scrollable list — the list scrolls, the page doesn't. Nothing
	   else on screen should move just because a list happens to be
	   long.
	   --------------------------------------------------------------- */
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.6em;
		overflow-y: auto;
		max-height: 60vh;
		border: 1px solid var(--card-border);
		border-radius: var(--radius);
		padding: 1em 2em;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.list::-webkit-scrollbar { width: 8px; }
	.list::-webkit-scrollbar-track { background: transparent; }
	.list::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 4px;
	}

	/* A .card used as a single-line row inside a .list -- name on
	   the left, a secondary label pinned to the right on the same
	   line, rather than stacked underneath. Used for the font
	   picker's results, and anything else where a long list reads
	   better at a glance than at two lines per entry. */
	.font-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1em;
		white-space: nowrap;
	}

	.font-row .hint { margin: 0; flex-shrink: 0; }

	/* ---------------------------------------------------------------
	   Floating button — flat, NOT glossy, deliberately distinct from
	   the glass buttons above. Flashes on tap rather than glowing or
	   lifting.
	   --------------------------------------------------------------- */
	.floating {
		appearance: none;
		-webkit-appearance: none;
		position: fixed;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.4em;
		height: 3.4em;
		border-radius: 50%;
		border: 1px solid var(--glass-border);
		background: var(--card-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		cursor: pointer;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		transition: background 0.15s ease;
	}

	.floating:active,
	.floating.flash { background: var(--flash); }

	/* Corner is a user setting. Bottom-left is never offered — it's
	   reserved for the welcome face's auto-advance timer, so the two
	   can never collide. */
	.floating.bottom-right { bottom: 1.5em; right: 1.5em; }
	.floating.top-left { top: 1.5em; left: 1.5em; }

	.muted { color: var(--fg-muted); }

	/* ---------------------------------------------------------------
	   Toggle switch — a real sliding knob, for a plain on/off
	   preference that has nothing else attached to it (light/dark
	   mode is the model case). Different from tabs below on purpose:
	   a switch is for a binary preference alone; tabs are for a
	   choice that reveals different follow-up content underneath it.
	   --------------------------------------------------------------- */
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.7em;
		cursor: pointer;
	}

	.switch input { position: absolute; opacity: 0; pointer-events: none; }

	.switch-track {
		position: relative;
		width: 2.6em;
		height: 1.5em;
		border-radius: 999px;
		background: var(--card-border);
		border: 1px solid var(--glass-border);
		transition: background 0.2s ease;
		flex-shrink: 0;
	}

	.switch-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 1.1em;
		height: 1.1em;
		border-radius: 50%;
		background: var(--fg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
		transition: transform 0.2s ease;
	}

	.switch input:checked + .switch-track { background: var(--success); }
	.switch input:checked + .switch-track .switch-knob {
		transform: translateX(1.1em);
	}

	.switch input:focus-visible + .switch-track {
		box-shadow: 0 0 0 2px var(--glow-strong);
	}

	/* ---------------------------------------------------------------
	   Tabs — a segmented choice between a small, fixed set of named
	   options. Used both where each option reveals different content
	   below it (Automatic vs Set it myself), and where the options are
	   just named positions rather than a true binary (back button
	   corner) -- in both cases what makes it tabs rather than a switch
	   is that the options are labelled things, not an on/off state.
	   --------------------------------------------------------------- */
	.tabs {
		display: inline-flex;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius);
		padding: 3px;
		gap: 3px;
	}

	.tab-btn {
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		border: none;
		border-radius: calc(var(--radius) - 3px);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.95em;
		padding: 0.6em 1.2em;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease;
	}

	.tab-btn.active {
		background: var(--glass-bg-hover);
		color: var(--fg);
		box-shadow: inset 0 1px 0 var(--glass-sheen);
	}

	.tab-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--glow-strong);
	}

	/* A number stepper: down button, the value, up button. Used
	   wherever a small bounded number is set (text size, and anything
	   later that needs the same shape) rather than a slider — a slider
	   is for a continuous range you drag through; this is a small set
	   of discrete steps someone taps through one at a time. */
	/* ---------------------------------------------------------------
	   Modal — a floating panel over a dimmed backdrop.

	   Used where a control needs more room than its tile can give it
	   without the tile growing and shoving the rest of the layout
	   around: the font picker's results list, the location search.
	   Centred rather than anchored under whatever opened it, since a
	   tile's position varies with the layout and an anchored panel
	   would clip at the screen edge.
	   --------------------------------------------------------------- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(3px);
		-webkit-backdrop-filter: blur(3px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5em;
		z-index: 100;
	}

	.modal-backdrop[hidden] { display: none; }

	.modal {
		width: 100%;
		max-width: 26em;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		gap: 0.9em;
		background: var(--bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
		padding: 1.4em;
	}

	.modal h2 { margin: 0; font-size: 1.05em; font-weight: 600; }

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
	}

	/* Deliberately not a .glass button: closing is the least important
	   thing on the panel, and a glowing button would pull the eye
	   before the thing someone actually opened it for. */
	.modal-close {
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		border: none;
		color: var(--fg-muted);
		font-size: 1.3em;
		line-height: 1;
		padding: 0.2em 0.4em;
		cursor: pointer;
		border-radius: 6px;
	}

	.modal-close:hover { color: var(--fg); background: var(--glass-bg); }

	.stepper {
		display: flex;
		align-items: center;
		gap: 0.6em;
	}

	.stepper .glass {
		padding: 0.5em 0.9em;
		font-size: 1.1em;
		line-height: 1;
	}

	.stepper input[type="number"] {
		width: 4em;
		text-align: center;
		background: var(--input-bg);
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		padding: 0.5em;
	}

	/* Hide the browser's own up/down spinner -- the glass buttons ARE
	   the up/down control, a second native one next to them would be
	   pure clutter */
	.stepper input[type="number"]::-webkit-outer-spin-button,
	.stepper input[type="number"]::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.stepper input[type="number"] { -moz-appearance: textfield; }
`;
}

// The floating back button's markup, or nothing when a page shouldn't
// have one. Pages that are a root — the welcome face, an input face,
// the wizard — pass nothing and get nothing; there's genuinely nowhere
// for it to lead.
function backButton(href) {
	if (!href) {
		return "";
	}

	const corner = readSettings().backButtonCorner === "top-left"
		? "top-left"
		: "bottom-right";

	return `
	<button
		class="floating ${corner}"
		onclick="location.href='${href}'"
		aria-label="Back">&#8592;</button>`;
}

module.exports = { uiStyles, backButton, PALETTES, SYSTEM_FONT };