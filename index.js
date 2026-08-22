// index.js
// Minimal Express server — just to confirm the dev environment pipeline works
// end to end before writing any real OmniCore logic.

const express = require("express"); // load the Express library we installed earlier
const app = express(); // create the Express application

const PORT = 3000; // matches the port we forwarded in devcontainer.json

// A "route" — when someone visits the root URL ("/"), run this function
app.get("/", (req, res) => {
	res.send("OmniCore is alive"); // send this text back as the response
});

// Start the server and listen for incoming requests on PORT
app.listen(PORT, () => {
	console.log(`OmniCore listening on port ${PORT}`);
});