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
const { readSettings, writeSettings } = require("./settings-store");
const { getLocation, searchCities } = require("./location-service");
const faceStore = require("./face-store");
const { refresh } = require("./face-loader");
const auth = require("./admin-auth");

const ADMIN_PORT = 3000;

const styles = `
	body {
		background: #000;
		color: #fff;
		font-family: system-ui, sans-serif;
		min-height: 100vh;
		margin: 0;
		padding: 48px 24px;
		box-sizing: border-box;
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

	a { color: #fff; text-decoration: none; }

	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 20px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		margin-bottom: 10px;
	}

	.row span { opacity: 0.55; font-size: 13px; }

	/* Clickable rows get the same glass treatment as buttons, so anything
	   you can act on looks the same everywhere in OmniCore's own UI */
	a.row {
		position: relative;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(12px);
	}

	a.row:hover { background: rgba(255, 255, 255, 0.12); }

	a.row::before {
		content: "";
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, rgba(255, 255, 255, 0.14), transparent
		);
		pointer-events: none;
	}

	.field { margin-bottom: 20px; }

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		margin-bottom: 8px;
		cursor: pointer;
		font-size: 15px;
	}

	.option:hover { background: rgba(255, 255, 255, 0.05); }
	.option input { width: 17px; height: 17px; }

	/* A reorderable priority list. Deliberately looks like .option rows,
	   since it's the same kind of choice made a different way. */
	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid rgba(255, 255, 255, 0.12);
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
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
	}

	.priority-move:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
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
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		color: #fff;
		font-size: 16px;
		padding: 12px 16px;
	}

	input[type="checkbox"] { width: 18px; height: 18px; }

	input[type="color"] {
		width: 100%;
		height: 46px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		padding: 4px;
		cursor: pointer;
	}

	/* Dropdown options fall back to the browser's own popup colours unless
	   we say otherwise, which means white on white in a dark interface */
	option {
		background: #1a1a1a;
		color: #fff;
	}


	.back { font-size: 14px; opacity: 0.6; }
	.empty { opacity: 0.5; font-size: 14px; }

	.search-row { display: flex; gap: 8px; }
	.search-row input { flex: 1; }

	.result {
		display: block;
		width: 100%;
		text-align: left;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		color: #fff;
		font-size: 14px;
		font-family: inherit;
		padding: 10px 14px;
		margin-top: 8px;
		cursor: pointer;
	}

	.result:hover { background: rgba(255, 255, 255, 0.1); }
	.status { font-size: 14px; min-height: 20px; margin-top: 14px; }
	.status.good { color: #6bd968; }
	.status.bad { color: #ff8a8a; }

	.footer { opacity: 0.4; font-size: 13px; }
	.danger { color: #ff8a8a; font-size: 14px; cursor: pointer; }

	/* Glass-style button with a soft light reflection */
	.glass {
		position: relative;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		backdrop-filter: blur(12px);
		color: #fff;
		font-size: 16px;
		padding: 14px 28px;
		cursor: pointer;
		width: 100%;
	}

	.glass:hover { background: rgba(255, 255, 255, 0.12); }
	.glass:disabled { opacity: 0.35; cursor: not-allowed; }

	.glass::before {
		content: "";
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, rgba(255, 255, 255, 0.14), transparent
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

function page(title, body, script, bodyClass) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${styles}</style>
</head>
<body class="${bodyClass || ""}">
	${body}
	<script>${script || ""}</script>
</body>
</html>`;
}

// One line describing how location is set up, for the settings list
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

		res.send(page("Location service", body, script));
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

	function marketplaceRows(entries, kind) {
		if (!entries.length) {
			return '<div class="row"><span>Nothing listed yet</span></div>';
		}

		return entries
			.map((entry) => {
				const id = escapeHtml(entry.id);
				const action = entry.installed
					? '<span>Installed</span>'
					: `<button type="button" data-install="${id}" ` +
					  `data-kind="${kind}">Install</button>`;

				return `
					<div class="row">
						<div>
							<strong>${escapeHtml(entry.name || entry.id)}</strong>
							<div class="help">${escapeHtml(entry.description || "")}</div>
						</div>
						${action}
					</div>`;
			})
			.join("");
	}

	app.get("/marketplace", async (req, res) => {
		const settings = readSettings();
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

		const body = `
			<div class="panel">
				<h1>Marketplace</h1>
				<p class="help">
					Modules and themes reviewed into the registry. Installing
					downloads the exact reviewed version.
				</p>
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
			<div class="panel">
				<h2>Modules</h2>
				${marketplaceRows(available.modules, "module")}
			</div>

			<div class="panel">
				<h2>Themes</h2>
				${marketplaceRows(available.themes, "theme")}
			</div>`}

			<div class="panel">
				<label for="registryUrl">Registry</label>
				<input type="url" id="registryUrl"
					value="${escapeHtml(settings.registryUrl || "")}"
					placeholder="${escapeHtml(marketplace.DEFAULT_REGISTRY_URL)}">
				<div class="help">
					Leave blank to use the project's own registry.
				</div>
				<button type="button" data-save-registry>Save</button>
			</div>

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

			const saveRegistry = document.querySelector("[data-save-registry]");

			if (saveRegistry) {
				saveRegistry.addEventListener("click", async function () {
					const ok = await post(
						"/marketplace/registry",
						{ registryUrl: document.getElementById("registryUrl").value },
						saveRegistry,
						"Saving...",
						"Saved"
					);

					if (ok) {
						setTimeout(function () { location.reload(); }, 600);
					}
				});
			}
		`;

		res.send(page("Marketplace", body, script));
	});

	app.post("/marketplace/registry", (req, res) => {
		writeSettings({ registryUrl: String((req.body || {}).registryUrl || "").trim() });
		res.json({ ok: true });
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
				${faces || '<div class="empty">No faces yet. Create one on port 4000.</div>'}
			</div>`;

		res.send(page("Faces", body));
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

		res.send(page(face.name, body, script));
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

		res.send(page("Change theme", body, script));
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

		res.send(page("Modules", body));
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

		res.send(page("Add a module", body, script));
	});

	app.post("/faces/:id/modules", (req, res) => {
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

		res.send(page(instance.label || manifest.name, body, script));
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

		if (!faceStore.removeInstance(id, req.params.instanceId)) {
			res.status(404).json({ error: "No such module on this face" });
			return;
		}

		refresh(id);
		res.json({ ok: true });
	});

	app.listen(ADMIN_PORT, () => {
		console.log(`Admin face listening on port ${ADMIN_PORT}`);
	});
}

module.exports = startAdminFace;