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
// 2001+ = input faces, paired to a dashboard face by its ID
//
// A Face is one ID and two ports. Face 001 means Outport 001 (port
// 4001) and Inport 001 (port 2001) -- the last three digits are the
// face's real ID, and the leading digit only says which half of the
// pair a port belongs to. The pairing is arithmetic, never allocated:
// 4001 is always paired with 2001 and nothing has to remember that.
//
// This replaced a pool of separately-allocated input ports, one per
// module instance, which meant tracking which were taken, finding the
// next free one, and avoiding collisions when several were handed out
// in a single batch before anything was written to disk. None of that
// bookkeeping has anything to answer any more.
const DASHBOARD_PORT_START = 4001;
const OUTPORT_PREFIX = 4000;
const INPORT_PREFIX = 2000;

// A face's ID is the shared last-three-digits of its port pair.
function faceIdFromPort(port) {
	return port % 1000;
}

// The two ports a face ID resolves to. Pure arithmetic in both
// directions -- nothing is looked up, stored, or reserved.
function outportFor(faceId) {
	return OUTPORT_PREFIX + faceIdFromPort(faceId);
}

function inportFor(faceId) {
	return INPORT_PREFIX + faceIdFromPort(faceId);
}

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

// Does this face have anything that actually takes input?
//
// What decides whether a face's Inport is listening at all. A face whose
// modules are all display-only (weather, a wallpaper, disk space) has no
// reason to hold an open, unauthenticated port waiting for input that
// can never arrive -- so it doesn't. The port number still exists in the
// arithmetic sense, it just isn't bound to anything.
//
// Re-asked whenever a face's instances change, so adding an
// input-capable module to a face that had none starts its Inport, and
// removing the last one stops it again.
function faceTakesInput(face) {
	if (!face) {
		return false;
	}

	return face.instances.some(
		(instance) => readInputSchema(instance.module).length > 0
	);
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
// are written to disk.
//
// An instance no longer carries a port of its own. Input is reached at
// its face's single Inport, by path -- so there is nothing here to
// allocate, nothing to accumulate as it goes, and no way for two
// instances in the same batch to collide over the same number.
function buildInstances(rawInstances) {
	return (rawInstances || []).map((instance) => ({
		id: newInstanceId(instance.module),
		module: instance.module,
		label: instance.label || "",
		config: instance.config || {},
		themeConfigs: instance.themeConfigs || {}
	}));
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
		themeConfigs: themeConfigs || {}
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
	faceIdFromPort,
	outportFor,
	inportFor,
	faceTakesInput,
	updateThemeConfig,
	createFace,
	updateFace,
	addInstance,
	updateInstance,
	removeInstance
};