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
//   /faces/:id/modules                   The module instances on that face
//   /faces/:id/modules/add               Pick a module to add
//   /faces/:id/modules/:instanceId       One instance's settings
//
// Modules sit under a face because a module instance belongs to a face. The
// same module can appear more than once with different settings — two
// weather tiles for two cities — so there's no single global "weather" to
// configure.
//
// Every settings form is generated from what a module declared in its
// settings.json. Modules never supply HTML, which is what keeps admin pages
// consistent no matter who wrote the module.

const express = require("express");
const { listModules } = require("./module-loader");
const {
	readManifest,
	readSchema,
	applyDefaults,
	cleanConfig
} = require("./module-config");
const themeLoader = require("./theme-loader");
const priority = require("./priority");
const marketplace = require("./marketplace");
const imageProxy = require("./image-proxy");
const { readSettings, writeSettings } = require("./settings-store");
const { getLocation, searchCities } = require("./location-service");
const faceStore = require("./face-store");
const { refresh } = require("./face-loader");
const { uiStyles, backButton } = require("./ui-theme");
const { portLinkScript, WIZARD_PORT } = require("./face-links");
const fontService = require("./font-service");
const { startInputFace, stopInputFace } = require("./input-face-loader");
const auth = require("./admin-auth");

const ADMIN_PORT = 3000;

const styles = `
	/* Layout only — background, colour, and font all come from the
	   shared Default UI stylesheet prepended in page() below. */
	body {
		min-height: 100vh;
		padding: 48px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
	}

	/* Only the sign-in and setup screens centre vertically. "safe" falls
	   back to top-aligned if content is ever taller than the screen, so
	   nothing gets cut off with no way to scroll to it. */
	body.centered { justify-content: safe center; }

	.panel { width: 100%; max-width: 460px; }

	h1 { font-weight: 300; font-size: 28px; margin: 0; }
	.lede { opacity: 0.55; font-size: 14px; margin: 10px 0 0 0; }

	a { color: var(--fg); text-decoration: none; }

	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
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

	.field { margin-bottom: 20px; }

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border: 1px solid var(--border);
		border-radius: 10px;
		margin-bottom: 8px;
		cursor: pointer;
		font-size: 15px;
	}

	.option:hover { background: var(--hover-subtle); }
	.option input { width: 17px; height: 17px; }

	/* A reorderable priority list. Deliberately looks like .option rows,
	   since it's the same kind of choice made a different way. */
	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		margin-bottom: 8px;
		font-size: 15px;
	}

	.priority-rank {
		opacity: 0.4;
		font-size: 12px;
		min-width: 16px;
		text-align: right;
	}

	.priority-name { flex: 1; }

	.priority-move {
		width: 32px;
		height: 32px;
		padding: 0;
		margin: 0;
		flex: none;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		color: inherit;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--glass-bg);
	}

	.priority-move:hover:not(:disabled) {
		background: var(--border);
	}

	.priority-move:disabled { opacity: 0.2; cursor: default; }

	label {
		display: block;
		font-size: 14px;
		opacity: 0.7;
		margin-bottom: 8px;
	}

	.help { font-size: 12px; opacity: 0.45; margin-top: 6px; }

	input[type="text"],
	input[type="url"],
	input[type="number"],
	input[type="password"],
	select {
		width: 100%;
		box-sizing: border-box;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		color: var(--fg);
		font-size: 16px;
		padding: 12px 16px;
	}

	input[type="checkbox"] { width: 18px; height: 18px; }

	input[type="color"] {
		width: 100%;
		height: 46px;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 10px;
		padding: 4px;
		cursor: pointer;
	}

	/* Dropdown options fall back to the browser's own popup colours unless
	   we say otherwise, which means white on white in a dark interface */
	option {
		background: var(--bg);
		color: var(--fg);
	}


	.back { font-size: 14px; opacity: 0.6; }
	.empty { opacity: 0.5; font-size: 14px; }

	.search-row { display: flex; gap: 8px; }
	.search-row input { flex: 1; }

	.result {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--input-bg);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--fg);
		font-size: 14px;
		font-family: inherit;
		padding: 10px 14px;
		margin-top: 8px;
		cursor: pointer;
	}

	.result:hover { background: var(--card-border); }
	.status { font-size: 14px; min-height: 20px; margin-top: 14px; }
	.status.good { color: var(--success); }
	.status.bad { color: var(--danger); }

	/* Explanatory text under a control — quieter than the label it
	   belongs to, for the "why" rather than the "what" */
	.hint {
		display: block;
		color: var(--fg-muted);
		font-size: 13px;
		margin: 4px 0 8px 0;
	}

	.footer { opacity: 0.4; font-size: 13px; }

	/* Marketplace — wider than a settings panel, since it needs room for
	   a grid rather than one stacked column. Same tokens as everywhere
	   else in this file: same border, same radius, same opacity scale
	   for secondary text. Tidier, not a different design language. */
	.market-wide { width: 100%; max-width: 900px; }

	.market-search {
		width: 100%;
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: transparent;
		color: var(--fg);
		font-size: 14px;
		font-family: inherit;
		box-sizing: border-box;
	}

	.market-search::placeholder { color: var(--fg-muted); }
	.market-search:focus { outline: none; border-color: var(--glass-border); }

	.market-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 14px;
		margin-top: 16px;
	}

	.market-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: 12px;
	}

	.market-card h3 { margin: 0; font-size: 16px; font-weight: 500; }
	.market-card .desc { opacity: 0.6; font-size: 13px; flex: 1; line-height: 1.4; }
	.market-card .author { opacity: 0.45; font-size: 12px; }
	.market-card .installed { opacity: 0.5; font-size: 13px; }

	/* Hidden by search filtering, not removed — keeps the grid's DOM
	   order stable so nothing reflows unexpectedly as you type */
	.market-card[hidden] { display: none; }

	.market-empty { opacity: 0.45; font-size: 14px; padding: 8px 0 20px; }

	/* The one button style in this file. Everything else here is either
	   unstyled (system default) or its own narrow-purpose class like
	   .priority-move — this is deliberately the first general one,
	   scoped so it doesn't change anything that already exists. */
	.btn {
		padding: 9px 16px;
		border: 1px solid var(--glass-border);
		border-radius: 8px;
		background: var(--glass-bg);
		color: var(--fg);
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
	}

	.btn:hover:not(:disabled) { background: var(--border); }
	.btn:disabled { opacity: 0.5; cursor: default; }

	/* A real focus ring, scoped tightly to the button itself — never the
	   browser's default, which on some renders looks like it's glowing
	   out around whatever contains the button (a card, here) rather than
	   the button. Still genuinely visible, which keyboard use needs. */
	.btn:focus { outline: none; }
	.btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--fg-muted);
	}

	/* Header row: title on the left, a way to reach settings on the
	   right, without disturbing every other page's centred single
	   column. */
	.market-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	/* Modules / Themes. A search box above them stays visible across
	   both — only which cards it can see changes. */
	.market-tabs { display: flex; gap: 6px; margin: 24px 0 4px; }

	.tab-btn {
		padding: 8px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: transparent;
		color: var(--fg-muted);
		font-size: 14px;
		font-family: inherit;
		cursor: pointer;
	}

	.tab-btn:hover:not(.active) { background: var(--hover-subtle); }

	.tab-btn.active {
		background: var(--card-border);
		color: var(--fg);
		border-color: var(--glass-sheen);
	}

	/* A card is a link to its detail page, EXCEPT the Install button,
	   which needs its own click. The link is stretched to the card's
	   full size via inset:0; the button sits above it on the stacking
	   order, so a click there hits the button, not the link beneath. */
	.market-card { position: relative; }

	.market-card .card-link {
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.market-card .btn, .market-card .installed {
		position: relative;
		z-index: 2;
		align-self: flex-start;
	}

	/* The one place this file deliberately breaks from flat, minimal
	   buttons — a source you're about to trust with full server access
	   is exactly the moment a slicker, more consequential-feeling
	   control earns its keep. */
	.btn-glossy {
		padding: 11px 22px;
		border-radius: 8px;
		font-size: 14px;
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid var(--glass-border);
		box-shadow: inset 0 1px 0 var(--glass-sheen), 0 2px 6px rgba(0, 0, 0, 0.35);
	}

	.btn-glossy-green {
		color: var(--success-text);
		background: linear-gradient(to bottom, var(--success), var(--success-hover));
		border-color: var(--success-hover);
	}

	.btn-glossy-green:hover { background: linear-gradient(to bottom, var(--success), var(--success-hover)); }

	.btn-glossy-neutral {
		color: var(--fg);
		background: linear-gradient(to bottom, var(--disabled-text), var(--disabled));
	}

	.btn-glossy-neutral:hover { background: linear-gradient(to bottom, var(--disabled-text), var(--border)); }

	/* Shown once, right before a third-party source is actually added.
	   Deliberately not styled like anything else on this page — this is
	   the one moment worth standing out. */
	.market-warning {
		background: linear-gradient(165deg, var(--danger-bg), var(--danger-bg));
		border: 1px solid var(--danger-border);
		border-radius: 12px;
		padding: 22px;
	}

	.market-warning h3 { color: var(--danger); margin: 0 0 12px 0; font-size: 17px; }
	.market-warning p { color: var(--danger-text); font-size: 14px; line-height: 1.6; margin: 0 0 12px 0; }
	.market-warning p:last-of-type { margin-bottom: 0; }

	.provides-tag {
		display: inline-block;
		padding: 4px 10px;
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		font-size: 12px;
		opacity: 0.75;
		margin: 0 6px 6px 0;
	}
	.danger { color: var(--danger); font-size: 14px; cursor: pointer; }

	/* Glass-style button with a soft light reflection */
	.glass {
		position: relative;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: 12px;
		backdrop-filter: blur(12px);
		color: var(--fg);
		font-size: 16px;
		padding: 14px 28px;
		cursor: pointer;
		width: 100%;
	}

	.glass:hover { background: var(--border); }
	.glass:disabled { opacity: 0.35; cursor: not-allowed; }

	.glass::before {
		content: "";
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, var(--glass-sheen), transparent
		);
		pointer-events: none;
	}
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
// `back` is a URL for the floating back button, or nothing at all for a
// screen that is genuinely a root (sign-in, the settings home) where
// there's nowhere above to go.
function page(title, body, script, bodyClass, back) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${uiStyles()}${styles}</style>
</head>
<body class="${bodyClass || ""}">
	${body}
	${backButton(back)}
	<script>${script || ""}</script>
</body>
</html>`;
}

// One line describing how location is set up, for the settings list
// A one-line summary of how the UI is currently set, for the settings
// list. Says the things someone actually changed rather than reciting
// every value: a fresh install just reads "Dark".
function describeAppearance(settings) {
	const parts = [settings.uiMode === "light" ? "Light" : "Dark"];

	if (settings.uiFontFamily) {
		parts.push(settings.uiFontFamily);
	}

	if (Number(settings.uiFontSize) !== 16) {
		parts.push(`${settings.uiFontSize}px`);
	}

	return parts.join(" · ");
}

function describeLocationSetting(settings) {
	if (!settings.locationEnabled) {
		return "Off";
	}

	if (settings.locationMode !== "manual") {
		return "Automatic (IP based)";
	}

	if (settings.locationLabel) {
		return "Manual (" + settings.locationLabel + ")";
	}

	if (settings.latitude === null || settings.longitude === null) {
		return "Manual (not set)";
	}

	return (
		"Manual (" +
		Number(settings.latitude).toFixed(2) + ", " +
		Number(settings.longitude).toFixed(2) + ")"
	);
}

// Shared by every page that renders a settings form: show or hide the
// coordinate boxes as the radio changes, and read location fields back out
const conditionalScript = `
	// Show or hide fields that depend on another field's value, and keep
	// doing so as that value changes
	function applyFieldConditions() {
		for (const field of document.querySelectorAll("[data-when-key]")) {
			const control = document.querySelector(
				'[data-key="' + field.dataset.whenKey + '"]'
			);

			if (!control) continue;

			const allowed = field.dataset.whenIs.split("|");
			field.style.display = allowed.indexOf(control.value) === -1 ? "none" : "";
		}
	}

	for (const control of document.querySelectorAll("[data-key]")) {
		control.addEventListener("change", applyFieldConditions);
	}

	applyFieldConditions();
`;

const locationScript = `
	// Look a city up and offer the matches. Clicking one fills in the
	// coordinate boxes — the stored value is still just coordinates.
	async function searchCity(key) {
		const query = document.querySelector('[data-loc-query="' + key + '"]').value;
		const results = document.querySelector('[data-loc-results="' + key + '"]');

		results.innerHTML = '<div class="empty" style="margin-top:8px">Searching…</div>';

		try {
			const found = await (
				await fetch("/geocode?q=" + encodeURIComponent(query))
			).json();

			if (!found.length) {
				results.innerHTML =
					'<div class="empty" style="margin-top:8px">Nothing found.</div>';
				return;
			}

			window["cities_" + key] = found;

			results.innerHTML = found.map(function (place, index) {
				const safe = place.label
					.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
				return '<button class="result" data-loc-pick="' + key +
					'" data-index="' + index + '">' + safe + "</button>";
			}).join("");

			// Wire the results up rather than relying on inline handlers
			for (const button of results.querySelectorAll("[data-loc-pick]")) {
				button.addEventListener("click", function () {
					pickCity(this.dataset.locPick, Number(this.dataset.index));
				});
			}
		} catch (error) {
			results.innerHTML =
				'<div class="empty" style="margin-top:8px">Search failed.</div>';
		}
	}

	function pickCity(key, index) {
		const place = window["cities_" + key][index];

		document.querySelector('[data-loc-lat="' + key + '"]').value = place.latitude;
		document.querySelector('[data-loc-lon="' + key + '"]').value = place.longitude;
		document.querySelector('[data-loc-query="' + key + '"]').value = place.label;
		document.querySelector('[data-loc-results="' + key + '"]').innerHTML = "";
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

// Reordering a priority list.
//
// The chosen order lives in a hidden input, so the save handlers on every
// page collect it exactly the way they collect a text box — one value, read
// off .value, with no special case anywhere.
//
// One listener on the document handles every list on the page. That's not
// just tidiness: the wizard rebuilds its form on each step, and delegation
// keeps working across a re-render where per-button listeners wouldn't.
const priorityScript = `
	function syncPriority(container) {
		const rows = Array.from(container.querySelectorAll("[data-priority-item]"));
		const store = container.querySelector("[data-type='priority']");

		if (store) {
			store.value = JSON.stringify(rows.map(function (row) {
				return row.dataset.priorityItem;
			}));
		}

		rows.forEach(function (row, index) {
			const rank = row.querySelector("[data-priority-rank]");
			if (rank) rank.textContent = index + 1;

			// Nothing above the first row, nothing below the last
			const up = row.querySelector("[data-priority-move='up']");
			const down = row.querySelector("[data-priority-move='down']");

			if (up) up.disabled = index === 0;
			if (down) down.disabled = index === rows.length - 1;
		});
	}

	function syncAllPriorities() {
		for (const container of document.querySelectorAll("[data-priority]")) {
			syncPriority(container);
		}
	}

	document.addEventListener("click", function (event) {
		const button = event.target.closest("[data-priority-move]");
		if (!button) return;

		event.preventDefault();

		const container = button.closest("[data-priority]");
		const row = button.closest("[data-priority-item]");
		const rows = Array.from(container.querySelectorAll("[data-priority-item]"));
		const index = rows.indexOf(row);
		const target = button.dataset.priorityMove === "up" ? index - 1 : index + 1;

		if (target < 0 || target >= rows.length) return;

		if (target < index) {
			container.insertBefore(row, rows[target]);
		} else {
			container.insertBefore(rows[target], row);
		}

		syncPriority(container);
	});

	syncAllPriorities();
`;

function notFound(heading, backHref, backLabel) {
	return page(
		"Not found",
		`<div class="panel">
			<h1>${escapeHtml(heading)}</h1>
			<p><a class="back" href="${backHref}">← ${escapeHtml(backLabel)}</a></p>
		</div>`
	);
}

// Turn declared settings into form fields.
//
// `context` carries anything a field type needs that the schema can't know
// on its own — right now that's the face's instances, so a theme can ask
// which module should feed something like a wallpaper.
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
							`${escapeHtml(instance.label || instance.module)}</option>`
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
								<button class="glass" style="width:auto;padding:12px 20px"
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

				const rows = order
					.map(
						(item, index) => `
					<div class="priority-row" data-priority-item="${escapeHtml(item)}">
						<span class="priority-rank" data-priority-rank>${index + 1}</span>
						<span class="priority-name">${escapeHtml(item)}</span>
						<button type="button" class="priority-move"
							data-priority-move="up" title="Move up">↑</button>
						<button type="button" class="priority-move"
							data-priority-move="down" title="Move down">↓</button>
					</div>`
					)
					.join("");

				input =
					`<div data-priority>` +
					`<input type="hidden" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" data-type="priority" ` +
					`value="${escapeHtml(JSON.stringify(order))}">` +
					rows +
					`</div>`;
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

				input =
					`<select data-key="${escapeHtml(field.key)}" data-scope="${owner}" ` +
					`data-type="select">${options}</select>`;
			} else {
				// text, url, number, password all render as an input
				const type = ["url", "number", "password"].includes(field.type)
					? field.type
					: "text";

				input =
					`<input type="${type}" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" ` +
					`data-type="${escapeHtml(field.type)}" ` +
					`value="${escapeHtml(value === undefined ? "" : value)}">`;
			}

			// A field can depend on another one — no point showing a
			// gradient's second colour when the background isn't a gradient
			const condition = field.showWhen
				? ` data-when-key="${escapeHtml(field.showWhen.key)}" ` +
				  `data-when-is="${escapeHtml(
						[].concat(field.showWhen.equals).join("|")
				  )}"`
				: "";

			return `
				<div class="field"${condition}>
					<label>${escapeHtml(field.label || field.key)}</label>
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
		<div class="panel">
			<h1>${escapeHtml(options.heading)}</h1>
			<p class="lede">${escapeHtml(options.lede)}</p>
		</div>
		<div class="panel">
			<div class="field">
				<label for="username">Username</label>
				<input type="text" id="username" autocomplete="username">
			</div>
			<div class="field">
				<label for="password">Password</label>
				<input type="password" id="password"
					autocomplete="${options.isSetup ? "new-password" : "current-password"}">
			</div>
			<button class="glass" id="submit">${escapeHtml(options.button)}</button>
			<p class="status" id="status"></p>
		</div>`;

	const script = `
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

				location.href = "/";
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

function startAdminFace() {
	const app = express();
	app.use(express.json());

	// Serves the chosen UI font. Mounted before the auth gate below:
	// the sign-in screen itself renders in the chosen font, and it is
	// by definition reached while signed out.
	fontService.attachFontRoute(app);

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
		res.json(await searchCities(req.query.q || ""));
	});

	// Settings — the sections of OmniCore you can change.
	// OmniCore's own settings will join Faces here as they appear.
	app.get("/", (req, res) => {
		const count = faceStore.readFaces().length;

		const settings = readSettings();

		const body = `
			<div class="panel">
				<h1>Settings</h1>
			</div>
			<div class="panel">
				<a class="row" href="/location">
					<strong>Location service</strong>
					<span>${escapeHtml(describeLocationSetting(settings))}</span>
				</a>
				<a class="row" href="/faces">
					<strong>Faces</strong>
					<span>${count ? count + (count === 1 ? " face" : " faces") : "No faces yet"}</span>
				</a>
				<a class="row" href="/appearance">
					<strong>Appearance</strong>
					<span>${escapeHtml(describeAppearance(settings))}</span>
				</a>
				<a class="row" href="/marketplace">
					<strong>Marketplace</strong>
					<span>Add modules and themes</span>
				</a>
			</div>
			<div class="panel footer">
				<a href="/logout">Sign out</a>
			</div>`;

		res.send(page("Settings", body));
	});

	// OmniCore's own settings — things that apply to the whole install
	// rather than to one face.
	// Appearance — how OmniCore's own pages look. Applies to the admin
	// faces, the welcome face, and input faces. NOT to dashboard faces,
	// which belong entirely to whichever theme they run.
	app.get("/appearance", (req, res) => {
		const settings = readSettings();
		const installed = fontService.installedFont();

		const body = `
			<div class="panel">
				<a class="back" href="/">&#8592; Settings</a>
				<h1 style="margin-top:12px">Appearance</h1>
				<p class="lede">
					How OmniCore's own screens look. Dashboard faces are
					unaffected, since their appearance belongs to whichever
					theme they run.
				</p>
			</div>

			<div class="panel">
				<div class="field">
					<strong>Mode</strong>
					<label class="option">
						<input type="radio" name="mode" value="dark"
							${settings.uiMode !== "light" ? "checked" : ""}>
						Dark
					</label>
					<label class="option">
						<input type="radio" name="mode" value="light"
							${settings.uiMode === "light" ? "checked" : ""}>
						Light
					</label>
				</div>

				<div class="field">
					<strong>Back button corner</strong>
					<label class="option">
						<input type="radio" name="corner" value="bottom-right"
							${settings.backButtonCorner !== "top-left" ? "checked" : ""}>
						Bottom right
					</label>
					<label class="option">
						<input type="radio" name="corner" value="top-left"
							${settings.backButtonCorner === "top-left" ? "checked" : ""}>
						Top left
					</label>
					<span class="hint">
						Bottom left is reserved for the welcome face's
						countdown, so the two can never overlap.
					</span>
				</div>

				<div class="field">
					<strong>Text size</strong>
					<label class="option">
						<input type="range" id="size" min="12" max="24" step="1"
							value="${Number(settings.uiFontSize) || 16}">
						<span id="size-label">${Number(settings.uiFontSize) || 16}px</span>
					</label>
				</div>
			</div>

			<div class="panel">
				<div class="field">
					<strong>Font</strong>
					<span class="hint">
						Downloaded once and served by OmniCore itself, so it
						keeps working with no internet.
					</span>
					<p id="current">
						${
							installed
								? `Using <strong>${escapeHtml(installed.family)}</strong>`
								: "Using the system font"
						}
					</p>
					<input class="market-search" id="font-q"
						placeholder="Search Google Fonts...">
					<div class="list" id="font-results"></div>
					${
						installed
							? `<button class="glass" id="clear-font">
									Back to the system font
								</button>`
							: ""
					}
				</div>
			</div>

			<p class="status" id="status"></p>`;

		const script = `
			var status = document.getElementById("status");

			function say(text) { status.textContent = text; }

			// Every change saves immediately and reloads, because the
			// page you are looking at IS the thing being changed --
			// showing the new setting is the confirmation.
			async function save(patch, reload) {
				const res = await fetch("/appearance", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patch)
				});

				if (!res.ok) {
					say("Could not save that.");
					return;
				}

				if (reload !== false) { location.reload(); }
			}

			document.querySelectorAll('input[name="mode"]').forEach(function (el) {
				el.addEventListener("change", function () {
					save({ uiMode: el.value });
				});
			});

			document.querySelectorAll('input[name="corner"]').forEach(function (el) {
				el.addEventListener("change", function () {
					save({ backButtonCorner: el.value });
				});
			});

			var size = document.getElementById("size");
			var sizeLabel = document.getElementById("size-label");

			// Label tracks the slider live, but only save when the drag
			// ends -- otherwise every pixel of movement is a write.
			size.addEventListener("input", function () {
				sizeLabel.textContent = size.value + "px";
			});
			size.addEventListener("change", function () {
				save({ uiFontSize: Number(size.value) });
			});

			var results = document.getElementById("font-results");
			var query = document.getElementById("font-q");
			var searchTimer = null;

			function renderFonts(fonts) {
				if (!fonts.length) {
					results.innerHTML = '<p class="hint">No matches.</p>';
					return;
				}

				results.innerHTML = fonts.map(function (font) {
					return '<div class="card" onclick="pickFont(' +
						JSON.stringify(font.family).replace(/"/g, "&quot;") +
						')"><strong>' + font.family + '</strong>' +
						'<span class="hint"> ' + font.category + '</span></div>';
				}).join("");
			}

			// Debounced: a search per keystroke would hammer the
			// catalogue for results nobody has finished asking for yet.
			query.addEventListener("input", function () {
				clearTimeout(searchTimer);
				searchTimer = setTimeout(async function () {
					if (!query.value.trim()) { results.innerHTML = ""; return; }

					say("Searching...");
					try {
						const res = await fetch("/fonts/search?q=" +
							encodeURIComponent(query.value));
						const data = await res.json();

						if (!res.ok) {
							say(data.error || "Could not reach Google Fonts.");
							results.innerHTML = "";
							return;
						}

						say("");
						renderFonts(data);
					} catch (error) {
						say("Could not reach Google Fonts.");
					}
				}, 300);
			});

			window.pickFont = async function (family) {
				say("Downloading " + family + "...");

				const res = await fetch("/fonts", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ family: family })
				});

				const data = await res.json();

				if (!res.ok) {
					say(data.error || "Could not install that font.");
					return;
				}

				location.reload();
			};

			var clear = document.getElementById("clear-font");
			if (clear) {
				clear.addEventListener("click", async function () {
					await fetch("/fonts", { method: "DELETE" });
					location.reload();
				});
			}
		`;

		res.send(page("Appearance", body, script, "", "/"));
	});

	// Saves one or more appearance settings. Deliberately a patch rather
	// than a whole-object write: the page sends only what changed, so two
	// settings changed in quick succession cannot clobber each other.
	app.post("/appearance", (req, res) => {
		const body = req.body || {};
		const patch = {};

		if (body.uiMode === "dark" || body.uiMode === "light") {
			patch.uiMode = body.uiMode;
		}

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

	app.get("/location", async (req, res) => {
		const settings = readSettings();

		// Show what OmniCore currently believes, so it's obvious whether
		// automatic detection actually worked
		const current = await getLocation();

		const currentText = !settings.locationEnabled
			? "Location services are off."
			: current
			? `Currently ${current.label || "unnamed"} — ` +
			  `${current.latitude.toFixed(3)}, ${current.longitude.toFixed(3)}` +
			  ` (${current.source === "auto" ? "detected" : "set by hand"})`
			: "No location available. Detection may have failed.";

		const manual = settings.locationMode === "manual";

		const body = `
			<div class="panel">
				<a class="back" href="/">← Settings</a>
				<h1 style="margin-top:12px">Location service</h1>
			</div>
			<div class="panel">
				<h2 style="margin-bottom:14px">Location services</h2>

				<label class="option">
					<input type="checkbox" id="enabled"
						${settings.locationEnabled ? "checked" : ""}>
					<span>Let OmniCore know where it is</span>
				</label>

				<div class="help" style="margin-bottom:18px">
					Modules like weather and prayer times ask OmniCore for a
					location rather than working it out themselves. Turn this
					off and OmniCore never looks one up and never hands one
					out — those modules will have nothing to go on unless you
					give each of them coordinates directly.
				</div>

				<div id="detail" style="${settings.locationEnabled ? "" : "display:none"}">
					<label class="option">
						<input type="radio" name="mode" value="auto"
							${manual ? "" : "checked"}>
						<span>Work it out automatically</span>
					</label>
					<label class="option">
						<input type="radio" name="mode" value="manual"
							${manual ? "checked" : ""}>
						<span>Set it myself</span>
					</label>

					<div class="help" style="margin:10px 0 18px 0">
						Automatic uses the server's public IP address, which is
						usually close enough — but not if you're behind a VPN,
						in which case set it by hand.
					</div>

					<div id="coords" style="${manual ? "" : "display:none"}">
						<div class="field">
							<label for="city">Search for a city</label>
							<div class="search-row">
								<input type="text" id="city" placeholder="Regina">
								<button class="glass" style="width:auto;padding:12px 20px"
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
						<div class="field">
							<label for="latitude">Latitude</label>
							<input type="number" step="any" id="latitude"
								value="${escapeHtml(
									settings.latitude === null ? "" : settings.latitude
								)}">
						</div>
						<div class="field">
							<label for="longitude">Longitude</label>
							<input type="number" step="any" id="longitude"
								value="${escapeHtml(
									settings.longitude === null ? "" : settings.longitude
								)}">
						</div>
					</div>
				</div>

				<p class="lede" style="margin-bottom:18px">${escapeHtml(currentText)}</p>

				<button class="glass" id="save">Save</button>
				<p class="status" id="status"></p>
			</div>`;

		const script = `
			const enabled = document.getElementById("enabled");
			const detail = document.getElementById("detail");
			const coords = document.getElementById("coords");

			enabled.addEventListener("change", function () {
				detail.style.display = this.checked ? "" : "none";
			});

			for (const radio of document.querySelectorAll('input[name="mode"]')) {
				radio.addEventListener("change", function () {
					coords.style.display = this.value === "manual" ? "" : "none";
				});
			}

			// City lookup fills in the coordinates and the place name, so
			// nobody has to go and find them by hand
			let matches = [];

			async function runSearch() {
				const results = document.getElementById("results");
				const query = document.getElementById("city").value;

				results.innerHTML = '<div class="empty" style="margin-top:8px">Searching…</div>';

				try {
					matches = await (
						await fetch("/geocode?q=" + encodeURIComponent(query))
					).json();

					if (!matches.length) {
						results.innerHTML =
							'<div class="empty" style="margin-top:8px">Nothing found.</div>';
						return;
					}

					results.innerHTML = matches.map(function (place, index) {
						const safe = place.label
							.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
						return '<button class="result" data-pick="' + index + '">' +
							safe + "</button>";
					}).join("");

					for (const button of results.querySelectorAll("[data-pick]")) {
						button.addEventListener("click", function () {
							const place = matches[Number(this.dataset.pick)];

							document.getElementById("latitude").value = place.latitude;
							document.getElementById("longitude").value = place.longitude;
							document.getElementById("label").value = place.label;
							results.innerHTML = "";
						});
					}
				} catch (error) {
					results.innerHTML =
						'<div class="empty" style="margin-top:8px">Search failed.</div>';
				}
			}

			document.getElementById("search").addEventListener("click", runSearch);

			document.getElementById("city").addEventListener("keydown", function (event) {
				if (event.key === "Enter") {
					event.preventDefault();
					runSearch();
				}
			});

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");
				const mode = document.querySelector('input[name="mode"]:checked');

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/location", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							locationEnabled: enabled.checked,
							locationMode: mode ? mode.value : "auto",
							locationLabel: document.getElementById("label").value,
							latitude: document.getElementById("latitude").value,
							longitude: document.getElementById("longitude").value
						})
					});

					if (!response.ok) throw new Error();

					// Reload so the "currently" line reflects what was saved
					location.reload();
				} catch (error) {
					status.textContent = "Couldn't save.";
					status.className = "status bad";
					button.disabled = false;
				}
			});
		`;

		res.send(page("Location service", body, script, "", "/"));
	});

	app.post("/location", (req, res) => {
		const latitude = Number(req.body.latitude);
		const longitude = Number(req.body.longitude);

		res.json(
			writeSettings({
				locationEnabled: Boolean(req.body.locationEnabled),
				locationMode:
					req.body.locationMode === "manual" ? "manual" : "auto",
				locationLabel: req.body.locationLabel || "",
				// Blank or unparseable coordinates are stored as "none"
				// rather than NaN
				latitude: Number.isNaN(latitude) || req.body.latitude === "" ? null : latitude,
				longitude:
					Number.isNaN(longitude) || req.body.longitude === "" ? null : longitude
			})
		);
	});

	// Every dashboard face
	// ---- marketplace -------------------------------------------------
	//
	// Browsing and installing what has been reviewed into the registry.
	// Nothing here executes anything it downloads; it only places files.
	// Installed code starts running the same way built-in code does, when
	// module-loader or theme-loader require() it.

	// One card per entry, all in a single grid the search box filters
	// client-side. `data-search` holds the text a match is judged against —
	// built once here rather than recomputed by the filter on every
	// keystroke. The whole card links to its detail page except the
	// Install button, which needs its own click — see .card-link in the
	// stylesheet for how that's kept from conflicting.
	function marketplaceCards(entries, kind) {
		if (!entries.length) {
			return '<p class="market-empty">Nothing listed yet.</p>';
		}

		const cards = entries
			.map((entry) => {
				const id = escapeHtml(entry.id);
				const name = entry.name || entry.id;
				const author = entry.author || "";
				const description = entry.description || "";
				const detailUrl = `/marketplace/${kind}s/${encodeURIComponent(entry.id)}`;

				const searchText = escapeHtml(
					[name, description, author].join(" ").toLowerCase()
				);

				const action = entry.installed
					? '<span class="installed">Installed</span>'
					: `<button type="button" class="btn" data-install="${id}" ` +
					  `data-kind="${kind}">Install</button>`;

				return `
					<div class="market-card" data-search="${searchText}">
						<a class="card-link" href="${escapeHtml(detailUrl)}" aria-label="${escapeHtml(name)}"></a>
						<h3>${escapeHtml(name)}</h3>
						${description ? `<div class="desc">${escapeHtml(description)}</div>` : ""}
						${author ? `<div class="author">${escapeHtml(author)}</div>` : ""}
						${action}
					</div>`;
			})
			.join("");

		return `<div class="market-grid">${cards}</div>`;
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
				The built-in registry above is unaffected.
			</p>`
			: "";

		const body = `
			<div class="market-wide market-header">
				<div>
					<h1>Marketplace</h1>
					<p class="help">
						Modules and themes reviewed into the registry. Installing
						downloads the exact reviewed version.
					</p>
					${failedSources}
				</div>
				<a class="btn" href="/marketplace/sources">Sources</a>
			</div>

			${failure ? `
			<div class="panel">
				<div class="row">
					<div>
						<strong>Can't reach the registry</strong>
						<div class="help">${escapeHtml(failure)}</div>
					</div>
				</div>
			</div>` : `
			<div class="market-wide">
				<input type="text" class="market-search" data-market-search
					placeholder="Search by name, author, or description">

				<div class="market-tabs">
					<button type="button" class="tab-btn active" data-tab-btn="module">Modules</button>
					<button type="button" class="tab-btn" data-tab-btn="theme">Themes</button>
				</div>

				<div data-tab-panel="module">
					${marketplaceCards(available.modules, "module")}
				</div>
				<div data-tab-panel="theme" hidden>
					${marketplaceCards(available.themes, "theme")}
				</div>
			</div>`}

			<div class="panel footer">
				<a href="/">Back</a>
			</div>`;

		const script = `
			const note = document.createElement("div");

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
					// Put the reason on the button itself — there is no
					// other obvious place on this page for it to go
					button.disabled = false;
					button.textContent = error.message.slice(0, 60);
					setTimeout(function () { button.textContent = was; }, 4000);
					return false;
				}
			}

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

			// Modules / Themes. Switching resets the search — starting
			// fresh in the new tab is less surprising than carrying a
			// filter across to content it was never typed against.
			const tabButtons = Array.from(document.querySelectorAll("[data-tab-btn]"));
			const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

			for (const button of tabButtons) {
				button.addEventListener("click", function () {
					for (const b of tabButtons) {
						b.classList.toggle("active", b === button);
					}

					for (const panel of tabPanels) {
						panel.hidden = panel.dataset.tabPanel !== button.dataset.tabBtn;
					}

					if (search) {
						search.value = "";
						for (const card of document.querySelectorAll(".market-card")) {
							card.hidden = false;
						}
					}
				});
			}

			// Filters client-side rather than round-tripping to the server —
			// a personal registry is small enough that there's nothing to
			// gain from a network request on every keystroke. Scoped to
			// whichever tab is currently showing, not every card on the
			// page — searching Modules shouldn't surface a Theme.
			var search = document.querySelector("[data-market-search]");

			if (search) {
				search.addEventListener("input", function () {
					const query = search.value.trim().toLowerCase();
					const activePanel = document.querySelector("[data-tab-panel]:not([hidden])");
					const cards = activePanel
						? activePanel.querySelectorAll(".market-card")
						: [];

					for (const card of cards) {
						const matches = card.dataset.search.indexOf(query) !== -1;
						card.hidden = query !== "" && !matches;
					}
				});
			}
		`;

		res.send(page("Marketplace", body, script, "", "/"));
	});

	app.get("/marketplace/sources", (req, res) => {
		const settings = readSettings();
		const sources = Array.isArray(settings.registrySources)
			? settings.registrySources
			: [];

		const extraRows = sources
			.map(
				(url) => `
				<div class="row">
					<div><strong>${escapeHtml(url)}</strong></div>
					<button type="button" class="btn" data-remove-source="${escapeHtml(url)}">Remove</button>
				</div>`
			)
			.join("");

		const body = `
			<div class="market-wide">
				<h1>Registry sources</h1>
				<p class="help">Where OmniCore looks for modules and themes to install.</p>
			</div>

			<div class="market-wide">
				<div class="row">
					<div>
						<strong>Omnia-Registry</strong>
						<div class="help">Built-in. Reviewed, and always included.</div>
					</div>
					<span class="installed">Built-in</span>
				</div>
				${extraRows}
			</div>

			<div class="panel">
				<label for="newSource">Add a source</label>
				<input type="url" id="newSource" data-new-source placeholder="https://example.com/registry.json">
				<button type="button" class="btn" data-reveal-warning style="margin-top: 10px;">Add source</button>
			</div>

			<div class="market-wide market-warning" data-warning hidden>
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
				<div style="display: flex; gap: 10px; margin-top: 18px;">
					<button type="button" class="btn-glossy btn-glossy-green" data-warning-cancel>Go back</button>
					<button type="button" class="btn-glossy btn-glossy-neutral" data-warning-confirm>I understand</button>
				</div>
			</div>

			<div class="panel footer">
				<a href="/marketplace">Back</a>
			</div>`;

		const script = `
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

	// A module's or theme's own page — everything the browse cards don't
	// have room for. Shared by both kinds since the layout only differs
	// by a couple of conditional pieces (provides, only meaningful for a
	// module; a theme has nothing analogous to show there).
	async function renderDetailPage(kind, id, res) {
		let available = null;

		try {
			available = await marketplace.listAvailable();
		} catch (error) {
			res.status(502).send(page("Marketplace", `
				<div class="panel">
					<div class="row">
						<div>
							<strong>Can't reach the registry</strong>
							<div class="help">${escapeHtml(error.message)}</div>
						</div>
					</div>
				</div>
				<div class="panel footer"><a href="/marketplace">Back</a></div>
			`));
			return;
		}

		const list = kind === "theme" ? available.themes : available.modules;
		const entry = list.find((item) => item.id === id);

		if (!entry) {
			res.status(404).send(page("Not found", `
				<div class="panel">
					<h1>Not found</h1>
					<p class="help">Nothing with that id is listed.</p>
				</div>
				<div class="panel footer"><a href="/marketplace">Back</a></div>
			`));
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

		const emitsSection = kind === "module" && emits.length
			? `
				<h2>Emits</h2>
				<div>${emits.map((e) => `<span class="provides-tag">${escapeHtml(e)}</span>`).join("")}</div>`
			: "";

		// Every screenshot's actual URL is remembered server-side and handed
		// a short opaque key — the browser never sees or requests the real
		// URL directly. Same reason the dashboard's own image blocks work
		// this way: a display (here, the admin's browser) should only ever
		// talk to OmniCore's own server, never a third party the author of
		// an unreviewed module.json chose.
		const screenshotsSection = extras.screenshots.length
			? `
				<h2>Screenshots</h2>
				<div class="market-grid">
					${extras.screenshots
						.map((shot, index) => {
							const key = `${kind}:${entry.id}:${index}`;
							imageProxy.remember(key, shot.image);

							const themeLink = shot.theme
								? `<div class="help">Shown in <a href="/marketplace/themes/${escapeHtml(shot.theme)}">${escapeHtml(shot.theme)}</a></div>`
								: "";

							return `
								<div class="market-card">
									<img src="/marketplace/screenshot/${encodeURIComponent(key)}"
										alt="${escapeHtml(shot.description || name)}"
										style="width: 100%; border-radius: 8px; display: block;">
									${shot.description ? `<div class="desc">${escapeHtml(shot.description)}</div>` : ""}
									${themeLink}
								</div>`;
						})
						.join("")}
				</div>`
			: "";

		const action = entry.installed
			? '<span class="installed">Installed</span>'
			: `<button type="button" class="btn" data-install="${escapeHtml(entry.id)}" ` +
			  `data-kind="${kind}">Install</button>`;

		const body = `
			<div class="market-wide">
				<a href="/marketplace" class="help">&larr; Marketplace</a>
				<h1 style="margin-top: 10px;">${escapeHtml(name)}</h1>
				<p class="help">
					${kind === "theme" ? "Theme" : "Module"}
					${author ? ` by <a href="/marketplace/authors/${encodeURIComponent(author)}">${escapeHtml(author)}</a>` : ""}
				</p>

				${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
				${extras.completeDescription
					? extras.completeDescription
						.split(/\n{2,}/)
						.map((para) => para.trim())
						.filter(Boolean)
						.map((para) => `<p>${escapeHtml(para)}</p>`)
						.join("")
					: ""}

				${emitsSection}
				${screenshotsSection}

				${entry.repo ? `
				<h2>Source</h2>
				<p class="help">
					<a href="${escapeHtml(entry.repo)}">${escapeHtml(entry.repo)}</a>
					${entry.ref ? ` — pinned at <code>${escapeHtml(String(entry.ref).slice(0, 10))}</code>` : ""}
				</p>` : ""}

				<div style="margin-top: 20px;">${action}</div>
			</div>

			<div class="panel footer">
				<a href="/marketplace">Back</a>
			</div>`;

		const script = `
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

		res.send(page(name, body, script, "", "/marketplace"));
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
			res.status(502).send(page("Marketplace", `
				<div class="panel">
					<div class="row">
						<div>
							<strong>Can't reach the registry</strong>
							<div class="help">${escapeHtml(error.message)}</div>
						</div>
					</div>
				</div>
				<div class="panel footer"><a href="/marketplace">Back</a></div>
			`));
			return;
		}

		const modules = available.modules.filter((e) => e.author === authorName);
		const themes = available.themes.filter((e) => e.author === authorName);

		const body = `
			<div class="market-wide">
				<a href="/marketplace" class="help">&larr; Marketplace</a>
				<h1 style="margin-top: 10px;">${escapeHtml(authorName)}</h1>
				<p class="help">${modules.length + themes.length} listed</p>

				<h2 style="margin-top: 24px;">Modules</h2>
				${marketplaceCards(modules, "module")}

				<h2 style="margin-top: 32px;">Themes</h2>
				${marketplaceCards(themes, "theme")}
			</div>

			<div class="panel footer">
				<a href="/marketplace">Back</a>
			</div>`;

		res.send(page(authorName, body, "", "", "/marketplace"));
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

	app.get("/faces", (req, res) => {
		const faces = faceStore
			.readFaces()
			.map((face) => {
				const count = face.instances.length;

				return `
				<a class="row" href="/faces/${face.id}">
					<strong>${escapeHtml(face.name)}</strong>
					<span>port ${face.id} · ${count}${
						count === 1 ? " module" : " modules"
					}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/">← Settings</a>
				<h1 style="margin-top:12px">Faces</h1>
			</div>
			<div class="panel">
				${faces || '<div class="empty">No faces yet.</div>'}
			</div>
			<div class="panel">
				<button class="glass" onclick="goToWizard()">
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
				location.href = faceUrl(${WIZARD_PORT}) + "/faces/new";
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

		const body = `
			<div class="panel">
				<a class="back" href="/faces">← Faces</a>
				<h1 style="margin-top:12px">${escapeHtml(face.name)}</h1>
				<p class="lede">Running on port ${face.id}</p>
			</div>
			<div class="panel">
				<a class="row" href="/faces/${face.id}/modules">
					<strong>Modules</strong>
					<span>${count ? count + (count === 1 ? " module" : " modules") : "None added yet"}</span>
				</a>
				<a class="row" href="/faces/${face.id}/theme">
					<strong>Theme</strong>
					<span>${escapeHtml(themeName)}</span>
				</a>
			</div>
			<div class="panel">
				<div class="field">
					<label for="name">Name</label>
					<input type="text" id="name" value="${escapeHtml(face.name)}">
					<div class="help">
						How you recognise this face here. Blank falls back to
						Face ${face.id}.
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

				<button class="glass" id="save">Save face</button>
				<p class="status" id="status"></p>
			</div>`;

		const script = `
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
		`;

		res.send(page(face.name, body, script, "", "/faces"));
	});

	app.post("/faces/:id", (req, res) => {
		const id = Number(req.params.id);

		if (!faceStore.updateFace(id, {
			name: req.body.name,
			title: req.body.title,
			theme: req.body.theme
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
	app.get("/faces/:id/theme", (req, res) => {
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
			<div class="panel">
				<a class="back" href="/faces/${face.id}">← ${escapeHtml(face.name)}</a>
				<h1 style="margin-top:12px">${escapeHtml(manifest.name)}</h1>
				<p class="lede">${escapeHtml(
					manifest.description || "The theme this face is using"
				)}</p>
			</div>
			<div class="panel">
				<a class="row" href="/faces/${face.id}/theme/change">
					<strong>Change theme</strong>
					<span>Use a different theme on this face</span>
				</a>
			</div>
			<div class="panel">
				${
					schema.length
						? renderFields(schema, config, { instances: face.instances }) +
						  '<button class="glass" id="save">Save</button>' +
						  '<p class="status" id="status"></p>'
						: '<div class="empty">This theme has nothing to configure.</div>'
				}
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

		res.send(page(manifest.name, body, script));
	});

	app.post("/faces/:id/theme", (req, res) => {
		const id = Number(req.params.id);
		const face = faceStore.findFace(id);

		if (!face) {
			res.status(404).json({ error: "No such face" });
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
			<div class="panel">
				<a class="back" href="/faces/${face.id}/theme">← Theme</a>
				<h1 style="margin-top:12px">Change theme</h1>
				<p class="lede">
					Settings you've already made are kept per theme, so
					switching back later restores them.
				</p>
			</div>
			<div class="panel">
				${themes || '<div class="empty">No themes installed.</div>'}
			</div>
			<p class="status" id="status"></p>`;

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

						location.href = "/faces/${face.id}/theme";
					} catch (error) {
						const status = document.getElementById("status");
						status.textContent = "Couldn't change the theme.";
						status.className = "status bad";
					}
				});
			}
		`;

		res.send(page("Change theme", body, script, "", `/faces/${req.params.id}`));
	});

	// The module instances on a face. The same module may appear more than
	// once, each with its own settings.
	app.get("/faces/:id/modules", (req, res) => {
		const face = faceStore.findFace(Number(req.params.id));

		if (!face) {
			res.status(404).send(notFound("No such face", "/faces", "Faces"));
			return;
		}

		const instances = face.instances
			.map((instance) => {
				const manifest = readManifest(instance.module);

				return `
				<a class="row" href="/faces/${face.id}/modules/${encodeURIComponent(instance.id)}">
					<strong>${escapeHtml(instance.label || manifest.name)}</strong>
					<span>${escapeHtml(manifest.name)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/faces/${face.id}">← ${escapeHtml(face.name)}</a>
				<h1 style="margin-top:12px">Modules</h1>
			</div>
			<div class="panel">
				${instances || '<div class="empty">No modules on this face yet.</div>'}
			</div>
			<div class="panel">
				<a class="glass" href="/faces/${face.id}/modules/add"
					style="display:block;text-align:center;box-sizing:border-box">
					Add a module
				</a>
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
			<div class="panel">
				<a class="back" href="/faces/${face.id}/modules">← Modules</a>
				<h1 style="margin-top:12px">Add a module</h1>
				<p class="lede">You can add the same module more than once.</p>
			</div>
			<div class="panel">
				${modules || '<div class="empty">No modules installed.</div>'}
			</div>
			<p class="status" id="status"></p>`;

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
					location.href = "/faces/${face.id}/modules/" +
						encodeURIComponent(instance.id);
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
			manifest.name,
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

		// Only runs if the module actually declared an input.json —
		// startInputFace itself is a no-op otherwise (see
		// input-face-loader.js).
		await startInputFace(id, instance);

		refresh(id);
		res.json(instance);
	});

	// One instance's settings: its label, plus whatever its module declared
	app.get("/faces/:id/modules/:instanceId", (req, res) => {
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

		// The face's theme may want things configured per instance — how big
		// this tile is, usually. Those fields come from the THEME, not the
		// module, and are stored separately under the theme's own key.
		const themeSchema = themeLoader.readInstanceSchema(face.theme);
		const themeConfig = themeLoader.applyInstanceDefaults(
			face.theme,
			(instance.themeConfigs || {})[face.theme]
		);
		const themeName = themeLoader.readManifest(face.theme).name;

		const body = `
			<div class="panel">
				<a class="back" href="/faces/${face.id}/modules">← Modules</a>
				<h1 style="margin-top:12px">${escapeHtml(instance.label || manifest.name)}</h1>
				<p class="lede">${escapeHtml(manifest.description || manifest.name)}</p>
			</div>
			<div class="panel">
				<div class="field">
					<label for="label">Label</label>
					<input type="text" id="label" value="${escapeHtml(instance.label)}">
					<div class="help">
						Shown as the tile's title. Useful when the same module
						appears more than once.
					</div>
				</div>

				${
					schema.length
						? renderFields(schema, config, null, "module")
						: '<div class="empty">This module has nothing else to configure.</div>'
				}
			</div>
			${
				themeSchema.length
					? `<div class="panel">
							<h2>In ${escapeHtml(themeName)}</h2>
							${renderFields(
								themeSchema,
								themeConfig,
								{ instances: face.instances },
								"theme"
							)}
						</div>`
					: ""
			}
			<div class="panel">
				<button class="glass" id="save">Save</button>
				<p class="status" id="status"></p>
			</div>
			<div class="panel footer">
				<span class="danger" id="remove">Remove from this face</span>
			</div>`;

		const script = `
			${conditionalScript}
			${priorityScript}
			${locationScript}

			const base = "/faces/${face.id}/modules/${encodeURIComponent(instance.id)}";

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

					// The face reads this per request, so it's already live
					status.textContent = "Saved. Already in effect.";
					status.className = "status good";
				} catch (error) {
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}

				button.disabled = false;
			});

			document.getElementById("remove").addEventListener("click", async function () {
				if (!confirm("Remove this module from the face?")) return;

				await fetch(base, { method: "DELETE" });
				location.href = "/faces/${face.id}/modules";
			});
		`;

		res.send(page(instance.label || manifest.name, body, script, "", `/faces/${req.params.id}/modules`));
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

		refresh(id);
		res.json(updated);
	});

	app.delete("/faces/:id/modules/:instanceId", (req, res) => {
		const id = Number(req.params.id);
		const removed = faceStore.removeInstance(id, req.params.instanceId);

		if (!removed) {
			res.status(404).json({ error: "No such module on this face" });
			return;
		}

		// A deleted instance's button shouldn't keep answering taps for a
		// module that's no longer even on the face.
		stopInputFace(removed.inputPort);

		refresh(id);
		res.json({ ok: true });
	});

	app.listen(ADMIN_PORT, () => {
		console.log(`Admin face listening on port ${ADMIN_PORT}`);
	});
}

module.exports = startAdminFace;