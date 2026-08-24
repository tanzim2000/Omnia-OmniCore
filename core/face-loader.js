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
const { applyDefaults } = require("./module-config");
const { resolveLocations } = require("./location-service");
const { listThemes } = require("./theme-loader");
const faceStore = require("./face-store");
const renderFallbackPage = require("./fallback-page");
const { attachEvents, pushToFace, CLIENT_SCRIPT } = require("./face-events");

// Running faces, keyed by port: { server, face }
const runningFaces = new Map();

// A valid envelope saying something went wrong, so a failing module shows
// as one dead tile rather than breaking the page
function problemEnvelope(label, reason) {
	return {
		title: label,
		primary: "—",
		secondary: reason,
		details: [],
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

		// The face's own identity — themes fetch this to know what to draw.
		// Registered before the theme's files so a theme can never shadow it.
		app.get("/identity", (req, res) => {
			res.json(face);
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
				res.json(problemEnvelope(label, "Module not installed"));
				return;
			}

			try {
				const config = applyDefaults(instance.module, instance.config);

				// Turn any location setting into real coordinates before the
				// module sees it. Modules never implement location logic —
				// they just receive it, or receive null if OmniCore has none.
				await resolveLocations(instance.module, config);

				const envelope = await moduleFn(config);

				// The instance's label wins over whatever the module called
				// itself — that's how two weather tiles get told apart
				if (instance.label) {
					envelope.title = instance.label;
				}

				res.json(envelope);
			} catch (error) {
				// Catching here means a badly written module costs you one
				// tile, not the whole face
				console.log(
					`  Module "${instance.module}" failed: ${error.message}`
				);
				res.json(problemEnvelope(label, "Module error"));
			}
		});

		// Called when the user picks a theme from the fallback screen
		app.post("/select-theme", (req, res) => {
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
			const themes = listThemes();
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