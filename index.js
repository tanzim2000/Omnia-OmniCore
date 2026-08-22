// index.js
// OmniCore entry point.
// Starts a small control server exposing GET /faces — a registry of every
// running face, for OmniVision to query later — then starts every enabled
// face as its own independent server on its own port.

const express = require("express");
const fs = require("fs");
const path = require("path");
const loadFaces = require("./core/face-loader");

// Load config once, up front
const configPath = path.join(__dirname, "config", "omnicore.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Start every enabled face; loadFaces returns what actually started
const runningFaces = loadFaces(config);

// Control server: a small dedicated app just for cross-face info
const controlApp = express();

controlApp.get("/faces", (req, res) => {
	res.json(runningFaces);
});

controlApp.listen(config.control.port, () => {
	console.log(`OmniCore control server listening on port ${config.control.port}`);
});