// core/upgrade-notes.js
// The document a major version brings with it (since 1.20.0): what's about
// to change, what's changing, why to upgrade. Read in full on the settings
// home before Upgrade can be pressed.
//
// WHERE IT COMES FROM
//
// docs/upgrades/<version>.md in OmniCore's repository, at that version's
// own release tag (v2.0.0 for 2.0.0), fetched from GitHub when somebody
// opens it. At the tag, never a branch: what's read is exactly what's
// installed. A major version without that file falls back to its release
// notes (its CHANGELOG entry), so there's always something to read.
//
// HOW IT'S DRAWN
//
// A small Markdown renderer of its own, for exactly what such a document
// needs: headings, paragraphs, lists (bulleted and numbered), quotes, code
// (in a line and in blocks), bold, italic and links. Everything is escaped
// FIRST, before any Markdown is looked at, so text fetched over the
// network can never put its own markup on the page; the only tags in the
// result are the ones written here, and a link only ever goes to an
// https:// address, opening in a new tab.

const coreUpdater = require("./core-updater");

// Longest document drawn. A document about an upgrade is read in one go;
// anything far past this isn't one.
const LONGEST = 60000;

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Bold, italic and links in a piece of (already escaped) text
function emphasis(text) {
	return text
		.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/__(.+?)__/g, "<strong>$1</strong>")
		.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
		.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
}

// One line's formatting: `code` first (nothing inside it is formatted),
// then the rest. Takes RAW text and escapes it.
function inline(raw) {
	return String(raw)
		.split(/(`[^`]+`)/)
		.map((part) =>
			/^`[^`]+`$/.test(part)
				? `<code>${escapeHtml(part.slice(1, -1))}</code>`
				: emphasis(escapeHtml(part))
		)
		.join("");
}

// The whole document, as HTML
function render(markdown) {
	const lines = String(markdown || "")
		.replace(/\u0000/g, "")
		.replace(/\r\n?/g, "\n")
		.slice(0, LONGEST)
		.split("\n");

	const out = [];
	let paragraph = [];
	let list = null; // "ul" or "ol"
	let quote = [];

	const flushParagraph = () => {
		if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
		paragraph = [];
	};
	const closeList = () => {
		if (list) out.push(`</${list}>`);
		list = null;
	};
	const flushQuote = () => {
		if (quote.length) out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`);
		quote = [];
	};
	const flushAll = () => {
		flushParagraph();
		closeList();
		flushQuote();
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		// A block of code, between ``` lines, shown exactly as written
		if (/^\s*```/.test(line)) {
			flushAll();
			const code = [];
			index++;
			while (index < lines.length && !/^\s*```/.test(lines[index])) {
				code.push(lines[index]);
				index++;
			}
			out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
			continue;
		}

		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flushAll();
			// The pop-up's own title is the h2, so the document's top
			// headings are h3 and everything smaller h4
			const level = heading[1].length <= 2 ? 3 : 4;
			out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
			continue;
		}

		const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
		const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (bullet || numbered) {
			flushParagraph();
			flushQuote();
			const kind = bullet ? "ul" : "ol";
			if (list !== kind) {
				closeList();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
			continue;
		}

		const quoted = line.match(/^\s*>\s?(.*)$/);
		if (quoted) {
			flushParagraph();
			closeList();
			quote.push(quoted[1]);
			continue;
		}

		if (line.trim() === "") {
			flushAll();
			continue;
		}

		// A line under a list item, indented: part of that item
		if (list && /^\s{2,}\S/.test(line) && out.length && out[out.length - 1].startsWith("<li>")) {
			out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
			continue;
		}

		closeList();
		flushQuote();
		paragraph.push(line.trim());
	}

	flushAll();
	return out.join("\n");
}

// Where a version's document is: at its own tag
function notesUrl(version) {
	return (
		`https://raw.githubusercontent.com/${coreUpdater.REPO_OWNER}/${coreUpdater.REPO_NAME}/` +
		`v${encodeURIComponent(version)}/docs/upgrades/${encodeURIComponent(version)}.md`
	);
}

// The document for a major version: { html, from: "document" | "notes" },
// or null when neither it nor its release notes could be fetched
async function fetchUpgradeNotes(version) {
	try {
		const markdown = await coreUpdater.fetchText(notesUrl(version));
		if (String(markdown).trim()) return { html: render(markdown), from: "document" };
	} catch (error) {
		// No document for this version: its release notes instead
	}

	const notes = await coreUpdater.fetchChangelogEntry(`v${version}`);
	return notes ? { html: render(notes), from: "notes" } : null;
}

module.exports = { render, fetchUpgradeNotes, notesUrl, LONGEST };
