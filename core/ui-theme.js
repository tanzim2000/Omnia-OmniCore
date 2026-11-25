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
//
// EVERY PAGE, ONLY THESE ELEMENTS (since 2.0.0)
//
// No page OmniCore draws keeps a look of its own: every element a page
// needs is made here, described in docs/ui-elements.js, and reused by
// every page that needs one like it. test/central-theme.test.js checks
// it. The one exception is Face:1303 (the About face), which has its own.
// Things that carry their look onto a theme's page (the status drawer,
// the takeover, notifications, the page fade) are here too, in the
// overlay bundle near the end, since a theme's page doesn't load the rest.
//
// A BASE, AND MODIFIERS THAT ONLY ADD
//
// A variant of an element is always the element itself plus a modifier
// class that adds only what's different, never a copy of it:
//
//     .glass           the button
//     .glass.small     the same button, smaller
//
// <button class="glass small"> is a glass button first. Change .glass (its
// colour, its corners) and every small one changes with it; only the size
// stays the small one's own. Values two elements must share (a row's
// padding) are one variable used by both. Each entry in the catalogue says
// which base it builds on.

const { AsyncLocalStorage } = require("node:async_hooks");
const { readSettings } = require("./settings-store");
const backdrop = require("./backdrop");
const pageMotion = require("./page-motion");

// ---------------------------------------------------------------------
// Light or dark: chosen per BROWSER, not per install
//
// Before v1.19.2 this was one setting for the whole server, so picking
// light on a phone turned the TV's input face light too. Now each
// browser keeps its own choice in a small cookie, and a browser that
// has never chosen follows its device (the system's own light/dark
// setting). Cookies belong to the address, not the port, so the one
// cookie covers every OmniCore page this browser opens on this server.
//
// The cookie is set by the page itself (see UI_MODE_SCRIPT below) and
// only read here. Anything other than exactly "light" or "dark" is
// treated as no choice at all, so a hand-edited cookie can't put
// arbitrary text into the stylesheet.
const UI_MODE_COOKIE = "omnicore_ui_mode";

function uiModeFromRequest(req) {
	const header = (req && req.headers && req.headers.cookie) || "";

	for (const part of header.split(";")) {
		const [name, value] = part.trim().split("=");

		if (name === UI_MODE_COOKIE && (value === "light" || value === "dark")) {
			return value;
		}
	}

	return null;
}

// Every page calls uiStyles() deep inside its own rendering code, far
// from the request that asked for it. Rather than pass the request down
// through every one of those calls, each web server runs this once per
// request (app.use(rememberUiMode)), and uiStyles() asks for "the mode
// of whichever request I'm being drawn for". AsyncLocalStorage is
// Node's own tool for exactly that: a value that follows one request
// through all the code it runs, including across awaits, without
// leaking into any other request running at the same time.
const requestMode = new AsyncLocalStorage();

function rememberUiMode(req, res, next) {
	requestMode.run(uiModeFromRequest(req), next);
}

// "light", "dark", or null for "follow the device". Outside a request
// (tests, mostly) it's null.
function currentUiMode() {
	const mode = requestMode.getStore();
	return mode === "light" || mode === "dark" ? mode : null;
}

// Sets this browser's choice and reloads so the page redraws in it.
// Shared by the Appearance tile and the switch on the sign-in page.
// "device" forgets the choice, so the device decides again.
const UI_MODE_SCRIPT = `
	function setUiMode(mode) {
		const name = ${JSON.stringify(UI_MODE_COOKIE)};

		if (mode === "light" || mode === "dark") {
			// A year; a browser that's still in use renews it each time
			// the mode is changed
			document.cookie = name + "=" + mode +
				"; Path=/; Max-Age=31536000; SameSite=Lax";
		} else {
			document.cookie = name + "=; Path=/; Max-Age=0; SameSite=Lax";
		}

		// The background fades from this mode's to the other's
		// (backdrop.js) rather than vanishing as the page reloads
		if (typeof window !== "undefined" && window.omniKeepBackdrop) window.omniKeepBackdrop();
		location.reload();
	}
`;

// The system stack a fresh install uses, and the fallback behind any
// downloaded font — if a chosen font ever fails to load, the UI stays
// readable rather than falling back to something arbitrary.
const SYSTEM_FONT =
	'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Everything colour-ish lives here rather than being written inline
// anywhere, so light mode is a matter of swapping this table and
// nothing else.
// The page's own colour with nothing picked (Settings, Background,
// Default): pure black in dark mode and Beige Cream in light, since the v2
// test run. (For a while in v2 dark mode was Artist's Charcoal, #37393e,
// which looked more grey than black. Before v2, black and a light grey.)
const DEFAULT_DARK = "#000000";
const DEFAULT_LIGHT = "#eedec5";

const PALETTES = {
	dark: {
		bg: DEFAULT_DARK,
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
		// need to stay bright to read against black. Since v2 the button
		// is glass with a green tint and green words, see-through like
		// every other box and button, rather than a solid green block
		// that stood out from everything around it.
		successButton: "rgba(46, 196, 110, 0.16)",
		successButtonHover: "rgba(46, 196, 110, 0.26)",
		successButtonBorder: "rgba(62, 214, 122, 0.45)",
		successButtonText: "#86f0b2",
		successButtonShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.12)",

		disabled: "#2c2c2c",
		disabledText: "#545454"
	},
	light: {
		bg: DEFAULT_LIGHT,
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
		successButton: "rgba(31, 154, 83, 0.14)",
		successButtonHover: "rgba(31, 154, 83, 0.22)",
		successButtonBorder: "rgba(31, 154, 83, 0.45)",
		successButtonText: "#17733e",
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

	// The address carries a number that changes with every font saved, so
	// picking another font is a new address and a browser can't keep
	// drawing the old one. Required here, not at the top, so this file
	// stays free of the font service until a font is actually in use.
	const version = require("./font-service").installedFontVersion();

	return `
	@font-face {
		font-family: "${settings.uiFontFamily}";
		src: url("/ui-font.woff2?v=${version}") format("woff2");
		font-display: swap;
	}`;
}

// One palette as CSS variables. Written once here so the light and dark
// copies can't drift apart when a colour is added.
function paletteVariables(active) {
	return `
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
		   below. Frosted glass since v2: --segment-blur blurs whatever
		   is behind a segment, by --glass-blur (Settings, Background and
		   glass), and lifts its colour a little over a picture
		   (--glass-saturate). The glass values come after these, from
		   glassVariables in backdrop.js. */
		--segment-bg: ${active.segmentBg};
		--segment-border: ${active.segmentBorder};
		--segment-blur: blur(var(--glass-blur)) saturate(var(--glass-saturate));

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

		--ambient-a: ${active.ambientA};
		--ambient-b: ${active.ambientB};
	`;
}

// Over a picture or a colour: what changes with the font colour. Only
// colours that are the text's own, drawn straight on the glass (the text,
// its grey, a red or green word or icon, a green button's word); all the
// rest (every fill, edge, sheen, input box and track) is the dark set's
// glass, the same whatever the font colour.
const TEXT_COLOURS = ["fg", "fgMuted", "danger", "success", "successButtonText"];

// The palette over a picture or a colour, for white text ("dark") or
// black text ("light")
function overPicturePalette(set) {
	const palette = { ...PALETTES.dark };
	for (const key of TEXT_COLOURS) palette[key] = PALETTES[set][key];
	return palette;
}

// Just the text's own colours for white text ("dark") or black text
// ("light"), as CSS variables: fgMuted is --fg-muted, and so on
function textColourVariables(set) {
	return TEXT_COLOURS.map((key) => `--${key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())}: ${PALETTES[set][key]};`).join(" ");
}

// The few rules that differ between light and dark beyond their colours.
// `light` picks which set.
function modeRules(light) {
	if (light) {
		return `
	/* Light mode: a clickable segment lifts slightly rather than
	   glowing — a glow reads as nothing against a pale background. */
	.segment.clickable:hover,
	.segment.clickable:focus-visible {
		transform: scale(1.02);
		background-color: var(--glass-bg-hover);
	}

	/* A pop-up's shade: see .modal */
	.modal { --modal-shade: rgba(255, 255, 255, 0.4); }`;
	}

	return `
	/* Dark mode: a clickable segment glows rather than moving —
	   motion is unnecessary when light alone reads clearly against
	   black. Values taken from working reference examples rather than
	   a first guess: a visible glow sits close to 0.5 alpha at its
	   core, not 0.1-0.25. */
	.segment.clickable:hover,
	.segment.clickable:focus-visible {
		transform: none;
		box-shadow:
			inset 0 1px 0 var(--segment-edge),
			0 0 0 1px rgba(255, 255, 255, 0.55),
			0 0 32px rgba(255, 255, 255, 0.45),
			0 0 70px rgba(255, 255, 255, 0.2);
		background-color: var(--glass-bg-hover);
	}

	/* A pop-up's shade: see .modal */
	.modal { --modal-shade: rgba(8, 10, 14, 0.4); }`;
}

// Everything above, plus the components, as one stylesheet. Pages drop
// this into a <style> tag rather than each writing their own CSS.
//
// Which colours it carries:
//   - options.forceMode ("light" / "dark") wins over everything. Used
//     for mockups, and the seam an input face would use once input
//     faces can pick their own look.
//   - otherwise this browser's own choice, from its cookie.
//   - otherwise BOTH, dark first and light inside a
//     prefers-color-scheme query, so the browser picks by itself with
//     no script and no flash of the wrong colours on load.
// The Settings pages' elements (admin-face.js draws the pages): the page
// and its bento, the docked page, inset strips, the mode previews, a face's
// page, the update boxes and release notes, rows, Location, Place search
// and Saved keys, the major version box, the Background and glass pickers
// (the preview, the colour wheel, tint chips) and the Marketplace. At the very end of uiStyles, in
// the order they had when they were admin-face.js's own, so nothing
// changes which rule wins. (Written after SETTINGS_HOME_CSS below, which
// they read nothing from.)
function settingsPagesCss() {
	return `	/* ---------------------------------------------------------------
	   Settings page — every page on the admin face (port 3000) is a
	   column down the middle of the screen: body.settings-page, its
	   boxes in a .bento. Links on it are plain text, in the text colour.
	   :where() keeps these as easy to override as plain "body" and "a"
	   rules, which is what they were before 2.0.0's central theme.
	   --------------------------------------------------------------- */
	body:where(.settings-page) {
		min-height: 100vh;
		padding: 3em 1.5em;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
	}

	/* Only the sign-in and setup screens centre vertically. "safe" falls
	   back to top-aligned if content is ever taller than the screen, so
	   nothing gets cut off with no way to scroll to it. */
	body.centered { justify-content: safe center; }

	/* ---------------------------------------------------------------
	   Settings bento.

	   Everything on one screen with nothing hidden behind a tab or a
	   scroll: the page has four sections and two links, which is small
	   enough to just show. Tabs would add state to manage and a click
	   before reaching anything, to solve a problem this page does not
	   currently have. If Settings ever outgrows one screen, tabs layer
	   on top of this without rebuilding it.

	   Portrait is the same segments in one column -- not a second design.
	   --------------------------------------------------------------- */
	/* Scales with the viewport rather than a single fixed number, so a
	   wide window doesn't leave a large stripe of unused space either
	   side -- but still capped, so a genuinely ultrawide monitor
	   doesn't stretch a description line edge-to-edge or leave a
	   segment looking like mostly empty space. */
	.bento { width: 100%; max-width: clamp(62em, 70vw, 90em); display: flex; flex-direction: column; gap: 14px; }

	.bento-row { display: grid; gap: 14px; grid-template-columns: 1fr; }

	/* The boxes and their headings are .segment, from ui-theme.js. Only
	   how a description sits inside one is particular to the settings
	   pages. */
	:where(.settings-page) .segment .lede { margin: 0 0 14px 0; }

	/* A box's heading, or a line, with room under it: for one followed
	   by a list, rows or a form rather than a line of text */
	.segment .spaced { margin-bottom: 14px; }

	.settings-head {
		width: 100%;
		max-width: clamp(62em, 70vw, 90em);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
	}

	/* Mode picker: two miniature screens rather than a switch, so the
	   choice shows what it actually looks like instead of naming it */
	.mode-previews { display: flex; gap: 10px; }

	.mode-preview {
		flex: 1;
		cursor: pointer;
		border-radius: 0.625em;
		border: 1px solid var(--segment-border);
		padding: 0.5em;
		text-align: center;
		transition: border-color 0.2s ease;
	}

	.mode-preview.active { border: 2px solid var(--fg-muted); padding: 0.4375em; }
	.mode-preview-label { font-size: 0.78em; color: var(--fg-muted); margin-top: 8px; }
	.mode-preview.active .mode-preview-label { color: var(--fg); font-weight: 600; }

	.mode-screen { border-radius: 0.3125em; height: 64px; padding: 0.5em; text-align: left; }
	.mode-screen span { display: block; border-radius: 0.125em; margin-bottom: 5px; }

	/* The little screen in each: the page's colour (.dark, .light) or a
	   notification's (.note-dark, .note-light), and a few lines of
	   "text": a heading line, then shorter, fainter lines */
	.mode-screen.dark, .mode-screen-split > .dark { background: ${DEFAULT_DARK}; }
	.mode-screen.light, .mode-screen-split > .light { background: ${DEFAULT_LIGHT}; }
	.mode-screen.note-dark { background: #0c0d10; }
	.mode-screen.note-light { background: #e5e7eb; }
	.mode-screen .line { width: 70%; height: 4px; }
	.mode-screen .line.head { width: 40%; height: 5px; }
	.mode-screen .line.mid { width: 55%; }
	.mode-screen-split .line.head { width: 60%; }
	.mode-screen:is(.dark, .note-dark) > .line,
	.mode-screen-split > .dark > .line { background: rgba(255, 255, 255, 0.3); }
	.mode-screen:is(.dark, .note-dark) > .line.head,
	.mode-screen-split > .dark > .line.head { background: rgba(255, 255, 255, 0.8); }
	.mode-screen:is(.light, .note-light) > .line,
	.mode-screen-split > .light > .line { background: #9ca3af; }
	.mode-screen:is(.light, .note-light) > .line.head,
	.mode-screen-split > .light > .line.head { background: #4b5563; }

	/* Device: half dark, half light, since it's whichever the device
	   is set to */
	.mode-screen-split { display: flex; padding: 0; overflow: hidden; }
	.mode-screen-split > div { flex: 1; padding: 0.5em; }

	/* On a full-width row two previews would stretch into long strips;
	   kept to the size they are in a half-width box */
	.narrow-previews { max-width: 24em; }


	/* An inset strip inside a segment: the detected location, the current
	   font. Reads as "this is a value, not a control". */
	.inset {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		background: var(--input-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.625em;
		padding: 0.6875em 0.875em;
	}

	/* Without flex-basis a flex item won't shrink past its own content's
	   natural width by default -- backwards here, since the long value
	   is exactly the thing that should take the available space and
	   wrap sensibly, not get squeezed into a few characters per line
	   while the short button sits at whatever width is left over.
	   min-width: 0 is what actually lets it shrink at all; flex-basis
	   0 is what lets it grow to fill the row rather than sizing to its
	   unwrapped content first. */
	.inset-text { flex: 1 1 0; min-width: 0; }

	/* A small button at the end of the strip (Refresh, Change) */
	.inset > .glass { flex-shrink: 0; padding: 0.641em 1.1218em; font-size: 0.78em; }

	/* Typography: the heading and its note on the left, the size stepper
	   on the right; under them, two strips side by side, Font colour's
	   and the font's (.type-row). On a narrow screen the stepper drops
	   under the note rather than squeezing it (flex-wrap, and the text
	   keeps at least 12em), and the font's strip under the colour's. */
	.type-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 14px;
		margin-bottom: 14px;
	}
	.type-head-text { flex: 1 1 12em; min-width: 0; }
	.type-head-text .hint { margin: 0; }
	.type-head .stepper { flex-shrink: 0; }
	.type-row { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px 14px; }
	.type-row > .inset { flex: 1 1 14em; min-width: 0; }

	/* Font colour's two choices, in its strip: "Aa" in white and in black,
	   each on a piece of the background (--swatch-picture: a picture's
	   address or a colour) at its brightness, through the real glass (its
	   fill, then the tint with the Dim), so it shows how that colour reads
	   before it's picked. The one picked has a ring in the text's colour. */
	.font-swatches { display: flex; gap: 0.5em; flex-shrink: 0; }
	.font-swatch {
		position: relative;
		width: 3.2em;
		height: 2.4em;
		padding: 0;
		border: 1px solid var(--glass-border);
		border-radius: 0.6em;
		overflow: hidden;
		background: none;
		font-family: inherit;
		font-size: 1em;
		cursor: pointer;
		transition: box-shadow 0.2s ease;
	}
	.font-swatch::before,
	.font-swatch::after { content: ""; position: absolute; inset: 0; }
	/* The piece of background is clipped to the button itself: a blurred
	   layer can otherwise be drawn a little past a rounded corner by some
	   browsers, a dark line along the top */
	.font-swatch::before {
		background: var(--swatch-picture, var(--bg)) center / cover;
		filter: brightness(var(--backdrop-brightness, 1)) blur(2px);
		clip-path: inset(0);
	}
	/* Over a colour: brighter by white laid over it, as the colour behind
	   the page is (.omni-colour) */
	.font-swatches.on-colour .font-swatch::before {
		background:
			linear-gradient(rgba(255, 255, 255, var(--colour-lift, 0)), rgba(255, 255, 255, var(--colour-lift, 0))),
			var(--swatch-picture, var(--bg));
		filter: brightness(var(--colour-brightness, 1));
	}
	.font-swatch::after {
		background-color: var(--segment-bg);
		background-image: linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent));
	}
	.font-swatch > span {
		position: relative;
		z-index: 1;
		font-size: 1.3em;
		line-height: 1;
	}
	.font-swatch.white-text > span { color: #fff; }
	.font-swatch.black-text > span { color: #111; font-weight: 600; }
	.font-swatch.active { box-shadow: 0 0 0 2px var(--fg); }
	.font-swatch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--glow-strong); }
	.font-swatch.active:focus-visible { box-shadow: 0 0 0 2px var(--fg), 0 0 0 4px var(--glow-strong); }

	.inset-label { font-size: 0.7em; color: var(--fg-muted); }
	.inset-value { font-size: 0.85em; margin-top: 2px; }
	/* The coordinates after a place's name: a little apart, quieter, kept
	   together */
	.inset-value .coords { margin-left: 1.25em; color: var(--fg-muted); white-space: nowrap; }



	/* Landscape: width against height rather than a pixel threshold.
	   A phone can report more CSS pixels than an old desktop monitor,
	   so any fixed number would misjudge real devices in both
	   directions. */
	@media (orientation: landscape) {
		.bento-row.two { grid-template-columns: 1.3fr 1fr; }
		.bento-row.three { grid-template-columns: 1fr 1fr 1fr; }
	}

	/* A narrow bento, for a page that is one short form and nothing
	   else: signing in, "not found". The same segments, just not stretched
	   across a wide screen. */
	.bento.narrow { max-width: 28em; }

	/* Two segments side by side are as tall as the taller one. Lined up at
	   the top rather than stretched, a short segment next to a long form
	   would otherwise be mostly empty space. */
	.bento-row.top { align-items: start; }

	/* Two or more segments stacked in one column of a .bento-row, so a
	   column can hold a pair of segments beside one taller one (a face's
	   page: its facts and its links on the left, its name on the right) */
	.bento-column { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

	/* A face's page: two columns that end level. The grid stretches
	   both columns to the taller one's height, and the last box in each
	   takes up the difference, so neither column ends short. */
	.face-columns > .bento-column > :last-child { flex: 1; }

	/* Manage resources: the Widgets and Theme buttons, a little taller
	   than an ordinary row so the box holds its own beside the facts */
	.resources a.row { padding-top: 1.4em; padding-bottom: 1.4em; }

	/* Notifications on a face's page: the Dark and Light buttons fill
	   the box's height, so a box stretched to line up with its
	   neighbour has no empty band under them. They keep their usual
	   width (narrow-previews) and sit in the middle of the box. */
	.note-segment { display: flex; flex-direction: column; }
	.note-segment .mode-previews { flex: 1; width: 100%; margin: 0 auto; }
	.note-segment .mode-preview { display: flex; flex-direction: column; }
	.note-segment .mode-screen { flex: 1; height: auto; min-height: 64px; }

	/* Manage resources and This face, one pair of boxes (since v1.19.8).
	   This face has no heading, only Open face and Delete face.

	   Portrait (a phone held upright): the boxes stack, This face first,
	   straight under the face's facts, its buttons side by side.

	   Landscape: the boxes sit side by side, This face on the right and
	   narrower, its buttons stacked and filling its whole height, so the
	   pair ends level with Manage resources. */
	.resource-pair { display: grid; gap: 14px; grid-template-columns: 1fr; }
	.resource-pair > .segment { min-width: 0; }
	.face-actions { order: -1; display: flex; flex-direction: column; }
	.face-buttons { display: flex; gap: 0.6em; flex: 1; }
	.face-buttons > button { flex: 1; white-space: nowrap; }
	.face-actions .status { margin: 0.6em 0 0 0; }

	@media (orientation: landscape) {
		.resource-pair { grid-template-columns: 1.45fr 1fr; }
		.face-actions { order: 0; }
		.face-buttons { flex-direction: column; gap: 10px; }

		/* A phone held sideways leaves this box narrow: less padding at
		   the sides, so "Delete face" still fits on one line */
		.face-buttons > button { padding-left: 0.5em; padding-right: 0.5em; min-width: 0; }
	}

	/* A segment's last row shouldn't leave a gap under itself */
	.segment > a.row:last-child { margin-bottom: 0; }


	/* Everything a segment does at the end of a form: Save and its message,
	   and anything after it, with even space between them */
	.segment-actions { display: flex; flex-direction: column; gap: 12px; }

	/* The capsule (.dock, from the shared theme) at the foot of a page,
	   centred under the segments, with the page's status line under it */
	.page-dock {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75em;
		margin: 1.5em auto 0;
	}

	.page-dock .status { margin: 0; text-align: center; }

	/* ---------------------------------------------------------------
	   A docked page (since v1.19.9): a widget's page.

	   The page is exactly the height of the window and never scrolls
	   itself, the same as the setup wizard. The Save | Remove capsule
	   is always at the bottom, and whatever is too long scrolls inside
	   its own box instead of pushing the capsule off the screen.

	   Landscape: the widget's Settings box scrolls inside itself, and
	   the column beside it (the theme's box and Refresh) scrolls on its
	   own if it ever has to.

	   Portrait (a phone held upright): the boxes are stacked, so the
	   whole stack scrolls as one, between the name and the capsule.
	   --------------------------------------------------------------- */
	html:has(body.docked) { height: 100%; }

	body.docked {
		height: 100vh;
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
		box-sizing: border-box;
		padding-bottom: 1.5em;
		gap: 1.25em;
	}

	body.docked .bento { flex: 1 1 auto; min-height: 0; }

	/* The widget's name and description never shrink away */
	body.docked .bento > .segment:first-child { flex-shrink: 0; }

	body.docked .bento > .bento-row { flex: 1 1 auto; min-height: 0; }

	body.docked .page-dock { flex-shrink: 0; margin: 0 auto; }

	/* Thin, quiet scrollbars, like the wizard's */
	body.docked .bento > .bento-row,
	body.docked .bento-column,
	body.docked .bento-column > .segment {
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	body.docked .bento > .bento-row::-webkit-scrollbar,
	body.docked .bento-column::-webkit-scrollbar,
	body.docked .bento-column > .segment::-webkit-scrollbar { width: 8px; }

	body.docked .bento > .bento-row::-webkit-scrollbar-thumb,
	body.docked .bento-column::-webkit-scrollbar-thumb,
	body.docked .bento-column > .segment::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
	}

	@media (orientation: portrait) {
		body.docked .bento > .bento-row { overflow-y: auto; align-content: start; }
	}

	@media (orientation: landscape) {
		/* One row as tall as the space left, so the columns have a real
		   height to fill and to scroll within */
		body.docked .bento > .bento-row {
			grid-template-rows: minmax(0, 1fr);
			align-items: stretch;
		}

		body.docked .bento-column { min-height: 0; }

		/* The widget's own Settings box: the first box of the first column */
		body.docked .bento-row > .bento-column:first-child > .segment:first-child {
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
		}

		/* The theme's box and Refresh, beside it */
		body.docked .bento-row.two > .bento-column:last-child { overflow-y: auto; }
	}

	/* A phone held sideways has very little height: less space above
	   and between, so the widget's settings get as much as possible */
	@media (orientation: landscape) and (max-height: 32em) {
		body.docked { gap: 0.75em; }
		body.docked .bento { gap: 0.75em; }

		/* Unless the Back button is top left: then the room above is
		   what keeps it off the widget's name (ui-theme.js) */
		body.docked:not(:has(> .floating.top-left)) { padding-top: 1em; }
	}

	/* The Back button bottom right. Every other page keeps room under
	   itself for the button (ui-theme.js), so its last box never ends
	   up underneath. A docked page doesn't need that: the capsule is
	   always at the bottom, level with the button, so the room would
	   just be a gap under it. */
	body.docked:has(> .floating.bottom-right) { padding-bottom: 1.5em; }

	/* On a phone held upright, or any narrow window, the capsule spans
	   the screen and would sit under the button, so it leaves room for
	   the button on its right instead. Wider, the capsule is a settled
	   width in the middle and never reaches the corner. */
	@media (orientation: portrait), (max-width: 42em) {
		/* No auto margins here: they would stop the stretch and shrink
		   the capsule to the width of its two words */
		body.docked.back-br .page-dock {
			align-self: stretch;
			margin: 0;
			padding-right: calc(3.4em + 0.75em);
			box-sizing: border-box;
		}

		body.docked.back-br .page-dock .dock { width: 100%; }
	}

	/* A page whose only action is one button: it sits where the capsule
	   would, at the same width, but keeps the ordinary glass button's
	   shape -- a capsule with one section in it would just be a pill */
	.dock-button { width: calc(100vw - 3em); max-width: 26em; }

	@media (orientation: landscape) {
		.dock-button { width: 30em; max-width: 30em; }
	}

	/* Settings' About tab while an update is being installed: one line
	   saying what's happening, one quieter line under it saying what to
	   expect. The dot pulses while something is still going on. */
	.update-progress {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		background: var(--input-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.625em;
		padding: 0.875em;
		margin-top: 14px;
	}

	.update-progress-dot {
		flex: none;
		width: 10px;
		height: 10px;
		margin-top: 5px;
		border-radius: 50%;
		background: var(--fg-muted);
	}

	.update-progress.working .update-progress-dot { animation: update-pulse 1.2s ease-in-out infinite; }
	.update-progress.good .update-progress-dot { background: var(--success); }
	.update-progress.bad .update-progress-dot { background: var(--danger); }

	@keyframes update-pulse {
		0%, 100% { opacity: 0.25; }
		50% { opacity: 1; }
	}

	.update-progress strong { display: block; font-size: 0.95em; }
	.update-progress .hint { margin: 4px 0 0 0; }
	.update-progress .glass { margin-top: 12px; }



	:where(.settings-page) a { color: var(--fg); text-decoration: none; }

	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 0.875em 1.25em;
		border: 1px solid var(--border);
		border-radius: 0.75em;
		margin-bottom: 10px;
	}

	.row span { opacity: 0.55; font-size: 13px; }

	/* A row you can click (a face in the list, Widgets and Theme on a
	   face's page) is a glass button (.glass in ui-theme.js), laid out
	   as a row: the same glow, fade and press as every other button.
	   Before v2 it had its own copy of the look, which only turned grey
	   on hover. */
	.row.glass { border-color: var(--glass-border); }



	/* The About tab: Check now and Update now side by side */
	.update-buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
	.update-buttons { align-items: center; }
	.update-buttons .glass-block { flex: 1 1 12em; width: auto; margin: 0; }
	.update-buttons + .hint, .update-buttons > .glass-block + .hint { flex-basis: 100%; }

	/* Its release notes: each part side by side when there's room */
	.notes-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(20em, 1fr)); gap: 1.5em; }
	.notes-part h3 { margin: 0 0 0.6em; font-size: 1em; }

	/* The OmniCore box is a link to System info: its heading with an
	   arrow, then its facts */
	.about-box { display: block; color: var(--fg); text-decoration: none; }
	.about-box-head { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
	.about-box-head svg { color: var(--fg-muted); flex: none; }
	.about-box-head + .fact { border-top: 0; }

	/* The release notes take the room left under the two boxes above
	   (the second row of the sideways grid, settings-home.js) and scroll
	   inside it, each part on its own. A phone held upright scrolls as
	   usual. */
	@media (min-width: 42.01em) {
		html.home-tabs .release-notes {
			align-self: stretch;
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
		html.home-tabs .notes-body { flex: 1; min-height: 0; grid-auto-rows: minmax(0, 100%); overflow-y: auto; }
		html.home-tabs .notes-part { display: flex; flex-direction: column; min-height: 0; }
		html.home-tabs .notes-part .changelog { flex: 1; min-height: 0; max-height: none; }
	}

	/* Location Service's own boxes, under "Set it myself" */
	.location-manual { margin-top: 14px; }
	.update-ready { color: var(--fg); }

	/* Place search: what's chosen won't work as it reads */
	.place-warning {
		margin: 12px 0 0;
		padding: 0.7em 0.9em;
		border-radius: 0.6em;
		background: var(--well-bg);
		border: 1px solid var(--segment-border);
		color: var(--fg);
		font-size: 0.9em;
		line-height: 1.5;
	}

	/* Saved keys: the service and "API key saved", Change and Remove */
	.saved-key {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.6em 1em;
		padding: 0.75em 0;
		border-top: 1px solid var(--segment-border);
	}
	.saved-key-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.saved-key-text span { color: var(--fg-muted); font-size: 0.85em; }
	.saved-key-buttons { display: flex; gap: 0.5em; }
	.saved-key-buttons .glass { padding: 0.6em 1.1em; }




	/* Explanatory text under a control — quieter than the label it
	   belongs to, for the "why" rather than the "what" */
	/* A new major version (since 1.20.0): a box on the settings home
	   that opens what's changing. The whole box is the button. */
	.major-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
		width: 100%;
		text-align: left;
		font: inherit;
		color: var(--fg);
	}
	.inset.major-box {
		margin: 0.4em 0 0.9em;
		cursor: pointer;
		transition: border-color 0.3s ease, box-shadow 0.3s ease, background-color 0.3s ease;
		box-shadow: 0 0 0 1px transparent, 0 0 24px transparent;
	}
	.inset.major-box:hover,
	.inset.major-box:focus-visible {
		outline: none;
		border-color: var(--glass-border);
		box-shadow: 0 0 0 1px var(--glass-border), 0 0 24px rgba(255, 255, 255, 0.08);
	}
	.major-box-text { display: flex; flex-direction: column; gap: 4px; }
	.major-box-text strong { font-size: 1.05em; }
	.major-box-text span { color: var(--fg-muted); font-size: 0.9em; }
	.major-box-go { font-size: 1.4em; color: var(--fg-muted); flex-shrink: 0; }

	/* Its pop-up: wider and taller than the others, the document
	   scrolling inside it, Upgrade below it */
	.modal.major-modal { max-width: 46em; max-height: 88vh; }
	.major-doc {
		flex: 1;
		min-height: 8em;
		overflow-y: auto;
		padding-right: 0.75em;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
		line-height: 1.55;
	}
	.major-doc > :first-child { margin-top: 0; }
	.major-doc h3 { font-size: 1em; margin: 1.3em 0 0.4em; }
	.major-doc h4 { font-size: 0.95em; margin: 1.1em 0 0.3em; color: var(--fg-muted); }
	.major-doc p, .major-doc li, .major-doc blockquote { font-size: 0.92em; }
	.major-doc blockquote { margin: 0.8em 0; padding-left: 0.9em; border-left: 3px solid var(--glass-border); color: var(--fg-muted); }
	.major-doc pre { overflow-x: auto; padding: 0.7em 0.9em; border-radius: 0.5em; background: var(--glass-bg); font-size: 0.85em; }
	.major-doc a { color: inherit; }
	.major-doc .major-ours { margin-top: 1.6em; padding-top: 0.4em; border-top: 1px solid var(--glass-border); }
	.major-actions { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }

	/* Upgrade, while it can't be pressed: it looks off, and its title
	   (on hover) says why. Not the disabled attribute, because a disabled
	   button shows no title in most browsers. */
	.glass.is-off { opacity: 0.45; cursor: not-allowed; }
	.glass.is-off:hover, .glass.is-off:focus-visible { box-shadow: none; }

	/* On a phone there's no hover, so the reason is written under it */
	.major-actions .major-why { display: none; margin: 0; text-align: center; }
	@media (max-width: 42em) {
		.major-actions .major-why { display: block; }
		.modal.major-modal { max-height: 92vh; padding: 1.1em; }
	}

	/* Release notes scroll inside their own segment rather than making
	   the page as long as the longest changelog: the version and its
	   buttons beside them stay in view. As tall as the window allows,
	   never shorter than a comfortable read. */
	.changelog {
		max-height: max(18em, calc(100vh - 20em));
		overflow-y: auto;
		padding-right: 0.75em;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.changelog::-webkit-scrollbar { width: 8px; }
	.changelog::-webkit-scrollbar-track { background: transparent; }
	.changelog::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 0.25em; }

	.changelog > :first-child { margin-top: 0; }

	.changelog h3 { font-size: 14px; margin: 16px 0 6px 0; opacity: 0.75; }
	.changelog ul { margin: 0; padding-left: 1.25em; }
	.changelog li { font-size: 14px; line-height: 1.65; margin-bottom: 8px; }
	.changelog p { font-size: 14px; line-height: 1.65; }
	.changelog strong { font-weight: 600; }
	/* A name written between backticks in the notes */
	.changelog code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.9em;
		padding: 0.1em 0.35em;
		border-radius: 0.3em;
		background: var(--glass-bg);
		border: 1px solid var(--segment-border);
	}



	/* Installed Resources: what's installed, and how current it is.
	   Each one is a plain .segment -- not clickable, so no hover glow. */

	.resource-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 13px;
		color: var(--fg-muted);
	}

	.resource-status.good { color: var(--success); }
	.resource-status.bad { color: var(--danger); }

	/* The search box in the font picker */
	.font-search {
		width: 100%;
		padding: 0.8571em 1.1429em;
		border: 1px solid var(--border);
		border-radius: 0.7143em;
		background: transparent;
		color: var(--fg);
		font-size: 14px;
		font-family: inherit;
		box-sizing: border-box;
	}

	.font-search::placeholder { color: var(--fg-muted); }
	.font-search:focus { outline: none; border-color: var(--glass-border); }
	/* .glass itself is defined once, in core/ui-theme.js. It used to be
	   redefined here too, from before the shared component library
	   existed, and because this stylesheet is emitted after that one the
	   stale copy silently won -- overriding the appearance reset, the
	   hover glow, :focus-visible and the disabled styling with an older
	   and worse version of each.
	   
	   The real damage was a width of 100% in that copy. Harmless for a
	   standalone button, but a small button sitting in a flex row next
	   to text would try to occupy the entire row and render on top of
	   it. Every full-width button below now says so explicitly with
	   .glass-block instead of relying on a global default that also hit
	   buttons which should never have been full width. */
	.glass-block { display: block; width: 100%; box-sizing: border-box; text-align: center; }

	/* A medium button: between the full size and .small (Search beside a
	   search box, Save location) */
	.glass.medium { padding: 0.75em 1.25em; }
	.search-row > .glass { flex: none; }

	/* Two fields side by side, each half the row (Latitude, Longitude) */
	.field.pair { display: flex; gap: 12px; }
	.field.pair > * { flex: 1; }

	/* The font picker: each font's name in its own font (--sample-font,
	   set on the name) */
	.font-row strong { font-family: var(--sample-font, inherit); }
	/* The Background and glass page: what's behind these pages now */
	.backdrop-preview {
		aspect-ratio: 16 / 10;
		border-radius: 0.6em;
		overflow: hidden;
		border: 1px solid var(--segment-border);
		margin: 4px 0 8px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.backdrop-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }

	/* The preview, with the back button drawn in its corner */
	/* The preview is a button: it opens Change background. It dims on
	   hover (or keyboard focus) and says so; on a touch screen, with no
	   hover, a small "Change" label sits in its top right corner. */
	.backdrop-stage {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: 0.6em;
	}
	.backdrop-stage .backdrop-preview { display: flex; }
	.backdrop-stage:focus-visible { outline: 2px solid var(--glow-strong); outline-offset: 2px; }
	.change-label {
		position: absolute;
		inset: 4px 0 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.6em;
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		font-weight: 600;
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}
	.backdrop-stage:hover .change-label,
	.backdrop-stage:focus-visible .change-label { opacity: 1; }
	@media (hover: none) {
		/* The words are swapped for one: "Change background" is too long
		   for a corner */
		.change-label {
			opacity: 1;
			inset: calc(4px + 0.6em) 0.6em auto auto;
			padding: 0.2em 0.6em;
			border-radius: 0.5em;
			font-size: 0;
		}
		.change-label::before { content: "Change"; font-size: 0.75rem; }
	}

	/* A colour behind the pages, or the Default, in the preview (the
	   colour is --colour, set on it). The picture or colour at the
	   brightness picked, as it is behind the page: a colour brighter by
	   white laid over it. */
	.preview-colour {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(rgba(255, 255, 255, var(--colour-lift, 0)), rgba(255, 255, 255, var(--colour-lift, 0))),
			var(--colour);
		filter: brightness(var(--colour-brightness, 1));
	}
	.backdrop-preview img { filter: brightness(var(--backdrop-brightness, 1)); }
	.preview-default { background: var(--bg); filter: none; }

	/* Change background: a wider pop-up, its preview with a piece of glass
	   on it to judge the text by, the three choices and the colour wheel */
	.modal.modal-wide { max-width: 40em; max-height: 92vh; overflow-y: auto; }

	/* Frosted glass: the Tint colours on a row of their own, then the
	   sliders two to a row (Blur and Tint strength, then brightness and
	   Dim), so the box stays short enough to leave the row under it the
	   room it needs. One to a row on a phone held upright. */
	.glass-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 1.75em;
		align-items: start;
	}
	@media (max-width: 42em) {
		.glass-fields { grid-template-columns: minmax(0, 1fr); }
	}
	.glass-fields > .field { margin-bottom: 0.9em; min-width: 0; }
	.glass-fields > .wide-field { grid-column: 1 / -1; }

	.bg-preview {
		position: relative;
		aspect-ratio: 16 / 7;
		border-radius: 0.6em;
		overflow: hidden;
		border: 1px solid var(--segment-border);
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.bg-preview-colour, .bg-preview img { position: absolute; inset: 0; width: 100%; height: 100%; }
	/* What's behind (--colour), at the brightness it would start at
	   (--preview-brightness), from the pop-up's script as the choice
	   changes */
	.bg-preview-colour { background: var(--colour, transparent); }
	.bg-preview-colour, .bg-preview img { filter: brightness(var(--preview-brightness, 1)); }
	.bg-preview img { object-fit: cover; }
	/* A piece of glass on it, as Auto would make it over that background:
	   its fill, its tint with the Dim (--card-fill, --card-tint), its blur
	   and its text colour, from the same script */
	.bg-preview-card {
		position: relative;
		padding: 0.6em 1em;
		border-radius: 0.6em;
		border: 1px solid var(--segment-border);
		background-color: var(--card-fill, var(--segment-bg));
		background-image: linear-gradient(var(--card-tint, transparent), var(--card-tint, transparent));
		backdrop-filter: blur(var(--card-blur, 12px));
		-webkit-backdrop-filter: blur(var(--card-blur, 12px));
		color: var(--card-fg, var(--fg));
		font-size: 0.9em;
	}

	.bg-tabs { display: flex; }
	.bg-tabs .tab-btn { flex: 1; }
	.bg-pane .hint { margin: 0 0 0.6em; line-height: 1.5; }
	.bg-pane .buttons { margin-bottom: 4px; }
	.bg-pane .buttons .glass { padding: 0.65em 1.2em; }

	.wheel-row { display: flex; gap: 1.25em; align-items: center; justify-content: center; flex-wrap: wrap; }
	.wheel {
		position: relative;
		width: 220px;
		height: 220px;
		flex: none;
		border-radius: 50%;
		touch-action: none;
		cursor: crosshair;
		outline: none;
	}
	.wheel:focus-visible { box-shadow: 0 0 0 3px var(--glow-strong); }
	/* Darker as Brightness goes down (--brightness, 0.15 to 1) */
	.wheel canvas { width: 100%; height: 100%; display: block; border-radius: 50%; filter: brightness(var(--brightness, 1)); }
	/* Where the colour is on the wheel (--knob-x, --knob-y) and the colour
	   itself (--colour), from the script */
	.wheel-knob {
		position: absolute;
		left: var(--knob-x, auto);
		top: var(--knob-y, auto);
		background: var(--colour, transparent);
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
	.wheel-side { flex: 1 1 12em; min-width: 0; display: flex; flex-direction: column; gap: 0.25em; }
	.swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
	.swatch {
		background: var(--colour);
		width: 1.9em;
		height: 1.9em;
		border-radius: 50%;
		border: 1px solid var(--glass-border);
		padding: 0;
		cursor: pointer;
	}
	.swatch:hover, .swatch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--glow-strong); }

	/* A glass slider's label, with what's at the other end of its line (a
	   Pinned badge, Auto leaving it alone). The box's one Auto, a switch
	   with its word, in the box's head. A warning when the text may be
	   hard to read, in the text's own colour. */
	.slider-head { display: flex; align-items: center; justify-content: space-between; gap: 1em; min-height: 1.6em; }
	.slider-head .badge { margin-left: 0; }
	.auto-switch { display: inline-flex; align-items: center; gap: 0.5em; font-size: 0.85em; color: var(--fg-muted); cursor: pointer; }
	.glass-warning { color: var(--fg); }
	.corner-mark {
		position: absolute;
		width: 2em;
		height: 2em;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85em;
		color: var(--fg);
		border: 1px solid var(--glass-border);
		/* The same glass as the real button: its fill, tint and Dim, so
		   its arrow reads as it does there */
		background-color: var(--segment-bg);
		background-image: linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent));
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
		pointer-events: none;
	}
	.corner-mark-top-left { top: 0.75em; left: 0.75em; }

	/* "A video", say, in the preview's bottom left corner */
	.backdrop-preview { position: relative; }
	.preview-kind {
		position: absolute;
		left: 0.6em;
		bottom: 0.6em;
		padding: 0.15em 0.55em;
		border-radius: 0.5em;
		font-size: 0.72em;
		color: #fff;
		background: rgba(0, 0, 0, 0.45);
	}
	.corner-mark-bottom-right { bottom: 1.25em; right: 0.75em; }

	/* Background's Back button switch: two halves, the width of the box */
	.back-corner { margin-top: 10px; }
	.back-corner .tabs { display: flex; }
	.back-corner .tab-btn { flex: 1; }
	.backdrop-preview.plain { background: var(--bg); color: var(--fg-muted); font-size: 0.9em; }

	/* Its tint choices: None, Match the picture, a few colours, a picker */
	.tint-chips { display: flex; flex-wrap: wrap; gap: 8px; }

	.tint-chip {
		appearance: none;
		-webkit-appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 2.4em;
		height: 2.4em;
		padding: 0 0.7em;
		border-radius: 1.2em;
		border: 1px solid var(--segment-border);
		background: var(--glass-bg);
		color: var(--fg);
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
		position: relative;
	}

	.tint-chip:disabled { opacity: 0.35; cursor: default; }
	.tint-chip.active { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
	.tint-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--glow-strong); }

	.tint-swatch {
		background: var(--colour);
		width: 1.1em;
		height: 1.1em;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.35);
		flex: none;
	}

	/* A chip that's only a colour has no words: the swatch fills it */
	.tint-chip:not(:has(span:not(.tint-swatch))) { padding: 0; justify-content: center; }

	/* The picker: the browser's own colour box, made round */
	.tint-custom input[type="color"] {
		appearance: none;
		-webkit-appearance: none;
		width: 1.4em;
		height: 1.4em;
		border: none;
		border-radius: 50%;
		padding: 0;
		background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
		cursor: pointer;
	}

	.tint-custom input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
	.tint-custom input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
	.tint-custom { padding: 0; justify-content: center; }


	/* ---------------------------------------------------------------
	   Marketplace.

	   Every Marketplace page is a column of segments, like Settings, only
	   wider: the home page needs room for up to three columns of listings
	   on a big screen. The page itself scrolls. Nothing scrolls inside a
	   box any more -- that clipped the hover glow, and on a phone it meant
	   scrolling inside a scroll.
	   --------------------------------------------------------------- */
	.market {
		width: 100%;
		max-width: 100em;
		display: flex;
		flex-direction: column;
		gap: 1em;
	}

	/* Pages that are mostly reading (a listing's own page, Sources): a
	   line of text much wider than this gets hard to follow */
	.market.reading { max-width: 62em; }

	/* The header: title and a line or two under it on the left, the
	   page's one button on the right. On a phone the button drops under
	   the text rather than squeezing it. */
	.market-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1em;
	}

	.market-head > div { flex: 1 1 20em; min-width: 0; }
	.market-head .lede { max-width: 40em; margin-top: 0.4em; }

	/* The last line in a box needs no space under it -- the box's own
	   padding already gives it room */
	.market .segment .lede:last-child { margin-bottom: 0; }

	/* The search, the Modules / Themes switch and the count: pinned at
	   the top while the listings scroll under it. Frosted glass like
	   every other box (since v2: before, a fill of its own, mostly the
	   page's black). The blur is never less than 16px here, so the
	   listings passing underneath stay a smudge and never collide with
	   the search text, even with the blur turned down in Settings. */
	.market-toolbar {
		position: sticky;
		top: 1em;
		z-index: 5;
		backdrop-filter: blur(max(var(--glass-blur), 16px)) saturate(var(--glass-saturate));
		-webkit-backdrop-filter: blur(max(var(--glass-blur), 16px)) saturate(var(--glass-saturate));
	}

	/* As many columns as fit, each at least 30em wide: one on a phone, two
	   on a laptop, three on a wide screen. .market's max-width is what
	   stops a fourth. min() keeps one column from being wider than a
	   narrow phone screen. Measured in em, so a bigger text size in
	   Settings means fewer, wider columns. */
	.market-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(30em, 100%), 1fr));
		gap: 1em;
	}

	/* One listing: name, author and description on the left, its button
	   on the right. The box is a .segment.clickable. */
	.market-item {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
	}

	.market-item-text { flex: 1; min-width: 0; }

	/* A listing's icon: its own picture (an entry's \`icon\` in the
	   registry, since 2.0.0) or, without one, a tile in a colour of its
	   own with its first letter. Under the link stretched over the
	   listing, so a click on it opens the listing like the rest. */
	.market-icon {
		flex: none;
		align-self: flex-start;
		width: 3.25em;
		height: 3.25em;
		box-sizing: border-box;
		border-radius: 0.85em;
		object-fit: cover;
		background: var(--glass-bg);
		border: 1px solid var(--segment-border);
	}
	.market-icon.big { width: 4.75em; height: 4.75em; border-radius: 1.1em; }
	.market-initial {
		display: grid;
		place-items: center;
		color: #fff;
		font-weight: 600;
		font-size: 1.35em;
		width: 2.41em;
		height: 2.41em;
		border-radius: 0.63em;
		border-color: rgba(255, 255, 255, 0.18);
		background: linear-gradient(145deg, hsl(var(--hue) 55% 52%), hsl(calc(var(--hue) + 35) 60% 36%));
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.market-initial.big { font-size: 1.9em; width: 2.5em; height: 2.5em; border-radius: 0.58em; }

	/* A narrow screen: the description gets the width beside the icon, and
	   the button goes on a line of its own under it */
	@media (max-width: 42em) {
		.market-item { flex-wrap: wrap; align-items: flex-start; }
		.market-item > .market-item-text { flex: 1 1 calc(100% - 4.25em); }
		.market-item > .market-action { margin-left: 4.25em; }
	}

	/* The registry's banner behind the Marketplace's heading, darkened
	   towards the bottom so the heading stays readable over any picture.
	   A banner that won't load is taken away (marketPictureScript) and the
	   heading looks as it always has. */
	.market-head.has-banner {
		position: relative;
		overflow: hidden;
		min-height: 12em;
		align-items: flex-end;
		color: #fff;
	}
	.market-banner {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		z-index: 0;
	}
	.market-head.has-banner::before {
		content: "";
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.25) 60%, rgba(0, 0, 0, 0.05));
	}
	.market-head.has-banner > div,
	.market-head.has-banner > .market-action { position: relative; z-index: 2; }
	.market-head.has-banner h1 { color: #fff; }
	.market-head.has-banner .lede,
	.market-head.has-banner .help { color: rgba(255, 255, 255, 0.85); }
	.market-item h3 { margin: 0; font-size: 1.05em; font-weight: 600; }
	.market-by { color: var(--fg-muted); font-size: 0.8em; margin: 0.15em 0 0.5em 0; }
	.market-desc { color: var(--fg-muted); font-size: 0.9em; line-height: 1.4; }

	/* What a listing does beyond its tile (runs in the background, takes
	   input, sends notifications) and the OmniCore it needs, as small
	   tags under its description. A requirement this OmniCore doesn't
	   meet is drawn in the danger colour. */
	.market-tags { display: flex; flex-wrap: wrap; gap: 0.4em; margin-top: 0.6em; }
	.market-tags .provides-tag { margin: 0; }
	.provides-tag.warn { color: var(--danger); border-color: var(--danger-border); opacity: 1; }

	/* The same facts on a listing's own page, one plain sentence each */
	.market-traits { margin: 0; padding-left: 1.2em; }
	.market-traits li { margin: 0.35em 0; line-height: 1.5; }
	.market-traits li.warn { color: var(--danger); }

	/* The whole listing is a link to its own page, EXCEPT the Install
	   button, which needs its own click. The link is stretched over the
	   listing; the button sits above it. "Installed" isn't a button, so a
	   click on it goes through to the link underneath. */
	.market-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: inherit;
	}

	.market-link:focus-visible {
		outline: 2px solid var(--glow-strong);
		outline-offset: 2px;
	}

	/* A listing's button, and the one in each header. Smaller than a
	   full-size glass button, the same size whichever kind it is. */
	.market-action {
		position: relative;
		z-index: 2;
		flex: none;
		padding: 0.6em 1.1em;
		font-size: 0.95em;
		white-space: nowrap;
	}

	span.market-action { pointer-events: none; cursor: default; }

	/* The registry couldn't be read: what went wrong, and a way to try
	   again, in a box edged in the danger colour */
	.market-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1em;
		border-color: var(--danger-border);
	}

	.market-error h2 { color: var(--danger); }
	.market-error .lede { margin: 0; }

	/* A heading between groups of listings (an author's modules, then
	   their themes) */
	.market-section { margin: 0.75em 0 0 0.25em; font-size: 1.05em; font-weight: 600; }

	/* A listing's own page */
	.market-about p { margin: 0 0 0.9em 0; line-height: 1.55; }
	.market-about p:last-child { margin-bottom: 0; }

	.market-shots {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(18em, 100%), 1fr));
		gap: 1em;
		margin-top: 0.75em;
	}

	.market-shots figure { margin: 0; }

	.market-shots img {
		width: 100%;
		display: block;
		border-radius: 0.5em;
		border: 1px solid var(--segment-border);
	}

	.market-shots figcaption { color: var(--fg-muted); font-size: 0.85em; margin-top: 0.5em; }

	/* A web address that has to wrap somewhere on a phone */
	.market-url { overflow-wrap: anywhere; }

	/* Sources: one line per registry, divided by a thin rule */
	.market-source {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
		padding: 0.875em 0;
		border-top: 1px solid var(--border);
	}

	.market-source:first-child { border-top: none; padding-top: 0; }
	.market-source:last-child { padding-bottom: 0; }
	.market-source > div { min-width: 0; }

	/* A source's banner, small, beside its name */
	.market-source-name { display: flex; align-items: center; gap: 0.875em; min-width: 0; }
	.market-source-banner {
		flex: none;
		width: 6.4em;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 0.5em;
		border: 1px solid var(--segment-border);
	}


	/* Shown once, right before a third-party source is actually added.
	   Deliberately not styled like anything else on this page — this is
	   the one moment worth standing out. */
	.market-warning {
		background: linear-gradient(165deg, var(--danger-bg), var(--danger-bg));
		border: 1px solid var(--danger-border);
		border-radius: 0.75em;
		padding: 1.375em;
	}

	.market-warning h3 { color: var(--danger); margin: 0 0 12px 0; font-size: 17px; }
	.market-warning p { color: var(--danger-text); font-size: 14px; line-height: 1.6; margin: 0 0 12px 0; }
	.market-warning p:last-of-type { margin-bottom: 0; }

	.market-warning-actions { display: flex; flex-wrap: wrap; gap: 0.75em; margin-top: 1.25em; }

	.provides-tag {
		display: inline-block;
		padding: 0.3333em 0.8333em;
		border: 1px solid var(--glass-border);
		border-radius: 999em;
		font-size: 0.75em;
		opacity: 0.75;
		margin: 0.5em 0.5em 0 0;
	}
`;
}

// Info order lists, short and long (priority-ui.js draws them, on a
// widget's page and in the wizard): a list to put in order by dragging or
// with its arrows. The row being dragged follows --drag-y.
const PRIORITY_CSS = `
	/* A reorderable list. Looks like the .option rows, since it's the
	   same kind of choice made a different way. */
	[data-priority] { position: relative; }

	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0.5em 0.6em 0.5em 0.4em;
		border: 1px solid var(--segment-border);
		border-radius: 0.6579em;
		margin-bottom: 8px;
		font-size: 0.95em;
		user-select: none;
		-webkit-user-select: none;
		cursor: grab;
		position: relative;
	}

	.priority-row:last-child { margin-bottom: 0; }

	/* The row being dragged sits above the others and follows the
	   pointer. It's given the page's own colour so the rows it passes
	   over don't show through it. */
	.priority-row.dragging {
		/* Where the pointer has pulled it (--drag-y, from the script) */
		transform: translateY(var(--drag-y, 0px));
		z-index: 2;
		cursor: grabbing;
		border-color: var(--glass-border);
		background: var(--bg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.sorting, .sorting * { cursor: grabbing; }

	.priority-grip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 32px;
		flex: none;
		color: var(--fg-muted);
		fill: currentColor;
		opacity: 0.6;
		/* A finger on the grip drags instead of scrolling the page */
		touch-action: none;
	}

	.priority-row:hover .priority-grip { opacity: 1; }

	.priority-rank {
		color: var(--fg-muted);
		font-size: 0.8em;
		min-width: 16px;
		text-align: right;
	}

	.priority-name { flex: 1; }

	.priority-move {
		appearance: none;
		-webkit-appearance: none;
		width: 32px;
		height: 32px;
		padding: 0;
		margin: 0;
		flex: none;
		font-size: 0.85em;
		line-height: 1;
		cursor: pointer;
		color: inherit;
		border-radius: 0.5882em;
		border: 1px solid var(--segment-border);
		background: var(--glass-bg);
	}

	.priority-move:hover:not(:disabled) { background: var(--glass-bg-hover); }
	.priority-move:disabled { opacity: 0.2; cursor: default; }

	/* A long list's button: the order in short form, and "Change" */
	.glass.priority-open {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
		width: 100%;
		text-align: left;
		padding: 0.75em 1em;
	}

	.priority-summary {
		flex: 1;
		min-width: 0;
		line-height: 1.4;
	}

	.priority-open-hint {
		flex: none;
		color: var(--fg-muted);
		font-size: 0.9em;
	}

	.priority-open-hint::after { content: " ›"; }

	/* The pop-up: taller than a question, and its list scrolls while the
	   heading and the buttons stay put */
	.modal.priority-modal { max-width: 28em; max-height: 85vh; max-height: 85dvh; }

	.priority-list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.125em;
		margin: 0 -2px;
	}`;

// Place search's floating list of matches and the lines under it
// (place-search-ui.js, on Settings, a widget's page and the wizard)
const PLACE_SEARCH_CSS = `
	.place-anchor { position: relative; }

	/* While open: over the page, under or over its search row (the script
	   says where, --float-top or --float-bottom, and how tall it can be,
	   --float-max). The box it's in is lifted above the boxes after it. Its own
	   fill is mostly solid: it sits over other boxes' text, and a box's
	   blur only reaches what's inside that box. */
	.place-float {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 30;
		top: var(--float-top, auto);
		bottom: var(--float-bottom, auto);
		max-height: var(--float-max, 19em);
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 0.375em;
		border-radius: 0.75em;
		border: 1px solid var(--segment-border);
		background-color: color-mix(in srgb, var(--bg) 97%, transparent);
		background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
		box-shadow: inset 0 1px 0 var(--segment-edge), 0 12px 36px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.place-float .result { margin: 0; flex-shrink: 0; }
	.place-float .place-note, .place-float .place-credit { margin: 4px 6px; }
	.place-empty { margin: 6px; }
	.segment.float-open { position: relative; z-index: 20; }

	.place-note, .place-credit {
		margin: 8px 0 0;
		font-size: 0.78em;
		line-height: 1.5;
		color: var(--fg-muted);
	}

	.place-credit a { color: inherit; }
	.place-credit a:hover { color: var(--fg); }`;

// The pages that aren't Settings: the wizard (body.wizard-page), the
// welcome face (body.welcome-page), and the centred pages (a face with no
// theme yet, an Inport's page). Each page's own rules are scoped to its
// body's class with :where(), which keeps them exactly as easy to override
// as the plain rules they were before 2.0.0's central theme.
function otherPagesCss() {
	return `
	/* ===============================================================
	   THE WIZARD (wizard-face.js, port 3999)
	   =============================================================== */
	/* The page is exactly the height of the window and never scrolls
	   itself -- scrolling happens inside whichever region actually has
	   too much content. Set here unconditionally rather than added by
	   JavaScript once a step renders: a height that only appears after
	   the first paint means everything sized against it collapses to
	   nothing until then, which is exactly what happened when this was
	   applied by a class from draw(). */
	html:where(:has(> body.wizard-page)),
	body:where(.wizard-page) { height: 100%; }

	body:where(.wizard-page) {
		margin: 0;
		padding: 2em 1.5em 1.5em;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25em;
		overflow: hidden;
		box-sizing: border-box;

		/* A wizard is a screen to move through, not a document to read
		   and copy from */
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		user-select: none;
	}

	.wizard-head { text-align: center; flex-shrink: 0; }
	.wizard-head h1 { margin: 0; }

	/* The step's content takes whatever height is left between the
	   heading and the dock, and never more. Everything inside it that
	   needs to scroll measures itself against this. */
	/* Takes the space between the heading and the dock. Children are
	   stretched to fill it, which is what gives the split steps' lists
	   a real height to divide -- without it they have nothing to size
	   against and collapse to a sliver.
	   
	   The two kinds of step want opposite things here, so they say so
	   individually below rather than sharing one compromise: a split
	   step is a workspace and should fill the screen, a single segment is
	   a form and should be only as tall as it needs. */
	.wizard-content {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: stretch;
	}

	/* A split step needs .wizard-content to claim all the leftover space, since
	   that's where its real height comes from. A single segment opting out
	   of the stretch above wasn't enough on its own -- .wizard-content itself
	   was still claiming that space regardless, just leaving the dead
	   gap below the segment instead of inside it. This makes .wizard-content
	   itself stop claiming space it has nothing to fill it with,
	   whenever what's actually inside it is a single segment. */
	.wizard-content:has(> .wizard-single) {
		flex: 0 1 auto;
	}

	/* One segment, for the steps that only have one thing to show. It
	   scrolls inside itself rather than growing the page, the same as
	   the split steps do -- a long theme form or review list was
	   previously the one thing that could still push the whole page
	   taller and slide underneath the dock. */
	.wizard-single {
		width: 100%;
		max-width: clamp(28em, 50vw, 40em);
		/* Opts out of .wizard-content's stretch: a form should be as tall as
		   its fields and no taller. Stretching it left a short step
		   standing full height with its content at the top and a large
		   dead gap above the dock. */
		align-self: flex-start;
		max-height: 100%;
		overflow-y: auto;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.wizard-single::-webkit-scrollbar { width: 8px; }
	.wizard-single::-webkit-scrollbar-track { background: transparent; }
	.wizard-single::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
	}

	/* ---------------------------------------------------------------
	   The two-segment steps.

	   Unlike the settings bento, where segments size to their own content
	   and the page scrolls past them, these fill the screen: a wizard
	   step is one task to focus on now, not a page to scan. Each half
	   takes an equal share of whatever space there is and stretches to
	   fill it, so the lists inside them can do the same.

	   Which way they divide follows the screen's own shape rather than
	   a pixel threshold, for the same reason everywhere else does: a
	   phone can report more CSS pixels than an older monitor, so any
	   fixed number misjudges real devices in both directions.
	   --------------------------------------------------------------- */
	/* Stays stretched by .wizard-content, which is what gives the segments and
	   the lists inside them a real height to divide. */
	.wizard-split {
		width: 100%;
		max-width: clamp(40em, 85vw, 72em);
		min-height: 0;
		display: flex;
		gap: 14px;

		/* Portrait: divided horizontally — stacked, each full width */
		flex-direction: column;
	}

	@media (orientation: landscape) {
		/* Landscape: divided vertically — side by side, each full height */
		.wizard-split { flex-direction: row; }
	}

	.wizard-split > .segment {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* The boxes themselves are .segment, from ui-theme.js -- the same
	   ones Settings uses. Only the wizard's quieter headings are its
	   own. */
	:where(.wizard-page) .segment h2 {
		margin: 0 0 14px 0;
		font-weight: 400;
		font-size: 0.95em;
		color: var(--fg-muted);
	}

	/* A segment heading with an action beside it. The heading keeps its own
	   bottom margin so a segment without an action looks no different. */
	.segment-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1em;
		flex-shrink: 0;
	}

	/* Sized to sit beside a heading rather than stand on its own -- close
	   to the text it accompanies, not a full control competing with the
	   list below it. */
	.mini {
		appearance: none;
		-webkit-appearance: none;
		flex-shrink: 0;
		margin-bottom: 14px;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 999em;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.8em;
		padding: 0.3906em 0.9375em;
		cursor: pointer;
		transition: background 0.15s ease, box-shadow 0.15s ease;
	}

	.mini:hover,
	.mini:focus-visible {
		outline: none;
		background: var(--glass-bg-hover);
		box-shadow: 0 0 14px var(--glow-strong);
	}

	/* The settings form inside a split step scrolls on its own too,
	   rather than growing its segment past the screen */
	.segment-scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.4em;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.segment-scroll::-webkit-scrollbar { width: 8px; }
	.segment-scroll::-webkit-scrollbar-track { background: transparent; }
	.segment-scroll::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
	}

	/* A module in the picker, and a module already added. Same shape on
	   purpose — it's the same thing, on two sides of one decision. */
	.flat,
	.picked {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--segment-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.5263em;
		color: var(--fg);
		font-size: 0.95em;
		font-family: inherit;
		padding: 0.7895em 1.0526em;
		flex-shrink: 0;
	}

	.flat {
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.flat:hover {
		/* The exact same treatment On this face gets on hover, just in
		   green instead of red: a tinted fill, a coloured border, and a
		   minimal glow -- not just the glow on its own, which read as a
		   halo around an otherwise plain grey hover state. */
		background: var(--success-bg);
		border-color: var(--success-border);
		box-shadow: 0 0 14px rgba(62, 214, 122, 0.45);
	}

	.flat small,
	.picked small {
		display: block;
		color: var(--fg-muted);
		font-size: 0.8em;
		margin-top: 3px;
	}

	/* Removing is destructive, so it says so on hover rather than
	   looking like every other clickable row */
	.picked.removable {
		cursor: pointer;
		transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.picked.removable:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
		box-shadow: 0 0 14px rgba(255, 107, 107, 0.45);
	}

	/* The instance being configured right now */
	.picked.current {
		background: var(--glass-bg-hover);
		border-color: var(--glass-border);
	}

	.review-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 0.7237em 0;
		border-bottom: 1px solid var(--segment-border);
		font-size: 0.95em;
	}

	.review-row span { color: var(--fg-muted); }

	/* A later part of a step's box, a little apart from what's above it
	   (a theme's own settings, the review's modules). Written twice so a
	   heading keeps it too: ".segment h2" sets every heading's margins
	   in a box, and counts for more than a class on its own. */
	.part,
	.segment h2.part { margin-top: 22px; }

	/* ===============================================================
	   THE WELCOME FACE (control-face.js, port 4000)
	   =============================================================== */
	body:where(.welcome-page) {
		min-height: 100vh;
		padding: 3em 1.5em;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.75em;
	}

	:where(.welcome-page) .panel { width: 100%; max-width: 460px; }

	:where(.welcome-page) .actions { display: flex; gap: 0.75em; justify-content: center; }

	/* ---------------------------------------------------------------
	   The face picker: a fixed-height framed region, not a box that
	   grows to fit its content -- one face or twenty, the frame is
	   the same size, with a visible border so its edge is obvious.
	   Content sits centered within it; only becomes actually
	   scrollable once it genuinely overflows.

	   Centred with auto margins on the first and last face, NOT with
	   justify-content: center. When the faces are taller than the box,
	   justify-content: center pushes the overflow out of the top as well
	   as the bottom, and the top part is above where a scroll bar can
	   ever reach: the first face was cut off and couldn't be scrolled
	   to (v1.19.5 and earlier). An auto margin shares out only the
	   space that's actually left, so when there's none it's zero and
	   the list starts at the top.

	   Generously padded on the sides on purpose: a clickable segment's hover
	   glow paints outside its own box, and this container clips
	   anything crossing its edge the moment overflow-y is set at
	   all -- not enough horizontal room here and the glow gets cut
	   off exactly where it should be brightest.
	   --------------------------------------------------------------- */
	.face-list {
		width: 100%;
		max-width: 640px;
		height: min(620px, 62vh);
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75em;
		padding: 2em 3em;
		box-sizing: border-box;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.face-list > :first-child { margin-top: auto; }
	.face-list > :last-child { margin-bottom: auto; }

	.face-list::-webkit-scrollbar { width: 8px; }
	.face-list::-webkit-scrollbar-track { background: transparent; }
	.face-list::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 0.25em;
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
	:where(.welcome-page) .timer {
		position: fixed;
		bottom: 1.5em;
		left: 1.5em;
		width: 3.2em;
		height: 3.2em;
		border-radius: 50%;
		border: 1px solid var(--glass-border);
		background: var(--segment-bg);
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
	:where(.welcome-page) .timer::after {
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

	:where(.welcome-page) .face {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		/* Spacing between faces comes from .face-list's own gap now,
		   not a margin on each one -- otherwise the last one would
		   carry unwanted space below it too */
		width: 100%;
	}

	:where(.welcome-page) .face span { color: var(--fg-muted); font-size: 0.8em; }

	/* ---------------------------------------------------------------
	   Centred page — one short thing in the middle of the screen, its
	   title over it: a face with no theme yet (.fallback-page, its
	   themes to pick from) and an Inport's page (.inport-page, the
	   controls a phone uses, with a smaller, quieter title since the
	   controls are the point, and nothing to select by accident).
	   --------------------------------------------------------------- */
	body:where(.centred-page) {
		/* min-height, not height: with more than fits, a fixed height
		   plus centring cuts the top off where it can't be scrolled to */
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2em;
		padding: 1.5em;
	}
	:where(.centred-page) h1 { text-align: center; }

	:where(.fallback-page) .buttons { gap: 1em; justify-content: center; }

	body:where(.inport-page) { -webkit-user-select: none; user-select: none; }
	/* ...except what's typed: a number box stays one you can select in
	   (and, on some phones, one you can type in at all) */
	:where(.inport-page) input { -webkit-user-select: text; user-select: text; }
	:where(.inport-page) h1 { font-size: 1.4em; opacity: 0.85; }
	:where(.inport-page) .controls { display: flex; flex-wrap: wrap; gap: 1em; justify-content: center; }
	:where(.inport-page) .list { width: 100%; max-width: 24em; }
	:where(.inport-page) .segment.clickable { text-decoration: none; color: var(--fg); }

	/* A big glass button: a tap target meant to be hit from a phone at
	   arm's length, not clicked with a mouse */
	.glass.big { padding: 1.5em 2.5em; font-size: 1.15em; }

	/* A number to type on an Inport's page: a plain box (not a button, so
	   no glow) holding its label, a big box to type in, and its own Save */
	.field.number-field {
		display: flex;
		flex-direction: column;
		gap: 0.75em;
		min-width: 12em;
		cursor: default;
	}
	.number-field label { font-size: 0.85em; opacity: 0.7; }
	.number-field input {
		background: var(--bg);
		border: 1px solid var(--glass-border);
		border-radius: 0.3333em;
		color: var(--fg);
		font-family: inherit;
		font-size: 1.5em;
		padding: 0.5em;
		width: 100%;
		text-align: center;
	}
	.number-field input:focus { outline: none; border-color: var(--fg-muted); }

	/* Done: a moment of green after a tap, so someone on a phone knows it
	   registered before the control resets itself */
	.done { background: rgba(120, 255, 160, 0.25) !important; }
`;
}

// The Settings home's elements (settings-home.js draws the page): the
// notch and the capsule, the strip of tabs, a tab's grid, the tiles, and
// fact rows. At the end of uiStyles, where they've always been on the page.
const SETTINGS_HOME_CSS = `
	/* ===============================================================
	   THE SETTINGS HOME: a page of tabs under a notch
	   ===============================================================
	   The page (body.settings-home) and its notch are drawn by
	   settings-home.js; what they look like is here, like everything
	   else. Its script only switches classes and sets CSS variables:
	   --tab and --pan on the page, --nl on a tab of the notch, --pill-x
	   and --pill-w on the glass, --rows on a tab's grid.
	   --------------------------------------------------------------- */

	/* The notch: black, hanging from the top edge like a drop of water. Its
	   top corners curve outward into the edge (the two ears), its bottom
	   corners are round. A filter draws the thin light edge and the shadow
	   around the whole shape, ears included, so it shows on a black page. */
	.notch {
		--ear: 0.9em;
		position: fixed;
		top: 0;
		left: 50%;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 2px;
		/* In em, like every padding, so the notch grows with the text size
		   (6px, 10px and 9px at the usual 16px) */
		padding: 0.375em 0.625em 0.5625em;
		background: #000;
		border-radius: 0 0 1.75em 1.75em;
		filter: drop-shadow(1px 0 0 rgba(255, 255, 255, 0.2))
			drop-shadow(-1px 0 0 rgba(255, 255, 255, 0.2))
			drop-shadow(0 1px 0 rgba(255, 255, 255, 0.2))
			drop-shadow(0 10px 22px rgba(0, 0, 0, 0.45));
		transform: translate(-50%, 0);
		transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.25, 1.05);
	}

	/* The ears: a square at each top corner, black outside a quarter
	   circle, so the edge runs down smoothly into the notch's side. They
	   reach 1px under the notch so there's no seam. */
	.notch::before,
	.notch::after {
		content: "";
		position: absolute;
		top: 0;
		width: calc(var(--ear) + 1px);
		height: var(--ear);
		pointer-events: none;
	}
	.notch::before {
		right: calc(100% - 1px);
		background: radial-gradient(circle at 0 100%, transparent calc(var(--ear) - 0.5px), #000 var(--ear));
	}
	.notch::after {
		left: calc(100% - 1px);
		background: radial-gradient(circle at 100% 100%, transparent calc(var(--ear) - 0.5px), #000 var(--ear));
	}

	/* Up and out of sight: as the page fades out, and before it drops in
	   when the page fades in */
	.notch.notch-up { transform: translate(-50%, -125%); transition-duration: 0.18s; }
	html.omni-arriving .notch { animation: notch-drop 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.05) 0.3s both; }
	@keyframes notch-drop { from { transform: translate(-50%, -125%); } to { transform: translate(-50%, 0); } }

	.nb {
		position: relative;
		display: flex;
		align-items: center;
		height: 2.75em;
		min-width: 2.75em;
		padding: 0 0.7em;
		box-sizing: border-box;
		border-radius: 1.4em;
		color: #fff;
		text-decoration: none;
		transition: background 0.25s;
	}

	.nb svg { flex: none; }
	/* A tab you're about to go to (hover, keyboard focus) gets a fainter
	   piece of the same glass, with its name inside. The picked tab gets
	   nothing extra: its own glass already widens to hold its name. */
	.nb:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55); }
	.nb:focus-visible:not([aria-current]) {
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
	}
	/* Only a pointer hovers: on a finger a tap would leave the name stuck
	   open */
	@media (hover: hover) {
		.nb:hover:not([aria-current]) {
			background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.22);
		}
	}

	/* The clear glass on the picked tab's icon. No blur, so the icon stays
	   sharp: a faint tint, a bright rim along the top, a soft glow along the
	   bottom inside, and a little more light and colour from what's under it.
	   It lets clicks through to the tab. */
	.nb-pill {
		position: absolute;
		z-index: 2;
		top: 0.375em;
		left: 0;
		/* On the picked tab and as wide as it, name and all: the script
		   measures the tab and sets these two */
		transform: translateX(var(--pill-x, 0px));
		width: var(--pill-w, 2.75em);
		height: 2.75em;
		box-sizing: border-box;
		border-radius: 999em;
		pointer-events: none;
		opacity: 0;
		background:
			radial-gradient(120% 90% at 30% 8%, rgba(255, 255, 255, 0.34), transparent 58%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
		border: 1px solid rgba(255, 255, 255, 0.3);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.6),
			inset 0 -5px 9px -4px rgba(255, 255, 255, 0.22),
			0 2px 6px rgba(0, 0, 0, 0.4);
		-webkit-backdrop-filter: brightness(1.35) saturate(1.4);
		backdrop-filter: brightness(1.35) saturate(1.4);
	}
	.nb-pill.ready {
		opacity: 1;
		transition: transform 0.4s cubic-bezier(0.3, 0.9, 0.3, 1.1), width 0.4s cubic-bezier(0.3, 0.9, 0.3, 1.1), opacity 0.25s;
	}
	/* While a name opens or closes, the glass moves with its tab, not after it */
	.nb-pill.ready.keeping-up { transition: opacity 0.25s; }

	/* A tab's name: shown beside its icon on hover, focus or a long press,
	   the notch widening to make room. None stays open on the picked tab. */
	.nl {
		max-width: 0;
		overflow: hidden;
		white-space: nowrap;
		opacity: 0;
		font-size: 0.875em;
		transition: max-width 0.45s cubic-bezier(0.65, 0, 0.25, 1), opacity 0.3s, padding 0.45s;
	}

	.nb:focus-visible .nl,
	.nb.show .nl,
	.nb.peek .nl {
		max-width: var(--nl, 8em);
		opacity: 1;
		padding-left: 0.5em;
	}
	.notch.measuring, .notch.measuring * { transition: none !important; }
	@media (hover: hover) {
		.nb:hover .nl {
			max-width: var(--nl, 8em);
			opacity: 1;
			padding-left: 0.5em;
		}
	}

	/* An update is ready: a green dot over the glass (if About is the picked
	   tab), with two rings spreading out from it and fading, one after the
	   other, like a blip on a radar */
	.nb-dot {
		--dot: #2fd47a;
		position: absolute;
		z-index: 3;
		top: 0.45em;
		left: 1.6em;
		width: 0.62em;
		height: 0.62em;
		box-sizing: content-box;
		border-radius: 50%;
		background: var(--dot);
		border: 2px solid var(--dot-edge, #000);
	}
	.nb-dot::before,
	.nb-dot::after {
		content: "";
		position: absolute;
		inset: -2px;
		box-sizing: border-box;
		border-radius: 50%;
		border: 2px solid var(--dot);
		opacity: 0;
		pointer-events: none;
		animation: nb-radar 2.4s cubic-bezier(0.1, 0.6, 0.3, 1) infinite;
	}
	.nb-dot::after { animation-delay: 1.2s; }
	@keyframes nb-radar {
		0% { transform: scale(1); opacity: 0.7; }
		70%, 100% { transform: scale(3); opacity: 0; }
	}

	/* ---------------------------------------------------------------
	   The capsule: the notch on a phone held upright
	   ---------------------------------------------------------------
	   A narrow pill of frosted glass floating above the bottom edge and the
	   home bar. Its colours come from the page's own (--bg, --fg and the
	   glass border), so it follows light and dark mode and any background.
	   A tab's name opens beside its icon and the capsule widens to make
	   room (settings-home.js measures the end first, so the name, the
	   capsule and the glass all arrive together). */
	@media (max-width: 42em) {
		.notch {
			--ease: cubic-bezier(0.32, 0.72, 0, 1);
			--dot-edge: var(--bg);
			top: auto;
			bottom: calc(0.9em + env(safe-area-inset-bottom, 0px));
			padding: 0.3125em;
			gap: 2px;
			border-radius: 999em;
			border: 1px solid var(--glass-border);
			background: color-mix(in srgb, var(--bg) 58%, transparent);
			-webkit-backdrop-filter: blur(26px) saturate(1.6);
			backdrop-filter: blur(26px) saturate(1.6);
			filter: none;
			box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 var(--glass-sheen);
			color: var(--fg);
		}
		.notch::before, .notch::after { display: none; }

		/* Down and out of sight as the page fades out, and rising before
		   it fades in */
		.notch.notch-up { transform: translate(-50%, 200%); }
		html.omni-arriving .notch { animation: capsule-rise 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.05) 0.3s both; }
		@keyframes capsule-rise { from { transform: translate(-50%, 200%); } to { transform: translate(-50%, 0); } }

		.nb { color: var(--fg); }
		.nb:focus-visible { box-shadow: 0 0 0 2px var(--fg); }
		.nb:focus-visible:not([aria-current]),
		.nb:hover:not([aria-current]) {
			background: color-mix(in srgb, var(--fg) 8%, transparent);
			box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 14%, transparent);
		}
		.nl {
			font-weight: 500;
			transition: max-width 0.5s var(--ease), opacity 0.3s, padding 0.5s var(--ease);
		}

		/* The glass is as wide as its tab, so it holds the name too */
		.nb-pill {
			top: 0.3125em;
			border-radius: 999em;
			background:
				radial-gradient(120% 90% at 30% 8%, color-mix(in srgb, var(--fg) 20%, transparent), transparent 58%),
				linear-gradient(180deg, color-mix(in srgb, var(--fg) 12%, transparent), color-mix(in srgb, var(--fg) 5%, transparent));
			border: 1px solid color-mix(in srgb, var(--fg) 26%, transparent);
			box-shadow: inset 0 1px 0 var(--glass-sheen), 0 2px 8px rgba(0, 0, 0, 0.25);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
		.nb-pill.ready {
			transition: transform 0.5s var(--ease), width 0.5s var(--ease), opacity 0.25s;
		}
		.nb-pill.ready.keeping-up { transition: opacity 0.25s; }
	}

	/* The page: the heading at the top, the tabs filling the rest, edge
	   to edge, so boxes slide in from the screen's edge rather than from
	   a margin. Room for the Back button is left inside each tab
	   instead. */
	body.settings-home {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		padding: 0;
	}

	body.settings-home:has(> .floating.bottom-right),
	body.settings-home:has(> .floating.top-left) { padding: 0; }
	html:has(body.settings-home) { height: 100%; }

	.home-head {
		flex: none;
		display: flex;
		align-items: center;
		min-height: 5.25em;
		padding: 0.9em 1.75em;
		/* The boxes' width plus the tab's own sides, so the heading
		   starts where the boxes do */
		max-width: calc(70em + 3.5em);
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.home-head h1 { margin: 0; }

	/* The tabs start 3em higher than they look, under the heading, with
	   that 3em given back as padding inside each tab. The strip cuts off
	   anything outside it, and a glowing box in the first row would have
	   its glow cut off in a straight line where the tabs begin. The extra
	   room is where that glow goes. */
	.home-panes { flex: 1; min-height: 0; position: relative; overflow: hidden; margin-top: -3em; }
	html:not(.home-tabs) .home-panes { margin-top: 0; }

	/* Without the script: one long page */
	html:not(.home-tabs) body.settings-home { height: auto; overflow: visible; }
	html:not(.home-tabs) .home-pane { padding: 0 1.75em 2em; }
	.pane-title { max-width: 70rem; margin: 1em auto 0.75em; font-size: 1.1em; }
	html.home-tabs .pane-title { display: none; }

	/* With it: one strip of the four tabs, scrolling sideways. No
	   scrollbar: the notch says where you are. */
	html.home-tabs .home-panes {
		width: 100%;
		max-width: 100vw;
		min-width: 0;
		align-self: stretch;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	html.home-tabs .home-panes::-webkit-scrollbar { display: none; }

	html.home-tabs .home-track {
		display: flex;
		width: max-content;
		height: 100%;
	}

	/* The picture pans along with the strip (--pan, 0 to 1, set by the
	   script as it scrolls): wide enough to pan three quarters of a
	   screen */
	html.home-tabs body.settings-home .omni-backdrop {
		right: auto;
		width: 175vw;
		transform: translateX(calc(var(--pan, 0) * -75vw));
	}

	@media (prefers-reduced-motion: reduce) {
		.notch, .nl, .nb-pill.ready { transition: none; }
		.nb-dot::before, .nb-dot::after { animation: none; }
		html.omni-arriving .notch { animation: none; }
	}

	/* The boxes: six columns, of different widths and heights, so a tab
	   isn't a row of even halves */
	.home-bento {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1em;
		max-width: 70em;
		margin: 0 auto;
		/* Each box its own height, so a short one beside a tall one isn't
		   stretched into an empty frame; a box two rows tall (r2) fills
		   both */
		align-items: start;
	}

	.home-bento > .segment { margin: 0; min-width: 0; }
	.home-bento .c2 { grid-column: span 2; }
	.home-bento .c3 { grid-column: span 3; }
	.home-bento .c4 { grid-column: span 4; }
	.home-bento .c6 { grid-column: 1 / -1; }
	.home-bento .r2 { grid-row: span 2; align-self: stretch; }
	.home-bento .r3 { grid-row: span 3; align-self: stretch; }

	/* Lending room: a box with empty room at its end (.lends-room) gives
	   a little of it to the box after it (.borrows-room), which starts
	   that far to the left, so the gap between them stays the same. On
	   the Appearance tab, the mode box gives the Typography box room for
	   its note on one line, and for Font colour beside the font. The
	   amount is a share of the box, never more than 5em, so a smaller
	   screen doesn't squeeze what's in it. Only
	   where the boxes sit side by side; on a phone they stack and keep
	   their full width. */
	@media (min-width: 42.01em) {
		.home-bento > .lends-room { width: calc(100% - min(15%, 5em)); }
		.home-bento > .borrows-room { margin-left: calc(-1 * min(15%, 5em)); }
	}

	/* Anything but a phone held upright: the grid goes sideways. Two rows
	   that fit the screen (the first as tall as its boxes need, the second
	   what's left), and columns a sixth of the boxes' width that go on to
	   the right, so the first six are the screen and any more make the
	   tab wider. Each tab is at least a screen wide, its first screen in
	   the middle as before. */
	@media (min-width: 42.01em) {
		html.home-tabs .home-pane {
			--home-width: min(100vw - 3.5em, 70em);
			flex: none;
			height: 100%;
			min-width: 100vw;
			box-sizing: border-box;
			padding: 3.25em max(1.75em, calc((100vw - 70em) / 2)) 1.75em;
		}

		/* Room for the Back button in the bottom right corner */
		body.settings-home:has(> .floating.bottom-right) .home-pane { padding-bottom: 6em; }

		html.home-tabs .home-bento {
			height: 100%;
			max-width: none;
			margin: 0;
			grid-template-columns: none;
			/* The first row as tall as its boxes need, but never taller
			   than the room left once the second has at least 10em (or
			   45% on a very short screen); the second gets the rest. The
			   script then shares the height out fairly (rows(), through
			   --rows); this is how it starts. */
			grid-template-rows: var(--rows, minmax(0, auto) minmax(min(10em, 45%), 1fr));
			grid-auto-flow: column dense;
			grid-auto-columns: calc((var(--home-width) - 5em) / 6);
		}

		html.home-tabs .home-bento .c6 { grid-column: span 6; }

		/* Which row a box is on, so it stays there however the grid fills
		   (sideways, it fills each column top to bottom first). The boxes
		   of the first row end level with each other. */
		html.home-tabs .home-bento .row1 { grid-row: 1; align-self: stretch; }
		html.home-tabs .home-bento .row2 { grid-row: 2; align-self: stretch; }
		html.home-tabs .home-bento .r2 { grid-row: 1 / span 2; }

		/* A tab with a third row (General): the first two as tall as their
		   boxes need, the third the rest, so every tab ends level (the
		   script works it out, through --rows; this is how it starts). A
		   box three rows tall (r3) fills all three. */
		html.home-tabs .home-bento:has(> .row3) { grid-template-rows: var(--rows, minmax(0, auto) minmax(0, auto) minmax(0, 1fr)); }
		html.home-tabs .home-bento .row3 { grid-row: 3; align-self: stretch; }
		html.home-tabs .home-bento .r3 { grid-row: 1 / span var(--tall-rows, 3); }

		/* Resources: four big tiles that fill the screen, two rows of the
		   same height. Each has its own place, whatever order the page
		   has them in (a phone's): Manage Faces wide at the top, Network
		   and Installed Resources side by side under it, the Marketplace
		   tall on the right. */
		html.home-tabs .home-pane[data-pane=resources] .home-bento { grid-template-rows: repeat(2, minmax(0, 1fr)); }
		html.home-tabs .home-bento > [data-tile=faces] { grid-column: 1 / span 4; grid-row: 1; }
		html.home-tabs .home-bento > [data-tile=network] { grid-column: 1 / span 2; grid-row: 2; }
		html.home-tabs .home-bento > [data-tile=installed] { grid-column: 3 / span 2; grid-row: 2; }
		html.home-tabs .home-bento > [data-tile=marketplace] { grid-column: 5 / span 2; grid-row: 1 / span 2; }
		html.home-tabs .home-bento > .home-tile { align-self: stretch; }

		/* A box never taller than its place; one with more in it scrolls
		   inside itself (box-scroll, set by the script only when needed) */
		html.home-tabs .home-bento > .segment { max-height: 100%; }
		html.home-tabs .home-bento > .segment.box-scroll {
			overflow-y: auto;
			overscroll-behavior: contain;
			scrollbar-width: thin;
			scrollbar-color: var(--scroll-thumb) transparent;
		}

		/* A box with a search list open never cuts the list off: the list
		   floats over the page, and only the window's edge limits it */
		html.home-tabs .home-bento > .segment.float-open { overflow: visible; }

		/* For a moment, while the script measures the height each box
		   wants: every box at its natural height */
		html.home-tabs .home-bento.measuring { grid-template-rows: auto auto auto !important; }
		html.home-tabs .home-bento.measuring > .segment { max-height: none; align-self: start; }
	}

	/* A whole box that is a link (Resources) */
	.home-tile {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.5em;
		min-height: 9.5em;
		color: var(--fg);
		text-decoration: none;
	}

	.tile-text { display: flex; flex-direction: column; gap: 0.25em; }

	/* The Marketplace tile with the registries' banners behind it
	   (MARKET_TILE_SCRIPT): the pictures fill the box, crossfading, and
	   darken towards the bottom so the name stays readable over any of
	   them, in light mode too */
	.tile-slides {
		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		border-radius: inherit;
		pointer-events: none;
	}
	.tile-slides img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 1.2s ease;
	}
	.tile-slides img.on { opacity: 1; }
	.home-tile.has-slides .tile-slides::after {
		content: "";
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.2) 60%, rgba(0, 0, 0, 0.05));
	}
	.home-tile { position: relative; }
	.home-tile > svg, .home-tile > .tile-text { position: relative; z-index: 1; }
	.home-tile.has-slides { color: #fff; }
	.home-tile.has-slides .tile-text > span { color: rgba(255, 255, 255, 0.85); }
	.home-tile.has-slides > svg { filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5)); }
	@media (prefers-reduced-motion: reduce) {
		.tile-slides img { transition: none; }
	}
	.tile-text strong { font-size: 1.2em; font-weight: 600; }
	/* A box that leads nowhere (staticTileHtml): its icon faded, so it
	   doesn't look like something to press */
	.home-tile-off > svg { opacity: 0.4; }
	.tile-text > span { color: var(--fg-muted); font-size: 0.9em; line-height: 1.45; }

	/* The background's preview on a tab: a strip rather than a whole
	   picture */
	.home-bento .backdrop-preview { aspect-ratio: auto; height: 10em; }

	/* A phone held upright: one column, and the heading at the top (the
	   capsule is at the bottom). Each tab a screen wide, scrolling up and down by itself; a sideways
	   swipe moves a whole tab at a time. */
	@media (max-width: 42em) {
		.home-head { padding: 1.25em 1em 0.5em; min-height: 0; }
		/* Here the tabs start right under the heading, not 3em above it:
		   each tab scrolls up and down, and its boxes go out of sight at
		   the heading's lower edge instead of sliding over the heading
		   and the Back button. (A fade there would also stop the boxes'
		   frosted glass from blurring the picture, so it's a clean
		   edge.) */
		html.home-tabs .home-panes { scroll-snap-type: x mandatory; margin-top: 0; }
		html.home-tabs .home-pane {
			flex: none;
			width: 100vw;
			height: 100%;
			box-sizing: border-box;
			overflow-y: auto;
			overscroll-behavior-y: contain;
			scrollbar-width: thin;
			scrollbar-color: var(--scroll-thumb) transparent;
			scroll-snap-align: start;
			scroll-snap-stop: always;
			padding: 1em 1em 7em;
		}
		html:not(.home-tabs) .home-pane { padding: 0 1em 2em; }
		.home-bento { grid-template-columns: minmax(0, 1fr); }
		.home-bento .c2, .home-bento .c3, .home-bento .c4 { grid-column: 1 / -1; }
		.home-bento .r2, .home-bento .r3 { grid-row: auto; }
		/* An empty box kept for later (General's) isn't drawn on a phone */
		.home-bento > .segment:empty { display: none; }
		.home-tile { min-height: 7.5em; }
	}

	/* The Back button in the top left: the heading starts after it. On a
	   phone held upright the heading is beside it. */
	body.settings-home:has(> .floating.top-left) .home-head { padding-left: 6em; }
	body.settings-home > .floating.top-left { top: 1.25em; }
	@media (max-width: 42em) {
		body.settings-home > .floating.top-left { top: 1.25em; }
		/* The capsule has the bottom: the sign-out button goes to the top
		   right, where it can't be in the way of a name opening */
		body.settings-home > .floating.bottom-right { bottom: auto; top: 1.25em; right: 1em; }
		body.settings-home:has(> .floating.bottom-right) .home-head { padding-right: 5.5em; }
		body.settings-home:has(> .floating.top-left) .home-head { padding-left: 5.5em; padding-top: 1.25em; min-height: 4.9em; }
	}

	/* ---------------------------------------------------------------
	   Fact rows — a label on the left and its value on the right, one
	   under another with a line between them: the About tab, the Network
	   page's Wi-Fi, a face's page (in a .facts list). A .hint in a row
	   goes under it, across the whole row. .fact-label and .fact-value
	   are a face's: its value in bold.

	   (Until 2.0.0's central theme there were two: the Settings home's
	   came later on the page and won, which put a face's hints on the
	   same line as its facts.)
	   --------------------------------------------------------------- */
	.facts { display: flex; flex-direction: column; margin-top: 10px; }
	.fact {
		display: grid;
		grid-template-columns: 1fr auto;
		column-gap: 1em;
		align-items: baseline;
		padding: 0.75em 0;
		border-top: 1px solid var(--segment-border);
		font-size: 0.95em;
	}
	.fact:first-child,
	.fact:first-of-type { border-top: none; }
	.fact span:first-child { color: var(--fg-muted); white-space: nowrap; }
	.fact > span:nth-child(2) { text-align: right; overflow-wrap: anywhere; }
	.fact-label { font-size: 0.9em; }
	.fact-value { font-weight: 600; font-variant-numeric: tabular-nums; }
	.fact .hint { grid-column: 1 / -1; margin: 2px 0 0 0; }
`;

// The round floating button (Back, and the corner buttons) and the room
// it keeps free at the top or bottom of the page. Part of uiStyles, and
// sent on its own (backButtonStyles) to the About face, whose pages keep
// their own look.
const FLOATING_CSS = `
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
		/* The glass's tint and Dim, as on every box (backdrop.js); none on
		   a page without them, such as the About face */
		background-image: linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent));
		color: var(--fg);
		font-family: inherit;
		font-size: 1em;
		cursor: pointer;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 30px transparent;
		transition: background-color 0.2s ease, box-shadow 0.25s ease;
	}

	/* It glows like any other button */
	.floating:hover,
	.floating:focus-visible {
		background-color: var(--glass-bg-hover);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 30px var(--glow-strong);
		outline: none;
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

	   One rule for every page OmniCore draws, the About face's too,
	   whatever each page's own padding is: :has() asks "does this body
	   contain a top-left back button?", and that question outranks a
	   plain body { padding } wherever it's written. A browser too old to
	   know :has() just doesn't reserve the room -- the page looks
	   exactly as it did before.

	   Bottom-right gets the same at the bottom. A page scrolled all the
	   way down would otherwise end with its last segment under the button
	   -- and the last thing on a page is often a button of its own
	   (a module's Save | Remove). */
	body:has(> .floating.top-left) { padding-top: calc(1.5em + 3.4em + 1.5em); }
	body:has(> .floating.bottom-right) { padding-bottom: calc(1.5em + 3.4em + 1.5em); }
`;

// The back button Core puts on Face:1303's pages (about-face.js), which
// don't load uiStyles: the floating button, with the colours it needs
// set on the button itself, in the mode this browser is in (the device's,
// when it hasn't picked one).
function backButtonStyles() {
	const mode = currentUiMode();
	const colours = (palette) => `
		--glass-border: ${palette.glassBorder};
		--segment-bg: ${palette.segmentBg};
		--fg: ${palette.fg};
		--glass-bg-hover: ${palette.glassBgHover};
		--glow-strong: ${palette.glowStrong};
		--flash: ${palette.flash};`;
	const variables = mode
		? `.floating {${colours(PALETTES[mode])}}`
		: `.floating {${colours(PALETTES.dark)}}
	@media (prefers-color-scheme: light) { .floating {${colours(PALETTES.light)}} }`;
	return variables + FLOATING_CSS;
}

function uiStyles(options) {
	const settings = readSettings();
	const forced = options && options.forceMode;
	const mode = forced === "light" || forced === "dark" ? forced : currentUiMode();

	// The palette, then the glass for the same mode (backdrop.js), which
	// can override a palette value or two.
	//
	// Which palette: the mode's own, unless there's a picture or a colour
	// behind the pages. Then the glass is always glass, the dark set's,
	// whichever the mode and whichever the font colour, and only the text
	// colours are the font colour's (overPicturePalette).
	//
	// The curtain a page fades in from and out to (page-motion.js): the
	// page's own base colour, black or white, rather than its grey
	const curtain = (light) => `--curtain: ${light ? DEFAULT_LIGHT : DEFAULT_DARK};`;
	const pictured = backdrop.hasBackdrop(settings);
	const forMode = (light) => {
		const set = backdrop.glassFor(settings, light).set;
		const palette = pictured ? overPicturePalette(set) : PALETTES[set];
		return {
			variables: `${paletteVariables(palette)}${backdrop.glassVariables(settings, light)}${curtain(light)}`,
			rules: modeRules(!pictured && set === "light")
		};
	};

	const dark = forMode(false);
	const light = forMode(true);
	const colours = mode
		? `
	:root {${(mode === "light" ? light : dark).variables}}
	${(mode === "light" ? light : dark).rules}`
		: `
	:root {${dark.variables}}
	${dark.rules}

	@media (prefers-color-scheme: light) {
		:root {${light.variables}}
		${light.rules}
	}`;

	// With a picture behind the page, the faint blobs below have nothing
	// left to do: the picture is what the glass blurs.
	//
	// Since Phase A the picture is shown as it is, and the glass is what
	// keeps text readable (its Dim). The few things drawn straight on the
	// picture, with no box under them, need help of their own:
	//   - a page's title, and the line under it (the welcome face's, the
	//     setup wizard's): white or black by the background itself, never
	//     the font colour, which is for text on the glass
	//     (--on-picture-fg), with a soft shadow the other way round
	//     (--on-picture-shadow), both from backdrop.js
	//   - a glass button that isn't in a box (Create a new face, on the
	//     welcome face): the glass's tint and Dim, like a box has, hovered
	//     or not
	const overPicture = backdrop.hasBackdrop(settings)
		? `
	body { background-image: none; }
	:is(h1, h1 + .lede):not(.segment *, .modal *) { color: var(--on-picture-fg); text-shadow: var(--on-picture-shadow); }
	.glass:not(.segment *, .modal *),
	.glass:not(.segment *, .modal *):hover,
	.glass:not(.segment *, .modal *):focus-visible {
		background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
	}`
		: "";

	return `
	${fontFace(settings)}

	:root {
		--font: ${fontStack(settings)};
		--font-size: ${Number(settings.uiFontSize) || 16}px;

		--radius: 0.75em;
		/* Room inside a row of a list, picked (.font-row) or not (.item) */
		--row-padding: 0.7em 0.9em;
	}
	${colours}

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
			radial-gradient(circle at 15% 20%, var(--ambient-a), transparent 42%),
			radial-gradient(circle at 85% 75%, var(--ambient-b), transparent 46%);
		background-attachment: fixed;
		color: var(--fg);
		font-family: var(--font);
		font-size: var(--font-size);
		margin: 0;
		/* Text on these pages is for reading, not typing: the ordinary
		   arrow over it, never the text cursor. Links and buttons still
		   show the hand (their own rules), and the text cursor is kept for
		   the places you type. */
		cursor: default;
	}
	/* A page shown in a frame over the takeover (Manual Setup): no
	   background of its own, so the takeover's glass shows through, and
	   a little room at its edges so a glow or a focus ring isn't cut off
	   by the frame. Its colour scheme is the frame's (.omni-net-setup is
	   dark): when the two differ, a browser paints the frame solid. */
	html.see-through { color-scheme: dark; }
	html.see-through body { background: transparent; padding: 0.25em; }

	input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button]):not([type=submit]):not([type=file]),
	textarea,
	[contenteditable]:not([contenteditable=false]) {
		cursor: text;
	}
	${overPicture}

	/* A font colour picked on the Appearance tab shows at once, before
	   it's saved: the page puts .font-white or .font-black on <html>,
	   and the text's own colours follow. Everything made of glass stays
	   as it is. (Only ever put there with a picture or a colour behind
	   the pages.) */
	:root.font-white { ${textColourVariables("dark")} }
	:root.font-black { ${textColourVariables("light")} }

	${CURTAIN_CSS}

	/* ---------------------------------------------------------------
	   The picture behind the page (since v2), when one is set in
	   Settings: drawn by backdropHtml() in backdrop.js as the first
	   thing in <body>. A layer fixed to the screen rather than
	   background-attachment: fixed, which iPhones don't honour.
	   Behind everything (z-index -1) and never in the way of a click.
	   Shown as it is, at the Picture brightness picked: what keeps text
	   readable is the glass over it (backdrop.js), not a veil over the
	   picture (which there was until Phase A of 2.0.0).
	   --------------------------------------------------------------- */
	.omni-backdrop {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		background: var(--bg);
	}

	.omni-backdrop picture { display: block; width: 100%; height: 100%; }

	/* A colour behind the pages instead of a picture (its colour is
	   --colour, on it): darker by brightness() like a picture, brighter by
	   white laid over it (--colour-lift), since brightness() can't make
	   black any brighter */
	.omni-colour {
		display: block;
		width: 100%;
		height: 100%;
		background:
			linear-gradient(rgba(255, 255, 255, var(--colour-lift, 0)), rgba(255, 255, 255, var(--colour-lift, 0))),
			var(--colour);
		filter: brightness(var(--colour-brightness, 1));
	}

	.omni-backdrop img,
	.omni-backdrop video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: brightness(var(--backdrop-brightness));
	}

	/* The background fading in (BACKDROP_SCRIPT in backdrop.js). A
	   picture or video still loading is hidden, showing the Default
	   colour, and fades in once it's ready. */
	.omni-backdrop picture,
	.omni-backdrop video { transition: opacity 0.7s ease; }
	.omni-backdrop.omni-waiting picture,
	.omni-backdrop.omni-waiting video { opacity: 0; }

	/* Just after a reload that changed the background (a new one, or Dark
	   and Light): a copy of the old one, on top of the new one, fading
	   away once the new one is ready */
	/* What was behind the last page, fading into this one's: how it
	   looked comes from the script as variables (--was-bg, --was-width,
	   --was-transform, --was-filter) */
	.omni-backdrop-was {
		position: fixed;
		top: 0;
		bottom: 0;
		left: 0;
		width: var(--was-width, 100%);
		transform: var(--was-transform, none);
		background: var(--was-bg, transparent);
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 0.7s ease;
	}
	.omni-backdrop-was.going { opacity: 0; }
	.omni-backdrop-was img,
	.omni-backdrop-was .omni-colour {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.omni-backdrop-was img { filter: var(--was-filter, none); }
	.omni-backdrop-was .omni-colour { filter: var(--was-filter, brightness(var(--colour-brightness, 1))); }

	@media (prefers-reduced-motion: reduce) {
		.omni-backdrop picture,
		.omni-backdrop video,
		.omni-backdrop-was { transition: none; }
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

	/* Everything else you can point at fades its colours too, rather
	   than snapping, unless its own rule says how. :where() counts for
	   nothing against another rule, so any element with a transition of
	   its own keeps it. Colours only: things that move (a row being
	   dragged, a sliding tab) are left alone. */
	:where(a, button, input, select, textarea, summary, label,
		[role="button"], .option, .widget-choice, .result, .tab-btn) {
		transition: color 0.2s ease, background-color 0.2s ease,
			border-color 0.2s ease, box-shadow 0.25s ease, opacity 0.2s ease;
	}

	/* With reduced motion asked for, nothing grows or shrinks; colours
	   still fade, which isn't movement */
	@media (prefers-reduced-motion: reduce) {
		.segment.clickable:hover,
		.segment.clickable:focus-visible,
		.glass:active { transform: none; }
	}

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

	/* A smaller glass button, for a row's or a box heading's buttons; and
	   one as wide as its box (a pop-up's last, red button) */
	.glass.small { padding: 0.45em 0.9em; font-size: 0.85em; }
	.field > .glass.small { align-self: flex-start; }
	.glass.wide { width: 100%; }

	/* ---------------------------------------------------------------
	   Coloured buttons — for the few moments that should stand out from
	   the plain glass buttons: "Installed" in the Marketplace, and "Go
	   back" / "I understand" before a third-party source is added. Glass
	   too since v2: the green is a tint, not a solid block.

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
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.btn-glossy-green:hover:not(:disabled) { background: var(--success-button-hover); }

	/* The second choice: plain glass, like the glass buttons */
	.btn-glossy-neutral {
		color: var(--fg);
		background: var(--glass-bg);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}

	.btn-glossy-neutral:hover:not(:disabled) { background: var(--glass-bg-hover); }

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
	   the top, and on since v2. A word of warning: a blurred box
	   becomes the frame for anything inside it with position: fixed.
	   A pop-up (.modal-backdrop) has to sit outside every segment, or
	   it would cover only its own box instead of the whole screen.
	   --------------------------------------------------------------- */
	.segment {
		/* The tint (a colour, a little of it) over the glass's own fill.
		   --glass-tint is transparent until one is picked. Written as
		   two parts rather than one background, so a hover can change
		   the fill (a colour, which can fade) and keep the tint (a
		   gradient, which can't). */
		background-color: var(--segment-bg);
		background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		padding: 1.25em;
		/* A thin light edge along the top, over a picture only
		   (--segment-edge is transparent otherwise) */
		box-shadow: inset 0 1px 0 var(--segment-edge);
		backdrop-filter: var(--segment-blur);
		-webkit-backdrop-filter: var(--segment-blur);
	}

	/* At rest a clickable box carries its glow already, fully
	   transparent, so a hover only changes colours. A browser can fade
	   between two shadows only when both have the same parts in the same
	   order; written any other way the glow just jumps on. */
	.segment.clickable {
		cursor: pointer;
		box-shadow:
			inset 0 1px 0 var(--segment-edge),
			0 0 0 1px transparent,
			0 0 32px transparent,
			0 0 70px transparent;
		transition: box-shadow 0.3s ease, transform 0.3s ease,
			background-color 0.3s ease;
	}

	/* How a clickable segment answers a hover differs between light
	   and dark; those rules are in modeRules() near the top of this
	   file, with the colours. */

	/* ---------------------------------------------------------------
	   Box heading — a box's title: a segment's, or one at the top of a
	   form stack. In a .box-head it shares its line with something at
	   the end (an ⓘ, a "Look again" button).
	   --------------------------------------------------------------- */
	.segment h2,
	.box-head h2,
	.form-stack > h2 { margin: 0 0 4px 0; font-size: 1.05em; font-weight: 600; }
	.box-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5em; }

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

	/* A single-line row you can pick, inside a .list: the name on the
	   left, a secondary label pinned to the right on the same line. The
	   font picker's results. A plain row, lit on hover, rather than a
	   box: since v2 a box is frosted glass with its own tint and glow,
	   and a list of them looked like a pile of cards. */
	.font-row {
		appearance: none;
		-webkit-appearance: none;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1em;
		width: 100%;
		white-space: nowrap;
		text-align: left;
		font: inherit;
		color: var(--fg);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.6em;
		padding: var(--row-padding);
		cursor: pointer;
	}

	.font-row:hover,
	.font-row:focus-visible {
		background: var(--glass-bg-hover);
		border-color: var(--glass-border);
		outline: none;
	}

	.font-row strong { overflow: hidden; text-overflow: ellipsis; font-size: 1.05em; }
	.font-row .hint { margin: 0; flex-shrink: 0; }

	/* A list inside a pop-up is part of the pop-up's glass: no frame of
	   its own */
	.modal .list { border: none; border-radius: 0; padding: 0; gap: 2px; }

	/* A tighter list, for rows that carry two lines and buttons (the
	   Network page's networks): less room around them */
	.list.tight { padding: 0.5em; gap: 2px; }

	/* A list that scrolls after a few rows, in a pop-up */
	.list.short { max-height: 16em; }

	/* ---------------------------------------------------------------
	   Item — a row with a second line under its name, maybe an icon at
	   the start (.item-main), and an icon or buttons at the end. On a
	   .font-row it can be picked; on its own it's a plain row whose
	   buttons do the picking. On a phone the buttons go under the name,
	   which keeps its room.

	     .item            the row
	     .item-main       an icon and the words, side by side
	     .item-text       the name, with .item-sub under it
	     .item-sub        the second line (.good: green, as for "In use")
	     .item-end        an icon at the end (a lock)
	     .item-actions    buttons at the end
	     .current         the one in use: its second line green
	     aria-disabled    can't be picked: quieter, unless it's .current
	   --------------------------------------------------------------- */
	.item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5em 1em;
		white-space: normal;
	}
	.item:not(.font-row) { padding: var(--row-padding); }
	.item-main { display: flex; align-items: center; gap: 0.75em; min-width: 0; flex: 1 1 9em; }
	.item-text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 9em; }
	.item-text > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-sub { color: var(--fg-muted); font-size: 0.8em; }
	.item-sub.good, .item.current .item-sub { color: var(--success); }
	.item svg { flex-shrink: 0; }
	.item-end { display: flex; align-items: center; flex-shrink: 0; color: var(--fg-muted); }
	.item-actions { display: flex; gap: 0.4em; flex-shrink: 0; }
	.item[aria-disabled="true"] { cursor: default; }
	.item[aria-disabled="true"]:not(.current) { opacity: 0.5; }

	/* ---------------------------------------------------------------
	   Headline — a big icon, a name in large type and a line under it:
	   what something is right now (the Wi-Fi the server is on). The
	   line is quiet, or .good / .bad.
	   --------------------------------------------------------------- */
	.headline { display: flex; align-items: center; gap: 1em; margin: 0.25em 0 1em; }
	.headline svg { flex-shrink: 0; }
	.headline strong { display: block; font-size: 1.35em; font-weight: 600; overflow-wrap: anywhere; }
	.headline span { color: var(--fg-muted); font-size: 0.95em; }
	.headline .good { color: var(--success); }
	.headline .bad { color: var(--danger); }

	/* A row of two boxes where the second is the wider one (the
	   Network page: its Known networks have buttons on every row) */
	@media (orientation: landscape) {
		.bento-row.two.wide-second { grid-template-columns: 1fr 1.25fr; }
	}

	/* A signal-strength icon: the bars it doesn't have are .off */
	.signal .off { opacity: 0.25; }

	/* A small spinning ring before words that say something is under way
	   ("Looking for networks...") */
	.spinner {
		display: inline-block;
		width: 0.9em;
		height: 0.9em;
		margin-right: 0.5em;
		vertical-align: -0.1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spinner 0.8s linear infinite;
	}
	@keyframes spinner { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }

	/* ---------------------------------------------------------------
	   Form stack — a form's labels, boxes and buttons one under another,
	   evenly spaced: a pop-up's form, a password asked for under a list.
	   A .switch-row is a label with its switch at the end of the line;
	   Buttons under it go in a .buttons row.
	   --------------------------------------------------------------- */
	.form-stack { display: flex; flex-direction: column; gap: 0.6em; }
	.form-stack select,
	.form-stack input[type="text"],
	.form-stack input[type="password"] { width: 100%; box-sizing: border-box; }
	.form-stack .hint { margin: 0; }
	.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
	/* The same, centred: a code to scan with a line under it, one thing
	   at a time (Manual Setup's OmniSync view) */
	.form-stack.centred { align-items: center; text-align: center; }
	.form-stack.centred > p { margin: 0; max-width: 28em; }
	/* ---------------------------------------------------------------
	   Buttons in a row — a few buttons side by side, each as wide as its
	   words, wrapping onto a second line when there isn't room. The
	   pop-up's two buttons are the same row with .dialog-buttons: a
	   little room above, and every button equally wide.
	   --------------------------------------------------------------- */
	.buttons { display: flex; flex-wrap: wrap; gap: 0.6em; }
	/* .to-end: the row at the end of its box, its buttons on the right,
	   with a line said beside them (Couldn't save.) on their left. The
	   Appearance tab's Cancel and Save. */
	.buttons.to-end { justify-content: flex-end; align-items: center; margin-top: auto; padding-top: 0.8em; }
	.buttons.to-end > .status { margin: 0 auto 0 0; }

	/* A tab's saving box (Appearance), with no heading: what's saved, a
	   warning when there's one, and Cancel and Save at its bottom right
	   only while something isn't saved. Its height never changes with
	   what it says. */
	.tab-actions { display: flex; flex-direction: column; gap: 0.6em; }
	.tab-actions > p { margin: 0; font-size: 0.9em; line-height: 1.45; }
	.tab-actions > .hint { color: var(--fg); }

	/* A QR code on its own, in a pop-up or a frame: Core's drawing
	   (qr.js), kept square, never bigger than a phone needs, and never
	   more than about half the screen's height */
	.qr-box { width: min(14em, 65vw, 45vh); margin: 0.25em auto 0.5em; }
	.qr-box svg { display: block; width: 100%; height: auto; border-radius: 0.5em; }

	/* Something to read out or copy exactly, like a password shown on
	   request: one tap selects all of it */
	.secret {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 1.05em;
		text-align: center;
		overflow-wrap: anywhere;
		user-select: all;
		margin: 0 0 0.25em;
	}

${FLOATING_CSS}

	/* ---------------------------------------------------------------
	   Corner buttons — the same round floating button, a size smaller,
	   top-right. The Light / Dark / Device switch sits in the corner, on
	   the sign-in page and the welcome face: someone who can't sign in
	   yet, or is just picking a dashboard, still deserves to read the
	   page in the light they want. The welcome face puts its Settings
	   button beside it (.top-right-second).

	   The switch shows the choice in force -- a sun for Light, a moon
	   for Dark, a monitor for Device -- and each tap moves to the next.
	   All three icons are in the markup; data-mode-current, written by
	   the server, picks the one that shows.
	   --------------------------------------------------------------- */
	.floating.top-right { top: 1.5em; right: 1.5em; }

	/* One button's width (2.75em) and a small gap to the left of the
	   corner one */
	.floating.top-right-second { top: 1.5em; right: calc(1.5em + 2.75em + 0.75em); }

	.mode-switch svg { display: none; }
	.mode-switch[data-mode-current="light"] .icon-sun,
	.mode-switch[data-mode-current="dark"] .icon-moon,
	.mode-switch[data-mode-current="device"] .icon-device { display: block; }

	/* ---------------------------------------------------------------
	   Badge — a small outlined label that sits beside a word, such as
	   "dev" next to a development build's version. Says something about
	   the thing it's next to; it isn't a button and doesn't react.
	   --------------------------------------------------------------- */
	.badge {
		display: inline-block;
		margin-left: 0.5em;
		padding: 0.2em 0.55em;
		border: 1px solid var(--glass-border);
		border-radius: 0.5em;
		background: var(--hover-subtle);
		color: var(--fg-muted);
		font-size: 0.7em;
		font-weight: 600;
		letter-spacing: 0.04em;
		line-height: 1.2;
		vertical-align: middle;
	}

	/* A badge you can press (Pinned, which lets Auto move a slider
	   again): the same label, as a button */
	.badge.badge-button {
		appearance: none;
		-webkit-appearance: none;
		font-family: inherit;
		cursor: pointer;
		transition: background-color 0.2s ease, color 0.2s ease;
	}
	.badge.badge-button:hover,
	.badge.badge-button:focus-visible {
		outline: none;
		background: var(--glass-bg-hover);
		color: var(--fg);
	}

	.mode-switch,
	.corner-button {
		width: 2.75em;
		height: 2.75em;
	}

	.mode-switch svg,
	.corner-button svg {
		width: 1.25em;
		height: 1.25em;
	}

	.muted { color: var(--fg-muted); }

	/* The on/off toggle is the checkbox itself, drawn as one: see
	   "Toggle" below (every checkbox, since the v2 test run). The old
	   .switch, a label with its own track and knob, was never used on a
	   page and has gone. */

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

	.tab-btn:disabled { opacity: 0.4; cursor: default; }

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
	/* Quieter words under or beside something, saying why or what to
	   expect. One for every page since 2.0.0's central theme (the
	   Settings pages had a copy of their own, which won there). */
	.hint { display: block; color: var(--fg-muted); font-size: 13px; margin: 4px 0 8px 0; }
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

	/* ---------------------------------------------------------------
	   A number with its unit beside it, on one line: "Refresh every
	   [ 10 ] minutes". The box is only as wide as a number needs, so
	   the unit reads as part of the same sentence. A setting asks for
	   it with "unit"; the refresh setting always has "minutes".
	   --------------------------------------------------------------- */
	.unit-row { display: flex; align-items: center; gap: 0.75em; }
	.unit-row input[type="number"] { width: 7em; flex: none; }
	.unit-row .unit { color: var(--fg-muted); }

	/* ---------------------------------------------------------------
	   Password box with a Show / Hide button inside its right end, so a
	   typo can be checked before it's sent. The button only swaps the
	   box between a password box and a plain text box; what's typed
	   never leaves the page because of it. Wired up by
	   PASSWORD_TOGGLE_SCRIPT.
	   --------------------------------------------------------------- */
	.password-field { position: relative; }

	/* Room on the right so typed text never runs under the button */
	.password-field > input { padding-right: 4.5em; }

	.password-toggle {
		appearance: none;
		-webkit-appearance: none;
		position: absolute;
		top: 50%;
		right: 0.5em;
		transform: translateY(-50%);
		background: none;
		border: 0;
		border-radius: 0.5em;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.8em;
		padding: 0.4em 0.7em;
		cursor: pointer;
	}

	.password-toggle:hover,
	.password-toggle:focus-visible {
		color: var(--fg);
		background: var(--hover-subtle);
	}

	/* ---------------------------------------------------------------
	   Toggle — every on/off choice on OmniCore's own pages (since v2,
	   no checkboxes). Still a real checkbox underneath, so a keyboard,
	   a screen reader and a form treat it as one; it's only drawn as a
	   glass track with a knob that slides across, lit when on. Write
	   role="switch" on it so a screen reader says "switch".
	   --------------------------------------------------------------- */
	input[type="checkbox"] {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		flex: none;
		box-sizing: border-box;
		width: 2.75em;
		height: 1.6em;
		margin: 0;
		font-size: inherit;
		vertical-align: middle;
		border-radius: 99em;
		background-color: var(--glass-bg);
		border: 1px solid var(--glass-border);
		box-shadow: inset 0 1px 0 var(--glass-sheen);
		cursor: pointer;
		transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
	}

	input[type="checkbox"]::before {
		content: "";
		position: absolute;
		top: 50%;
		left: 0.2em;
		width: 1.1em;
		height: 1.1em;
		border-radius: 50%;
		background-color: var(--fg-muted);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
		transform: translateY(-50%);
		transition: transform 0.28s cubic-bezier(0.3, 0.7, 0.3, 1.15), background-color 0.25s ease;
	}

	input[type="checkbox"]:checked {
		background-color: color-mix(in srgb, var(--success) 55%, transparent);
		border-color: color-mix(in srgb, var(--success) 70%, transparent);
	}

	input[type="checkbox"]:checked::before {
		background-color: #fff;
		transform: translate(calc(2.75em - 1.1em - 0.4em - 2px), -50%);
	}

	input[type="checkbox"]:hover { box-shadow: inset 0 1px 0 var(--glass-sheen), 0 0 14px var(--glow); }
	input[type="checkbox"]:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--glow-strong); }
	input[type="checkbox"]:disabled { opacity: 0.45; cursor: not-allowed; }

	/* ---------------------------------------------------------------
	   Slider — one look for every slider: a thin glass track, filled
	   up to the knob, and a round knob that glows when it's held or
	   pointed at. The filled part follows --fill, which CONTROLS_SCRIPT
	   keeps up to date (Firefox fills it by itself).
	   --------------------------------------------------------------- */
	input[type="range"] {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		height: 1.6em;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}

	input[type="range"]::-webkit-slider-runnable-track {
		height: 0.4em;
		border-radius: 99em;
		border: 1px solid var(--glass-border);
		background: linear-gradient(
			to right,
			color-mix(in srgb, var(--fg) 70%, transparent) var(--fill, 0%),
			var(--glass-bg-hover) var(--fill, 0%)
		);
	}

	input[type="range"]::-moz-range-track {
		height: 0.4em;
		border-radius: 99em;
		border: 1px solid var(--glass-border);
		background: var(--glass-bg-hover);
	}

	input[type="range"]::-moz-range-progress {
		height: 0.4em;
		border-radius: 99em;
		background: color-mix(in srgb, var(--fg) 70%, transparent);
	}

	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 1.15em;
		height: 1.15em;
		margin-top: calc((0.4em - 1.15em) / 2 - 1px);
		border-radius: 50%;
		background: var(--fg);
		border: none;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
		transition: box-shadow 0.2s ease;
	}

	input[type="range"]::-moz-range-thumb {
		width: 1.15em;
		height: 1.15em;
		border-radius: 50%;
		background: var(--fg);
		border: none;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
		transition: box-shadow 0.2s ease;
	}

	input[type="range"]:hover::-webkit-slider-thumb,
	input[type="range"]:active::-webkit-slider-thumb,
	input[type="range"]:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4), 0 0 0 6px var(--glass-bg-hover), 0 0 16px var(--glow);
	}

	input[type="range"]:hover::-moz-range-thumb,
	input[type="range"]:active::-moz-range-thumb,
	input[type="range"]:focus-visible::-moz-range-thumb {
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4), 0 0 0 6px var(--glass-bg-hover), 0 0 16px var(--glow);
	}

	input[type="range"]:focus-visible { outline: none; }
	input[type="range"]:disabled { opacity: 0.45; cursor: not-allowed; }

	@media (prefers-reduced-motion: reduce) {
		input[type="checkbox"]::before { transition: none; }
	}

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
	.option input[type="radio"] { width: 17px; height: 17px; }

	/* A toggle in a row sits at its end, after the words, as in the
	   settings of a phone */
	.option input[type="checkbox"] { order: 2; margin-left: auto; }

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
	/* Hidden means hidden, whatever display an element's own rule gives
	   it (a .list is display: flex, which would otherwise win) */
	[hidden] { display: none !important; }

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
		/* The glass's tint and Dim, as on every box (backdrop.js) */
		background-image: linear-gradient(var(--glass-tint, transparent), var(--glass-tint, transparent));
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

	/* A section that can't be pressed right now (Save while saving):
	   faded, no glow, the same as a disabled .glass button. */
	.dock button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		box-shadow: none;
		background: transparent;
	}

	/* A section that destroys something (Remove): red label, and a red
	   halo in place of the white one on hover, so it reads as different
	   from the safe action beside it before it's pressed. Whatever it
	   does should still ask first; the colour is a warning, not the
	   safeguard. */
	.dock button.danger { color: var(--danger); }

	.dock button.danger:hover,
	.dock button.danger:focus-visible {
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2),
			0 0 30px color-mix(in srgb, var(--danger) 55%, transparent);
	}

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

	/* A pop-up: the page dimmed behind it, and the pop-up itself frosted
	   glass, like the boxes (since v2).

	   The dimmed page is blurred a little too, but on a layer of its own
	   (::before) rather than on .modal-backdrop. A blur on an element
	   stops anything inside it from blurring what's behind the element,
	   so the pop-up's own glass would only see a flat dark colour. */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5em;
		z-index: 100;
	}

	.modal-backdrop::before {
		content: "";
		position: absolute;
		inset: 0;
		z-index: -1;
		backdrop-filter: blur(3px);
		-webkit-backdrop-filter: blur(3px);
	}

	.modal-backdrop[hidden] { display: none; }

	/* The same glass as a box: its fill, the tint, the light edge, the
	   blur picked in Settings. Two things more, because a pop-up sits on
	   top of text rather than a picture: a little shade (--modal-shade,
	   in modeRules) and at least 16px of blur, so what's behind it can
	   never be read through it, even with the blur turned right down. */
	.modal {
		width: 100%;
		max-width: 26em;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		gap: 0.9em;
		background-color: var(--segment-bg);
		background-image:
			linear-gradient(var(--glass-tint), var(--glass-tint)),
			linear-gradient(var(--modal-shade), var(--modal-shade));
		border: 1px solid var(--segment-border);
		border-radius: var(--radius);
		box-shadow: inset 0 1px 0 var(--segment-edge), 0 16px 48px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(max(var(--glass-blur), 16px)) saturate(var(--glass-saturate));
		-webkit-backdrop-filter: blur(max(var(--glass-blur), 16px)) saturate(var(--glass-saturate));
		padding: 1.4em;
	}

	.modal h2 { margin: 0; font-size: 1.05em; font-weight: 600; }
	/* A hint in a pop-up sits close to what it's about: the pop-up's own
	   gap spaces it */
	.modal .hint { margin: 0; }

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

	/* A question in a pop-up, from confirmDialog or askDialog (see
	   DIALOG_SCRIPT): the question's text, an optional box to type into,
	   then its two buttons: a .buttons row, equally wide
	   (.buttons.dialog-buttons). */
	.dialog-text { margin: 0; color: var(--fg-muted); line-height: 1.5; }
	.buttons.dialog-buttons { margin-top: 0.4em; }
	.buttons.dialog-buttons > button { flex: 1; }
	/* A hint behind an ⓘ (infoTip): the bubble shows after the pointer
	   rests on the icon for half a second, at once on keyboard focus or a
	   tap. The box it's in is lifted above its neighbours while it shows,
	   or a box after it would be drawn over the bubble. */
	.info-tip {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6em;
		height: 1.6em;
		border-radius: 50%;
		color: var(--fg-muted);
		cursor: help;
		vertical-align: middle;
		outline: none;
	}
	.info-tip:hover, .info-tip:focus-visible, .info-tip:focus { color: var(--fg); }
	.info-tip:focus-visible { box-shadow: 0 0 0 2px var(--glow-strong); }

	.info-bubble {
		position: absolute;
		top: calc(100% + 6px);
		right: -0.5em;
		z-index: 40;
		width: max-content;
		max-width: min(20em, 80vw);
		padding: 0.7em 0.9em;
		border-radius: 0.6em;
		/* Always black with white words, whatever the mode, the font
		   colour or what's behind it */
		border: 1px solid rgba(255, 255, 255, 0.14);
		background-color: rgba(0, 0, 0, 0.9);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 400;
		line-height: 1.5;
		text-align: left;
		cursor: default;
		opacity: 0;
		visibility: hidden;
		transform: translateY(-4px);
		transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s linear 0.2s;
		pointer-events: none;
	}

	.info-tip:hover .info-bubble {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition-delay: 0.5s;
	}

	.info-tip:focus .info-bubble {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition-delay: 0s;
	}

	.segment:has(.info-tip:hover),
	.segment:has(.info-tip:focus) { position: relative; z-index: 20; }

	@media (prefers-reduced-motion: reduce) {
		.info-bubble { transform: none; }
	}

	.dialog-link { align-self: flex-start; font-size: 0.9em; color: var(--fg-muted); }
	.dialog-link:hover { color: var(--fg); }

	/* A glass button for something that can't be taken back (deleting a
	   face, removing a widget). The same button as everywhere else, in
	   the danger colour, so it reads as "careful" before anyone reads it. */
	.glass.glass-danger { color: var(--danger); border-color: var(--danger-border); }

	/* A red button glows red (since v1.19.9). Without this it took the
	   ordinary white glow from .glass:hover, so Delete face and the
	   pop-up's red confirm button lit up white like any other button.
	   The same glow as Remove in the capsule (.dock button.danger). A
	   disabled one keeps no glow at all, like any disabled button. */
	.glass.glass-danger:not(:disabled):hover,
	.glass.glass-danger:not(:disabled):focus-visible {
		box-shadow:
			inset 0 1px 0 var(--glass-sheen),
			inset 0 -1px 0 rgba(0, 0, 0, 0.2),
			0 0 30px color-mix(in srgb, var(--danger) 55%, transparent);
	}

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
${SETTINGS_HOME_CSS}
${settingsPagesCss()}
${PRIORITY_CSS}
${PLACE_SEARCH_CSS}
${otherPagesCss()}`;
}

// The floating back button's markup, or nothing when a page shouldn't
// have one. Pages that are a root — the welcome face, an input face,
// the wizard — pass nothing and get nothing; there's genuinely nowhere
// for it to lead.
//
// The settings home's button signs out rather than going back (its
// address is /logout), so it shows a sign-out icon, a door with an arrow
// leaving it, and says "Sign out" on hover and to a screen reader.
// Every other page gets the arrow and "Back".
const SIGN_OUT_ICON =
	'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
	'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
	'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

function backButton(href) {
	if (!href) {
		return "";
	}

	const corner = readSettings().backButtonCorner === "top-left"
		? "top-left"
		: "bottom-right";

	const signOut = href === "/logout";

	return `
	<button
		class="floating ${corner}"
		onclick="${pageMotion.goScript(`'${href}'`)}"
		${signOut ? 'aria-label="Sign out" title="Sign out"' : 'aria-label="Back"'}>${signOut ? SIGN_OUT_ICON : "&#8592;"}</button>`;
}

// The version as it's written on a page: "1.19.4", and for a development
// build a `dev` badge after it ("1.19.4 dev"). See displayVersion() in
// version.js for where the number comes from.
function versionHtml() {
	const { number, dev } = require("./version").displayVersion();
	const text = number
		? String(number).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
		: "";

	return text + (dev ? (text ? " " : "") + '<span class="badge">dev</span>' : "");
}

// An ⓘ that holds a hint too long to sit on the page: shown after the
// pointer rests on it a moment, at once when it's reached with the
// keyboard, or with a tap on a touch screen (a tap gives it the focus;
// a tap anywhere else takes it away). `text` is plain text, escaped here;
// `label` is what a screen reader calls the icon.
function infoTip(text, label) {
	const safe = (value) =>
		String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
	return (
		`<span class="info-tip" tabindex="0" role="button" aria-label="${safe(label || "More about this")}">` +
		'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
		'stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>' +
		`<span class="info-bubble" role="tooltip">${safe(text)}</span></span>`
	);
}

// A password box with its Show / Hide button. `inputHtml` is the
// <input type="password" ...> itself, so each page keeps its own id,
// data attributes and autocomplete hint.
function passwordField(inputHtml) {
	return `<div class="password-field">${inputHtml}<button type="button" ` +
		`class="password-toggle" data-password-toggle aria-pressed="false" ` +
		`aria-label="Show password">Show</button></div>`;
}

// One listener for the whole page rather than one per box, so a box
// added after the page loads works too.
const PASSWORD_TOGGLE_SCRIPT = `
	document.addEventListener("click", function (event) {
		const toggle = event.target.closest("[data-password-toggle]");

		if (!toggle) return;

		const input = toggle.parentElement.querySelector("input");
		const show = input.type === "password";

		input.type = show ? "text" : "password";
		toggle.textContent = show ? "Hide" : "Show";
		toggle.setAttribute("aria-pressed", String(show));
		toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
	});
`;

// The three choices, in the order a tap moves through them, and what
// each is called where a person reads it
const MODE_CHOICES = ["light", "dark", "device"];
const MODE_NAMES = { light: "Light", dark: "Dark", device: "Device" };

// The Light / Dark / Device switch, for the sign-in page and the welcome
// face. All three icons are in the markup; the stylesheet shows the one
// for the choice in force, which this reads from the request (the
// browser's cookie). No cookie means "Device": follow the system.
function modeSwitch() {
	const current = currentUiMode() || "device";
	const next = MODE_CHOICES[(MODE_CHOICES.indexOf(current) + 1) % MODE_CHOICES.length];
	const label = `Appearance: ${MODE_NAMES[current]}. Tap for ${MODE_NAMES[next]}.`;

	return `
	<button type="button" class="floating top-right mode-switch"
		data-mode-switch data-mode-current="${current}"
		aria-label="${label}" title="${label}">
		<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="2" stroke-linecap="round" aria-hidden="true">
			<circle cx="12" cy="12" r="4"></circle>
			<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>
		</svg>
		<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>
		</svg>
		<svg class="icon-device" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="3" y="4" width="18" height="12" rx="2"></rect>
			<path d="M8 20h8M12 16v4"></path>
		</svg>
	</button>`;
}

// Moves to the next choice: Light, then Dark, then Device, then Light
// again. Device forgets this browser's choice (see setUiMode), so the
// system decides once more. Needs UI_MODE_SCRIPT on the page too.
const MODE_SWITCH_SCRIPT = `
	(function () {
		const button = document.querySelector("[data-mode-switch]");

		if (!button) return;

		button.addEventListener("click", function () {
			const order = ${JSON.stringify(MODE_CHOICES)};
			const current = button.getAttribute("data-mode-current");
			const at = order.indexOf(current);

			setUiMode(order[(at + 1) % order.length]);
		});
	})();
`;

// What the shared controls need from a script: a slider's filled part
// (--fill, see "Slider" in the stylesheet), kept up to date as it moves,
// as a script changes its value, and for sliders added later. Every page
// on the Default UI carries it.
const CONTROLS_SCRIPT = `
	(function () {
		function fill(range) {
			var min = Number(range.min) || 0;
			var max = range.max === "" ? 100 : Number(range.max);
			var share = max > min ? (Number(range.value) - min) / (max - min) : 0;
			range.style.setProperty("--fill", Math.max(0, Math.min(1, share)) * 100 + "%");
		}

		function fillAll() {
			document.querySelectorAll('input[type="range"]').forEach(fill);
		}

		document.addEventListener("input", function (event) {
			if (event.target.matches && event.target.matches('input[type="range"]')) fill(event.target);
		});
		document.addEventListener("change", function (event) {
			if (event.target.matches && event.target.matches('input[type="range"]')) fill(event.target);
		});
		window.omniFillRanges = fillAll;

		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillAll);
		else fillAll();
	})();
`;

// Questions in a pop-up, drawn in the Default UI rather than the
// browser's own confirm() and prompt() boxes: those look like system
// warnings, can't say which button does what, and on a phone block the
// whole page. Every page built on this library can use them: the admin
// face, the setup wizard, the welcome face. Include this script, then:
//
//     if (!(await confirmDialog({ title, text, confirm: "Delete", danger: true }))) return;
//
//     const key = await askDialog({ title, text, placeholder, confirm: "Save" });
//
// confirmDialog resolves true for its confirm button. askDialog resolves
// to what was typed (trimmed; the confirm button stays off until there is
// something), with `secret: true` for a box that hides what's typed. Both
// resolve false / null for Cancel, a click outside the panel, or Escape.
// `link: { text, url }` adds a small link under the text (where to get an
// API key, say); only an https:// address becomes one.
const DIALOG_SCRIPT = `
	function openDialog(options, withInput) {
		return new Promise(function (resolve) {
			var backdrop = document.createElement("div");
			backdrop.className = "modal-backdrop";

			var panel = document.createElement("div");
			panel.className = "modal";
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-modal", "true");

			var title = document.createElement("h2");
			title.textContent = options.title || "";
			panel.appendChild(title);

			if (options.text) {
				var text = document.createElement("p");
				text.className = "dialog-text";
				text.textContent = options.text;
				panel.appendChild(text);
			}

			if (options.link && /^https:\\/\\//.test(options.link.url || "")) {
				var link = document.createElement("a");
				link.className = "dialog-link";
				link.href = options.link.url;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = options.link.text || options.link.url;
				panel.appendChild(link);
			}

			var input = null;

			if (withInput) {
				input = document.createElement("input");
				input.type = options.secret ? "password" : "text";
				input.autocomplete = "off";
				input.spellcheck = false;
				input.placeholder = options.placeholder || "";
				input.setAttribute("aria-label", options.title || "");
				input.value = options.value || "";
				panel.appendChild(input);
			}

			var buttons = document.createElement("div");
			buttons.className = "buttons dialog-buttons";

			var cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "glass";
			cancel.textContent = options.cancel || "Cancel";

			var confirmButton = document.createElement("button");
			confirmButton.type = "button";
			confirmButton.className = "glass" + (options.danger ? " glass-danger" : "");
			confirmButton.textContent = options.confirm || "OK";

			buttons.appendChild(cancel);
			buttons.appendChild(confirmButton);
			panel.appendChild(buttons);
			backdrop.appendChild(panel);
			document.body.appendChild(backdrop);

			// Nothing typed yet: nothing to save
			function typed() {
				return input ? input.value.trim() : "";
			}

			function refresh() {
				if (input) confirmButton.disabled = !typed();
			}

			function close(answer) {
				document.removeEventListener("keydown", onKey);
				backdrop.remove();
				resolve(answer);
			}

			function yes() {
				if (!input) return close(true);
				if (typed()) close(typed());
			}

			function no() {
				close(input ? null : false);
			}

			function onKey(event) {
				if (event.key === "Escape") no();
				// Enter in the box is the confirm button, once there's
				// something in it
				if (event.key === "Enter" && input && document.activeElement === input) {
					event.preventDefault();
					yes();
				}
			}

			cancel.addEventListener("click", no);
			confirmButton.addEventListener("click", yes);
			if (input) input.addEventListener("input", refresh);

			// A click on the dimmed area outside the panel is a "no"
			backdrop.addEventListener("click", function (event) {
				if (event.target === backdrop) no();
			});

			document.addEventListener("keydown", onKey);
			refresh();

			// The box gets the focus when there is one. Otherwise Cancel
			// does, not the button that does something: an Enter pressed
			// out of habit shouldn't be the yes.
			(input || cancel).focus();
		});
	}

	function confirmDialog(options) {
		return openDialog(options || {}, false);
	}

	function askDialog(options) {
		return openDialog(options || {}, true);
	}
`;


// ---------------------------------------------------------------------
// THE OVERLAY BUNDLE
//
// The elements that are drawn on top of a theme's page as well as on
// OmniCore's own: the page fade's curtain, the status drawer, the
// takeover, and notifications. A theme's page doesn't load uiStyles (it's
// the theme's own page), so these carry everything they need with them
// and are sent on their own, through styleTag(). They're still the central
// theme's elements: described in docs/ui-elements.js under Overlays, and
// changed here and nowhere else.

// A <style> element holding some of the central theme's CSS: the one way
// a page gets one. No other file writes a <style> (see
// test/central-theme.test.js).
function styleTag(css) {
	return `<style>${css}</style>`;
}

// The curtain's look: what a page fades in from and out to
// (page-motion.js). Part of uiStyles, and sent on its own with a face that
// has a theme.
const CURTAIN_CSS = `
	/* ---------------------------------------------------------------
	   The curtain: what a page fades in from and out to (page-motion.js).
	   Above everything, and never in the way of a click while it lifts.
	   --------------------------------------------------------------- */
	.omni-curtain {
		position: fixed;
		inset: 0;
		z-index: 2147483000;
		background: var(--curtain, ${DEFAULT_DARK});
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}

	html.omni-arriving .omni-curtain {
		visibility: visible;
		animation: omni-curtain-lift ${pageMotion.IN_MS}ms ease-out both;
	}

	html.omni-leaving .omni-curtain {
		visibility: visible;
		pointer-events: auto;
		animation: omni-curtain-drop ${pageMotion.OUT_MS}ms ease-in both;
	}

	@keyframes omni-curtain-lift { from { opacity: 1; } to { opacity: 0; } }
	@keyframes omni-curtain-drop { from { opacity: 0; } to { opacity: 1; } }
`;

// The curtain with its colour, for a page without uiStyles: dark, light,
// or (null) whichever the device is set to
function curtainStyles(light) {
	const colour =
		light === true
			? `:root { --curtain: ${DEFAULT_LIGHT}; }`
			: light === false
				? `:root { --curtain: ${DEFAULT_DARK}; }`
				: `:root { --curtain: ${DEFAULT_DARK}; } @media (prefers-color-scheme: light) { :root { --curtain: ${DEFAULT_LIGHT}; } }`;
	return colour + CURTAIN_CSS;
}

// The status drawer and the takeover (network-status.js): on every page,
// a theme's too
const STATUS_CSS = `
	/* The status drawer. The pane is bigger than what's seen: it runs past
	   the top and right edges of the screen, so only its bottom-left corner
	   is round on screen. Every touch goes through it. */
	.omni-net-drawer {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 2147483000;
		pointer-events: none;
		font: 500 15px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		color: #fff;
	}
	.omni-net-drawer[hidden] { display: none; }
	.omni-net-pane {
		position: absolute;
		top: -1.25em;
		right: -1.25em;
		display: flex;
		align-items: center;
		gap: 0.75em;
		padding: calc(1.25em + 0.7em) calc(1.25em + 1em) 0.7em 1em;
		border-radius: 1.4em;
		white-space: nowrap;
		/* Clear glass: no blur, a faint tint, a bright rim, and what's
		   behind a little darker so white stays readable on anything */
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05));
		border: 1px solid rgba(255, 255, 255, 0.32);
		box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.25), 0 6px 22px rgba(0, 0, 0, 0.28);
		-webkit-backdrop-filter: brightness(0.82) saturate(1.3);
		backdrop-filter: brightness(0.82) saturate(1.3);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
		/* Out of sight until it moves. The script says where it rests
		   (--omni-net-at) and animates it between those places. */
		transform: var(--omni-net-at, translate(0, -150%));
	}
	.omni-net-pane svg { flex: none; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45)); }
	.omni-net-pane .omni-net-dim { opacity: 0.3; }
	.omni-net-speeds { display: flex; gap: 0.9em; font-variant-numeric: tabular-nums; }
	.omni-net-speeds span { min-width: 5.2em; }
	.omni-net-hidden-text {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* The takeover: the whole screen, above everything, the page paused
	   under it */
	.omni-net-takeover {
		position: fixed;
		inset: 0;
		z-index: 2147483600;
		display: grid;
		place-items: center;
		padding: 2em;
		background: rgba(0, 0, 0, 0.82);
		-webkit-backdrop-filter: blur(24px) saturate(1.2);
		backdrop-filter: blur(24px) saturate(1.2);
		color: #fff;
		font: 400 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		text-align: center;
		opacity: 0;
		transition: opacity 0.4s ease;
	}
	.omni-net-takeover[hidden] { display: none; }
	.omni-net-takeover.on { opacity: 1; }
	.omni-net-takeover-card { width: min(34em, 100%); display: grid; justify-items: center; gap: 0.75em; }
	.omni-net-setup {
		width: 100%;
		height: min(30em, 58vh);
		margin-top: 0.75em;
		border: 0;
		background: transparent;
		color-scheme: dark;
	}
	.omni-net-takeover svg { width: 4.5em; height: 4.5em; opacity: 0.9; }
	.omni-net-takeover h1 { margin: 0.25em 0 0; font-size: 2em; font-weight: 600; letter-spacing: -0.01em; }
	.omni-net-takeover p { margin: 0; color: rgba(255, 255, 255, 0.75); }
	@media (prefers-reduced-motion: reduce) {
		.omni-net-takeover { transition: none; }
	}
`;

// --- Notifications (notifications.js) ------------------------------------

// How big a table's text is, as a share of Core's font size (Settings >
// Font size). Tables are the one dense thing a notification can hold, so
// they're set smaller than everything around them to fit.
const TABLE_TEXT_SCALE = 0.5;

// Emoji fonts, always at the end of every font list the overlay uses.
// Not a setting: a message with an emoji in it should show the emoji,
// whatever font the install has picked. A browser looks for each
// character in the fonts in order, so letters still come from the
// chosen font, and only what that font doesn't have -- the emoji --
// falls through to these. One for each system's own: Apple, Windows,
// Linux and Android, then two that are often added by hand.
const EMOJI_FONTS =
	'"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", ' +
	'"Noto Color Emoji", "Android Emoji", "Twemoji Mozilla", "EmojiOne Color"';

const CODE_FONTS = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// The frosted glass, per mode. These belong to the overlay alone, not
// to the Default UI's palette: OmniCore's own pages sit on a plain
// background, but a notification sits on whatever a theme drew -- a
// photo, a bright tile -- so it needs its own tint to stay readable.
//
//   tint    the colour laid over the blur. Dark mode darkens what's
//           behind a little; light mode greys it a little.
//   edge    the thin border round every box
//   screen  laid over the whole screen behind the boxes, which is
//           blurred too, so the boxes stand out from it
const NOTE_GLASS = {
	dark: {
		tint: "rgba(0, 0, 0, 0.32)",
		edge: "rgba(255, 255, 255, 0.2)",
		screen: "rgba(0, 0, 0, 0.28)"
	},
	light: {
		tint: "rgba(170, 170, 175, 0.42)",
		edge: "rgba(255, 255, 255, 0.55)",
		screen: "rgba(255, 255, 255, 0.12)"
	}
};

// `mode` is the face's notificationMode: "light", or anything else for
// dark.
function notificationStyles(mode) {
	const settings = readSettings();
	const light = mode === "light";
	const palette = light ? PALETTES.light : PALETTES.dark;
	const glass = light ? NOTE_GLASS.light : NOTE_GLASS.dark;
	const size = Number(settings.uiFontSize) || 16;

	return `
	${fontFace(settings)}

	/* The layer over the whole screen: it blurs and slightly dims (or,
	   in light mode, lightens) whatever the theme drew. Sits above
	   everything a theme draws, which is the whole point of an overlay.
	   Everything inside reads its colours and font from here. */
	.omni-note-layer {
		--omni-note-fg: ${palette.fg};
		--omni-note-muted: ${palette.fgMuted};
		--omni-note-segment: ${glass.tint};
		--omni-note-edge: ${glass.edge};
		--omni-note-sheen: ${palette.glassSheen};
		--omni-note-radius: 0.75em;
		--omni-note-size: ${size}px;
		/* How wide a QR code is drawn: big enough to scan from a few
		   steps away, small enough that two stacked still fit on a
		   short screen */
		--omni-note-qr: min(22vh, 9.5em);

		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: ${glass.screen};
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		z-index: 9000;
		opacity: 0;
		transition: opacity 260ms ease;
		pointer-events: none;

		color: var(--omni-note-fg);
		font-family: ${fontStack(settings)}, ${EMOJI_FONTS};
		font-size: var(--omni-note-size);
		font-weight: normal;
		line-height: normal;
		text-align: left;
	}

	/* A theme's own rules -- "every h2 is red", "every p is Comic Sans"
	   -- would otherwise reach inside the overlay and win over what it
	   inherits from the layer. This puts the layer's font and colour back
	   on everything inside. The overlay's own rules below come after
	   this, so they still win where they set something different. */
	.omni-note-layer * {
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		font-style: inherit;
		color: inherit;
		letter-spacing: normal;
		text-transform: none;
		text-shadow: none;
		background: none;
		border: 0;
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	/* The reset above takes bold and italic off too; these put them back */
	.omni-note-layer strong { font-weight: 700; }
	.omni-note-layer em { font-style: italic; }

	/* Hidden means hidden inside the overlay, whatever a theme's own
	   rules say: a theme's page has no Default UI to say it */
	.omni-note-layer [hidden] { display: none !important; }

	.omni-note-layer.is-open { opacity: 1; }

	/* The module's name on top, the message and its QR codes under it */
	.omni-note-bento {
		display: flex;
		flex-direction: column;
		gap: 0.8em;
		width: min(94vw, 52em);
		max-height: 94vh;
	}

	/* The message, and the column of QR boxes beside it. Stretched, so
	   the message box is as tall as the QR column and the two end level. */
	.omni-note-row {
		display: flex;
		align-items: stretch;
		gap: 0.8em;
		min-height: 0;
	}

	/* Every box: frosted glass. The blur is what makes it frosted --
	   whatever is behind shows through, softened -- and the tint keeps
	   text readable over a bright picture. No glow and no sheen: those
	   belong to buttons, and nothing here can be pressed. */
	.omni-note {
		border-radius: var(--omni-note-radius);
		border: 1px solid var(--omni-note-edge);
		background: var(--omni-note-segment);
		backdrop-filter: blur(18px) saturate(1.3);
		-webkit-backdrop-filter: blur(18px) saturate(1.3);
		position: relative;
		overflow: hidden;

		/* Start small. The open class scales it to 1 with an overshoot,
		   which is what gives the bounce. */
		transform: scale(0.82);
		opacity: 0;
		transition:
			transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 200ms ease;
	}

	.omni-note-layer.is-open .omni-note {
		transform: scale(1);
		opacity: 1;
	}

	/* Leaving is deliberately not the reverse of arriving. A bounce on
	   the way out reads as indecision -- it should simply go. */
	.omni-note-layer.is-closing .omni-note {
		transform: scale(0.9);
		opacity: 0;
		transition:
			transform 220ms ease-in,
			opacity 200ms ease-in;
	}

	/* The source box: the module's name (or the source it gave), drawn
	   the way a page's own heading is in the Default UI -- light weight,
	   1.75em -- so a notification reads like the top of a page. */
	.omni-note-source {
		display: flex;
		align-items: center;
		gap: 0.5em;
		padding: 1em 1.5em;
		font-size: 1.75em;
		font-weight: 300;
		line-height: 1.2;
	}

	/* Where a module's icon will go. Empty, and so not shown, until
	   modules can have one. */
	.omni-note-source-icon:empty { display: none; }

	/* The message: takes whatever width the QR column leaves */
	.omni-note-main {
		flex: 1 1 auto;
		min-width: 0;
		padding: 1.5em;
	}

	.omni-note-title {
		font-size: 1.25em;
		font-weight: 600;
		line-height: 1.25;
		color: var(--omni-note-fg);
	}

	/* The description, rendered from Markdown. Capped in height: a wall
	   of text was never going to be read in passing, and it mustn't push
	   the title off the screen. */
	.omni-note-description {
		margin: 0.6em 0 0;
		color: var(--omni-note-muted);
		line-height: 1.45;
		max-height: 45vh;
		overflow: hidden;
	}

	/* No title above it: the description is the whole message, so it
	   takes the full colour rather than the quieter one, and the gap a
	   title would have needed goes */
	.omni-note-description.is-alone {
		margin-top: 0;
		color: var(--omni-note-fg);
	}

	.omni-note-description p { margin: 0 0 0.5em; }
	.omni-note-description > :last-child { margin-bottom: 0; }

	/* Lists, indented as they are on any other page */
	.omni-note-description ul,
	.omni-note-description ol {
		margin: 0 0 0.5em;
		padding-left: 1.3em;
	}

	.omni-note-description code {
		font-family: ${CODE_FONTS}, ${EMOJI_FONTS};
		font-size: 0.9em;
		padding: 0.05em 0.35em;
		border-radius: 0.3em;
		background: rgba(127, 127, 127, 0.18);
	}

	.omni-note-description strong { color: var(--omni-note-fg); }

	.omni-md-subtitle {
		color: var(--omni-note-fg);
		font-weight: 600;
		font-size: 1.1em;
	}

	/* A table. Its text is a fixed share of Core's font size (see
	   TABLE_TEXT_SCALE), not of whatever surrounds it, so every table is
	   the same size wherever it sits. */
	.omni-note-description table {
		font-size: calc(var(--omni-note-size) * ${TABLE_TEXT_SCALE});
		border-collapse: collapse;
		margin: 0.4em 0 1em;
	}

	.omni-note-description th,
	.omni-note-description td {
		padding: 0.35em 0.8em;
		border-bottom: 1px solid var(--omni-note-edge);
		vertical-align: top;
		text-align: left;
	}

	.omni-note-description th {
		color: var(--omni-note-fg);
		font-weight: 600;
		border-bottom-width: 2px;
	}

	.omni-note-description tr:last-child td { border-bottom: none; }

	/* "...3 more rows not shown", under a table that was cut down */
	.omni-note-description .omni-md-table-more {
		margin-top: -0.6em;
		font-size: 0.75em;
		opacity: 0.8;
	}

	/* "3 earlier notifications skipped" -- small, under everything */
	.omni-note-skipped {
		margin: 0.9em 0 0;
		font-size: 0.8em;
		color: var(--omni-note-muted);
		opacity: 0.8;
	}

	/* The QR column: one box per link, stacked. Not there at all when
	   the notification has no link, and the message takes the row. */
	.omni-note-links {
		display: none;
		flex-direction: column;
		gap: 0.8em;
	}

	.omni-note-layer.has-link .omni-note-links { display: flex; }

	/* One link: its code, and its address under it. Exactly as wide as
	   the code plus the box's padding, so a long address can't widen it.
	   Never shorter than what's in it; when the message is the taller
	   side, the boxes share the spare height. */
	.omni-note-link {
		flex: 1 0 auto;
		/* the code, the padding either side, and the 1px border */
		width: calc(var(--omni-note-qr) + 2em + 2px);
		padding: 1em;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.omni-note-qr svg {
		display: block;
		width: var(--omni-note-qr);
		height: auto;
		border-radius: 0.4em;
	}

	/* The address. One line, always: one too long to fit ends in "..."
	   rather than wrapping. It's plain text, not a link -- nothing on a
	   face's screen can be clicked -- there for anyone who'd rather type
	   it than scan it. */
	.omni-note-link-url {
		margin: 0.6em 0 0;
		width: 100%;
		font-size: 0.7em;
		color: var(--omni-note-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* A screen taller than it is wide: the QR boxes go under the
	   message, side by side, rather than squeezing it into a sliver */
	@media (max-aspect-ratio: 1/1) {
		.omni-note-row { flex-direction: column; }

		.omni-note-links {
			flex-direction: row;
			justify-content: center;
		}

		.omni-note-link { flex: 0 0 auto; }
	}

	/* The timer, bottom-left. Deliberately the same lamp the welcome
	   face's auto-advance uses -- a draining amber wedge under a domed
	   lens -- because "time is running out on this thing on screen"
	   already has a look in OmniCore and should not grow a second one.
	   Its housing is the same frosted glass as the boxes. Bottom-left is
	   reserved for exactly this; the floating back button only ever
	   offers bottom-right and top-left so the two can't collide. */
	.omni-note-timer {
		position: fixed;
		bottom: 1.5em;
		left: 1.5em;
		width: 3.2em;
		height: 3.2em;
		border-radius: 50%;
		border: 1px solid var(--omni-note-edge);
		background: var(--omni-note-segment);
		backdrop-filter: blur(18px) saturate(1.3);
		-webkit-backdrop-filter: blur(18px) saturate(1.3);
		overflow: hidden;
		z-index: 9001;
		opacity: 0;
		transform: scale(0.82);
		transition:
			transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 200ms ease;
	}

	.omni-note-layer.is-open .omni-note-timer {
		opacity: 1;
		transform: scale(1);
	}

	.omni-note-layer.is-closing .omni-note-timer {
		opacity: 0;
		transform: scale(0.9);
		transition:
			transform 220ms ease-in,
			opacity 200ms ease-in;
	}

	.omni-note-lamp {
		/* How much time is left, 1 to 0: full until the script says */
		--remaining: 1;
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

	/* The lamp's domed lens: a sheen over its top half */
	.omni-note-timer::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, var(--omni-note-sheen), transparent
		);
		pointer-events: none;
	}

	/* Someone who has asked their system for less motion gets the same
	   notification without the movement. It still arrives, holds and
	   leaves -- only the scaling stops. */
	@media (prefers-reduced-motion: reduce) {
		.omni-note,
		.omni-note-timer,
		.omni-note-layer.is-closing .omni-note,
		.omni-note-layer.is-closing .omni-note-timer {
			transition: opacity 200ms ease;
			transform: none;
		}
	}
`;
}


module.exports = {
	FLOATING_CSS,
	backButtonStyles,
	SETTINGS_HOME_CSS,
	PRIORITY_CSS,
	PLACE_SEARCH_CSS,
	styleTag,
	CURTAIN_CSS,
	curtainStyles,
	STATUS_CSS,
	TABLE_TEXT_SCALE,
	EMOJI_FONTS,
	CODE_FONTS,
	NOTE_GLASS,
	notificationStyles,
	MODE_CHOICES,
	DIALOG_SCRIPT,
	CONTROLS_SCRIPT,
	uiStyles,
	backButton,
	fontStack,
	fontFace,
	PALETTES,
	paletteVariables,
	overPicturePalette,
	DEFAULT_DARK,
	DEFAULT_LIGHT,
	SYSTEM_FONT,
	UI_MODE_COOKIE,
	UI_MODE_SCRIPT,
	uiModeFromRequest,
	rememberUiMode,
	currentUiMode,
	versionHtml,
	passwordField,
	infoTip,
	PASSWORD_TOGGLE_SCRIPT,
	modeSwitch,
	MODE_SWITCH_SCRIPT
};