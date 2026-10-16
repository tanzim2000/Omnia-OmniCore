// core/admin-face.js
// OmniCore's built-in admin face, on port 3000.
//
// Admin faces live in the 3xxx range and are OmniCore's own UI — no themes,
// no marketplace code ever runs here. That's precisely why it's the safe
// place for anything that WRITES.
//
// Structure:
//   /                                    Settings
//   /faces                               Every dashboard face
//   /faces/:id                           One face: name, theme, link to modules
//   /faces/:id/theme                     The face's theme and its settings
//   /faces/:id/theme/change              Pick a different theme
//   /faces/:id/modules                   The module instances on that face
//   /faces/:id/modules/add               Pick a module to add
//   /faces/:id/modules/:instanceId       One instance's settings
//   /updates                             OmniCore's own version, and Update now
//
// Every page is built from the Default UI's segments (.bento, .segment) -- the
// same look as Settings -- through page() below.
//
// Modules sit under a face because a module instance belongs to a face. The
// same module can appear more than once with different settings — two
// weather tiles for two cities — so there's no single global "weather" to
// configure.
//
// Every settings form is generated from what a module declared in its
// settings.json. Modules never supply HTML, which is what keeps admin pages
// consistent no matter who wrote the module.

const { attachBackdropRoute } = require("./backdrop");
const { pageStart } = require("./page-motion");
const backdropStore = require("./backdrop");
const express = require("express");
const { listModules } = require("./module-loader");
const {
	readManifest,
	readSchema,
	applyDefaults,
	cleanConfig,
	widgetTypeOf,
	readInputSchema,
	isRefreshField,
	REFRESH_FLOOR
} = require("./module-config");
const themeLoader = require("./theme-loader");
const priority = require("./priority");
const priorityUi = require("./priority-ui");
const widgetTypes = require("./widget-types");
const marketplace = require("./marketplace");
const imageProxy = require("./image-proxy");
const { readSettings, writeSettings } = require("./settings-store");
const { getLocation } = require("./location-service");
const placeSearch = require("./place-search");
const settingsHome = require("./settings-home");
const paths = require("./paths");
const { PLACE_SEARCH_SCRIPT, PLACE_SEARCH_CSS } = require("./place-search-ui");
const { ownLabel, suggestedLabel, labelsFor } = require("./instance-label");
const faceStore = require("./face-store");
const omnicoreVersion = require("./version");
const { refresh, stopFace } = require("./face-loader");
const notifications = require("./notifications");
const { displayCount } = require("./face-events");
const {
	uiStyles,
	backButton,
	rememberUiMode,
	currentUiMode,
	versionHtml,
	UI_MODE_SCRIPT,
	passwordField,
	PASSWORD_TOGGLE_SCRIPT,
	modeSwitch,
	MODE_SWITCH_SCRIPT,
	DIALOG_SCRIPT
} = require("./ui-theme");
const { portLinkScript, WIZARD_PORT } = require("./face-links");
const { askAttribute, ASK_FIRST_SCRIPT } = require("./ask-first");
const coreUpdater = require("./core-updater");
const updateStore = require("./update-store");
const installStore = require("./install-store");
const resourceScheduler = require("./resource-scheduler");
const fontService = require("./font-service");
const { startInputFace, stopInputFace, refreshInputFace } = require("./input-face-loader");
const background = require("./background");
const auth = require("./admin-auth");

const ADMIN_PORT = 3000;

// A name for this particular start of OmniCore. See GET /version.
const BOOT_ID = require("crypto").randomBytes(8).toString("hex");

const styles = `
	/* Layout only — background, colour, and font all come from the
	   shared Default UI stylesheet prepended in page() below. */
	body {
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

	/* The boxes themselves are .segment, from ui-theme.js. Only how a
	   heading and its description sit inside one is particular to the
	   settings pages. */
	.segment h2 { margin: 0 0 4px 0; font-size: 1.05em; font-weight: 600; }
	.segment .lede { margin: 0 0 14px 0; }

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

	/* Device: half dark, half light, since it's whichever the device
	   is set to */
	.mode-screen-split { display: flex; padding: 0; overflow: hidden; }
	.mode-screen-split > div { flex: 1; padding: 0.5em; }

	/* On a full-width row two previews would stretch into long strips;
	   kept to the size they are in a half-width box */
	.narrow-previews { max-width: 24em; }

	/* Corner map: the buttons sit where the thing they choose would
	   actually sit, so the choice is spatial rather than a list of
	   names to decode */
	.corner-map {
		position: relative;
		background: var(--well-bg);
		border: 1px solid var(--segment-border);
		border-radius: 0.625em;
		height: 118px;
		padding: 0.5em;
	}

	.corner-map button {
		position: absolute;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		border: 1px solid var(--glass-border);
		color: var(--fg-muted);
		border-radius: 0.5357em;
		padding: 0.5357em 0.8929em;
		font-family: inherit;
		font-size: 0.7em;
		cursor: pointer;
	}

	.corner-map button.active {
		background: var(--glass-bg-hover);
		color: var(--fg);
		box-shadow: inset 0 1px 0 var(--glass-sheen);
	}

	.corner-map button:disabled {
		color: var(--disabled-text);
		border-color: var(--segment-border);
		cursor: not-allowed;
	}

	.corner-tl { top: 8px; left: 8px; }
	.corner-tr { top: 8px; right: 8px; }
	.corner-bl { bottom: 8px; left: 8px; }
	.corner-br { bottom: 8px; right: 8px; }

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

	.inset-label { font-size: 0.7em; color: var(--fg-muted); }
	.inset-value { font-size: 0.85em; margin-top: 2px; }

	.link-segment { display: flex; flex-direction: column; gap: 8px; justify-content: center; }

	.link-row {
		display: block;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 0.625em;
		padding: 0.75em 0.875em;
		text-decoration: none;
		color: var(--fg);
		transition: background 0.2s ease, box-shadow 0.2s ease;
	}

	.link-row:hover,
	.link-row:focus-visible {
		background: var(--glass-bg-hover);
		box-shadow: 0 0 26px var(--glow-strong);
	}

	.link-row strong { display: block; font-size: 0.85em; }
	.link-row span { font-size: 0.72em; color: var(--fg-muted); }

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

	/* A face's facts: a label on the left, its value on the right, an
	   optional quieter line under the label explaining it */
	.facts { display: flex; flex-direction: column; margin-top: 10px; }

	.fact {
		display: grid;
		grid-template-columns: 1fr auto;
		column-gap: 1em;
		align-items: baseline;
		padding: 0.6em 0;
		border-top: 1px solid var(--segment-border);
	}

	.fact:first-child { border-top: none; }
	.fact-label { color: var(--fg-muted); font-size: 0.9em; }
	.fact-value { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
	.fact .hint { grid-column: 1 / -1; margin: 2px 0 0 0; }

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

	.update-progress[hidden] { display: none; }

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



	a { color: var(--fg); text-decoration: none; }

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

	/* Clickable rows get the same glass treatment as buttons, so anything
	   you can act on looks the same everywhere in OmniCore's own UI */
	a.row {
		position: relative;
		overflow: hidden;
		background: var(--glass-bg);
		border-color: var(--glass-border);
		backdrop-filter: blur(12px);
	}

	a.row:hover { background: var(--border); }

	a.row::before {
		content: "";
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, var(--glass-sheen), transparent
		);
		pointer-events: none;
	}


	/* Info order lists, short and long: see priority-ui.js */
	${priorityUi.PRIORITY_CSS}
	/* Under place search matches: see place-search-ui.js */
	${PLACE_SEARCH_CSS}

	${settingsHome.SETTINGS_HOME_CSS}

	/* The About tab: Check now and Update now side by side */
	.update-buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
	.update-buttons { align-items: center; }
	.update-buttons .glass-block { flex: 1 1 12em; width: auto; margin: 0; }
	.update-buttons + .hint, #apply + .hint { flex-basis: 100%; }

	/* Its release notes: each part side by side when there's room */
	#notes-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(20em, 1fr)); gap: 1.5em; }
	.notes-part h3 { margin: 0 0 0.6em; font-size: 1em; }

	/* Location Service's own boxes, under "Set it myself" */
	.location-manual { margin-top: 14px; }
	.location-manual[hidden] { display: none; }
	.update-ready { color: var(--fg); }

	/* Set the location: with the matches, the note and the credit
	   under the search box, it can be taller than the window, so it
	   scrolls rather than cutting Save off */
	#location-modal .modal { overflow-y: auto; }

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
	.backdrop-preview.plain { background: var(--bg); color: var(--fg-muted); font-size: 0.9em; }

	.button-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 4px; }
	.button-row .glass { padding: 0.65em 1.2em; }

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

	input[type="range"] { width: 100%; accent-color: var(--fg); }

	/* The Place search page: what's saved won't work as it reads */
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

	.place-warning[hidden] { display: none; }

	/* Its keys: whether one is saved, and where to get one */
	.key-row .search-row > :first-child { flex: 1; min-width: 0; }
	.key-row .help { margin-top: 6px; }
	.key-row .help a { color: inherit; }
	.key-state.saved { color: var(--success); }

	/* Its list of the services, one line each */
	.service-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
	.service-row { display: flex; flex-direction: column; gap: 2px; font-size: 0.9em; line-height: 1.5; }
	.service-row span { color: var(--fg-muted); }
	.service-row a { color: inherit; }




	/* Explanatory text under a control — quieter than the label it
	   belongs to, for the "why" rather than the "what" */
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

	.hint {
		display: block;
		color: var(--fg-muted);
		font-size: 13px;
		margin: 4px 0 8px 0;
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

	/* Search, Modules / Themes and the count stay pinned at the top while
	   the listings scroll under them. Frosted, not solid: the rows passing
	   underneath are blurred out, so they never collide with the search
	   text. The tint is the page's own background colour mixed in, so it
	   works in light and dark without a colour of its own. */
	.market-toolbar {
		position: sticky;
		top: 1em;
		z-index: 5;
		background:
			linear-gradient(
				color-mix(in srgb, var(--bg) 55%, transparent),
				color-mix(in srgb, var(--bg) 55%, transparent)
			),
			var(--segment-bg);
		backdrop-filter: blur(0.75em);
		-webkit-backdrop-filter: blur(0.75em);
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

	/* Hidden by the search box, not removed, so nothing reflows
	   unexpectedly while typing */
	.market-item[hidden] { display: none; }

	.market-item-text { min-width: 0; }
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
	.glass-block { display: block; width: 100%; box-sizing: border-box; }
`;

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, function (character) {
		return {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;"
		}[character];
	});
}

// Every admin screen goes through here, so this is the one place the
// shared Default UI gets attached — uiStyles() first, then this face's
// own layout rules on top, so a page-specific rule can always override
// a shared one rather than fighting source order.
//
// `back` is a URL for the floating button, or nothing at all for a
// screen that is genuinely a root. `backLabel`, when given, replaces
// the default arrow with text and switches to the pill shape — see
// ui-theme.js's backButton().
// What Delete face's question says goes with the face. Said plainly,
// because there's no undo: how many widgets, and what happens to a
// screen that's showing it.
function deleteWarning(face) {
	const count = face.instances.length;
	const widgets = count
		? `Its ${count === 1 ? "widget" : count + " widgets"} and everything ${count === 1 ? "it has" : "they have"} saved go with it.`
		: "It has no widgets.";

	return `${widgets} A screen showing it goes back to the welcome page. This can't be undone.`;
}

// "1 screen", "3 screens", "No screens right now"
function screensText(count) {
	if (!count) return "No screens right now";
	return count + (count === 1 ? " screen" : " screens");
}

// What a face IS, for the top of its page: its number, its two ports,
// how many screens are showing it, and how its Inport is laid out.
//
// The Inport's "branches": its root (2001/) is the picker, and every
// module instance that takes input gets a branch of its own under it
// (2001/<instance>). So the branch count is the number of instances
// that take input. A face with none has no Inport listening at all,
// which is said once instead of as two empty lines.
//
// `id` marks the value the page keeps up to date by itself.
function faceFacts(face) {
	const branches = face.instances.filter(
		(instance) => readInputSchema(instance.module).length > 0
	).length;

	const facts = [
		{ label: "Face ID", value: faceStore.faceNumber(face.id) },
		{ label: "Outport", value: String(faceStore.outportFor(face.id)) },
		{
			label: "Showing on",
			value: screensText(displayCount(face.id)),
			hint: "OmniViews and browser tabs with this face open",
			id: "display-count"
		}
	];

	if (branches) {
		facts.push(
			{ label: "Inport", value: String(faceStore.inportFor(face.id)) },
			{
				label: "Inport branches",
				value: String(branches),
				hint: branches === 1
					? "One module takes input, so its controls open straight away"
					: "One per module that takes input, picked from the Inport's first page"
			}
		);
	} else {
		facts.push({
			label: "Inport",
			value: "None",
			hint: "Nothing on this face takes input, so no Inport is listening"
		});
	}

	return facts;
}

// Turns a changelog entry into safe HTML.
//
// Deliberately not a Markdown library: this handles exactly the three
// things our own changelog uses (### headings, - bullets, **bold**)
// and escapes everything first, so text fetched over the network can
// never inject markup. A general parser would be more capable and a
// much larger thing to trust with remote input.
function renderNotes(markdown) {
	const lines = escapeHtml(markdown).split("\n");
	const html = [];
	let inList = false;

	const closeList = () => {
		if (inList) {
			html.push("</ul>");
			inList = false;
		}
	};

	for (const line of lines) {
		// **bold** and `code`. The text is already escaped above, so what's
		// inside the backticks can't become HTML.
		const bolded = line
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/`([^`]+)`/g, "<code>$1</code>");

		if (/^### /.test(line)) {
			closeList();
			html.push(`<h3>${bolded.replace(/^### /, "")}</h3>`);
			continue;
		}

		if (/^- /.test(line)) {
			if (!inList) {
				html.push("<ul>");
				inList = true;
			}
			html.push(`<li>${bolded.replace(/^- /, "")}</li>`);
			continue;
		}

		if (line.trim() === "") {
			closeList();
			continue;
		}

		closeList();
		html.push(`<p>${bolded}</p>`);
	}

	closeList();
	return html.join("\n");
}

// Dates on admin pages are written as <time datetime="..."> and turned
// into words by the browser, not the server: OmniCore usually runs in a
// container whose clock is UTC, and a time shown in UTC reads as wrong to
// anyone who isn't there. The browser knows where its viewer is.
//
//   data-local  "Oct 8, 2026, 4:12 PM"
//   data-ago    "3 hours ago" (the full date on hover)
//
// Whatever the server wrote inside the tag stays if this never runs.
function localTime(iso, style) {
	if (!iso) {
		return "";
	}

	return `<time data-${style === "ago" ? "ago" : "local"} datetime="${escapeHtml(iso)}">${escapeHtml(
		String(iso).slice(0, 10)
	)}</time>`;
}

const localTimeScript = `
	(function () {
		function ago(date) {
			var seconds = Math.round((Date.now() - date.getTime()) / 1000);
			if (seconds < 60) return "just now";
			var minutes = Math.round(seconds / 60);
			if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
			var hours = Math.round(minutes / 60);
			if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
			var days = Math.round(hours / 24);
			return days + (days === 1 ? " day ago" : " days ago");
		}

		var full = { dateStyle: "medium", timeStyle: "short" };

		document.querySelectorAll("time[data-local], time[data-ago]").forEach(function (element) {
			var date = new Date(element.getAttribute("datetime"));
			if (isNaN(date.getTime())) return;

			if (element.hasAttribute("data-ago")) {
				element.textContent = ago(date);
				element.title = date.toLocaleString(undefined, full);
			} else {
				element.textContent = date.toLocaleString(undefined, full);
			}
		});
	})();
`;

function page(title, body, script, bodyClass, back, backLabel) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${uiStyles()}${styles}</style>
</head>
<body class="${bodyClass || ""}">
${pageStart()}
	${body}
	${backButton(back, backLabel)}
	<script>${UI_MODE_SCRIPT}${PASSWORD_TOGGLE_SCRIPT}${DIALOG_SCRIPT}${script || ""}${ASK_FIRST_SCRIPT}</script>
</body>
</html>`;
}

// One line describing how location is set up, for the settings list
// Shared by every page that renders a settings form: show or hide the
// coordinate boxes as the radio changes, and read location fields back out
const conditionalScript = `
	// Show or hide fields that depend on another field's value, and keep
	// doing so as that value changes.
	//
	// A checkbox's .value is always "on", ticked or not, so for one of
	// those it's whether it's ticked that counts, as "true" or "false".
	// That's what a showWhen of { "equals": true } turns into once it's
	// written into the page.
	function applyFieldConditions() {
		for (const field of document.querySelectorAll("[data-when-key]")) {
			const control = document.querySelector(
				'[data-key="' + CSS.escape(field.dataset.whenKey) + '"]'
			);

			if (!control) continue;

			const current = control.type === "checkbox"
				? String(control.checked)
				: control.value;

			const allowed = field.dataset.whenIs.split("|");
			field.style.display = allowed.indexOf(current) === -1 ? "none" : "";
		}
	}

	for (const control of document.querySelectorAll("[data-key]")) {
		control.addEventListener("change", applyFieldConditions);
	}

	applyFieldConditions();
`;

const locationScript = `
	// Look a city up and offer the matches. Clicking one fills in the
	// coordinate boxes — the stored value is still just coordinates. The
	// matches, the note and the credit are drawn by findPlaces
	// (place-search-ui.js), shared with the settings page and the wizard.
	${PLACE_SEARCH_SCRIPT}

	function searchCity(key) {
		const query = document.querySelector('[data-loc-query="' + key + '"]').value;
		const results = document.querySelector('[data-loc-results="' + key + '"]');

		return findPlaces(query, results, function (place) {
			document.querySelector('[data-loc-lat="' + key + '"]').value = place.latitude;
			document.querySelector('[data-loc-lon="' + key + '"]').value = place.longitude;
			document.querySelector('[data-loc-query="' + key + '"]').value = place.label;
		});
	}

	for (const box of document.querySelectorAll("[data-loc-query]")) {
		box.addEventListener("keydown", function (event) {
			if (event.key === "Enter") {
				event.preventDefault();
				searchCity(this.dataset.locQuery);
			}
		});
	}

	for (const radio of document.querySelectorAll("[data-loc]")) {
		radio.addEventListener("change", function () {
			const fields = document.querySelector(
				'[data-loc-fields="' + this.dataset.loc + '"]'
			);
			if (fields) fields.style.display = this.value === "manual" ? "" : "none";
		});
	}

	function collectLocations(into) {
		const seen = {};

		for (const radio of document.querySelectorAll("[data-loc]")) {
			const key = radio.dataset.loc;
			if (seen[key] || !radio.checked) continue;
			seen[key] = true;

			if (radio.value === "manual") {
				into[key] = {
					mode: "manual",
					latitude: document.querySelector('[data-loc-lat="' + key + '"]').value,
					longitude: document.querySelector('[data-loc-lon="' + key + '"]').value
				};
			} else {
				into[key] = { mode: "core" };
			}
		}
	}
`;

// Reordering a priority list (an Info order): the arrows, dragging, and
// the pop-up for a long list. The same code as the wizard's; see
// priority-ui.js.
const priorityScript = priorityUi.PRIORITY_SCRIPT;

function notFound(heading, backHref, backLabel) {
	return page(
		"Not found",
		`<div class="bento narrow">
			<div class="segment">
				<h1 style="margin-bottom:14px">${escapeHtml(heading)}</h1>
				<a class="row" href="${backHref}">
					<strong>${escapeHtml(backLabel)}</strong>
					<span>Go back there</span>
				</a>
			</div>
		</div>`,
		"",
		"",
		backHref
	);
}

// The red-edged box shown when the registry can't be read: what went
// wrong, and a way to try again. The Marketplace home shows it under its
// header; every other Marketplace page that needs the registry shows it
// on its own, through registryUnreachable below.
function marketErrorBanner(message) {
	return `
		<div class="segment market-error">
			<div>
				<h2>Can't reach the registry</h2>
				<p class="lede">${escapeHtml(message)}</p>
			</div>
			<button type="button" class="glass market-action" onclick="location.reload()">Retry</button>
		</div>`;
}

// The page shown when the registry couldn't be read, on any marketplace
// page that needs it
function registryUnreachable(message) {
	return page(
		"Marketplace",
		`<div class="market reading">${marketErrorBanner(message)}</div>`,
		"",
		"",
		"/marketplace"
	);
}

// Turn declared settings into form fields.
//
// `context` carries anything a field type needs that the schema can't know
// on its own — right now that's the face's instances, so a theme can ask
// which module should feed something like a wallpaper, and `labels`, what
// each of them is called (see instance-label.js), so the list names them
// the way every other page does.
// What decides whether a setting is shown, written onto whatever holds
// it: a .field, or the box of its own an Info order gets on a widget's
// page.
//
// A field can depend on another one: no point showing a gradient's
// second colour when the background isn't a gradient.
//
// A field that only belongs to some widget types says which, so the
// picker at the top of the page can hide it while another type is
// picked. See widget-types.js.
function fieldAttributes(field) {
	const condition = field.showWhen
		? ` data-when-key="${escapeHtml(field.showWhen.key)}" ` +
		  `data-when-is="${escapeHtml(
				[].concat(field.showWhen.equals).join("|")
		  )}"`
		: "";

	return condition + widgetTypes.widgetsAttribute(field);
}

function renderFields(schema, config, context, scope) {
	const owner = scope || "module";

	return schema
		.map((field) => {
			const value = config[field.key];
			const help = field.help
				? `<div class="help">${escapeHtml(field.help)}</div>`
				: "";

			let input;

			if (field.type === "color") {
				input =
					`<input type="color" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" ` +
					`data-type="color" value="${escapeHtml(value || "#000000")}">`;
			} else if (field.type === "instance") {
				// A theme naming an instance is a placement decision, not a
				// content one — the module doesn't know or care that it's
				// being used as a wallpaper.
				//
				// Only modules that declared they can produce what the field
				// asks for are offered. No point listing Docker as a
				// possible wallpaper.
				const instances = ((context && context.instances) || []).filter(
					(instance) => {
						if (!field.provides) return true;

						return readManifest(instance.module).provides.includes(
							field.provides
						);
					}
				);

				const options = instances
					.map(
						(instance) =>
							`<option value="${escapeHtml(instance.id)}" ` +
							`${instance.id === value ? "selected" : ""}>` +
							`${escapeHtml(
								(context.labels && context.labels[instance.id]) ||
									instance.label ||
									instance.module
							)}</option>`
					)
					.join("");

				input =
					`<select data-key="${escapeHtml(field.key)}" data-scope="${owner}" ` +
					`data-type="instance">` +
					`<option value="" ${value ? "" : "selected"}>None</option>` +
					options +
					"</select>";
			} else if (field.type === "location") {
				// Two choices: lean on OmniCore's location, or type in
				// coordinates for this instance specifically. The second is
				// what makes two weather tiles for two cities possible.
				const stored = value || { mode: "core" };
				const manual = stored.mode === "manual";

				input = `
					<label class="option">
						<input type="radio" name="loc-${escapeHtml(field.key)}"
							data-loc="${escapeHtml(field.key)}" value="core"
							${manual ? "" : "checked"}>
						<span>Use OmniCore's location</span>
					</label>
					<label class="option">
						<input type="radio" name="loc-${escapeHtml(field.key)}"
							data-loc="${escapeHtml(field.key)}" value="manual"
							${manual ? "checked" : ""}>
						<span>Set coordinates here</span>
					</label>
					<div data-loc-fields="${escapeHtml(field.key)}"
						style="${manual ? "" : "display:none"};margin-top:10px">
						<div class="field">
							<label>Search for a city</label>
							<div class="search-row">
								<input type="text" data-loc-query="${escapeHtml(field.key)}"
									placeholder="Regina">
								<button class="glass" style="width:auto;padding:0.75em 1.25em"
									onclick="searchCity('${escapeHtml(field.key)}')">Search</button>
							</div>
							<div data-loc-results="${escapeHtml(field.key)}"></div>
						</div>
						<div class="field">
							<label>Latitude</label>
							<input type="number" step="any"
								data-loc-lat="${escapeHtml(field.key)}"
								value="${escapeHtml(
									manual && stored.latitude !== undefined
										? stored.latitude
										: ""
								)}">
						</div>
						<div class="field">
							<label>Longitude</label>
							<input type="number" step="any"
								data-loc-lon="${escapeHtml(field.key)}"
								value="${escapeHtml(
									manual && stored.longitude !== undefined
										? stored.longitude
										: ""
								)}">
						</div>
					</div>`;
			} else if (field.type === "priority") {
				// The user's own answer to "what matters most here". What
				// sits at the top survives to the smallest tile; the rest
				// appear as the tile gets bigger.
				//
				// Normalising before rendering means a module that has
				// gained or lost an item since this was last saved still
				// shows a complete, current list.
				const order = priority.normalize(value, field.options);

				// Up to four: the rows themselves. More: a button saying
				// the order in short form, which opens the whole list in a
				// pop-up. See priority-ui.js.
				input = priorityUi.priorityFieldHtml(field, order, owner, escapeHtml);
			} else if (field.type === "boolean") {
				input =
					`<input type="checkbox" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" ` +
					`data-type="boolean" ${value ? "checked" : ""}>`;
			} else if (field.type === "select") {
				const options = (field.options || [])
					.map(
						(option) =>
							`<option value="${escapeHtml(option)}" ` +
							`${option === value ? "selected" : ""}>` +
							`${escapeHtml(option)}</option>`
					)
					.join("");

				// An option that needs something first (an API key) asks
				// for it when picked. See ask-first.js.
				input =
					`<select data-key="${escapeHtml(field.key)}" data-scope="${owner}" ` +
					`data-type="select"${askAttribute(field, escapeHtml)}>${options}</select>`;
			} else {
				// text, url, number, password all render as an input
				const type = ["url", "number", "password"].includes(field.type)
					? field.type
					: "text";

				// A module's refresh setting can't go under a minute (see
				// module-config.js); the box says so too, so the browser's
				// own arrows stop there
				const refresh = owner === "module" && isRefreshField(field);
				const min = refresh ? ` min="${REFRESH_FLOOR}"` : "";

				input =
					`<input type="${type}" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" ` +
					`data-type="${escapeHtml(field.type)}"${min} ` +
					`value="${escapeHtml(value === undefined ? "" : value)}">`;

				// A password gets the Show / Hide button inside its box
				if (type === "password") {
					input = passwordField(input);
				}

				// A number with a unit gets it beside the box, on one line.
				// The refresh setting's unit is always minutes.
				const unit = refresh
					? "minutes"
					: type === "number" && typeof field.unit === "string"
					? field.unit.trim()
					: "";

				if (unit) {
					input =
						`<div class="unit-row">${input}` +
						`<span class="unit">${escapeHtml(unit)}</span></div>`;
				}
			}

			// When it's shown: see fieldAttributes below
			const attributes = fieldAttributes(field);

			// The refresh setting is worded by Core, the same for every
			// module: "Refresh every [ 10 ] minutes"
			const label =
				owner === "module" && isRefreshField(field)
					? "Refresh every"
					: field.label || field.key;

			return `
				<div class="field"${attributes}>
					<label>${escapeHtml(label)}</label>
					${input}
					${help}
				</div>`;
		})
		.join("");
}

// Shared by the setup and login pages — both are a username, a password,
// and one button
function credentialsPage(options) {
	const body = `
		<div class="bento narrow">
			<div class="segment">
				<h1>${escapeHtml(options.heading)}</h1>
				<p class="lede" style="margin-bottom:20px">${escapeHtml(options.lede)}</p>
				<div class="field">
					<label for="username">Username</label>
					<input type="text" id="username" autocomplete="username">
				</div>
				<div class="field">
					<label for="password">Password</label>
					${passwordField(
						`<input type="password" id="password" autocomplete="${
							options.isSetup ? "new-password" : "current-password"
						}">`
					)}
				</div>
				<div class="segment-actions">
					<button class="glass glass-block" id="submit">${escapeHtml(options.button)}</button>
					<p class="status" id="status"></p>
				</div>
			</div>
		</div>
		${modeSwitch()}`;

	const script = `
		${MODE_SWITCH_SCRIPT}

		const endpoint = ${JSON.stringify(options.endpoint)};
		const status = document.getElementById("status");
		const button = document.getElementById("submit");

		async function submit() {
			const username = document.getElementById("username").value;
			const password = document.getElementById("password").value;

			button.disabled = true;
			status.textContent = "";
			status.className = "status";

			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ username, password })
				});

				const result = await response.json();

				if (!response.ok) {
					status.textContent = result.error || "That didn't work.";
					status.className = "status bad";
					button.disabled = false;
					return;
				}

				// Signing in shows the page that asked for it. This screen
				// stands in for whatever page was requested while signed
				// out -- /updates after an update restarted OmniCore, say
				// -- so reloading the same address is that page. Except
				// signing out, which would just sign out again.
				if (location.pathname === "/logout") {
					omniGo("/");
				} else {
					location.reload();
				}
			} catch (error) {
				status.textContent = "Couldn't reach OmniCore.";
				status.className = "status bad";
				button.disabled = false;
			}
		}

		button.addEventListener("click", submit);

		// Enter submits, from either field
		for (const field of document.querySelectorAll("input")) {
			field.addEventListener("keydown", function (event) {
				if (event.key === "Enter") submit();
			});
		}
	`;

	return page(options.heading, body, script, "centered");
}

// The Background and Frosted glass boxes, and what makes them work: the
// Appearance tab of the settings home draws them (since v2 they were a
// page of their own, /background, which now opens that tab). Returns the
// two boxes as HTML and the script behind both.
function backgroundPanel(settings) {
	const picture = backdropStore.hasPicture(settings);
	const tint = settings.glassTint || "none";
	const uiMode = currentUiMode();

	const kindName = {
		picture: "A picture",
		animated: "An animated picture",
		video: "A video"
	}[settings.backgroundKind];

	const preview = picture
		? `<img src="/backdrop/${escapeHtml(settings.backgroundStill || settings.backgroundFile)}" alt="">`
		: `<span>Plain</span>`;

	// A colour chip for the tint. "none" and "match" are words, the
	// rest colours. Match the picture only with a picture, showing
	// the picture's own colour.
	const chip = (value, label, colour, disabled) =>
		`<button type="button" class="tint-chip${tint === value ? " active" : ""}" data-tint="${escapeHtml(value)}"` +
		`${disabled ? " disabled" : ""} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"` +
		` aria-pressed="${tint === value ? "true" : "false"}">` +
		(colour ? `<span class="tint-swatch" style="background:${escapeHtml(colour)}"></span>` : "") +
		(value === "none" || value === "match" ? `<span>${escapeHtml(label)}</span>` : "") +
		"</button>";

	const custom = /^#[0-9a-f]{6}$/i.test(tint) && !backdropStore.TINT_PRESETS.includes(tint.toLowerCase());

	const backgroundBox = `
				<div class="segment c4 r2" id="background">
					<h2>Background</h2>
					<p class="lede">
						Behind OmniCore's own pages: these settings, the setup
						wizard, the welcome screen and About. A face keeps its
						theme's own background.
					</p>

					<div class="backdrop-preview${picture ? "" : " plain"}" id="preview">${preview}</div>
					<p class="hint" id="kind">${
						picture ? escapeHtml(kindName || "A picture") : "Plain: black, or light grey in light mode."
					}</p>

					<div class="button-row">
						<button type="button" class="glass" id="choose">Choose a file</button>
						${picture ? `<button type="button" class="glass" id="plain">Back to plain</button>` : ""}
					</div>
					<input type="file" id="file" hidden
						accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm">
					<p class="status" id="upload-status" aria-live="polite"></p>

					<p class="help">
						A picture (JPEG, PNG, WebP), an animated GIF or WebP, or a
						looping video (MP4, WebM) without sound, up to 50 MB. A video
						looks sharper than a GIF. It's kept in OmniCore's data folder
						and shown by OmniCore itself, never sent anywhere, and it's
						seen on the pages that need no sign-in too. With reduced
						motion turned on in your device's settings, a still frame is
						shown instead.
					</p>
				</div>
`;

	const glassBox = `
				<div class="segment c4" id="glass">
					<h2>Frosted glass</h2>
					<p class="lede">Every box on these pages, over the background.</p>

					<div class="field">
						<label for="blur">Blur <span class="muted" id="blur-value">${Number(settings.glassBlur)} px</span></label>
						<input type="range" id="blur" min="0" max="${backdropStore.BLUR_MOST}" step="1"
							value="${Number(settings.glassBlur)}">
					</div>

					<div class="field">
						<label>Tint</label>
						<div class="tint-chips" id="tints">
							${chip("none", "None", "", false)}
							${chip("match", "Match the picture", picture && settings.backgroundColor ? settings.backgroundColor : "", !picture)}
							${backdropStore.TINT_PRESETS.map((colour) => chip(colour, colour, colour, false)).join("")}
							<label class="tint-chip tint-custom${custom ? " active" : ""}" title="Pick a colour">
								<input type="color" id="custom" value="${escapeHtml(custom ? tint : "#7aa2ff")}" aria-label="Pick a colour">
							</label>
						</div>
						<div class="help">${
							picture
								? "Match the picture takes the picture's main colour, worked out once when it was picked."
								: "Match the picture needs a picture."
						}</div>
					</div>

					<div class="field">
						<label for="strength">Tint strength <span class="muted" id="strength-value">${Number(settings.glassTintStrength)}%</span></label>
						<input type="range" id="strength" min="0" max="${backdropStore.TINT_STRENGTH_MOST}" step="1"
							value="${Number(settings.glassTintStrength)}">
					</div>

					${
						picture
							? `<div class="field">
						<label for="brightness">Picture brightness <span class="muted" id="brightness-value">${Number(settings.backgroundBrightness)}%</span></label>
						<input type="range" id="brightness" min="${backdropStore.BRIGHTNESS_LEAST}" max="${backdropStore.BRIGHTNESS_MOST}" step="1"
							value="${Number(settings.backgroundBrightness)}">
						<div class="help">
							The picture is dimmed by itself, just enough for text to read
							over it: <span id="dim-value"></span>.
						</div>
					</div>`
							: ""
					}
					<p class="status" id="glass-status" aria-live="polite"></p>
				</div>
`;

	const script = `
		// How the veil is worked out, the same function the server uses
		// (backdrop.js), so what's previewed is what's saved
		${backdropStore.autoDim.toString()}

		const PICTURE = ${JSON.stringify(
			picture
				? { low: settings.backgroundLow, high: settings.backgroundHigh, color: settings.backgroundColor || "" }
				: null
		).replace(/</g, "\\u003c")};
		const MAX_BYTES = ${backdropStore.MAX_BYTES};

		let tint = ${JSON.stringify(tint)};

		const root = document.documentElement;
		const blur = document.getElementById("blur");
		const strength = document.getElementById("strength");
		const brightness = document.getElementById("brightness");
		const custom = document.getElementById("custom");

		// Light or dark: this browser's own choice, or the device's when
		// it hasn't made one
		function light() {
			return ${
				uiMode
					? JSON.stringify(uiMode === "light")
					: 'window.matchMedia("(prefers-color-scheme: light)").matches'
			};
		}

		function rgba(hex, alpha) {
			const value = parseInt(hex.slice(1), 16);
			return "rgba(" + ((value >> 16) & 255) + ", " + ((value >> 8) & 255) + ", " + (value & 255) + ", " + alpha + ")";
		}

		// Everything moved shows at once on this page, before saving
		function preview() {
			document.getElementById("blur-value").textContent = blur.value + " px";
			document.getElementById("strength-value").textContent = strength.value + "%";
			root.style.setProperty("--glass-blur", blur.value + "px");

			const colour = tint === "match" ? (PICTURE && PICTURE.color) : (tint === "none" ? "" : tint);
			root.style.setProperty(
				"--glass-tint",
				colour && Number(strength.value) ? rgba(colour, Number(strength.value) / 100) : "transparent"
			);

			if (brightness && PICTURE) {
				document.getElementById("brightness-value").textContent = brightness.value + "%";
				root.style.setProperty("--backdrop-brightness", Number(brightness.value) / 100);
				const dim = autoDim(PICTURE.low, PICTURE.high, brightness.value, light());
				root.style.setProperty(
					"--backdrop-dim",
					light() ? "rgba(242, 242, 244, " + dim + ")" : "rgba(0, 0, 0, " + dim + ")"
				);
				document.getElementById("dim-value").textContent =
					"a veil of " + Math.round(dim * 100) + "% at this brightness";
			}

			for (const chip of document.querySelectorAll("[data-tint]")) {
				const on = chip.dataset.tint === tint;
				chip.classList.toggle("active", on);
				chip.setAttribute("aria-pressed", on ? "true" : "false");
			}
			document.querySelector(".tint-custom").classList.toggle(
				"active",
				/^#/.test(tint) && !document.querySelector('[data-tint="' + tint + '"]')
			);
		}

		for (const input of [blur, strength, brightness]) {
			if (input) input.addEventListener("input", preview);
		}

		document.getElementById("tints").addEventListener("click", function (event) {
			const chip = event.target.closest("[data-tint]");
			if (!chip || chip.disabled) return;
			tint = chip.dataset.tint;
			// Picking a colour with the strength at nothing would show
			// nothing; give it a little
			if (tint !== "none" && Number(strength.value) === 0) strength.value = 12;
			preview();
			save();
		});

		custom.addEventListener("input", function () {
			tint = custom.value.toLowerCase();
			if (Number(strength.value) === 0) strength.value = 12;
			preview();
		});
		custom.addEventListener("change", save);

		preview();

		// Saved as it changes: a slider when it's let go, a tint when
		// it's picked. A moment's wait, so dragging a slider across
		// sends one save, not twenty.
		let saving = null;
		function save() {
			clearTimeout(saving);
			saving = setTimeout(async function () {
				const status = document.getElementById("glass-status");
				status.className = "status";
				try {
					const response = await fetch("/background/glass", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							blur: Number(blur.value),
							tint: tint,
							tintStrength: Number(strength.value),
							brightness: brightness ? Number(brightness.value) : undefined
						})
					});
					if (!response.ok) throw new Error();
					status.textContent = "Saved.";
				} catch (error) {
					status.className = "status bad";
					status.textContent = "Couldn't save.";
				}
			}, 300);
		}

		for (const input of [blur, strength, brightness]) {
			if (input) input.addEventListener("change", save);
		}

		// --- Picking a file ------------------------------------------

		const upload = document.getElementById("upload-status");

		function say(text, bad) {
			upload.className = "status" + (bad ? " bad" : "");
			upload.textContent = text;
		}

		// Waits for an element's event, or gives up after a while
		function once(element, name, seconds) {
			return new Promise(function (resolve, reject) {
				const timer = setTimeout(function () { reject(new Error("timeout")); }, seconds * 1000);
				element.addEventListener(name, function () { clearTimeout(timer); resolve(); }, { once: true });
				element.addEventListener("error", function () { clearTimeout(timer); reject(new Error("error")); }, { once: true });
			});
		}

		// How bright a colour looks, 0-1 (relative luminance)
		function luminance(r, g, b) {
			function channel(value) {
				const c = value / 255;
				return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
			}
			return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
		}

		// Draw the picture, or a frame a second into the video, then
		// work out its main colour, how dark its darker parts and how
		// bright its brighter parts are, and a still frame. Done here,
		// once, from the file on this device, before anything is sent.
		async function study(file) {
			const address = URL.createObjectURL(file);
			let source;
			let width;
			let height;

			try {
				if (file.type.indexOf("video/") === 0) {
					const video = document.createElement("video");
					video.muted = true;
					video.playsInline = true;
					video.preload = "auto";
					video.src = address;
					await once(video, "loadeddata", 20);
					video.currentTime = Math.min(1, (video.duration || 2) / 2);
					await once(video, "seeked", 20);
					source = video;
					width = video.videoWidth;
					height = video.videoHeight;
				} else {
					const image = new Image();
					image.src = address;
					await image.decode();
					source = image;
					width = image.naturalWidth;
					height = image.naturalHeight;
				}

				if (!width || !height) throw new Error("empty");

				// The still frame, at most 1920 px wide
				const scale = Math.min(1, 1920 / width);
				const frame = document.createElement("canvas");
				frame.width = Math.round(width * scale);
				frame.height = Math.round(height * scale);
				frame.getContext("2d").drawImage(source, 0, 0, frame.width, frame.height);
				const still = await new Promise(function (resolve) {
					frame.toBlob(resolve, "image/jpeg", 0.85);
				});

				// A small copy to read the colours from
				const small = document.createElement("canvas");
				small.width = 48;
				small.height = 48;
				const context = small.getContext("2d", { willReadFrequently: true });
				context.drawImage(source, 0, 0, 48, 48);
				const pixels = context.getImageData(0, 0, 48, 48).data;

				const shades = [];
				const buckets = {};
				for (let i = 0; i < pixels.length; i += 4) {
					const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
					shades.push(luminance(r, g, b));
					const key = (r >> 5) + "," + (g >> 5) + "," + (b >> 5);
					const bucket = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
					bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
				}
				shades.sort(function (a, b) { return a - b; });

				// Its main colours: the four most common, averaged by how
				// common each is
				const main = Object.values(buckets).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
				const total = main.reduce(function (sum, bucket) { return sum + bucket.n; }, 0);
				const average = ["r", "g", "b"].map(function (part) {
					return Math.round(main.reduce(function (sum, bucket) { return sum + bucket[part]; }, 0) / total);
				});
				const color = "#" + average.map(function (value) {
					return value.toString(16).padStart(2, "0");
				}).join("");

				return {
					still: still,
					color: color,
					low: shades[Math.floor(shades.length * 0.1)],
					high: shades[Math.floor(shades.length * 0.9)]
				};
			} finally {
				URL.revokeObjectURL(address);
			}
		}

		async function send(address, body) {
			const response = await fetch(address, {
				method: "POST",
				headers: { "Content-Type": "application/octet-stream" },
				body: body
			});
			const answer = await response.json().catch(function () { return {}; });
			if (!response.ok) {
				throw new Error(answer.error || (response.status === 413 ? "That file is bigger than 50 MB." : "Couldn't send it."));
			}
			return answer;
		}

		document.getElementById("choose").addEventListener("click", function () {
			document.getElementById("file").click();
		});

		document.getElementById("file").addEventListener("change", async function () {
			const file = this.files[0];
			this.value = "";
			if (!file) return;

			if (file.size > MAX_BYTES) {
				say("That file is bigger than 50 MB.", true);
				return;
			}

			document.getElementById("choose").disabled = true;

			try {
				say("Looking at it…");
				let about;
				try {
					about = await study(file);
				} catch (error) {
					throw new Error(
						"This browser can't show that file, so it can't be the background. " +
						"JPEG, PNG, GIF, WebP, MP4 and WebM work; a video has to be in a format browsers play (H.264 or VP9, say)."
					);
				}

				say("Sending it…");
				const received = await send("/background/upload", file);
				await send("/background/still?id=" + encodeURIComponent(received.id), about.still);

				const response = await fetch("/background/use", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id: received.id, color: about.color, low: about.low, high: about.high })
				});
				const answer = await response.json().catch(function () { return {}; });
				if (!response.ok) throw new Error(answer.error || "Couldn't use it.");

				say("Done.");
				location.reload();
			} catch (error) {
				say(error.message, true);
				document.getElementById("choose").disabled = false;
			}
		});

		const plain = document.getElementById("plain");
		if (plain) {
			plain.addEventListener("click", async function () {
				const sure = await confirmDialog({
					title: "Back to plain?",
					text: "The picture is deleted from OmniCore's data folder.",
					confirm: "Back to plain"
				});
				if (!sure) return;
				const response = await fetch("/background/plain", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{}"
				});
				if (response.ok) location.reload();
				else say("Couldn't change it.", true);
			});
		}
	`;

	return { backgroundBox, glassBox, script };
}

// The About tab's updates. Until v2 they were a page of their own,
// /updates; that address now opens the tab:
//
//   aboutBox    which OmniCore this is: version, port, data folder, and
//               since when it's been running
//   updatesBox  what the last check found, Check now, Update now, and the
//               install followed through OmniCore restarting
//   notesBox    the release notes, filled in after the page has opened
//               from /updates/notes, so opening Settings never waits on
//               GitHub
//
// A development build (npm start from a clone, or a :dev image) isn't a
// release: there's nothing for it to be compared with, so it has no
// checking, only what's in it. Its version is the source's own.
async function updatesPanel() {
	const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
	const last = updateStore.lastResult(running);
	const offered = Boolean(last.updateAvailable && last.latestVersion);
	const dev = omnicoreVersion.isDevBuild();

	const [since, readiness] = await Promise.all([
		dev ? Promise.resolve(null) : coreUpdater.runningSince(),
		offered ? coreUpdater.applyReadiness() : Promise.resolve(null)
	]);

	// An update already under way when the page opened -- started by
	// the scheduler, or from another tab. The page picks it up and
	// follows it rather than offering to start a second one.
	const underWay = coreUpdater.currentProgress().busy;

	const when = (iso) => (iso ? localTime(iso) : "Unknown");

	const status = dev
		? `<p class="lede">A development build doesn't check for updates. Its notes below say what's in it, and what isn't released yet.</p>`
		: !last.lastCheckedAt
		? `<p class="lede">No check has run yet.</p>`
		: !last.lastCheckSucceeded
		? `<p class="lede">Last check failed: ${escapeHtml(
				last.lastCheckError || "unknown error"
		  )}</p>`
		: offered
		? `<p class="lede update-ready"><strong>Version ${escapeHtml(
				last.latestVersion
		  )} is available.</strong> It installs on its own, usually within six hours, or you can install it now.</p>`
		: `<p class="lede">This is the newest version.</p>`;

	// Only when there's something to install. Without the Docker
	// socket it's there but can't be pressed, with the reason under it,
	// so it's clear why the update hasn't happened rather than looking
	// forgotten.
	const applyButton = !offered
		? ""
		: readiness && readiness.ready
		? `<button class="glass glass-block" id="apply">Update to ${escapeHtml(
				last.latestVersion
		  )} now</button>`
		: `<button class="glass glass-block" id="apply" disabled>Update to ${escapeHtml(
				last.latestVersion
		  )} now</button>
		  <span class="hint">${escapeHtml(
				(readiness && readiness.reason) || "This OmniCore can't install updates itself."
		  )}</span>`;

	const aboutBox = `
		<div class="segment c2">
			<h2>OmniCore</h2>
			<div class="fact"><span>Version</span><span>OmniCore ${versionHtml()}</span></div>
			<div class="fact"><span>Port</span><span>${ADMIN_PORT}</span></div>
			<div class="fact"><span>Data folder</span><span>${escapeHtml(paths.dataDir())}</span></div>
			${dev ? "" : `<div class="fact"><span>Running since</span><span>${when(since)}</span></div>`}
			<div class="button-row">
				<a class="glass" id="about-link" href="#">System info</a>
			</div>
		</div>`;

	const updatesBox = `
		<div class="segment c4">
			<h2>Updates</h2>
			${status}
			${
				dev
					? ""
					: `<p class="hint">Last checked: ${when(last.lastCheckedAt)}</p>
			<div class="update-buttons">
				<button class="glass glass-block" id="check">Check now</button>
				${applyButton}
			</div>
			<p class="status" id="check-status"></p>

			<div class="update-progress working" id="progress" hidden aria-live="polite">
				<span class="update-progress-dot"></span>
				<div>
					<strong id="progress-text"></strong>
					<span class="hint" id="progress-hint"></span>
					<button class="glass glass-block" id="progress-action" hidden></button>
				</div>
			</div>`
			}
		</div>`;

	const notesBox = `
		<div class="segment c6" id="release-notes">
			<h2>Release notes</h2>
			<div id="notes-body" aria-live="polite"><p class="hint">Loading the notes...</p></div>
		</div>`;

	// The notes, fetched once the page is up
	const notesScript = `
		(async function () {
			var box = document.getElementById("notes-body");
			try {
				var response = await fetch("/updates/notes", { cache: "no-store" });
				var data = await response.json();
				box.innerHTML = data.sections.map(function (section) {
					return '<section class="notes-part"><h3>' + section.heading + "</h3>" + section.html + "</section>";
				}).join("");
			} catch (error) {
				box.innerHTML = '<p class="hint">The notes couldn\\'t be loaded.</p>';
			}
		})();
	`;

	// Nothing about checking or installing on a development build
	const script = notesScript + (dev ? "" : `
	(function () {
		var checkButton = document.getElementById("check");
		var applyButton = document.getElementById("apply");
		var checkStatus = document.getElementById("check-status");

		checkButton.addEventListener("click", async function () {
			checkButton.disabled = true;
			checkStatus.className = "status";
			checkStatus.textContent = "Checking...";

			try {
				const response = await fetch("/updates/check", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{}"
				});
				const data = await response.json();

				if (!response.ok) {
					checkStatus.className = "status bad";
					checkStatus.textContent = data.error || "Couldn't reach GitHub.";
					checkButton.disabled = false;
					return;
				}

				// Reload rather than patching the page: a check can
				// change the status line, both changelog sections and
				// the timestamps at once, and re-rendering is simpler
				// than keeping four things in sync by hand.
				location.reload();
			} catch (error) {
				checkStatus.className = "status bad";
				checkStatus.textContent = "Couldn't reach GitHub.";
				checkButton.disabled = false;
			}
		});

		// -------------------------------------------------------------
		// Update now
		//
		// Three stages, each watched a different way:
		//
		//   1. Downloading. This OmniCore is still here and says how
		//      it's going at /updates/progress.
		//   2. Restarting. This OmniCore stops answering, or starts
		//      answering as a different start of OmniCore (bootId).
		//   3. Coming up. The new version answers /version, but isn't
		//      kept until Docker calls it healthy -- until then it can
		//      still be rolled back, and the page waits to see which.
		//
		// /version is open on purpose: the restart signs everyone out.
		// -------------------------------------------------------------
		var fromVersion = ${JSON.stringify(running)};
		var target = ${JSON.stringify(last.latestVersion || "")};
		var bootId = ${JSON.stringify(BOOT_ID)};

		var progressBox = document.getElementById("progress");
		var progressText = document.getElementById("progress-text");
		var progressHint = document.getElementById("progress-hint");
		var progressAction = document.getElementById("progress-action");

		// Longest the page waits for OmniCore to come back before
		// saying something's off. A restart is normally well under a
		// minute; a rollback adds at most another ninety seconds.
		var GIVE_UP_MS = 5 * 60 * 1000;

		function show(kind, text, hint, action) {
			progressBox.hidden = false;
			progressBox.className = "update-progress " + kind;
			progressText.textContent = text;
			progressHint.textContent = hint || "";

			if (action) {
				progressAction.hidden = false;
				progressAction.textContent = action.label;
				progressAction.onclick = action.run;
			} else {
				progressAction.hidden = true;
				progressAction.onclick = null;
			}
		}

		// Both buttons stay off while an update runs -- a check or a
		// second update in the middle of one would only confuse things
		function setButtons(enabled) {
			checkButton.disabled = !enabled;
			if (applyButton && !applyButton.hasAttribute("data-unready")) {
				applyButton.disabled = !enabled;
			}
		}

		function wait(ms) {
			return new Promise(function (resolve) { setTimeout(resolve, ms); });
		}

		// A JSON answer, or a throw for anything else. A signed-out
		// OmniCore answers a protected address with the sign-in page
		// (HTML), which counts as "not the OmniCore that was here".
		async function getJson(url) {
			const response = await fetch(url, { cache: "no-store" });
			const type = response.headers.get("content-type") || "";

			if (!response.ok || type.indexOf("application/json") === -1) {
				throw new Error("Not answering");
			}

			return response.json();
		}

		async function follow() {
			setButtons(false);
			show(
				"working",
				target ? "Downloading " + target + "..." : "Installing the update...",
				"OmniCore keeps running while it downloads. This can take a few minutes on a slow connection."
			);

			// 1. Downloading, while this OmniCore is still the one answering.
			// Not answering counts as "it's restarting" once it said it
			// was switching -- before that, only after a few misses in a
			// row, so a dropped request on a busy network isn't mistaken
			// for the restart.
			var lastPhase = "downloading";
			var misses = 0;

			while (true) {
				var progress;

				try {
					progress = await getJson("/updates/progress");
					misses = 0;
				} catch (error) {
					misses += 1;

					if (lastPhase === "switching" || misses >= 3) {
						break; // gone: it's restarting
					}

					await wait(2000);
					continue;
				}

				lastPhase = progress.phase;

				if (progress.phase === "failed") {
					show("bad", "The update couldn't be installed.", progress.error || "");
					setButtons(true);
					return;
				}

				if (!progress.busy) {
					// Finished without swapping: there was nothing newer
					// to download after all
					show(
						"bad",
						"Nothing was installed.",
						progress.note || "OmniCore is already running the newest version."
					);
					setButtons(true);
					return;
				}

				if (progress.phase === "switching") {
					show(
						"working",
						"Switching to " + (target || "the new version") + "...",
						"OmniCore restarts now. Screens go blank for a moment, and this page reconnects on its own."
					);
				}

				await wait(2000);
			}

			// 2 and 3. Restarting, then coming up
			show(
				"working",
				"Restarting...",
				"Waiting for OmniCore to come back. This usually takes under a minute."
			);

			var started = Date.now();

			while (Date.now() - started < GIVE_UP_MS) {
				await wait(3000);

				var answer;

				try {
					answer = await getJson("/version");
				} catch (error) {
					continue; // still down
				}

				if (answer.bootId === bootId) {
					// Still the old one. Either it hasn't been stopped yet,
					// or the swap never started -- which its progress says
					var still = null;

					try {
						still = await getJson("/updates/progress");
					} catch (error) {
						// Not signed in any more, or just busy: keep waiting
					}

					if (still && still.phase === "failed") {
						show("bad", "The update couldn't be installed.", still.error || "");
						setButtons(true);
						return;
					}

					continue;
				}

				if (answer.version === fromVersion) {
					show(
						"bad",
						(target || "The new version") + " didn't start properly, so OmniCore went back to " + fromVersion + ".",
						"Nothing was lost. What went wrong is in the log of the omnicore-updater-... container on the server (docker ps -a lists it). You'll need to sign in again.",
						{ label: "Sign in", run: function () { location.reload(); } }
					);
					return;
				}

				if (answer.health === "healthy" || answer.health === null) {
					show(
						"good",
						"Updated to " + answer.version + ".",
						"The restart signed you out, so sign in again to carry on.",
						{ label: "Sign in", run: function () { location.reload(); } }
					);
					return;
				}

				show(
					"working",
					"Starting " + answer.version + "...",
					"Making sure it came up properly. If it didn't, the old version is put back on its own."
				);
			}

			show(
				"bad",
				"This is taking longer than it should.",
				"Reload this page in a minute. If OmniCore doesn't come back, check it on the server with: docker ps -a",
				{ label: "Reload", run: function () { location.reload(); } }
			);
		}

		if (applyButton) {
			if (applyButton.disabled) {
				applyButton.setAttribute("data-unready", "");
			}

			applyButton.addEventListener("click", async function () {
				const go = await confirmDialog({
					title: "Update to " + target + "?",
					text:
						"OmniCore downloads " + target + ", then restarts on it. Screens go blank " +
						"for about a minute and you'll be signed out. If the new version doesn't " +
						"start properly, the current one is put back automatically.",
					confirm: "Update now"
				});

				if (!go) return;

				setButtons(false);
				checkStatus.className = "status";
				checkStatus.textContent = "";

				try {
					const response = await fetch("/updates/apply", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ version: target })
					});
					const data = await response.json();

					// Another tab or the scheduler got there first: follow
					// that one instead
					if (!response.ok && !data.busy) {
						checkStatus.className = "status bad";
						checkStatus.textContent = data.error || "Couldn't start the update.";
						setButtons(true);
						return;
					}
				} catch (error) {
					checkStatus.className = "status bad";
					checkStatus.textContent = "Couldn't reach OmniCore.";
					setButtons(true);
					return;
				}

				follow();
			});
		}

		${underWay ? "follow();" : ""}

	})();
	`);

	return { aboutBox, updatesBox, notesBox, script, updateReady: offered };
}

// The release notes for the About tab, as headings and HTML, in the order
// they're shown: what a newer version brings, what isn't released yet (a
// development build only), and what's in this one
async function releaseNotes() {
	const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
	const last = updateStore.lastResult(running);
	const offered = Boolean(last.updateAvailable && last.latestVersion);
	const dev = omnicoreVersion.isDevBuild();
	const shown = omnicoreVersion.displayVersion();

	const [currentNotes, upcomingNotes] = await Promise.all([
		dev
			? Promise.resolve(shown.number ? coreUpdater.localChangelogEntry(shown.number) : null)
			: coreUpdater.fetchChangelogEntry(`v${running}`),
		offered
			? coreUpdater.fetchChangelogEntry(`v${last.latestVersion}`)
			: Promise.resolve(null)
	]);

	// A development build of a branch with work not in a release yet
	// (v2, say) shows that too, above its version's own notes. Read from
	// the "## Unreleased" section of its own CHANGELOG.md, and only on a
	// development build: a release has none.
	const unreleasedNotes = dev ? coreUpdater.localChangelogEntry("Unreleased") : null;

	const part = (heading, notes, fallback) => ({
		heading: escapeHtml(heading),
		html: notes
			? `<div class="changelog">${renderNotes(notes)}</div>`
			: `<p class="lede">${escapeHtml(fallback)}</p>`
	});

	return [
		offered ? part(`What's new in ${last.latestVersion}`, upcomingNotes, "Release notes for that version couldn't be fetched.") : null,
		unreleasedNotes ? part("Not released yet", unreleasedNotes, "") : null,
		part(
			`What's in ${dev ? shown.number || "this build" : running}`,
			currentNotes,
			dev
				? "This build's CHANGELOG.md has no notes for its version."
				: "Release notes for this version couldn't be fetched."
		)
	].filter(Boolean);
}

// The General tab's Place search (since v2 it had a page of its own; it's
// on the settings home now, and /place-search opens the tab). Which
// service a "Search for a city" box asks, the keys for the ones that need
// one, what each service is like, and a box to try a search. See
// place-search.js.
//
//   placeBox      Primary, Secondary, the warning, Try it
//   keysBox       a row per service that takes a key: whether one is
//                 saved (never the key itself), a box to type a new one,
//                 Remove
//   servicesBox   one line on each service
//
// Saved as it changes, like the rest of the settings home: a choice when
// it's picked, a key when its box is left.
function placeSearchPanel(settings) {
	const { primary, secondary } = placeSearch.chosen(settings);
	const services = placeSearch.servicesForPage(settings);
	const warning = placeSearch.warningFor(settings);

	const option = (service, picked) =>
		`<option value="${escapeHtml(service.id)}"${picked ? " selected" : ""}>${escapeHtml(service.name)}${
			service.key ? ` (needs ${escapeHtml(service.key === "username" ? "a username" : "an API key")})` : ""
		}</option>`;

	const placeholder = (service) =>
		service.keySaved
			? `Saved. Type a new ${service.key === "username" ? "username" : "key"} to replace it`
			: service.key === "username"
			? "Your GeoNames username"
			: "Paste the API key";

	const keyRows = services
		.filter((service) => service.key)
		.map(
			(service) => `
			<div class="field key-row" data-key-row="${escapeHtml(service.id)}">
				<label for="key-${escapeHtml(service.id)}">${escapeHtml(service.name)}</label>
				<div class="search-row">
					${passwordField(
						`<input type="password" id="key-${escapeHtml(service.id)}" data-key-for="${escapeHtml(service.id)}" ` +
							`autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder(service))}">`
					)}
					<button type="button" class="glass" data-remove-key="${escapeHtml(service.id)}"
						style="flex:none;padding:0.75em 1.1em"${service.keySaved ? "" : " hidden"}>Remove</button>
				</div>
				<div class="help">
					<span class="key-state ${service.keySaved ? "saved" : ""}">${service.keySaved ? "Saved" : "Not saved"}</span>
					· <a href="${escapeHtml(service.signUp)}" target="_blank" rel="noopener noreferrer">Get one</a>
				</div>
			</div>`
		)
		.join("");

	const aboutList = services
		.map(
			(service) => `
			<div class="service-row">
				<strong>${escapeHtml(service.name)}</strong>
				<span>${escapeHtml(service.about)}${
					service.terms
						? ` <a href="${escapeHtml(service.terms)}" target="_blank" rel="noopener noreferrer">Its rules</a>`
						: ""
				}</span>
			</div>`
		)
		.join("");

	const placeBox = `
		<div class="segment c2" id="place-search">
			<h2>Place search</h2>
			<p class="lede">
				Where a search for a city looks: in the Location Service, on a
				widget's page and in the setup wizard. Only what you type is sent,
				to the service picked here, when you press Search.
			</p>
			<p class="place-warning" id="place-warning"${warning ? "" : " hidden"}>${escapeHtml(warning || "")}</p>

			<div class="field">
				<label for="primary">Primary</label>
				<select id="primary">
					${services.map((service) => option(service, service.id === primary.id)).join("")}
				</select>
				<div class="help">Asked first.</div>
			</div>

			<div class="field">
				<label for="secondary">Secondary</label>
				<select id="secondary">
					<option value="none"${secondary ? "" : " selected"}>None</option>
					${services.map((service) => option(service, secondary && service.id === secondary.id)).join("")}
				</select>
				<div class="help">Asked when the Primary finds nothing, can't be reached, refuses its key or has none saved.</div>
			</div>
			<p class="status" id="place-status" aria-live="polite"></p>

			<div class="field">
				<label for="try">Try it</label>
				<div class="search-row">
					<input type="text" id="try" placeholder="Bekkestua">
					<button type="button" class="glass" id="try-search" style="flex:none;padding:0.75em 1.1em">Search</button>
				</div>
				<div id="try-results"></div>
			</div>
		</div>`;

	const keysBox = `
		<div class="segment c3">
			<h2>Place search keys</h2>
			<p class="lede">
				For the services that need one. Kept by OmniCore and only ever sent
				to the service it belongs to; once saved, it isn't shown again.
			</p>
			${keyRows}
		</div>`;

	const servicesBox = `
		<div class="segment c3">
			<h2>The services</h2>
			<div class="service-list">${aboutList}</div>
		</div>`;

	const script = `
	(function () {
		// What each service needs, for the questions below. Whether a key
		// is saved, never the key.
		let SERVICES = ${JSON.stringify(services).replace(/</g, "\\u003c")};
		const byId = function (id) {
			return SERVICES.find(function (service) { return service.id === id; });
		};

		const primary = document.getElementById("primary");
		const secondary = document.getElementById("secondary");
		const status = document.getElementById("place-status");

		// What came back from a save: the warning, and which keys are saved
		function saved(answer) {
			SERVICES = answer.services;
			const warning = document.getElementById("place-warning");
			warning.hidden = !answer.warning;
			warning.textContent = answer.warning || "";

			for (const service of SERVICES) {
				const row = document.querySelector('[data-key-row="' + service.id + '"]');
				if (!row) continue;
				const box = row.querySelector("[data-key-for]");
				const state = row.querySelector(".key-state");
				box.value = "";
				box.placeholder = service.keySaved
					? "Saved. Type a new " + (service.key === "username" ? "username" : "key") + " to replace it"
					: (service.key === "username" ? "Your GeoNames username" : "Paste the API key");
				state.textContent = service.keySaved ? "Saved" : "Not saved";
				state.classList.toggle("saved", service.keySaved);
				row.querySelector("[data-remove-key]").hidden = !service.keySaved;
			}
		}

		async function save(change) {
			status.className = "status";
			status.textContent = "";
			try {
				const response = await fetch("/place-search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(change)
				});
				if (!response.ok) throw new Error();
				saved(await response.json());
				status.textContent = "Saved.";
				return true;
			} catch (error) {
				status.className = "status bad";
				status.textContent = "Couldn't save.";
				return false;
			}
		}

		// The Secondary can't be the Primary: that option is switched off
		// there, and if it was picked, the Secondary becomes None
		function matchSecondary() {
			for (const option of secondary.options) {
				option.disabled = option.value === primary.value;
			}
			if (secondary.value === primary.value) secondary.value = "none";
		}

		// Picking a service that needs a key, with none saved, asks for it,
		// the same way a weather service does. No, or Cancel, puts the
		// choice back. Resolves to the key, "" when none is needed, or null
		// for no.
		async function askForKey(select) {
			const service = byId(select.value);
			if (!service || !service.key || service.keySaved) return "";

			const what = service.key === "username" ? "username" : "API key";
			const yes = await confirmDialog({
				title: "Do you have " + (service.key === "username" ? "a " : "an ") + service.name + " " + what + "?",
				text: service.about,
				confirm: "Yes",
				cancel: "No"
			});
			return yes
				? await askDialog({
						title: "Your " + service.name + " " + what,
						placeholder: service.key === "username" ? "Username" : "API key",
						secret: true,
						confirm: "Use it"
				  })
				: null;
		}

		async function picked(select) {
			matchSecondary();
			const key = await askForKey(select);

			if (key === null) {
				select.value = select.dataset.was;
				matchSecondary();
				return;
			}

			const change = { primary: primary.value, secondary: secondary.value };
			if (key) {
				change.keys = {};
				change.keys[select.value] = key;
			}

			if (await save(change)) {
				primary.dataset.was = primary.value;
				secondary.dataset.was = secondary.value;
			}
		}

		primary.dataset.was = primary.value;
		secondary.dataset.was = secondary.value;
		matchSecondary();

		primary.addEventListener("change", function () { picked(primary); });
		secondary.addEventListener("change", function () { picked(secondary); });

		// A key typed into its box is saved when the box is left (or on
		// Enter)
		for (const box of document.querySelectorAll("[data-key-for]")) {
			box.addEventListener("change", function () {
				if (!box.value.trim()) return;
				const keys = {};
				keys[box.dataset.keyFor] = box.value.trim();
				save({ keys: keys });
			});
		}

		for (const button of document.querySelectorAll("[data-remove-key]")) {
			button.addEventListener("click", async function () {
				const service = byId(button.dataset.removeKey);
				const sure = await confirmDialog({
					title: "Remove the " + service.name + " key?",
					text: "OmniCore forgets it. Searches that need it go to the Secondary, if there is one.",
					confirm: "Remove",
					danger: true
				});
				if (sure) save({ removeKeys: [service.id] });
			});
		}

		function trySearch() {
			findPlaces(
				document.getElementById("try").value,
				document.getElementById("try-results"),
				function () {}
			);
		}

		document.getElementById("try-search").addEventListener("click", trySearch);
		document.getElementById("try").addEventListener("keydown", function (event) {
			if (event.key === "Enter") {
				event.preventDefault();
				trySearch();
			}
		});
	})();
	`;

	return { placeBox, keysBox, servicesBox, script };
}

// The routes that take a file as it is rather than JSON. See the JSON
// check in startAdminFace.
const RAW_UPLOADS = ["/background/upload", "/background/still"];

function startAdminFace() {
	const app = express();
	app.use(express.json());

	// Light or dark for whichever browser is asking. See ui-theme.js.
	app.use(rememberUiMode);

	// The picture behind OmniCore's own pages, when one is set. See
	// backdrop.js.
	attachBackdropRoute(app);

	// Serves the chosen UI font. Mounted before the auth gate below:
	// the sign-in screen itself renders in the chosen font, and it is
	// by definition reached while signed out.
	fontService.attachFontRoute(app);

	// Which OmniCore is answering: its version, a name for this particular
	// start of it, and how healthy Docker thinks it is. Open, because the
	// About tab asks it while an update restarts OmniCore -- and a
	// restart signs everyone out (sessions live in memory), so by the
	// time the new version answers, the page asking isn't signed in any
	// more. Nothing here is secret: the About face shows the version and
	// the health to anyone.
	//
	//   version  "1.19.1", or "dev"
	//   bootId   different every time OmniCore starts. A new one is how
	//            the page knows the restart actually happened, even when
	//            it never caught OmniCore being down in between.
	//   health   "starting", "healthy", "unhealthy", or null with no way
	//            to know (no Docker socket)
	app.get("/version", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json({
			version: (process.env.OMNICORE_VERSION || "dev").replace(/^v/, ""),
			bootId: BOOT_ID,
			health: await coreUpdater.selfHealth()
		});
	});

	// A POST must be sent as JSON.
	//
	// The session cookie is SameSite=Strict, which keeps other WEBSITES
	// from using it -- but "site" means the host, not the port, so every
	// other face on this machine counts as the same site. A dashboard
	// face runs a theme's JavaScript, and themes aren't trusted. A page
	// there can send a plain form-style POST to this face and the
	// browser attaches the cookie; what it can't send to another port,
	// without this face's permission (which it never gives), is a
	// request marked as JSON. So: no JSON, no change. Every form in the
	// admin face already sends JSON.
	app.use((req, res, next) => {
		// Only POST needs this: it's the one method a page on another
		// port can send without asking first. DELETE and the rest always
		// ask, and are refused.
		if (req.method !== "POST" || req.is("application/json")) {
			next();
			return;
		}

		// The two routes that take a file as it is (a picture for the
		// background, and its still frame). application/octet-stream is
		// just as safe as JSON here: a page on another port can't send
		// that either without asking first, and it's never told yes.
		if (RAW_UPLOADS.includes(req.path) && req.is("application/octet-stream")) {
			next();
			return;
		}

		res.status(415).json({ error: "Send this as JSON." });
	});

	// Gate everything except the setup and login endpoints
	app.use((req, res, next) => {
		const open = ["/setup", "/login"];

		if (open.includes(req.path) || auth.isLoggedIn(req)) {
			next();
			return;
		}

		// No account yet — first thing to do is create one
		if (!auth.isSetUp()) {
			res.send(
				credentialsPage({
					heading: "Set up OmniCore",
					lede: "Create the admin account. It's stored on this machine only.",
					button: "Create account",
					endpoint: "/setup",
					isSetup: true
				})
			);
			return;
		}

		res.send(
			credentialsPage({
				heading: "Sign in",
				lede: "Sign in to change OmniCore's settings.",
				button: "Sign in",
				endpoint: "/login",
				isSetup: false
			})
		);
	});

	// Create the admin account — only possible once
	app.post("/setup", (req, res) => {
		const result = auth.createAdmin(req.body.username, req.body.password);

		if (result.error) {
			res.status(400).json(result);
			return;
		}

		// Creating the account signs you straight in
		auth.setSessionCookie(res, auth.createSession());
		res.json({ ok: true });
	});

	app.post("/login", (req, res) => {
		if (!auth.verify(req.body.username, req.body.password)) {
			// Deliberately vague: saying which half was wrong would tell an
			// attacker whether a username exists
			res.status(401).json({ error: "Wrong username or password." });
			return;
		}

		auth.setSessionCookie(res, auth.createSession());
		res.json({ ok: true });
	});

	app.get("/logout", (req, res) => {
		auth.destroySession(auth.readCookie(req, auth.SESSION_COOKIE));
		auth.clearSessionCookie(res);
		res.redirect("/");
	});

	// City lookup, used by every location field. Goes through OmniCore
	// rather than letting the browser call out directly.
	app.get("/geocode", async (req, res) => {
		res.json(await placeSearch.searchPlaces(req.query.q || "", readSettings()));
	});

	// Settings — the sections of OmniCore you can change.
	// OmniCore's own settings will join Faces here as they appear.
	// The settings home: four tabs in a notch, on one page (since v2).
	// The frame, the notch, the movement and the tab script are in
	// settings-home.js; the boxes on each tab are drawn here.
	app.get("/", async (req, res) => {
		const settings = readSettings();
		const installedFont = fontService.installedFont();

		// Location: show what OmniCore currently believes, so it's
		// obvious whether automatic detection actually worked
		const current = await getLocation();

		const currentText = !settings.locationEnabled
			? "Location services are off."
			: current
			? `${current.label || "Unnamed"} — ` +
			  `${current.latitude.toFixed(3)}, ${current.longitude.toFixed(3)}`
			: "No location available. Detection may have failed.";

		const manualLocation = settings.locationMode === "manual";
		// This browser's own choice: "light", "dark", or null when it
		// follows the device
		const uiMode = currentUiMode();
		const modeLabel = (mode, name) =>
			name + (uiMode === mode ? " (Active)" : "");
		const bottomRight = settings.backButtonCorner !== "top-left";

		// --- General --------------------------------------------------------

		// Location Service. "Set it myself" opens its boxes right here: a
		// search through the Place search setting, the place's name, and
		// its coordinates.
		const locationBox = `
			<div class="segment c4">
				<h2>Location Service</h2>
				<p class="lede">
					Used by weather and prayer-time modules to know where
					you are. Turn it off and OmniCore never looks one up
					and never hands one out.
				</p>

				<label class="option" style="margin-bottom:14px">
					<input type="checkbox" id="enabled"
						${settings.locationEnabled ? "checked" : ""}>
					<span>Let OmniCore know where it is</span>
				</label>

				<div id="location-detail"
					style="${settings.locationEnabled ? "" : "display:none"}">
					<div class="tabs" id="location-mode-tabs"
						style="margin-bottom:14px">
						<button type="button" class="tab-btn ${
							manualLocation ? "" : "active"
						}" data-value="auto">Work it out automatically</button>
						<button type="button" class="tab-btn ${
							manualLocation ? "active" : ""
						}" data-value="manual">Set it myself</button>
					</div>

					<div class="inset">
						<div class="inset-text">
							<div class="inset-label">CURRENTLY ${
								manualLocation ? "SET" : "DETECTED"
							}</div>
							<div class="inset-value" id="location-value">${escapeHtml(
								currentText
							)}</div>
						</div>
						<button class="glass" id="location-action"
							style="flex-shrink:0;padding:0.641em 1.1218em;font-size:0.78em${manualLocation ? ";display:none" : ""}">
							Refresh
						</button>
					</div>

					<div id="location-manual" class="location-manual"${manualLocation ? "" : " hidden"}>
						<div class="field">
							<label for="city">Search for a city</label>
							<div class="search-row">
								<input type="text" id="city" placeholder="Regina">
								<button class="glass" style="width:auto;padding:0.75em 1.25em"
									id="search">Search</button>
							</div>
							<div id="results"></div>
						</div>
						<div class="field">
							<label for="label">Place name</label>
							<input type="text" id="label"
								value="${escapeHtml(settings.locationLabel || "")}"
								placeholder="Home">
						</div>
						<div class="field" style="display:flex;gap:12px">
							<div style="flex:1">
								<label for="latitude">Latitude</label>
								<input type="number" step="any" id="latitude"
									value="${escapeHtml(
										settings.latitude === null ? "" : settings.latitude
									)}">
							</div>
							<div style="flex:1">
								<label for="longitude">Longitude</label>
								<input type="number" step="any" id="longitude"
									value="${escapeHtml(
										settings.longitude === null ? "" : settings.longitude
									)}">
							</div>
						</div>
						<button class="glass" id="save-location" style="padding:0.75em 1.4em">Save location</button>
						<p class="status" id="location-status"></p>
					</div>
				</div>
			</div>`;

		// Place search, all of it: the choice, the keys, the services
		const places = placeSearchPanel(settings);

		// --- Appearance -----------------------------------------------------

		const glassParts = backgroundPanel(settings);

		const modeBox = `
			<div class="segment c2">
				<h2>Appearance Mode</h2>
				<p class="lede">
					Saved in this browser only, so each screen can have
					its own. Device follows this device's own setting.
				</p>
				<div class="mode-previews narrow-previews">
					<div class="mode-preview ${uiMode === "dark" ? "active" : ""}"
						data-mode="dark" role="button" tabindex="0">
						<div class="mode-screen" style="background:#0c0d10">
							<span style="width:40%;height:5px;background:rgba(255,255,255,0.8)"></span>
							<span style="width:70%;height:4px;background:rgba(255,255,255,0.3)"></span>
						</div>
						<div class="mode-preview-label">${modeLabel("dark", "Dark")}</div>
					</div>
					<div class="mode-preview ${uiMode === "light" ? "active" : ""}"
						data-mode="light" role="button" tabindex="0">
						<div class="mode-screen" style="background:#e5e7eb">
							<span style="width:40%;height:5px;background:#4b5563"></span>
							<span style="width:70%;height:4px;background:#9ca3af"></span>
						</div>
						<div class="mode-preview-label">${modeLabel("light", "Light")}</div>
					</div>
					<div class="mode-preview ${uiMode ? "" : "active"}"
						data-mode="device" role="button" tabindex="0">
						<div class="mode-screen mode-screen-split">
							<div style="background:#0c0d10">
								<span style="width:60%;height:5px;background:rgba(255,255,255,0.8)"></span>
							</div>
							<div style="background:#e5e7eb">
								<span style="width:60%;height:5px;background:#4b5563"></span>
							</div>
						</div>
						<div class="mode-preview-label">${modeLabel(null, "Device")}</div>
					</div>
				</div>
			</div>`;

		const cornerBox = `
			<div class="segment c2">
				<h2>Back Button Position</h2>
				<div class="corner-map" id="corner-map">
					<button type="button" class="corner-tl ${
						bottomRight ? "" : "active"
					}" data-value="top-left">&#8598; Top left</button>
					<button type="button" class="corner-tr" disabled>Top right</button>
					<button type="button" class="corner-bl" disabled>Bottom left</button>
					<button type="button" class="corner-br ${
						bottomRight ? "active" : ""
					}" data-value="bottom-right">Bottom right &#8600;</button>
				</div>
				<p class="hint" style="margin-top:8px">
					Top right and bottom left aren't available.
				</p>
			</div>`;

		const textBox = `
			<div class="segment c2">
				<h2>Text Size &amp; Typography</h2>
				<div class="stepper" style="margin-bottom:10px">
					<button type="button" class="glass" id="size-down"
						aria-label="Smaller">&#8722;</button>
					<input type="number" id="size" min="12" max="24" step="1"
						value="${Number(settings.uiFontSize) || 16}">
					<span class="muted">px</span>
					<button type="button" class="glass" id="size-up"
						aria-label="Larger">&#43;</button>
				</div>
				<p class="hint" style="margin-bottom:12px">
					Applies immediately. Dashboards are unaffected.
				</p>
				<div class="inset">
					<div class="inset-text">
						<div class="inset-label">FONT</div>
						<div class="inset-value">${
							installedFont
								? escapeHtml(installedFont.family)
								: "System font"
						}</div>
					</div>
					<button class="glass" id="change-font"
						style="flex-shrink:0;padding:0.641em 1.1218em;font-size:0.78em">
						Change
					</button>
				</div>
			</div>`;

		// --- Resources ------------------------------------------------------

		const resourcesPane =
			settingsHome.tileHtml("/faces", "faces", "Manage Faces", "Create, edit and remove dashboards", "c4") +
			settingsHome.tileHtml("/marketplace", "marketplace", "Marketplace", "Modules and themes to install", "c2 r2") +
			settingsHome.tileHtml(
				"/installed",
				"installed",
				"Installed Resources",
				"What's installed, its versions, and what has an update waiting",
				"c4"
			);

		// --- About ----------------------------------------------------------

		const updates = await updatesPanel();

		const body = settingsHome.homeHtml(
			{
				general: locationBox + places.placeBox + places.keysBox + places.servicesBox,
				appearance: glassParts.backgroundBox + modeBox + cornerBox + glassParts.glassBox + textBox,
				resources: resourcesPane,
				about: updates.aboutBox + updates.updatesBox + updates.notesBox
			},
			updates.updateReady
		) + `
			<div class="modal-backdrop" id="font-modal" hidden>
				<div class="modal">
					<div class="modal-head">
						<h2>Choose a font</h2>
						<button class="modal-close" data-close="font-modal"
							aria-label="Close">&times;</button>
					</div>
					<p class="hint" style="margin:0">
						Downloaded once and served by OmniCore itself, so it keeps
						working with no internet.
					</p>
					<input class="font-search" id="font-q"
						placeholder="Search Google Fonts...">
					<div class="list" id="font-results"></div>
					${
						installedFont
							? `<button class="glass glass-block" id="clear-font">Back to the system font</button>`
							: ""
					}
					<p class="status" id="font-status"></p>
				</div>
			</div>`;

		const script =
			portLinkScript +
			localTimeScript +
			settingsHome.HOME_SCRIPT +
			glassParts.script +
			updates.script +
			places.script +
			`
			// --- Pop-ups --------------------------------------------
			function openModal(id) {
				document.getElementById(id).hidden = false;
			}

			function closeModal(id) {
				document.getElementById(id).hidden = true;
			}

			for (const button of document.querySelectorAll("[data-close]")) {
				button.addEventListener("click", function () {
					closeModal(button.dataset.close);
				});
			}

			// Clicking the dimmed area closes; clicking the panel itself
			// must not, or every click inside would dismiss it
			for (const backdrop of document.querySelectorAll(".modal-backdrop")) {
				backdrop.addEventListener("click", function (event) {
					if (event.target === backdrop) {
						backdrop.hidden = true;
					}
				});
			}

			document.addEventListener("keydown", function (event) {
				if (event.key === "Escape") {
					for (const backdrop of document.querySelectorAll(".modal-backdrop")) {
						backdrop.hidden = true;
					}
				}
			});

			// --- About ----------------------------------------------
			document.getElementById("about-link").addEventListener("click", function (event) {
				event.preventDefault();
				omniGo(faceUrl(1303));
			});

			// --- Location -------------------------------------------
			const enabled = document.getElementById("enabled");
			const detail = document.getElementById("location-detail");
			const manual = document.getElementById("location-manual");
			const action = document.getElementById("location-action");

			enabled.addEventListener("change", function () {
				detail.style.display = this.checked ? "" : "none";
				saveLocation({ locationEnabled: this.checked });
			});

			let locationMode = ${JSON.stringify(manualLocation ? "manual" : "auto")};

			for (const tab of document.querySelectorAll("#location-mode-tabs .tab-btn")) {
				tab.addEventListener("click", function () {
					for (const sibling of tab.parentElement.children) {
						sibling.classList.remove("active");
					}
					tab.classList.add("active");
					locationMode = tab.dataset.value;

					// "Set it myself" shows its boxes; nothing changes until
					// Save location. Back to automatic saves at once.
					if (locationMode === "manual") {
						manual.hidden = false;
						action.style.display = "none";
						document.getElementById("city").focus();
					} else {
						manual.hidden = true;
						saveLocation({ locationMode: "auto" });
					}
				});
			}

			// Automatic: run detection again rather than showing whatever
			// was cached when the page loaded
			action.addEventListener("click", function () {
				this.disabled = true;
				this.textContent = "...";
				saveLocation({ locationMode: "auto" });
			});

			async function saveLocation(patch) {
				const body = Object.assign({
					locationEnabled: enabled.checked,
					locationMode: locationMode,
					locationLabel: document.getElementById("label").value,
					latitude: document.getElementById("latitude").value,
					longitude: document.getElementById("longitude").value
				}, patch || {});

				const response = await fetch("/location", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body)
				});

				if (response.ok) {
					location.reload();
				} else {
					throw new Error();
				}
			}

			// The matches, the note and the credit line: findPlaces, shared
			// with a widget's page and the wizard (place-search-ui.js)
			${PLACE_SEARCH_SCRIPT}

			function runSearch() {
				return findPlaces(
					document.getElementById("city").value,
					document.getElementById("results"),
					function (place) {
						document.getElementById("latitude").value = place.latitude;
						document.getElementById("longitude").value = place.longitude;
						document.getElementById("label").value = place.label;
					}
				);
			}

			document.getElementById("search").addEventListener("click", runSearch);

			document.getElementById("city").addEventListener("keydown", function (event) {
				if (event.key === "Enter") {
					event.preventDefault();
					runSearch();
				}
			});

			document.getElementById("save-location").addEventListener("click", async function () {
				const status = document.getElementById("location-status");
				this.disabled = true;
				status.textContent = "";

				try {
					await saveLocation({ locationMode: "manual" });
				} catch (error) {
					status.textContent = "Couldn't save.";
					status.className = "status bad";
					this.disabled = false;
				}
			});

			// --- Appearance -------------------------------------------
			async function saveAppearance(patch) {
				const response = await fetch("/appearance", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patch)
				});

				if (response.ok) {
					location.reload();
				}
			}

			// Light, Dark or Device is this browser's own, so it's kept
			// in a cookie here rather than saved on the server
			for (const preview of document.querySelectorAll(".mode-preview")) {
				const choose = function () {
					setUiMode(preview.dataset.mode);
				};

				preview.addEventListener("click", choose);
				preview.addEventListener("keydown", function (event) {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						choose();
					}
				});
			}

			for (const corner of document.querySelectorAll("#corner-map button[data-value]")) {
				corner.addEventListener("click", function () {
					saveAppearance({ backButtonCorner: corner.dataset.value });
				});
			}

			const size = document.getElementById("size");

			size.addEventListener("change", function () {
				const clamped = Math.min(24, Math.max(12, Number(size.value) || 16));
				size.value = clamped;
				saveAppearance({ uiFontSize: clamped });
			});

			function stepSize(delta) {
				const next = Math.min(24, Math.max(12, Number(size.value) + delta));
				size.value = next;
				saveAppearance({ uiFontSize: next });
			}

			document.getElementById("size-down").addEventListener("click", function () {
				stepSize(-1);
			});
			document.getElementById("size-up").addEventListener("click", function () {
				stepSize(1);
			});

			// --- Fonts -------------------------------------------------
			document.getElementById("change-font").addEventListener("click", function () {
				openModal("font-modal");
				document.getElementById("font-q").focus();
			});

			const fontResults = document.getElementById("font-results");
			const fontQuery = document.getElementById("font-q");
			const fontStatus = document.getElementById("font-status");
			let fontSearchTimer = null;

			function renderFonts(fonts) {
				if (!fonts.length) {
					fontResults.innerHTML = '<p class="hint">No matches.</p>';
					return;
				}

				fontResults.innerHTML = fonts.map(function (font) {
					const safe = font.family.replace(/&/g, "&amp;").replace(/</g, "&lt;");
					return '<div class="segment clickable font-row" onclick="pickFont(' +
						JSON.stringify(font.family).replace(/"/g, "&quot;") +
						')"><strong style="font-family:' +
						JSON.stringify(font.family).replace(/"/g, "&quot;") +
						'">' + safe + '</strong>' +
						'<span class="hint">' + font.category + '</span></div>';
				}).join("");

				// A live preview needs the real font, and there's no way
				// around that -- but this search is already an
				// online-only action, so fetching it here doesn't touch
				// the offline guarantee that matters: the one font
				// someone actually installs still gets downloaded once
				// and served locally forever after.
				//
				// One request for every result shown, not one per font --
				// the browser only actually downloads a given family's
				// file once something on the page is set to use it,
				// which is exactly the results currently rendered.
				let previewLink = document.getElementById("font-preview-link");
				if (!previewLink) {
					previewLink = document.createElement("link");
					previewLink.id = "font-preview-link";
					previewLink.rel = "stylesheet";
					document.head.appendChild(previewLink);
				}

				const families = fonts
					.map(function (font) {
						return "family=" + encodeURIComponent(font.family).replace(/%20/g, "+");
					})
					.join("&");

				previewLink.href =
					"https://fonts.googleapis.com/css2?" + families + "&display=swap";
			}

			// Debounced: a search per keystroke would hammer the
			// catalogue for results nobody has finished asking for yet.
			fontQuery.addEventListener("input", function () {
				clearTimeout(fontSearchTimer);
				fontSearchTimer = setTimeout(async function () {
					if (!fontQuery.value.trim()) {
						fontResults.innerHTML = "";
						return;
					}

					fontStatus.textContent = "Searching...";

					try {
						const response = await fetch("/fonts/search?q=" +
							encodeURIComponent(fontQuery.value));
						const data = await response.json();

						if (!response.ok) {
							fontStatus.textContent =
								data.error || "Could not reach Google Fonts.";
							fontResults.innerHTML = "";
							return;
						}

						fontStatus.textContent = "";
						renderFonts(data);
					} catch (error) {
						fontStatus.textContent = "Could not reach Google Fonts.";
					}
				}, 300);
			});

			window.pickFont = async function (family) {
				fontStatus.textContent = "Downloading " + family + "...";

				const response = await fetch("/fonts", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ family: family })
				});

				const data = await response.json();

				if (!response.ok) {
					fontStatus.textContent = data.error || "Could not install that font.";
					return;
				}

				location.reload();
			};

			const clearFont = document.getElementById("clear-font");
			if (clearFont) {
				clearFont.addEventListener("click", async function () {
					await fetch("/fonts", { method: "DELETE" });
					location.reload();
				});
			}
		`;

		res.send(page("Settings", body, script, "settings-home", "/logout", "Sign Out"));
	});


	app.post("/appearance", (req, res) => {
		const body = req.body || {};
		const patch = {};

		if (
			body.backButtonCorner === "bottom-right" ||
			body.backButtonCorner === "top-left"
		) {
			patch.backButtonCorner = body.backButtonCorner;
		}

		if (body.uiFontSize !== undefined) {
			// Clamped rather than trusted: this value goes straight into
			// a CSS declaration, and a hostile or fat-fingered number
			// could make the admin UI unusable to fix itself with.
			const size = Number(body.uiFontSize);

			if (Number.isFinite(size)) {
				patch.uiFontSize = Math.min(24, Math.max(12, Math.round(size)));
			}
		}

		if (Object.keys(patch).length === 0) {
			res.status(400).json({ error: "Nothing recognisable to save" });
			return;
		}

		writeSettings(patch);
		res.json({ ok: true, ...patch });
	});

	// --- Fonts -------------------------------------------------------
	// The picker's own endpoints. The UI that calls these lands in the
	// next stage; the capability is here so it can be tested on its own.

	app.get("/fonts/search", async (req, res) => {
		try {
			res.json(await fontService.searchFonts(req.query.q, 25));
		} catch (error) {
			// Google unreachable, most likely. Say so plainly rather
			// than showing an empty list, which would read as "no font
			// matches that" and send someone hunting for a typo.
			res.status(502).json({ error: error.message });
		}
	});

	app.post("/fonts", async (req, res) => {
		try {
			const family = await fontService.installFont((req.body || {}).family);
			writeSettings({ uiFontFamily: family });
			res.json({ ok: true, family });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.delete("/fonts", async (req, res) => {
		await fontService.removeFont();
		writeSettings({ uiFontFamily: "" });
		res.json({ ok: true });
	});

	app.post("/location", (req, res) => {
		const latitude = Number(req.body.latitude);
		const longitude = Number(req.body.longitude);

		const location = {
			locationEnabled: Boolean(req.body.locationEnabled),
			locationMode:
				req.body.locationMode === "manual" ? "manual" : "auto",
			locationLabel: req.body.locationLabel || "",
			// Blank or unparseable coordinates are stored as "none"
			// rather than NaN
			latitude: Number.isNaN(latitude) || req.body.latitude === "" ? null : latitude,
			longitude:
				Number.isNaN(longitude) || req.body.longitude === "" ? null : longitude
		};

		writeSettings(location);

		// Only what was saved goes back. Until v2 this sent the whole
		// settings file, which since v2 holds the place search keys:
		// those never go back to a page.
		res.json(location);
	});

	// ---- background and glass -----------------------------------------
	//
	// A picture, an animation or a video behind OmniCore's own pages, and
	// the frosted glass over it. See backdrop.js. Reached from the
	// settings page.
	//
	// Picking a file goes in three steps, so a big file is sent as it is
	// rather than as text inside JSON:
	//
	//   1. POST /background/upload   the file itself; kept aside, not used
	//   2. POST /background/still    a still frame the page drew from it
	//   3. POST /background/use      put it in place, with what the page
	//                                worked out (its colour, how dark and
	//                                bright it is)
	// Background and glass were a page of their own until the settings
	// home had tabs; that address now opens the Appearance tab
	app.get("/background", (req, res) => {
		res.redirect("/#appearance");
	});

	app.post(
		"/background/upload",
		express.raw({ type: "application/octet-stream", limit: backdropStore.MAX_BYTES }),
		(req, res) => {
			const result = backdropStore.receive(req.body);
			res.status(result.error ? 400 : 200).json(result);
		}
	);

	app.post(
		"/background/still",
		express.raw({ type: "application/octet-stream", limit: backdropStore.MAX_STILL_BYTES }),
		(req, res) => {
			const result = backdropStore.receiveStill(String(req.query.id || ""), req.body);
			res.status(result.error ? 400 : 200).json(result);
		}
	);

	app.post("/background/use", (req, res) => {
		const result = backdropStore.use((req.body || {}).id, req.body);

		if (result.error) {
			res.status(400).json(result);
			return;
		}

		const saved = writeSettings(result.changes);

		// The one before it goes
		backdropStore.removeOthers([saved.backgroundFile, saved.backgroundStill]);
		res.json({ ok: true, kind: saved.backgroundKind });
	});

	app.post("/background/plain", (req, res) => {
		writeSettings(backdropStore.PLAIN);
		backdropStore.removeOthers([]);
		res.json({ ok: true });
	});

	app.post("/background/glass", (req, res) => {
		writeSettings(backdropStore.cleanGlass(req.body));
		res.json({ ok: true });
	});

	// A file too big for the upload routes: said in words, as JSON, rather
	// than Express's own page
	app.use((error, req, res, next) => {
		if (error && error.type === "entity.too.large") {
			res.status(413).json({ error: "That file is bigger than 50 MB." });
			return;
		}
		next(error);
	});

	// ---- place search ---------------------------------------------------
	//
	// Which service a "Search for a city" box asks, and the keys for the
	// ones that need one. See place-search.js. Reached from the settings
	// page.
	// Place search had a page of its own until the settings home had tabs;
	// that address now opens the General tab
	app.get("/place-search", (req, res) => {
		res.redirect("/#general");
	});

	app.post("/place-search", (req, res) => {
		const changes = placeSearch.cleanSetting(req.body, readSettings());
		const saved = writeSettings(changes);

		// What the page needs to know, never the keys
		res.json({
			ok: true,
			warning: placeSearch.warningFor(saved),
			services: placeSearch.servicesForPage(saved)
		});
	});

	// Every dashboard face
	// ---- marketplace -------------------------------------------------
	//
	// Browsing and installing what has been reviewed into the registry.
	// Nothing here executes anything it downloads; it only places files.
	// Installed code starts running the same way built-in code does, when
	// module-loader or theme-loader require() it.

	// Install buttons, on every Marketplace page that shows one: the home
	// page, a listing's own page and an author's page. One copy, so they
	// can't drift apart. The author page used to have none at all, which
	// left its Install buttons doing nothing when clicked.
	//
	// post() puts any failure on the button itself -- there's no other
	// obvious place on these pages for it to go.
	const marketPostScript = `
		async function post(url, payload, button, working, done) {
			const was = button.textContent;
			button.disabled = true;
			button.textContent = working;

			try {
				const response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				});

				const result = await response.json();

				if (!response.ok) {
					throw new Error(result.error || "Failed");
				}

				button.textContent = done;
				return true;
			} catch (error) {
				button.disabled = false;
				button.textContent = error.message.slice(0, 60);
				setTimeout(function () { button.textContent = was; }, 4000);
				return false;
			}
		}
	`;

	const marketInstallScript = marketPostScript + `
		for (const button of document.querySelectorAll("[data-install]")) {
			button.addEventListener("click", async function () {
				const ok = await post(
					"/marketplace/install",
					{ id: button.dataset.install, kind: button.dataset.kind },
					button,
					"Installing...",
					"Installed"
				);

				if (ok) {
					setTimeout(function () { location.reload(); }, 800);
				}
			});
		}
	`;

	// The button for one listing: Install, or a green "Installed" once
	// it's here. "Installed" is a label shaped like a button, not a
	// button -- there's nothing to press.
	//
	// Something this OmniCore is too old for gets a button that can't be
	// pressed: installing it would only be refused. Its tag and its page
	// say why (see listingTraits).
	function marketAction(entry, kind) {
		if (entry.installed) {
			return '<span class="btn-glossy btn-glossy-green market-action">&#10003; Installed</span>';
		}

		if (!marketplace.checkCompatibility(entry).compatible) {
			return '<button type="button" class="glass market-action" disabled>Install</button>';
		}

		return `<button type="button" class="glass market-action" data-install="${escapeHtml(entry.id)}" ` +
			`data-kind="${kind}">Install</button>`;
	}

	// What a listing tells you before you install it, beyond what it shows
	// on a tile. All of it comes from the listing's registry.json entry,
	// which is the part that gets reviewed, never from the module's own
	// files: a module can't hide that it runs in the background by simply
	// not saying so.
	//
	//   background: true   it keeps running while OmniCore is on
	//   inport: true       it takes input, so its face gets an Inport
	//   notifies: true     it can raise notifications on its face's screens
	//   minOmniCore        the oldest OmniCore it works on
	//
	// Only an exact `true` counts, the same rule module.json's own
	// `background` follows. Returns { tag, text, warn } for each: `tag` for
	// the listing row, `text` for the listing's own page.
	function listingTraits(entry, kind) {
		const traits = [];

		if (kind === "module" && entry.background === true) {
			traits.push({
				tag: "Runs in the background",
				text: "Keeps running the whole time OmniCore is on, not only while a screen is showing it."
			});
		}

		if (kind === "module" && entry.inport === true) {
			traits.push({
				tag: "Takes input",
				text: "Has controls you can use from a phone or tablet, through its face's Inport."
			});
		}

		if (kind === "module" && entry.notifies === true) {
			traits.push({
				tag: "Sends notifications",
				text: "Can pop up notifications on the screens showing its face."
			});
		}

		if (entry.minOmniCore) {
			const required = String(entry.minOmniCore).replace(/^v/, "");
			const fits = marketplace.checkCompatibility(entry).compatible;
			const running = omnicoreVersion.displayVersion().number;

			traits.push(
				fits
					? {
							tag: `OmniCore ${required} or newer`,
							text: `Works on OmniCore ${required} or newer.`
					  }
					: {
							tag: `Needs OmniCore ${required}`,
							text: `Needs OmniCore ${required} or newer. This one is ${running || "older"}, so it can't be installed until OmniCore is updated.`,
							warn: true
					  }
			);
		}

		return traits;
	}

	// One row per entry, in a grid the search box filters client-side.
	// `data-search` holds the text a match is judged against -- built once
	// here rather than recomputed on every keystroke. The whole row links
	// to its own page except the Install button, which needs its own
	// click -- see .market-link in the stylesheet.
	//
	// Under the grid sits a "nothing matches" line, hidden until a search
	// hides every row.
	function marketplaceListings(entries, kind) {
		if (!entries.length) {
			return '<div class="segment"><span class="empty">Nothing listed yet.</span></div>';
		}

		const listings = entries
			.map((entry) => {
				const name = entry.name || entry.id;
				const author = entry.author || "";
				const description = entry.description || "";
				const detailUrl = `/marketplace/${kind}s/${encodeURIComponent(entry.id)}`;

				const traits = listingTraits(entry, kind);

				// The tags are searchable too: typing "background" or
				// "notifications" finds the listings that do that
				const searchText = escapeHtml(
					[name, description, author, ...traits.map((t) => t.tag)].join(" ").toLowerCase()
				);

				const tags = traits.length
					? `<div class="market-tags">${traits
							.map((t) => `<span class="provides-tag${t.warn ? " warn" : ""}">${escapeHtml(t.tag)}</span>`)
							.join("")}</div>`
					: "";

				return `
					<div class="segment clickable market-item" data-search="${searchText}">
						<a class="market-link" href="${escapeHtml(detailUrl)}" aria-label="${escapeHtml(name)}"></a>
						<div class="market-item-text">
							<h3>${escapeHtml(name)}</h3>
							${author ? `<div class="market-by">by ${escapeHtml(author)}</div>` : ""}
							${description ? `<div class="market-desc">${escapeHtml(description)}</div>` : ""}
							${tags}
						</div>
						${marketAction(entry, kind)}
					</div>`;
			})
			.join("");

		return `
			<div class="market-list">${listings}</div>
			<div class="segment" data-no-match hidden>
				<span class="empty">Nothing matches that search.</span>
			</div>`;
	}

	// "9 items available", or "1 item available"
	function itemsAvailable(count) {
		return `${count} ${count === 1 ? "item" : "items"} available`;
	}

	app.get("/marketplace", async (req, res) => {
		let available = null;
		let failure = "";

		try {
			available = await marketplace.listAvailable();
		} catch (error) {
			// An unreachable or malformed registry is worth saying plainly
			// rather than showing an empty page that looks like there is
			// simply nothing to install
			failure = error.message;
		}

		const failedSources = available && available.sourceFailures.length
			? `<p class="help">
				Couldn't reach ${available.sourceFailures.length === 1 ? "an additional source" : "some additional sources"}:
				${available.sourceFailures.map((f) => escapeHtml(f.url)).join(", ")}.
				The built-in registry is unaffected.
			</p>`
			: "";

		// Search, the Modules / Themes switch and the count, pinned at the
		// top as the list scrolls. Then one panel of listings per tab.
		const listings = failure
			? marketErrorBanner(failure)
			: `
				<div class="segment toolbar market-toolbar">
					<input type="text" data-market-search
						placeholder="Search by name, author, or description"
						aria-label="Search the Marketplace">
					<div class="tabs">
						<button type="button" class="tab-btn active" data-tab-btn="module">Modules</button>
						<button type="button" class="tab-btn" data-tab-btn="theme">Themes</button>
					</div>
					<span class="toolbar-note" data-market-count>${itemsAvailable(available.modules.length)}</span>
				</div>

				<div data-tab-panel="module">
					${marketplaceListings(available.modules, "module")}
				</div>
				<div data-tab-panel="theme" hidden>
					${marketplaceListings(available.themes, "theme")}
				</div>`;

		const body = `
			<div class="market">
				<div class="segment market-head">
					<div>
						<h1>Marketplace</h1>
						<p class="lede">
							Modules and themes reviewed into the registry. Installing
							downloads the exact reviewed version.
						</p>
						${failedSources}
					</div>
					<a class="glass market-action" href="/marketplace/sources">Sources</a>
				</div>

				${listings}
			</div>`;

		const script = marketInstallScript + `
			var search = document.querySelector("[data-market-search]");
			var count = document.querySelector("[data-market-count]");

			// The panel for whichever tab is showing
			function activePanel() {
				return document.querySelector("[data-tab-panel]:not([hidden])");
			}

			// Hides the rows that don't match what's typed, then says how
			// many are left: "9 items available" with nothing typed, "2 of
			// 9 shown" while searching, and "Nothing matches" under the
			// grid when the search hides every row.
			function applySearch() {
				var panel = activePanel();
				if (!panel) return;

				var query = search ? search.value.trim().toLowerCase() : "";
				var items = panel.querySelectorAll(".market-item");
				var shown = 0;

				for (var i = 0; i < items.length; i++) {
					var matches = items[i].dataset.search.indexOf(query) !== -1;
					items[i].hidden = query !== "" && !matches;
					if (!items[i].hidden) shown++;
				}

				var none = panel.querySelector("[data-no-match]");
				if (none) none.hidden = !(items.length && shown === 0);

				if (count) {
					count.textContent = query
						? shown + " of " + items.length + " shown"
						: items.length + (items.length === 1 ? " item" : " items") + " available";
				}
			}

			// Modules / Themes. Switching clears the search -- starting
			// fresh in the new tab is less surprising than carrying a
			// filter across to content it was never typed against.
			var tabButtons = Array.from(document.querySelectorAll("[data-tab-btn]"));
			var tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

			for (const button of tabButtons) {
				button.addEventListener("click", function () {
					for (const b of tabButtons) {
						b.classList.toggle("active", b === button);
					}

					for (const panel of tabPanels) {
						panel.hidden = panel.dataset.tabPanel !== button.dataset.tabBtn;
					}

					if (search) search.value = "";
					applySearch();
				});
			}

			// Filters in the browser rather than asking the server on
			// every keystroke -- a registry is small enough that there's
			// nothing to gain from it. Only the tab that's showing is
			// searched: searching Modules shouldn't surface a Theme.
			if (search) {
				search.addEventListener("input", applySearch);
			}
		`;

		res.send(page("Marketplace", body, script, "", "/"));
	});

	app.get("/marketplace/sources", (req, res) => {
		const settings = readSettings();
		const sources = Array.isArray(settings.registrySources)
			? settings.registrySources
			: [];

		// One line per registry: the built-in one first, which can't be
		// removed, then any the admin added
		const extraRows = sources
			.map(
				(url) => `
				<div class="market-source">
					<div class="market-url"><strong>${escapeHtml(url)}</strong></div>
					<button type="button" class="glass market-action" data-remove-source="${escapeHtml(url)}">Remove</button>
				</div>`
			)
			.join("");

		const body = `
			<div class="market reading">
				<div class="segment market-head">
					<div>
						<h1>Registry sources</h1>
						<p class="lede">Where OmniCore looks for modules and themes to install.</p>
					</div>
				</div>

				<div class="segment">
					<div class="market-source">
						<div>
							<strong>Omnia-Registry</strong>
							<div class="help">Built-in. Reviewed, and always included.</div>
						</div>
						<span class="toolbar-note">Built-in</span>
					</div>
					${extraRows}
				</div>

				<div class="segment">
					<label for="newSource">Add a source</label>
					<div class="toolbar">
						<input type="url" id="newSource" data-new-source placeholder="https://example.com/registry.json">
						<button type="button" class="glass market-action" data-reveal-warning>Add source</button>
					</div>
				</div>

				<div class="market-warning" data-warning hidden>
					<h3>This adds a source OmniCore hasn't reviewed</h3>
					<p>
						Everything in the built-in registry is reviewed before anyone
						can install it — someone actually read the code before it was
						listed. A third-party source has no such review. Anything
						listed there could be anything.
					</p>
					<p>
						A module is a full, unrestricted Node program. It can read
						every file this server can read — including your admin
						credentials — and reach the network however it likes. None
						of that is sandboxed, checked, or undone automatically once
						something is installed from it.
					</p>
					<p>
						<strong>If you don't personally, actually trust whoever runs
						this source — not "it looked fine" — don't add it.</strong>
					</p>
					<div class="market-warning-actions">
						<button type="button" class="btn-glossy btn-glossy-green" data-warning-cancel>Go back</button>
						<button type="button" class="btn-glossy btn-glossy-neutral" data-warning-confirm>I understand</button>
					</div>
				</div>
			</div>`;

		const script = marketPostScript + `
			const newSource = document.querySelector("[data-new-source]");
			const warning = document.querySelector("[data-warning]");
			const reveal = document.querySelector("[data-reveal-warning]");

			if (reveal) {
				reveal.addEventListener("click", function () {
					if (!newSource.value.trim()) {
						newSource.focus();
						return;
					}
					warning.hidden = false;
					warning.scrollIntoView({ behavior: "smooth", block: "center" });
				});
			}

			const cancel = document.querySelector("[data-warning-cancel]");
			if (cancel) {
				cancel.addEventListener("click", function () { warning.hidden = true; });
			}

			const confirmAdd = document.querySelector("[data-warning-confirm]");
			if (confirmAdd) {
				confirmAdd.addEventListener("click", async function () {
					const ok = await post(
						"/marketplace/sources/add",
						{ url: newSource.value.trim() },
						confirmAdd,
						"Adding...",
						"Added"
					);
					if (ok) {
						setTimeout(function () { location.reload(); }, 600);
					}
				});
			}

			for (const button of document.querySelectorAll("[data-remove-source]")) {
				button.addEventListener("click", async function () {
					const ok = await post(
						"/marketplace/sources/remove",
						{ url: button.dataset.removeSource },
						button,
						"Removing...",
						"Removed"
					);
					if (ok) {
						setTimeout(function () { location.reload(); }, 400);
					}
				});
			}
		`;

		res.send(page("Registry sources", body, script, "", "/marketplace"));
	});

	app.post("/marketplace/sources/add", (req, res) => {
		try {
			marketplace.addSource((req.body || {}).url);
			res.json({ ok: true });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post("/marketplace/sources/remove", (req, res) => {
		marketplace.removeSource((req.body || {}).url);
		res.json({ ok: true });
	});

	// A module's or theme's own page — everything the browse listings don't
	// have room for. Shared by both kinds since the layout only differs
	// by a couple of conditional pieces (provides, only meaningful for a
	// module; a theme has nothing analogous to show there).
	async function renderDetailPage(kind, id, res) {
		let available = null;

		try {
			available = await marketplace.listAvailable();
		} catch (error) {
			res.status(502).send(registryUnreachable(error.message));
			return;
		}

		const list = kind === "theme" ? available.themes : available.modules;
		const entry = list.find((item) => item.id === id);

		if (!entry) {
			res.status(404).send(notFound("Nothing with that id is listed", "/marketplace", "Marketplace"));
			return;
		}

		const name = entry.name || entry.id;
		const author = entry.author || "";
		const emits = Array.isArray(entry.emits) ? entry.emits : [];

		// module.json/theme.json, fetched at the pinned commit — see
		// fetchDetailExtras for exactly what this does and does not trust.
		// Nothing here can override registry.json's own fields; it only
		// supplies the two things registry.json never had a place for.
		const extras = await marketplace.fetchDetailExtras(kind, entry);

		// The longer description, if module.json has one, one paragraph
		// per blank-line-separated block. The short one is already in the
		// header.
		const paragraphs = extras.completeDescription
			? extras.completeDescription
				.split(/\n{2,}/)
				.map((para) => para.trim())
				.filter(Boolean)
			: [];

		const aboutSection = paragraphs.length
			? `
				<div class="segment market-about">
					${paragraphs.map((para) => `<p>${escapeHtml(para)}</p>`).join("")}
				</div>`
			: "";

		// "Good to know": the same facts as the listing's tags, one sentence
		// each (see listingTraits)
		const traits = listingTraits(entry, kind);
		const traitsSection = traits.length
			? `
				<div class="segment">
					<h2>Good to know</h2>
					<ul class="market-traits">
						${traits.map((t) => `<li${t.warn ? ' class="warn"' : ""}>${escapeHtml(t.text)}</li>`).join("")}
					</ul>
				</div>`
			: "";

		const emitsSection = kind === "module" && emits.length
			? `
				<div class="segment">
					<h2>Emits</h2>
					<div>${emits.map((e) => `<span class="provides-tag">${escapeHtml(e)}</span>`).join("")}</div>
				</div>`
			: "";

		const sourceSection = entry.repo
			? `
				<div class="segment">
					<h2>Source</h2>
					<p class="lede market-url">
						<a href="${escapeHtml(entry.repo)}">${escapeHtml(entry.repo)}</a>${entry.ref ? `, pinned at <code>${escapeHtml(String(entry.ref).slice(0, 10))}</code>` : ""}
					</p>
				</div>`
			: "";

		// Emits and Source side by side when there are both, on their own
		// otherwise
		const factsRow = emitsSection && sourceSection
			? `<div class="bento-row two top">${emitsSection}${sourceSection}</div>`
			: emitsSection + sourceSection;

		// Every screenshot's actual URL is remembered server-side and handed
		// a short opaque key — the browser never sees or requests the real
		// URL directly. Same reason the dashboard's own image blocks work
		// this way: a display (here, the admin's browser) should only ever
		// talk to OmniCore's own server, never a third party the author of
		// an unreviewed module.json chose.
		const screenshotsSection = extras.screenshots.length
			? `
				<div class="segment">
					<h2>Screenshots</h2>
					<div class="market-shots">
						${extras.screenshots
							.map((shot, index) => {
								const key = `${kind}:${entry.id}:${index}`;
								imageProxy.remember(key, shot.image);

								const themeLink = shot.theme
									? ` Shown in <a href="/marketplace/themes/${escapeHtml(shot.theme)}">${escapeHtml(shot.theme)}</a>.`
									: "";

								const caption = (shot.description ? escapeHtml(shot.description) : "") + themeLink;

								return `
									<figure>
										<img src="/marketplace/screenshot/${encodeURIComponent(key)}"
											alt="${escapeHtml(shot.description || name)}">
										${caption ? `<figcaption>${caption}</figcaption>` : ""}
									</figure>`;
							})
							.join("")}
					</div>
				</div>`
			: "";

		// No "← Marketplace" link at the top: the floating back button
		// already goes there, the same as on every other page
		const body = `
			<div class="market reading">
				<div class="segment market-head">
					<div>
						<h1>${escapeHtml(name)}</h1>
						<div class="market-by">
							${kind === "theme" ? "Theme" : "Module"}
							${author ? ` by <a href="/marketplace/authors/${encodeURIComponent(author)}">${escapeHtml(author)}</a>` : ""}
						</div>
						${entry.description ? `<p class="lede">${escapeHtml(entry.description)}</p>` : ""}
					</div>
					${marketAction(entry, kind)}
				</div>

				${aboutSection}
				${traitsSection}
				${factsRow}
				${screenshotsSection}
			</div>`;

		res.send(page(name, body, marketInstallScript, "", "/marketplace"));
	}

	// A screenshot's real URL is never sent to the browser — only this
	// key, remembered server-side in renderDetailPage right before the
	// page that references it is sent. A key nobody remembered (an old
	// page, a guess) simply isn't there to look up.
	app.get("/marketplace/screenshot/:key", async (req, res) => {
		const url = imageProxy.lookup(req.params.key);

		if (!url) {
			res.status(404).end();
			return;
		}

		const image = await imageProxy.fetchImage(url);

		if (!image) {
			res.status(502).end();
			return;
		}

		res.setHeader("Content-Type", image.type);
		res.setHeader("Cache-Control", "private, max-age=300");
		res.end(image.body);
	});

	app.get("/marketplace/modules/:id", (req, res) => {
		renderDetailPage("module", req.params.id, res);
	});

	app.get("/marketplace/themes/:id", (req, res) => {
		renderDetailPage("theme", req.params.id, res);
	});

	// Everything one author has published, across every source. Purely
	// derived from the `author` field already on each entry — no new data
	// collected, no separate profile to maintain. A fuller author page
	// (bio, avatar, a claimed identity) is a real future feature; this is
	// the honest version of what's actually known today.
	app.get("/marketplace/authors/:name", async (req, res) => {
		const authorName = req.params.name;
		let available = null;

		try {
			available = await marketplace.listAvailable();
		} catch (error) {
			res.status(502).send(registryUnreachable(error.message));
			return;
		}

		const modules = available.modules.filter((e) => e.author === authorName);
		const themes = available.themes.filter((e) => e.author === authorName);
		const total = modules.length + themes.length;

		// Only the groups this author actually has. Someone with themes
		// and no modules doesn't need an empty "Modules" heading.
		const body = `
			<div class="market">
				<div class="segment market-head">
					<div>
						<h1>${escapeHtml(authorName)}</h1>
						<p class="lede">${total} listed</p>
					</div>
				</div>

				${modules.length ? `
				<h2 class="market-section">Modules</h2>
				${marketplaceListings(modules, "module")}` : ""}

				${themes.length ? `
				<h2 class="market-section">Themes</h2>
				${marketplaceListings(themes, "theme")}` : ""}

				${total ? "" : `
				<div class="segment">
					<span class="empty">Nothing listed by ${escapeHtml(authorName)}.</span>
				</div>`}
			</div>`;

		res.send(page(authorName, body, marketInstallScript, "", "/marketplace"));
	});

	app.post("/marketplace/install", async (req, res) => {
		const { id, kind, update } = req.body || {};

		try {
			const installed = await marketplace.installEntry(
				kind === "theme" ? "theme" : "module",
				id,
				update === true
			);

			res.json({ ok: true, installed });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	// Updates. Reached by clicking the version card on the About face,
	// not from the settings list — deliberately a path you find rather
	// than one you're shown.
	//
	// It lives here rather than on the About face because everything on
	// it needs the login that already exists on this face. About stays
	// public and read-only; anything with depth is behind this.
	//
	// When a check has found a newer version, the page offers "Update
	// now" -- the same install the scheduler would do within six hours,
	// through the same coreUpdater.applyUpdate(), started on purpose. The
	// page then follows it all the way: downloading, OmniCore restarting,
	// and the new version coming up healthy (or being rolled back).
	// The Updates page moved onto the settings home's About tab (v2)
	app.get("/updates", (req, res) => {
		res.redirect("/#about");
	});

	// The About tab's release notes, fetched once the page is up
	app.get("/updates/notes", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json({ sections: await releaseNotes() });
	});

	// Runs a check on demand and records it, exactly as the scheduled
	// one does. Never applies anything -- that's POST /updates/apply,
	// a separate button with its own "are you sure?".
	app.post("/updates/check", async (req, res) => {
		try {
			const status = await coreUpdater.checkForUpdate();

			if (!status) {
				// A dev build has no release to compare against.
				updateStore.recordCheck({ updateAvailable: false });
				res.json({ ok: true, updateAvailable: false });
				return;
			}

			updateStore.recordCheck({
				latestVersion: status.latestVersion,
				updateAvailable: status.updateAvailable
			});

			res.json({ ok: true, ...status });
		} catch (error) {
			updateStore.recordCheck({ error: error.message });
			res.status(502).json({ error: error.message });
		}
	});

	// Update now. Starts the install and answers straight away; the page
	// then follows it at /updates/progress. Not waited on here: the
	// download can take minutes, and once the swap starts this process
	// is stopped -- an answer held until the end would never arrive.
	//
	// Refused (409) when this OmniCore can't install updates itself, and
	// when an update is already running. Signed-in only, like everything
	// else on this face, and JSON only (see the check near the top of
	// startAdminFace), so no other page can press it for you.
	app.post("/updates/apply", async (req, res) => {
		const readiness = await coreUpdater.applyReadiness();

		if (!readiness.ready) {
			res.status(409).json({ error: readiness.reason });
			return;
		}

		if (coreUpdater.currentProgress().busy) {
			res.status(409).json({ busy: true, error: "An update is already being installed." });
			return;
		}

		const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
		const last = updateStore.lastResult(running);

		if (!last.updateAvailable) {
			res.status(409).json({ error: "There's no newer version to install. Try Check now first." });
			return;
		}

		// applyUpdate() takes the lock before its first await, so a second
		// request arriving now is already told it's busy
		coreUpdater
			.applyUpdate(last.latestVersion)
			.then((result) => {
				if (result.updated) {
					console.log(
						`  Core update started from Settings: ${result.from} → ${result.to}. ` +
							`What happened next: ${result.log}`
					);
				}
			})
			.catch((error) => {
				console.log(`  Core update from Settings failed: ${error.message}`);
			});

		res.status(202).json({ ok: true });
	});

	// How the update started above is going. See coreUpdater.currentProgress().
	app.get("/updates/progress", (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(coreUpdater.currentProgress());
	});

	// A catalogue of everything actually installed, across the whole
	// OmniCore -- not scoped to one face, since something can be
	// installed without being placed on any face yet.
	//
	// A plain disk scan (listModules/listThemes), the same source the
	// "Add a module" picker already uses -- deliberately NOT
	// marketplace.listAvailable(), which only lists something if it's
	// BOTH in the registry AND on disk. A module dropped in locally
	// during development (the normal workflow for building one against
	// a separate repo) has no registry entry at all, and would be
	// silently invisible on a page meant to show what's actually here.
	//
	// Deliberately plain for now -- the same simple list-of-segments
	// pattern used everywhere else. A better-purposed layout for a
	// catalogue specifically is a real, separate piece of design work,
	// not something to improvise here.
	app.get("/installed", (req, res) => {
		// What the last module-and-theme check found, read from disk --
		// rendering this page never costs a trip to the registry
		const lastCheck = updateStore.lastResourceCheck();

		// One segment's worth of facts about something installed.
		//
		// The version a person sees is the date of the commit installed:
		// modules and themes have no version numbers, the registry pinning
		// a newer commit IS the update, so "made on Oct 8, 4:12 PM" is what
		// tells two installs apart. The commit itself is left out on
		// purpose -- a string of hex means nothing to most people.
		function describe(kind, id, name, description) {
			const recorded = installStore.get(kind, id);

			// Waiting: the last check found an update for this and couldn't
			// install it. Only while what's installed is still the commit it
			// had then -- installed since some other way, it isn't waiting.
			const waiting =
				recorded && lastCheck
					? (lastCheck.skipped || []).find(
							(item) =>
								item.kind === kind &&
								item.id === id &&
								item.ref !== recorded.ref
					  )
					: null;

			let status;

			if (!recorded) {
				// Dropped into the folder by hand, or installed before
				// OmniCore kept records. Nothing to compare against, so
				// nothing to say about updates.
				status = { tone: "", text: "Not from the Marketplace" };
			} else if (waiting) {
				status = {
					tone: "bad",
					text: waiting.needsOmniCore
						? `Update waiting: needs OmniCore ${waiting.needsOmniCore}`
						: `Update failed: ${waiting.reason || "unknown error"}`
				};
			} else if (lastCheck && !lastCheck.error) {
				status = { tone: "good", text: "Up to date" };
			} else {
				status = null;
			}

			const facts = [];

			if (recorded && recorded.commitDate) {
				facts.push(`Version ${localTime(recorded.commitDate)}`);
			}

			if (recorded) {
				const updated = recorded.updatedAt !== recorded.installedAt;
				facts.push(
					`${updated ? "Updated" : "Installed"} ${localTime(
						recorded.updatedAt || recorded.installedAt,
						"ago"
					)}`
				);
			}

			return `
			<div class="segment resource">
				<strong>${escapeHtml(name)}</strong>
				<span class="hint">${escapeHtml(description || "")}</span>
				<div class="resource-facts">
					${
						status
							? `<span class="resource-status ${status.tone}">${escapeHtml(status.text)}</span>`
							: ""
					}
					${facts.map((fact) => `<span>${fact}</span>`).join("")}
				</div>
			</div>`;
		}

		// listModules() returns ids, so each needs its manifest read.
		// listThemes() already returns manifests -- reading them again
		// would pass an object where an id string belongs, which is
		// exactly the crash this page had.
		const moduleSegments = listModules().map((id) => {
			const manifest = readManifest(id);
			return describe("module", id, manifest.name || id, manifest.description);
		});

		const themeSegments = themeLoader
			.listThemes()
			.map((manifest) =>
				describe("theme", manifest.id, manifest.name || manifest.id, manifest.description)
			);

		const list = [...moduleSegments, ...themeSegments].join("");

		// The check, in a sentence or two
		let checkSummary;

		if (!lastCheck) {
			checkSummary = `<p class="lede">No check has run yet. One runs shortly after OmniCore starts, then every six hours.</p>`;
		} else if (lastCheck.error) {
			checkSummary = `
				<p class="lede">The last check couldn't reach the registry.</p>
				<span class="hint">${escapeHtml(lastCheck.error)}</span>`;
		} else {
			const applied = lastCheck.applied || [];
			const skipped = lastCheck.skipped || [];
			const parts = [];

			// By the names on the segments, not the ids behind them
			const themeNames = new Map(
				themeLoader.listThemes().map((manifest) => [manifest.id, manifest.name || manifest.id])
			);
			const nameOf = (item) =>
				item.kind === "theme"
					? themeNames.get(item.id) || item.id
					: readManifest(item.id).name || item.id;

			if (applied.length) {
				parts.push(`${applied.length} updated: ${applied.map((item) => escapeHtml(nameOf(item))).join(", ")}.`);
			}

			if (skipped.length) {
				parts.push(`${skipped.length} waiting.`);
			}

			checkSummary = `<p class="lede">${parts.length ? parts.join(" ") : "Everything was up to date."}</p>`;
		}

		const body = `
			<div class="settings-head">
				<h1>Installed Resources</h1>
			</div>
			<div class="bento">
				<div class="segment">
					<div class="list">
						${list || '<div class="empty">Nothing installed yet.</div>'}
					</div>
				</div>
				<div class="segment">
					${checkSummary}
					<span class="hint">Last checked: ${lastCheck ? localTime(lastCheck.checkedAt) : "never"}</span>
					<button class="glass glass-block" id="check">Check now</button>
					<p class="status" id="check-status"></p>
					<a class="glass glass-block" href="/marketplace"
						style="display:block;text-align:center;box-sizing:border-box;text-decoration:none;margin-top:12px">
						Go to Marketplace
					</a>
				</div>
			</div>`;

		// Two entrances: Settings, and the Resources figure on the About
		// face. Back returns to whichever was used rather than always
		// guessing Settings and stranding anyone who came from About.
		// The About face is on another port, so that link has to be
		// built in the browser -- the server has no idea what hostname
		// was used to reach it.
		// faceUrl() comes from portLinkScript and is NOT on every page --
		// it has to be included wherever it's used, which is exactly
		// what this was missing: the handler threw on an undefined
		// function, so the button did nothing at all.
		const backToAbout =
			req.query.from === "about"
				? portLinkScript + `
					var back = document.querySelector(".floating");
					if (back) {
						back.onclick = function () {
							omniGo(faceUrl(1303));
						};
					}
				`
				: "";

		// Check now: looks for updates to everything installed AND installs
		// them -- unlike OmniCore's own Check now, which only looks. A
		// module update is a folder swapped on disk, not this whole
		// program replaced, so there's nothing to be careful of here that
		// the every-six-hours check doesn't already do unasked.
		const checkScript = `
			var button = document.getElementById("check");
			var status = document.getElementById("check-status");

			button.addEventListener("click", async function () {
				button.disabled = true;
				status.className = "status";
				status.textContent = "Checking and updating...";

				try {
					const response = await fetch("/installed/check", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: "{}"
					});
					const data = await response.json();

					if (!response.ok || data.error) {
						status.className = "status bad";
						status.textContent = data.error || "Couldn't reach the registry.";
						button.disabled = false;
						return;
					}

					location.reload();
				} catch (error) {
					status.className = "status bad";
					status.textContent = "Couldn't reach the registry.";
					button.disabled = false;
				}
			});
		`;

		res.send(
			page("Installed Resources", body, localTimeScript + checkScript + backToAbout, "", "/")
		);
	});

	// The same check the six-hourly timer runs, on demand. Waits for it to
	// finish -- a few downloads at most -- so the page can reload onto the
	// result. A check already under way is joined rather than repeated.
	app.post("/installed/check", async (req, res) => {
		const result = await resourceScheduler.runOnce();

		if (result.error) {
			res.status(502).json({ error: result.error });
			return;
		}

		res.json({ ok: true, applied: result.applied, skipped: result.skipped });
	});

	app.get("/faces", (req, res) => {
		const faces = faceStore
			.readFaces()
			.map((face) => {
				const count = face.instances.length;

				return `
				<a class="row" href="/faces/${face.id}">
					<strong>${escapeHtml(faceStore.faceLabel(face))}</strong>
					<span>${faceStore.portsLine(face)} · ${count}${
						count === 1 ? " module" : " modules"
					}</span>
				</a>`;
			})
			.join("");

		// The heading sits on the page, the faces are the list, and the one
		// thing to do here sits where a page's actions always sit: at its
		// foot, the width of the capsule (.dock) on other pages. No segment
		// wraps any of them -- a box around a single heading, or around a
		// single button, is a box with nothing to group.
		const body = `
			<div class="settings-head">
				<h1>Faces</h1>
			</div>

			<div class="bento">
				<div class="list">
					${faces || '<div class="empty">No faces yet.</div>'}
				</div>
			</div>

			<div class="page-dock">
				<button class="glass dock-button" onclick="goToWizard()">
					Create a new face
				</button>
			</div>`;

		// The wizard lives on its own face now (3999), so this has to be
		// built in the browser — only it knows what host OmniCore was
		// actually reached at, which matters on Codespaces and any
		// reverse proxy.
		const script =
			portLinkScript +
			`
			function goToWizard() {
				omniGo(faceUrl(${WIZARD_PORT}) + "/faces/new");
			}
		`;

		res.send(page("Faces", body, script, "", "/"));
	});

	// One face: its name, its theme, and a way into its modules
	app.get("/faces/:id", (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const count = face.instances.length;
		const themeName = themeLoader.readManifest(face.theme).name;
		const faceName = faceStore.faceLabel(face);

		// A face made before v1.19.2 has no notificationMode: dark
		const noteLight = face.notificationMode === "light";

		// The face's facts, each one a label and its value (see .facts)
		const facts = faceFacts(face)
			.map(
				(fact) => `
					<div class="fact">
						<span class="fact-label">${escapeHtml(fact.label)}</span>
						<span class="fact-value"${fact.id ? ` id="${fact.id}"` : ""}>${escapeHtml(fact.value)}</span>
						${fact.hint ? `<span class="hint">${escapeHtml(fact.hint)}</span>` : ""}
					</div>`
			)
			.join("");

		// Left: what this face IS (its facts), then where to change what
		// it shows (Widgets, Theme) beside Open face and Delete face (see
		// .resource-pair for how that pair turns round on a phone).
		// Right: what it's called, then how its
		// notifications look. The two columns end level (face-columns).
		const body = `
			<div class="bento">
			<div class="bento-row two face-columns">
				<div class="bento-column">
					<div class="segment">
						<h1>${escapeHtml(faceName)}</h1>
						<div class="facts">${facts}</div>
					</div>
					<div class="resource-pair">
						<div class="segment resources">
							<h2>Manage resources</h2>
							<p class="lede">What this face shows, and how it looks.</p>
							<a class="row" href="/faces/${face.id}/modules">
								<strong>Widgets</strong>
								<span>${count ? count + (count === 1 ? " widget" : " widgets") : "None added yet"}</span>
							</a>
							<a class="row" href="/faces/${face.id}/theme">
								<strong>Theme</strong>
								<span>${escapeHtml(themeName)}</span>
							</a>
						</div>
						<!-- No heading on screen: the two buttons say it all.
						     aria-label still names the box for a screen reader. -->
						<div class="segment face-actions" role="group" aria-label="This face">
							<div class="face-buttons">
								<button type="button" class="glass" id="open-face">Open face</button>
								<button type="button" class="glass glass-danger" id="delete-face">Delete face</button>
							</div>
							<p class="status" id="delete-status"></p>
						</div>
					</div>
				</div>
				<div class="bento-column">
					<div class="segment">
						<div class="field">
							<label for="name">Name</label>
							<input type="text" id="name" value="${escapeHtml(faceName)}">
							<div class="help">
								How you recognise this face here. Blank falls back to
								${escapeHtml(faceStore.defaultFaceName(face.id))}.
							</div>
						</div>

						<div class="field">
							<label for="title">Title</label>
							<input type="text" id="title"
								value="${escapeHtml(face.title || "")}" placeholder="Optional">
							<div class="help">
								Shown on the dashboard itself, if the theme displays
								one. Blank means no heading.
							</div>
						</div>

						<button class="glass glass-block" id="save">Save face</button>
						<p class="status" id="status"></p>
					</div>

					<div class="segment note-segment">
						<h2>Notifications</h2>
						<p class="lede">
							How a notification looks on this face's screen, whatever
							theme it's running. Saved as soon as you pick one.
						</p>
						<div class="mode-previews narrow-previews">
							<div class="mode-preview note-mode ${noteLight ? "" : "active"}"
								data-note-mode="dark" role="button" tabindex="0">
								<div class="mode-screen" style="background:#0c0d10">
									<span style="width:40%;height:5px;background:rgba(255,255,255,0.8)"></span>
									<span style="width:70%;height:4px;background:rgba(255,255,255,0.3)"></span>
									<span style="width:55%;height:4px;background:rgba(255,255,255,0.3)"></span>
								</div>
								<div class="mode-preview-label">Dark${noteLight ? "" : " (Active)"}</div>
							</div>
							<div class="mode-preview note-mode ${noteLight ? "active" : ""}"
								data-note-mode="light" role="button" tabindex="0">
								<div class="mode-screen" style="background:#e5e7eb">
									<span style="width:40%;height:5px;background:#4b5563"></span>
									<span style="width:70%;height:4px;background:#9ca3af"></span>
									<span style="width:55%;height:4px;background:#9ca3af"></span>
								</div>
								<div class="mode-preview-label">Light${noteLight ? " (Active)" : ""}</div>
							</div>
						</div>
						<p class="status" id="note-status"></p>
					</div>
				</div>
			</div>
			</div>`;

		const script = `
			// "Showing on" stays current while this page is open: a screen
			// turned on or off shows up here within a few seconds, without
			// reloading. Asking every five seconds costs one tiny request.
			(function () {
				var displays = document.getElementById("display-count");
				if (!displays) return;

				setInterval(async function () {
					try {
						var response = await fetch("/faces/${face.id}/displays");
						if (!response.ok) return;
						displays.textContent = (await response.json()).text;
					} catch (error) {
						// OmniCore restarting, say: keep the last number
					}
				}, 5000);
			})();

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/faces/${face.id}", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							name: document.getElementById("name").value,
							title: document.getElementById("title").value
						})
					});

					if (!response.ok) throw new Error();

					status.textContent = "Saved. The face has updated itself.";
					status.className = "status good";
				} catch (error) {
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}

				button.disabled = false;
			});

			// Notifications: light or dark, saved on click. The face's
			// screen redraws itself, so the next notification there is
			// already in the new look.
			async function chooseNoteMode(preview) {
				const status = document.getElementById("note-status");
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/faces/${face.id}", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ notificationMode: preview.dataset.noteMode })
					});

					if (!response.ok) throw new Error();

					for (const other of document.querySelectorAll(".note-mode")) {
						const chosen = other === preview;
						const label = other.querySelector(".mode-preview-label");
						const name = other.dataset.noteMode === "light" ? "Light" : "Dark";

						other.classList.toggle("active", chosen);
						label.textContent = name + (chosen ? " (Active)" : "");
					}
				} catch (error) {
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}
			}

			for (const preview of document.querySelectorAll(".note-mode")) {
				preview.addEventListener("click", function () {
					chooseNoteMode(preview);
				});
				preview.addEventListener("keydown", function (event) {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						chooseNoteMode(preview);
					}
				});
			}

			${portLinkScript}

			// Open face: the face itself, in a new tab, so this page stays
			// where it was. Built here because only the browser knows the
			// address OmniCore was reached at (see faceUrl).
			document.getElementById("open-face").addEventListener("click", function () {
				window.open(faceUrl(${face.id}) + "/", "_blank", "noopener");
			});

			// Delete face: asked first, in the Default UI's own pop-up.
			// There's no undo, so the question says what goes with it.
			document.getElementById("delete-face").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("delete-status");

				const sure = await confirmDialog({
					title: ${JSON.stringify(`Delete ${faceName}?`).replace(/</g, "\\u003c")},
					text: ${JSON.stringify(deleteWarning(face)).replace(/</g, "\\u003c")},
					confirm: "Delete face",
					danger: true
				});

				if (!sure) return;

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/faces/${face.id}", { method: "DELETE" });
					if (!response.ok) throw new Error();

					// Back to the list of faces, which no longer has it
					omniGo("/faces");
				} catch (error) {
					status.textContent = "Couldn't delete it. Check OmniCore is still running.";
					status.className = "status bad";
					button.disabled = false;
				}
			});
		`;

		res.send(page(faceName, body, script, "", "/faces"));
	});

	// How many screens are showing a face right now, for its page to keep
	// its "Showing on" line current without reloading
	app.get("/faces/:id/displays", (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		const count = displayCount(face.id);
		res.json({ count, text: screensText(count) });
	});

	// Delete a face for good (since v1.19.8). In this order: the screens
	// showing it are sent to the welcome face and its port closes, its
	// Inport closes, whatever its widgets run in the background stops,
	// and only then is its record deleted with everything its widgets
	// saved. Notifications still waiting for a screen go with it.
	app.delete("/faces/:id", async (req, res) => {
		const id = Number(req.params.id);
		const face = faceStore.findFace(id);

		if (!face) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		await stopFace(id);
		stopInputFace(id);

		// An empty face to line up with: every background run stops
		await background.syncFace({ ...face, instances: [] });

		faceStore.deleteFace(id);
		notifications.forgetFace(id);

		res.json({ ok: true });
	});

	app.post("/faces/:id", (req, res) => {
		const id = Number(req.params.id);

		if (!faceStore.updateFace(id, {
			name: req.body.name,
			title: req.body.title,
			theme: req.body.theme,
			notificationMode: req.body.notificationMode
		})) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		res.json(refresh(id));
	});

	// A face's theme: what it's using, and how that theme is set up.
	//
	// Changing the theme is a separate page. It replaces the entire
	// dashboard, so it shouldn't sit one stray click away from a settings
	// form you haven't saved yet.
	app.get("/faces/:id/theme", async (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const manifest = themeLoader.readManifest(face.theme);
		const schema = themeLoader.readSchema(face.theme);
		const config = themeLoader.applyDefaults(
			face.theme,
			(face.themeConfigs || {})[face.theme]
		);

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>${escapeHtml(manifest.name)}</h1>
					<p class="lede" style="margin-bottom:14px">${escapeHtml(
						face.theme
							? manifest.description || "The theme this face is using"
							: "This face hasn't been given a theme yet, so its screen shows OmniCore's own page"
					)}</p>
					<a class="row" href="/faces/${face.id}/theme/change">
						<strong>${face.theme ? "Change theme" : "Choose a theme"}</strong>
						<span>${face.theme ? "Use a different theme on this face" : "Pick the theme this face shows"}</span>
					</a>
				</div>
				<div class="segment">
					${
						schema.length
							? renderFields(schema, config, {
									instances: face.instances,
									labels: await labelsFor(face.instances)
							  }) +
							  '<button class="glass glass-block" id="save">Save</button>' +
							  '<p class="status" id="status"></p>'
							: '<div class="empty">This theme has nothing to configure.</div>'
					}
				</div>
			</div>`;

		const script = schema.length
			? `
			${conditionalScript}
			${priorityScript}
			${locationScript}

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");
				const config = {};

				for (const input of document.querySelectorAll("[data-key]")) {
					config[input.dataset.key] =
						input.dataset.type === "boolean" ? input.checked : input.value;
				}

				collectLocations(config);

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/faces/${face.id}/theme", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(config)
					});

					if (!response.ok) throw new Error();

					status.textContent = "Saved. The face has updated itself.";
					status.className = "status good";
				} catch (error) {
					status.textContent = "Couldn't save.";
					status.className = "status bad";
				}

				button.disabled = false;
			});
		`
			: "";

		res.send(page(manifest.name, body, script, "", `/faces/${face.id}`));
	});

	app.post("/faces/:id/theme", (req, res) => {
		const id = Number(req.params.id);
		const face = faceStore.findFace(id);

		if (!face) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		// No theme means no theme settings to save, and nowhere to keep
		// them: they're stored under the theme's name
		if (!face.theme) {
			res.status(409).json({ error: "This face has no theme yet" });
			return;
		}

		faceStore.updateThemeConfig(
			id,
			face.theme,
			themeLoader.cleanConfig(face.theme, req.body)
		);

		res.json(refresh(id));
	});

	// Picking a different theme. Its own page, because it's a bigger
	// decision than changing a setting.
	app.get("/faces/:id/theme/change", (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const themes = themeLoader
			.listThemes()
			.map((theme) => {
				const current = theme.id === face.theme;

				return `
				<a class="row" href="#" data-theme="${escapeHtml(theme.id)}">
					<strong>${escapeHtml(theme.name)}${current ? " · in use" : ""}</strong>
					<span>${escapeHtml(theme.description || theme.id)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>Change theme</h1>
					<p class="lede" style="margin-bottom:14px">
						Settings you've already made are kept per theme, so
						switching back later restores them.
					</p>
					<div class="list">
						${themes || '<div class="empty">No themes installed.</div>'}
					</div>
					<p class="status" id="status" style="margin-top:12px"></p>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/marketplace"
						style="display:block;text-align:center;box-sizing:border-box;text-decoration:none">
						Get more themes
					</a>
				</div>
			</div>`;

		const script = `
			for (const row of document.querySelectorAll("[data-theme]")) {
				row.addEventListener("click", async function (event) {
					event.preventDefault();

					try {
						const response = await fetch("/faces/${face.id}", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ theme: this.dataset.theme })
						});

						if (!response.ok) throw new Error();

						omniGo("/faces/${face.id}/theme");
					} catch (error) {
						const status = document.getElementById("status");
						status.textContent = "Couldn't change the theme.";
						status.className = "status bad";
					}
				});
			}
		`;

		res.send(page("Change theme", body, script, "", `/faces/${face.id}/theme`));
	});

	// The module instances on a face. The same module may appear more than
	// once, each with its own settings.
	app.get("/faces/:id/modules", async (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const labels = await labelsFor(face.instances);

		const instances = face.instances
			.map((instance) => {
				const manifest = readManifest(instance.module);

				// For a module with a choice of widget types, which one this
				// instance shows -- two calendars side by side are easier
				// to tell apart as "Month View" and "Agenda View"
				const widgetType = widgetTypes.offersChoice(manifest)
					? manifest.widgets.find(
							(widget) => widget.id === widgetTypeOf(instance.module, instance.config)
					  )
					: null;
				const kind = widgetType
					? `${manifest.name} · ${widgetType.name}`
					: manifest.name;

				return `
				<a class="row" href="/faces/${face.id}/modules/${encodeURIComponent(instance.id)}">
					<strong>${escapeHtml(labels[instance.id])}</strong>
					<span>${escapeHtml(kind)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1 style="margin-bottom:14px">Modules</h1>
					<div class="list">
						${instances || '<div class="empty">No modules on this face yet.</div>'}
					</div>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/faces/${face.id}/modules/add"
						style="display:block;text-align:center;box-sizing:border-box;text-decoration:none">
						Add a module
					</a>
				</div>
			</div>`;

		res.send(page("Modules", body, "", "", `/faces/${req.params.id}`));
	});

	// Pick a module to add. Every installed module is listed, including ones
	// already on this face — adding a second weather is the whole point.
	app.get("/faces/:id/modules/add", (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const modules = listModules()
			.map((moduleId) => {
				const manifest = readManifest(moduleId);

				return `
				<a class="row" href="#" onclick="addModule('${escapeHtml(moduleId)}'); return false;">
					<strong>${escapeHtml(manifest.name)}</strong>
					<span>${escapeHtml(manifest.description || moduleId)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>Add a module</h1>
					<p class="lede" style="margin-bottom:14px">You can add the same module more than once.</p>
					<div class="list">
						${modules || '<div class="empty">No modules installed.</div>'}
					</div>
					<p class="status" id="status" style="margin-top:12px"></p>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/marketplace"
						style="display:block;text-align:center;box-sizing:border-box;text-decoration:none">
						Get more modules
					</a>
				</div>
			</div>`;

		const script = `
			async function addModule(moduleId) {
				const status = document.getElementById("status");

				try {
					const response = await fetch("/faces/${face.id}/modules", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ module: moduleId })
					});

					if (!response.ok) throw new Error();

					const instance = await response.json();

					// Straight into its settings — a new instance usually
					// needs configuring before it's useful
					omniGo("/faces/${face.id}/modules/" +
						encodeURIComponent(instance.id));
				} catch (error) {
					status.textContent = "Couldn't add that module.";
					status.className = "status bad";
				}
			}
		`;

		res.send(page("Add a module", body, script, "", `/faces/${req.params.id}/modules`));
	});

	app.post("/faces/:id/modules", async (req, res) => {
		const id = Number(req.params.id);
		const moduleId = req.body.module;

		if (!listModules().includes(moduleId)) {
			res.status(400).json({ error: "No such module installed" });
			return;
		}

		const manifest = readManifest(moduleId);
		const face = faceStore.findFace(id);

		if (!face) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		const instance = faceStore.addInstance(
			id,
			moduleId,
			// No label of its own: it follows its settings, or is called
			// by the module's name, until somebody types one (see
			// instance-label.js)
			"",
			{},
			// Start from the theme's defaults for an instance. A module that
			// works behind the scenes gets whatever that theme calls hidden.
			{
				[face.theme]: themeLoader.instanceDefaults(
					face.theme,
					manifest.tile
				)
			}
		);

		if (!instance) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		// Brings the face's Inport in line with what it now holds. If
		// this was the first input-capable module on a face that had
		// none, this is what opens its Inport; if the face already had
		// one running, this is what makes the new module reachable on
		// it. A face with nothing taking input stays closed.
		await refreshInputFace(faceStore.findFace(id));

		// And if it's a module that runs in the background, this is what
		// starts it. Not waited on: starting may mean reaching a server,
		// and saving shouldn't hang on somebody else's network.
		background.syncFace(faceStore.findFace(id));

		refresh(id);
		res.json(instance);
	});

	// One instance's settings: its label, plus whatever its module declared
	app.get("/faces/:id/modules/:instanceId", async (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const instance = face.instances.find(
			(candidate) => candidate.id === req.params.instanceId
		);

		if (!instance) {
			res.status(404).send(
				notFound("No such module", `/faces/${face.id}/modules`, "Modules")
			);
			return;
		}

		const manifest = readManifest(instance.module);
		const schema = readSchema(instance.module);
		const config = applyDefaults(instance.module, instance.config);

		// A module with a choice of widget types gets a picker at the top,
		// one button per type. Every field for every type is on the page;
		// the ones that don't fit the picked type are just hidden, so
		// switching shows them straight away and nothing typed is lost.
		const offersChoice = widgetTypes.offersChoice(manifest);
		const picker = offersChoice
			? widgetTypes.pickerHtml(
					manifest.widgets,
					config[widgetTypes.KEY],
					escapeHtml
			  )
			: "";

		// The face's theme may want things configured per instance — how big
		// this tile is, usually. Those fields come from the THEME, not the
		// module, and are stored separately under the theme's own key. The
		// same fields whichever widget type is picked: the theme sizes the
		// tile, the module decides what fits.
		const themeSchema = themeLoader.readInstanceSchema(face.theme);
		const themeConfig = themeLoader.applyInstanceDefaults(
			face.theme,
			(instance.themeConfigs || {})[face.theme]
		);
		const themeName = themeLoader.readManifest(face.theme).name;

		// What this widget is called (instance-label.js), and what it would
		// be called with the Label box empty: the module's suggestion from
		// its settings, or the module's name. The second is shown greyed
		// in the empty box, so it's clear what clearing it gives.
		//
		// The page's heading is always the module's own name ("Weather"),
		// since v1.19.9: the label belongs to the tile, and a heading that
		// changed with the place ("Quincy") made the page look like a
		// different module depending on where it was set. The browser tab
		// keeps the widget's name, so two weather widgets can be told apart.
		const suggestion = await suggestedLabel(instance);
		const following = suggestion || manifest.name;
		const shownName = ownLabel(instance) || following;
		const labels = await labelsFor(face.instances);

		// Laid out as segments like every other admin page:
		//
		//   [ name, what the module is, and its widget type picker ]
		//   [ the module's settings ]  [ a short Info order          ]
		//                              [ the theme's settings for it ]
		//                              [ Refresh                     ]
		//                  ( Save  |  Remove )
		//
		// Save and Remove are one capsule under the segments (the wizard's
		// .dock), Remove in red. Remove still asks before doing anything.
		// The page is docked (body.docked, since v1.19.9): the capsule stays
		// at the bottom of the window and long settings scroll inside their
		// own box rather than pushing it off the screen.
		//
		// The theme's segment only when the theme has anything to set. A
		// short Info order (four items or fewer) gets a box of its own in
		// the same column. With neither, the module's settings take the
		// whole row, with Refresh under them. The two columns end level,
		// like a face's page.
		//
		// Refresh is the module's refreshMinutes setting, drawn by Core in
		// a box of its own rather than among the module's settings: it
		// decides how often OmniCore calls out to the internet for this
		// widget, so it looks the same for every module and authors don't
		// have to do anything to get it. See module-config.js.
		const themeSegment = themeSchema.length
			? `<div class="segment">
					<h2>In ${escapeHtml(themeName)}</h2>
					<p class="lede">How the face's theme shows this module.</p>
					${renderFields(
						themeSchema,
						themeConfig,
						{ instances: face.instances, labels: labels },
						"theme"
					)}
				</div>`
			: "";

		const refreshFields = schema.filter(isRefreshField);

		// An Info order of four items or fewer gets a box of its own, with
		// the rows right there to drag (since v2). A longer one stays among
		// the settings as a button that opens the whole list in a pop-up.
		// See priority-ui.js.
		const ownBox = (field) =>
			field.type === "priority" &&
			priority.normalize(config[field.key], field.options).length <=
				priorityUi.INLINE_MAX;

		const orderFields = schema.filter(
			(field) => !isRefreshField(field) && ownBox(field)
		);
		const moduleFields = schema.filter(
			(field) => !isRefreshField(field) && !ownBox(field)
		);

		// The box carries the setting's showWhen and widget types, so it
		// hides as a whole, the way a .field would
		const orderSegments = orderFields
			.map(
				(field) => `<div class="segment order-segment"${fieldAttributes(field)}>
					<h2>${escapeHtml(field.label || field.key)}</h2>
					<p class="lede">${escapeHtml(
						field.help ||
							"Drag a row, or move it with the arrows. What's at the top shows even on the smallest tile."
					)}</p>
					${priorityUi.priorityFieldHtml(
						field,
						priority.normalize(config[field.key], field.options),
						"module",
						escapeHtml
					)}
				</div>`
			)
			.join("");

		const refreshSegment = refreshFields.length
			? `<div class="segment refresh-segment">
					<h2>Refresh</h2>
					<p class="lede">How often this widget gets new data. Never less than a minute.</p>
					${renderFields(refreshFields, config, null, "module")}
				</div>`
			: "";

		const settingsSegment = `
					<div class="segment">
						<h2 style="margin-bottom:14px">Settings</h2>
						<div class="field">
							<label for="label">Label</label>
							<input type="text" id="label" value="${escapeHtml(ownLabel(instance))}"
								placeholder="${escapeHtml(following)}">
							<div class="help">
								Shown as the tile's title. Leave it empty to use
								&ldquo;${escapeHtml(following)}&rdquo;${
									suggestion ? ", which follows this widget's settings" : ""
								}.
							</div>
						</div>

						${
							moduleFields.length
								? renderFields(moduleFields, config, null, "module")
								: '<div class="empty">This module has nothing else to configure.</div>'
						}
					</div>`;

		// With anything in the right-hand column (a short Info order, the
		// theme's box), Refresh goes under it; without, under the module's
		// settings
		const rightColumn = orderSegments + themeSegment;
		const columns = rightColumn
			? `<div class="bento-row two face-columns">
					<div class="bento-column">${settingsSegment}</div>
					<div class="bento-column">${rightColumn}${refreshSegment}</div>
				</div>`
			: `<div class="bento-row top">
					<div class="bento-column">${settingsSegment}${refreshSegment}</div>
				</div>`;

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>${escapeHtml(manifest.name)}</h1>
					<p class="lede"${picker ? ' style="margin-bottom:14px"' : ""}>${escapeHtml(
						manifest.description || manifest.name
					)}</p>
					${picker}
				</div>

				${columns}
			</div>

			<div class="page-dock">
				<div class="dock">
					<button type="button" id="save">Save</button>
					<button type="button" class="danger" id="remove">Remove</button>
				</div>
				<p class="status" id="status"></p>
			</div>`;

		const script = `
			${conditionalScript}
			${priorityScript}
			${locationScript}
			${widgetTypes.pickerScript}

			applyWidgetFilter();

			const base = "/faces/${face.id}/modules/${encodeURIComponent(instance.id)}";
			const modulesPage = "/faces/${face.id}/modules";

			// How long "Saved" shows before going back to the list
			const SAVED_PAUSE = 900;

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");
				const config = {};

				const themeConfig = {};

				// The form carries fields from two authors — the module and
				// the face's theme. Keep them apart; they're stored apart.
				for (const input of document.querySelectorAll("[data-key]")) {
					const target =
						input.dataset.scope === "theme" ? themeConfig : config;

					target[input.dataset.key] =
						input.dataset.type === "boolean" ? input.checked : input.value;
				}

				collectLocations(config);

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch(base, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							label: document.getElementById("label").value,
							config: config,
							themeConfig: themeConfig
						})
					});

					if (!response.ok) throw new Error();

					// The face reads this per request, so it's already live.
					// Then back to the face's list of widgets, after long
					// enough to read that it worked. The button stays off
					// meanwhile, so it can't be saved twice on the way out.
					status.textContent = "Saved. Already in effect.";
					status.className = "status good";
					setTimeout(function () { omniGo(modulesPage); }, SAVED_PAUSE);
					return;
				} catch (error) {
					// Stays on the page, so nothing typed is lost
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}

				button.disabled = false;
			});

			document.getElementById("remove").addEventListener("click", async function () {
				const sure = await confirmDialog({
					title: "Remove this module?",
					text:
						"It comes off this face along with its settings. The module itself " +
						"stays installed, so you can add it again later.",
					confirm: "Remove",
					danger: true
				});

				if (!sure) return;

				await fetch(base, { method: "DELETE" });
				omniGo(modulesPage);
			});
		`;

		// The Back button's corner matters to a docked page: bottom right,
		// the capsule leaves room for it on a phone held upright
		const backBottomRight = readSettings().backButtonCorner !== "top-left";

		res.send(page(
			shownName,
			body,
			script,
			backBottomRight ? "docked back-br" : "docked",
			`/faces/${req.params.id}/modules`
		));
	});

	app.post("/faces/:id/modules/:instanceId", (req, res) => {
		const id = Number(req.params.id);
		const face = faceStore.findFace(id);

		if (!face) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		const instance = face.instances.find(
			(candidate) => candidate.id === req.params.instanceId
		);

		if (!instance) {
			res.status(404).json({ error: "No such module on this face" });
			return;
		}

		const updated = faceStore.updateInstance(id, instance.id, {
			label: req.body.label,
			// Keep only what the module declared, converted to its real types
			config: cleanConfig(instance.module, req.body.config),
			// And separately, what the face's theme declared for this
			// instance — stored under that theme's key
			themeId: face.theme,
			themeConfig: themeLoader.cleanInstanceConfig(
				face.theme,
				req.body.themeConfig
			)
		});

		// A background instance was started with its old settings. If they
		// just changed, this stops it and starts it again with the new ones;
		// if only the label changed, it's left running as it was.
		background.syncFace(faceStore.findFace(id));

		refresh(id);
		res.json(updated);
	});

	app.delete("/faces/:id/modules/:instanceId", async (req, res) => {
		const id = Number(req.params.id);
		const removed = faceStore.removeInstance(id, req.params.instanceId);

		if (!removed) {
			res.status(404).json({ error: "No such module on this face" });
			return;
		}

		// A deleted instance's button shouldn't keep answering taps for a
		// module that's no longer even on the face — and if that was the
		// last thing on this face taking input, its Inport closes
		// entirely rather than staying open with nothing behind it.
		await refreshInputFace(faceStore.findFace(id));

		// Anything it was doing in the background stops with it
		background.syncFace(faceStore.findFace(id));

		refresh(id);
		res.json({ ok: true });
	});

	app.listen(ADMIN_PORT, () => {
		console.log(`Admin face listening on port ${ADMIN_PORT}`);
	});
}

module.exports = startAdminFace;