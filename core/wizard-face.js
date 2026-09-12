// core/wizard-face.js
// The setup wizard, on port 3999.
//
// This used to live on 4000 alongside the face picker. It was split out
// so that 4000 could become a pure picker with no ability to create or
// change anything, which makes it safe to leave open on a wall display
// or point OmniView at. Anything that builds a face now lives here,
// reached from the admin face's own settings.
//
// The wizard holds everything in the browser and only commits at
// "Finish". Nothing is written along the way, so Cancel leaves no
// half-configured modules behind on a face that might be live on a
// display.
//
// This is the SETUP path. Changing one setting later is done in the
// admin face, which edits directly -- a wizard is good at setting
// things up and bad at changing one thing afterwards.
//
// STYLING: deliberately still its own stylesheet rather than the shared
// Default UI in ui-theme.js. The wizard has a two-segment layout unlike
// anything else in OmniCore, and rebuilding it on the shared components
// is its own task; this split is about routing, not appearance. It
// looks exactly as it did on 4000. See
// docs/planning/default-ui-architecture.md.

const express = require("express");
const faceStore = require("./face-store");
const { startFace } = require("./face-loader");
const { startInputFace } = require("./input-face-loader");
const themeLoader = require("./theme-loader");
const { listModules } = require("./module-loader");
const { readManifest, readSchema, applyDefaults } = require("./module-config");
const { searchCities } = require("./location-service");
const { portLinkScript, escapeHtml, WIZARD_PORT } = require("./face-links");
const { uiStyles } = require("./ui-theme");

// Only what's specific to the wizard. Everything else — glass buttons,
// cards, inputs, the colour variables, the dock, the lists — comes from
// the shared Default UI in ui-theme.js, which this is layered on top of.
//
// This file used to carry its own complete stylesheet, a copy made back
// when the wizard was split off port 4000. That was always meant to be
// temporary: the comment at the top of this file called rebuilding it
// on the shared components "its own task". This is that task. The
// duplicate was also actively causing bugs — a stale .glass copy in
// admin-face.js, the same kind of leftover, silently overrode the real
// one and forced every button to full width.
const styles = `
	/* The page is exactly the height of the window and never scrolls
	   itself -- scrolling happens inside whichever region actually has
	   too much content. Set here unconditionally rather than added by
	   JavaScript once a step renders: a height that only appears after
	   the first paint means everything sized against it collapses to
	   nothing until then, which is exactly what happened when this was
	   applied by a class from draw(). */
	html, body { height: 100%; }

	body {
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
	   step is a workspace and should fill the screen, a single tile is
	   a form and should be only as tall as it needs. */
	#content {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: stretch;
	}

	/* A split step needs #content to claim all the leftover space, since
	   that's where its real height comes from. A single tile opting out
	   of the stretch above wasn't enough on its own -- #content itself
	   was still claiming that space regardless, just leaving the dead
	   gap below the tile instead of inside it. This makes #content
	   itself stop claiming space it has nothing to fill it with,
	   whenever what's actually inside it is a single tile. */
	#content:has(> .wizard-single) {
		flex: 0 1 auto;
	}

	/* One tile, for the steps that only have one thing to show. It
	   scrolls inside itself rather than growing the page, the same as
	   the split steps do -- a long theme form or review list was
	   previously the one thing that could still push the whole page
	   taller and slide underneath the dock. */
	.wizard-single {
		width: 100%;
		max-width: clamp(28em, 50vw, 40em);
		/* Opts out of #content's stretch: a form should be as tall as
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
		border-radius: 4px;
	}

	/* ---------------------------------------------------------------
	   The two-tile steps.

	   Unlike the settings bento, where tiles size to their own content
	   and the page scrolls past them, these fill the screen: a wizard
	   step is one task to focus on now, not a page to scan. Each half
	   takes an equal share of whatever space there is and stretches to
	   fill it, so the lists inside them can do the same.

	   Which way they divide follows the screen's own shape rather than
	   a pixel threshold, for the same reason everywhere else does: a
	   phone can report more CSS pixels than an older monitor, so any
	   fixed number misjudges real devices in both directions.
	   --------------------------------------------------------------- */
	/* Stays stretched by #content, which is what gives the tiles and
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

	.wizard-split > .tile {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.tile {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius);
		padding: 20px;
	}

	.tile h2 {
		margin: 0 0 14px 0;
		font-weight: 400;
		font-size: 0.95em;
		color: var(--fg-muted);
	}

	/* The settings form inside a split step scrolls on its own too,
	   rather than growing its tile past the screen */
	.tile-scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.4em;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.tile-scroll::-webkit-scrollbar { width: 8px; }
	.tile-scroll::-webkit-scrollbar-track { background: transparent; }
	.tile-scroll::-webkit-scrollbar-thumb {
		background: var(--scroll-thumb);
		border-radius: 4px;
	}

	/* A module in the picker, and a module already added. Same shape on
	   purpose — it's the same thing, on two sides of one decision. */
	.flat,
	.picked {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--fg);
		font-size: 0.95em;
		font-family: inherit;
		padding: 12px 16px;
		flex-shrink: 0;
	}

	.flat { cursor: pointer; transition: background 0.15s ease; }
	.flat:hover { background: var(--glass-bg); }

	.flat small,
	.picked small {
		display: block;
		color: var(--fg-muted);
		font-size: 0.8em;
		margin-top: 3px;
	}

	/* Removing is destructive, so it says so on hover rather than
	   looking like every other clickable row */
	.picked.removable { cursor: pointer; transition: background 0.15s ease; }
	.picked.removable:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
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
		padding: 11px 0;
		border-bottom: 1px solid var(--card-border);
		font-size: 0.95em;
	}

	.review-row span { color: var(--fg-muted); }

	/* A reorderable priority list */
	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--card-border);
		border-radius: 10px;
		margin-bottom: 8px;
		font-size: 0.95em;
	}

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
		flex: none;
		font-size: 0.85em;
		line-height: 1;
		cursor: pointer;
		color: inherit;
		border-radius: 8px;
		border: 1px solid var(--card-border);
		background: var(--glass-bg);
	}

	.priority-move:hover:not(:disabled) { background: var(--glass-bg-hover); }
	.priority-move:disabled { opacity: 0.2; cursor: default; }
`;


function page(title, body, script) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} \u2014 OmniCore</title>
	<style>${uiStyles()}${styles}</style>
</head>
<body>
	${body}
	<script>${script || ""}</script>
</body>
</html>`;
}

function startWizardFace() {
	const app = express();
	app.use(express.json());

	app.post("/faces", async (req, res) => {
		const { name, title, theme, instances, themeConfig } = req.body;

		// A face cannot exist without a theme
		if (!theme) {
			res.status(400).json({ error: "A theme is required" });
			return;
		}

		const installed = listModules();

		const wanted = (instances || []).filter((instance) =>
			// Ignore anything referring to a module that isn't installed
			installed.includes(instance.module)
		);

		const face = faceStore.createFace(
			name,
			title,
			theme,
			wanted.map((instance) => ({
				...instance,
				// The theme's settings for this instance, under the theme's
				// own key — separate from the module's own config
				themeConfigs: {
					[theme]: themeLoader.cleanInstanceConfig(
						theme,
						instance.themeConfig
					)
				}
			}))
		);

		// Theme settings, if the theme declared any and the wizard collected
		// them. Stored against the theme so switching back keeps them.
		if (themeConfig) {
			const clean = themeLoader.cleanConfig(theme, themeConfig);

			// During the wizard an instance doesn't have an ID yet — it only
			// gets one when the face is written. So a setting that names an
			// instance refers to it by position, and we translate that into
			// the real ID now that they exist.
			for (const field of themeLoader.readSchema(theme)) {
				if (field.type !== "instance") continue;

				const match = /^wizard-instance-(\d+)$/.exec(clean[field.key] || "");
				const instance = match && face.instances[Number(match[1])];

				clean[field.key] = instance ? instance.id : "";
			}

			faceStore.updateThemeConfig(face.id, theme, clean);
			face.themeConfigs = { [theme]: clean };
		}

		// Wait until the face's server is genuinely accepting connections
		// before responding, so the browser never redirects too early
		await startFace(face);

		// The wizard can bundle instances straight in at creation — any
		// of them with an input.json gets its own tiny server too, same
		// as one added later through the admin face.
		for (const instance of face.instances) {
			await startInputFace(face.id, instance);
		}

		res.json(face);
	});

	// City lookup for the location fields. Goes through OmniCore rather
	// than letting the browser call out directly, so the only thing talking
	// to the outside world is the server.
	app.get("/geocode", async (req, res) => {
		res.json(await searchCities(req.query.q || ""));
	});

	// The setup wizard
	app.get("/faces/new", (req, res) => {
		// Everything the wizard needs, handed over up front so it can run
		// entirely in the browser without saving anything as it goes
		const modules = listModules().map((moduleId) => {
			const manifest = readManifest(moduleId);

			return {
				id: moduleId,
				name: manifest.name,
				description: manifest.description,
				// What block types this module can emit, so a field asking
				// for one only offers modules that could supply it
				provides: manifest.provides || [],
				// Whether this module wants a tile by default
				tile: manifest.tile !== false,
				schema: readSchema(moduleId),
				defaults: applyDefaults(moduleId, {})
			};
		});

		res.send(
			renderWizard({
				modules: modules,
				// Themes carry their settings schema so the wizard can offer
				// a configuration step without another round trip
				themes: themeLoader.listThemes().map((theme) => ({
					...theme,
					schema: themeLoader.readSchema(theme.id),
					defaults: themeLoader.applyDefaults(theme.id, {}),
					// What this theme wants configured for each instance —
					// its size, usually. Empty when the theme sizes things
					// for itself.
					instanceSchema: themeLoader.readInstanceSchema(theme.id),
					// Two sets of defaults: one for a module that wants a
					// tile, one for a module that works behind the scenes.
					// The theme decides what "behind the scenes" means in its
					// own vocabulary.
					instanceDefaults: themeLoader.instanceDefaults(theme.id, true),
					hiddenDefaults: themeLoader.instanceDefaults(theme.id, false)
				})),
				// What port this face WOULD get. Accurate unless two faces
				// are being created at the same moment.
				nextPort: faceStore.nextDashboardPort()
			})
		);
	});

	app.listen(WIZARD_PORT, () => {
		console.log(`Setup wizard listening on port ${WIZARD_PORT}`);
	});
}

function renderWizard(data) {
	const body = `
		<div class="wizard-head" id="header"></div>
		<div id="content"></div>
		<p class="status" id="status"></p>

		<!-- Back is rendered but hidden on the first step rather than
		     shown disabled: a dead segment taking up room in a capsule
		     that never resizes would leave a visible gap where a button
		     should be. Hidden, the remaining two simply spread to fill
		     the same shape. -->
		<div class="dock">
			<button id="cancel">Cancel</button>
			<button id="back">Back</button>
			<button id="next">Next</button>
		</div>`;

	const script = `
		${portLinkScript}

		const MODULES = ${JSON.stringify(data.modules)};
		const THEMES = ${JSON.stringify(data.themes)};
		const NEXT_PORT = ${data.nextPort};

		// Everything the wizard is building, held here and only sent to the
		// server at Finish. Cancel simply throws this away.
		const face = { name: "", title: "", theme: null, instances: [], themeConfig: {} };

		function selectedTheme() {
			return THEMES.find(function (t) { return t.id === face.theme; });
		}

		// The theme step only exists if the theme actually has settings
		function hasThemeStep() {
			const theme = selectedTheme();
			return Boolean(theme && theme.schema && theme.schema.length);
		}

		function themeStep() {
			return 2 + face.instances.length;
		}

		// step 0        name and theme
		// step 1        pick modules
		// step 2..n+1   one settings page per picked module
		// step n+2      review
		let step = 0;

		// step 0            name, title, theme
		// step 1            pick modules
		// step 2..n+1       one settings page per picked module
		// step n+2          theme settings, if the theme has any
		// last              review
		function lastStep() {
			return face.instances.length + 2 + (hasThemeStep() ? 1 : 0);
		}

		function moduleById(id) {
			return MODULES.find(function (m) { return m.id === id; });
		}

		function escapeHtml(text) {
			return String(text).replace(/[&<>"]/g, function (c) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
			});
		}

		// ---- reading the current step's inputs back into "face" ----

		function captureStep() {
			if (step === 0) {
				const nameField = document.getElementById("name");
				if (nameField) face.name = nameField.value.trim();

				const titleField = document.getElementById("title");
				if (titleField) face.title = titleField.value.trim();

				const chosen = document.querySelector('input[name="theme"]:checked');
				face.theme = chosen ? chosen.value : face.theme;
				return;
			}

			// The theme settings step
			if (hasThemeStep() && step === themeStep()) {
				for (const input of document.querySelectorAll("[data-key]")) {
					face.themeConfig[input.dataset.key] =
						input.dataset.type === "boolean" ? input.checked : input.value;
				}
				return;
			}

			if (step >= 2 && step < themeStep()) {
				const instance = face.instances[step - 2];
				if (!instance) return;

				const labelField = document.getElementById("label");
				if (labelField) instance.label = labelField.value.trim();

				if (!instance.themeConfig) instance.themeConfig = {};

				// Two authors on one form — the module and the theme. Keep
				// their values apart; they're stored apart.
				for (const input of document.querySelectorAll("[data-key]")) {
					const target =
						input.dataset.scope === "theme"
							? instance.themeConfig
							: instance.config;

					target[input.dataset.key] =
						input.dataset.type === "boolean" ? input.checked : input.value;
				}

				// Location fields are a radio pair plus optional coordinates
				const seen = {};
				for (const radio of document.querySelectorAll("[data-loc]")) {
					const key = radio.dataset.loc;
					if (seen[key] || !radio.checked) continue;
					seen[key] = true;

					instance.config[key] = radio.value === "manual"
						? {
							mode: "manual",
							latitude: document.querySelector('[data-loc-lat="' + key + '"]').value,
							longitude: document.querySelector('[data-loc-lon="' + key + '"]').value
						}
						: { mode: "core" };
				}
			}
		}

		// ---- the steps ----

		function renderNameStep() {
			const themes = THEMES.map(function (theme) {
				return '<label class="option">' +
					'<input type="radio" name="theme" value="' + escapeHtml(theme.id) + '"' +
					(face.theme === theme.id ? " checked" : "") + ">" +
					"<span>" + escapeHtml(theme.name) + "</span>" +
				"</label>";
			}).join("");

			return '<div class="tile wizard-single">' +
				'<div class="field">' +
					'<label for="name">Name</label>' +
					'<input type="text" id="name" value="' + escapeHtml(face.name) +
						'" placeholder="Face ' + NEXT_PORT + '">' +
					'<div class="help">How you recognise this face in settings. ' +
						'Leave it blank and it will be called Face ' + NEXT_PORT +
						".</div>" +
				"</div>" +
				'<div class="field">' +
					'<label for="title">Title</label>' +
					'<input type="text" id="title" value="' + escapeHtml(face.title) +
						'" placeholder="Optional">' +
					'<div class="help">Shown on the dashboard itself, if the ' +
						"theme displays one. Leave it blank for no heading.</div>" +
				"</div>" +
				'<div class="field">' +
					"<h2>Theme</h2>" +
					// OmniCore ships bare, so an install with no themes yet
					// is the normal first run — not a fault. Say where
					// they come from rather than leaving a dead end: a
					// face can't be created without one.
					(themes || '<div class="empty">' +
						"No themes installed yet. Open the admin face on " +
						"port 3000 and go to Marketplace to install one, " +
						"then come back here." +
					"</div>") +
				"</div>" +
			"</div>";
		}

		function renderPickStep() {
			const available = MODULES.map(function (module) {
				return '<button class="flat" onclick="addInstance(\\'' +
					module.id + '\\')">' +
					escapeHtml(module.name) +
					"<small>" + escapeHtml(module.description || module.id) + "</small>" +
				"</button>";
			}).join("");

			const picked = face.instances.map(function (instance, index) {
				return '<div class="picked removable" onclick="removeInstance(' +
					index + ')">' +
					escapeHtml(instance.label) +
					"<small>" + escapeHtml(moduleById(instance.module).name) +
						" · click to remove</small>" +
				"</div>";
			}).join("");

			// Each list gets .list-fill so it grows into whatever height
			// its tile was given and only scrolls once it genuinely runs
			// out -- rather than the old .square, which had no bound at
			// all and simply grew the page instead.
			return '<div class="wizard-split">' +
				'<div class="tile">' +
					"<h2>Available modules</h2>" +
					'<div class="list-fill">' +
						(available || '<div class="empty">No modules installed.</div>') +
					"</div>" +
				"</div>" +
				'<div class="tile">' +
					"<h2>On this face</h2>" +
					'<div class="list-fill">' +
						(picked || '<div class="empty">Nothing added yet.</div>') +
					"</div>" +
				"</div>" +
			"</div>";
		}

		function renderSettingsStep() {
			const index = step - 2;
			const instance = face.instances[index];
			const module = moduleById(instance.module);

			// The bucket moves to the left and loses its remove behaviour;
			// the one being configured is highlighted
			const bucket = face.instances.map(function (item, itemIndex) {
				return '<div class="picked' +
					(itemIndex === index ? " current" : "") + '">' +
					escapeHtml(item.label) +
					"<small>" + escapeHtml(moduleById(item.module).name) + "</small>" +
				"</div>";
			}).join("");

			const fields = module.schema.map(function (field) {
				return renderField(field, instance.config[field.key], "module");
			}).join("");

			// The chosen theme may want this instance sized. Those fields
			// come from the THEME, not the module, and are kept apart.
			const theme = selectedTheme();
			const themeSchema = (theme && theme.instanceSchema) || [];

			const themeFields = themeSchema.map(function (field) {
				return renderField(
					field,
					(instance.themeConfig || {})[field.key],
					"theme"
				);
			}).join("");

			return '<div class="wizard-split">' +
				'<div class="tile">' +
					"<h2>On this face</h2>" +
					'<div class="list-fill">' + bucket + "</div>" +
				"</div>" +
				'<div class="tile">' +
					"<h2>" + escapeHtml(module.name) + "</h2>" +
					// The form scrolls inside its own tile rather than
					// growing it past the bottom of the screen, the same
					// way the list opposite does.
					'<div class="tile-scroll">' +
						'<div class="field">' +
							'<label for="label">Label</label>' +
							'<input type="text" id="label" value="' +
								escapeHtml(instance.label) + '">' +
							'<div class="help">Shown as the tile title.</div>' +
						"</div>" +
						(fields || '<div class="empty">Nothing to configure.</div>') +
						(themeFields
							? '<h2 style="margin-top:22px">In ' +
								escapeHtml(theme.name) + "</h2>" + themeFields
							: "") +
					"</div>" +
				"</div>" +
			"</div>";
		}

		// A priority value can reach here in two shapes. Fresh from the
		// server it's a real array, already reconciled against what the
		// module declares. Once this step has been filled in and left, it's
		// the JSON string the hidden input held. Accept both, and fall back
		// to the declared order if it's neither.
		function priorityOrder(value, options) {
			const declared = options || [];
			let stored = value;

			if (typeof stored === "string") {
				try {
					stored = JSON.parse(stored);
				} catch (error) {
					stored = [];
				}
			}

			if (!Array.isArray(stored)) stored = [];

			const kept = [];

			for (const item of stored) {
				if (declared.indexOf(item) >= 0 && kept.indexOf(item) === -1) {
					kept.push(item);
				}
			}

			for (const item of declared) {
				if (kept.indexOf(item) === -1) kept.push(item);
			}

			return kept;
		}

		// Rewrite the hidden input a priority list is stored in, and keep
		// the numbering and the disabled arrows honest
		function syncPriority(container) {
			const rows = Array.prototype.slice.call(
				container.querySelectorAll("[data-priority-item]")
			);
			const store = container.querySelector("[data-type='priority']");

			if (store) {
				store.value = JSON.stringify(rows.map(function (row) {
					return row.dataset.priorityItem;
				}));
			}

			rows.forEach(function (row, index) {
				const rank = row.querySelector("[data-priority-rank]");
				if (rank) rank.textContent = index + 1;

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

		// One listener for every list on the page. The wizard rebuilds its
		// form on each step, so delegation is what keeps this working —
		// per-button listeners would be thrown away on the next render.
		document.addEventListener("click", function (event) {
			const button = event.target.closest("[data-priority-move]");
			if (!button) return;

			event.preventDefault();

			const container = button.closest("[data-priority]");
			const row = button.closest("[data-priority-item]");
			const rows = Array.prototype.slice.call(
				container.querySelectorAll("[data-priority-item]")
			);
			const index = rows.indexOf(row);
			const target =
				button.dataset.priorityMove === "up" ? index - 1 : index + 1;

			if (target < 0 || target >= rows.length) return;

			if (target < index) {
				container.insertBefore(row, rows[target]);
			} else {
				container.insertBefore(rows[target], row);
			}

			syncPriority(container);
		});

		// One settings field. Shared by the module step and the theme step,
		// so both look identical — which is the point of declaring settings
		// rather than shipping a form.
		function renderField(field, value, scope) {
			const owner = scope || "module";
			{
				// A theme naming an instance is a placement decision — which
				// module should feed something like a wallpaper
				if (field.type === "color") {
					return wrapField(field,
						'<input type="color" data-key="' + escapeHtml(field.key) +
						'" data-scope="' + owner + '" data-type="color" value="' +
						escapeHtml(value || "#000000") + '">' +
						(field.help ? '<div class="help">' + escapeHtml(field.help) + "</div>" : "")
					);
				}

				if (field.type === "instance") {
					// Only modules that declared they can produce what the
					// field asks for are offered
					const options = face.instances.map(function (instance, index) {
						const module = moduleById(instance.module);

						if (field.provides &&
							(module.provides || []).indexOf(field.provides) === -1) {
							return "";
						}

						const id = "wizard-instance-" + index;
						return '<option value="' + escapeHtml(id) + '"' +
							(id === value ? " selected" : "") + ">" +
							escapeHtml(instance.label || instance.module) + "</option>";
					}).join("");

					return wrapField(field,
						'<select data-key="' + escapeHtml(field.key) +
							'" data-scope="' + owner + '" data-type="instance">' +
							'<option value=""' + (value ? "" : " selected") + ">None</option>" +
							options +
						"</select>" +
						(field.help ? '<div class="help">' + escapeHtml(field.help) + "</div>" : "")
					);
				}

				const help = field.help
					? '<div class="help">' + escapeHtml(field.help) + "</div>"
					: "";

				let input;

				if (field.type === "location") {
					// Either lean on OmniCore's location, or give this
					// instance coordinates of its own
					const stored = value || { mode: "core" };
					const manual = stored.mode === "manual";
					const key = escapeHtml(field.key);

					input =
						'<label class="option">' +
							'<input type="radio" name="loc-' + key + '" data-loc="' + key +
								'" value="core"' + (manual ? "" : " checked") + ">" +
							"<span>Use OmniCore's location</span>" +
						"</label>" +
						'<label class="option">' +
							'<input type="radio" name="loc-' + key + '" data-loc="' + key +
								'" value="manual"' + (manual ? " checked" : "") + ">" +
							"<span>Set coordinates here</span>" +
						"</label>" +
						'<div data-loc-fields="' + key + '" style="' +
							(manual ? "" : "display:none") + ';margin-top:10px">' +
							'<div class="field"><label>Search for a city</label>' +
								'<div class="search-row">' +
									'<input type="text" data-loc-query="' + key +
										'" placeholder="Regina">' +
									'<button class="glass" style="padding:12px 20px" ' +
										'data-loc-search="' + key + '">Search</button>' +
								"</div>" +
								'<div data-loc-results="' + key + '"></div>' +
							"</div>" +
							'<div class="field"><label>Latitude</label>' +
								'<input type="number" step="any" data-loc-lat="' + key +
								'" value="' + escapeHtml(
									manual && stored.latitude !== undefined ? stored.latitude : ""
								) + '"></div>' +
							'<div class="field"><label>Longitude</label>' +
								'<input type="number" step="any" data-loc-lon="' + key +
								'" value="' + escapeHtml(
									manual && stored.longitude !== undefined ? stored.longitude : ""
								) + '"></div>' +
						"</div>";
				} else if (field.type === "priority") {
					// What matters most to this user. The top item survives
					// the smallest tile; the rest appear as it gets bigger.
					const order = priorityOrder(value, field.options);

					const rows = order.map(function (item, index) {
						return '<div class="priority-row" data-priority-item="' +
							escapeHtml(item) + '">' +
							'<span class="priority-rank" data-priority-rank>' +
								(index + 1) + "</span>" +
							'<span class="priority-name">' + escapeHtml(item) + "</span>" +
							'<button type="button" class="priority-move" ' +
								'data-priority-move="up" title="Move up">↑</button>' +
							'<button type="button" class="priority-move" ' +
								'data-priority-move="down" title="Move down">↓</button>' +
						"</div>";
					}).join("");

					// The order lives in a hidden input so the step's collect
					// loop reads it like any other field — off .value
					input = '<div data-priority>' +
						'<input type="hidden" data-key="' + escapeHtml(field.key) +
							'" data-scope="' + owner + '" data-type="priority" value="' +
							escapeHtml(JSON.stringify(order)) + '">' +
						rows +
					"</div>";
				} else if (field.type === "boolean") {
					input = '<input type="checkbox" data-key="' +
						escapeHtml(field.key) + '" data-scope="' + owner +
						'" data-type="boolean"' +
						(value ? " checked" : "") + ">";
				} else if (field.type === "select") {
					const options = (field.options || []).map(function (option) {
						return '<option value="' + escapeHtml(option) + '"' +
							(option === value ? " selected" : "") + ">" +
							escapeHtml(option) + "</option>";
					}).join("");

					input = '<select data-key="' + escapeHtml(field.key) +
						'" data-scope="' + owner + '" data-type="select">' +
						options + "</select>";
				} else {
					const type = ["url", "number"].indexOf(field.type) >= 0
						? field.type : "text";

					input = '<input type="' + type + '" data-key="' +
						escapeHtml(field.key) + '" data-scope="' + owner +
						'" data-type="' +
						escapeHtml(field.type) + '" value="' +
						escapeHtml(value === undefined ? "" : value) + '">';
				}

				return wrapField(field, input + help);
			}
		}

		// A field can depend on another one's value — no point offering a
		// gradient's second colour when the background isn't a gradient
		function wrapField(field, inner) {
			const condition = field.showWhen
				? ' data-when-key="' + escapeHtml(field.showWhen.key) + '"' +
				  ' data-when-is="' + escapeHtml(
						[].concat(field.showWhen.equals).join("|")
				  ) + '"'
				: "";

			return '<div class="field"' + condition + ">" +
				"<label>" + escapeHtml(field.label || field.key) + "</label>" +
				inner +
			"</div>";
		}

		function applyFieldConditions() {
			for (const field of document.querySelectorAll("[data-when-key]")) {
				const control = document.querySelector(
					'[data-key="' + field.dataset.whenKey + '"]'
				);

				if (!control) continue;

				const allowed = field.dataset.whenIs.split("|");
				field.style.display =
					allowed.indexOf(control.value) === -1 ? "none" : "";
			}
		}

		function renderThemeStep() {
			const theme = selectedTheme();

			const fields = theme.schema.map(function (field) {
				return renderField(field, face.themeConfig[field.key]);
			}).join("");

			return '<div class="tile wizard-single">' +
				"<h2>" + escapeHtml(theme.name) + "</h2>" +
				fields +
			"</div>";
		}

		function renderReviewStep() {
			const rows = face.instances.map(function (instance) {
				return '<div class="review-row">' +
					"<strong>" + escapeHtml(instance.label) + "</strong>" +
					"<span>" + escapeHtml(moduleById(instance.module).name) + "</span>" +
				"</div>";
			}).join("");

			const theme = THEMES.find(function (t) { return t.id === face.theme; });

			return '<div class="tile wizard-single">' +
				'<div class="review-row"><strong>Name</strong><span>' +
					escapeHtml(face.name || "Face " + NEXT_PORT) + "</span></div>" +
				'<div class="review-row"><strong>Title</strong><span>' +
					escapeHtml(face.title || "none") + "</span></div>" +
				'<div class="review-row"><strong>Theme</strong><span>' +
					escapeHtml(theme ? theme.name : "none") + "</span></div>" +
				'<div class="review-row"><strong>ID</strong><span>' +
					NEXT_PORT + "</span></div>" +
				'<div style="margin-top:22px"><h2>Modules</h2>' +
					(rows || '<div class="empty">No modules on this face.</div>') +
				"</div>" +
			"</div>";
		}

		// ---- moving between steps ----

		function headingFor() {
			if (step === 0) {
				return ["New face", "Give it a name and pick a theme."];
			}
			if (step === 1) {
				return [
					"Add modules",
					"Click to add. Add the same one more than once if you like."
				];
			}
			if (step === lastStep()) {
				return ["Review", "This is what will be created."];
			}
			if (hasThemeStep() && step === themeStep()) {
				return ["Theme", "How this face should look."];
			}

			return ["Configure", "Set up each module in turn."];
		}

		function draw() {
			const heading = headingFor();

			// Every step gets its height from #content, which is sized
			// by CSS from the first paint. Nothing here needs to set a
			// class for layout any more.

			document.getElementById("header").innerHTML =
				"<h1>" + heading[0] + '</h1><p class="lede">' + heading[1] + "</p>";

			let content;
			if (step === 0) content = renderNameStep();
			else if (step === 1) content = renderPickStep();
			else if (step === lastStep()) content = renderReviewStep();
			else if (hasThemeStep() && step === themeStep()) content = renderThemeStep();
			else content = renderSettingsStep();

			document.getElementById("content").innerHTML = content;
			document.getElementById("status").textContent = "";

			for (const control of document.querySelectorAll("[data-key]")) {
				control.addEventListener("change", applyFieldConditions);
			}

			applyFieldConditions();

			// The rows were just rebuilt, so their numbering and disabled
			// arrows need setting for the order they're actually in
			syncAllPriorities();

			for (const button of document.querySelectorAll("[data-loc-search]")) {
				button.addEventListener("click", function () {
					searchCity(this.dataset.locSearch);
				});
			}

			// Enter in a city box searches, rather than doing nothing
			for (const box of document.querySelectorAll("[data-loc-query]")) {
				box.addEventListener("keydown", function (event) {
					if (event.key === "Enter") {
						event.preventDefault();
						searchCity(this.dataset.locQuery);
					}
				});
			}

			// Show or hide coordinate boxes as the location radio changes
			for (const radio of document.querySelectorAll("[data-loc]")) {
				radio.addEventListener("change", function () {
					const fields = document.querySelector(
						'[data-loc-fields="' + this.dataset.loc + '"]'
					);
					if (fields) {
						fields.style.display = this.value === "manual" ? "" : "none";
					}
				});
			}

			// Hidden rather than disabled: the capsule is a fixed width,
			// so a greyed-out segment would just be a dead gap. Removed
			// from the layout, the other two spread to fill it.
			document.getElementById("back").style.display =
				step === 0 ? "none" : "";
			document.getElementById("next").textContent =
				step === lastStep() ? "Finish" : "Next";
		}

		// Look a city up and offer the matches. Clicking one fills in the
		// coordinate boxes — the stored value is still just coordinates.
		window.searchCity = async function (key) {
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
					return '<button class="result" data-loc-pick="' + key +
						'" data-index="' + index + '">' +
						escapeHtml(place.label) + "</button>";
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
		};

		window.pickCity = function (key, index) {
			const place = window["cities_" + key][index];

			document.querySelector('[data-loc-lat="' + key + '"]').value = place.latitude;
			document.querySelector('[data-loc-lon="' + key + '"]').value = place.longitude;
			document.querySelector('[data-loc-query="' + key + '"]').value = place.label;
			document.querySelector('[data-loc-results="' + key + '"]').innerHTML = "";
		};

		window.addInstance = function (moduleId) {
			captureStep();

			const module = moduleById(moduleId);

			// Number repeats so two of the same module are tellable apart
			// before you've had a chance to rename them
			const sameModule = face.instances.filter(function (instance) {
				return instance.module === moduleId;
			}).length;

			const theme = selectedTheme();

			// A module that works behind the scenes starts at whatever this
			// theme calls hidden — the theme's own vocabulary, not ours
			const themeStart = theme
				? module.tile === false
					? theme.hiddenDefaults
					: theme.instanceDefaults
				: {};

			face.instances.push({
				module: moduleId,
				label: sameModule ? module.name + " " + (sameModule + 1) : module.name,
				themeConfig: Object.assign({}, themeStart),
				// Start from the module's own defaults
				config: Object.assign({}, module.defaults)
			});

			draw();
		};

		// Any theme setting that names an instance, so it can be cleared when
		// the instance list changes underneath it
		function instanceSettingKeys() {
			const theme = selectedTheme();
			if (!theme || !theme.schema) return [];

			return theme.schema
				.filter(function (field) { return field.type === "instance"; })
				.map(function (field) { return field.key; });
		}

		window.removeInstance = function (index) {
			face.instances.splice(index, 1);

			// Instances are referred to by position until the face is saved,
			// so removing one shifts every reference after it. Clearing is
			// better than silently pointing at the wrong module.
			for (const key of instanceSettingKeys()) {
				face.themeConfig[key] = "";
			}

			draw();
		};

		document.getElementById("back").addEventListener("click", function () {
			captureStep();
			if (step > 0) step--;
			draw();
		});

		document.getElementById("cancel").addEventListener("click", function () {
			// Nothing has been written, so there's nothing to undo
			location.href = "/";
		});

		document.getElementById("next").addEventListener("click", async function () {
			captureStep();

			const status = document.getElementById("status");

			if (step === 0 && !face.theme) {
				status.textContent = "Pick a theme to continue.";
				return;
			}

			// Start the theme's settings from its own defaults, so the theme
			// step opens with sensible values rather than empty boxes
			if (step === 0) {
				const theme = selectedTheme();
				if (theme && !Object.keys(face.themeConfig).length) {
					face.themeConfig = Object.assign({}, theme.defaults);
				}
			}

			if (step < lastStep()) {
				step++;
				draw();
				return;
			}

			// Finish — this is the only point anything is saved
			this.disabled = true;
			this.textContent = "Creating…";

			try {
				const response = await fetch("/faces", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(face)
				});

				if (!response.ok) throw new Error();

				const created = await response.json();

				// Note: in Codespaces you may hit a 404 on first load — the
				// port takes a moment to get published by the forwarding
				// proxy. Just reload. Doesn't happen on a real host.
				location.href = faceUrl(created.id);
			} catch (error) {
				status.textContent = "Couldn't create the face.";
				this.disabled = false;
				this.textContent = "Finish";
			}
		});

		draw();
	`;

	return page("New face", body, script);
}

module.exports = startWizardFace;