// core/qr.js
// Turns a string into a QR code, drawn as SVG.
//
// WHY THIS IS CORE'S JOB
//
// A module that wants to show a QR code only knows WHAT belongs in it --
// a link, a topic to subscribe to, a Wi-Fi login. How that becomes a
// code is identical for everyone, and it's genuinely fiddly: error
// correction, masking, picking the smallest size the data fits in.
// Doing it once, here, means no module ships its own encoder and no
// theme has to carry one either. A module says `{ type: "qr", value }`,
// OmniCore adds the drawing (see envelope.js), and the theme only
// decides where it goes and how big.
//
// It lives in its own file rather than inside envelope.js because
// module content isn't the only thing that needs it: anything in Core
// that wants to put a scannable code on a screen calls toSvg() directly.
//
// WHY THE SVG IS SAFE TO INSERT AS MARKUP
//
// A theme drops this string straight into its page. That is only safe
// because nothing a module sent ever appears inside it: the SVG is
// built purely from the grid of dark and light squares the encoder
// produced -- numbers, never text. The value itself is never written
// into the markup, not as a title, not as an aria-label, not anywhere.
// Keep it that way. The moment a module-supplied string lands inside
// this SVG, every theme that inserts it becomes an injection hole.
//
// WHY IT'S BLACK ON WHITE WITH A BORDER, WHATEVER THE THEME LOOKS LIKE
//
// A QR code is only worth drawing if a phone can read it, and phones
// are fussier than they look. Plenty of scanner apps can't read an
// inverted code (light squares on dark), and all of them need a blank
// margin -- the "quiet zone" -- around the code to find its edges. So
// both are baked in: black squares on a white square, four squares of
// border on every side, which is what the QR specification asks for.
// A theme CAN restyle it through the two class names below, since CSS
// wins over fill attributes -- but the default is the one that scans.

const qrcode = require("qrcode-generator");

// The encoder reads text one byte per character unless told otherwise,
// which quietly mangles anything outside basic Latin -- a Bangla name,
// an emoji, an accented word -- into a code that scans as garbage.
// Switched to UTF-8 once, here, for the whole process. Every modern
// scanner reads UTF-8.
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

// How much of the code can be smudged, glared or covered and still
// read. "M" recovers from roughly 15% -- the usual choice for a code
// shown on a screen, where the risk is glare and distance rather than a
// torn sticker.
const ERROR_CORRECTION = "M";

// Blank squares around the code on every side. Four is what the QR
// specification requires; with less, some scanners can't find the edges.
const QUIET_ZONE = 4;

// A face asks every tile for its content every few seconds, forever,
// and a QR block's value almost never changes between two polls.
// Encoding isn't expensive, but the machine this runs on isn't fast
// either, so finished drawings are remembered by value.
//
// Bounded, so a module that puts something new in its code on every
// poll (a timestamp inside a link, say) can't grow this forever: once
// it's full, the drawing used least recently is forgotten first.
const CACHE_LIMIT = 64;
const cache = new Map();

// The dark squares, as one SVG path.
//
// Neighbouring dark squares in the same row are merged into one
// rectangle rather than drawn one by one. A typical link then comes out
// at a few kilobytes instead of hundreds of separate shapes -- which
// matters, since this travels to the display on every poll.
//
// Each rectangle is "move to its top-left corner, go right by its
// width, down one, back left by its width, close": M x y h w v1 h-w z.
function darkPath(code, count) {
	const parts = [];

	for (let row = 0; row < count; row++) {
		let col = 0;

		while (col < count) {
			if (!code.isDark(row, col)) {
				col++;
				continue;
			}

			// Walk to the end of this run of dark squares
			const start = col;

			while (col < count && code.isDark(row, col)) {
				col++;
			}

			const width = col - start;

			parts.push(
				`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${width}v1h-${width}z`
			);
		}
	}

	return parts.join("");
}

// Encode a value and draw it. Throws if the value is too big to fit.
function draw(value) {
	// 0 means "pick the smallest QR size this data fits in" rather than
	// forcing one -- a short link gets a small, easy-to-scan code
	const code = qrcode(0, ERROR_CORRECTION);

	// "Byte" mode carries any text at all, which is what the UTF-8
	// switch above is for
	code.addData(value, "Byte");
	code.make();

	// How many squares wide the code itself is, and with its border
	const count = code.getModuleCount();
	const full = count + QUIET_ZONE * 2;

	// A viewBox and no width or height, so the drawing scales to
	// whatever box the theme puts it in without ever going blurry.
	// crispEdges stops the browser anti-aliasing the seams between
	// squares into faint grey lines.
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}"` +
		` shape-rendering="crispEdges" class="omni-qr">` +
		`<rect class="omni-qr-light" width="${full}" height="${full}" fill="#ffffff"/>` +
		`<path class="omni-qr-dark" fill="#000000" d="${darkPath(code, count)}"/>` +
		`</svg>`
	);
}

// The SVG for a value, or null when there's nothing that can be drawn.
//
// Null rather than an error in both cases -- an empty value, and one
// too long for any QR code to hold (roughly 2,300 characters of plain
// text at this error-correction level). Whatever called this still has
// the value itself as text to fall back on, so one oversized value
// costs a picture, not a tile.
function toSvg(value) {
	if (value === undefined || value === null) {
		return null;
	}

	const text = String(value);

	if (text === "") {
		return null;
	}

	if (cache.has(text)) {
		// Taken out and put back so it counts as recently used -- a Map
		// remembers insertion order, and the oldest entry is the one
		// forgotten when it's full
		const svg = cache.get(text);
		cache.delete(text);
		cache.set(text, svg);
		return svg;
	}

	let svg;

	try {
		svg = draw(text);
	} catch (error) {
		svg = null;
	}

	// Remembered even when it's null, so an oversized value isn't
	// re-attempted -- and failed again -- on every single poll
	cache.set(text, svg);

	if (cache.size > CACHE_LIMIT) {
		cache.delete(cache.keys().next().value);
	}

	return svg;
}

module.exports = { toSvg, QUIET_ZONE };