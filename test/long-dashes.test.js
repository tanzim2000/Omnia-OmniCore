// test/long-dashes.test.js
// No long dash (—) in anything Core says: its pages, its messages, its
// errors and the lines it writes to the log. They read as a pause in the
// wrong place to a lot of people, so words are joined with a colon, a
// comma or brackets instead.
//
// Only Core's own text (everything under core/), with its comments left
// out: nobody reads those but whoever edits the code. Modules and themes
// are their own makers' text, and aren't looked at here.
//
// The one dash allowed: a widget's value when there's nothing to show
// (a module that failed shows "—" where its number would be). That's a
// placeholder on a tile, not a sentence.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CORE = path.join(ROOT, "core");

// Where a dash is meant to be, and why
const ALLOWED = [{ file: "core/face-loader.js", text: 'value: "—"', why: "a widget's value when there's none" }];

// Every file under core/ that holds words someone could read
function coreFiles(folder = CORE) {
	const found = [];
	for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) found.push(...coreFiles(full));
		else if (/\.(js|css|html|json)$/.test(entry.name)) found.push(path.relative(ROOT, full).split(path.sep).join("/"));
	}
	return found.sort();
}

// The file's text without its comments: /* ... */ (JavaScript and CSS),
// <!-- ... --> (HTML), and // to the end of the line, unless it's part of
// an address like https://
function withoutComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

// The lines of a text that have a long dash in them, with their numbers
function linesWithDashes(text) {
	return text
		.split("\n")
		.map((line, index) => ({ line: line.trim(), number: index + 1 }))
		.filter((entry) => entry.line.includes("—"));
}

test("nothing Core says has a long dash in it", () => {
	const found = [];
	for (const file of coreFiles()) {
		let text = withoutComments(fs.readFileSync(path.join(ROOT, file), "utf-8"));
		for (const allowed of ALLOWED) {
			if (allowed.file === file) text = text.split(allowed.text).join("");
		}
		for (const entry of linesWithDashes(text)) found.push(`${file}: ${entry.line}`);
	}
	assert.deepEqual(found, [], "use a colon, a comma or brackets instead");
});

test("the checker skips comments but not words", () => {
	const code = [
		"// A comment — fine",
		"/* A block comment — fine */",
		"<!-- A page's comment — fine -->",
		'const link = "https://example.com"; // a comment after code — fine',
		'throw new Error("This — is not");'
	].join("\n");
	const left = linesWithDashes(withoutComments(code));
	assert.equal(left.length, 1);
	assert.match(left[0].line, /This — is not/);
});
