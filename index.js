// index.js
// OmniCore entry point. Starts Express and hands off to the module loader,
// which reads config/omnicore.config.json and mounts each enabled module.

const express = require("express");
const loadModules = require("./core/module-loader");

const app = express();
const PORT = 3000;

// Keep this route as a basic health check for the server itself
app.get("/", (req, res) => {
	res.send("OmniCore is alive");
});

// Load and mount every module marked "enabled" in the config
loadModules(app);

app.listen(PORT, () => {
	console.log(`OmniCore listening on port ${PORT}`);
});