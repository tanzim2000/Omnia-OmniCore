// core/input-face-loader.js
// Starts one tiny Express server per module instance that declared an
// input.json — deliberately NOT the same shape as face-loader.js, which
// starts one server per FACE serving many instances. An input face is
// the opposite: one instance, one dedicated port, because a phone
// tapping a button needs to reach exactly one module's own input face
// directly, not pick an instance out of a face the way a dashboard does.
//
// No theme is ever involved here — see core/input-face-page.js. The
// module says what controls exist; OmniCore alone decides how a tap
// looks and feels.

const express = require("express");
const { loadModule } = require("./module-loader");
const { readManifest, readInputSchema } = require("./module-config");
const { makeModuleApi } = require("./module-api");
const renderInputFacePage = require("./input-face-page");
const { attachFontRoute } = require("./font-service");

// Running input faces, keyed by port: { server }
const runningInputFaces = new Map();

// Starts one instance's input face. Called wherever an instance with an
// inputPort comes into existence: on boot (start.OmniCore), when a new
// face is created (control-face.js), and when a module is added to an
// existing face (admin-face.js).
function startInputFace(faceId, instance) {
	return new Promise((resolve) => {
		if (!instance.inputPort) {
			resolve();
			return;
		}

		if (runningInputFaces.has(instance.inputPort)) {
			resolve();
			return;
		}

		const controls = readInputSchema(instance.module);
		const manifest = readManifest(instance.module);
		const label = instance.label || manifest.name;

		const app = express();
		app.use(express.json());

		// Serves the chosen UI font from this face's own origin
		attachFontRoute(app);

		app.get("/", (req, res) => {
			res.send(renderInputFacePage(label, controls));
		});

		// The one write this face exists for. Unauthenticated, same trust
		// model as a dashboard face today — see docs/Architecture.md on
		// why that's a deliberate, not-yet-solved decision rather than an
		// oversight.
		app.post("/input", async (req, res) => {
			const moduleFn = loadModule(instance.module);

			if (!moduleFn || typeof moduleFn.onInput !== "function") {
				res.status(501).json({
					error: "This module has no input handler"
				});
				return;
			}

			try {
				await moduleFn.onInput(
					req.body || {},
					makeModuleApi(faceId, instance.id)
				);
				res.json({ ok: true });
			} catch (error) {
				// Caught here for the same reason face-loader.js catches a
				// display function throwing — a module's mistake costs it
				// one failed tap, not the whole input face going down.
				console.log(
					`  Input handler for "${instance.module}" failed: ${error.message}`
				);
				res.status(500).json({ error: "Module error" });
			}
		});

		const server = app.listen(instance.inputPort, () => {
			runningInputFaces.set(instance.inputPort, { server });
			resolve();
		});
	});
}

// Stops a running input face — called when its instance is removed
// (admin-face.js), so a deleted module's button doesn't keep answering.
function stopInputFace(inputPort) {
	if (!inputPort) {
		return;
	}

	const running = runningInputFaces.get(inputPort);

	if (!running) {
		return;
	}

	running.server.close();
	runningInputFaces.delete(inputPort);
}

module.exports = { startInputFace, stopInputFace };