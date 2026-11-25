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
const { ICON_LINK, attachIconRoute } = require("./icon");
const { pageStart } = require("./page-motion");
const backdropStore = require("./backdrop");
const express = require("express");
const { listModules, listAvailable } = require("./module-loader");
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
const { PLACE_SEARCH_SCRIPT } = require("./place-search-ui");
const { ownLabel, suggestedLabel, labelsFor } = require("./instance-label");
const faceStore = require("./face-store");
const omnicoreVersion = require("./version");
const { refresh, stopFace } = require("./face-loader");
const notifications = require("./notifications");
const { displayCount } = require("./face-events");
const {
	uiStyles,
	styleTag,
	backButton,
	rememberUiMode,
	currentUiMode,
	versionHtml,
	UI_MODE_SCRIPT,
	passwordField,
	infoTip,
	PASSWORD_TOGGLE_SCRIPT,
	modeSwitch,
	MODE_SWITCH_SCRIPT,
	DIALOG_SCRIPT,
	CONTROLS_SCRIPT,
	DEFAULT_DARK,
	DEFAULT_LIGHT,
	paletteVariables,
	overPicturePalette
} = require("./ui-theme");
const { portLinkScript, WIZARD_PORT } = require("./face-links");
const { askAttribute, ASK_FIRST_SCRIPT } = require("./ask-first");
const coreUpdater = require("./core-updater");
const networkHelper = require("./network-helper");
const networkPage = require("./network-page");
const updateStore = require("./update-store");
const upgradeNotes = require("./upgrade-notes");
const semver = require("semver");
const installStore = require("./install-store");
const resourceScheduler = require("./resource-scheduler");
const fontService = require("./font-service");
const { startInputFace, stopInputFace, refreshInputFace } = require("./input-face-loader");
const background = require("./background");
const auth = require("./admin-auth");

const ADMIN_PORT = 3000;

// A name for this particular start of OmniCore. See GET /version.
const BOOT_ID = require("crypto").randomBytes(8).toString("hex");


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
// shared Default UI gets attached: uiStyles(), the Settings pages' own
// elements (body.settings-page) among the rest.
//
// `back` is a URL for the floating button, or nothing at all for a
// screen that is genuinely a root. /logout (the settings home's) gets a
// sign-out icon instead of the arrow: see ui-theme.js's backButton().
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

function page(title, body, script, bodyClass, back) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)}</title>
	${ICON_LINK}
	${styleTag(uiStyles())}
</head>
<body class="settings-page${bodyClass ? " " + bodyClass : ""}">
${pageStart()}
	${body}
	${backButton(back)}
	<script>${UI_MODE_SCRIPT}${PASSWORD_TOGGLE_SCRIPT}${DIALOG_SCRIPT}${CONTROLS_SCRIPT}${script || ""}${ASK_FIRST_SCRIPT}</script>
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
			field.hidden = allowed.indexOf(current) === -1;
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
			if (fields) fields.hidden = this.value !== "manual";
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
				<h1 class="spaced">${escapeHtml(heading)}</h1>
				<a class="row glass" href="${backHref}">
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
					<div class="location-manual" data-loc-fields="${escapeHtml(field.key)}"${manual ? "" : " hidden"}>
						<div class="field">
							<label>Search for a city</label>
							<div class="search-row">
								<input type="text" data-loc-query="${escapeHtml(field.key)}"
									placeholder="Regina">
								<button class="glass medium"
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
					`<input type="checkbox" role="switch" data-key="${escapeHtml(field.key)}" ` +
					`data-scope="${owner}" ` +
					`data-type="boolean" ${value ? "checked" : ""}>`;
			} else if (field.type === "wifi-add") {
				// The Guest Wi-Fi widget's "Add a network around you" (only a
				// built-in widget gets this far with it: module-config.js)
				input = networkPage.addNetworkButtonHtml(field, escapeHtml);
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
				<p class="lede">${escapeHtml(options.lede)}</p>
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
	// A picture (or an animation, or a video), a colour, or neither: the
	// Default, the pages' own colour
	const file = backdropStore.hasPicture(settings);
	const colour = backdropStore.hasColour(settings);
	const backdrop = file || colour;
	// "match", from an earlier v2 build, is Dominant
	// "match", from an earlier v2 build, is Dominant. Dominant and Vibrant
	// are a picture's: over a colour they're None.
	const chosenTint = settings.glassTint === "match" ? "dominant" : settings.glassTint || "none";
	const tint = !file && ["dominant", "vibrant"].includes(chosenTint) ? "none" : chosenTint;
	const uiMode = currentUiMode();

	// The glass as it's drawn now, for this browser's mode (or dark, when
	// it follows the device and the page works the rest out itself)
	const glass = backdropStore.glassFor(settings, uiMode === "light");
	const auto = settings.glassAuto !== false;
	const pinned = Array.isArray(settings.glassPinned) ? settings.glassPinned : [];
	const brightness = Number(settings.pictureBrightness) || 0;
	const fontColour = backdropStore.fontOf(settings);

	// What a slider's value says: Auto's own, or pinned (moved by hand,
	// so Auto leaves it alone), with Auto on
	const byAuto = (name) => backdrop && auto && !pinned.includes(name);
	const pinBadge = (name) =>
		`<button type="button" class="badge badge-button" data-unpin="${name}"` +
		`${backdrop && auto && pinned.includes(name) ? "" : " hidden"} title="Moved by hand, so Auto leaves it alone. Press to let Auto move it again.">Pinned</button>`;

	// Picture brightness in words: Original, or how much darker or brighter
	const brightnessWords = (value) =>
		value === 0 ? "Original" : `${Math.abs(value)}% ${value < 0 ? "darker" : "brighter"}`;

	const kindName = {
		picture: "A picture",
		animated: "An animated picture",
		video: "A video",
		colour: "A colour"
	}[settings.backgroundKind];

	// What's in use, said on the preview itself rather than in a line
	// under it: a small label in its corner
	const preview = file
		? `<img src="/backdrop/${escapeHtml(settings.backgroundStill || settings.backgroundFile)}" alt="">` +
		  `<span class="preview-kind">${escapeHtml(kindName || "A picture")}</span>`
		: colour
		? `<span class="preview-colour" style="--colour:${escapeHtml(settings.backgroundColor)}"></span>` +
		  `<span class="preview-kind">${escapeHtml(settings.backgroundColor)}</span>`
		: `<span class="preview-colour preview-default"></span><span class="preview-kind">Default</span>`;

	// A colour chip for the tint. None, Dominant and Vibrant are words,
	// the rest colours. Dominant and Vibrant only with a picture or a
	// colour behind the pages, showing that colour.
	const chip = (value, label, colour, disabled) =>
		`<button type="button" class="tint-chip${tint === value ? " active" : ""}" data-tint="${escapeHtml(value)}"` +
		`${disabled ? " disabled" : ""} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"` +
		` aria-pressed="${tint === value ? "true" : "false"}">` +
		(colour ? `<span class="tint-swatch" style="--colour:${escapeHtml(colour)}"></span>` : "") +
		(["none", "dominant", "vibrant"].includes(value) ? `<span>${escapeHtml(label)}</span>` : "") +
		"</button>";
	const dominant = backdrop ? settings.backgroundColor || "" : "";
	const vibrant = backdrop ? settings.backgroundVibrant || settings.backgroundColor || "" : "";

	const custom = /^#[0-9a-f]{6}$/i.test(tint) && !backdropStore.TINT_PRESETS.includes(tint.toLowerCase());

	// Where the back button sits: a named switch, Top left or Bottom right
	// (bottom left is the welcome face's timer, top right the light
	// switch), at the bottom of the box, and the button drawn in its
	// corner on the preview. Saved, then the page reloads to move it.
	const topLeft = settings.backButtonCorner === "top-left";

	// The preview is the way to change what's behind the pages: it dims on
	// hover and says "Change background", and opens the dialog below
	const backgroundBox = `
				<div class="segment c2 row1" id="background">
					<div class="box-head">
						<h2>Background</h2>
						${infoTip(
							"A picture (JPEG, PNG, WebP), an animated GIF or WebP, a looping video (MP4, WebM) " +
								"without sound, up to 50 MB, or one colour. A file is kept by OmniCore and never sent " +
								"anywhere. With reduced motion turned on in your device's settings, a still frame is shown.",
							"What can be used as a background"
						)}
					</div>
					<p class="lede">
						Behind OmniCore's own pages. A face keeps its theme's own
						background.
					</p>

					<button type="button" class="backdrop-stage" id="change-background"
						aria-label="Change background" aria-haspopup="dialog">
						<span class="backdrop-preview${backdrop ? "" : " plain"}" id="preview">${preview}</span>
						<span class="corner-mark corner-mark-${topLeft ? "top-left" : "bottom-right"}" aria-hidden="true">&#8592;</span>
						<span class="change-label" aria-hidden="true">Change background</span>
					</button>

					<div class="field back-corner">
						<label id="corner-label">Back button</label>
						<div class="tabs" id="corner-tabs" role="group" aria-labelledby="corner-label">
							<button type="button" class="tab-btn${topLeft ? " active" : ""}" data-value="top-left"
								aria-pressed="${topLeft}">Top left</button>
							<button type="button" class="tab-btn${topLeft ? "" : " active"}" data-value="bottom-right"
								aria-pressed="${!topLeft}">Bottom right</button>
						</div>
					</div>
				</div>
`;

	// Changing the background: a big pop-up with a live preview, and three
	// choices. Nothing changes until Use.
	//
	//   Picture   a file from this device, looked at here before it's sent
	//   Colour    one colour, from a colour wheel, a brightness slider, a
	//             few ready-made colours or a #code
	//   Default   the pages' own colour: black, or Beige Cream in light
	//             mode
	const startTab = file ? "picture" : colour ? "colour" : "default";
	const SWATCHES = ["#000000", "#1e2a44", "#24423b", "#3f2a3d", "#5a3d2b", "#eedec5", "#c9d6df", "#f2c4b4"];

	const backgroundModal = `
			<div class="modal-backdrop" id="background-modal" hidden>
				<div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="bg-title">
					<div class="modal-head">
						<h2 id="bg-title">Change background</h2>
						<button class="modal-close" data-close="background-modal" aria-label="Close">&times;</button>
					</div>

					<div class="bg-preview" id="bg-preview" aria-hidden="true">
						<span class="bg-preview-colour" id="bg-preview-colour"></span>
						<img id="bg-preview-image" alt="" hidden>
						<span class="bg-preview-card">Text on the glass</span>
					</div>

					<div class="tabs bg-tabs" id="bg-tabs" role="tablist">
						<button type="button" class="tab-btn${startTab === "picture" ? " active" : ""}" data-bg-tab="picture" role="tab">Picture</button>
						<button type="button" class="tab-btn${startTab === "colour" ? " active" : ""}" data-bg-tab="colour" role="tab">Colour</button>
						<button type="button" class="tab-btn${startTab === "default" ? " active" : ""}" data-bg-tab="default" role="tab">Default</button>
					</div>

					<div class="bg-pane" data-bg-pane="picture"${startTab === "picture" ? "" : " hidden"}>
						<p class="hint">
							A picture (JPEG, PNG, WebP), an animated GIF or WebP, or a looping
							video (MP4, WebM) without sound, up to 50 MB. It's looked at on this
							device first, then kept by OmniCore and never sent anywhere.
						</p>
						<div class="buttons">
							<button type="button" class="glass" id="choose">Choose a file</button>
						</div>
						<input type="file" id="file" hidden
							accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm">
					</div>

					<div class="bg-pane" data-bg-pane="colour"${startTab === "colour" ? "" : " hidden"}>
						<div class="wheel-row">
							<div class="wheel" id="wheel" tabindex="0" role="slider"
								aria-label="Colour wheel: arrow keys change the colour and how strong it is">
								<canvas id="wheel-canvas" width="440" height="440"></canvas>
								<span class="wheel-knob" id="wheel-knob"></span>
							</div>
							<div class="wheel-side">
								<div class="field">
									<label for="wheel-value">Brightness <span class="muted" id="wheel-value-text"></span></label>
									<input type="range" id="wheel-value" min="0" max="100" step="1" value="100">
								</div>
								<div class="field">
									<label for="wheel-hex">Colour code</label>
									<input type="text" id="wheel-hex" spellcheck="false" autocomplete="off" maxlength="7" placeholder="#37393e">
								</div>
								<div class="swatches" id="swatches">
									${SWATCHES.map(
										(swatch) =>
											`<button type="button" class="swatch" data-swatch="${swatch}" style="--colour:${swatch}" ` +
											`title="${swatch}" aria-label="${swatch}"></button>`
									).join("")}
								</div>
							</div>
						</div>
					</div>

					<div class="bg-pane" data-bg-pane="default"${startTab === "default" ? "" : " hidden"}>
						<p class="hint">
							The pages' own colour: black (#000000) in dark mode,
							Beige Cream (#eedec5) in light mode.${file ? " The picture in use now is deleted from OmniCore." : ""}
						</p>
					</div>

					<p class="status" id="upload-status" aria-live="polite"></p>

					<div class="buttons dialog-buttons">
						<button type="button" class="glass" data-close="background-modal">Cancel</button>
						<button type="button" class="glass" id="bg-use" disabled>Use</button>
					</div>
				</div>
			</div>
`;

	const glassBox = `
				<div class="segment c4 row1" id="glass">
					<div class="box-head">
						<h2>Frosted glass</h2>
						${
							backdrop
								? `<label class="auto-switch" title="Keeps the text readable: moves Dim, then Blur, then Tint strength, as far as needed">
							<span>Auto</span>
							<input type="checkbox" role="switch" id="glass-auto"${auto ? " checked" : ""}>
						</label>`
								: ""
						}
					</div>
					<p class="lede">Every box on these pages, over the background.</p>

					<div class="glass-fields">
						<div class="field wide-field">
							<label>Tint ${infoTip(
								file
									? "Dominant is the colour that covers most of the picture, Vibrant its most eye-catching one, both worked out once when it was picked."
									: "A colour laid over every box. With a picture behind the pages, its own colours can be the tint too.",
								"About the tint"
							)}</label>
							<div class="tint-chips" id="tints">
								${chip("none", "None", "", false)}
								${file ? chip("dominant", "Dominant", dominant, false) : ""}
								${file ? chip("vibrant", "Vibrant", vibrant, false) : ""}
								${backdropStore.TINT_PRESETS.map((colour) => chip(colour, colour, colour, false)).join("")}
								<label class="tint-chip tint-custom${custom ? " active" : ""}" title="Pick a colour">
									<input type="color" id="custom" value="${escapeHtml(custom ? tint : "#7aa2ff")}" aria-label="Pick a colour">
								</label>
							</div>
						</div>

						<div class="field">
							<div class="slider-head">
								<label for="blur">Blur <span class="muted" id="blur-value">${glass.blur} px${byAuto("blur") ? ", Auto" : ""}</span></label>
								${pinBadge("blur")}
							</div>
							<input type="range" id="blur" min="0" max="${backdropStore.BLUR_MOST}" step="1" value="${glass.blur}">
						</div>

						<div class="field">
							<div class="slider-head">
								<label for="strength">Tint strength <span class="muted" id="strength-value">${glass.tintStrength}%${byAuto("tintStrength") ? ", Auto" : ""}</span></label>
								${pinBadge("tintStrength")}
							</div>
							<input type="range" id="strength" min="0" max="${backdropStore.TINT_STRENGTH_MOST}" step="1" value="${glass.tintStrength}">
						</div>

						${
							backdrop
								? `<div class="field">
							<div class="slider-head">
								<label for="brightness">${file ? "Picture" : "Colour"} brightness <span class="muted" id="brightness-value">${brightnessWords(brightness)}</span></label>
							</div>
							<input type="range" id="brightness" min="${backdropStore.BRIGHTNESS_LEAST}" max="${backdropStore.BRIGHTNESS_MOST}" step="1"
								value="${brightness}" aria-valuetext="${brightnessWords(brightness)}">
						</div>

						<div class="field">
							<div class="slider-head">
								<label for="dim">Dim <span class="muted" id="dim-value">${glass.dim}%${byAuto("dim") ? ", Auto" : ""}</span></label>
								${pinBadge("dim")}
							</div>
							<input type="range" id="dim" min="0" max="${backdropStore.DIM_MOST}" step="1" value="${glass.dim}">
						</div>`
								: ""
						}
					</div>
					<p class="help glass-warning" id="glass-warning"${glass.readable ? " hidden" : ""}></p>
					<div class="buttons to-end">
						<span class="status" id="glass-status" aria-live="polite"></span>
						<button type="button" class="btn-glossy btn-glossy-neutral" id="glass-cancel" disabled>Cancel</button>
						<button type="button" class="btn-glossy btn-glossy-green" id="glass-save" disabled>Save</button>
					</div>
				</div>
`;

	// Font colour, in the Typography box: a strip like the font's beside
	// it, saying White or Black, with two "Aa" to pick from. Each "Aa"
	// sits on a piece of the background through the real glass (its fill,
	// tint and Dim, the picture at its brightness), so it shows how that
	// colour reads before it's picked; they follow the sliders as they
	// move. Only over a picture or a colour: the Default background has its
	// mode's own colours.
	const swatchPicture = file
		? ` style="--swatch-picture:url('/backdrop/${escapeHtml(settings.backgroundStill || settings.backgroundFile)}')"`
		: colour
		? ` style="--swatch-picture:${escapeHtml(settings.backgroundColor)}"`
		: "";
	const swatch = (value, name) =>
		`<button type="button" class="font-swatch ${value}-text${fontColour === value ? " active" : ""}" data-font="${value}"` +
		` aria-pressed="${fontColour === value}" aria-label="${name} text" title="${name} text"${swatchPicture}><span>Aa</span></button>`;
	const fontColourField = `
					<div class="inset">
						<div class="inset-text">
							<div class="inset-label">COLOUR</div>
							<div class="inset-value" id="font-colour-name">${
								backdrop ? (fontColour === "black" ? "Black" : "White") : "With a picture or a colour"
							}</div>
						</div>
						${backdrop ? `<div class="font-swatches${colour ? " on-colour" : ""}" role="group" aria-label="Font colour">${swatch("white", "White")}${swatch("black", "Black")}</div>` : ""}
					</div>`;

	const script = `
		// How Auto works out the glass, the same functions the server uses
		// (backdrop.js), so what's previewed is what's saved
		const MODEL = ${JSON.stringify(backdropStore.GLASS_MODEL)};
		${backdropStore.solveGlass.toString()}
		${backdropStore.fontToKeep.toString()}
		${backdropStore.tintWithDim.toString()}
		${backdropStore.startingBrightness.toString()}
		${backdropStore.onPictureShadow.toString()}

		// What's behind the pages now: how dark, bright and bright overall
		// it is, and its dominant and vibrant colours. Null for the Default.
		const PICTURE = ${JSON.stringify(
			backdrop
				? {
						low: settings.backgroundLow,
						high: settings.backgroundHigh,
						mean: settings.backgroundMean,
						colour: !file,
						color: settings.backgroundColor || "",
						vibrant: settings.backgroundVibrant || ""
				  }
				: null
		).replace(/</g, "\\u003c")};
		const MAX_BYTES = ${backdropStore.MAX_BYTES};

		// The everyday colours for white text and for black text, so a
		// change of font colour shows at once. Only with something behind
		// the pages: with the Default, the mode's own colours never change
		// here.
		const SETS = ${JSON.stringify(
			backdrop ? { dark: paletteVariables(overPicturePalette("dark")), light: paletteVariables(overPicturePalette("light")) } : null
		).replace(/</g, "\\u003c")};

		let tint = ${JSON.stringify(tint)};
		let auto = ${JSON.stringify(auto)};
		let pinned = ${JSON.stringify(pinned)};
		let fontColour = ${JSON.stringify(fontColour)};

		// The values set by hand: what a pinned slider, or every slider
		// with Auto off, uses. Kept apart from what the sliders show, since
		// a free slider shows Auto's value.
		const hand = ${JSON.stringify({
			blur: Number.isFinite(Number(settings.glassBlur)) ? Number(settings.glassBlur) : backdropStore.BLUR_DEFAULT,
			tintStrength: Number.isFinite(Number(settings.glassTintStrength))
				? Number(settings.glassTintStrength)
				: backdropStore.TINT_STRENGTH_DEFAULT,
			dim: Number.isFinite(Number(settings.glassDim)) ? Number(settings.glassDim) : 0
		})};

		const root = document.documentElement;
		const sliders = {
			blur: document.getElementById("blur"),
			tintStrength: document.getElementById("strength"),
			dim: document.getElementById("dim")
		};
		const brightness = document.getElementById("brightness");
		const custom = document.getElementById("custom");
		const autoBox = document.getElementById("glass-auto");
		const warning = document.getElementById("glass-warning");

		// Light or dark: this browser's own choice, or the device's when
		// it hasn't made one
		function light() {
			return ${
				uiMode
					? JSON.stringify(uiMode === "light")
					: 'window.matchMedia("(prefers-color-scheme: light)").matches'
			};
		}

		// The tint's colour, from the choice
		function tintOf(choice, picture) {
			if (choice === "none") return "";
			if (choice === "dominant") return (picture && picture.color) || "";
			if (choice === "vibrant") return (picture && (picture.vibrant || picture.color)) || "";
			return choice;
		}

		// The glass as Auto (or the hand) sets it over a background, or
		// over the Default, where there's nothing to read against: Blur and
		// Tint strength as set by hand, no Dim
		function solved(picture, bright, font) {
			if (!picture) {
				return {
					blur: hand.blur,
					tintStrength: hand.tintStrength,
					dim: 0,
					font: light() ? "black" : "white",
					readable: true
				};
			}
			return solveGlass(inputFor(picture, bright, font || fontColour), MODEL);
		}

		// What Auto is given: the background, the glass as set, a font
		// colour
		function inputFor(picture, bright, font) {
			return {
				low: picture.low,
				high: picture.high,
				mean: picture.mean,
				brightness: bright,
				tint: tintOf(tint, picture),
				auto: auto,
				pinned: pinned,
				blur: hand.blur,
				tintStrength: hand.tintStrength,
				dim: hand.dim,
				font: font,
				colour: Boolean(picture.colour)
			};
		}

		// The glass or the background changed: the font colour is checked,
		// and switched when the text couldn't be read otherwise (the server
		// does the same when it's saved). Picking the font colour itself
		// never comes here.
		function recheck() {
			if (!PICTURE) return;
			fontColour = fontToKeep(inputFor(PICTURE, brightness ? Number(brightness.value) : 0, fontColour), MODEL);
		}

		function brightnessWords(value) {
			return value === 0 ? "Original" : Math.abs(value) + "% " + (value < 0 ? "darker" : "brighter");
		}

		// The everyday colours that go with the font colour, laid over the
		// page's own until it's next drawn by the server
		let shownSet = null;
		function showSet(set) {
			if (set === shownSet) return;
			shownSet = set;
			let tag = document.getElementById("live-set");
			if (!tag) {
				tag = document.createElement("style");
				tag.id = "live-set";
				document.head.appendChild(tag);
			}
			tag.textContent = ":root {" + SETS[set] + "}";
		}

		// Everything moved shows at once on this page, before saving
		function preview() {
			const bright = brightness ? Number(brightness.value) : 0;
			const glass = solved(PICTURE, bright);
			const names = { blur: " px", tintStrength: "%", dim: "%" };

			for (const name in sliders) {
				const slider = sliders[name];
				if (!slider) continue;
				const free = PICTURE && auto && pinned.indexOf(name) === -1;
				slider.value = glass[name];
				document.getElementById(name === "tintStrength" ? "strength-value" : name + "-value").textContent =
					glass[name] + names[name] + (free ? ", Auto" : "");
				const badge = document.querySelector('[data-unpin="' + name + '"]');
				if (badge) badge.hidden = !(PICTURE && auto && pinned.indexOf(name) !== -1);
			}
			if (window.omniFillRanges) window.omniFillRanges();

			root.style.setProperty("--glass-blur", glass.blur + "px");
			root.style.setProperty("--glass-tint", tintWithDim(tintOf(tint, PICTURE), glass.tintStrength, glass.dim));

			if (brightness) {
				document.getElementById("brightness-value").textContent = brightnessWords(bright);
				brightness.setAttribute("aria-valuetext", brightnessWords(bright));
				root.style.setProperty("--backdrop-brightness", (100 + bright) / 100);
				root.style.setProperty("--colour-brightness", (100 + Math.min(0, bright)) / 100);
				root.style.setProperty("--colour-lift", Math.max(0, bright) / 100);
			}

			// Over a picture: the text colours go with the font colour; the
			// glass stays as it is
			if (PICTURE) {
				const black = glass.font === "black";
				showSet(black ? "light" : "dark");
				root.style.setProperty("--segment-bg", "rgba(255, 255, 255, " + MODEL.fill + ")");
				root.style.setProperty("--segment-edge", "rgba(255, 255, 255, 0.16)");
				root.style.setProperty("--on-picture-shadow", onPictureShadow(black));
				document.getElementById("font-colour-name").textContent = black ? "Black" : "White";
			}

			// Said when the text may be hard to read: never overruled, only
			// said
			warning.hidden = glass.readable;
			warning.textContent = glass.readable
				? ""
				: !auto
				? "Text in " + glass.font + " may be hard to read over this with Auto off."
				: pinned.length
				? "Text in " + glass.font + " may be hard to read with " + pinned.map(function (name) {
						return { dim: "Dim", blur: "Blur", tintStrength: "Tint strength" }[name];
				  }).join(" and ") + " pinned. Press Pinned to let Auto move it."
				: "Text in " + glass.font + " may be hard to read over this.";

			for (const chip of document.querySelectorAll("[data-tint]")) {
				const on = chip.dataset.tint === tint;
				chip.classList.toggle("active", on);
				chip.setAttribute("aria-pressed", on ? "true" : "false");
			}
			document.querySelector(".tint-custom").classList.toggle(
				"active",
				/^#/.test(tint) && !document.querySelector('[data-tint="' + tint + '"]')
			);

			for (const button of document.querySelectorAll("[data-font]")) {
				const on = button.dataset.font === fontColour;
				button.classList.toggle("active", on);
				button.setAttribute("aria-pressed", on ? "true" : "false");
			}

			return glass;
		}

		// A slider moved by hand: its value is the hand's, and with Auto on
		// it's pinned, so Auto leaves it alone from now on
		for (const name in sliders) {
			const slider = sliders[name];
			if (!slider) continue;
			slider.addEventListener("input", function () {
				hand[name] = Number(slider.value);
				if (PICTURE && auto && pinned.indexOf(name) === -1) pinned.push(name);
				recheck();
				preview();
			});
			slider.addEventListener("change", function () { changed(true); });
		}
		if (brightness) {
			brightness.addEventListener("input", function () {
				recheck();
				preview();
			});
			brightness.addEventListener("change", function () { changed(true); });
		}

		// Pinned: pressed, Auto may move that one again
		for (const badge of document.querySelectorAll("[data-unpin]")) {
			badge.addEventListener("click", function () {
				pinned = pinned.filter(function (name) { return name !== badge.dataset.unpin; });
				recheck();
				preview();
				changed(true);
			});
		}

		// Auto off keeps what's shown, so nothing jumps; Auto back on frees
		// all three
		if (autoBox) {
			autoBox.addEventListener("change", function () {
				if (!autoBox.checked) {
					const now = preview();
					hand.blur = now.blur;
					hand.tintStrength = now.tintStrength;
					hand.dim = now.dim;
				} else {
					pinned = [];
				}
				auto = autoBox.checked;
				recheck();
				preview();
				changed(true);
			});
		}

		document.getElementById("tints").addEventListener("click", function (event) {
			const chip = event.target.closest("[data-tint]");
			if (!chip || chip.disabled) return;
			tint = chip.dataset.tint;
			// Picking a colour with the strength at nothing would show
			// nothing; give it a little
			if (tint !== "none" && Number(sliders.tintStrength.value) === 0) hand.tintStrength = MODEL.tintStrengthDefault;
			recheck();
			preview();
			changed(true);
		});

		custom.addEventListener("input", function () {
			tint = custom.value.toLowerCase();
			if (Number(sliders.tintStrength.value) === 0) hand.tintStrength = MODEL.tintStrengthDefault;
			recheck();
			preview();
		});
		custom.addEventListener("change", function () { changed(true); });

		// Font colour: White or Black, as picked, never checked straight
		// away (only the next change to the glass checks it again)
		for (const button of document.querySelectorAll("[data-font]")) {
			button.addEventListener("click", function () {
				if (!PICTURE) return;
				fontColour = button.dataset.font;
				preview();
				changed(false);
			});
		}

		preview();

		// The glass: nothing is kept until Save. Every change shows at once
		// on this page; Cancel puts it back as it was saved, and leaving the
		// page without saving keeps nothing. Font colour is a pick, like
		// Appearance Mode beside it: kept as soon as it's picked.
		const saveButton = document.getElementById("glass-save");
		const cancelButton = document.getElementById("glass-cancel");
		const glassStatus = document.getElementById("glass-status");

		function snapshot() {
			return JSON.stringify({
				hand: hand,
				auto: auto,
				pinned: pinned.slice().sort(),
				tint: tint,
				brightness: brightness ? Number(brightness.value) : 0
			});
		}
		let savedGlass = snapshot();
		let savedFont = fontColour;

		// Whether the last thing done was picking the font colour: then
		// Save leaves it as picked. Otherwise the server checks it against
		// the glass, the same way this page did.
		let fontLast = false;

		function changed(glass) {
			if (!glass) {
				fontLast = true;
				saveFont();
				return;
			}
			fontLast = false;
			const dirty = snapshot() !== savedGlass;
			saveButton.disabled = !dirty;
			cancelButton.disabled = !dirty;
			glassStatus.textContent = "";
		}

		// Sends what's on the page; says so only when it couldn't
		async function sendGlass(body) {
			try {
				const response = await fetch("/background/glass", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body)
				});
				if (!response.ok) throw new Error();
				glassStatus.textContent = "";
				return await response.json();
			} catch (error) {
				glassStatus.className = "status bad";
				glassStatus.textContent = "Couldn't save.";
				return null;
			}
		}

		async function saveFont() {
			const picked = fontColour;
			if (await sendGlass({ fontColour: picked })) savedFont = picked;
		}

		saveButton.addEventListener("click", async function () {
			saveButton.disabled = true;
			cancelButton.disabled = true;
			const kept = await sendGlass({
				blur: hand.blur,
				tintStrength: hand.tintStrength,
				dim: hand.dim,
				auto: auto,
				pinned: pinned,
				tint: tint,
				brightness: brightness ? Number(brightness.value) : undefined,
				fontColour: fontColour,
				recheck: !fontLast
			});
			if (!kept) {
				saveButton.disabled = false;
				cancelButton.disabled = false;
				return;
			}
			// What the server kept (the same, as it works it out the same
			// way)
			if (kept.fontColour && kept.fontColour !== fontColour) {
				fontColour = kept.fontColour;
				preview();
			}
			savedGlass = snapshot();
			savedFont = fontColour;
		});

		cancelButton.addEventListener("click", function () {
			const was = JSON.parse(savedGlass);
			hand.blur = was.hand.blur;
			hand.tintStrength = was.hand.tintStrength;
			hand.dim = was.hand.dim;
			auto = was.auto;
			if (autoBox) autoBox.checked = auto;
			pinned = was.pinned;
			tint = was.tint;
			if (/^#/.test(tint)) custom.value = tint;
			if (brightness) brightness.value = was.brightness;
			fontColour = savedFont;
			fontLast = false;
			preview();
			saveButton.disabled = true;
			cancelButton.disabled = true;
			glassStatus.textContent = "";
		});

		// --- Changing the background: the dialog --------------------------
		//
		// Picture, Colour or Default, with a live preview of what it'll look
		// like (a piece of glass on it, as Auto, or the sliders set by hand,
		// would make it there). Nothing changes until Use.

		const upload = document.getElementById("upload-status");
		const modal = document.getElementById("background-modal");
		const useButton = document.getElementById("bg-use");
		const previewColour = document.getElementById("bg-preview-colour");
		const previewImage = document.getElementById("bg-preview-image");
		const DEFAULT_COLOURS = { dark: "${DEFAULT_DARK}", light: "${DEFAULT_LIGHT}" };

		function say(text, bad) {
			upload.className = "status" + (bad ? " bad" : "");
			upload.textContent = text;
		}

		// What's chosen in the dialog
		const chosen = {
			tab: ${JSON.stringify(startTab)},
			file: null,
			about: null,
			fileAddress: "",
			// The wheel starts on the colour in use, or a middling blue, so
			// the wheel isn't shown nearly black
			colour: ${JSON.stringify(colour ? settings.backgroundColor : "#3d5a99")}
		};

		function hexOf(r, g, b) {
			return "#" + [r, g, b].map(function (value) {
				return Math.round(value).toString(16).padStart(2, "0");
			}).join("");
		}

		function rgbOf(hex) {
			const value = parseInt(hex.slice(1), 16);
			return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
		}

		// The dialog's preview: what's chosen, under the veil it would get
		function showChoice() {
			// What's chosen, as Auto sees a background: null for the Default
			let picture = null;
			let bright = 0;
			previewImage.hidden = true;

			if (chosen.tab === "picture") {
				if (chosen.fileAddress) {
					previewImage.src = chosen.fileAddress;
					previewImage.hidden = false;
					picture = chosen.about;
					// A new picture starts at its own brightness
					bright = startingBrightness(chosen.about.mean);
				} else if (PICTURE && ${JSON.stringify(Boolean(file))}) {
					previewImage.src = ${JSON.stringify(file ? `/backdrop/${settings.backgroundStill || settings.backgroundFile}` : "")};
					previewImage.hidden = false;
					picture = PICTURE;
					bright = brightness ? Number(brightness.value) : 0;
				}
				previewColour.style.setProperty("--colour", light() ? DEFAULT_COLOURS.light : DEFAULT_COLOURS.dark);
			} else if (chosen.tab === "colour") {
				const rgb = rgbOf(chosen.colour);
				const shade = luminance(rgb[0], rgb[1], rgb[2]);
				picture = { low: shade, high: shade, mean: shade, color: chosen.colour, vibrant: chosen.colour, colour: true };
				previewColour.style.setProperty("--colour", chosen.colour);
			} else {
				previewColour.style.setProperty("--colour", light() ? DEFAULT_COLOURS.light : DEFAULT_COLOURS.dark);
			}

			// The piece of glass on it, as Auto would make it there, with
			// the font colour checked against the new background as Use will
			const glass = solved(picture, bright, picture ? fontToKeep(inputFor(picture, bright, fontColour), MODEL) : null);
			const stage = document.getElementById("bg-preview");
			stage.style.setProperty("--preview-brightness", (100 + bright) / 100);
			stage.style.setProperty("--card-fill", "rgba(255, 255, 255, " + (picture ? MODEL.fill : 0.06) + ")");
			stage.style.setProperty("--card-tint", tintWithDim(tintOf(tint, picture), glass.tintStrength, glass.dim));
			stage.style.setProperty("--card-blur", glass.blur + "px");
			stage.style.setProperty("--card-fg", glass.font === "black" ? "#111" : "#fff");

			// Use: there has to be something to use
			useButton.disabled = chosen.tab === "picture" && !chosen.file;
		}

		function pickTab(tab) {
			chosen.tab = tab;
			for (const button of document.querySelectorAll("[data-bg-tab]")) {
				const on = button.dataset.bgTab === tab;
				button.classList.toggle("active", on);
				button.setAttribute("aria-selected", on ? "true" : "false");
			}
			for (const pane of document.querySelectorAll("[data-bg-pane]")) {
				pane.hidden = pane.dataset.bgPane !== tab;
			}
			if (tab === "colour") drawWheel();
			say("");
			showChoice();
		}

		for (const button of document.querySelectorAll("[data-bg-tab]")) {
			button.addEventListener("click", function () { pickTab(button.dataset.bgTab); });
		}

		document.getElementById("change-background").addEventListener("click", function () {
			modal.hidden = false;
			pickTab(chosen.tab);
			if (window.omniFillRanges) window.omniFillRanges();
			document.querySelector('[data-bg-tab="' + chosen.tab + '"]').focus();
		});

		// --- The colour wheel ----------------------------------------------
		//
		// Hue goes round, how strong the colour is goes out from the middle
		// (grey at the centre), and Brightness is the slider beside it. The
		// ring is drawn once, at twice its size on screen so it's sharp.

		const wheel = document.getElementById("wheel");
		const wheelCanvas = document.getElementById("wheel-canvas");
		const wheelKnob = document.getElementById("wheel-knob");
		const wheelValue = document.getElementById("wheel-value");
		const wheelHex = document.getElementById("wheel-hex");
		let drawn = false;

		// Hue (0-360), strength and brightness (0-1) to red, green, blue
		function rgbFromHsv(h, s, v) {
			const f = function (n) {
				const k = (n + h / 60) % 6;
				return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
			};
			return [f(5) * 255, f(3) * 255, f(1) * 255];
		}

		function hsvFromRgb(r, g, b) {
			r /= 255; g /= 255; b /= 255;
			const most = Math.max(r, g, b);
			const least = Math.min(r, g, b);
			const range = most - least;
			let h = 0;
			if (range) {
				if (most === r) h = ((g - b) / range) % 6;
				else if (most === g) h = (b - r) / range + 2;
				else h = (r - g) / range + 4;
				h *= 60;
				if (h < 0) h += 360;
			}
			return { h: h, s: most ? range / most : 0, v: most };
		}

		let hsv = (function () {
			const rgb = rgbOf(chosen.colour);
			return hsvFromRgb(rgb[0], rgb[1], rgb[2]);
		})();

		function drawWheel() {
			if (drawn) return;
			drawn = true;
			const size = wheelCanvas.width;
			const middle = size / 2;
			const context = wheelCanvas.getContext("2d");
			const image = context.createImageData(size, size);
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					const dx = x - middle;
					const dy = y - middle;
					const distance = Math.sqrt(dx * dx + dy * dy) / middle;
					const at = (y * size + x) * 4;
					if (distance > 1) { image.data[at + 3] = 0; continue; }
					const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
					const rgb = rgbFromHsv(hue, distance, 1);
					image.data[at] = rgb[0];
					image.data[at + 1] = rgb[1];
					image.data[at + 2] = rgb[2];
					// A soft edge rather than jagged pixels
					image.data[at + 3] = Math.round(Math.min(1, (1 - distance) * middle) * 255);
				}
			}
			context.putImageData(image, 0, 0);
			showWheel();
		}

		// The knob where the colour is, the slider and the code to match
		function showWheel() {
			const angle = hsv.h * Math.PI / 180;
			wheelKnob.style.setProperty("--knob-x", 50 + Math.cos(angle) * hsv.s * 50 + "%");
			wheelKnob.style.setProperty("--knob-y", 50 + Math.sin(angle) * hsv.s * 50 + "%");
			const rgb = rgbFromHsv(hsv.h, hsv.s, hsv.v);
			chosen.colour = hexOf(rgb[0], rgb[1], rgb[2]);
			wheelKnob.style.setProperty("--colour", chosen.colour);
			wheelCanvas.style.setProperty("--brightness", Math.max(0.15, hsv.v));
			wheelValue.value = Math.round(hsv.v * 100);
			document.getElementById("wheel-value-text").textContent = Math.round(hsv.v * 100) + "%";
			if (document.activeElement !== wheelHex) wheelHex.value = chosen.colour;
			wheel.setAttribute("aria-valuetext", chosen.colour);
			if (window.omniFillRanges) window.omniFillRanges();
			showChoice();
		}

		function pickAt(event) {
			const edges = wheelCanvas.getBoundingClientRect();
			const dx = event.clientX - (edges.left + edges.width / 2);
			const dy = event.clientY - (edges.top + edges.height / 2);
			hsv.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
			hsv.s = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (edges.width / 2));
			if (hsv.v < 0.05) hsv.v = 1;
			showWheel();
		}

		wheel.addEventListener("pointerdown", function (event) {
			wheel.setPointerCapture(event.pointerId);
			pickAt(event);
			event.preventDefault();
		});
		wheel.addEventListener("pointermove", function (event) {
			if (wheel.hasPointerCapture(event.pointerId)) pickAt(event);
		});

		// Arrow keys: left and right turn the hue, up and down change how
		// strong it is
		wheel.addEventListener("keydown", function (event) {
			const step = event.shiftKey ? 10 : 2;
			if (event.key === "ArrowLeft") hsv.h = (hsv.h - step + 360) % 360;
			else if (event.key === "ArrowRight") hsv.h = (hsv.h + step) % 360;
			else if (event.key === "ArrowUp") hsv.s = Math.min(1, hsv.s + step / 100);
			else if (event.key === "ArrowDown") hsv.s = Math.max(0, hsv.s - step / 100);
			else return;
			event.preventDefault();
			showWheel();
		});

		wheelValue.addEventListener("input", function () {
			hsv.v = Number(wheelValue.value) / 100;
			showWheel();
		});

		wheelHex.addEventListener("input", function () {
			const typed = wheelHex.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
			if (!/^#[0-9a-f]{6}$/i.test(typed)) return;
			const rgb = rgbOf(typed.toLowerCase());
			hsv = hsvFromRgb(rgb[0], rgb[1], rgb[2]);
			showWheel();
		});
		wheelHex.addEventListener("blur", function () { wheelHex.value = chosen.colour; });

		document.getElementById("swatches").addEventListener("click", function (event) {
			const swatch = event.target.closest("[data-swatch]");
			if (!swatch) return;
			const rgb = rgbOf(swatch.dataset.swatch);
			hsv = hsvFromRgb(rgb[0], rgb[1], rgb[2]);
			showWheel();
		});

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
		// work out its dominant and vibrant colours, how dark its darker
		// parts, how bright its brighter parts and how bright it is
		// overall, and a still frame. Done here, once, from the file on
		// this device, before anything is sent.
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

				return Object.assign({ still: still }, colours(pixels));
			} finally {
				URL.revokeObjectURL(address);
			}
		}

		// What a picture's pixels say about it (a small copy's, red, green,
		// blue and alpha in a row):
		//
		//   color     dominant: its four most common colours, averaged
		//             by how common each is
		//   vibrant   its most saturated, eye-catching colour: of the
		//             colours covering at least half a percent of it, the
		//             one most saturated and bright at once. Dominant
		//             when nothing in it has any real colour.
		//   low, high how dark the darkest tenth, how bright the
		//             brightest tenth
		//   mean      how bright it is overall
		function colours(pixels) {
			const shades = [];
			const buckets = {};
			for (let i = 0; i < pixels.length; i += 4) {
				const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
				shades.push(luminance(r, g, b));
				const key = (r >> 5) + "," + (g >> 5) + "," + (b >> 5);
				const bucket = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
				bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
			}
			const mean = shades.reduce(function (sum, shade) { return sum + shade; }, 0) / shades.length;
			shades.sort(function (a, b) { return a - b; });

			function hexOfBucket(bucket) {
				return hexOf(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
			}

			const all = Object.values(buckets);
			const main = all.slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
			const total = main.reduce(function (sum, bucket) { return sum + bucket.n; }, 0);
			const color = hexOf(
				main.reduce(function (sum, bucket) { return sum + bucket.r; }, 0) / total,
				main.reduce(function (sum, bucket) { return sum + bucket.g; }, 0) / total,
				main.reduce(function (sum, bucket) { return sum + bucket.b; }, 0) / total
			);

			let vibrant = color;
			let best = 0.15;
			const enough = shades.length * 0.005;
			for (const bucket of all) {
				if (bucket.n < enough) continue;
				const hsv = hsvFromRgb(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
				const score = hsv.s * hsv.v;
				if (score > best) {
					best = score;
					vibrant = hexOfBucket(bucket);
				}
			}

			return {
				color: color,
				vibrant: vibrant,
				low: shades[Math.floor(shades.length * 0.1)],
				high: shades[Math.floor(shades.length * 0.9)],
				mean: Math.round(mean * 10000) / 10000
			};
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

		// A file picked: looked at here, shown in the preview, and only
		// sent when Use is pressed
		document.getElementById("file").addEventListener("change", async function () {
			const file = this.files[0];
			this.value = "";
			if (!file) return;

			if (file.size > MAX_BYTES) {
				say("That file is bigger than 50 MB.", true);
				return;
			}

			say("Looking at it…");
			try {
				const about = await study(file);
				if (chosen.fileAddress) URL.revokeObjectURL(chosen.fileAddress);
				chosen.file = file;
				chosen.about = about;
				chosen.fileAddress = URL.createObjectURL(about.still);
				say(file.name);
				showChoice();
			} catch (error) {
				say(
					"This browser can't show that file, so it can't be the background. " +
					"JPEG, PNG, GIF, WebP, MP4 and WebM work; a video has to be in a format browsers play (H.264 or VP9, say).",
					true
				);
			}
		});

		// Use: whichever is chosen, then the page reloads to show it
		useButton.addEventListener("click", async function () {
			useButton.disabled = true;
			try {
				if (chosen.tab === "picture") {
					say("Sending it…");
					const received = await send("/background/upload", chosen.file);
					await send("/background/still?id=" + encodeURIComponent(received.id), chosen.about.still);
					const response = await fetch("/background/use", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							id: received.id,
							color: chosen.about.color,
							vibrant: chosen.about.vibrant,
							low: chosen.about.low,
							high: chosen.about.high,
							mean: chosen.about.mean
						})
					});
					const answer = await response.json().catch(function () { return {}; });
					if (!response.ok) throw new Error(answer.error || "Couldn't use it.");
				} else {
					const response = await fetch(chosen.tab === "colour" ? "/background/colour" : "/background/plain", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(chosen.tab === "colour" ? { color: chosen.colour } : {})
					});
					const answer = await response.json().catch(function () { return {}; });
					if (!response.ok) throw new Error(answer.error || "Couldn't change it.");
				}
				say("Done.");
				// The old background fades into the new one (backdrop.js)
				// rather than vanishing as the page reloads
				if (window.omniKeepBackdrop) window.omniKeepBackdrop();
				location.reload();
			} catch (error) {
				say(error.message, true);
				useButton.disabled = false;
			}
		});

		showChoice();

		// A picture picked before its vibrant colour and overall brightness
		// were worked out (an earlier v2 build): worked out now, once, from
		// the picture OmniCore serves, and kept
		(async function () {
			if (!PICTURE || PICTURE.vibrant || !${JSON.stringify(Boolean(file))}) return;
			try {
				const blob = await (await fetch(${JSON.stringify(file ? `/backdrop/${settings.backgroundStill || settings.backgroundFile}` : "")})).blob();
				const image = new Image();
				image.src = URL.createObjectURL(blob);
				await image.decode();
				const small = document.createElement("canvas");
				small.width = 48;
				small.height = 48;
				const context = small.getContext("2d", { willReadFrequently: true });
				context.drawImage(image, 0, 0, 48, 48);
				URL.revokeObjectURL(image.src);
				const about = colours(context.getImageData(0, 0, 48, 48).data);
				const response = await fetch("/background/about", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ vibrant: about.vibrant, mean: about.mean })
				});
				if (!response.ok) return;
				PICTURE.vibrant = about.vibrant;
				PICTURE.mean = about.mean;
				const swatch = document.querySelector('[data-tint="vibrant"] .tint-swatch');
				if (swatch) swatch.style.setProperty("--colour", about.vibrant);
				preview();
			} catch (error) {
				// Not this time: Vibrant is the dominant colour until it works
			}
		})();
	`;

	return { backgroundBox, glassBox, backgroundModal, fontColourField, script };
}

// The server's address on the home network, the one other devices use to
// reach Settings and the faces, when it's been given: OMNICORE_ADDRESS in
// the compose file, an IP (192.168.1.50) or a name (omnia.local). Inside
// Docker, OmniCore can't find it by itself: all it sees is the container's
// own address (172.something), which no other device can use. Anything
// that isn't a plain address or name is ignored. Null when not given.
function homeAddress() {
	const raw = String(process.env.OMNICORE_ADDRESS || "")
		.trim()
		.replace(/^[a-z]+:\/\//i, "")
		.replace(/\/.*$/, "")
		.replace(/:\d+$/, "");
	return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(raw) ? raw : null;
}

// The About tab's updates. Until v2 they were a page of their own,
// /updates; that address now opens the tab:
//
//   aboutBox    which OmniCore this is: version, its address on the home
//               network, and since when it's been running. The whole box
//               is the way to System info (the About face). Not the port
//               on its own or the data folder: the address says the port,
//               and in Docker the data folder is a volume whose path means
//               nothing on the server.
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

	// The address: OMNICORE_ADDRESS when it's set. Otherwise the page
	// fills it in from the address the browser used to open Settings,
	// which is the server's own when Settings was opened from another
	// device. Opened on the server itself (localhost), there's nothing to
	// show, so it says how to set one.
	const address = homeAddress();

	const aboutBox = `
		<a class="segment clickable c2 row1 about-box" id="about-link" href="#" title="System info">
			<div class="about-box-head">
				<h2>OmniCore</h2>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"
					stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 17L17 7M9 7h8v8"/></svg>
			</div>
			<div class="fact"><span>Version</span><span>OmniCore ${versionHtml()}</span></div>
			<div class="fact"><span>Address</span><span id="home-address" data-set="${address ? "yes" : ""}">${
				address ? escapeHtml(`${address}:${ADMIN_PORT}`) : ""
			}</span></div>
			<p class="hint" id="address-hint" hidden>
				This page was opened on the server itself, so OmniCore can't tell.
				Add OMNICORE_ADDRESS to your compose file to show it here.
			</p>
			${dev ? "" : `<div class="fact"><span>Running since</span><span>${when(since)}</span></div>`}
		</a>`;

	// A new major version (since 1.20.0): a row at the top of the box,
	// opening what's changing and Upgrade (majorModal, and the script with
	// the settings home's). Not a box of its own: the tab's six columns are
	// full, and a seventh would make it wider than the screen.
	const majorRow = last.nextMajor
		? `<button type="button" class="inset major-box" id="major-box"
				data-version="${escapeHtml(last.nextMajor)}" aria-haspopup="dialog">
				<span class="major-box-text">
					<strong>OmniCore ${escapeHtml(String(semver.major(last.nextMajor)))} is here!</strong>
					<span>Version ${escapeHtml(last.nextMajor)}, a new major version. Read what's changing, then upgrade from here.</span>
				</span>
				<span class="major-box-go" aria-hidden="true">&#8594;</span>
			</button>`
		: "";

	const majorModal = last.nextMajor
		? `<div class="modal-backdrop" id="major-modal" hidden>
			<div class="modal major-modal" role="dialog" aria-modal="true" aria-labelledby="major-title">
				<div class="modal-head">
					<h2 id="major-title">OmniCore ${escapeHtml(last.nextMajor)}</h2>
					<button class="modal-close" data-close="major-modal" aria-label="Close">&times;</button>
				</div>
				<div class="major-doc" id="major-doc" tabindex="0">
					<p class="lede">Loading what's changing…</p>
				</div>
				<div class="major-actions">
					<button type="button" class="glass glass-block is-off" id="major-upgrade"
						aria-disabled="true" title="Loading what's changing…">Upgrade to ${escapeHtml(last.nextMajor)}</button>
					<p class="hint major-why" id="major-why" aria-live="polite">Loading what's changing…</p>
				</div>
			</div>
		</div>`
		: "";

	const updatesBox = `
		<div class="segment c4 row1">
			<h2>Updates</h2>
			${majorRow}
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
		<div class="segment c6 row2 release-notes" id="release-notes">
			<h2>Release notes</h2>
			<div class="notes-body" id="notes-body" aria-live="polite"><p class="hint">Loading the notes...</p></div>
		</div>`;

	// The address, when OMNICORE_ADDRESS didn't give it: the one the
	// browser used, unless that's the server talking to itself
	const addressScript = `
		(function () {
			var shown = document.getElementById("home-address");
			if (!shown || shown.dataset.set) return;
			var host = location.hostname;
			var local = host === "localhost" || /^127\\./.test(host) || host === "::1" || host === "[::1]";
			if (local) {
				shown.textContent = "Not known";
				document.getElementById("address-hint").hidden = false;
			} else {
				shown.textContent = location.host;
			}
		})();
	`;

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
	const script = addressScript + notesScript + (dev ? "" : `
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
		// What's being installed: a major upgrade says so in its progress;
		// otherwise the update found by the last check
		var target = ${JSON.stringify((underWay && coreUpdater.currentProgress().target) || last.latestVersion || "")};
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

				if (progress.phase === "saving") {
					show(
						"working",
						"Saving a copy of your data...",
						"Kept in data/backups, and put back on its own if " + (target || "the new version") + " doesn't start properly."
					);
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

	return { aboutBox, updatesBox, notesBox, majorModal, script, updateReady: offered || Boolean(last.nextMajor) };
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
// service a "Search for a city" box asks, the keys saved for the ones that
// need one, and a box to try a search. See place-search.js.
//
//   placeBox   Primary, Secondary, the warning
//   keysBox    Saved keys: a row per key that's saved (never the key
//              itself), each with Change and Remove
//   tryBox     a box of its own, with no heading, to try a search with
//              the services picked; the matches float over the page
//
// A key is asked for when its service is picked, and only then: there's
// no box to type one in ahead of time. The question says what the service
// is like and links to where a key comes from. Saved as it changes, like
// the rest of the settings home.
function placeSearchPanel(settings) {
	const { primary, secondary } = placeSearch.chosen(settings);
	const services = placeSearch.servicesForPage(settings);
	const warning = placeSearch.warningFor(settings);

	const option = (service, picked) =>
		`<option value="${escapeHtml(service.id)}"${picked ? " selected" : ""}>${escapeHtml(service.name)}${
			service.key ? ` (needs ${escapeHtml(service.key === "username" ? "a username" : "an API key")})` : ""
		}</option>`;

	// "username" or "API key", for the questions and the rows
	const keyName = (service) => (service.key === "username" ? "username" : "API key");

	// Every service that takes a key has a row, hidden until a key is
	// saved, so one picked a moment ago can appear without a reload
	const keyRows = services
		.filter((service) => service.key)
		.map(
			(service) => `
			<div class="saved-key" data-key-row="${escapeHtml(service.id)}"${service.keySaved ? "" : " hidden"}>
				<div class="saved-key-text">
					<strong>${escapeHtml(service.name)}</strong>
					<span>${service.key === "username" ? "Username" : "API key"} saved</span>
				</div>
				<div class="saved-key-buttons">
					<button type="button" class="glass" data-change-key="${escapeHtml(service.id)}">Change</button>
					<button type="button" class="glass" data-remove-key="${escapeHtml(service.id)}">Remove</button>
				</div>
			</div>`
		)
		.join("");
	const anySaved = services.some((service) => service.keySaved);

	const placeBox = `
		<div class="segment c2 r2" id="place-search">
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
		</div>`;

	const tryBox = `
		<div class="segment c2 row2" id="place-try">
			<div class="field">
				<label for="try">Try a city search</label>
				<div class="search-row">
					<input type="text" id="try" placeholder="Bekkestua">
					<button type="button" class="glass medium" id="try-search">Search</button>
				</div>
				<div id="try-results"></div>
			</div>
			<p class="hint">With the Primary and Secondary picked in Place search. Nothing is saved.</p>
		</div>`;

	const keysBox = `
		<div class="segment c2 row2" id="saved-keys">
			<h2>Saved keys</h2>
			<p class="lede">
				For the place search services that need one. Kept by OmniCore and
				only ever sent to the service it belongs to. Once saved, a key
				isn't shown again.
			</p>
			<p class="hint" id="no-keys"${anySaved ? " hidden" : ""}>
				None yet. A service that needs a key asks for it when it's picked.
			</p>
			${keyRows}
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

			// Saved keys: a row for each one that's saved
			let any = false;
			for (const service of SERVICES) {
				const row = document.querySelector('[data-key-row="' + service.id + '"]');
				if (!row) continue;
				row.hidden = !service.keySaved;
				if (service.keySaved) any = true;
			}
			document.getElementById("no-keys").hidden = any;
		}

		function keyName(service) {
			return service.key === "username" ? "username" : "API key";
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

			const what = keyName(service);
			const yes = await confirmDialog({
				title: "Do you have a " + service.name + " " + what + "?",
				text: service.about,
				link: { text: "Get one from " + service.name, url: service.signUp },
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

		// Change: a new key in place of the saved one
		for (const button of document.querySelectorAll("[data-change-key]")) {
			button.addEventListener("click", async function () {
				const service = byId(button.dataset.changeKey);
				const key = await askDialog({
					title: "A new " + service.name + " " + keyName(service),
					text: "It replaces the one saved.",
					placeholder: service.key === "username" ? "Username" : "API key",
					secret: true,
					confirm: "Use it"
				});
				if (!key) return;
				const keys = {};
				keys[service.id] = key;
				save({ keys: keys });
			});
		}

		for (const button of document.querySelectorAll("[data-remove-key]")) {
			button.addEventListener("click", async function () {
				const service = byId(button.dataset.removeKey);
				const sure = await confirmDialog({
					title: "Remove the " + service.name + " " + keyName(service) + "?",
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

	return { placeBox, keysBox, tryBox, script };
}

// The routes that take a file as it is rather than JSON. See the JSON
// check in startAdminFace.
const RAW_UPLOADS = ["/background/upload", "/background/still"];

function startAdminFace() {
	const app = express();
	// The browser tab's icon (core/icon.js)
	attachIconRoute(app);

	// The network stream for the status drawer and the takeover (see
	// network-status.js). Before sign-in, so nothing stands in its way: the
	// takeover is for every screen, the sign-in page's too.
	require("./network-status").attach(app, "admin");
	// Manual Setup's page and routes, open only while the Wi-Fi is
	// disconnected (see network-setup.js)
	require("./network-setup").attach(app);

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

		// One line: the place's name, then its coordinates a little apart
		// in a quieter colour (no dash between them)
		const currentHtml = !settings.locationEnabled
			? "Location services are off."
			: current
			? escapeHtml(current.label || "Unnamed") +
			  `<span class="coords">${current.latitude.toFixed(3)}, ${current.longitude.toFixed(3)}</span>`
			: "No location available. Detection may have failed.";

		const manualLocation = settings.locationMode === "manual";
		// This browser's own choice: "light", "dark", or null when it
		// follows the device
		const uiMode = currentUiMode();
		const modeLabel = (mode, name) =>
			name + (uiMode === mode ? " (Active)" : "");

		// --- General --------------------------------------------------------

		// Location Service. "Set it myself" opens its boxes right here: a
		// search through the Place search setting, the place's name, and
		// its coordinates.
		const locationBox = `
			<div class="segment c4 row1">
				<h2>Location Service</h2>
				<p class="lede">
					Used by weather and prayer-time modules to know where
					you are. Turn it off and OmniCore never looks one up
					and never hands one out.
				</p>

				<label class="option spaced">
					<input type="checkbox" role="switch" id="enabled"
						${settings.locationEnabled ? "checked" : ""}>
					<span>Let OmniCore know where it is</span>
				</label>

				<div id="location-detail"${settings.locationEnabled ? "" : " hidden"}>
					<div class="tabs spaced" id="location-mode-tabs">
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
							<div class="inset-value" id="location-value">${currentHtml}</div>
						</div>
						<button class="glass" id="location-action"${manualLocation ? " hidden" : ""}>
							Refresh
						</button>
					</div>

					<div id="location-manual" class="location-manual"${manualLocation ? "" : " hidden"}>
						<div class="field">
							<label for="city">Search for a city</label>
							<div class="search-row">
								<input type="text" id="city" placeholder="Regina">
								<button class="glass medium"
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
						<div class="field pair">
							<div>
								<label for="latitude">Latitude</label>
								<input type="number" step="any" id="latitude"
									value="${escapeHtml(
										settings.latitude === null ? "" : settings.latitude
									)}">
							</div>
							<div>
								<label for="longitude">Longitude</label>
								<input type="number" step="any" id="longitude"
									value="${escapeHtml(
										settings.longitude === null ? "" : settings.longitude
									)}">
							</div>
						</div>
						<button class="glass medium" id="save-location">Save location</button>
						<p class="status" id="location-status"></p>
					</div>
				</div>
			</div>`;

		// Place search, all of it: the choice, the keys, the services
		const places = placeSearchPanel(settings);

		// --- Appearance -----------------------------------------------------

		const glassParts = backgroundPanel(settings);

		const modeBox = `
			<div class="segment c3 row2 lends-room">
				<div class="box-head">
					<h2>Appearance Mode</h2>
					${infoTip(
						"Saved in this browser only, so each screen can have its own. Device follows this device's own setting.",
						"About Appearance Mode"
					)}
				</div>
				<div class="mode-previews narrow-previews">
					<div class="mode-preview ${uiMode === "dark" ? "active" : ""}"
						data-mode="dark" role="button" tabindex="0">
						<div class="mode-screen dark">
							<span class="line head"></span>
							<span class="line"></span>
						</div>
						<div class="mode-preview-label">${modeLabel("dark", "Dark")}</div>
					</div>
					<div class="mode-preview ${uiMode === "light" ? "active" : ""}"
						data-mode="light" role="button" tabindex="0">
						<div class="mode-screen light">
							<span class="line head"></span>
							<span class="line"></span>
						</div>
						<div class="mode-preview-label">${modeLabel("light", "Light")}</div>
					</div>
					<div class="mode-preview ${uiMode ? "" : "active"}"
						data-mode="device" role="button" tabindex="0">
						<div class="mode-screen mode-screen-split">
							<div class="dark">
								<span class="line head"></span>
							</div>
							<div class="light">
								<span class="line head"></span>
							</div>
						</div>
						<div class="mode-preview-label">${modeLabel(null, "Device")}</div>
					</div>
				</div>
			</div>`;

		const textBox = `
			<div class="segment c3 row2 borrows-room">
				<div class="type-head">
					<div class="type-head-text">
						<h2>Typography</h2>
						<p class="hint">Dashboards are unaffected.</p>
					</div>
					<div class="stepper">
						<button type="button" class="glass" id="size-down"
							aria-label="Smaller">&#8722;</button>
						<input type="number" id="size" min="12" max="24" step="1"
							value="${Number(settings.uiFontSize) || 16}">
						<span class="muted">px</span>
						<button type="button" class="glass" id="size-up"
							aria-label="Larger">&#43;</button>
					</div>
				</div>
				<div class="type-row">
					${glassParts.fontColourField}
					<div class="inset">
						<div class="inset-text">
							<div class="inset-label">FONT</div>
							<div class="inset-value">${
								installedFont
									? escapeHtml(installedFont.family)
									: "System font"
							}</div>
						</div>
						<button class="glass" id="change-font">
							Change
						</button>
					</div>
				</div>
			</div>`;

		// --- Resources ------------------------------------------------------

		// In the order a phone held upright stacks them. On a wider screen
		// each has its own place (settings-home.js): Manage Faces wide at
		// the top, Network and Installed Resources side by side under it,
		// the Marketplace tall on the right.
		//
		// The Network box is a plain box saying why when OmniCore can't
		// change the Wi-Fi here (no Docker, no Wi-Fi tools, a Wi-Fi it
		// can't drive). Known at once, or found out once the page is open
		// (network-page.js, TILE_SCRIPT).
		const networkAbility = networkPage.ability();
		const networkTile =
			networkAbility && networkAbility.canChange === false
				? settingsHome.staticTileHtml("network", "Network", networkAbility.message, "c2 row2", 'data-tile="network"')
				: settingsHome.tileHtml("/network", "network", "Network", "The server's Wi&#8209;Fi, and the networks around", "c2 row2", 'data-tile="network"');
		const resourcesPane =
			networkTile +
			settingsHome.tileHtml("/faces", "faces", "Manage Faces", "Create, edit and remove dashboards", "c4 row1", 'data-tile="faces"') +
			settingsHome.tileHtml(
				"/installed",
				"installed",
				"Installed Resources",
				"What's installed, its versions, and what has an update waiting",
				"c2 row2",
				'data-tile="installed"'
			) +
			settingsHome.tileHtml("/marketplace", "marketplace", "Marketplace", "Modules and themes to install", "c2 r2", 'data-tile="marketplace" data-market-slides');

		// --- About ----------------------------------------------------------

		const updates = await updatesPanel();

		const body = settingsHome.homeHtml(
			{
				general: locationBox + places.placeBox + places.keysBox + places.tryBox,
				appearance: glassParts.glassBox + glassParts.backgroundBox + modeBox + textBox,
				resources: resourcesPane,
				about: updates.aboutBox + updates.updatesBox + updates.notesBox
			},
			updates.updateReady
		) + `
			${glassParts.backgroundModal}
			${updates.majorModal}
			<div class="modal-backdrop" id="font-modal" hidden>
				<div class="modal">
					<div class="modal-head">
						<h2>Choose a font</h2>
						<button class="modal-close" data-close="font-modal"
							aria-label="Close">&times;</button>
					</div>
					<p class="hint">
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
			settingsHome.MARKET_TILE_SCRIPT +
			networkPage.TILE_SCRIPT +
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
			// The OmniCore box opens System info (the About face). A real
			// address on the link, so it can be opened in a new tab too.
			const aboutLink = document.getElementById("about-link");
			aboutLink.href = faceUrl(1303);
			aboutLink.addEventListener("click", function (event) {
				if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
				event.preventDefault();
				omniGo(aboutLink.href);
			});

			// --- Location -------------------------------------------
			const enabled = document.getElementById("enabled");
			const detail = document.getElementById("location-detail");
			const manual = document.getElementById("location-manual");
			const action = document.getElementById("location-action");

			enabled.addEventListener("change", function () {
				detail.hidden = !this.checked;
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
						action.hidden = true;
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
			// (Only the Appearance Mode cards: the Font colour cards look
			// the same and have their own script)
			for (const preview of document.querySelectorAll(".mode-preview[data-mode]")) {
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

			for (const corner of document.querySelectorAll("#corner-tabs .tab-btn:not(.active)")) {
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
					return '<button type="button" class="font-row" onclick="pickFont(' +
						JSON.stringify(font.family).replace(/"/g, "&quot;") +
						')"><strong style="--sample-font:' +
						JSON.stringify(font.family).replace(/"/g, "&quot;") +
						'">' + safe + '</strong>' +
						'<span class="hint">' + font.category + '</span></button>';
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

			// --- A new major version (since 1.20.0) ------------------
			// The box opens what's changing. Upgrade can be pressed only
			// once it has loaded, this OmniCore can install it itself,
			// and the whole document has been scrolled through. Until
			// then it looks off and says why: on hover (its title), and
			// on a phone in a line under it.
			(function () {
				var box = document.getElementById("major-box");
				if (!box) return;

				var version = box.dataset.version;
				var doc = document.getElementById("major-doc");
				var upgrade = document.getElementById("major-upgrade");
				var why = document.getElementById("major-why");
				var loaded = false;
				var read = false;
				var offReason = "";
				var starting = false;

				function reason() {
					if (starting) return "Starting…";
					if (!loaded) return "Loading what's changing…";
					if (offReason) return offReason;
					if (!read) return "Scroll to the end to read it all first.";
					return "";
				}

				function refresh() {
					var why_ = reason();
					upgrade.setAttribute("aria-disabled", why_ ? "true" : "false");
					upgrade.classList.toggle("is-off", Boolean(why_));
					upgrade.title = why_;
					why.textContent = why_;
				}

				// At the end: within a few pixels of the bottom. A document
				// short enough to fit counts as read at once.
				function checkEnd() {
					if (loaded && doc.scrollHeight - doc.scrollTop - doc.clientHeight <= 4) {
						read = true;
						refresh();
					}
				}
				doc.addEventListener("scroll", checkEnd, { passive: true });

				async function load() {
					loaded = false;
					read = false;
					offReason = "";
					refresh();

					try {
						var response = await fetch("/updates/major", { headers: { Accept: "application/json" } });
						var answer = await response.json();
						if (!response.ok) throw new Error(answer.error || "Couldn't load it.");

						doc.innerHTML = answer.html;
						offReason = answer.offReason || "";
					} catch (error) {
						doc.innerHTML = '<p class="lede"></p>';
						doc.firstChild.textContent = "What's changing in " + version + " couldn't be loaded: " + error.message;
						offReason = "It can't be upgraded to before it's been read. Try again in a moment.";
					}

					loaded = true;
					doc.scrollTop = 0;
					refresh();
					requestAnimationFrame(checkEnd);
				}

				window.openMajor = function () {
					openModal("major-modal");
					load();
				};
				box.addEventListener("click", window.openMajor);

				upgrade.addEventListener("click", async function () {
					if (upgrade.getAttribute("aria-disabled") === "true") return;
					starting = true;
					refresh();

					try {
						var response = await fetch("/updates/major/apply", {
							method: "POST",
							headers: { "Content-Type": "application/json", Accept: "application/json" },
							body: JSON.stringify({ version: version })
						});
						var answer = await response.json().catch(function () { return {}; });
						if (!response.ok) throw new Error(answer.error || "It couldn't be started.");

						// The About tab's Updates box follows it from here,
						// through the restart: it picks up an update already
						// under way when the page opens
						closeModal("major-modal");
						location.hash = "about";
						location.reload();
					} catch (error) {
						starting = false;
						offReason = error.message;
						refresh();
					}
				});
			})();
		`;

		res.send(page("Settings", body, script, "settings-home", "/logout"));
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
	//                                worked out (its dominant and vibrant
	//                                colours, how dark and bright it is)
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

		// A new picture: the font colour is checked against it
		const changes = { ...result.changes, ...backdropStore.recheckFont({ ...readSettings(), ...result.changes }) };
		const saved = writeSettings(changes);

		// The one before it goes
		backdropStore.removeOthers([saved.backgroundFile, saved.backgroundStill]);
		res.json({ ok: true, kind: saved.backgroundKind });
	});

	app.post("/background/plain", (req, res) => {
		writeSettings(backdropStore.PLAIN);
		backdropStore.removeOthers([]);
		res.json({ ok: true });
	});

	// One colour behind the pages, picked on the colour wheel. The picture
	// before it, if there was one, goes.
	app.post("/background/colour", (req, res) => {
		const result = backdropStore.useColour((req.body || {}).color);
		if (result.error) {
			res.status(400).json(result);
			return;
		}
		// A new colour: the font colour is checked against it
		writeSettings({ ...result.changes, ...backdropStore.recheckFont({ ...readSettings(), ...result.changes }) });
		backdropStore.removeOthers([]);
		res.json({ ok: true, kind: "colour" });
	});

	// The glass changed. With `recheck` (anything but the font colour
	// itself was changed), the font colour is checked against it too, and
	// switched when the text couldn't be read otherwise. The page has
	// already shown the switch; this is what keeps it.
	app.post("/background/glass", (req, res) => {
		const changes = backdropStore.cleanGlass(req.body);
		if (req.body && req.body.recheck === true) {
			Object.assign(changes, backdropStore.recheckFont({ ...readSettings(), ...changes }));
		}
		const saved = writeSettings(changes);
		res.json({ ok: true, fontColour: backdropStore.fontOf(saved) });
	});

	// A picture picked by an earlier v2 build, before its vibrant colour
	// and overall brightness were worked out: the Appearance tab works
	// them out once and sends them here. Nothing else changes.
	app.post("/background/about", (req, res) => {
		if (!backdropStore.hasPicture(readSettings())) {
			res.status(400).json({ error: "There's no picture behind the pages." });
			return;
		}
		const result = backdropStore.aboutPicture(req.body);
		if (result.error) {
			res.status(400).json(result);
			return;
		}
		writeSettings(result.changes);
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
	// --- Pictures in the Marketplace (since 2.0.0) -----------------------
	//
	// A registry's banner and each entry's icon are addresses on somebody
	// else's server. The browser never gets them: each is remembered by the
	// image proxy under a short key, and the page asks OmniCore for
	// /marketplace/screenshot/<key> (the same route the screenshots have
	// always used), so a browser only ever talks to OmniCore.

	// A key for a picture: what it is, and a short fingerprint of where it
	// is, so the same picture keeps the same key
	function pictureKey(what, url) {
		const print = require("crypto").createHash("sha256").update(url).digest("hex").slice(0, 16);
		return `${what}:${print}`;
	}

	function pictureSrc(what, url) {
		const key = pictureKey(what, url);
		imageProxy.remember(key, url);
		return `/marketplace/screenshot/${encodeURIComponent(key)}`;
	}

	// A colour for a listing without an icon, always the same for the same
	// name, so it's recognisable from visit to visit
	function nameHue(name) {
		let hash = 0;
		for (const character of String(name)) hash = (hash * 31 + character.codePointAt(0)) % 360;
		return hash;
	}

	// A listing's icon, or a coloured tile with its first letter when it
	// has none (a registry from before icons) or its picture won't load
	// (the script below swaps it in then). `big` for a listing's own page.
	function marketIcon(entry, big) {
		const name = entry.name || entry.id || "?";
		const letter = escapeHtml((Array.from(String(name).trim())[0] || "?").toUpperCase());
		const size = big ? " big" : "";
		const initial = `<span class="market-icon market-initial${size}" style="--hue:${nameHue(name)}" aria-hidden="true">${letter}</span>`;

		if (!entry.icon) return initial;
		return `<img class="market-icon${size}" src="${pictureSrc("icon", entry.icon)}" alt="" ` +
			`loading="lazy" data-initial="${escapeHtml(initial)}">`;
	}

	// A picture that won't load (the address is wrong, the server is down,
	// it isn't an image) is replaced: an icon by its coloured letter, a
	// banner by nothing at all
	const marketPictureScript = `
		document.addEventListener("error", function (event) {
			var picture = event.target;
			if (!picture || picture.tagName !== "IMG") return;
			if (picture.classList.contains("market-icon") && picture.dataset.initial) {
				picture.outerHTML = picture.dataset.initial;
			} else if (picture.classList.contains("market-banner")) {
				var head = picture.closest(".has-banner");
				if (head) head.classList.remove("has-banner");
				picture.remove();
			} else if (picture.classList.contains("market-source-banner")) {
				picture.remove();
			}
		}, true);
	`;

	const marketPostScript = marketPictureScript + `
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
						${marketIcon(entry, false)}
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

		// The built-in registry's banner across the top, when it has one
		const builtIn = available && (available.sources || []).find((source) => source.builtIn);
		const banner = builtIn && builtIn.banner
			? `<img class="market-banner" src="${pictureSrc("banner", builtIn.banner)}" alt="">`
			: "";

		const body = `
			<div class="market">
				<div class="segment market-head${banner ? " has-banner" : ""}">
					${banner}
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

	app.get("/marketplace/sources", async (req, res) => {
		const settings = readSettings();
		const sources = Array.isArray(settings.registrySources)
			? settings.registrySources
			: [];

		// Each registry's banner beside its name, from the last time the
		// registries were read (a registry that can't be read has none)
		let read = [];
		try {
			read = await marketplace.registrySources();
		} catch (error) {
			read = [];
		}
		const bannerOf = (url, builtIn) => {
			const found = read.find((source) => (builtIn ? source.builtIn : source.url === url));
			return found && found.banner
				? `<img class="market-source-banner" src="${pictureSrc("banner", found.banner)}" alt="" loading="lazy">`
				: "";
		};

		// One line per registry: the built-in one first, which can't be
		// removed, then any the admin added
		const extraRows = sources
			.map(
				(url) => `
				<div class="market-source">
					<div class="market-source-name">
						${bannerOf(url, false)}
						<div class="market-url"><strong>${escapeHtml(url)}</strong></div>
					</div>
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
						<div class="market-source-name">
							${bannerOf(null, true)}
							<div>
								<strong>Omnia-Registry</strong>
								<div class="help">Built-in. Reviewed, and always included.</div>
							</div>
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
						can install it: someone actually read the code before it was
						listed. A third-party source has no such review. Anything
						listed there could be anything.
					</p>
					<p>
						A module is a full, unrestricted Node program. It can read
						every file this server can read, including your admin
						credentials, and reach the network however it likes. None
						of that is sandboxed, checked, or undone automatically once
						something is installed from it.
					</p>
					<p>
						<strong>If you don't personally, actually trust whoever runs
						this source (not "it looked fine"), don't add it.</strong>
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

		// The licence the author gave it (the registry entry's `license`, an
		// SPDX name such as MIT or GPL-3.0-only). A resource is its own work,
		// not part of OmniCore (LICENSING.md), so this is the author's say.
		// Older entries may not have one: they still install.
		const licence =
			typeof entry.license === "string" && entry.license.trim()
				? entry.license.trim().slice(0, 64)
				: "";

		const sourceSection = entry.repo
			? `
				<div class="segment">
					<h2>Source</h2>
					<p class="lede market-url">
						<a href="${escapeHtml(entry.repo)}">${escapeHtml(entry.repo)}</a>${entry.ref ? `, pinned at <code>${escapeHtml(String(entry.ref).slice(0, 10))}</code>` : ""}
					</p>
					<p class="lede market-licence">${
						licence ? `Licence: <code>${escapeHtml(licence)}</code>` : "No licence stated"
					}</p>
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
					${marketIcon(entry, true)}
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
		// It's somebody else's file served from OmniCore's own address.
		// The browser must take it as the picture it says it is, and an
		// SVG opened on its own can't run anything as OmniCore.
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
		res.end(image.body);
	});

	// The registries' banners, for the Marketplace tile on the Settings
	// home: the built-in registry's first, then the added ones'. Asked for
	// by the page once it's open, so a slow registry never holds Settings
	// up. Nothing (an empty list) when there are none or none can be read.
	app.get("/marketplace/banners", async (req, res) => {
		let sources = [];
		try {
			sources = await marketplace.registrySources();
		} catch (error) {
			sources = [];
		}
		res.setHeader("Cache-Control", "no-store");
		res.json(
			sources
				.filter((source) => source.banner)
				.map((source) => ({ src: pictureSrc("banner", source.banner) }))
		);
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
				updateAvailable: status.updateAvailable,
				nextMajor: status.nextMajor
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

	// --- A new major version (since 1.20.0) ------------------------------
	//
	// What the settings home's pop-up shows: the major version's own
	// document (docs/upgrades/<version>.md at its tag, see
	// upgrade-notes.js), then a closing part of OmniCore's own saying what
	// happens to the data and to docker-compose.yml. Read all the way down
	// before Upgrade can be pressed.
	//
	// { version, html, offReason }: offReason is why Upgrade can't be
	// pressed here at all (no Docker, a development build, nothing to read),
	// or null.
	// Network Management (since 2.0.0): what the host's network looks like,
	// read by a short-lived helper on the host's network
	// (core/network-helper.js). Read-only: nothing here changes anything.
	// ?raw=1 adds exactly what the helper printed, for working out why a
	// server's Wi-Fi isn't read as expected; it holds network names and
	// the commands that run them, never a password.
	app.get("/network/probe", async (req, res) => {
		const raw = req.query.raw === "1";
		const result = await networkHelper.probe({ fresh: raw || req.query.fresh === "1", raw });
		res.setHeader("Cache-Control", "no-store");
		res.json(result);
	});

	// The Network page, from the Network box on the Resources tab: the
	// server's Wi-Fi on a normal day (see network-page.js)
	networkPage.attach(app, { page });

	app.get("/updates/major", async (req, res) => {
		const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
		const next = updateStore.lastResult(running).nextMajor;

		if (!next) {
			res.status(404).json({ error: "There's no new major version to upgrade to." });
			return;
		}

		const [notes, readiness] = await Promise.all([
			upgradeNotes.fetchUpgradeNotes(next),
			coreUpdater.applyReadiness()
		]);
		const compose = readiness.ready ? await coreUpdater.checkComposeFile(next) : { state: "unknown" };

		const ours = [`<h3>Before ${escapeHtml(next)} starts</h3>`];
		ours.push(
			`<p>OmniCore copies your data to <code>data/backups/before-${escapeHtml(next)}</code> first. ` +
				`If ${escapeHtml(next)} doesn't start properly, the version you have now comes back on its own, ` +
				`with that copy of your data.</p>`
		);
		if (compose.state === "ready") {
			ours.push(
				`<p>Once ${escapeHtml(next)} is running, OmniCore changes one line in <code>${escapeHtml(compose.file)}</code>, ` +
					`<code>${escapeHtml(compose.from)}</code> to <code>${escapeHtml(compose.to)}</code>, so Docker Compose keeps the new version. ` +
					`A copy of the file is kept beside it. You don't need to change anything.</p>`
			);
		} else if (compose.state === "manual") {
			ours.push(
				`<p><strong>One thing to do by hand, this time only.</strong> OmniCore can't reach <code>${escapeHtml(compose.file)}</code> ` +
					`to keep it in step, so after upgrading, change <code>${escapeHtml(compose.from)}</code> to ` +
					`<code>${escapeHtml(compose.to)}</code> in it. Until then, <code>docker compose up -d</code> would start the old version again, ` +
					`which won't start on data ${escapeHtml(next)} has brought up to date.</p>`
			);
		}

		const offReason = !notes
			? `What's changing in ${next} couldn't be loaded from GitHub. Try again in a moment.`
			: omnicoreVersion.isDevBuild()
			? "This is a development build, which doesn't update itself."
			: !readiness.ready
			? "Updates are turned off on this install: OmniCore has no access to Docker, so it can't install a new version itself."
			: null;

		res.setHeader("Cache-Control", "no-store");
		res.json({
			version: next,
			html: (notes ? notes.html : `<p class="lede">${escapeHtml(offReason)}</p>`) +
				`<div class="major-ours">${ours.join("")}</div>`,
			offReason
		});
	});

	// Upgrade. Like Update now: starts it and answers straight away, and
	// the Updates page follows it. Only the major version the settings home
	// offered, and only where this OmniCore can install it itself.
	app.post("/updates/major/apply", async (req, res) => {
		const running = (process.env.OMNICORE_VERSION || "dev").replace(/^v/, "");
		const next = updateStore.lastResult(running).nextMajor;
		const asked = String((req.body && req.body.version) || "");

		if (!next || asked !== next) {
			res.status(409).json({ error: "That isn't the major version on offer. Reload Settings." });
			return;
		}

		const readiness = await coreUpdater.applyReadiness();
		if (!readiness.ready) {
			res.status(409).json({ error: readiness.reason });
			return;
		}

		if (coreUpdater.currentProgress().busy) {
			res.status(409).json({ busy: true, error: "An update is already being installed." });
			return;
		}

		coreUpdater
			.applyMajorUpgrade(next)
			.then((result) => {
				if (result.updated) {
					console.log(`  Upgrade to ${next} started from Settings. What happened next: ${result.log}`);
				} else {
					console.log(`  Upgrade to ${next}: ${result.reason}`);
				}
			})
			.catch((error) => {
				console.log(`  Upgrade to ${next} failed: ${error.message}`);
			});

		res.status(202).json({ ok: true });
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
					<div class="segment-actions">
						<button class="glass glass-block" id="check">Check now</button>
						<p class="status" id="check-status"></p>
						<a class="glass glass-block" href="/marketplace">Go to Marketplace</a>
					</div>
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
				<a class="row glass" href="/faces/${face.id}">
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
							<a class="row glass" href="/faces/${face.id}/modules">
								<strong>Widgets</strong>
								<span>${count ? count + (count === 1 ? " widget" : " widgets") : "None added yet"}</span>
							</a>
							<a class="row glass" href="/faces/${face.id}/theme">
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
								<div class="mode-screen note-dark">
									<span class="line head"></span>
									<span class="line"></span>
									<span class="line mid"></span>
								</div>
								<div class="mode-preview-label">Dark${noteLight ? "" : " (Active)"}</div>
							</div>
							<div class="mode-preview note-mode ${noteLight ? "active" : ""}"
								data-note-mode="light" role="button" tabindex="0">
								<div class="mode-screen note-light">
									<span class="line head"></span>
									<span class="line"></span>
									<span class="line mid"></span>
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
					<p class="lede">${escapeHtml(
						face.theme
							? manifest.description || "The theme this face is using"
							: "This face hasn't been given a theme yet, so its screen shows OmniCore's own page"
					)}</p>
					<a class="row glass" href="/faces/${face.id}/theme/change">
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
				<a class="row glass" href="#" data-theme="${escapeHtml(theme.id)}">
					<strong>${escapeHtml(theme.name)}${current ? " · in use" : ""}</strong>
					<span>${escapeHtml(theme.description || theme.id)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>Change theme</h1>
					<p class="lede">
						Settings you've already made are kept per theme, so
						switching back later restores them.
					</p>
					<div class="list">
						${themes || '<div class="empty">No themes installed.</div>'}
					</div>
					<p class="status" id="status"></p>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/marketplace">
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
				<a class="row glass" href="/faces/${face.id}/modules/${encodeURIComponent(instance.id)}">
					<strong>${escapeHtml(labels[instance.id])}</strong>
					<span>${escapeHtml(kind)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1 class="spaced">Modules</h1>
					<div class="list">
						${instances || '<div class="empty">No modules on this face yet.</div>'}
					</div>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/faces/${face.id}/modules/add">
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

		// Installed modules, then the widgets built into OmniCore
		const modules = listAvailable()
			.map((moduleId) => {
				const manifest = readManifest(moduleId);

				return `
				<a class="row glass" href="#" onclick="addModule('${escapeHtml(moduleId)}'); return false;">
					<strong>${escapeHtml(manifest.name)}</strong>
					<span>${escapeHtml(manifest.description || moduleId)}</span>
				</a>`;
			})
			.join("");

		const body = `
			<div class="bento">
				<div class="segment">
					<h1>Add a module</h1>
					<p class="lede">You can add the same module more than once.</p>
					<div class="list">
						${modules || '<div class="empty">No modules installed.</div>'}
					</div>
					<p class="status" id="status"></p>
				</div>
				<div class="segment">
					<a class="glass glass-block" href="/marketplace">
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

		if (!listAvailable().includes(moduleId)) {
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
						<h2 class="spaced">Settings</h2>
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
					<p class="lede">${escapeHtml(
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
			${schema.some((field) => field.type === "wifi-add") ? networkPage.ADD_NETWORK_SCRIPT : ""}

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