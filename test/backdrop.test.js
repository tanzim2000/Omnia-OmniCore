// test/backdrop.test.js
// In short: The picture and glass behind OmniCore's pages
//
// Background and glass (v2): a picture behind OmniCore's own pages, and the
// frosted glass over it.
//
//   - What a file is, from its first bytes, not its name. SVG and anything
//     else not on the list is refused.
//   - Picking one: kept aside, its still frame, then put in place; the one
//     before it is deleted; Back to plain deletes it too.
//   - Only the current picture and its still are ever served, on every
//     port, signed in or not.
//   - Auto (since Phase A): the glass, not a veil over the picture, keeps
//     the text readable. Dim, then Blur, then Tint strength, each only as
//     far as needed; a slider moved by hand is pinned and left alone; the
//     font colour is White or Black, switched only when the glass changes
//     and it can't be read. Every row of the BACKLOG's table.
//   - The tint: None, Dominant, Vibrant or a colour.
//   - Picture brightness: -50 to +50, Original being 0; a bright new
//     picture starts darker.
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

	const used = backdrop.use(received.id, { color: "#6A8C6F", vibrant: "#FF6E1F", low: 0.12, high: 1.7, mean: 0.3 });
	assert.deepEqual(used.changes, {
		backgroundKind: "picture",
		backgroundType: "image/jpeg",
		backgroundFile: `backdrop-${received.id}.jpg`,
		backgroundStill: `backdrop-${received.id}-still.jpg`,
		backgroundColor: "#6a8c6f",
		backgroundVibrant: "#ff6e1f",
		backgroundLow: 0.12,
		backgroundHigh: 1,
		backgroundMean: 0.3,
		pictureBrightness: 0
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

// --- Auto, the tint and the glass ----------------------------------------------------

const M = backdrop.GLASS_MODEL;

// The test pictures, as the settings page would describe them
const BRIGHT = { low: 0.68, high: 0.88, mean: 0.78 }; // a pale winter sky
const NIGHT = { low: 0.003, high: 0.009, mean: 0.006 }; // a night city
const EVEN = { low: 0.6, high: 0.6, mean: 0.6 }; // one light grey colour
const BUSY = { low: 0.1, high: 0.75, mean: 0.38 }; // confetti

// Auto over a picture, with these settings on top of the defaults: Auto
// on, nothing pinned, no tint, Original brightness, white text first
function solve(picture, given) {
	return backdrop.solveGlass(
		{ ...picture, brightness: 0, tint: "", auto: true, pinned: [], blur: 20, tintStrength: 12, dim: 0, font: "white", ...given },
		M
	);
}

// How Auto's contrast is reached, checked by hand: the glass laid over the
// worst part of the picture, as the browser does it, on each colour value
function contrastOf(picture, values, font, brightness, tint) {
	const encode = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
	const decode = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
	const mean = picture.mean;
	const spread = (0.5 * values.blur) / M.blurMost;
	const part = font === "white" ? picture.high - (picture.high - mean) * spread : picture.low + (mean - picture.low) * spread;
	let rgb = [0, 1, 2].map(() => Math.min(1, encode(part) * (1 + (brightness || 0) / 100)));
	rgb = rgb.map((v) => v * (1 - M.fill) + M.fill);
	if (tint) {
		const t = [1, 3, 5].map((at) => parseInt(tint.slice(at, at + 2), 16) / 255);
		rgb = rgb.map((v, i) => v * (1 - values.tintStrength / 100) + t[i] * (values.tintStrength / 100));
	}
	rgb = rgb.map((v) => v * (1 - values.dim / 100));
	const glass = 0.2126 * decode(rgb[0]) + 0.7152 * decode(rgb[1]) + 0.0722 * decode(rgb[2]);
	return font === "white" ? 1.05 / (glass + 0.05) : (glass + 0.05) / 0.0556;
}

test("Auto: Dim first, and only as far as the text needs", () => {
	// A bright sky behind white text: Dim goes up, Blur and Tint stay
	const sky = solve(BRIGHT);
	assert.equal(sky.font, "white");
	assert.ok(sky.dim > 30 && sky.dim < M.dimMost, `dim ${sky.dim}`);
	assert.equal(sky.blur, M.blurDefault, "Blur stays where it starts");
	assert.equal(sky.tintStrength, M.tintStrengthDefault, "so does Tint strength");
	assert.ok(sky.readable && sky.contrast >= 4.5);

	// Only as far as needed: one less and the text wouldn't read
	assert.ok(contrastOf(BRIGHT, sky, "white") >= 4.5);
	assert.ok(contrastOf(BRIGHT, { ...sky, dim: sky.dim - 1 }, "white") < 4.5, "the least Dim that's enough");

	// And back down when the picture is darker
	assert.equal(solve(NIGHT).dim, 0, "a night sky needs no Dim");
	assert.ok(solve({ low: 0.4, high: 0.6, mean: 0.5 }).dim < sky.dim);

	// Picture brightness counts: the same sky made darker needs less
	assert.ok(solve(BRIGHT, { brightness: -30 }).dim < sky.dim);
	assert.ok(solve(BRIGHT, { brightness: 30 }).dim >= sky.dim);
});

test("Auto: the BACKLOG's table, row by row", () => {
	// A sky so bright that Dim alone, capped low, can't do it: what moves
	// next shows. A lower cap on Dim stands in for "Dim has reached its
	// limit".
	const capped = { ...M, dimMost: 20 };
	const run = (pinned, given) =>
		backdrop.solveGlass(
			{ ...BUSY, brightness: 0, tint: "#202020", auto: true, pinned, blur: 20, tintStrength: 12, dim: 0, font: "white", ...given },
			capped
		);

	// Nothing pinned: Dim (to its limit), then Blur, then Tint
	const none = run([]);
	assert.equal(none.dim, 20, "Dim first, to its limit");
	assert.ok(none.blur > 20, "then Blur");

	// Dim pinned: Blur, then Tint; Dim as set
	const dim = run(["dim"], { dim: 5 });
	assert.equal(dim.dim, 5);
	assert.ok(dim.blur > 20);

	// Blur pinned: Dim, then Tint; Blur as set
	const blur = run(["blur"], { blur: 3 });
	assert.equal(blur.blur, 3);
	assert.equal(blur.dim, 20);
	assert.ok(blur.tintStrength > 12, "Tint once Dim is at its limit");

	// Tint pinned: Dim, then Blur; Tint as set
	const tint = run(["tintStrength"], { tintStrength: 4 });
	assert.equal(tint.tintStrength, 4);
	assert.equal(tint.dim, 20);
	assert.ok(tint.blur > 20);

	// Dim and Blur pinned: Tint
	const dimBlur = run(["dim", "blur"], { dim: 0, blur: 0 });
	assert.deepEqual([dimBlur.dim, dimBlur.blur], [0, 0]);
	assert.ok(dimBlur.tintStrength > 12);

	// Dim and Tint pinned: Blur
	const dimTint = run(["dim", "tintStrength"], { dim: 0, tintStrength: 0 });
	assert.deepEqual([dimTint.dim, dimTint.tintStrength], [0, 0]);
	assert.ok(dimTint.blur > 20);

	// Blur and Tint pinned: Dim
	const blurTint = run(["blur", "tintStrength"], { blur: 0, tintStrength: 0 });
	assert.deepEqual([blurTint.blur, blurTint.tintStrength], [0, 0]);
	assert.ok(blurTint.dim > 0);

	// All three pinned: nothing moves
	const all = run(["dim", "blur", "tintStrength"], { dim: 1, blur: 2, tintStrength: 3 });
	assert.deepEqual([all.dim, all.blur, all.tintStrength], [1, 2, 3]);

	// Auto off is the same: everything as set by hand
	const off = run([], { auto: false, dim: 1, blur: 2, tintStrength: 3 });
	assert.deepEqual([off.dim, off.blur, off.tintStrength], [1, 2, 3]);
});

test("Auto: a slider that can't help is passed over", () => {
	// Blur on an evenly bright colour does nothing: with Dim pinned low,
	// Auto goes past Blur to the tint
	const even = solve(EVEN, { pinned: ["dim"], dim: 0, tint: "#202020", font: "white" });
	assert.equal(even.blur, M.blurDefault, "an even background: Blur counts as at its limit");
	assert.ok(even.tintStrength > M.tintStrengthDefault, "a dark tint helps white text");

	// A light tint doesn't help white text on a bright picture
	const light = solve(BRIGHT, { pinned: ["dim", "blur"], dim: 0, blur: 20, tint: "#ffffff", font: "white" });
	assert.equal(light.tintStrength, M.tintStrengthDefault, "a light tint is at its limit already");
	assert.equal(light.readable, false);
});

test("the font colour: as picked, switched only when the glass changes and it can't read", () => {
	const keep = (picture, given) =>
		backdrop.fontToKeep({ ...picture, brightness: 0, tint: "", auto: true, pinned: [], blur: 20, tintStrength: 12, dim: 0, font: "white", ...given }, M);

	// solveGlass never switches it: the font colour as picked, readable
	// or not
	const pinnedLow = { pinned: ["dim", "blur", "tintStrength"], dim: 0, blur: 0, tintStrength: 0 };
	const white = solve(BRIGHT, { ...pinnedLow, font: "white" });
	assert.equal(white.font, "white");
	assert.equal(white.readable, false);
	const black = solve(NIGHT, { font: "black" });
	assert.equal(black.font, "black");
	assert.equal(black.readable, false, "nothing lightens the glass under black text");

	// After a change: kept while Auto can make it read (Dim first)...
	assert.equal(keep(BRIGHT), "white");
	assert.equal(keep(BRIGHT, { font: "black" }), "black", "black reads on the bright sky as it is");
	// ...switched when even every free slider as far as it goes can't
	assert.equal(keep(BRIGHT, pinnedLow), "black", "white on the bright sky, nothing free to move");
	assert.equal(keep(NIGHT, { font: "black" }), "white", "black on a night sky");

	// Not when the other one reads no better
	assert.equal(keep(EVEN, { ...pinnedLow, font: "white" }), keep(EVEN, { ...pinnedLow, font: "white" }));

	// The other one's sliders start again: under black text Dim stays at 0
	assert.equal(solve(BRIGHT, { font: "black" }).dim, 0, "no Dim under black text");

	// With the settings: nothing to switch with the Default background,
	// and a change for the settings only when it switches
	const sky = {
		backgroundKind: "picture",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundLow: BRIGHT.low,
		backgroundHigh: BRIGHT.high,
		backgroundMean: BRIGHT.mean,
		glassAuto: true,
		glassPinned: ["dim", "blur", "tintStrength"],
		glassDim: 0,
		glassBlur: 0,
		glassTintStrength: 0,
		fontColour: "white"
	};
	assert.deepEqual(backdrop.recheckFont(sky), { fontColour: "black" });
	assert.deepEqual(backdrop.recheckFont({ ...sky, fontColour: "black" }), {}, "already black");
	assert.deepEqual(backdrop.recheckFont({ ...sky, backgroundKind: "plain" }), {});
	assert.equal(backdrop.fontOf({ fontColour: "auto" }), "white", "an earlier v2's Auto is white");
});

test("the tint: none, the background's dominant or vibrant colour, or one picked", () => {
	const picture = {
		backgroundKind: "picture",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundColor: "#336699",
		backgroundVibrant: "#ff6e1f"
	};
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "none" }), null);
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "dominant" }), "#336699");
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "vibrant" }), "#ff6e1f");
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "match" }), "#336699", "an earlier v2's Match is Dominant");
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "vibrant", backgroundVibrant: "" }), "#336699", "no vibrant yet: the dominant one");
	assert.equal(backdrop.tintColour({ ...picture, glassTint: "#7aa2ff" }), "#7aa2ff");

	// Dominant and Vibrant are a picture's: none over the Default, and
	// none over a colour (it would only tint the glass with what's
	// already behind it)
	assert.equal(backdrop.tintColour({ glassTint: "dominant", backgroundKind: "plain", backgroundColor: "#336699" }), null);
	assert.equal(backdrop.tintColour({ glassTint: "vibrant", backgroundKind: "plain", backgroundVibrant: "#ff6e1f" }), null);
	assert.equal(backdrop.tintColour({ glassTint: "dominant", backgroundKind: "colour", backgroundColor: "#336699" }), null);
	assert.equal(backdrop.tintColour({ glassTint: "#7aa2ff", backgroundKind: "colour", backgroundColor: "#336699" }), "#7aa2ff", "a picked one still works");
});

test("Picture brightness: Original, and where a bright new picture starts", () => {
	assert.equal(backdrop.startingBrightness(0.3), 0, "not bright: Original");
	assert.equal(backdrop.startingBrightness(0.5), 0);
	const bright = backdrop.startingBrightness(0.78);
	assert.ok(bright < 0 && bright % 5 === 0, `${bright}`);
	assert.equal(backdrop.startingBrightness(1), -25);
	assert.ok(backdrop.startingBrightness(5) >= -50, "never past -50");
	assert.equal(backdrop.startingBrightness("x"), 0);

	// In the stylesheet: 0 is the picture as it is
	const at = (value) => backdrop.glassVariables({ backgroundKind: "picture", backgroundFile: "backdrop-aaaaaaaaaaaa.jpg", pictureBrightness: value }, false);
	assert.match(at(0), /--backdrop-brightness: 1;/);
	assert.match(at(-50), /--backdrop-brightness: 0\.5;/);
	assert.match(at(20), /--backdrop-brightness: 1\.2;/);
	assert.match(at(400), /--backdrop-brightness: 1\.5;/, "brought into range");
});

test("the glass setting: in range, and only what it may be", () => {
	assert.deepEqual(backdrop.cleanGlass({ blur: 99, tint: "match", tintStrength: -5, brightness: -80, dim: 140 }), {
		glassBlur: 40,
		glassTint: "dominant",
		glassTintStrength: 0,
		glassDim: 100,
		pictureBrightness: -50
	});
	assert.deepEqual(backdrop.cleanGlass({ tint: "#7AA2FF", blur: "12.6" }), { glassTint: "#7aa2ff", glassBlur: 13 });
	assert.deepEqual(backdrop.cleanGlass({ tint: "vibrant", fontColour: "black", auto: false }), {
		glassTint: "vibrant",
		fontColour: "black",
		glassAuto: false
	});
	// Pinned: only the three names, each once, in Auto's order
	assert.deepEqual(backdrop.cleanGlass({ pinned: ["tintStrength", "x", "dim", "dim"] }), { glassPinned: ["dim", "tintStrength"] });
	assert.deepEqual(backdrop.cleanGlass({ pinned: [] }), { glassPinned: [] }, "Auto back on frees all three");
	assert.deepEqual(
		backdrop.cleanGlass({ tint: "url(x)", blur: "lots", tintStrength: null, fontColour: "red", auto: "yes", pinned: "dim" }),
		{},
		"nothing unreadable, and nothing sent is nothing changed"
	);
});

test("the glass in the stylesheet: plain, a tint, a picture", () => {
	const plain = backdrop.glassVariables({ glassBlur: 26, glassTint: "none", glassTintStrength: 12 }, false);
	assert.match(plain, /--glass-blur: 26px;/, "with the Default, the sliders as set by hand");
	assert.match(plain, /--glass-tint: transparent;/);
	assert.match(plain, /--segment-edge: transparent;/, "no edge without a picture");
	assert.ok(!plain.includes("--on-picture"), "nothing for a title on a picture without one");
	assert.ok(!plain.includes("--segment-bg"), "the palette's own fill without a picture");

	const tinted = backdrop.glassVariables({ glassBlur: 8, glassTint: "#ff0000", glassTintStrength: 20 }, false);
	assert.match(tinted, /--glass-tint: rgba\(255, 0, 0, 0\.2\);/);

	const picture = {
		backgroundKind: "picture",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundColor: "#336699",
		backgroundLow: BRIGHT.low,
		backgroundHigh: BRIGHT.high,
		backgroundMean: BRIGHT.mean,
		pictureBrightness: 0,
		glassAuto: true,
		glassPinned: [],
		glassTint: "dominant",
		glassTintStrength: 10
	};
	const glass = backdrop.glassFor(picture, false);
	assert.equal(glass.font, "white");
	assert.equal(glass.set, "dark");
	const over = backdrop.glassVariables(picture, false);
	// The Dim is darkness added to the tint: one colour over the glass
	assert.match(over, new RegExp(`--glass-tint: ${backdrop.tintWithDim("#336699", glass.tintStrength, glass.dim).replace(/[()]/g, "\\$&")};`));
	assert.ok(glass.dim > 0, "the bright sky is dimmed");
	assert.match(over, /--segment-bg: rgba\(255, 255, 255, 0\.07\);/, "white text: a whisper of white in the glass");
	// A title on the picture itself: black over this pale sky, with a
	// light shadow, whatever the font colour (that's for the glass)
	assert.match(over, /--on-picture-fg: #111;/, "a title on a pale sky: black");
	assert.ok(!over.includes("--on-picture-shadow"), "flat: no shadow or glow");
	assert.match(backdrop.glassVariables({ ...picture, fontColour: "black" }, false), /--on-picture-fg: #111;/);
	const night = { ...picture, backgroundLow: NIGHT.low, backgroundHigh: NIGHT.high, backgroundMean: NIGHT.mean };
	assert.match(backdrop.glassVariables({ ...night, fontColour: "black" }, false), /--on-picture-fg: #fff;/, "white on a night city, though the font colour is black");

	// The font colour as picked, whichever the mode; black text: the light
	// set for the text, and the same glass as under white
	assert.equal(backdrop.glassFor(picture, true).font, "white", "light mode doesn't decide it over a picture");
	const light = backdrop.glassFor({ ...picture, fontColour: "black" }, true);
	assert.equal(light.font, "black");
	assert.equal(light.set, "light");
	assert.match(backdrop.glassVariables({ ...picture, fontColour: "black" }, true), /--segment-bg: rgba\(255, 255, 255, 0\.07\);/);
	assert.match(backdrop.glassVariables({ ...picture, fontColour: "black" }, true), /--segment-edge: rgba\(255, 255, 255, 0\.16\);/);

	// No veil over the picture any more
	assert.ok(!over.includes("--backdrop-dim"));
});

test("a title on the background: white or black by the background, at its brightness", () => {
	assert.equal(backdrop.onPictureText({ mean: 0 }), "white", "black: white");
	assert.equal(backdrop.onPictureText({ mean: 1 }), "black", "white: black");
	assert.equal(backdrop.onPictureText({ mean: NIGHT.mean }), "white");
	assert.equal(backdrop.onPictureText({ mean: BRIGHT.mean }), "black");
	// A dark-ish picture made darker stays white; a mid one made brighter
	// turns black
	assert.equal(backdrop.onPictureText({ mean: 0.15, brightness: -30 }), "white");
	assert.equal(backdrop.onPictureText({ mean: 0.15, brightness: 50 }), "black");
	// Black as a colour, brighter by white laid over it: grey enough at
	// +50 for black to read better; a picture's black stays black
	assert.equal(backdrop.onPictureText({ mean: 0, brightness: 50, colour: true }), "black");
	assert.equal(backdrop.onPictureText({ mean: 0, brightness: 20, colour: true }), "white");
	assert.equal(backdrop.onPictureText({ mean: 0, brightness: 50 }), "white");
	assert.equal(backdrop.onPictureText({ mean: "x" }), "white", "nothing known: as if dark");
});

test("the tint and the Dim as one colour over the glass", () => {
	assert.equal(backdrop.tintWithDim(null, 12, 0), "transparent");
	assert.equal(backdrop.tintWithDim("#ff0000", 0, 0), "transparent");
	assert.equal(backdrop.tintWithDim("#ff0000", 20, 0), "rgba(255, 0, 0, 0.2)");
	assert.equal(backdrop.tintWithDim(null, 12, 50), "rgba(0, 0, 0, 0.5)", "Dim alone is black");
	// Black at 50% over red at 20%: 60% in all, the red a sixth of it
	// (over white, both ways give 128, 102, 102)
	assert.equal(backdrop.tintWithDim("#ff0000", 20, 50), "rgba(43, 0, 0, 0.6)");
});

test("a colour behind the pages: its own brightness, and Colour brightness lifting even black", () => {
	assert.equal(backdrop.luminance("#ffffff"), 1);
	assert.equal(backdrop.luminance("#000000"), 0);
	assert.ok(Math.abs(backdrop.luminance("#eedec5") - 0.745) < 0.001);

	const { changes } = backdrop.useColour("#FFD700");
	assert.equal(changes.backgroundKind, "colour");
	assert.equal(changes.backgroundColor, "#ffd700");
	assert.equal(changes.backgroundVibrant, "#ffd700", "a colour is its own vibrant colour");
	assert.equal(changes.backgroundFile, "", "no file with a colour");
	assert.equal(changes.backgroundLow, changes.backgroundHigh, "darkest and brightest are the colour itself");
	assert.equal(changes.backgroundMean, changes.backgroundHigh);
	assert.equal(changes.pictureBrightness, 0, "Original");
	assert.ok(backdrop.useColour("gold").error, "only #rrggbb");
	assert.ok(backdrop.useColour('#ffd700"><script>').error);

	const gold = { ...changes, glassAuto: true, glassPinned: [], glassTint: "vibrant", glassTintStrength: 10 };
	assert.ok(backdrop.hasColour(gold) && backdrop.hasBackdrop(gold) && !backdrop.hasPicture(gold));
	const glass = backdrop.glassFor(gold, false);
	assert.ok(glass.dim > 30, "a bright colour gets a darker glass under white text");
	const css = backdrop.glassVariables(gold, false);
	assert.match(css, /--segment-edge: rgba/, "the glass over a colour is the glass over a picture");
	assert.match(backdrop.backdropHtml(gold), /<span class="omni-colour" style="--colour:#ffd700"><\/span>/);
	assert.equal(backdrop.tintColour(gold), null, "Vibrant is a picture's: no tint over a colour");

	// Colour brightness: darker darkens the colour, brighter mixes white
	// into it, so black gets lighter too (multiplying black by anything
	// stays black)
	const black = { ...backdrop.useColour("#000000").changes, glassAuto: true, glassPinned: [], glassTint: "none" };
	const darker = backdrop.glassVariables({ ...black, pictureBrightness: -30 }, false);
	assert.match(darker, /--colour-brightness: 0\.7;/);
	assert.match(darker, /--colour-lift: 0;/);
	const brighter = backdrop.glassVariables({ ...black, pictureBrightness: 50 }, false);
	assert.match(brighter, /--colour-brightness: 1;/);
	assert.match(brighter, /--colour-lift: 0\.5;/);

	// ...and Auto sees it: black lifted by half needs more glass under
	// white text than black as it is
	const asIs = backdrop.glassFor({ ...black, pictureBrightness: 0 }, false);
	const lifted = backdrop.glassFor({ ...black, pictureBrightness: 50 }, false);
	assert.equal(asIs.dim, 0, "black needs no Dim");
	assert.ok(lifted.dim > asIs.dim, `lifted: Dim ${lifted.dim}`);
	// A picture isn't lifted: its brightness still multiplies
	const shadow = { ...black, backgroundKind: "picture", backgroundFile: "backdrop-aaaaaaaaaaaa.jpg", pictureBrightness: 50 };
	assert.equal(backdrop.glassFor(shadow, false).dim, 0, "black in a picture stays black");
});

test("a picture from an earlier v2 build gets its vibrant colour and overall brightness", () => {
	assert.deepEqual(backdrop.aboutPicture({ vibrant: "#FE6E1F", mean: 0.0662, color: "#000000" }), {
		changes: { backgroundVibrant: "#fe6e1f", backgroundMean: 0.0662 }
	});
	assert.ok(backdrop.aboutPicture({ vibrant: "orange", mean: 0.5 }).error);
	assert.ok(backdrop.aboutPicture({ vibrant: "#fe6e1f" }).error);
	assert.ok(backdrop.aboutPicture(null).error);
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
		assert.ok(!page.includes("var(--on-picture-fg)"), `nothing for a title on a picture on ${port} without one`);
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
	assert.ok(!/class="tint-chip[^"]*" data-tint="dominant"/.test(page), "Dominant is a picture's");
	assert.ok(!/class="tint-chip[^"]*" data-tint="vibrant"/.test(page), "so is Vibrant");
	assert.ok(!page.includes('data-tint="match"'), "Match the background is Dominant now");
	assert.ok(page.includes("never sent anywhere"));
	assert.ok(page.includes(backdrop.solveGlass.toString()), "the preview works the glass out the way the server does");
	assert.ok(page.includes(backdrop.tintWithDim.toString()));
	// The whole tab is kept with Save, or put back with Cancel, in a box
	// of its own with no heading where Appearance Mode was. Save and
	// Cancel are there only while something isn't saved; the warning is
	// said there too, so no box changes height for it. Nothing says
	// "Saved."
	const actions = page.slice(page.indexOf('id="appearance-actions"'), page.indexOf('class="type-head"'));
	assert.match(page, /<div class="segment c3 row2 lends-room tab-actions" id="appearance-actions">/);
	assert.ok(!actions.includes("<h2"), "no heading");
	assert.match(actions, /<p class="hint" id="appearance-state">Everything on this tab is saved\.<\/p>/);
	assert.match(actions, /<p class="help glass-warning" id="glass-warning"/);
	assert.match(actions, /<div class="buttons to-end" id="appearance-buttons" hidden>\s*<span class="status" id="glass-status" aria-live="polite"><\/span>\s*<button type="button" class="btn-glossy btn-glossy-neutral" id="glass-cancel">Cancel<\/button>\s*<button type="button" class="btn-glossy btn-glossy-green" id="glass-save">Save<\/button>/);
	const glassBox = page.slice(page.indexOf('id="glass"'), page.indexOf('id="background"'));
	assert.ok(!glassBox.includes("glass-warning") && !glassBox.includes("glass-save"), "nothing in Frosted glass comes and goes");
	assert.ok(!page.includes('data-mode="device"'), "Appearance Mode is gone");
	const glassScript = page.slice(page.indexOf("// --- Saving the Appearance tab"), page.indexOf("// --- Changing the background"));
	assert.ok(glassScript.includes('"Couldn\'t save."') && !glassScript.includes('"Saved."'), "only a save that fails says anything");
	assert.ok(glassScript.includes('sendPart("/appearance"'), "Text size and the Back button are saved with the rest");
	assert.ok(!page.includes("saveAppearance("), "never saved straight away any more");

	// With the Default background: no Auto, no brightness, no Dim, and
	// the font colour's strip says what it needs, with nothing to pick
	assert.ok(!page.includes('id="glass-auto"'), "nothing for Auto to read against");
	assert.ok(!page.includes('id="brightness"') && !page.includes('id="dim"'));
	assert.match(page, /<div class="inset-label">COLOUR<\/div>\s*<div class="inset-value" id="font-colour-name">With a picture or a colour<\/div>/);
	assert.ok(!page.includes('class="font-swatches"'));
	assert.ok(!page.includes('data-font="auto"'), "no Auto");

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

	// The Appearance tab's script: two functions of the same name there
	// and the second quietly replaces the first everywhere (the glass's
	// Save once went the background upload's way)
	const appearance = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((source) => source.includes("glass-save"));
	const declared = (text) => [...text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
	const glassOwn = declared(glassScript);
	assert.ok(glassOwn.includes("sendPart") && glassOwn.includes("snapshot"));
	for (const name of glassOwn) {
		assert.equal(declared(appearance).filter((other) => other === name).length, 1, `${name} once`);
	}
});

test("pages: a colour as the background, Auto and its pins, and the font colour", async () => {
	const bad = await postJson("/background/colour", { color: "red" });
	assert.equal(bad.status, 400);

	const used = await postJson("/background/colour", { color: "#1E2A44" });
	assert.equal(used.status, 200);
	const settings = readSettings();
	assert.equal(settings.backgroundKind, "colour");
	assert.equal(settings.backgroundColor, "#1e2a44");

	const page = (await request(3000, "/")).body.toString();
	assert.ok(page.includes('<span class="omni-colour" style="--colour:#1e2a44"></span>'), "drawn behind the page");
	assert.ok(page.includes('id="glass-auto" checked'), "Auto on to start with");
	assert.match(page, /<label for="dim">Dim <span class="muted" id="dim-value">0%, Auto<\/span>/, "a dark navy needs no Dim");
	assert.match(page, /<input type="range" id="dim" min="0" max="100" step="1" value="0">/);
	assert.match(page, /data-unpin="dim" hidden/, "nothing pinned");
	assert.match(page, /<label for="brightness">Colour brightness <span class="muted" id="brightness-value">Original<\/span>/);
	assert.ok(!/class="tint-chip[^"]*" data-tint="(dominant|vibrant)"/.test(page), "no Dominant or Vibrant over a colour");
	assert.match(page, /class="tint-chip active" data-tint="none"/, "None to start with");
	assert.match(page, /class="font-swatches on-colour"/, "the swatches lighten the colour as the page does");
	assert.ok(page.includes('"colour":true'), "the page knows it's a colour, for Colour brightness");
	assert.match(page, /--colour-brightness: 1;/);
	assert.match(page, /--colour-lift: 0;/);
	assert.match(page, /<div class="inset-value" id="font-colour-name">White<\/div>/);
	assert.match(page, /class="font-swatch white-text active" data-font="white" aria-pressed="true"[^>]*--swatch-picture:#1e2a44/, "on the colour itself");
	assert.match(page, /class="font-swatch black-text" data-font="black" aria-pressed="false"/);
	assert.ok(!page.includes('data-font="auto"'), "White or Black, no Auto");
	assert.ok(page.includes(backdrop.fontToKeep.toString()), "the page checks the font colour the way the server does");
	// The text colours for white and for black text, for a pick shown
	// before it's saved: in the stylesheet, the page only switches a class
	assert.match(page, /:root\.font-white \{ --fg: #[0-9a-f]+; --fg-muted: [^}]*--success-button-text: [^}]*\}/i);
	assert.match(page, /:root\.font-black \{ --fg: #111;/);
	assert.ok(page.includes('root.classList.toggle("font-black", black)'));
	assert.ok(!page.includes('createElement("style")'), "no style of its own made by the page");

	// Over a picture or a colour: a title on it gets a shadow, and a glass
	// button outside any box gets the tint and Dim, hovered or not
	assert.ok(page.includes(":is(h1, h1 + .lede):not(.segment *, .modal *) { color: var(--on-picture-fg); }"));
	assert.ok(!page.includes("text-shadow: var(--on-picture"), "no shadow or glow on a title");
	assert.match(page, /--on-picture-fg: #fff;/, "a dark navy: a white title");
	assert.ok(page.includes(backdrop.onPictureText.toString()), "the page works the title out the way the server does");
	assert.match(page, /\.glass:not\(\.segment \*, \.modal \*\):hover,[\s\S]*?background-image: linear-gradient\(var\(--glass-tint\), var\(--glass-tint\)\)/);
	for (const source of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
		assert.doesNotThrow(() => new vm.Script(source), "its scripts parse with a background too");
	}

	// Dim moved by hand: pinned, and kept as set
	assert.equal((await postJson("/background/glass", { dim: 35, pinned: ["dim"] })).status, 200);
	assert.equal(readSettings().glassDim, 35);
	assert.deepEqual(readSettings().glassPinned, ["dim"]);
	const pinned = (await request(3000, "/")).body.toString();
	assert.match(pinned, /<label for="dim">Dim <span class="muted" id="dim-value">35%<\/span>/, "no longer Auto's");
	assert.match(pinned, /data-unpin="dim" title=/, "says it's pinned");
	assert.match(pinned, /--glass-tint: rgba\(0, 0, 0, 0\.35\)/, "darkness on the glass");

	// Auto off: every slider as set by hand
	assert.equal((await postJson("/background/glass", { auto: false, dim: 10 })).status, 200);
	const off = (await request(3000, "/")).body.toString();
	assert.ok(off.includes('id="glass-auto">'), "off");
	assert.match(off, /--glass-tint: rgba\(0, 0, 0, 0\.1\)/);

	// Black picked: kept as picked, never checked straight away, though
	// it can't read on navy glass, and the page says so
	assert.equal((await postJson("/background/glass", { fontColour: "black" })).status, 200);
	assert.equal(readSettings().fontColour, "black");
	const black = (await request(3000, "/")).body.toString();
	assert.match(black, /--fg: #111;/, "black text");
	assert.match(black, /--glass-bg: rgba\(255, 255, 255, 0\.06\);/, "the glass the same as under white text");
	assert.match(black, /--input-bg: rgba\(255, 255, 255, 0\.04\);/);
	assert.match(black, /class="font-swatch black-text active" data-font="black"/);
	assert.match(black, /id="glass-warning"><\/p>/, "shown, its words filled in by the page");

	// The next change to the glass checks it: black can't read on navy,
	// so it's white again
	const changed = await postJson("/background/glass", { dim: 12, recheck: true });
	assert.equal(changed.status, 200);
	assert.equal(readSettings().fontColour, "white");
	assert.equal(changed.body.fontColour, "white", "and the page is told");

	// Without `recheck` (the font colour itself was picked), never
	await postJson("/background/glass", { fontColour: "black" });
	await postJson("/background/glass", { dim: 13 });
	assert.equal(readSettings().fontColour, "black");

	// Back to the Default for the tests after this one, and Auto back on
	// (which frees all three)
	assert.equal((await postJson("/background/plain", {})).status, 200);
	await postJson("/background/glass", { auto: true, pinned: [], dim: 0, fontColour: "white" });
	assert.deepEqual(readSettings().glassPinned, []);
});

test("pages: an MP4, its still frame, then in use on every port, signed in or not", async () => {
	const sent = await upload("/background/upload", FILES.mp4);
	assert.equal(sent.status, 200);
	assert.equal(sent.body.kind, "video");

	assert.equal((await upload("/background/still?id=" + sent.body.id, FILES.jpeg)).status, 200);

	const used = await postJson("/background/use", { id: sent.body.id, color: "#224466", vibrant: "#ff8800", low: 0.05, high: 0.4, mean: 0.2 });
	assert.equal(used.status, 200);

	const settings = readSettings();
	assert.equal(settings.backgroundKind, "video");
	assert.equal(settings.backgroundFile, `backdrop-${sent.body.id}.mp4`);
	assert.equal(settings.backgroundVibrant, "#ff8800");
	assert.equal(settings.backgroundMean, 0.2);
	assert.equal(settings.pictureBrightness, 0, "not bright: Original");

	// Every port but the About face's (1303), which has a background of
	// its own (about-face.css) and never draws this one
	for (const port of [3000, 3999, 4000]) {
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
	await postJson("/background/use", { id: sent.body.id, color: "#ffffff", low: 0.5, high: 0.9, mean: 0.8 });
	assert.ok(readSettings().pictureBrightness < 0, "a bright picture starts darker");

	// One picked by an earlier v2 build: the page works out what's missing
	assert.equal((await postJson("/background/about", { vibrant: "#3366ff", mean: 0.7 })).status, 200);
	assert.equal(readSettings().backgroundVibrant, "#3366ff");
	assert.equal((await postJson("/background/about", { vibrant: "blue" })).status, 400);

	assert.ok(!filesNow().includes(before), "the video is gone");
	assert.deepEqual(filesNow(), [`backdrop-${sent.body.id}-still.jpg`, `backdrop-${sent.body.id}.jpg`]);

	assert.equal((await postJson("/background/plain", {})).status, 200);
	assert.equal(readSettings().backgroundKind, "plain");
	assert.deepEqual(filesNow(), []);

	// With nothing behind the pages, there's nothing to work out
	assert.equal((await postJson("/background/about", { vibrant: "#3366ff", mean: 0.7 })).status, 400);
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

	// Not the About face's (1303): its look is its own, following Dark and
	// Light only
	for (const port of [3000, 3999, 4000]) {
		const page = (await request(port, "/")).body.toString();
		assert.ok(page.includes("--glass-blur: 31px;"), `blur on ${port}`);
		assert.ok(page.includes("--glass-tint: rgba(180, 140, 255, 0.2);"), `tint on ${port}`);
	}

	assert.equal(settings.pictureBrightness, 50, "brought into range");

	writeSettings({ glassBlur: 20, glassTint: "none", glassTintStrength: 12, pictureBrightness: 0 });
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
