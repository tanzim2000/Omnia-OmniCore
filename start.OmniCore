// index.js
// OmniCore entry point.
// Port layout:
//   3000  = the built-in admin face — OmniCore's own settings UI
//   4000  = the control face, where OmniVision picks a face to display
//   4001+ = dashboard faces, auto-assigned by OmniCore

const { readFaces } = require("./core/face-store");
const { startFace } = require("./core/face-loader");
const startControlFace = require("./core/control-face");
const startAdminFace = require("./core/admin-face");

// Bring back every dashboard face that was previously created
const faces = readFaces();
for (const face of faces) {
	startFace(face);
}

// The control face is always running
startControlFace();

// So is the admin face — it's built in, not something the user creates
startAdminFace();

if (faces.length === 0) {
	console.log("No dashboard faces yet — open port 4000 to create one");
}