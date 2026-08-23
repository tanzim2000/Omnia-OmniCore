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

const dataPath = path.join(__dirname, "..", "data", "faces.json");

// Port range rules:
// 3xxx = admin faces (built in, never user-modifiable)
// 4000 = the OmniVision control face
// 4001+ = dashboard faces (auto-assigned by OmniCore)
const DASHBOARD_PORT_START = 4001;

function readFaces() {
	// A fresh install has no data folder yet — that's not an error,
	// it just means no faces have been created
	if (!fs.existsSync(dataPath)) {
		return [];
	}

	const raw = fs.readFileSync(dataPath, "utf-8");
	return JSON.parse(raw).faces;
}

function writeFaces(faces) {
	fs.mkdirSync(path.dirname(dataPath), { recursive: true });
	fs.writeFileSync(dataPath, JSON.stringify({ faces }, null, "\t"));
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

// Create a new dashboard face and persist it.
//
// Instances can be supplied up front — the setup wizard builds the whole
// face in the browser and commits it in one go, so abandoning the wizard
// leaves nothing behind. IDs are generated here, never trusted from input.
function createFace(name, theme, instances) {
	const faces = readFaces();

	const face = {
		id: nextDashboardPort(), // the port number IS the face's ID
		name: name,
		theme: theme,
		instances: (instances || []).map((instance) => ({
			id: newInstanceId(instance.module),
			module: instance.module,
			label: instance.label || "",
			config: instance.config || {}
		}))
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
	if (changes.name !== undefined) face.name = changes.name;
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

// Add a module to an existing face. Returns the new instance.
function addInstance(faceId, moduleId, label, config) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	const instance = {
		id: newInstanceId(moduleId),
		module: moduleId,
		label: label || "",
		config: config || {}
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

	writeFaces(faces);
	return instance;
}

function removeInstance(faceId, instanceId) {
	const faces = readFaces();
	const face = faces.find((candidate) => candidate.id === faceId);

	if (!face) {
		return null;
	}

	const before = face.instances.length;
	face.instances = face.instances.filter(
		(instance) => instance.id !== instanceId
	);

	if (face.instances.length === before) {
		return null; // nothing removed
	}

	writeFaces(faces);
	return face;
}

module.exports = {
	readFaces,
	findFace,
	nextDashboardPort,
	createFace,
	updateFace,
	addInstance,
	updateInstance,
	removeInstance
};