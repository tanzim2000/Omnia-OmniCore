// core/input-face-loader.js
// Starts one Express server per FACE that has anything taking input --
// its Inport. A face is one ID and two ports: Outport 4001 shows the
// dashboard, Inport 2001 takes input for the same face. The pairing is
// arithmetic (see face-store.js), so nothing here allocates or
// remembers a port number.
//
// This used to be one server per input-capable INSTANCE, each on its own
// separately-allocated port out of a pool. Several modules on one face
// now share that face's single Inport and are told apart by path, which
// is what lets a face's input live at one predictable address instead of
// a handful of unrelated ones.
//
// An Inport only listens if the face actually has an instance that takes
// input. A face of weather and wallpaper tiles has no reason to hold an
// open, unauthenticated port waiting for input that can never arrive --
// so it doesn't, and starts listening the moment one is added.
//
// No theme is ever involved here — see core/input-face-page.js. The
// module says what controls exist; OmniCore alone decides how a tap
// looks and feels.

const express = require("express");
const { loadModule } = require("./module-loader");
const { readManifest, readInputSchema } = require("./module-config");
const { makeModuleApi } = require("./module-api");
const renderInputFacePage = require("./input-face-page");
const { renderInputPickerPage } = require("./input-face-page");
const { attachFontRoute } = require("./font-service");
const { inportFor, faceTakesInput } = require("./face-store");

// Running Inports, keyed by port: { server }
const runningInputFaces = new Map();

// Every instance on this face that actually declares controls.
function inputCapableInstances(face) {
	return face.instances.filter(
		(instance) => readInputSchema(instance.module).length > 0
	);
}

// Starts a face's Inport, if it has anything to take input for.
//
// Safe to call on a face whose Inport is already running, and safe to
// call on one that has no input at all -- both are no-ops. That's what
// lets the same call sit at every point a face's instances might have
// changed without each one having to work out whether it's the call
// that matters.
function startInputFace(faceOrId, maybeFace) {
	// Previously called as (faceId, instance). Now it takes the face
	// itself, since the decision is about the face as a whole.
	const face = typeof faceOrId === "object" ? faceOrId : maybeFace;

	return new Promise((resolve) => {
		if (!face || !faceTakesInput(face)) {
			resolve();
			return;
		}

		const port = inportFor(face.id);

		if (runningInputFaces.has(port)) {
			resolve();
			return;
		}

		const app = express();
		app.use(express.json());

		// Serves the chosen UI font from this face's own origin
		attachFontRoute(app);

		// The root. With one input-capable instance it serves that
		// instance's page directly; with several it offers the choice.
		// A picker holding a single option is just a tap someone has to
		// make for no reason.
		app.get("/", (req, res) => {
			const instances = inputCapableInstances(face);

			if (instances.length === 1) {
				const instance = instances[0];
				const manifest = readManifest(instance.module);

				res.send(
					renderInputFacePage(
						instance.label || manifest.name,
						readInputSchema(instance.module),
						`/${instance.id}/input`
					)
				);
				return;
			}

			res.send(
				renderInputPickerPage(
					face.name || `Face ${face.id}`,
					instances.map((instance) => ({
						label: instance.label || readManifest(instance.module).name,
						path: `/${instance.id}`
					}))
				)
			);
		});

		// One instance's own page, reached from the picker.
		app.get("/:instanceId", (req, res) => {
			const instance = face.instances.find(
				(candidate) => candidate.id === req.params.instanceId
			);

			if (!instance) {
				res.status(404).send("No such module on this face");
				return;
			}

			const controls = readInputSchema(instance.module);

			if (!controls.length) {
				res.status(404).send("That module doesn't take input");
				return;
			}

			const manifest = readManifest(instance.module);

			res.send(
				renderInputFacePage(
					instance.label || manifest.name,
					controls,
					`/${instance.id}/input`
				)
			);
		});

		// The one write this face exists for. Unauthenticated, same trust
		// model as a dashboard face today — see docs/Architecture.md on
		// why that's a deliberate, not-yet-solved decision rather than an
		// oversight. Authentication is planned to land here, at the
		// Inport, covering every instance behind it at once.
		app.post("/:instanceId/input", async (req, res) => {
			const instance = face.instances.find(
				(candidate) => candidate.id === req.params.instanceId
			);

			if (!instance) {
				res.status(404).json({ error: "No such module on this face" });
				return;
			}

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
					makeModuleApi(face.id, instance.id)
				);
				res.json({ ok: true });
			} catch (error) {
				// Caught here for the same reason face-loader.js catches a
				// display function throwing — a module's mistake costs it
				// one failed tap, not the whole Inport going down.
				console.log(
					`  Input handler for "${instance.module}" failed: ${error.message}`
				);
				res.status(500).json({ error: "Module error" });
			}
		});

		const server = app.listen(port, () => {
			runningInputFaces.set(port, { server });
			resolve();
		});
	});
}

// Stops a face's Inport. Called when a face is deleted, and whenever its
// last input-capable instance is removed -- a port with nothing behind
// it shouldn't keep answering.
function stopInputFace(faceOrPort) {
	if (!faceOrPort) {
		return;
	}

	// Accepts either a face id/port or an already-computed Inport, since
	// inportFor is idempotent on a number already in the 2xxx range.
	const port = inportFor(faceOrPort);
	const running = runningInputFaces.get(port);

	if (!running) {
		return;
	}

	running.server.close();
	runningInputFaces.delete(port);
}

// Brings a face's Inport in line with what its instances now need:
// starts it if something on the face takes input, stops it if nothing
// does any more. Called wherever a face's instances change, so adding
// the first input-capable module to a face opens its Inport and removing
// the last one closes it again.
async function refreshInputFace(face) {
	if (!face) {
		return;
	}

	if (faceTakesInput(face)) {
		// A running Inport holds its own copy of the face, so it has to
		// be replaced rather than left alone -- otherwise a newly added
		// instance wouldn't be reachable on a port that's already up.
		stopInputFace(face.id);
		await startInputFace(face);
		return;
	}

	stopInputFace(face.id);
}

module.exports = { startInputFace, stopInputFace, refreshInputFace };