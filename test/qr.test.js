// test/qr.test.js
// The QR engine and the `qr` block type.
//
// No servers and no network here, unlike the rest of the suite -- this is
// pure input and output, so it runs in a fraction of a second. The one
// test that goes through a real face over real HTTP lives in
// faces.test.js with the others.
//
// What this can't prove on its own is that a phone will actually read
// the result. The round-trip test below gets as close as a test with no
// camera can: it proves the SVG draws exactly the squares the encoder
// decided on, no more and no fewer. The encoder itself is a well-used
// library, and whether its output scans is its own test suite's job.

const test = require("node:test");
const assert = require("node:assert");

const qrcode = require("qrcode-generator");
const qr = require("../core/qr");
const { toBlocks } = require("../core/envelope");

// Read the SVG's path back into a grid of dark squares.
//
// The path is a run of rectangles, each "M x y h width v1 h-width z" --
// see darkPath() in core/qr.js. Every one of them is expanded back into
// the individual squares it covers, with the quiet zone taken off again
// so the grid lines up with the encoder's own coordinates.
function gridFromSvg(svg) {
	const dark = new Set();
	const pattern = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
	let match;

	while ((match = pattern.exec(svg)) !== null) {
		const x = Number(match[1]) - qr.QUIET_ZONE;
		const y = Number(match[2]) - qr.QUIET_ZONE;
		const width = Number(match[3]);

		for (let step = 0; step < width; step++) {
			dark.add(`${y},${x + step}`);
		}
	}

	return dark;
}

test("qr: a link becomes an SVG", () => {
	const svg = qr.toSvg("https://ntfy.sh/GitHub");

	assert.ok(svg, "expected a drawing, got nothing");
	assert.ok(svg.startsWith("<svg"), "not an SVG");
	assert.ok(svg.includes("viewBox="), "no viewBox -- it won't scale");
});

test("qr: the same value always draws the same code", () => {
	// Matters beyond neatness: the tile's ETag is built from its blocks,
	// so a drawing that varied between polls would make every poll look
	// like new content to a theme that animates on change.
	assert.equal(
		qr.toSvg("https://example.com/same"),
		qr.toSvg("https://example.com/same")
	);
});

test("qr: the drawing is exactly the encoder's squares", () => {
	const value = "http://192.168.1.50:8080/alerts";

	// The encoder's own answer, asked directly with the same settings
	const code = qrcode(0, "M");
	code.addData(value, "Byte");
	code.make();

	const expected = new Set();
	const count = code.getModuleCount();

	for (let row = 0; row < count; row++) {
		for (let col = 0; col < count; col++) {
			if (code.isDark(row, col)) {
				expected.add(`${row},${col}`);
			}
		}
	}

	const drawn = gridFromSvg(qr.toSvg(value));

	assert.equal(drawn.size, expected.size, "a different number of dark squares");

	for (const square of expected) {
		assert.ok(drawn.has(square), `square ${square} is missing from the SVG`);
	}
});

test("qr: text is encoded as UTF-8", () => {
	// The library's default reads one byte per character, which turns a
	// Bangla name or an emoji into a code that scans as garbage. core/qr.js
	// switches it on load; this is what stops that line being "tidied" away.
	assert.equal(qrcode.stringToBytes, qrcode.stringToBytesFuncs["UTF-8"]);
	assert.ok(qr.toSvg("তানজীম ✓"), "non-Latin text should still draw");
});

test("qr: nothing a module sent ever appears in the markup", () => {
	// A theme inserts this SVG as raw HTML. If the value could leak into
	// it, any module could put a script on somebody's dashboard.
	const hostile = '"><script>alert(1)</script><img src=x onerror=alert(1)>';
	const svg = qr.toSvg(hostile);

	assert.ok(svg, "a hostile value is still a value -- it should draw");
	assert.ok(!svg.includes("script"), "the value leaked into the SVG");
	assert.ok(!svg.includes("onerror"), "the value leaked into the SVG");
});

test("qr: nothing drawable gives null, not an error", () => {
	assert.equal(qr.toSvg(""), null);
	assert.equal(qr.toSvg(null), null);
	assert.equal(qr.toSvg(undefined), null);

	// Well past what any QR code can hold
	assert.equal(qr.toSvg("y".repeat(5000)), null);
});

test("qr block: OmniCore adds the drawing and a text fallback", () => {
	const [block] = toBlocks({
		content: [
			{ type: "qr", value: "https://ntfy.sh/GitHub", label: "Scan to subscribe" }
		]
	});

	assert.ok(block.svg && block.svg.startsWith("<svg"), "no drawing attached");
	assert.equal(block.text, "Scan to subscribe: https://ntfy.sh/GitHub");

	const [unlabelled] = toBlocks({
		content: [{ type: "qr", value: "https://ntfy.sh/GitHub" }]
	});

	assert.equal(unlabelled.text, "https://ntfy.sh/GitHub");
});

test("qr block: a module can't supply its own svg", () => {
	const [block] = toBlocks({
		content: [
			{
				type: "qr",
				value: "https://example.com",
				svg: "<img src=x onerror=alert(1)>"
			}
		]
	});

	assert.ok(!block.svg.includes("onerror"), "the module's svg survived");
	assert.equal(block.svg, qr.toSvg("https://example.com"));
});

test("qr block: an undrawable value still falls back to text", () => {
	const [block] = toBlocks({
		content: [{ type: "qr", value: "z".repeat(5000) }]
	});

	assert.equal(block.svg, null);
	assert.equal(block.text, "z".repeat(5000));
});