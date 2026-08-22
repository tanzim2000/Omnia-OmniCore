// core/face-loader.js
// Auto-discovers faces by scanning the faces/ folder — no config editing
// needed to add a new face. config.faceOverrides is only for optional
// per-face tweaks: disabling one, or pinning it to a specific port.

const express = require("express");
const fs = require("fs");
const path = require("path");
const loadModules = require("./module-loader");

function loadFaces(config) {
	const facesDir = path.join(__dirname, "..", "faces");

	const discoveredFaces = fs
		.readdirSync(facesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	const overrides = config.faceOverrides || {};
	let nextPort = config.facesBasePort || 3000;
	const runningFaces = [];

	for (const faceName of discoveredFaces) {
		const override = overrides[faceName] || {};

		if (override.enabled === false) {
			console.log(`Skipping disabled face: ${faceName}`);
			continue;
		}

		const port = override.port || nextPort;
		nextPort = Math.max(nextPort, port) + 1;

		const app = express();
		loadModules(app, config); // pass the whole config down, not just app

		app.get("/", (req, res) => {
			res.send(`Face "${faceName}" is alive`);
		});

		const faceFn = require(path.join(facesDir, faceName));
		faceFn(app, override.options || {});

		app.listen(port, () => {
			console.log(`Face "${faceName}" listening on port ${port}`);
		});

		runningFaces.push({ name: faceName, port });
	}

	return runningFaces;
}

module.exports = loadFaces;