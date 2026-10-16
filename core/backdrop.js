// core/backdrop.js
// The picture behind OmniCore's own pages, and the frosted glass over it
// (since v2).
//
// OmniCore's pages (Settings, the setup wizard, the welcome face, About,
// an Inport's page, a face with no theme) are black by default, or light
// grey in light mode. A person can put a picture behind them instead:
//
//   a picture         JPEG, PNG or WebP
//   an animated one   GIF, animated WebP or animated PNG
//   a video           MP4 or WebM, looping, without sound
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
//   color   its main colour, for "Match the picture" (the glass tint)
//   low     how dark its darker parts are, 0-1
//   high    how bright its brighter parts are, 0-1
//   still   a still frame as a JPEG: shown instead of an animation or a
//           video to anyone whose device asks for reduced motion, and
//           while a video loads
//
// Worked out once, not while the page is showing, so the interface doesn't
// change colour as a video plays. The browser does it because it already
// has to decode the picture to show it; the server would need an image
// library for the same thing.
//
// READABLE TEXT OVER ANY PICTURE
//
// A veil (black in dark mode, the light grey in light mode) sits between
// the picture and the glass. How strong it is comes from `low` and `high`
// and the Brightness setting (autoDim below): just strong enough that the
// page's text reads against the brightest (dark mode) or darkest (light
// mode) parts of the picture.

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

// The glass: how blurred and how tinted it can be
const BLUR_MOST = 40;
const TINT_STRENGTH_MOST = 35;
const BRIGHTNESS_LEAST = 40;
const BRIGHTNESS_MOST = 120;

// Colours offered for the tint, besides Match the picture and a picker
const TINT_PRESETS = ["#7aa2ff", "#b48cff", "#ff7aa8", "#ff9d6e", "#ffd36e", "#5fd3a0"];

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

// Put a pending upload in place. Returns { changes } for the settings, or
// { error }. `about` is what the page worked out: { color, low, high }.
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

	return {
		changes: {
			backgroundKind: found.kind,
			backgroundType: found.type,
			backgroundFile: main,
			backgroundStill: still,
			backgroundColor: hexColour(details.color) || "",
			backgroundLow: unit(details.low) === null ? 0.2 : unit(details.low),
			backgroundHigh: unit(details.high) === null ? 0.8 : unit(details.high)
		}
	};
}

// The settings for no picture at all
const PLAIN = {
	backgroundKind: "plain",
	backgroundType: "",
	backgroundFile: "",
	backgroundStill: "",
	backgroundColor: "",
	backgroundLow: 0,
	backgroundHigh: 0
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

	const brightness = number(sent.brightness, BRIGHTNESS_LEAST, BRIGHTNESS_MOST);
	if (brightness !== null) changes.backgroundBrightness = brightness;

	if (sent.tint === "none" || sent.tint === "match") changes.glassTint = sent.tint;
	else if (hexColour(sent.tint)) changes.glassTint = hexColour(sent.tint);

	return changes;
}

// The tint's colour: the picked one, the picture's own for "match", or
// none. "match" without a picture is none.
function tintColour(settings) {
	if (settings.glassTint === "match") {
		return settings.backgroundKind !== "plain" ? hexColour(settings.backgroundColor) : null;
	}
	return hexColour(settings.glassTint);
}

// How strong the veil over the picture needs to be (0-1) for the page's
// text to read. A plain function, so the settings page can be sent its
// source and preview exactly what will be saved.
//
//   low, high    how dark the darker parts and how bright the brighter
//                parts of the picture are (0-1, relative luminance)
//   brightness   the Brightness setting, 40-120 (%)
//   light        light mode (dark text on a light veil) or dark mode
//                (white text on a black veil)
//
// Dark mode: white text against the brightest parts, darkened by the veil.
// Light mode: near-black text against the darkest parts, lightened by a
// veil the colour of the light page (#f2f2f4). Never less than 0.15, so a
// picture never fights the glass, and never more than 0.85, so it's still
// a picture.
function autoDim(low, high, brightness, light) {
	var target = 4.5;
	var factor = (Number(brightness) || 100) / 100;
	var veil;

	if (!light) {
		// White's luminance is 1: (1 + 0.05) / (L + 0.05) >= target
		var most = 1.05 / target - 0.05;
		var bright = Math.min(1, (Number(high) || 0) * factor);
		veil = bright <= most ? 0 : 1 - most / bright;
	} else {
		// The text, #111, has a luminance of about 0.0056
		var least = target * (0.0056 + 0.05) - 0.05;
		var dark = Math.min(1, (Number(low) || 0) * factor);
		var page = 0.886; // #f2f2f4
		veil = dark >= least ? 0 : (least - dark) / (page - dark);
	}

	// Rounded up, so rounding never takes it below what the text needs
	return Math.ceil(Math.min(0.85, Math.max(0.15, veil)) * 100 - 1e-9) / 100;
}

// --- What a page gets --------------------------------------------------------------

function hasPicture(settings) {
	return Boolean(settings && settings.backgroundKind && settings.backgroundKind !== "plain" && NAME.test(settings.backgroundFile || ""));
}

function rgba(hex, alpha) {
	const value = parseInt(hex.slice(1), 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// CSS variables for the glass and the picture, for one mode (light or
// dark). Part of uiStyles in ui-theme.js, next to the palette.
function glassVariables(settings, light) {
	const picture = hasPicture(settings);
	const tint = tintColour(settings);
	const strength = Math.min(TINT_STRENGTH_MOST, Math.max(0, Number(settings.glassTintStrength) || 0));
	const blur = Math.min(BLUR_MOST, Math.max(0, Number.isFinite(Number(settings.glassBlur)) ? Number(settings.glassBlur) : 20));
	const dim = picture ? autoDim(settings.backgroundLow, settings.backgroundHigh, settings.backgroundBrightness, light) : 0;

	return `
		--glass-blur: ${blur}px;
		--glass-tint: ${tint && strength ? rgba(tint, strength / 100) : "transparent"};
		--backdrop-brightness: ${(Number(settings.backgroundBrightness) || 100) / 100};
		--backdrop-dim: ${light ? `rgba(242, 242, 244, ${dim})` : `rgba(0, 0, 0, ${dim})`};
		${
			picture
				? `
		/* Over a picture the glass is a little more there: a fuller fill,
		   a thin light edge along the top, and a little more colour in
		   what shows through */
		--segment-bg: ${light ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.07)"};
		--segment-edge: ${light ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.16)"};
		--glass-saturate: 1.4;`
				: `
		--segment-edge: transparent;
		--glass-saturate: 1;`
		}
	`;
}

// The picture itself: the first thing inside <body> on every page that
// uses the Default UI. Nothing at all with the plain background.
//
// A picture or an animation is an <img>, inside a <picture> that swaps in
// the still frame when the device asks for reduced motion. A video starts
// from a small script rather than autoplay, so it never starts at all with
// reduced motion, and it pauses while the tab is hidden.
function backdropHtml(given) {
	const settings = given || require("./settings-store").readSettings();
	if (!hasPicture(settings)) return "";

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
</script>`;
	}

	const reduced =
		settings.backgroundKind === "animated" && still
			? `<source srcset="${still}" media="(prefers-reduced-motion: reduce)">`
			: "";

	return `
<div class="omni-backdrop" aria-hidden="true">
	<picture>${reduced}<img src="${file}" alt="" decoding="async"></picture>
</div>`;
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
	MAX_BYTES,
	MAX_STILL_BYTES,
	BLUR_MOST,
	TINT_STRENGTH_MOST,
	BRIGHTNESS_LEAST,
	BRIGHTNESS_MOST,
	TINT_PRESETS,
	TARGET_CONTRAST,
	PLAIN,
	sniff,
	receive,
	receiveStill,
	use,
	removeOthers,
	cleanGlass,
	tintColour,
	autoDim,
	hasPicture,
	glassVariables,
	backdropHtml,
	attachBackdropRoute
};
