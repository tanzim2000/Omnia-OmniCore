// core/icon.js
// The little picture a browser shows on the tab (the favicon), the same on
// every page OmniCore draws, whichever port it's on.
//
// The picture itself is core/favicon.svg. To change it, replace that file
// with another square SVG (it should still read at 16 x 16 pixels, on a
// dark tab and a light one) and restart OmniCore. A PNG works too: put it
// at core/favicon.png and remove the SVG.
//
// Every page names it in its <head> (ICON_LINK), and every server answers
// /favicon.svg (or .png), plus /favicon.ico for a page that doesn't name
// it (a face's own theme, say), which the browser asks for by itself.

const fs = require("fs");
const path = require("path");

// Whichever picture is there: the SVG first, then a PNG
const CHOICES = [
	{ file: "favicon.svg", type: "image/svg+xml" },
	{ file: "favicon.png", type: "image/png" }
];

const ICON =
	CHOICES.map((choice) => ({ ...choice, full: path.join(__dirname, choice.file) }))
		.find((choice) => fs.existsSync(choice.full)) || null;

// The line every page puts in its <head>
const ICON_LINK = ICON
	? `<link rel="icon" href="/${ICON.file}" type="${ICON.type}">`
	: "";

// The picture's routes on one server (each face has its own)
function attachIconRoute(app) {
	if (!ICON) return;

	const send = (req, res) => {
		res.set("Cache-Control", "public, max-age=86400");
		res.type(ICON.type);
		res.sendFile(ICON.full);
	};

	app.get("/" + ICON.file, send);
	// Asked for by the browser on its own when a page names no icon
	app.get("/favicon.ico", send);
}

module.exports = { ICON_LINK, attachIconRoute };
