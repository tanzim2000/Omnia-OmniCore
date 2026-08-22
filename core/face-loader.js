// core/face-loader.js
// Starts a face — one Express server on the face's own port.
// A face's ID *is* its port number. Faces can be started live at runtime,
// no OmniCore restart needed.

const express = require("express");
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

		app.get("/", (req, res) => {
			const themes = listThemes();
			const themeIsValid =
				face.theme && themes.some((theme) => theme.id === face.theme);

			if (!themeIsValid) {
				res.send(renderFallbackPage(themes));
				return;
			}

			// TODO: render the actual theme frontend here
			res.send(`Face "${face.name}" is running theme "${face.theme}"`);
		});

		app.post("/select-theme", (req, res) => {
			const updated = updateFace(face.id, { theme: req.body.theme });
			face.theme = updated.theme;
			res.json(updated);
		});

		app.get("/identity", (req, res) => {
			res.json(face);
		});

		// Only resolve once the server is genuinely accepting connections
		const server = app.listen(face.id, () => {
			runningFaces.set(face.id, server);
			resolve();
		});
	});
}

module.exports = { startFace };