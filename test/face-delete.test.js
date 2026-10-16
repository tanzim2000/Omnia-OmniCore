// test/face-delete.test.js
// A face's page has Open face and Delete face (since v1.19.8), and
// deleting really deletes: the record, its widgets' saved data, its
// running server, and every screen showing it is sent to the welcome face.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("node:http");

const helpers = require("./helpers");
const faceStore = require("../core/face-store");
const moduleStorage = require("../core/module-storage");
const { startFace } = require("../core/face-loader");
const { CLIENT_SCRIPT } = require("../core/face-events");

const ADMIN = 3000;
let cookie;

// A small module, so the face has something on it
function writeModule() {
	const dir = path.join(helpers.modulesDir, "plain");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ name: "Plain", provides: ["text"] }));
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async () => ({ title: 'Plain', content: [{ type: 'text', value: 'hi' }] });\n"
	);
}

// Opens a face's /events stream the way a screen does, and collects what
// arrives until the stream ends
function watch(port) {
	const received = [];

	const ended = new Promise((resolve) => {
		const request = http.get(`http://127.0.0.1:${port}/events`, (response) => {
			response.setEncoding("utf8");
			response.on("data", (chunk) => received.push(chunk));
			response.on("end", () => resolve(received.join("")));
		});

		request.on("error", () => resolve(received.join("")));
	});

	return { ended, received };
}

async function portAnswers(port) {
	try {
		await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
		return true;
	} catch (error) {
		return false;
	}
}

test("boots the admin face", async () => {
	helpers.resetState();
	writeModule();
	require("../core/admin-face")();
	await helpers.waitForPort(ADMIN);
	cookie = await helpers.signIn(ADMIN);
});

test("a face's page has This face, paired with Manage resources", async () => {
	const face = faceStore.createFace("Kitchen", "", null, [{ module: "plain", config: {} }]);
	const html = await (await fetch(`http://127.0.0.1:${ADMIN}/faces/${face.id}`, { headers: { cookie } })).text();

	// One pair of boxes: Manage resources, then This face, both before
	// Notifications. (On a phone held upright, CSS puts This face first.)
	const pair = html.indexOf('<div class="resource-pair">');
	const resources = html.indexOf("<h2>Manage resources</h2>");
	const actions = html.indexOf('<div class="segment face-actions" role="group" aria-label="This face">');
	const notes = html.indexOf("<h2>Notifications</h2>");

	assert.ok(pair > 0 && resources > pair && actions > resources && notes > actions, "in that order");

	// No heading or subtitle on screen: only the screen-reader label
	assert.ok(!html.includes("<h2>This face</h2>"));
	assert.ok(!html.includes("See it as a screen does"));
	assert.match(html, /\.face-actions \{ order: -1;/);
	assert.match(html, /<button type="button" class="glass" id="open-face">Open face<\/button>/);
	assert.match(html, /<button type="button" class="glass glass-danger" id="delete-face">Delete face<\/button>/);

	// Open goes to the face itself, at whatever address this page was
	// reached on; Delete asks first and says what goes with it
	assert.ok(html.includes(`window.open(faceUrl(${face.id}) + "/"`));
	assert.ok(html.includes('"Delete Kitchen?"'));
	assert.ok(html.includes("Its widget and everything it has saved go with it."));
	assert.ok(html.includes("This can't be undone."));
	assert.ok(html.includes('method: "DELETE"'));
});

test("deleting a face: its screens go to the welcome face and its port closes", async () => {
	const face = faceStore.createFace("Hall", "", null, [{ module: "plain", config: {} }]);
	const instance = face.instances[0];
	moduleStorage.writeInstanceData(face.id, instance.id, { kept: true });

	await startFace(face);
	await helpers.waitForPort(face.id);

	const screen = watch(face.id);
	// Give the stream a moment to open
	await new Promise((resolve) => setTimeout(resolve, 200));

	const response = await fetch(`http://127.0.0.1:${ADMIN}/faces/${face.id}`, {
		method: "DELETE",
		headers: { cookie }
	});

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true });

	// The screen was told, and its stream ended rather than hanging open
	const said = await screen.ended;
	assert.match(said, /event: face-deleted/);

	assert.equal(await portAnswers(face.id), false, "the face's port stopped answering");

	// The record and everything its widgets saved are gone
	assert.equal(faceStore.findFace(face.id), null);
	assert.ok(!fs.existsSync(path.join(helpers.dataDir, "faces", String(face.id))));
	assert.deepEqual(moduleStorage.readInstanceData(face.id, instance.id), {});

	// The other face is untouched
	assert.ok(faceStore.readFaces().some((other) => other.name === "Kitchen"));
});

test("a deleted face's number is used again by the next face", () => {
	// Kitchen is 4001; Hall was 4002 and has been deleted
	assert.deepEqual(faceStore.readFaces().map((face) => face.id), [4001]);

	const next = faceStore.createFace("Garage", "", null, []);
	assert.equal(next.id, 4002);
	assert.equal(next.name, "Garage");
});

test("deleting a face that isn't there is a 404, and signed out is refused", async () => {
	const missing = await fetch(`http://127.0.0.1:${ADMIN}/faces/4999`, { method: "DELETE", headers: { cookie } });
	assert.equal(missing.status, 404);

	const face = faceStore.readFaces()[0];
	const anonymous = await fetch(`http://127.0.0.1:${ADMIN}/faces/${face.id}`, {
		method: "DELETE",
		redirect: "manual"
	});
	// Signed out, every admin address answers with the sign-in page
	// (the same for removing a widget), and nothing is deleted
	assert.ok((await anonymous.text()).includes("Sign in"));
	assert.ok(faceStore.findFace(face.id), "still there");
});

test("a screen told its face is gone goes to the welcome face", () => {
	assert.match(CLIENT_SCRIPT, /addEventListener\("face-deleted"/);
	assert.ok(CLIENT_SCRIPT.includes('(window.omniGo || function (a) { location.href = a; })(faceUrl(4000) + "/")'), "with the page fade since v2");
	assert.ok(CLIENT_SCRIPT.includes("function faceUrl(port)"));
});

test("Delete face glows red, not white (v1.19.9)", () => {
	const { uiStyles } = require("../core/ui-theme");
	const css = uiStyles();

	// Its own glow, in the danger colour, on hover and keyboard focus
	assert.match(
		css,
		/\.glass\.glass-danger:not\(:disabled\):hover,\s*\.glass\.glass-danger:not\(:disabled\):focus-visible \{\s*box-shadow:[^}]*0 0 30px color-mix\(in srgb, var\(--danger\) 55%, transparent\);/
	);

	// After the white one, so it wins when both apply
	const white = css.indexOf(".glass:hover,");
	const red = css.indexOf(".glass.glass-danger:not(:disabled):hover");
	assert.ok(white !== -1 && red > white);
});
