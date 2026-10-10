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
		segmentBg: "rgba(255, 255, 255, 0.04)",
		segmentBorder: "rgba(255, 255, 255, 0.1)",
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
		successBg: "rgba(8, 46, 24, 0.9)",
		successBorder: "rgba(62, 214, 122, 0.4)",
		success: "#3ed67a",
		successHover: "#2ab264",
		successText: "#eafff2",

		// The green BUTTON ("Installed", "Go back") has its own colours,
		// separate from `success` above. `success` is also the colour of
		// "good" status text and of a switch that's turned on, and those
		// need to stay bright to read against black. The button sits a
		// couple of steps darker so a row of them doesn't shout louder
		// than the buttons you can still press. Glossy here, like every
		// other button in dark mode.
		successButton: "linear-gradient(to bottom, #1f9a53, #177a41)",
		successButtonHover: "linear-gradient(to bottom, #23a85b, #1a8549)",
		successButtonBorder: "#177a41",
		successButtonText: "#eafff2",
		successButtonShadow:
			"inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 6px rgba(0, 0, 0, 0.35)",

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
		// way it did on clickable boxes before that got fixed -- tinted dark/blue
		// instead, so it reads the same way a glow should: visible
		// against whatever's behind it.
		glow: "rgba(50, 60, 100, 0.22)",
		glowStrong: "rgba(50, 60, 100, 0.4)",
		ambientA: "rgba(120, 140, 255, 0.06)",
		ambientB: "rgba(255, 190, 120, 0.06)",
		segmentBg: "rgba(255, 255, 255, 0.7)",
		segmentBorder: "rgba(0, 0, 0, 0.08)",
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
		successBg: "rgba(230, 250, 238, 0.95)",
		successBorder: "rgba(31, 154, 83, 0.35)",
		success: "#1f9a53",
		successHover: "#177a41",
		successText: "#0c3d22",

		// The green button in light mode is flat: one lighter green, white
		// text, no bevel and no shadow. The glossy dark-mode version went
		// a heavy dark green here, with dark text that was hard to read.
		successButton: "#2fae63",
		successButtonHover: "#28a35c",
		successButtonBorder: "#2fae63",
		successButtonText: "#fff",
		successButtonShadow: "none",

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

		/* Segments: the boxes every page is built from. See .segment
		   below. --segment-blur is "none" (flat, as now) or a blur such
		   as "blur(0.75em)" for frosted glass over the background. */
		--segment-bg: ${active.segmentBg};
		--segment-border: ${active.segmentBorder};
		--segment-blur: none;

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
		--success-bg: ${active.successBg};
		--success-border: ${active.successBorder};
		--success: ${active.success};
		--success-hover: ${active.successHover};
		--success-text: ${active.successText};
		--success-button: ${active.successButton};
		--success-button-hover: ${active.successButtonHover};
		--success-button-border: ${active.successButtonBorder};
		--success-button-text: ${active.successButtonText};
		--success-button-shadow: ${active.successButtonShadow};
		--disabled: ${active.disabled};
		--disabled-text: ${active.disabledText};

		--font: ${fontStack(settings)};
		--font-size: ${Number(settings.uiFontSize) || 16}px;

		--radius: 0.75em;
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

	/* A button that can't be pressed right now (Update now without
	   Docker, Save while saving) has to look like it, or it reads as
	   broken when nothing happens. Faded, no glow, no press. */
	.glass:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2);
		background: var(--glass-bg);
	}

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
	   Coloured buttons — for the few moments that should stand out from
	   the plain glass buttons: "Installed" in the Marketplace, and "Go
	   back" / "I understand" before a third-party source is added.

	     .btn-glossy .btn-glossy-green     the safe or finished choice
	     .btn-glossy .btn-glossy-neutral   the grey, second choice

	   These lived in admin-face.js until the Marketplace started using
	   them too. A basic button belongs with the other basic buttons, so
	   a later change of colours or style reaches every page at once.

	   The green reads its own set of variables (--success-button-*),
	   not --success, so making the button calmer never dims "good"
	   status text or a switch that's turned on.
	   --------------------------------------------------------------- */
	.btn-glossy {
		appearance: none;
		-webkit-appearance: none;
		display: inline-block;
		padding: 0.7857em 1.5714em;
		border-radius: 0.5714em;
		font-size: 0.875em;
		font-family: inherit;
		font-weight: 500;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		border: 1px solid var(--glass-border);
		box-shadow: inset 0 1px 0 var(--glass-sheen), 0 2px 6px rgba(0, 0, 0, 0.35);
	}

	/* A plain ring for the keyboard, like every other button */
	.btn-glossy:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--glow-strong);
	}

	.btn-glossy:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-glossy-green {
		color: var(--success-button-text);
		background: var(--success-button);
		border-color: var(--success-button-border);
		box-shadow: var(--success-button-shadow);
	}

	.btn-glossy-green:hover:not(:disabled) { background: var(--success-button-hover); }

	.btn-glossy-neutral {
		color: var(--fg);
		background: linear-gradient(to bottom, var(--disabled-text), var(--disabled));
	}

	.btn-glossy-neutral:hover:not(:disabled) {
		background: linear-gradient(to bottom, var(--disabled-text), var(--border));
	}

	/* ---------------------------------------------------------------
	   Toolbar — one row of controls for a list: a search box, a
	   Modules / Themes switch, a quiet count. The search box takes the
	   room that's left; everything else keeps its own size. On a narrow
	   screen the row wraps rather than squeezing the search box.

	   Only the layout. Put it on a .segment to get the box:

	     <div class="segment toolbar">
	       <input type="text" placeholder="Search">
	       <div class="tabs">...</div>
	       <span class="toolbar-note">9 items</span>
	     </div>
	   --------------------------------------------------------------- */
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1em;
	}

	.toolbar > input {
		flex: 1 1 14em;
		width: auto;
		min-width: 0;
		margin: 0;
	}

	.toolbar-note {
		color: var(--fg-muted);
		font-size: 0.85em;
		white-space: nowrap;
	}

	/* ---------------------------------------------------------------
	   Segment — the box every page is built from: each box in the bento of
	   Settings, the wizard's halves, a face in the welcome list, a
	   marketplace listing, a row in the font picker.

	   This used to be three near-identical rules with three names:
	   .card here, .tile in admin-face.js, and another .tile in
	   wizard-face.js, each with the same colour, border and corners
	   and slightly different padding. One rule now, so changing how a
	   box looks -- its colour, its corners, frosted glass -- is a change
	   in this one place.

	   Two kinds:
	     .segment             a container. Nothing happens on hover.
	     .segment.clickable   the whole box is a link or button. Glows
	                          (dark) or lifts (light) on hover, like
	                          every other clickable thing.

	   Frosted glass is --segment-blur, set with the other variables at
	   the top. A word of warning for when it's turned on: a blurred box
	   becomes the frame for anything inside it with position: fixed.
	   A pop-up (.modal-backdrop) has to sit outside every segment, or
	   it would cover only its own box instead of the whole screen.
	   --------------------------------------------------------------- */
	.segment {
		background: var(--segment-bg);
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		padding: 1.25em;
		backdrop-filter: var(--segment-blur);
		-webkit-backdrop-filter: var(--segment-blur);
	}

	.segment.clickable {
		cursor: pointer;
		transition: box-shadow 0.25s ease, transform 0.25s ease,
			background 0.25s ease;
	}

	${
		lightMode
			? `/* Light mode: a clickable segment lifts slightly rather than
	   glowing — a glow reads as nothing against a pale background. */
	.segment.clickable:hover,
	.segment.clickable:focus-visible {
		transform: scale(1.02);
		background: var(--glass-bg-hover);
	}`
			: `/* Dark mode: a clickable segment glows rather than moving —
	   motion is unnecessary when light alone reads clearly against
	   black. Values taken from working reference examples rather than
	   a first guess: a visible glow sits close to 0.5 alpha at its
	   core, not 0.1-0.25. */
	.segment.clickable:hover,
	.segment.clickable:focus-visible {
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
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		padding: 1em 2em;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	/* Without this, a list holding more than fits its max-height squeezes
	   every row below its own content height rather than scrolling --
	   flex children shrink by default. That's what clipped the text in
	   every row of the per-face Modules page. */
	.list > * { flex-shrink: 0; }

	.list::-webkit-scrollbar { width: 8px; }
	.list::-webkit-scrollbar-track { background: transparent; }
	.list::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
	}

	/* A clickable .segment used as a single-line row inside a .list -- name on
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
		background: var(--segment-bg);
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

	/* With the button in the top-left corner, every page starts below
	   it instead of under it -- otherwise it sits on top of the page's
	   title. Room for the button (1.5em from the top, 3.4em tall) plus a
	   gap the same size as the one above it.

	   One rule for every page OmniCore draws, whatever each page's own
	   padding is: :has() asks "does this body contain a top-left back
	   button?", and that question outranks a plain body { padding }
	   wherever it's written. A browser too old to know :has() just
	   doesn't reserve the room -- the page looks exactly as it did
	   before.

	   Bottom-right gets the same at the bottom. A page scrolled all the
	   way down would otherwise end with its last segment under the button
	   -- and the last segment is often the one with a button of its own
	   (Remove from this face). */
	body:has(> .floating.top-left) { padding-top: calc(1.5em + 3.4em + 1.5em); }
	body:has(> .floating.bottom-right) { padding-bottom: calc(1.5em + 3.4em + 1.5em); }

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
		border-radius: 999em;
		background: var(--segment-border);
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
		background: var(--segment-bg);
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		padding: 0.1875em;
		gap: 3px;
	}

	.tab-btn {
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		border: none;
		border-radius: calc(var(--radius) - 0.1974em);
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

	   Used where a control needs more room than its segment can give it
	   without the segment growing and shoving the rest of the layout
	   around: the font picker's results list, the location search.
	   Centred rather than anchored under whatever opened it, since a
	   segment's position varies with the layout and an anchored panel
	   would clip at the screen edge.
	   --------------------------------------------------------------- */
	/* ---------------------------------------------------------------
	   Form primitives.

	   These lived only in admin-face.js until the wizard was rebuilt on
	   this library and turned out to need every one of them -- labels,
	   inputs, .field, .help and the rest. Copying them into the wizard
	   would have recreated exactly the duplicate-stylesheet problem
	   that rebuild existed to remove, so they moved here instead, where
	   both faces read one copy.
	   --------------------------------------------------------------- */
	h1 { font-weight: 300; font-size: 1.75em; margin: 0; }
	.lede { color: var(--fg-muted); font-size: 0.875em; margin: 0.6em 0 0 0; }

	label {
		display: block;
		font-size: 0.875em;
		color: var(--fg-muted);
		margin-bottom: 8px;
	}

	.field { margin-bottom: 20px; }
	.help { font-size: 0.75em; color: var(--fg-muted); margin-top: 6px; }
	.hint { font-size: 0.75em; color: var(--fg-muted); display: block; }
	.empty { color: var(--fg-muted); font-size: 0.875em; }

	input[type="text"],
	input[type="url"],
	input[type="number"],
	input[type="password"],
	select {
		width: 100%;
		box-sizing: border-box;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 0.625em;
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		padding: 0.75em 1em;
	}

	input[type="checkbox"] { width: 18px; height: 18px; }

	input[type="color"] {
		width: 100%;
		height: 46px;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 0.625em;
		padding: 0.25em;
		cursor: pointer;
	}

	/* A dropdown's own popup falls back to the browser's colours unless
	   told otherwise, which means white on white in a dark interface */
	option {
		background: var(--bg);
		color: var(--fg);
	}

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0.6579em 1.0526em;
		border: 1px solid var(--border);
		border-radius: 0.6579em;
		margin-bottom: 8px;
		cursor: pointer;
		font-size: 0.95em;
	}

	.option:hover { background: var(--hover-subtle); }
	.option input { width: 17px; height: 17px; }

	/* The widget type picker: one button per widget type a module offers
	   (Month View, Agenda View...), at the top of an instance's settings.
	   Shaped like the option rows above so it reads as part of the same
	   form, but laid out as a grid, since it's a pick-one row of named
	   choices rather than a list. Only shown for a module that actually
	   offers a choice. */
	.widget-picker {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
	}

	.widget-choice {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		text-align: left;
		font-family: inherit;
		font-size: 0.95em;
		color: var(--fg);
		background: var(--segment-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.6579em;
		padding: 0.7895em 0.9211em;
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.widget-choice:hover { background: var(--hover-subtle); }

	.widget-choice.active {
		background: var(--glass-bg-hover);
		border-color: var(--glass-border);
		box-shadow: inset 0 1px 0 var(--glass-sheen), 0 0 0 1px var(--glass-border);
	}

	.widget-choice:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--glow-strong);
	}

	.widget-choice strong { display: block; font-weight: 500; }

	.widget-choice small {
		display: block;
		color: var(--fg-muted);
		font-size: 0.8em;
		margin-top: 3px;
	}

	/* A setting that belongs to a widget type other than the one picked.
	   Hidden with a class, not style.display, so it can't fight with a
	   field that's hidden because of another field's value (showWhen). */
	.widget-off { display: none !important; }

	.search-row { display: flex; gap: 8px; }
	.search-row input { flex: 1; }

	.result {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--input-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.5714em;
		color: var(--fg);
		font-size: 0.875em;
		font-family: inherit;
		padding: 0.7143em 1em;
		margin-top: 8px;
		cursor: pointer;
	}

	.result:hover { background: var(--segment-border); }

	/* No min-height and no margin-top of its own -- the body's flex
	   gap between its children already provides spacing here. This is
	   exactly as tall as whatever text it holds, no taller, and
	   collapses entirely rather than reserving space for a message
	   that, most of the time, is never going to appear. */
	.status { font-size: 0.875em; }
	.status.good { color: var(--success); }
	.status.bad { color: var(--danger); }
	.status:empty { display: none; }

	/* ---------------------------------------------------------------
	   Step dock — the wizard's navigation, floating at the bottom.

	   One continuous capsule rather than separate pill buttons sitting
	   inside a larger pill: these are three distinct actions, not a
	   "pick one and see it highlighted" choice, so nothing in here is
	   ever filled in or marked active the way a tab would be. The only
	   separation is a thin rule between labels.

	   The capsule's width doesn't change with how many sections are in
	   it -- two or three, the outer shape is identical and the
	   sections inside redistribute. A control that resizes depending
	   on which step you're on would make the whole page feel like it's
	   shifting underfoot while moving through a wizard.
	   --------------------------------------------------------------- */
	/* Sits in the page's own flow rather than floating over it. Floating
	   meant reserving bottom padding and trusting no content ever grew
	   past it -- a bet that lost the moment a step's content was taller
	   than expected and slid underneath. In flow, overlapping is not a
	   thing that can happen. */
	.dock {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 999em;
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			0 4px 20px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);

		/* Deliberately NOT overflow: hidden. That would clip each
		   section neatly to the pill, but it clips the hover glow too,
		   cutting off the very thing that makes these read as the same
		   buttons used everywhere else. The end sections carry the
		   radius themselves instead, below. */

		/* Portrait: spans the screen with a comfortable margin either
		   side. Landscape: a settled width rather than stretched across
		   a wide monitor, where a navigation control the full width of
		   the screen would be absurd. */
		width: calc(100vw - 3em);
		max-width: 26em;
	}

	@media (orientation: landscape) {
		.dock { width: 30em; max-width: 30em; }
	}

	.dock button {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		flex: 1 1 0;
		background: transparent;
		border: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.95em;
		padding: 1em 0.5em;
		cursor: pointer;
		transition: background 0.15s ease, box-shadow 0.2s ease;
	}

	/* The same light sheen across the top that .glass has. A section
	   can't use .glass itself -- that carries its own border, radius
	   and background, which would draw a separate button inside the
	   capsule rather than a section of it -- so the glass treatment is
	   applied to the section directly. */
	.dock button::before {
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

	/* The same three-layer treatment .glass uses, so a dock section
	   glows exactly like every other button in OmniCore rather than
	   approximating it. The last layer is the halo -- outward, not
	   inset: an inset shadow of the same size reads as a dark vignette,
	   which is the opposite of a glow. */
	.dock button:hover,
	.dock button:focus-visible {
		background: var(--glass-bg-hover);
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2),
			0 0 30px var(--glow-strong);
	}

	/* The divider, drawn as a left border on every section after the
	   first -- so it only ever appears BETWEEN labels, and a capsule
	   with two sections gets exactly one, with no extra work. */
	.dock button + button { border-left: 1px solid var(--glass-border); }

	/* What overflow: hidden used to do, without clipping the glow. The
	   sheen (::before) needs the same radius as its button, not just
	   the button itself -- the sheen is a sharp-cornered rectangle by
	   default, and with nothing clipping it any more, a square corner
	   sitting inside a now-rounded button pokes out past the edge. That
	   stray corner, catching the light from the sheen gradient, is
	   exactly the odd bright patch this was producing. */
	.dock button:first-child,
	.dock button:first-child::before {
		border-top-left-radius: 999em;
		border-bottom-left-radius: 999em;
	}

	.dock button:last-child,
	.dock button:last-child::before {
		border-top-right-radius: 999em;
		border-bottom-right-radius: 999em;
	}

	.dock button:focus-visible { outline: none; }

	/* ---------------------------------------------------------------
	   A list that fills the height it's given rather than stopping at
	   a fixed one.

	   The plain .list above caps at 60vh, which is right when a list
	   sits inside a segment that's only as tall as its own content. In a
	   segment that's been stretched to fill the screen, that same cap
	   would leave a short scrolling list marooned in a tall empty box.
	   This one grows to whatever its parent gives it and only starts
	   scrolling once it genuinely runs out.
	   --------------------------------------------------------------- */
	.list-fill {
		flex: 1 1 0;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6em;
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		padding: 1em;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.list-fill::-webkit-scrollbar { width: 8px; }
	.list-fill::-webkit-scrollbar-track { background: transparent; }
	.list-fill::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
	}

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
		border-radius: 0.2885em;
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
		border-radius: 0.5em;
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

module.exports = { uiStyles, backButton, fontStack, fontFace, PALETTES, SYSTEM_FONT };