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
		cardBg: "rgba(255, 255, 255, 0.04)",
		cardBorder: "rgba(255, 255, 255, 0.1)",
		flash: "rgba(255, 255, 255, 0.35)",
		scrollThumb: "rgba(255, 255, 255, 0.2)",

		// A quieter border than the glass one, for things that group
		// content rather than invite a click
		border: "rgba(255, 255, 255, 0.12)",
		hoverSubtle: "rgba(255, 255, 255, 0.05)",
		inputBg: "rgba(255, 255, 255, 0.04)",

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
		cardBg: "rgba(255, 255, 255, 0.7)",
		cardBorder: "rgba(0, 0, 0, 0.08)",
		flash: "rgba(0, 0, 0, 0.15)",
		scrollThumb: "rgba(0, 0, 0, 0.25)",

		border: "rgba(0, 0, 0, 0.12)",
		hoverSubtle: "rgba(0, 0, 0, 0.04)",
		inputBg: "rgba(255, 255, 255, 0.9)",

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

		--card-bg: ${active.cardBg};
		--card-border: ${active.cardBorder};

		--flash: ${active.flash};
		--scroll-thumb: ${active.scrollThumb};

		--border: ${active.border};
		--hover-subtle: ${active.hoverSubtle};
		--input-bg: ${active.inputBg};

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
		color: var(--fg);
		font-family: var(--font);
		font-size: var(--font-size);
		margin: 0;
	}

	/* ---------------------------------------------------------------
	   Glossy button — the primary clickable thing throughout.
	   Deliberately glossy so it reads as clickable from across a room,
	   not just up close at a desk.
	   --------------------------------------------------------------- */
	.glass {
		position: relative;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius);
		backdrop-filter: blur(12px);
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		padding: 0.9em 1.9em;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.1s ease;
	}

	.glass:hover { background: var(--glass-bg-hover); }
	.glass:active { transform: scale(0.97); }

	/* The reflection: a light sheen across the upper half */
	.glass::before {
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
	.card:hover {
		transform: scale(1.02);
		background: var(--glass-bg-hover);
	}`
			: `/* Dark mode: a card glows rather than moving — motion is
	   unnecessary when light alone reads clearly against black. */
	.card:hover {
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25),
			0 0 24px rgba(255, 255, 255, 0.12);
		background: var(--glass-bg);
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
		padding-right: 0.4em;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.list::-webkit-scrollbar { width: 8px; }
	.list::-webkit-scrollbar-track { background: transparent; }
	.list::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 4px;
	}

	/* ---------------------------------------------------------------
	   Floating button — flat, NOT glossy, deliberately distinct from
	   the glass buttons above. Flashes on tap rather than glowing or
	   lifting.
	   --------------------------------------------------------------- */
	.floating {
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