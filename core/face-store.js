// core/face-store.js
// Faces are runtime data, not folders. This handles reading and writing
// the persisted face records in data/faces.json.
// A face has exactly 4 attributes: id (port number), name, theme, modules.

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "faces.json");

// Port range rules:
// 3xxx = admin faces (built in, never user-modifiable)
// 4000 = the OmniVision control face
// 4001+ = dashboard faces (auto-assigned by OmniCore)
const DASHBOARD_PORT_START = 4001;

function readFaces() {
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

// Find the next free dashboard port (4001, 4002, 4003...)
function nextDashboardPort() {
	const faces = readFaces();
	const usedPorts = faces.map((face) => face.id);

	let port = DASHBOARD_PORT_START;
	while (usedPorts.includes(port)) {
		port++;
	}
	return port;
}

// Create a new dashboard face and persist it
function createFace(name, theme, modules) {
	const faces = readFaces();

	const face = {
		id: nextDashboardPort(), // the port number IS the face's ID
		name: name,
		theme: theme,
		modules: modules
	};

	faces.push(face);
	writeFaces(faces);
	return face;
}

// Update an existing face (e.g. assigning a theme, changing modules)
function updateFace(id, changes) {
	const faces = readFaces();
	const face = faces.find((f) => f.id === id);

	if (!face) {
		return null;
	}

	// Only these attributes are editable — id is fixed, it's the port
	if (changes.name !== undefined) face.name = changes.name;
	if (changes.theme !== undefined) face.theme = changes.theme;
	if (changes.modules !== undefined) face.modules = changes.modules;

	writeFaces(faces);
	return face;
}

module.exports = { readFaces, createFace, updateFace };