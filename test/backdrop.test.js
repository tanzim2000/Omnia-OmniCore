// test/backdrop.test.js
// Background and glass (v2): a picture behind OmniCore's own pages, and the
// frosted glass over it.
//
//   - What a file is, from its first bytes, not its name. SVG and anything
//     else not on the list is refused.
//   - Picking one: kept aside, its still frame, then put in place; the one
//     before it is deleted; Back to plain deletes it too.
//   - Only the current picture and its still are ever served, on every
//     port, signed in or not.
//   - The veil over the picture: strong enough for the text to read.
//   - The glass setting: what may be saved.
//   - Every page that draws the Default UI draws the picture, and nothing
//     at all with the plain background.
//   - A raw upload is only accepted on the two routes meant for it.
//
// The files here are made by the test: only their first bytes matter.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { resetState, waitForPort, signIn } = helpers;
const backdrop = require("../core/backdrop");
const uiTheme = require("../core/ui-theme");
const paths = require("../core/paths");
const { readSettings, writeSettings } = require("../core/settings-store");

// --- Files, by their first bytes ------------------------------------------------

const pad = (head, size) => Buffer.concat([head, Buffer.alloc(Math.max(0, (size || 64) - head.length))]);

const FILES = {
	jpeg: pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])),
	png: pad(Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(13), Buffer.alloc(4),
		Buffer.from([0, 0, 0, 0]), Buffer.from("IDAT"), Buffer.alloc(4)
	])),
	apng: pad(Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(13), Buffer.alloc(4),
		Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(8), Buffer.alloc(4)
	])),
	gif: pad(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20), Buffer.from("NETSCAPE2.0")])),
	stillGif: pad(Buffer.from("GIF89a")),
	webp: pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])),
	animatedWebp: pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8X"), Buffer.alloc(4), Buffer.from([0x02])])),
	mp4: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom")])),
	webm: pad(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20), Buffer.from("webm")])),
	avif: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypavif")])),
	svg: pad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
	html: pad(Buffer.from("<html><body>not a picture</body></html>")),
	mkv: pad(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20), Buffer.from("matroska")]))
};

test("what a file is comes from its first bytes", () => {
	const kinds = Object.fromEntries(
		Object.entries(FILES).map(([name, bytes]) => {
			const found = backdrop.sniff(bytes);
			return [name, found ? `${found.kind} ${found.type}` : null];
		})
	);

	assert.deepEqual(kinds, {
		jpeg: "picture image/jpeg",
		png: "picture image/png",
		apng: "animated image/png",
		gif: "animated image/gif",
		stillGif: "picture image/gif",
		webp: "picture image/webp",
		animatedWebp: "animated image/webp",
		mp4: "video video/mp4",
		webm: "video video/webm",
		avif: null,
		svg: null,
		html: null,
		mkv: null
	});

	assert.equal(backdrop.sniff(Buffer.alloc(4)), null, "too short to be anything");
	assert.equal(backdrop.sniff("GIF89a"), null, "only bytes");
});

// --- Picking one ---------------------------------------------------------------

const folder = () => path.join(paths.dataDir(), "backdrop");
const filesNow = () => (fs.existsSync(folder()) ? fs.readdirSync(folder()).sort() : []);
const emptyFolder = () => fs.rmSync(folder(), { recursive: true, force: true });

test("a picked file is kept aside, then put in place with what the page worked out", () => {
	resetState();
	emptyFolder();

	const received = backdrop.receive(FILES.jpeg);
	assert.match(received.id, /^[0-9a-f]{12}$/);
	assert.equal(received.kind, "picture");
	assert.deepEqual(filesNow(), [`pending-${received.id}.jpg`], "aside, not used");

	assert.deepEqual(backdrop.receiveStill(received.id, FILES.jpeg), { ok: true });

	const used = backdrop.use(received.id, { color: "#6A8C6F", low: 0.12, high: 1.7 });
	assert.deepEqual(used.changes, {
		backgroundKind: "picture",
		backgroundType: "image/jpeg",
		backgroundFile: `backdrop-${received.id}.jpg`,
		backgroundStill: `backdrop-${received.id}-still.jpg`,
		backgroundColor: "#6a8c6f",
		backgroundLow: 0.12,
		backgroundHigh: 1
	});
	assert.deepEqual(filesNow(), [`backdrop-${received.id}-still.jpg`, `backdrop-${received.id}.jpg`]);
});

test("an animation or a video needs its still frame", () => {
	resetState();
	emptyFolder();
	for (const name of ["gif", "mp4", "webm", "animatedWebp"]) {
		const received = backdrop.receive(FILES[name]);
		assert.ok(received.id, name);
		assert.match(backdrop.use(received.id, {}).error, /still frame/, `${name} without a still`);

		backdrop.receiveStill(received.id, FILES.jpeg);
		assert.ok(backdrop.use(received.id, {}).changes, `${name} with one`);
	}
});

test("refused: the wrong kind, too big, nothing, an unknown upload, a still that isn't a picture", () => {
	resetState();
	emptyFolder();
	assert.match(backdrop.receive(FILES.svg).error, /isn't a picture/);
	assert.match(backdrop.receive(FILES.html).error, /isn't a picture/);
	assert.match(backdrop.receive(Buffer.alloc(0)).error, /Nothing arrived/);
	assert.match(backdrop.receive(Buffer.alloc(backdrop.MAX_BYTES + 1, 0xff)).error, /50 MB/);
	assert.deepEqual(filesNow(), [], "nothing kept from any of them");

	const received = backdrop.receive(FILES.mp4);
	assert.match(backdrop.receiveStill(received.id, FILES.gif).error, /JPEG, PNG or WebP/);
	assert.match(backdrop.receiveStill(received.id, FILES.svg).error, /JPEG, PNG or WebP/);
	assert.match(backdrop.receiveStill("../../etc", FILES.jpeg).error, /isn't waiting/);
	assert.match(backdrop.use("000000000000", {}).error, /isn't waiting/);
	assert.match(backdrop.use("../x", {}).error, /isn't waiting/);
});

test("what the page worked out is checked: a colour, and numbers from 0 to 1", () => {
	resetState();
	emptyFolder();
	const received = backdrop.receive(FILES.png);
	const { changes } = backdrop.use(received.id, { color: "red; background:url(x)", low: "dark", high: -3 });
	assert.equal(changes.backgroundColor, "");
	assert.equal(changes.backgroundLow, 0.2, "unreadable: a middling guess");
	assert.equal(changes.backgroundHigh, 0);
});

test("removing the others keeps only what's named, and never touches anything else", () => {
	resetState();
	emptyFolder();
	fs.mkdirSync(folder(), { recursive: true });
	for (const name of ["backdrop-aaaaaaaaaaaa.jpg", "backdrop-bbbbbbbbbbbb.mp4", "backdrop-bbbbbbbbbbbb-still.jpg", "notes.txt"]) {
		fs.writeFileSync(path.join(folder(), name), "x");
	}
	backdrop.removeOthers(["backdrop-bbbbbbbbbbbb.mp4", "backdrop-bbbbbbbbbbbb-still.jpg"]);
	assert.deepEqual(filesNow(), ["backdrop-bbbbbbbbbbbb-still.jpg", "backdrop-bbbbbbbbbbbb.mp4", "notes.txt"]);
});

// --- The veil and the glass ---------------------------------------------------------

test("the veil: just enough for the text to read, never all or nothing", () => {
	// A bright sky behind white text needs a strong veil
	assert.ok(backdrop.autoDim(0.1, 0.9, 100, false) >= 0.75);
	// The same picture dimmed by Brightness needs less
	assert.ok(backdrop.autoDim(0.1, 0.9, 60, false) < backdrop.autoDim(0.1, 0.9, 100, false));
	// A night sky needs the least there is
	assert.equal(backdrop.autoDim(0.01, 0.05, 100, false), 0.15);
	// Light mode looks at the dark parts instead
	assert.equal(backdrop.autoDim(0.6, 0.95, 100, true), 0.15);
	assert.ok(backdrop.autoDim(0.01, 0.3, 100, true) > 0.15);
	// Never more than 0.85, even for a white picture made brighter
	assert.ok(backdrop.autoDim(0, 1, 120, false) <= 0.85);
	assert.equal(backdrop.autoDim(0, 5, 120, false), backdrop.autoDim(0, 1, 100, false), "brightness can't go past white");

	// What the veil promises: white text against the brightest parts, at
	// least 4.5 to 1, whenever it isn't at its cap
	for (const high of [0.3, 0.5, 0.7]) {
		const veil = backdrop.autoDim(0, high, 100, false);
		const behind = high * (1 - veil);
		assert.ok(1.05 / (behind + 0.05) >= 4.5, `high ${high}: ${veil}`);
	}
});

test("the glass setting: in range, a tint is none, match or a colour", () => {
	assert.deepEqual(backdrop.cleanGlass({ blur: 99, tint: "match", tintStrength: -5, brightness: 10 }), {
		glassBlur: 40,
		glassTint: "match",
		glassTintStrength: 0,
		backgroundBrightness: 40
	});
	assert.deepEqual(backdrop.cleanGlass({ tint: "#7AA2FF", blur: "12.6" }), { glassTint: "#7aa2ff", glassBlur: 13 });
	assert.deepEqual(backdrop.cleanGlass({ tint: "url(x)", blur: "lots", tintStrength: null }), {});
});

test("the glass in the stylesheet: plain, a tint, a picture", () => {
	const plain = backdrop.glassVariables({ glassBlur: 20, glassTint: "none", glassTintStrength: 12 }, false);
	assert.match(plain, /--glass-blur: 20px;/);
	assert.match(plain, /--glass-tint: transparent;/);
	assert.match(plain, /--segment-edge: transparent;/, "no edge without a picture");
	assert.ok(!plain.includes("--segment-bg"), "the palette's own fill without a picture");

	const tinted = backdrop.glassVariables({ glassBlur: 8, glassTint: "#ff0000", glassTintStrength: 20 }, false);
	assert.match(tinted, /--glass-tint: rgba\(255, 0, 0, 0\.2\);/);

	const picture = {
		backgroundKind: "picture",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundColor: "#336699",
		backgroundLow: 0.1,
		backgroundHigh: 0.9,
		backgroundBrightness: 100,
		glassBlur: 20,
		glassTint: "match",
		glassTintStrength: 10
	};
	const over = backdrop.glassVariables(picture, false);
	assert.match(over, /--glass-tint: rgba\(51, 102, 153, 0\.1\);/, "matches the picture");
	assert.match(over, /--backdrop-dim: rgba\(0, 0, 0, 0\.8\);/);
	assert.match(over, /--segment-bg: rgba\(255, 255, 255, 0\.07\);/);
	// Light mode's veil is Beige Cream, the light page's own colour, a
	// little darker than the light grey before it, so a touch more of it
	assert.match(backdrop.glassVariables(picture, true), /--backdrop-dim: rgba\(238, 222, 197, 0\.16\);/);

	// Match the picture with no picture is no tint
	assert.equal(backdrop.tintColour({ glassTint: "match", backgroundKind: "plain", backgroundColor: "#336699" }), null);
});

test("a colour behind the pages: its own brightness, the veil and Match the background", () => {
	assert.equal(backdrop.luminance("#ffffff"), 1);
	assert.equal(backdrop.luminance("#000000"), 0);
	assert.ok(Math.abs(backdrop.luminance("#eedec5") - 0.745) < 0.001);

	const { changes } = backdrop.useColour("#FFD700");
	assert.equal(changes.backgroundKind, "colour");
	assert.equal(changes.backgroundColor, "#ffd700");
	assert.equal(changes.backgroundFile, "", "no file with a colour");
	assert.equal(changes.backgroundLow, changes.backgroundHigh, "darkest and brightest are the colour itself");
	assert.ok(backdrop.useColour("gold").error, "only #rrggbb");
	assert.ok(backdrop.useColour('#ffd700"><script>').error);

	const gold = { ...changes, backgroundBrightness: 100, glassBlur: 20, glassTint: "match", glassTintStrength: 10 };
	assert.ok(backdrop.hasColour(gold) && backdrop.hasBackdrop(gold) && !backdrop.hasPicture(gold));
	const css = backdrop.glassVariables(gold, false);
	assert.match(css, /--glass-tint: rgba\(255, 215, 0, 0\.1\);/, "Match the background is the colour");
	assert.match(css, /--segment-edge: rgba/, "the glass over a colour is the glass over a picture");
	assert.ok(backdrop.veilFor(gold, false) > 0.5, "a bright colour gets a strong veil in dark mode");
	assert.match(backdrop.backdropHtml(gold), /<span class="omni-colour" style="background:#ffd700"><\/span>/);
});

test("Auto dim off: the veil is what was set by hand, never overruled", () => {
	const picture = {
		backgroundKind: "picture",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundLow: 0.1,
		backgroundHigh: 0.9,
		backgroundBrightness: 100
	};
	assert.equal(backdrop.veilFor({ ...picture, backgroundAutoDim: false, backgroundDim: 0 }, false), 0, "even when text needs more");
	assert.equal(backdrop.veilFor({ ...picture, backgroundAutoDim: false, backgroundDim: 100 }, false), 1);
	assert.equal(backdrop.veilFor({ ...picture, backgroundAutoDim: false, backgroundDim: 30 }, true), 0.3);
	assert.equal(backdrop.veilFor({ ...picture, backgroundAutoDim: true, backgroundDim: 0 }, false), 0.8, "Auto dim on works it out");
	assert.equal(backdrop.veilFor({ backgroundKind: "plain", backgroundAutoDim: false, backgroundDim: 90 }, false), 0, "nothing to veil");

	assert.deepEqual(backdrop.cleanGlass({ autoDim: false, dim: 140 }), { backgroundAutoDim: false, backgroundDim: 100 });
	assert.deepEqual(backdrop.cleanGlass({ autoDim: "yes", dim: "" }), {}, "only true or false; nothing sent is nothing changed");
});

test("the picture's markup: none when plain, a still for reduced motion, a video that starts itself", () => {
	// Nothing to draw with the Default, only the fade's script
	assert.equal(backdrop.backdropHtml({ backgroundKind: "plain" }), backdrop.BACKDROP_SCRIPT);
	assert.equal(backdrop.backdropHtml({ backgroundKind: "picture", backgroundFile: "../../etc/passwd" }), backdrop.BACKDROP_SCRIPT, "only its own names");

	const picture = backdrop.backdropHtml({ backgroundKind: "picture", backgroundFile: "backdrop-aaaaaaaaaaaa.jpg" });
	assert.match(picture, /<img src="\/backdrop\/backdrop-aaaaaaaaaaaa\.jpg" alt=""/);
	assert.match(picture, /aria-hidden="true"/);

	const animated = backdrop.backdropHtml({
		backgroundKind: "animated",
		backgroundFile: "backdrop-aaaaaaaaaaaa.gif",
		backgroundStill: "backdrop-aaaaaaaaaaaa-still.jpg"
	});
	assert.match(animated, /<source srcset="\/backdrop\/backdrop-aaaaaaaaaaaa-still\.jpg" media="\(prefers-reduced-motion: reduce\)">/);

	const video = backdrop.backdropHtml({
		backgroundKind: "video",
		backgroundFile: "backdrop-aaaaaaaaaaaa.mp4",
		backgroundStill: "backdrop-aaaaaaaaaaaa-still.jpg"
	});
	assert.match(video, /<video src="\/backdrop\/backdrop-aaaaaaaaaaaa\.mp4" poster="\/backdrop\/backdrop-aaaaaaaaaaaa-still\.jpg" muted loop playsinline/);
	assert.ok(!/autoplay/.test(video), "started by the script, so reduced motion can stop it first");
	assert.match(video, /prefers-reduced-motion: reduce/);
	assert.match(video, /visibilitychange/);
	const script = video.match(/<script>([\s\S]*?)<\/script>/)[1];
	assert.doesNotThrow(() => new vm.Script(script));
});

// --- The pages -------------------------------------------------------------------

let cookie;

async function request(port, address, options) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, {
		...(options || {}),
		headers: { cookie, ...((options && options.headers) || {}) }
	});
	const type = response.headers.get("content-type") || "";
	return {
		status: response.status,
		type,
		body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer())
	};
}

const upload = (address, bytes) =>
	request(3000, address, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });

const postJson = (address, body) =>
	request(3000, address, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("pages: boots signed in, with every port that draws the Default UI", async () => {
	resetState();
	emptyFolder();
	require("../core/admin-face")();
	require("../core/wizard-face")();
	require("../core/about-face")();
	require("../core/control-face")();
	for (const port of [3000, 3999, 1303, 4000]) await waitForPort(port);
	cookie = await signIn(3000);
});

test("pages: a fresh install has the plain background and the default glass", async () => {
	const settings = readSettings();
	assert.equal(settings.backgroundKind, "plain");
	assert.equal(settings.glassBlur, 20);
	assert.equal(settings.glassTint, "none");

	for (const port of [3000, 3999, 1303, 4000]) {
		const page = (await request(port, "/")).body.toString();
		assert.ok(!page.includes('class="omni-backdrop"'), `nothing drawn on ${port}`);
	}
});

test("pages: Background and Frosted glass, on Settings' Appearance tab", async () => {
	// The page they had in v2's commit 3 opens the tab now
	const old = await request(3000, "/background", { redirect: "manual" });
	assert.equal(old.status, 302);

	const page = (await request(3000, "/")).body.toString();
	assert.match(page, /<h2 class="pane-title" id="appearance">Appearance<\/h2>[\s\S]*<h2>Frosted glass<\/h2>[\s\S]*<h2>Background<\/h2>/);

	// The back button's corner: a named switch in Background (bottom
	// right by default), and the button drawn in that corner of the
	// preview
	assert.match(page, /<label id="corner-label">Back button<\/label>/);
	assert.match(page, /class="tab-btn" data-value="top-left"\s+aria-pressed="false">Top left<\/button>/);
	assert.match(page, /class="tab-btn active" data-value="bottom-right"\s+aria-pressed="true">Bottom right<\/button>/);
	assert.ok(page.includes('class="corner-mark corner-mark-bottom-right"'));
	assert.ok(!page.includes("Back Button Position"), "no box of its own");

	// The file rules are behind an ⓘ, not written out on the page
	assert.match(page, /<span class="info-tip"[^>]*aria-label="What can be used as a background">/);
	assert.match(page, /<span class="info-bubble" role="tooltip">A picture \(JPEG, PNG, WebP\)/);
	assert.ok(page.includes('accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"'));
	assert.ok(page.includes('data-tint="match"') && page.includes(" disabled"), "Match the picture needs a picture");
	assert.ok(page.includes("never sent anywhere"));
	assert.ok(page.includes(backdrop.autoDim.toString()), "the preview uses the same veil as the server");
	assert.ok(page.includes('id="glass-status"'), "saved as it changes, and says so");

	// Frosted glass stays short: the Tint colours on a row of their own,
	// first, and the sliders two or three to a row where there's room
	assert.match(page, /<div class="glass-fields">\s*<div class="field wide-field">\s*<label>Tint /);
	assert.ok(page.indexOf('class="glass-fields"') < page.indexOf('id="blur"'), "the sliders are in it");
	assert.ok(page.indexOf('id="tints"') < page.indexOf('id="blur"'), "the colours come first");

	// The preview is the way to change it: a button that opens the
	// Change background pop-up, with Picture, Colour and Default, a colour
	// wheel, and Use and Cancel. The Back button switch is at the bottom.
	assert.match(page, /<button type="button" class="backdrop-stage" id="change-background"/);
	assert.ok(page.includes('<span class="change-label" aria-hidden="true">Change background</span>'));
	assert.ok(page.indexOf('id="change-background"') < page.indexOf('id="corner-label"'), "the switch comes after the preview");
	assert.ok(!page.includes('id="plain"'), "Back to plain is Default, in the pop-up");
	const modal = page.slice(page.indexOf('id="background-modal"'), page.indexOf('id="font-modal"'));
	for (const tab of ["picture", "colour", "default"]) assert.ok(modal.includes(`data-bg-tab="${tab}"`), tab);
	assert.ok(modal.includes('<canvas id="wheel-canvas"'), "a colour wheel of our own");
	assert.ok(modal.includes("black (#000000)") && modal.includes("Beige Cream (#eedec5)"));
	assert.ok(modal.includes('id="bg-use" disabled>Use</button>'), "nothing to use until something's chosen");
	assert.ok(page.indexOf('id="background-modal"') > page.indexOf('data-pane="about"'), "outside every box");

	for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
		assert.doesNotThrow(() => new vm.Script(source));
	}
});

test("pages: a colour as the background, and Auto dim and Dim saved", async () => {
	const bad = await postJson("/background/colour", { color: "red" });
	assert.equal(bad.status, 400);

	const used = await postJson("/background/colour", { color: "#1E2A44" });
	assert.equal(used.status, 200);
	const settings = readSettings();
	assert.equal(settings.backgroundKind, "colour");
	assert.equal(settings.backgroundColor, "#1e2a44");

	const page = (await request(3000, "/")).body.toString();
	assert.ok(page.includes('<span class="omni-colour" style="background:#1e2a44"></span>'), "drawn behind the page");
	assert.ok(page.includes('id="auto-dim" checked'), "Auto dim on to start with");
	assert.match(page, /<input type="range" id="dim" min="0" max="100" step="1" value="50" disabled>/, "with Auto on, the slider only shows");
	assert.ok(page.includes(">Colour brightness"));
	assert.ok(!page.match(/data-tint="match"[^>]* disabled/), "Match the background works with a colour");

	assert.equal((await postJson("/background/glass", { autoDim: false, dim: 35 })).status, 200);
	assert.equal(readSettings().backgroundAutoDim, false);
	assert.equal(readSettings().backgroundDim, 35);
	const manual = (await request(3000, "/")).body.toString();
	assert.ok(manual.includes('id="auto-dim">'), "off");
	assert.match(manual, /<input type="range" id="dim" min="0" max="100" step="1" value="35">/, "off: the slider counts");
	assert.match(manual, /--backdrop-dim: rgba\(0, 0, 0, 0\.35\)/);

	// Back to the Default for the tests after this one
	assert.equal((await postJson("/background/plain", {})).status, 200);
	await postJson("/background/glass", { autoDim: true, dim: 50 });
});

test("pages: an MP4, its still frame, then in use on every port, signed in or not", async () => {
	const sent = await upload("/background/upload", FILES.mp4);
	assert.equal(sent.status, 200);
	assert.equal(sent.body.kind, "video");

	assert.equal((await upload("/background/still?id=" + sent.body.id, FILES.jpeg)).status, 200);

	const used = await postJson("/background/use", { id: sent.body.id, color: "#224466", low: 0.05, high: 0.4 });
	assert.equal(used.status, 200);

	const settings = readSettings();
	assert.equal(settings.backgroundKind, "video");
	assert.equal(settings.backgroundFile, `backdrop-${sent.body.id}.mp4`);

	for (const port of [3000, 3999, 1303, 4000]) {
		const page = (await request(port, "/")).body.toString();
		assert.ok(page.includes(`<video src="/backdrop/${settings.backgroundFile}"`), `drawn on ${port}`);

		const file = await request(port, "/backdrop/" + settings.backgroundFile);
		assert.equal(file.status, 200, `served on ${port}`);
		assert.ok(file.body.equals(FILES.mp4));
	}

	// Signed out: the sign-in page draws it, and the file is there for it
	const signedOut = await fetch(`http://127.0.0.1:3000/backdrop/${settings.backgroundStill}`);
	assert.equal(signedOut.status, 200);
	const signIn = await (await fetch("http://127.0.0.1:3000/")).text();
	assert.ok(signIn.includes('class="omni-backdrop"'));

	// Nothing but the current two
	for (const name of ["backdrop-000000000000.mp4", "pending-" + sent.body.id + ".mp4", "..%2Fsettings.json", "settings.json"]) {
		assert.equal((await fetch(`http://127.0.0.1:3000/backdrop/${name}`)).status, 404, name);
	}
});

test("pages: a new picture replaces the old one's files; Back to plain deletes them", async () => {
	const before = readSettings().backgroundFile;
	const sent = await upload("/background/upload", FILES.jpeg);
	await upload("/background/still?id=" + sent.body.id, FILES.jpeg);
	await postJson("/background/use", { id: sent.body.id, color: "#ffffff", low: 0.5, high: 0.9 });

	assert.ok(!filesNow().includes(before), "the video is gone");
	assert.deepEqual(filesNow(), [`backdrop-${sent.body.id}-still.jpg`, `backdrop-${sent.body.id}.jpg`]);

	assert.equal((await postJson("/background/plain", {})).status, 200);
	assert.equal(readSettings().backgroundKind, "plain");
	assert.deepEqual(filesNow(), []);
});

test("pages: a refused file says why, as JSON", async () => {
	const svg = await upload("/background/upload", FILES.svg);
	assert.equal(svg.status, 400);
	assert.match(svg.body.error, /isn't a picture/);

	const big = await upload("/background/upload", Buffer.alloc(backdrop.MAX_BYTES + 10, 0xff));
	assert.equal(big.status, 413);
	assert.equal(big.body.error, "That file is bigger than 50 MB.");
});

test("pages: a raw upload only on the two routes meant for it", async () => {
	// Elsewhere a POST still has to be JSON (the guard against pages on
	// other ports)
	const elsewhere = await upload("/background/glass", Buffer.from('{"blur":3}'));
	assert.equal(elsewhere.status, 415);
	const plain = await upload("/background/plain", Buffer.from("{}"));
	assert.equal(plain.status, 415);

	// And a form post to the upload route is refused too
	const form = await request(3000, "/background/upload", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: "a=b"
	});
	assert.equal(form.status, 415);
});

test("pages: saving the glass, and it's in every port's stylesheet", async () => {
	const saved = await postJson("/background/glass", { blur: 31, tint: "#b48cff", tintStrength: 20, brightness: 80 });
	assert.equal(saved.status, 200);

	const settings = readSettings();
	assert.equal(settings.glassBlur, 31);
	assert.equal(settings.glassTint, "#b48cff");

	for (const port of [3000, 3999, 1303, 4000]) {
		const page = (await request(port, "/")).body.toString();
		assert.ok(page.includes("--glass-blur: 31px;"), `blur on ${port}`);
		assert.ok(page.includes("--glass-tint: rgba(180, 140, 255, 0.2);"), `tint on ${port}`);
	}

	writeSettings({ glassBlur: 20, glassTint: "none", glassTintStrength: 12, backgroundBrightness: 100 });
});

test("pages: the wizard serves the chosen font too (it never did before v2)", async () => {
	const font = path.join(paths.dataDir(), "ui-font.woff2");
	fs.writeFileSync(font, "wOF2-sample");
	try {
		for (const port of [3000, 3999]) {
			const response = await fetch(`http://127.0.0.1:${port}/ui-font.woff2`);
			assert.equal(response.status, 200, `port ${port}`);
		}
	} finally {
		fs.rmSync(font, { force: true });
	}
});

test("the background fades: in once loaded, and from the old one after a reload that changed it", () => {
	const script = backdrop.BACKDROP_SCRIPT;
	assert.doesNotThrow(() => new (require("vm").Script)(script.match(/<script>([\s\S]*)<\/script>/)[1]));

	// Every page with the Default UI has it, whatever is behind it
	for (const settings of [
		{ backgroundKind: "plain" },
		{ backgroundKind: "colour", backgroundColor: "#1e2a44" },
		{ backgroundKind: "picture", backgroundFile: "a1b2c3d4e5f60718.jpg" }
	]) {
		assert.ok(backdrop.backdropHtml(settings).endsWith(script), settings.backgroundKind);
	}

	// A picture still loading waits, then fades in; one from the cache doesn't
	assert.ok(script.includes('if ((picture && !(picture.complete && picture.naturalWidth)) || (video && video.readyState < 2)) {\n\t\t\t\tlayer.classList.add("omni-waiting");'));

	// Kept before the reload, put on top after it, faded away once the new one's ready
	assert.ok(script.includes("window.omniKeepBackdrop = function () {"));
	assert.ok(script.includes('old.className = "omni-backdrop-was";'));
	assert.ok(script.includes('old.classList.add("going");'));
	assert.ok(script.includes("if (was && Date.now() - was.at > 10000) was = null;"), "an old copy is never shown much later");
	assert.ok(script.includes("if (was && !still) {"), "no fade with reduced motion");

	// Both reloads keep it first
	assert.ok(uiTheme.UI_MODE_SCRIPT.includes("if (typeof window !== \"undefined\" && window.omniKeepBackdrop) window.omniKeepBackdrop();\n\t\tlocation.reload();"), "Dark and Light");
	const css = uiTheme.uiStyles({ forceMode: "dark" });
	assert.match(css, /\.omni-backdrop\.omni-waiting picture,\s*\.omni-backdrop\.omni-waiting video \{ opacity: 0; \}/);
	assert.match(css, /\.omni-backdrop-was\.going \{ opacity: 0; \}/);
});
