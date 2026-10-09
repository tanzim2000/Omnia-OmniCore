// core/markdown.js
// A small, deliberately limited Markdown renderer for notification text.
//
// WHAT IT UNDERSTANDS
//
//   **bold** or __bold__
//   *italic* or _italic_
//   `code`
//   - an unordered list (also * or +)
//   1. an ordered list (also 1) )
//   # a subtitle (any number of #s -- there is only one size of
//     heading on a notification, so they all become the same subtitle)
//
// Blank lines separate paragraphs; a single line break stays a line break.
//
// WHAT IT DELIBERATELY DOESN'T
//
// Links. Nothing on a display can be clicked, so [text](url) is left
// exactly as typed. A notification that wants to point somewhere passes
// a separate `link` instead, which the overlay shows as a QR code -- see
// notifications.js. No images, no tables, no raw HTML either: this is a
// notification, not a web page.
//
// WHY IT'S SAFE TO INSERT AS MARKUP
//
// The overlay puts what this returns straight into the page. That's only
// safe because EVERY piece of the source is escaped first, before any
// Markdown is looked at; the only tags in the output are the handful this
// file writes itself (<strong>, <em>, <code>, <ul>, <ol>, <li>, <p>, <br>),
// none of them carrying an attribute taken from the source. Keep it that
// way. The moment some of the source reaches the output unescaped, every
// module able to raise a notification can put its own HTML on the screen.

// Longest description worth rendering. A notification is read in passing;
// anything much longer than this was never going to be read on a wall.
const LONGEST = 4000;

function escapeHtml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// One line's worth of inline formatting: code, bold, italic.
//
// The text arrives already escaped. Code spans are taken out first and put
// back last, so nothing inside backticks is ever read as bold or italic --
// `**` in a code span is two asterisks, not the start of bold. While
// they're out, each is replaced by a marker made of a character that can't
// appear in the source (it's stripped from it in render() below).
function inline(escaped) {
	const codes = [];

	let text = escaped.replace(/`([^`]+)`/g, (whole, code) => {
		codes.push(code);
		return "\u0000" + (codes.length - 1) + "\u0000";
	});

	// Bold before italic, so ** is never read as two single *s.
	// The text inside must start and end with something other than a space:
	// "5 * 3 * 2" is arithmetic, not italics.
	//
	// The text inside can't contain the marker itself either, at its edges
	// or anywhere else -- so a stray "***" can never close one tag inside
	// another and leave them crossed.
	text = text
		.replace(/\*\*(?=[^\s*])([^*]*?[^\s*])\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^\w])__(?=[^\s_])([^_]*?[^\s_])__(?!\w)/g, "$1<strong>$2</strong>")
		.replace(/\*(?=[^\s*])([^*]*?[^\s*])\*/g, "<em>$1</em>")
		// Underscores only count at word edges, so snake_case_names stay
		// exactly as written
		.replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");

	return text.replace(/\u0000(\d+)\u0000/g, (whole, index) => {
		return "<code>" + codes[Number(index)] + "</code>";
	});
}

// Turn notification text into the small piece of HTML the overlay shows.
// Returns "" for nothing at all.
function render(source) {
	const text = String(source === undefined || source === null ? "" : source)
		.replace(/\u0000/g, "")
		.replace(/\r\n?/g, "\n")
		.slice(0, LONGEST)
		.trim();

	if (!text) {
		return "";
	}

	const out = [];

	// What's currently open: a paragraph's lines, or a list's items
	let paragraph = [];
	let list = null; // { tag: "ul" | "ol", start, items: [] }

	function closeParagraph() {
		if (paragraph.length) {
			out.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
			paragraph = [];
		}
	}

	function closeList() {
		if (list) {
			// An ordered list keeps the number it started at: a message that
			// says "3. three, 4. four" shouldn't be renumbered to 1 and 2
			const start =
				list.tag === "ol" && list.start !== 1 ? ' start="' + list.start + '"' : "";

			out.push(
				"<" + list.tag + start + ">" +
					list.items.map((item) => "<li>" + inline(item) + "</li>").join("") +
				"</" + list.tag + ">"
			);
			list = null;
		}
	}

	for (const rawLine of text.split("\n")) {
		const line = escapeHtml(rawLine);

		if (!line.trim()) {
			closeParagraph();
			closeList();
			continue;
		}

		// Closing #s only count after a space, so "Learn C#" keeps its #
		const heading = /^\s*#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);

		if (heading) {
			closeParagraph();
			closeList();
			out.push('<p class="omni-md-subtitle">' + inline(heading[1]) + "</p>");
			continue;
		}

		const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
		const numbered = /^\s*(\d{1,9})[.)]\s+(.+)$/.exec(line);

		if (bullet || numbered) {
			const tag = bullet ? "ul" : "ol";

			closeParagraph();

			// A different kind of list starting straight after is a new list
			if (list && list.tag !== tag) {
				closeList();
			}

			if (!list) {
				list = { tag: tag, start: numbered ? Number(numbered[1]) : 1, items: [] };
			}

			list.items.push(bullet ? bullet[1] : numbered[2]);
			continue;
		}

		// An ordinary line straight after a list ends the list
		closeList();
		paragraph.push(line.trim());
	}

	closeParagraph();
	closeList();

	return out.join("");
}

module.exports = { render, LONGEST };