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
//   | a | table |   (see TABLES below)
//
// Blank lines separate paragraphs; a single line break stays a line break.
//
// Emoji need nothing from this file. They're ordinary characters and come
// out exactly as they went in; whether they show as colour pictures is up
// to the fonts, and the overlay always lists emoji fonts for that (see
// notifications.js).
//
// TABLES
//
// The usual Markdown table: a header row, a row of dashes under it, then
// the rows themselves.
//
//     | Job   | Result |
//     | ----- | :----: |
//     | build | passed |
//
// The row of dashes has to have as many cells as the header, or it isn't a
// table and is shown as ordinary text. Colons in it (alignment) are
// accepted and ignored -- every cell is lined up on the left. A | inside a
// cell is written \|. The table ends at a blank line, or at a line with no
// | in it.
//
// At most TABLE_MOST_COLUMNS columns and TABLE_MOST_ROWS rows, the header
// counting as one of those rows. Anything past that is left out, and a
// short line under the table says how much was. A wall display isn't a
// spreadsheet: a table any bigger than that can't be read in passing.
//
// WHAT IT DELIBERATELY DOESN'T
//
// Links. Nothing on a display can be clicked, so [text](url) is left
// exactly as typed. A notification that wants to point somewhere passes
// a separate `link` instead, which the overlay shows as a QR code -- see
// notifications.js. No images and no raw HTML either: this is a
// notification, not a web page.
//
// WHY IT'S SAFE TO INSERT AS MARKUP
//
// The overlay puts what this returns straight into the page. That's only
// safe because EVERY piece of the source is escaped first, before any
// Markdown is looked at; the only tags in the output are the handful this
// file writes itself (<strong>, <em>, <code>, <ul>, <ol>, <li>, <p>, <br>,
// <table>, <thead>, <tbody>, <tr>, <th>, <td>), none of them carrying an
// attribute taken from the source. Keep it that way. The moment some of
// the source reaches the output unescaped, every module able to raise a
// notification can put its own HTML on the screen.

// Longest description worth rendering. A notification is read in passing;
// anything much longer than this was never going to be read on a wall.
const LONGEST = 4000;

// The biggest table shown. Rows include the header, so 11 rows is the
// header and 10 rows under it.
const TABLE_MOST_COLUMNS = 6;
const TABLE_MOST_ROWS = 11;

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

// One table row's cells, from a line like "| a | b |".
//
// The | at either end is optional, as in most Markdown. A \| is a | that
// belongs to the cell's text rather than one that ends it.
function splitRow(line) {
	let row = line.trim();

	if (row.startsWith("|")) {
		row = row.slice(1);
	}

	if (row.endsWith("|") && !row.endsWith("\\|")) {
		row = row.slice(0, -1);
	}

	const cells = [];
	let cell = "";

	for (let index = 0; index < row.length; index++) {
		const character = row[index];

		if (character === "\\" && row[index + 1] === "|") {
			cell += "|";
			index++;
			continue;
		}

		if (character === "|") {
			cells.push(cell.trim());
			cell = "";
			continue;
		}

		cell += character;
	}

	cells.push(cell.trim());
	return cells;
}

// Is this the row of dashes that goes under a table's header? Every cell
// has to be dashes, with an optional colon at either end.
function isDividerRow(line) {
	if (!line.includes("|") && !line.includes("-")) {
		return false;
	}

	return splitRow(line).every((cell) => /^:?-+:?$/.test(cell));
}

// Does a table start at lines[index]? Its own line has a | in it, and the
// next line is a divider with exactly as many cells.
function startsTable(lines, index) {
	const header = lines[index];
	const divider = lines[index + 1];

	if (divider === undefined || !header.includes("|") || !isDividerRow(divider)) {
		return false;
	}

	return splitRow(header).length === splitRow(divider).length;
}

// "1 more row", "3 more rows"
function count(number, word) {
	return number + " more " + word + (number === 1 ? "" : "s");
}

// A table's HTML, cut down to the size limits, plus the line saying what
// was cut when anything was.
//
// `header` is a list of cells; `rows` a list of lists. Every cell is
// already escaped.
function renderTable(header, rows) {
	const columns = Math.min(header.length, TABLE_MOST_COLUMNS);
	const shownRows = rows.slice(0, TABLE_MOST_ROWS - 1);

	// Short rows are filled out with empty cells and long ones cut, so
	// every row lines up under the header
	function cells(row, tag) {
		let html = "";

		for (let column = 0; column < columns; column++) {
			html += "<" + tag + ">" + inline(row[column] || "") + "</" + tag + ">";
		}

		return "<tr>" + html + "</tr>";
	}

	let html =
		"<table>" +
			"<thead>" + cells(header, "th") + "</thead>" +
			(shownRows.length
				? "<tbody>" + shownRows.map((row) => cells(row, "td")).join("") + "</tbody>"
				: "") +
		"</table>";

	// Columns past the limit, counted on whichever row is widest -- a row
	// can have more cells than the header, and those are left off too
	const widest = Math.max(header.length, ...shownRows.map((row) => row.length));
	const hiddenRows = rows.length - shownRows.length;
	const hiddenColumns = widest - columns;
	const hidden = [];

	if (hiddenRows > 0) {
		hidden.push(count(hiddenRows, "row"));
	}

	if (hiddenColumns > 0) {
		hidden.push(count(hiddenColumns, "column"));
	}

	if (hidden.length) {
		html += '<p class="omni-md-table-more">…' + hidden.join(" and ") + " not shown</p>";
	}

	return html;
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

	// Escaped up front, all at once, so a table can look one line ahead
	const lines = text.split("\n").map(escapeHtml);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (!line.trim()) {
			closeParagraph();
			closeList();
			continue;
		}

		if (startsTable(lines, index)) {
			closeParagraph();
			closeList();

			const header = splitRow(line);
			const rows = [];

			// Skip the header and the divider, then take rows until a blank
			// line or a line that isn't one
			index += 2;

			while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
				rows.push(splitRow(lines[index]));
				index++;
			}

			// The loop's own index++ moves past the line that ended the table
			// otherwise; step back so that line is read normally
			index--;

			out.push(renderTable(header, rows));
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

module.exports = { render, LONGEST, TABLE_MOST_COLUMNS, TABLE_MOST_ROWS };