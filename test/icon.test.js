// test/icon.test.js
// The browser tab's icon (v2). No page named one, so every browser asked
// for /favicon.ico and got a 404. Now every page names core/favicon.svg,
// and every server answers for it, and for /favicon.ico too (a face's own
// theme draws its own page and may not name it).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const express = require("express");

const { ICON_LINK, attachIconRoute } = require("../core/icon");

const CORE = path.join(__dirname, "..", "core");

test("the stand-in picture is there, and every page names it", () => {
	assert.ok(fs.existsSync(path.join(CORE, "favicon.svg")));
	assert.equal(ICON_LINK, '<link rel="icon" href="/favicon.svg" type="image/svg+xml">');

	// Every page OmniCore draws itself has it in its <head>
	for (const file of ["about-face.js", "admin-face.js", "control-face.js", "wizard-face.js", "fallback-page.js", "input-face-page.js"]) {
		const source = fs.readFileSync(path.join(CORE, file), "utf8");
		assert.match(source, /<\/title>\n\t*\$\{ICON_LINK\}/, file);
	}

	// Every server answers for it, the face servers included
	for (const file of ["about-face.js", "admin-face.js", "control-face.js", "wizard-face.js", "face-loader.js", "input-face-loader.js"]) {
		const source = fs.readFileSync(path.join(CORE, file), "utf8");
		assert.match(source, /const app = express\(\);\n\t*\/\/ The browser tab's icon \(core\/icon\.js\)\n\t*attachIconRoute\(app\);/, file);
	}
});

test("a server answers /favicon.svg and /favicon.ico with the picture", async () => {
	const app = express();
	attachIconRoute(app);
	const server = await new Promise((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});

	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		const picture = fs.readFileSync(path.join(CORE, "favicon.svg"), "utf8");

		for (const address of ["/favicon.svg", "/favicon.ico"]) {
			const response = await fetch(base + address);
			assert.equal(response.status, 200, address);
			assert.match(response.headers.get("content-type"), /^image\/svg\+xml/, address);
			assert.equal(await response.text(), picture, address);
		}
	} finally {
		server.close();
	}
});
