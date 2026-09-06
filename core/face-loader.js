// core/face-loader.js
// Starts a face — one Express server on the face's own port.
// A face's ID *is* its port number. Faces can be started live at runtime,
// no OmniCore restart needed.
//
// Everything about a face is resolved PER REQUEST — its theme, its name,
// and its module instances. That's what lets any of them be edited while
// OmniCore keeps running.

const express = require("express");
const fs = require("fs");
const path = require("path");
const { loadModule } = require("./module-loader");
const { makeModuleApi } = require("./module-api");
const { applyDefaults } = require("./module-config");
const { resolveLocations } = require("./location-service");
const { readSystemTime } = require("./time-service");
const themeLoader = require("./theme-loader");
const faceStore = require("./face-store");
const renderFallbackPage = require("./fallback-page");
const { attachEvents, pushToFace, CLIENT_SCRIPT } = require("./face-events");
const { toBlocks, proxyImages } = require("./envelope");
const imageProxy = require("./image-proxy");

// Running faces, keyed by port: { server, face }
const runningFaces = new Map();

// A valid envelope saying something went wrong, so a failing module shows
// as one dead tile rather than breaking the page
function problemEnvelope(label, reason) {
	return {
		title: label,
		content: [
			{ type: "text", emphasis: "primary", value: "—" },
			{ type: "text", emphasis: "secondary", value: reason }
		],
		updated: new Date().toISOString()
	};
}

function startFace(face) {
	return new Promise((resolve) => {
		if (runningFaces.has(face.id)) {
			console.log(`Face "${face.name}" (${face.id}) already running`);
			resolve();
			return;
		}

		const app = express();
		app.use(express.json());

		console.log(`Starting face "${face.name}" on port ${face.id}`);

		// OmniCore's push channel — the /events stream browsers listen on
		attachEvents(app, face);

		// Images are fetched by OmniCore rather than by the display
		imageProxy.attachImageRoute(app);

		// The face's own identity — themes fetch this to know what to draw.
		// Registered before the theme's files so a theme can never shadow it.
		app.get("/identity", (req, res) => {
			// A theme gets its OWN settings and state, resolved against its
			// defaults — not the raw store, and not other themes'
			const { themeConfigs, instances, ...rest } = face;

			res.json({
				...rest,
				themeConfig: themeLoader.applyDefaults(
					face.theme,
					(themeConfigs || {})[face.theme]
				),
				instances: instances.map((instance) => {
					const { themeConfigs: perTheme, ...instanceRest } = instance;

					return {
						...instanceRest,
						// This theme's settings for this instance — its size,
						// mostly. Resolved against the theme's own defaults,
						// and only ever this theme's: another theme's choices
						// aren't exposed here.
						themeConfig: themeLoader.applyInstanceDefaults(
							face.theme,
							(perTheme || {})[face.theme]
						)
					};
				})
			});
		});

		// What time OmniCore thinks it is — reachable directly, with no
		// module in between, for a theme's own ambient chrome (a
		// taskbar-style corner clock baked into the theme itself, say).
		// Same snapshot `omni.time()` hands a module; a theme just
		// reaches it over HTTP instead of through `omni`, since a theme
		// has no server side to receive that object at all.
		app.get("/time", (req, res) => {
			res.json(readSystemTime());
		});

		// One route for every module instance on this face. OmniCore owns
		// the routing: it finds the instance, hands the module its settings,
		// and returns whatever the module gives back.
		//
		// Only instances belonging to THIS face resolve here, so per-face
		// scoping needs no separate check.
		app.get("/api/:instanceId", async (req, res) => {
			const instance = face.instances.find(
				(candidate) => candidate.id === req.params.instanceId
			);

			if (!instance) {
				res.status(404).json({ error: "No such instance on this face" });
				return;
			}

			const label = instance.label || instance.module;
			const moduleFn = loadModule(instance.module);

			if (!moduleFn) {
				const problem = problemEnvelope(label, "Module not installed");
				res.json({ ...problem, content: toBlocks(problem) });
				return;
			}

			try {
				const config = applyDefaults(instance.module, instance.config);

				// Turn any location setting into real coordinates before the
				// module sees it. Modules never implement location logic —
				// they just receive it, or receive null if OmniCore has none.
				await resolveLocations(instance.module, config);

				// How much content the caller has room for, 1 to 100. The
				// scale belongs to the MODULE — it decides what 10 means
				// versus 90 — and the theme decides which number to ask for
				// given the space it has. Neither has to understand the
				// other's vocabulary.
				const asked = Number(req.query.richness);
				const richness = Number.isFinite(asked)
					? Math.min(100, Math.max(1, Math.round(asked)))
					: 50;

				// Everything the module is allowed to use, handed to it
				// rather than reached for. See core/module-api.js. Scoped to
				// this exact instance so its `storage` can only ever reach
				// this instance's own file, never another one's.
				const envelope = await moduleFn(
					config,
					richness,
					makeModuleApi(face.id, instance.id)
				);

				// Themes only ever see blocks, whichever shape the module
				// chose to return
				const blocks = proxyImages(
					toBlocks(envelope),
					instance.id,
					imageProxy.remember
				);

				res.json({
					// The instance's label wins over whatever the module
					// called itself — that's how two weather tiles get told
					// apart
					title: instance.label || envelope.title || instance.module,
					content: blocks,
					updated: envelope.updated || new Date().toISOString()
				});
			} catch (error) {
				// Catching here means a badly written module costs you one
				// tile, not the whole face
				console.log(
					`  Module "${instance.module}" failed: ${error.message}`
				);
				const problem = problemEnvelope(label, "Module error");
				res.json({ ...problem, content: toBlocks(problem) });
			}
		});

		// Called when the user picks a theme from the fallback screen.
		//
		// This is the one write route left on a dashboard face, and it has
		// no login — dashboard ports are meant to be walk-up-usable, with
		// no way to type a password on a kiosk display. So instead of
		// authenticating it, the window it can act in is kept small: it
		// only works while the face has NO valid theme showing. Once a real
		// theme is set, this refuses — a working display can't be quietly
		// switched later just because the route still exists. Changing an
		// already-working face's theme is the admin face's job.
		app.post("/select-theme", (req, res) => {
			const themes = themeLoader.listThemes();

			const alreadyHasTheme =
				face.theme && themes.some((theme) => theme.id === face.theme);

			if (alreadyHasTheme) {
				res.status(403).json({
					error: "This face already has a theme. Change it from the admin face."
				});
				return;
			}

			const requested = themes.some((theme) => theme.id === req.body.theme);

			if (!requested) {
				res.status(400).json({ error: "Not an installed theme" });
				return;
			}

			res.json(updateFace(face.id, { theme: req.body.theme }));
		});

		// Caches one static-file handler per theme, so we aren't rebuilding
		// it on every single request
		const themeHandlers = new Map();

		function themeHandler(themeId) {
			if (!themeHandlers.has(themeId)) {
				const themeDir = path.join(__dirname, "..", "themes", themeId);
				themeHandlers.set(themeId, express.static(themeDir));
			}
			return themeHandlers.get(themeId);
		}

		// Work out which file on disk a request is asking for.
		// A bare "/" means the theme's index.html.
		function resolveThemeFile(themeId, urlPath) {
			const themeDir = path.join(__dirname, "..", "themes", themeId);
			const requested = urlPath === "/" ? "/index.html" : urlPath;

			const filePath = path.join(themeDir, requested);

			// Refuse anything that escapes the theme folder (e.g. "../../")
			if (!filePath.startsWith(themeDir)) {
				return null;
			}

			return filePath;
		}

		// Resolve the theme on EVERY request rather than once at startup.
		// Themes are pure frontend: served as static files, never executed
		// on the server, so a downloaded theme can only render data the
		// face already exposes.
		app.use((req, res, next) => {
			const themes = themeLoader.listThemes();
			const themeIsValid =
				face.theme && themes.some((theme) => theme.id === face.theme);

			if (!themeIsValid) {
				// No usable theme — show OmniCore's built-in fallback screen
				res.send(renderFallbackPage(themes));
				return;
			}

			const filePath = resolveThemeFile(face.theme, req.path);

			// HTML pages get OmniCore's client script injected, so a theme
			// physically cannot ship without it — that guarantees an
			// unattended display can always be switched away from.
			// Everything else (CSS, JS, images) is served untouched.
			if (filePath && filePath.endsWith(".html") && fs.existsSync(filePath)) {
				let html = fs.readFileSync(filePath, "utf-8");

				if (html.includes("</body>")) {
					html = html.replace("</body>", CLIENT_SCRIPT + "\n</body>");
				} else {
					// Malformed theme HTML with no </body> — append anyway
					html = html + CLIENT_SCRIPT;
				}

				res.setHeader("Content-Type", "text/html");
				res.send(html);
				return;
			}

			// Not an HTML page — hand it to the normal static file handler
			themeHandler(face.theme)(req, res, next);
		});

		// Only resolve once the server is genuinely accepting connections
		const server = app.listen(face.id, () => {
			runningFaces.set(face.id, { server, face });
			resolve();
		});
	});
}

// Keep a running face in step with what's just been saved, and tell any
// display showing it to pick up the change.
function refresh(id) {
	const updated = faceStore.findFace(id);

	if (!updated) {
		return null;
	}

	const running = runningFaces.get(id);

	if (running) {
		// Mutate the object the face's routes already hold a reference to,
		// rather than replacing it
		Object.assign(running.face, updated);
	}

	pushToFace(id, "face-changed", updated);
	return updated;
}

// Change a face's own attributes and have it take effect right away
function updateFace(id, changes) {
	if (!faceStore.updateFace(id, changes)) {
		return null;
	}

	return refresh(id);
}

module.exports = { startFace, updateFace, refresh };