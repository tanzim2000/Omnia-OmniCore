// test/central-theme.test.js
// In short: Every page is built from the central theme
//
// Every page OmniCore draws is built from the central theme's elements
// (core/ui-theme.js), and nothing else. No page keeps looks of its own.
//
// WHY
//
// The Default UI is meant to be one file that can be swapped for another
// look by changing that file alone. A page with styles of its own breaks
// that: it keeps its old look when everything else changes, and the same
// thing ends up drawn three slightly different ways on three pages. So an
// element a page needs is made in ui-theme.js, described in
// docs/ui-elements.js, and reused by every page that needs one like it.
//
// WHAT COUNTS AS A LOOK OF ITS OWN
//
// In any file under core/ except ui-theme.js:
//
//   style blocks   a <style> written into a page
//   CSS rules      ".selector { property: value; }" anywhere in the file
//   style=""       a style attribute on an element (one that only sets CSS
//                  variables, style="--hue: 210", is fine: see below)
//   script looks   a page script setting a look: element.style.color = ...,
//                  style.cssText, setAttribute("style", ...)
//
// What a script may still do: switch classes, set `hidden`, and set CSS
// variables (element.style.setProperty("--x", ...)) for things that really
// move, like a slider's fill or a tab strip being dragged. The variable is
// then used by a rule in ui-theme.js. The same goes for markup: a value
// only the page knows (a listing's colour, a font's name) can be handed
// over as a variable, style="--hue: 210".
//
// THE ONE EXCEPTION
//
// Face:1303 (the About face, core/about-face.js and core/about-face.css)
// has its own look on purpose and never uses the central theme. Themes,
// in themes/ or from a Registry, are their own look by definition and
// aren't in core/ at all.
//
// STRICT SINCE 2.0.0
//
// The pages written before this rule were moved onto the central theme in
// five steps, each listed in STILL_TO_MOVE with how much it had left until
// it had none. The list is empty now, so a look of its own anywhere under
// core/ (but Face:1303's) fails the test. STILL_TO_MOVE stays for the day
// a big change has to be made in steps again: a listed file only warns,
// and can never get more than its line says.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CORE = path.join(ROOT, "core");

// Where the central theme lives, and the one face that never uses it
const CENTRAL = ["core/ui-theme.js"];
const OWN_LOOK = ["core/about-face.js", "core/about-face.css"];

// What's left to move into the central theme, file by file. Nothing, since
// 2.0.0: every page is built from the central theme's elements, so any
// look of its own fails the test. (Lower a number, or take a line out, if
// one ever has to be listed again; never raise one.)
const STILL_TO_MOVE = {};

// Every file under core/, as a path from the project folder
function coreFiles(folder = CORE) {
	const found = [];
	for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) found.push(...coreFiles(full));
		else if (/\.(js|css|html)$/.test(entry.name)) found.push(path.relative(ROOT, full).split(path.sep).join("/"));
	}
	return found.sort();
}

// How many looks of its own a file has, by kind
function looksIn(file, text) {
	const counts = { styleBlocks: 0, cssRules: 0, styleAttributes: 0, scriptLooks: 0 };

	// A stylesheet file anywhere in core/ is all looks of its own
	if (file.endsWith(".css")) {
		counts.cssRules = (text.match(/\{[^{}]*:[^{}]*\}/g) || []).length;
		return counts;
	}

	counts.styleBlocks = (text.match(/<style[\s>]/g) || []).length;

	// ".selector { property: value; }": a selector without ( ) = ; or a
	// backtick (so no function call or assignment), then a body with a
	// "property: value;" and without = or ? (which CSS never has and JS
	// nearly always does)
	const rule = /(^|[\n};>])[ \t]*([.#@*:[a-zA-Z][^{}\n;=()`<]*?)\s*\{([^{}]*)\}/g;
	let match;
	while ((match = rule.exec(text))) {
		const body = match[3];
		if (/[=?]/.test(body)) continue;
		if (!/(^|[\s;{])-{0,2}[a-z][a-z-]*\s*:\s*[^;:{}]+;/.test(body)) continue;
		counts.cssRules++;
	}

	// A style attribute, unless all it does is set CSS variables
	for (const match of text.matchAll(/\sstyle=\\?["']/g)) {
		const value = text.slice(match.index + match[0].length, match.index + match[0].length + 200).split(/\\?["'>]/)[0];
		const onlyVariables = /^\s*--/.test(value) && !/;\s*(?!--)[a-z-]+\s*:/.test(value);
		if (!onlyVariables) counts.styleAttributes++;
	}
	counts.styleAttributes += (text.match(/setAttribute\(\s*["']style["']/g) || []).length;

	// element.style.something = ..., style.cssText, and style.setProperty
	// of anything but a CSS variable
	counts.scriptLooks =
		(text.match(/\.style\.(?!setProperty|removeProperty|getPropertyValue|cssText)[a-zA-Z]+\s*=[^=]/g) || []).length +
		(text.match(/\.style\.cssText/g) || []).length +
		(text.match(/\.style\.setProperty\(\s*["'](?!--)/g) || []).length;

	return counts;
}

function total(counts) {
	return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

test("no page keeps looks of its own: everything is the central theme's", () => {
	const left = [];
	const problems = [];

	for (const file of coreFiles()) {
		if (CENTRAL.includes(file) || OWN_LOOK.includes(file)) continue;
		const counts = looksIn(file, fs.readFileSync(path.join(ROOT, file), "utf-8"));
		const allowed = STILL_TO_MOVE[file];

		if (!allowed) {
			if (total(counts) > 0) problems.push(`${file} has looks of its own: ${JSON.stringify(counts)}. Make them elements in core/ui-theme.js.`);
			continue;
		}
		for (const kind of Object.keys(counts)) {
			if (counts[kind] > (allowed[kind] || 0)) {
				problems.push(`${file} has more ${kind} than before (${counts[kind]}, was ${allowed[kind] || 0}). Use the central theme's elements instead.`);
			}
		}
		if (total(counts) === 0) left.push(`  ${file}: clean now, take its line out of STILL_TO_MOVE`);
		else if (total(counts) < total(allowed)) left.push(`  ${file}: ${JSON.stringify(counts)} (less than its line says: lower it)`);
		else left.push(`  ${file}: ${JSON.stringify(counts)}`);
	}

	// Where work is left: printed every run, never a failure on its own
	if (left.length) {
		console.log(`Still to move into the central theme (${left.length} files):\n${left.join("\n")}`);
	}
	assert.deepEqual(problems, []);
});

test("the one exception is Face:1303, and only it", () => {
	for (const file of OWN_LOOK) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is there`);
	// No stylesheet file in core/ but the About face's
	const sheets = coreFiles().filter((file) => file.endsWith(".css"));
	assert.deepEqual(sheets, ["core/about-face.css"]);

	// And it never loads the central theme's stylesheet: Core adds only its
	// own elements there (the Back button, the page fade, the status drawer
	// and the takeover), each with its own look
	const about = fs.readFileSync(path.join(ROOT, "core/about-face.js"), "utf-8");
	assert.ok(!/uiStyles\(/.test(about), "no uiStyles() on Face:1303");
	assert.ok(!/pageStart\(/.test(about), "no pageStart() either: it would draw the Settings background");
	assert.match(about, /backButtonStyles\(\)/, "its Back button is Core's");
	// ...with the room it keeps free, so the end of the page is never
	// under it
	const { backButtonStyles } = require("../core/ui-theme");
	assert.match(backButtonStyles(), /body:has\(> \.floating\.bottom-right\) \{ padding-bottom/);
	assert.match(backButtonStyles(), /body:has\(> \.floating\.top-left\) \{ padding-top/);
});

test("the checker spots each kind of look, and leaves plain code alone", () => {
	const page = [
		"const PAGE = `<style>.box { color: red; }</style>",
		'<div style="margin: 0">`;',
		'<span style="--hue: 2; color: red">`;',
		"const CSS = `",
		"	.row .name { display: flex; gap: 1em; }",
		"	@media (orientation: landscape) {",
		"		.grid { grid-template-columns: 1fr 1fr; }",
		"	}",
		"`;",
		'box.style.color = "red";',
		"box.style.cssText = \"x\";",
		'box.style.setProperty("color", "red");'
	].join("\n");
	assert.deepEqual(looksIn("core/x.js", page), { styleBlocks: 1, cssRules: 3, styleAttributes: 2, scriptLooks: 3 });

	const plain = [
		"function go(a) {",
		"	const b = a ? { x: 1 } : null;",
		"	if (b) { return b.x; }",
		"	return { ok: true, name: 'x' };",
		"}",
		'box.style.setProperty("--fill", "40%");',
		'const tile = `<span class="tile" style="--hue:${hue}">`;',
		"const name = '<strong style=\"--font:' + font + '\">';",
		"if (box.style.display === \"none\") {}",
		"do { count = count + 1; } while (count < 3);",
		"switch (kind) { case \"a\": break; }"
	].join("\n");
	assert.deepEqual(looksIn("core/y.js", plain), { styleBlocks: 0, cssRules: 0, styleAttributes: 0, scriptLooks: 0 });
});

module.exports = { looksIn, coreFiles };
