// core/backdrop.js
// The picture behind OmniCore's own pages, and the frosted glass over it
// (since v2).
//
// OmniCore's pages (Settings, the setup wizard, the welcome face, an
// Inport's page, a face with no theme) have the Default background: black
// in dark mode, Beige Cream in light (see ui-theme.js). The About face
// keeps a look of its own (about-face.css). A person can put something
// else behind them instead:
//
//   a picture         JPEG, PNG or WebP
//   an animated one   GIF, animated WebP or animated PNG
//   a video           MP4 or WebM, looping, without sound
//   a colour          any one colour, picked on a colour wheel (since the
//                     v2 test run); backgroundKind "colour"
//
// The file is kept in OmniCore's data folder and served by OmniCore itself,
// on every port that draws its pages. It is never sent anywhere. A face
// with a theme keeps its theme's own background: this is OmniCore's look,
// not a dashboard's.
//
// WHAT IS CHECKED ABOUT A FILE
//
// Its first bytes, not its name: a file called "cat.jpg" that is really a
// web page is refused. SVG is refused outright (it can carry script), and
// so is anything not on the list above. At most MAX_BYTES.
//
// WHAT THE BROWSER WORKS OUT, ONCE, WHEN A FILE IS PICKED
//
// Before uploading, the settings page draws the picture (or one frame of a
// video) onto a small canvas, and from that works out:
//
//   color     its dominant colour: the one that covers most of it
//   vibrant   its most vibrant colour: the most saturated, eye-catching
//             one (a small orange sun on a grey-blue sky, say)
//   low       how dark its darker parts are, 0-1
//   high      how bright its brighter parts are, 0-1
//   mean      how bright it is overall, 0-1
//   still     a still frame as a JPEG: shown instead of an animation or a
//             video to anyone whose device asks for reduced motion, and
//             while a video loads
//
// Worked out once, not while the page is showing, so the interface doesn't
// change colour as a video plays. The browser does it because it already
// has to decode the picture to show it; the server would need an image
// library for the same thing. A colour is its own dominant and vibrant
// colour, and its own darker, brighter and overall brightness.
//
// READABLE TEXT OVER ANY PICTURE (since Phase A of 2.0.0)
//
// The picture is shown as it is, at the Picture brightness picked (-50%
// to +50%, Original being 0). What keeps the text readable is the glass:
//
//   Blur            how blurred the picture is through the glass
//   Tint strength   how much of the tint colour is laid over it
//   Dim             how much darkness is added to the tint
//   Font colour     white or black text (and the grey text with it). The
//                   glass looks the same either way.
//
// One Auto looks after Blur, Tint strength and Dim (solveGlass below): it
// keeps the text at a contrast of at least 4.5 against what's behind the
// glass. Moving one of the three by hand PINS it, and Auto leaves a pinned
// one alone. Auto moves Dim first, then Blur, then Tint strength, each up
// to its limit before the next, and only as far as needed.
//
// The font colour is White or Black, as picked, with nothing on the page
// saying more. But when the glass or the background changes (a slider,
// the tint, Auto, unpinning, a new picture or colour), Core checks it
// (fontToKeep below): if even with every free slider as far as it goes
// the text can't be read, it switches the font colour, and keeps the
// switch. Only then: picking the font colour itself never sets it off, so
// a person can always switch back, until the next change.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

// The biggest file accepted. Enough for a minute of 1080p video.
const MAX_BYTES = 50 * 1024 * 1024;

// The biggest still frame accepted
const MAX_STILL_BYTES = 5 * 1024 * 1024;

// A pending upload not used within this long is deleted
const PENDING_MS = 60 * 60 * 1000;

// What the page's text needs: a contrast of at least this against what's
// behind it. 4.5 is the usual line for body text.
const TARGET_CONTRAST = 4.5;

// The glass: how blurred, how tinted and how dimmed it can be, and where
// Blur and Tint strength start (Auto never takes them below these)
const BLUR_MOST = 40;
const TINT_STRENGTH_MOST = 100;
const DIM_MOST = 100;
const BLUR_DEFAULT = 20;
const TINT_STRENGTH_DEFAULT = 12;

// Picture brightness: -50 (50% darker) to +50 (50% brighter), 0 being the
// picture as it is (Original)
const BRIGHTNESS_LEAST = -50;
const BRIGHTNESS_MOST = 50;

// Colours offered for the tint, besides Dominant, Vibrant and a picker
const TINT_PRESETS = ["#7aa2ff", "#b48cff", "#ff7aa8", "#ff9d6e", "#ffd36e", "#5fd3a0"];

// The three sliders Auto looks after, in the order it moves them
const AUTO_ORDER = ["dim", "blur", "tintStrength"];

// Everything solveGlass needs to know besides the settings: one object, so
// the settings page can be sent it as it is and work out exactly what the
// server will.
//
//   fill   how much white is in the glass over a picture: a whisper of
//          it, whatever the font colour (the glass is the glass; the font
//          colour changes only the text and the small controls). The same
//          value as glassVariables below.
//   dimMost   how far Auto takes Dim: never quite black glass (by hand it
//             goes to 100%). Blur and Tint strength go as far as their
//             sliders do.
const GLASS_MODEL = {
	target: TARGET_CONTRAST,
	blurMost: BLUR_MOST,
	tintStrengthMost: TINT_STRENGTH_MOST,
	dimMost: 85,
	blurDefault: BLUR_DEFAULT,
	tintStrengthDefault: TINT_STRENGTH_DEFAULT,
	fill: 0.07
};

function folder() {
	return path.join(paths.dataDir(), "backdrop");
}

// --- What kind of file is it? -------------------------------------------------

function startsWith(buffer, bytes, at) {
	const offset = at || 0;
	if (buffer.length < offset + bytes.length) return false;
	return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer, start, end) {
	return buffer.subarray(start, Math.min(end, buffer.length)).toString("latin1");
}

// Has this PNG an animation chunk (acTL) before its first image data?
function animatedPng(buffer) {
	let at = 8;
	while (at + 8 <= buffer.length) {
		const length = buffer.readUInt32BE(at);
		const type = ascii(buffer, at + 4, at + 8);
		if (type === "acTL") return true;
		if (type === "IDAT") return false;
		at += 12 + length;
	}
	return false;
}

// The kind of file, from its first bytes. Null for anything not accepted.
//
//   { kind: "picture" | "animated" | "video", type: "image/png", ext: "png" }
function sniff(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;

	if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
		return { kind: "picture", type: "image/jpeg", ext: "jpg" };
	}

	if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return { kind: animatedPng(buffer) ? "animated" : "picture", type: "image/png", ext: "png" };
	}

	const head = ascii(buffer, 0, 6);
	if (head === "GIF87a" || head === "GIF89a") {
		// The looping extension is what makes a GIF play over and over.
		// One without it is shown as it is: a GIF is a GIF either way, and
		// a still one is just a picture.
		const looping = /NETSCAPE2\.0|ANIMEXTS1\.0/.test(ascii(buffer, 0, 4096));
		return { kind: looping ? "animated" : "picture", type: "image/gif", ext: "gif" };
	}

	if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") {
		// An extended WebP (VP8X) says in its flags whether it's animated
		const animated = ascii(buffer, 12, 16) === "VP8X" && (buffer[20] & 0x02) === 0x02;
		return { kind: animated ? "animated" : "picture", type: "image/webp", ext: "webp" };
	}

	// MP4: a "ftyp" box at byte 4, then the brand. Brands that are really
	// pictures (AVIF, HEIC) are not videos.
	if (ascii(buffer, 4, 8) === "ftyp") {
		const brand = ascii(buffer, 8, 12);
		if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return null;
		return { kind: "video", type: "video/mp4", ext: "mp4" };
	}

	// WebM: Matroska's header, saying it's the WebM kind
	if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]) && ascii(buffer, 0, 64).includes("webm")) {
		return { kind: "video", type: "video/webm", ext: "webm" };
	}

	return null;
}

// --- Keeping the files ------------------------------------------------------------

// Names this module writes, and the only ones it will ever serve or delete
const NAME = /^backdrop-[0-9a-f]{12}(-still)?\.(jpg|png|gif|webp|mp4|webm)$/;
const PENDING = /^pending-([0-9a-f]{12})(-still)?\.(jpg|png|gif|webp|mp4|webm)$/;

function newId() {
	return crypto.randomBytes(6).toString("hex");
}

// Pending uploads older than an hour are dropped (a page closed half way)
function dropOldPending() {
	let names = [];
	try {
		names = fs.readdirSync(folder());
	} catch (error) {
		return;
	}

	for (const name of names) {
		if (!PENDING.test(name)) continue;
		const file = path.join(folder(), name);
		try {
			if (fs.statSync(file).mtimeMs + PENDING_MS < Date.now()) fs.unlinkSync(file);
		} catch (error) {
			// Gone already
		}
	}
}

function pendingFiles(id) {
	let names = [];
	try {
		names = fs.readdirSync(folder());
	} catch (error) {
		return { main: null, still: null };
	}

	const match = (still) =>
		names.find((name) => {
			const parts = name.match(PENDING);
			return parts && parts[1] === id && Boolean(parts[2]) === still;
		}) || null;

	return { main: match(false), still: match(true) };
}

// A file someone picked, kept aside until it's used. Returns
// { id, kind, type } or { error }.
function receive(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		return { error: "Nothing arrived." };
	}

	if (buffer.length > MAX_BYTES) {
		return { error: "That file is bigger than 50 MB." };
	}

	const found = sniff(buffer);
	if (!found) {
		return { error: "That isn't a picture, a GIF or a video OmniCore can show. JPEG, PNG, GIF, WebP, MP4 and WebM work." };
	}

	fs.mkdirSync(folder(), { recursive: true });
	dropOldPending();

	const id = newId();
	fs.writeFileSync(path.join(folder(), `pending-${id}.${found.ext}`), buffer);

	return { id, kind: found.kind, type: found.type };
}

// The still frame for a pending upload: a JPEG, PNG or WebP picture
function receiveStill(id, buffer) {
	if (typeof id !== "string" || !/^[0-9a-f]{12}$/.test(id) || !pendingFiles(id).main) {
		return { error: "That upload isn't waiting any more. Pick the file again." };
	}

	if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_STILL_BYTES) {
		return { error: "The still frame is missing or too big." };
	}

	const found = sniff(buffer);
	if (!found || found.kind !== "picture" || found.type === "image/gif") {
		return { error: "The still frame has to be a JPEG, PNG or WebP picture." };
	}

	fs.writeFileSync(path.join(folder(), `pending-${id}-still.${found.ext}`), buffer);
	return { ok: true };
}

const unit = (value) => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
};

const hexColour = (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);

// Where Picture brightness starts for a new picture: Original, unless the
// picture is bright, then darker by about as much as brings its overall
// brightness down to the middle, in steps of 5 (never more than -50).
// Only a start: the slider is the person's from then on.
//
// A plain function, so the settings page can be sent its source and show
// a new picture in its preview at the brightness it will start at.
function startingBrightness(mean) {
	var bright = Math.min(1, Number(mean));
	if (!(bright > 0.5)) return 0;

	// The browser's brightness() multiplies each colour value, and a
	// colour value is roughly brightness to the power 1/2.2. -50 is as
	// dark as Picture brightness goes.
	var factor = Math.pow(0.5 / bright, 1 / 2.2);
	return Math.max(-50, Math.round(((factor - 1) * 100) / 5) * 5);
}

// Put a pending upload in place. Returns { changes } for the settings, or
// { error }. `about` is what the page worked out: { color, vibrant, low,
// high, mean }.
function use(id, about) {
	if (typeof id !== "string" || !/^[0-9a-f]{12}$/.test(id)) {
		return { error: "That upload isn't waiting any more. Pick the file again." };
	}

	const pending = pendingFiles(id);
	if (!pending.main) {
		return { error: "That upload isn't waiting any more. Pick the file again." };
	}

	const found = sniff(fs.readFileSync(path.join(folder(), pending.main)));
	if (!found) {
		return { error: "That upload can't be read any more. Pick the file again." };
	}
	const moving = found.kind !== "picture";

	// An animation or a video needs its still frame, for reduced motion
	if (moving && !pending.still) {
		return { error: "The still frame didn't arrive. Pick the file again." };
	}

	const details = about && typeof about === "object" ? about : {};
	const main = `backdrop-${id}.${found.ext}`;
	const still = pending.still ? `backdrop-${id}-still.${pending.still.split(".").pop()}` : "";

	fs.renameSync(path.join(folder(), pending.main), path.join(folder(), main));
	if (still) fs.renameSync(path.join(folder(), pending.still), path.join(folder(), still));

	const low = unit(details.low) === null ? 0.2 : unit(details.low);
	const high = unit(details.high) === null ? 0.8 : unit(details.high);
	const mean = unit(details.mean) === null ? (low + high) / 2 : unit(details.mean);

	return {
		changes: {
			backgroundKind: found.kind,
			backgroundType: found.type,
			backgroundFile: main,
			backgroundStill: still,
			backgroundColor: hexColour(details.color) || "",
			backgroundVibrant: hexColour(details.vibrant) || hexColour(details.color) || "",
			backgroundLow: low,
			backgroundHigh: high,
			backgroundMean: mean,
			pictureBrightness: startingBrightness(mean)
		}
	};
}

// What the page worked out about the picture already in use, for one
// picked before vibrant and mean were worked out (an earlier v2 build).
// Only those two; nothing else about the picture changes. Returns
// { changes } or { error }.
function aboutPicture(about) {
	const details = about && typeof about === "object" ? about : {};
	const vibrant = hexColour(details.vibrant);
	const mean = unit(details.mean);

	if (!vibrant || mean === null) return { error: "That isn't what the picture looks like." };
	return { changes: { backgroundVibrant: vibrant, backgroundMean: mean } };
}

// How bright a colour is, 0-1 (its relative luminance, the measure used
// for contrast), from "#rrggbb"
function luminance(hex) {
	const value = parseInt(hex.slice(1), 16);
	const channel = (shift) => {
		const c = ((value >> shift) & 255) / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

// A colour behind the pages instead of a picture. Returns { changes } for
// the settings, or { error }. Its darkest, brightest and overall brightness
// are the colour's own, and it is its own dominant and vibrant colour, so
// the glass and the tint work as they do for a picture.
function useColour(colour) {
	const hex = hexColour(colour);
	if (!hex) return { error: "That isn't a colour OmniCore can use. A colour looks like #37393e." };

	const bright = Math.round(luminance(hex) * 1000) / 1000;
	return {
		changes: {
			backgroundKind: "colour",
			backgroundType: "",
			backgroundFile: "",
			backgroundStill: "",
			backgroundColor: hex,
			backgroundVibrant: hex,
			backgroundLow: bright,
			backgroundHigh: bright,
			backgroundMean: bright,
			pictureBrightness: 0
		}
	};
}

// The settings for the Default background: nothing behind the pages but
// their own colour
const PLAIN = {
	backgroundKind: "plain",
	backgroundType: "",
	backgroundFile: "",
	backgroundStill: "",
	backgroundColor: "",
	backgroundVibrant: "",
	backgroundLow: 0,
	backgroundHigh: 0,
	backgroundMean: 0,
	pictureBrightness: 0
};

// Every picture this module wrote, except the ones named in `keep`
function removeOthers(keep) {
	let names = [];
	try {
		names = fs.readdirSync(folder());
	} catch (error) {
		return;
	}

	for (const name of names) {
		if (NAME.test(name) && !keep.includes(name)) {
			try {
				fs.unlinkSync(path.join(folder(), name));
			} catch (error) {
				// Gone already
			}
		}
	}
}

// --- The glass ------------------------------------------------------------------

// What may be saved about the glass and the picture's brightness, from what
// a page sent. Out-of-range numbers are brought into range; anything
// unreadable is left as it was.
//
//   blur, tintStrength, dim   the values set by hand: what a pinned slider,
//                             or every slider with Auto off, uses
//   auto                      the one Auto, on or off
//   pinned                    which of the three Auto leaves alone
//   brightness                Picture brightness, -50 to +50
//   tint                      "none", "dominant", "vibrant" or a colour
//   fontColour                "white" or "black"
function cleanGlass(body) {
	const sent = body && typeof body === "object" ? body : {};
	const changes = {};

	const number = (value, least, most) => {
		// Nothing sent is nothing to change, not a zero
		if (value === null || value === undefined || value === "") return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.round(Math.min(most, Math.max(least, parsed))) : null;
	};

	const blur = number(sent.blur, 0, BLUR_MOST);
	if (blur !== null) changes.glassBlur = blur;

	const strength = number(sent.tintStrength, 0, TINT_STRENGTH_MOST);
	if (strength !== null) changes.glassTintStrength = strength;

	const dim = number(sent.dim, 0, DIM_MOST);
	if (dim !== null) changes.glassDim = dim;

	const brightness = number(sent.brightness, BRIGHTNESS_LEAST, BRIGHTNESS_MOST);
	if (brightness !== null) changes.pictureBrightness = brightness;

	if (sent.auto === true || sent.auto === false) changes.glassAuto = sent.auto;

	// Only the three names, each once, in Auto's own order
	if (Array.isArray(sent.pinned)) changes.glassPinned = AUTO_ORDER.filter((name) => sent.pinned.includes(name));

	if (["none", "dominant", "vibrant"].includes(sent.tint)) changes.glassTint = sent.tint;
	else if (sent.tint === "match") changes.glassTint = "dominant";
	else if (hexColour(sent.tint)) changes.glassTint = hexColour(sent.tint);

	if (["white", "black"].includes(sent.fontColour)) changes.fontColour = sent.fontColour;

	return changes;
}

// The tint's colour: the picked one, the picture's dominant or vibrant
// one, or none. Dominant and Vibrant are a picture's: a colour behind the
// pages is its own dominant and vibrant colour, so tinting with it would
// only tint the glass with what's already behind it, and they're none
// there, as with the Default. ("match", from an earlier v2 build, is
// Dominant.)
function tintColour(settings) {
	const choice = settings.glassTint === "match" ? "dominant" : settings.glassTint;

	if (choice === "dominant" || choice === "vibrant") {
		if (!hasPicture(settings)) return null;
		const dominant = hexColour(settings.backgroundColor);
		return choice === "vibrant" ? hexColour(settings.backgroundVibrant) || dominant : dominant;
	}
	return hexColour(choice);
}

// HOW AUTO WORKS IT OUT
//
// A plain function with everything it needs passed in, so the settings page
// can be sent its source (with GLASS_MODEL) and show exactly what will be
// saved, as each slider moves.
//
//   input.low, high, mean   how dark the darker parts, how bright the
//                           brighter parts, and how bright the picture is
//                           overall (0-1, relative luminance)
//   input.brightness        Picture brightness, -50 to +50
//   input.tint              the tint's colour ("#rrggbb"), or ""
//   input.auto              the one Auto, on or off
//   input.pinned            the sliders moved by hand: "dim", "blur",
//                           "tintStrength"
//   input.blur, tintStrength, dim   the values set by hand
//   input.font              "white" or "black"
//   input.colour            true for a colour behind the pages, which is
//                           made brighter towards white (a picture's
//                           colours are multiplied, as the browser's
//                           brightness() does; black times anything is
//                           still black)
//   model                   GLASS_MODEL
//
// Returns { blur, tintStrength, dim, font, contrast, readable }.
//
// THE PICTURE BEHIND THE GLASS, AS AUTO SEES IT
//
// The text has to stand out from the worst part of the picture: the
// brightest part under white text, the darkest under black. Blur draws
// both towards the picture's overall brightness, up to halfway at the
// most, which is why it helps with bright spots and busy detail and does
// nothing on an evenly bright picture. Then, as the browser does it, on
// each colour value: Picture brightness, the glass's own white, the tint,
// and the Dim's black, each laid over what's below it.
function solveGlass(input, model) {
	var low = Number(input.low) || 0;
	var high = Number(input.high) || 0;
	var mean = Number(input.mean);
	if (!(mean > 0) || mean < low || mean > high) mean = (low + high) / 2;
	var factor = 1 + (Number(input.brightness) || 0) / 100;
	var pinned = Array.isArray(input.pinned) ? input.pinned : [];
	var tint = /^#[0-9a-f]{6}$/i.test(input.tint || "") ? parseInt(input.tint.slice(1), 16) : null;
	var tintRgb = tint === null ? null : [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];

	// Brightness (luminance) to a colour value and back
	function encode(light) {
		return light <= 0.0031308 ? light * 12.92 : 1.055 * Math.pow(light, 1 / 2.4) - 0.055;
	}
	function decode(value) {
		return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	}

	// How well text in that colour reads with the glass set like that
	function contrast(font, values) {
		var spread = (0.5 * values.blur) / model.blurMost;
		var light = font === "white" ? high - (high - mean) * spread : low + (mean - low) * spread;
		var grey = encode(Math.max(0, light));
		grey = input.colour && factor > 1 ? grey + (1 - grey) * (factor - 1) : Math.min(1, grey * factor);
		var colour = [grey, grey, grey];
		var fill = model.fill;
		var strength = tintRgb ? values.tintStrength / 100 : 0;
		var dim = values.dim / 100;
		for (var i = 0; i < 3; i++) {
			colour[i] = colour[i] * (1 - fill) + fill;
			if (strength) colour[i] = colour[i] * (1 - strength) + tintRgb[i] * strength;
			colour[i] = colour[i] * (1 - dim);
		}
		var glass = 0.2126 * decode(colour[0]) + 0.7152 * decode(colour[1]) + 0.0722 * decode(colour[2]);
		// White's luminance is 1; the black text, #111, about 0.0056
		return font === "white" ? 1.05 / (glass + 0.05) : (glass + 0.05) / 0.0556;
	}

	function free(name) {
		return input.auto !== false && pinned.indexOf(name) === -1;
	}

	function given(name, fallback, most) {
		var value = Number(input[name]);
		return Number.isFinite(value) ? Math.min(most, Math.max(0, Math.round(value))) : fallback;
	}

	// The sliders for one font colour: Dim, then Blur, then Tint strength,
	// each from where it starts (Dim from nothing, the other two from
	// their defaults) up to its limit before the next, and only as far
	// as needed. One that can't help (Dim under black text, Blur on an
	// even picture, a tint lighter than the picture under white text)
	// counts as at its limit and is left where it started.
	function solveFor(font) {
		var values = {
			dim: free("dim") ? 0 : given("dim", 0, 100),
			blur: free("blur") ? model.blurDefault : given("blur", model.blurDefault, model.blurMost),
			tintStrength: free("tintStrength")
				? model.tintStrengthDefault
				: given("tintStrength", model.tintStrengthDefault, model.tintStrengthMost)
		};
		var order = ["dim", "blur", "tintStrength"];

		for (var i = 0; i < order.length; i++) {
			var name = order[i];
			if (!free(name)) continue;

			var now = contrast(font, values);
			if (now >= model.target) break;

			var most = model[name + "Most"];
			var top = { dim: values.dim, blur: values.blur, tintStrength: values.tintStrength };
			top[name] = most;
			var best = contrast(font, top);
			if (best <= now + 0.01) continue;

			if (best < model.target) {
				values[name] = most;
				continue;
			}

			// The least that's enough
			var least = values[name];
			var enough = most;
			while (enough - least > 1) {
				var middle = Math.floor((least + enough) / 2);
				var trial = { dim: values.dim, blur: values.blur, tintStrength: values.tintStrength };
				trial[name] = middle;
				if (contrast(font, trial) >= model.target) enough = middle;
				else least = middle;
			}
			values[name] = enough;
			break;
		}

		values.font = font;
		values.contrast = contrast(font, values);
		return values;
	}

	var result = solveFor(input.font === "black" ? "black" : "white");
	result.readable = result.contrast >= model.target;
	result.contrast = Math.round(result.contrast * 100) / 100;
	return result;
}

// The font colour to keep after the glass or the background changed: the
// one picked, unless even with Auto's sliders as far as they go it can't
// be read and the other one reads better. The other one's sliders start
// again from where they start, so whatever Auto raised for the first comes
// down. Never called when the font colour itself was picked.
//
// A plain function too, sent to the settings page with solveGlass.
function fontToKeep(input, model) {
	var picked = input.font === "black" ? "black" : "white";
	var mine = solveGlass(input, model);
	if (mine.readable) return picked;

	var other = picked === "white" ? "black" : "white";
	var theirs = solveGlass(Object.assign({}, input, { font: other }), model);
	return theirs.readable || theirs.contrast > mine.contrast ? other : picked;
}

// --- What a page gets --------------------------------------------------------------

// A picture, an animation or a video: a file behind the pages
function hasPicture(settings) {
	return Boolean(settings && settings.backgroundKind && settings.backgroundKind !== "plain" && NAME.test(settings.backgroundFile || ""));
}

// A colour behind the pages instead of a picture
function hasColour(settings) {
	return Boolean(settings && settings.backgroundKind === "colour" && hexColour(settings.backgroundColor));
}

// Anything behind the pages but their own Default colour: the glass is a
// little more there, and Auto keeps the text readable over it
function hasBackdrop(settings) {
	return hasPicture(settings) || hasColour(settings);
}

// The glass for one Appearance Mode (light or dark), as it will be drawn:
//
//   { blur, tintStrength, dim, font, contrast, readable, set }
//
// `set` is which text colours go with it: "dark" (white text) or "light"
// (black text); the glass itself is the same either way. With the Default
// background behind the pages there's nothing for Auto to read against:
// the mode's own colours, Blur and Tint strength as set by hand, no Dim.
function glassFor(settings, light) {
	const pinned = Array.isArray(settings.glassPinned) ? settings.glassPinned : [];
	const auto = settings.glassAuto !== false;

	if (!hasBackdrop(settings)) {
		const kept = (name, fallback, most) => {
			const value = Number(settings[name]);
			return Number.isFinite(value) ? Math.min(most, Math.max(0, Math.round(value))) : fallback;
		};
		return {
			blur: kept("glassBlur", BLUR_DEFAULT, BLUR_MOST),
			tintStrength: kept("glassTintStrength", TINT_STRENGTH_DEFAULT, TINT_STRENGTH_MOST),
			dim: 0,
			font: light ? "black" : "white",
			contrast: null,
			readable: true,
			set: light ? "light" : "dark"
		};
	}

	const result = solveGlass(
		{
			low: settings.backgroundLow,
			high: settings.backgroundHigh,
			mean: settings.backgroundMean,
			brightness: settings.pictureBrightness,
			tint: tintColour(settings) || "",
			auto,
			pinned,
			blur: settings.glassBlur,
			tintStrength: settings.glassTintStrength,
			dim: settings.glassDim,
			font: fontOf(settings),
			colour: hasColour(settings)
		},
		GLASS_MODEL
	);
	result.set = result.font === "black" ? "light" : "dark";
	return result;
}

// The font colour as picked: white unless it's black ("auto", from an
// earlier v2 build, is white)
function fontOf(settings) {
	return settings && settings.fontColour === "black" ? "black" : "white";
}

// After the glass or the background changed: the font colour to keep, as
// a change for the settings (or nothing, when it stays). `settings` is
// them with the change already in. Nothing with the Default background.
function recheckFont(settings) {
	if (!hasBackdrop(settings)) return {};
	const input = {
		low: settings.backgroundLow,
		high: settings.backgroundHigh,
		mean: settings.backgroundMean,
		brightness: settings.pictureBrightness,
		tint: tintColour(settings) || "",
		auto: settings.glassAuto !== false,
		pinned: Array.isArray(settings.glassPinned) ? settings.glassPinned : [],
		blur: settings.glassBlur,
		tintStrength: settings.glassTintStrength,
		dim: settings.glassDim,
		font: fontOf(settings),
		colour: hasColour(settings)
	};
	const keep = fontToKeep(input, GLASS_MODEL);
	return keep === fontOf(settings) ? {} : { fontColour: keep };
}

function rgba(hex, alpha) {
	const value = parseInt(hex.slice(1), 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// The tint and the Dim as ONE colour laid over the glass: the tint at its
// strength, then black at the Dim's over that. Every piece of glass already
// has a tint layer (--glass-tint), so Dim darkening the glass needs nothing
// new on any of them.
//
// A plain function, so the settings page can be sent its source too.
function tintWithDim(tint, strength, dim) {
	var a = tint ? strength / 100 : 0;
	var d = dim / 100;
	var alpha = d + a * (1 - d);
	if (alpha <= 0) return "transparent";

	var value = tint ? parseInt(tint.slice(1), 16) : 0;
	function part(shift) {
		return Math.round((((value >> shift) & 255) * a * (1 - d)) / alpha);
	}
	return "rgba(" + part(16) + ", " + part(8) + ", " + part(0) + ", " + Math.round(alpha * 1000) / 1000 + ")";
}

// Text drawn straight on the background, with no glass under it (a
// page's title): white or black by the background itself, at its
// brightness, never by the font colour. The font colour is for text on
// the glass; black over a black picture, with only a glow to show it,
// can't be read. `input` is { mean, brightness, colour }: the background's
// overall brightness (luminance, 0 to 1), the brightness slider (-50 to
// +50), and whether it's a colour (brighter by white laid over it) rather
// than a picture (brighter by multiplying).
//
// A plain function, so the settings page can be sent its source too.
function onPictureText(input) {
	var light = Math.max(0, Math.min(1, Number(input.mean) || 0));
	var factor = 1 + (Number(input.brightness) || 0) / 100;
	var value = light <= 0.0031308 ? light * 12.92 : 1.055 * Math.pow(light, 1 / 2.4) - 0.055;
	value = input.colour && factor > 1 ? value + (1 - value) * (factor - 1) : Math.min(1, value * factor);
	light = value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	// Whichever reads better: white against it, or black (#111) against it
	return 1.05 / (light + 0.05) >= (light + 0.05) / 0.0556 ? "white" : "black";
}

// CSS variables for the glass and the picture, for one Appearance Mode
// (light or dark). Part of uiStyles in ui-theme.js, after the palette
// (which glassFor's `set` picked).
function glassVariables(settings, light) {
	const glass = glassFor(settings, light);
	const picture = hasBackdrop(settings);
	const tint = tintColour(settings);
	const onIt = picture
		? onPictureText({ mean: settings.backgroundMean, brightness: settings.pictureBrightness, colour: hasColour(settings) })
		: null;
	const brightness = Math.min(BRIGHTNESS_MOST, Math.max(BRIGHTNESS_LEAST, Number(settings.pictureBrightness) || 0));

	return `
		--glass-blur: ${glass.blur}px;
		--glass-tint: ${tintWithDim(tint, glass.tintStrength, glass.dim)};
		--backdrop-brightness: ${(100 + brightness) / 100};
		/* A colour behind the pages: darker by brightness() like a
		   picture, brighter by white laid over it (brightness() can't
		   make black any brighter) */
		--colour-brightness: ${(100 + Math.min(0, brightness)) / 100};
		--colour-lift: ${Math.max(0, brightness) / 100};
		${
			picture
				? `
		/* Over a picture the glass is a little more there: a fuller fill,
		   a thin light edge along the top, and a little more colour in
		   what shows through. The same whatever the font colour. */
		--segment-bg: rgba(255, 255, 255, ${GLASS_MODEL.fill});
		--segment-edge: rgba(255, 255, 255, 0.16);
		--glass-saturate: 1.4;
		/* Text drawn straight on the picture, with no glass under it (a
		   page's title): white or black by the picture itself, whatever
		   the font colour. Flat, with no shadow or glow. */
		--on-picture-fg: ${onIt === "black" ? "#111" : "#fff"};`
				: `
		--segment-edge: transparent;
		--glass-saturate: 1;`
		}
	`;
}

// THE BACKGROUND FADES IN (since the v2 test run)
//
// Two moments it used to just pop:
//
//   1. A picture or a video that takes a moment to load: until it has, the
//      page shows its Default colour, then the picture appears all at once.
//      Now it fades in once it's ready. One that's already loaded (from the
//      browser's cache, going from page to page) is simply there, with no
//      fade every time.
//   2. Changing the background (a new picture, a colour, Default) or
//      switching Dark and Light. Both reload the page, and the old
//      background vanished before the new one was drawn. Now, just before
//      the reload, the page keeps a copy of what's behind it
//      (omniKeepBackdrop, in sessionStorage: what's on the screen, with
//      its brightness as it looks right now). The next page puts
//      that copy on top of its own background, and once its own is ready,
//      fades the copy away: the old background turns into the new one.
//
// With reduced motion there's no fade: the new background is just there.
const BACKDROP_SCRIPT = `
<script>
	(function () {
		var KEY = "omnicore-backdrop-was";
		var FADE_MS = 700;
		var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		var layer = document.querySelector(".omni-backdrop");

		// Kept just before a reload; called by the Dark and Light switch and
		// by Change background's Use
		window.omniKeepBackdrop = function () {
			try {
				var kept = { at: Date.now(), bg: getComputedStyle(document.body).backgroundColor, html: "" };
				var now = document.querySelector(".omni-backdrop");
				if (now) {
					var box = getComputedStyle(now);
					kept.bg = box.backgroundColor;
					// Its size and place too: the settings home draws it wider
					// than the screen and slides it along with the tabs
					kept.width = box.width;
					kept.transform = box.transform === "none" ? "" : box.transform;
					var picture = now.querySelector("img");
					var video = now.querySelector("video");
					var colour = now.querySelector(".omni-colour");
					var shown = picture || video || colour;
					var filter = shown ? getComputedStyle(shown).filter : "none";
					if (picture) kept.html = '<img src="' + (picture.currentSrc || picture.src) + '" alt="">';
					else if (video && video.poster) kept.html = '<img src="' + video.poster + '" alt="">';
					else if (colour) kept.html = '<span class="omni-colour" style="--colour:' + colour.style.getPropertyValue("--colour") + '"></span>';
					kept.filter = filter === "none" ? "" : filter;
				}
				sessionStorage.setItem(KEY, JSON.stringify(kept));
			} catch (error) {}
		};

		// Is the page's own background ready to be seen?
		function ready(done) {
			var picture = layer && layer.querySelector("img");
			var video = layer && layer.querySelector("video");
			var called = false;
			function once() { if (!called) { called = true; done(); } }
			if (picture && !(picture.complete && picture.naturalWidth)) {
				picture.addEventListener("load", once);
				picture.addEventListener("error", once);
			} else if (video && video.readyState < 2) {
				video.addEventListener("loadeddata", once);
				video.addEventListener("error", once);
			} else {
				once();
				return;
			}
			// A picture that never comes doesn't keep the old one forever
			setTimeout(once, 4000);
		}

		// What was behind the last page, if it just reloaded into this one
		var was = null;
		try {
			was = JSON.parse(sessionStorage.getItem(KEY) || "null");
			sessionStorage.removeItem(KEY);
		} catch (error) {}
		if (was && Date.now() - was.at > 10000) was = null;

		if (was && !still) {
			var old = document.createElement("div");
			old.className = "omni-backdrop-was";
			old.setAttribute("aria-hidden", "true");
			// What it looked like, as CSS variables its rules read (ui-theme.js)
			old.style.setProperty("--was-bg", was.bg);
			if (was.width) old.style.setProperty("--was-width", was.width);
			if (was.transform) old.style.setProperty("--was-transform", was.transform);
			if (was.filter) old.style.setProperty("--was-filter", was.filter);
			old.innerHTML = was.html || "";
			// On top of this page's own background, under everything else
			if (layer) layer.insertAdjacentElement("afterend", old);
			else document.body.insertBefore(old, document.body.firstChild);

			ready(function () {
				requestAnimationFrame(function () {
					old.classList.add("going");
					setTimeout(function () { old.remove(); }, FADE_MS + 100);
				});
			});
			return;
		}

		// No hand-over: a picture still loading fades in once it's ready.
		// One already there (from the cache) is left alone: no fade on
		// every page.
		if (layer && !still) {
			var picture = layer.querySelector("img");
			var video = layer.querySelector("video");
			if ((picture && !(picture.complete && picture.naturalWidth)) || (video && video.readyState < 2)) {
				layer.classList.add("omni-waiting");
				ready(function () {
					requestAnimationFrame(function () { layer.classList.remove("omni-waiting"); });
				});
			}
		}
	})();
</script>`;

// The picture itself: the first thing inside <body> on every page that
// uses the Default UI. Nothing at all with the plain background.
//
// A picture or an animation is an <img>, inside a <picture> that swaps in
// the still frame when the device asks for reduced motion. A video starts
// from a small script rather than autoplay, so it never starts at all with
// reduced motion, and it pauses while the tab is hidden.
function backdropHtml(given) {
	const settings = given || require("./settings-store").readSettings();

	// A colour: one layer of it, at the brightness picked, like a picture
	if (hasColour(settings)) {
		return `
<div class="omni-backdrop" aria-hidden="true"><span class="omni-colour" style="--colour:${hexColour(settings.backgroundColor)}"></span></div>${BACKDROP_SCRIPT}`;
	}

	// The Default: nothing to draw, but the script still runs, for the
	// fade from whatever was here before a reload
	if (!hasPicture(settings)) return BACKDROP_SCRIPT;

	const file = `/backdrop/${settings.backgroundFile}`;
	const still = settings.backgroundStill ? `/backdrop/${settings.backgroundStill}` : "";

	if (settings.backgroundKind === "video") {
		return `
<div class="omni-backdrop" aria-hidden="true">
	<video src="${file}"${still ? ` poster="${still}"` : ""} muted loop playsinline preload="auto" disablepictureinpicture tabindex="-1"></video>
</div>
<script>
	(function () {
		var video = document.querySelector(".omni-backdrop video");
		var still = window.matchMedia("(prefers-reduced-motion: reduce)");
		function play() {
			if (still.matches || document.hidden) video.pause();
			else video.play().catch(function () {});
		}
		document.addEventListener("visibilitychange", play);
		if (still.addEventListener) still.addEventListener("change", play);
		play();
	})();
</script>${BACKDROP_SCRIPT}`;
	}

	const reduced =
		settings.backgroundKind === "animated" && still
			? `<source srcset="${still}" media="(prefers-reduced-motion: reduce)">`
			: "";

	return `
<div class="omni-backdrop" aria-hidden="true">
	<picture>${reduced}<img src="${file}" alt="" decoding="async"></picture>
</div>${BACKDROP_SCRIPT}`;
}

// GET /backdrop/<file> on a face's own Express app: the picture and its
// still frame, and nothing else. Mounted on every port that draws the
// Default UI, because a page asks its own port for it. Before any sign-in
// check: the sign-in page shows the picture too.
function attachBackdropRoute(app) {
	app.get("/backdrop/:name", (req, res) => {
		const { readSettings } = require("./settings-store");
		const settings = readSettings();
		const name = req.params.name;

		if (!NAME.test(name) || (name !== settings.backgroundFile && name !== settings.backgroundStill)) {
			res.status(404).end();
			return;
		}

		// A new picture is a new name, so an old one can be kept forever
		res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
		res.sendFile(path.join(folder(), name), (error) => {
			if (error && !res.headersSent) res.status(404).end();
		});
	});
}

module.exports = {
	BACKDROP_SCRIPT,
	MAX_BYTES,
	MAX_STILL_BYTES,
	BLUR_MOST,
	TINT_STRENGTH_MOST,
	DIM_MOST,
	BLUR_DEFAULT,
	TINT_STRENGTH_DEFAULT,
	BRIGHTNESS_LEAST,
	BRIGHTNESS_MOST,
	TINT_PRESETS,
	TARGET_CONTRAST,
	AUTO_ORDER,
	GLASS_MODEL,
	PLAIN,
	luminance,
	useColour,
	hasColour,
	hasBackdrop,
	sniff,
	receive,
	receiveStill,
	use,
	aboutPicture,
	startingBrightness,
	removeOthers,
	cleanGlass,
	tintColour,
	solveGlass,
	fontToKeep,
	fontOf,
	recheckFont,
	glassFor,
	tintWithDim,
	onPictureText,
	hasPicture,
	glassVariables,
	backdropHtml,
	attachBackdropRoute
};
