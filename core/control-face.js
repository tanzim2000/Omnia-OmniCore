// core/control-face.js
// The control face on port 4000. OmniVision talks to this to discover and
// pick which dashboard face to display. It's also where new faces are set
// up, through a step-by-step wizard.
//
// The wizard holds everything in the browser and only commits at "Finish".
// Nothing is written along the way, so Cancel leaves no half-configured
// modules behind on a face that might be live on a display.
//
// This is the SETUP path. Changing one setting later is done in the admin
// face, which edits directly — a wizard is good at setting things up and
// bad at changing one thing afterwards.

const express = require("express");
const faceStore = require("./face-store");
const { startFace } = require("./face-loader");
const themeLoader = require("./theme-loader");
const { listModules } = require("./module-loader");
const { readManifest, readSchema, applyDefaults } = require("./module-config");
const { searchCities } = require("./location-service");

const CONTROL_PORT = 4000;

const styles = `
	* { box-sizing: border-box; }

	body {
		background: #000;
		color: #fff;
		font-family: system-ui, sans-serif;
		min-height: 100vh;
		margin: 0;
		padding: 40px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
	}

	h1 { font-weight: 300; font-size: 28px; margin: 0; }
	h2 { font-weight: 400; font-size: 15px; margin: 0 0 14px 0; opacity: 0.6; }

	.lede { opacity: 0.55; font-size: 14px; margin: 10px 0 0 0; }

	a { color: #fff; text-decoration: none; }

	.panel { width: 100%; max-width: 900px; }
	.narrow { max-width: 460px; }

	/* Steps with a single panel are centred; the two-column steps are not,
	   since a centred pair of wide columns just looks lopsided */
	body.single { align-items: center; }
	body.single .panel { display: flex; flex-direction: column; align-items: center; }
	body.single .actions { justify-content: center; }

	/* The two rounded squares, side by side */
	.columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		width: 100%;
	}

	.square {
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 16px;
		padding: 20px;
		min-height: 340px;
	}

	/* Flat buttons — the module picker. Deliberately plainer than the
	   glass buttons, which are reserved for moving through the wizard. */
	.flat {
		display: block;
		width: 100%;
		text-align: left;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		color: #fff;
		font-size: 15px;
		font-family: inherit;
		padding: 12px 16px;
		margin-bottom: 8px;
		cursor: pointer;
	}

	.flat:hover { background: rgba(255, 255, 255, 0.1); }
	.flat small { display: block; opacity: 0.45; font-size: 12px; margin-top: 3px; }

	/* An item in the bucket. Removable while picking, read-only afterwards. */
	.picked {
		display: block;
		width: 100%;
		text-align: left;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		color: #fff;
		font-size: 15px;
		font-family: inherit;
		padding: 12px 16px;
		margin-bottom: 8px;
	}

	.picked.removable { cursor: pointer; }
	.picked.removable:hover {
		background: rgba(255, 120, 120, 0.12);
		border-color: rgba(255, 120, 120, 0.3);
	}

	.picked small { display: block; opacity: 0.45; font-size: 12px; margin-top: 3px; }

	/* The instance being configured right now */
	.picked.current {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.35);
	}

	.field { margin-bottom: 18px; }

	label {
		display: block;
		font-size: 14px;
		opacity: 0.7;
		margin-bottom: 8px;
	}

	.help { font-size: 12px; opacity: 0.45; margin-top: 6px; }

	input[type="color"] {
		width: 100%;
		height: 46px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		padding: 4px;
		cursor: pointer;
	}

	input[type="text"],
	input[type="url"],
	input[type="number"],
	select {
		width: 100%;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		color: #fff;
		font-size: 16px;
		padding: 12px 16px;
	}

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

	/* Dropdown options fall back to the browser's own popup colours unless
	   we say otherwise, which means white on white in a dark interface */
	option {
		background: #1a1a1a;
		color: #fff;
	}


	.empty { opacity: 0.4; font-size: 14px; }

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
	.status { font-size: 14px; min-height: 20px; color: #ff8a8a; }

	.review-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 11px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		font-size: 15px;
	}

	.review-row span { opacity: 0.55; }

	/* Wizard navigation, bottom right */
	.actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 12px;
		width: 100%;
		max-width: 900px;
	}

	.actions.narrow { max-width: 460px; }

	/* Glass-style button with a soft light reflection */
	.glass {
		position: relative;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		backdrop-filter: blur(12px);
		color: #fff;
		font-size: 15px;
		font-family: inherit;
		padding: 13px 30px;
		cursor: pointer;
	}

	.glass:hover { background: rgba(255, 255, 255, 0.12); }
	.glass:disabled { opacity: 0.3; cursor: not-allowed; }

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

	.face {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 20px;
		border-radius: 12px;
		margin-bottom: 10px;
		position: relative;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(12px);
		cursor: pointer;
	}

	.face:hover { background: rgba(255, 255, 255, 0.12); }
	.face span { opacity: 0.55; font-size: 13px; }

	.face::before {
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

// Codespaces gives every port its own hostname, so we can't just link to
// localhost:PORT. This rewrites the current URL's port for whichever
// environment we're in — works both in Codespaces and on a real server.
const portLinkScript = `
	function faceUrl(port) {
		const host = location.hostname;

		// Codespaces hostnames look like: name-3000.app.github.dev
		const codespaceMatch = host.match(/^(.*)-\\d+(\\.app\\.github\\.dev)$/);
		if (codespaceMatch) {
			return location.protocol + "//" + codespaceMatch[1] + "-" + port + codespaceMatch[2];
		}

		// Normal server: same host, different port
		return location.protocol + "//" + host + ":" + port;
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

function page(title, body, script) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${styles}</style>
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

	// Machine-readable face registry — this is what OmniVision will call
	app.get("/faces", (req, res) => {
		res.json(faceStore.readFaces());
	});

	// Create a face, with all its modules, in one go — the wizard's commit
	app.post("/faces", async (req, res) => {
		const { name, title, theme, instances, themeConfig } = req.body;

		// A face cannot exist without a theme
		if (!theme) {
			res.status(400).json({ error: "A theme is required" });
			return;
		}

		const installed = listModules();

		const face = faceStore.createFace(
			name,
			title,
			theme,
			// Ignore anything referring to a module that isn't installed
			(instances || []).filter((instance) =>
				installed.includes(instance.module)
			)
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
					defaults: themeLoader.applyDefaults(theme.id, {})
				})),
				// What port this face WOULD get. Accurate unless two faces
				// are being created at the same moment.
				nextPort: faceStore.nextDashboardPort()
			})
		);
	});

	// Human-facing page: list existing faces, or start the wizard
	app.get("/", (req, res) => {
		const faces = faceStore.readFaces();

		const list = faces
			.map(
				(face) => `
			<div class="face" onclick="goToFace(${face.id})">
				<strong>${escapeHtml(face.name)}</strong>
				<span>port ${face.id} · ${escapeHtml(face.theme || "no theme")}</span>
			</div>`
			)
			.join("");

		const body = faces.length
			? `<div class="panel narrow">
					<h1>Faces</h1>
				</div>
				<div class="panel narrow">${list}</div>
				<div class="actions narrow">
					<button class="glass" onclick="location.href='/faces/new'">
						Create a new face
					</button>
				</div>`
			: `<div class="panel narrow">
					<h1>No faces yet</h1>
					<p class="lede">Set one up to get started.</p>
				</div>
				<div class="actions narrow">
					<button class="glass" onclick="location.href='/faces/new'">
						Create your first face
					</button>
				</div>`;

		res.send(
			page(
				"OmniCore Control",
				body,
				portLinkScript +
					`
			function goToFace(port) {
				location.href = faceUrl(port);
			}
		`
			)
		);
	});

	app.listen(CONTROL_PORT, () => {
		console.log(`Control face listening on port ${CONTROL_PORT}`);
	});
}

// The wizard is one page that swaps out its own contents as you move
// through the steps. Nothing is saved until Finish.
function renderWizard(data) {
	const body = `
		<div class="panel" id="header"></div>
		<div class="panel" id="content"></div>
		<div class="actions">
			<p class="status" id="status" style="margin-right:auto"></p>
			<button class="glass" id="cancel">Cancel</button>
			<button class="glass" id="back">Back</button>
			<button class="glass" id="next">Next</button>
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

				for (const input of document.querySelectorAll("[data-key]")) {
					instance.config[input.dataset.key] =
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

			return '<div class="square" style="min-height:0;width:100%;min-width:320px;max-width:460px">' +
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
					(themes || '<div class="empty">No themes installed.</div>') +
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

			return '<div class="columns">' +
				'<div class="square">' +
					"<h2>Available modules</h2>" +
					(available || '<div class="empty">No modules installed.</div>') +
				"</div>" +
				'<div class="square">' +
					"<h2>On this face</h2>" +
					(picked || '<div class="empty">Nothing added yet.</div>') +
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
				return renderField(field, instance.config[field.key]);
			}).join("");

			return '<div class="columns">' +
				'<div class="square">' +
					"<h2>On this face</h2>" + bucket +
				"</div>" +
				'<div class="square">' +
					"<h2>" + escapeHtml(module.name) + "</h2>" +
					'<div class="field">' +
						'<label for="label">Label</label>' +
						'<input type="text" id="label" value="' +
							escapeHtml(instance.label) + '">' +
						'<div class="help">Shown as the tile title.</div>' +
					"</div>" +
					(fields || '<div class="empty">Nothing to configure.</div>') +
				"</div>" +
			"</div>";
		}

		// One settings field. Shared by the module step and the theme step,
		// so both look identical — which is the point of declaring settings
		// rather than shipping a form.
		function renderField(field, value) {
			{
				// A theme naming an instance is a placement decision — which
				// module should feed something like a wallpaper
				if (field.type === "color") {
					return wrapField(field,
						'<input type="color" data-key="' + escapeHtml(field.key) +
						'" data-type="color" value="' +
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
							'" data-type="instance">' +
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
				} else if (field.type === "boolean") {
					input = '<input type="checkbox" data-key="' +
						escapeHtml(field.key) + '" data-type="boolean"' +
						(value ? " checked" : "") + ">";
				} else if (field.type === "select") {
					const options = (field.options || []).map(function (option) {
						return '<option value="' + escapeHtml(option) + '"' +
							(option === value ? " selected" : "") + ">" +
							escapeHtml(option) + "</option>";
					}).join("");

					input = '<select data-key="' + escapeHtml(field.key) +
						'" data-type="select">' + options + "</select>";
				} else {
					const type = ["url", "number"].indexOf(field.type) >= 0
						? field.type : "text";

					input = '<input type="' + type + '" data-key="' +
						escapeHtml(field.key) + '" data-type="' +
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

			return '<div class="square" style="min-height:0;width:100%;' +
				'min-width:320px;max-width:460px">' +
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

			return '<div class="square" style="width:100%;min-width:320px;max-width:560px">' +
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

			// Name/theme and review are single panels, so they get centred.
			// The picker and settings steps are two columns and are not.
			const single =
				step === 0 ||
				step === lastStep() ||
				(hasThemeStep() && step === themeStep());
			document.body.className = single ? "single" : "";

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

			document.getElementById("back").disabled = step === 0;
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

			face.instances.push({
				module: moduleId,
				label: sameModule ? module.name + " " + (sameModule + 1) : module.name,
				// Modules that work behind the scenes don't get a tile unless
				// asked for one
				hidden: module.tile === false,
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

module.exports = startControlFace;