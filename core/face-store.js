// core/face-store.js
// Faces are runtime data, not folders. This handles reading and writing
// the persisted face records in data/faces.json.
//
// A face has four attributes: id (its port number), name, theme, and
// instances. An instance is one use of a module on that face:
//
//     { id, module, label, config }
//
// The same module can appear many times with different settings — two
// weather instances for two cities, each its own tile.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const { readInputSchema } = require("./module-config");
const moduleStorage = require("./module-storage");

function dataPath() {
	return path.join(paths.dataDir(), "faces.json");
}

// Port range rules:
// 3xxx = admin faces (built in, never user-modifiable)
// 4000 = the OmniView welcome face
// 4001+ = dashboard faces (auto-assigned by OmniCore)
// 5001+ = Control faces (auto-assigned, one per instance that wants one)
const DASHBOARD_PORT_START = 4001;
const INPUT_PORT_START = 5001;
const INPUT_PORT_END = 5050;

function readFaces() {
	// A fresh install has no data folder yet — that's not an error,
	// it just means no faces have been created
	if (!fs.existsSync(dataPath())) {
		return [];
	}

	const raw = fs.readFileSync(dataPath(), "utf-8");
	return JSON.parse(raw).faces;
}

function writeFaces(faces) {
	fs.mkdirSync(path.dirname(dataPath()), { recursive: true });
	fs.writeFileSync(dataPath(), JSON.stringify({ faces }, null, "\t"));
}

function findFace(id) {
	return readFaces().find((face) => face.id === id) || null;
}

// Find the next free dashboard port (4001, 4002, 4003...)
function nextDashboardPort() {
	const usedPorts = readFaces().map((face) => face.id);

	let port = DASHBOARD_PORT_START;
	while (usedPorts.includes(port)) {
		port++;
	}
	return port;
}

// Find the next free input-face port (5001, 5002...), or null once the
// reserved block (5001-5050 — see docker-compose.yml) is exhausted. An
// instance simply not getting an input face is the graceful outcome of
// that, not something that should stop it being created — the same way a
// module with no settings just gets an empty config, not an error.
//
// `alsoUsed` covers ports already handed out THIS call but not yet
// written to disk — createFace can build several instances in one batch
// before any of them are persisted, so checking readFaces() alone would
// let two of them see the same "next free" port and collide.
function nextInputPort(alsoUsed) {
	const usedPorts = readFaces()
		.flatMap((face) => face.instances)
		.map((instance) => instance.inputPort)
		.filter(Boolean)
		.concat(alsoUsed || []);

	let port = INPUT_PORT_START;
	while (usedPorts.includes(port)) {
		port++;
	}
	return port > INPUT_PORT_END ? null : port;
}

// An input port for this module, if it declares an input.json — null for
// every other module, which is exactly what "no input face" means
// downstream (see input-face-loader.js).
function inputPortFor(moduleId, alsoUsed) {
	return readInputSchema(moduleId).length > 0
		? nextInputPort(alsoUsed)
		: null;
}

// Create a new dashboard face and persist it.
//
// Instances can be supplied up front — the setup wizard builds the whole
// face in the browser and commits it in one go, so abandoning the wizard
// leaves nothing behind. IDs are generated here, never trusted from input.
function createFace(name, title, theme, instances) {
	const faces = readFaces();
	const id = nextDashboardPort(); // the port number IS the face's ID

	const face = {
		id: id,
		// name is how the ADMIN recognises this face. Blank falls back to
		// the port, which is always unique.
		name: name && name.trim() ? name.trim() : "Face " + id,
		// title is cosmetic — what a theme displays, if it displays one at
		// all. Blank is fine and means no heading.
		title: title || "",
		theme: theme,
		// Theme settings are kept per theme, not just per face, so
		// switching away and back doesn't lose how you had it set up
		themeConfigs: {},
		// Whatever a theme wants to remember for itself — tile sizes, and
		// anything else it decides. Kept apart from themeConfigs, which the
		// admin owns and OmniCore validates against a schema.
		themeStates: {},
		instances: buildInstances(instances)
	};

	faces.push(face);
	writeFaces(faces);
	return face;
}

// Update a face's own attributes. Instances are handled separately below.
function updateFace(id, changes) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === id);

	if (!face) {
		return null;
	}

	// id is fixed — it's the port the face runs on
	if (changes.name !== undefined) {
		face.name = changes.name.trim() ? changes.name.trim() : "Face " + face.id;
	}
	if (changes.title !== undefined) face.title = changes.title;
	if (changes.theme !== undefined) face.theme = changes.theme;

	writeFaces(faces);
	return face;
}

// The ID carries the module name so it's recognisable when you see it in a
// URL, plus random characters so two instances of the same module never
// collide — including after one is removed and another added.
function newInstanceId(moduleId) {
	return moduleId + "-" + crypto.randomBytes(4).toString("hex");
}

// Builds a batch of instances for a brand-new face, before any of them
// are written to disk. Assigns input ports imperatively — accumulating
// as it goes — rather than mapping each independently, which is exactly
// what avoids two instances in the same batch computing the same "next
// free" port (see nextInputPort's `alsoUsed`).
function buildInstances(rawInstances) {
	const assignedPorts = [];

	return (rawInstances || []).map((instance) => {
		const inputPort = inputPortFor(instance.module, assignedPorts);

		if (inputPort) {
			assignedPorts.push(inputPort);
		}

		return {
			id: newInstanceId(instance.module),
			module: instance.module,
			label: instance.label || "",
			config: instance.config || {},
			themeConfigs: instance.themeConfigs || {},
			inputPort
		};
	});
}

// Add a module to an existing face. Returns the new instance.
function addInstance(faceId, moduleId, label, config, themeConfigs) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	const instance = {
		id: newInstanceId(moduleId),
		module: moduleId,
		label: label || "",
		config: config || {},
		// Per-theme settings, keyed by theme id. Whether this instance shows
		// at all is one of these — every theme spells "hidden" its own way.
		themeConfigs: themeConfigs || {},
		inputPort: inputPortFor(moduleId)
	};

	face.instances.push(instance);
	writeFaces(faces);
	return instance;
}

function updateInstance(faceId, instanceId, changes) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	const instance = face.instances.find(
		(candidate) => candidate.id === instanceId
	);

	if (!instance) {
		return null;
	}

	if (changes.label !== undefined) instance.label = changes.label;
	if (changes.config !== undefined) instance.config = changes.config;

	// A theme's per-instance settings, kept under that theme's own key.
	// Switching themes leaves the other theme's choices alone, and none of
	// this ever touches the module's own config above.
	if (changes.themeId && changes.themeConfig !== undefined) {
		if (!instance.themeConfigs) {
			instance.themeConfigs = {};
		}
		instance.themeConfigs[changes.themeId] = changes.themeConfig;
	}

	writeFaces(faces);
	return instance;
}

function removeInstance(faceId, instanceId) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	const removed = face.instances.find(
		(instance) => instance.id === instanceId
	);

	if (!removed) {
		return null;
	}

	face.instances = face.instances.filter(
		(instance) => instance.id !== instanceId
	);

	writeFaces(faces);

	// Nothing an instance saved should outlive it — same reasoning as
	// deleting a face's own record, just at the per-instance file level.
	moduleStorage.deleteInstanceData(faceId, instanceId);

	// Handed back so the caller (admin-face.js) can stop a running input
	// face server — face-store.js only owns the data, never a running
	// server, so it can't stop one itself.
	return removed;
}

// Save a face's settings for one particular theme
function updateThemeConfig(faceId, themeId, config) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	if (!face.themeConfigs) {
		face.themeConfigs = {};
	}

	face.themeConfigs[themeId] = config;

	writeFaces(faces);
	return face;
}

module.exports = {
	readFaces,
	findFace,
	nextDashboardPort,
	updateThemeConfig,
	createFace,
	updateFace,
	addInstance,
	updateInstance,
	removeInstance
};