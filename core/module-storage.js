// core/module-storage.js
// Read/write for one module instance's own persisted data — the thing
// that lets Counter remember a tap happened, not just show data that
// happens to already exist somewhere.
//
// Mirrors face-store.js's own read/write shape exactly, just aimed at a
// per-instance file instead of the one big faces.json: whole-file-in,
// whole-file-out, "nothing here yet" is {} rather than an error, never a
// partial update.
//
// Layout:
//   data/faces/<faceId>/<instanceId>.json
//
// faceId is the face's port — stable, never edited once a face exists.
// instanceId already carries the module's own name plus random
// characters (see face-store.js's newInstanceId), so this needs nothing
// extra to stay collision-free.

const fs = require("fs");
const path = require("path");

const facesDataDir = path.join(__dirname, "..", "data", "faces");

function instanceFilePath(faceId, instanceId) {
	return path.join(facesDataDir, String(faceId), `${instanceId}.json`);
}

function readInstanceData(faceId, instanceId) {
	const filePath = instanceFilePath(faceId, instanceId);

	if (!fs.existsSync(filePath)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch (error) {
		// A corrupt file shouldn't take the instance down — worst case, it
		// looks like it never saved anything, same as brand new.
		return {};
	}
}

function writeInstanceData(faceId, instanceId, data) {
	const filePath = instanceFilePath(faceId, instanceId);

	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data, null, "\t"));

	return data;
}

// Called when an instance is removed, so its data doesn't outlive it —
// see face-store.js's removeInstance, the hook point this is meant for.
function deleteInstanceData(faceId, instanceId) {
	const filePath = instanceFilePath(faceId, instanceId);

	try {
		fs.unlinkSync(filePath);
	} catch (error) {
		// Nothing to delete — an instance that never wrote anything, or
		// already cleaned up. Not a problem either way.
	}
}

module.exports = { readInstanceData, writeInstanceData, deleteInstanceData };