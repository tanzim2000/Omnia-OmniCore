// core/face-loader.js
// Starts a face — one Express server on the face's own port.
// A face's ID *is* its port number. Faces can be started live at runtime,
// no OmniCore restart needed.

const express = require("express");
const path = require("path");
const { mountModules } = require("./module-loader");
const { listThemes } = require("./theme-loader");
const { updateFace } = require("./face-store");
const renderFallbackPage = require("./fallback-page");

// Tracks which faces are currently running, keyed by port
const runningFaces = new Map();

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

		// Only the modules this face lists — not every module on the system
		mountModules(app, face.modules);

		// The face's own identity — themes fetch this to know which modules
		// they can render. Registered before the theme's static files so a
		// theme can never shadow it with its own file.
		app.get("/identity", (req, res) => {
			res.json(face);
		});

		// Called by the fallback screen when the user picks a theme
		app.post("/select-theme", (req, res) => {
			const updated = updateFace(face.id, { theme: req.body.theme });

			// Keep the in-memory copy in sync with what was just persisted.
			// The handler below reads face.theme on every request, so the
			// new theme takes effect on the next page load — no restart.
			face.theme = updated.theme;

			res.json(updated);
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

		// Resolve the theme on EVERY request rather than once at startup —
		// this is what lets a theme change take effect without a restart.
		// Themes are pure frontend: served as static files, never executed
		// on the server, so a downloaded theme can only render data the
		// face already exposes.
		app.use((req, res, next) => {
			const themes = listThemes();
			const themeIsValid =
				face.theme && themes.some((theme) => theme.id === face.theme);

			if (themeIsValid) {
				// Hand the request to this theme's static file handler
				themeHandler(face.theme)(req, res, next);
				return;
			}

			// No usable theme — show OmniCore's built-in fallback screen
			res.send(renderFallbackPage(themes));
		});

		// Only resolve once the server is genuinely accepting connections
		const server = app.listen(face.id, () => {
			runningFaces.set(face.id, server);
			resolve();
		});
	});
}

module.exports = { startFace };