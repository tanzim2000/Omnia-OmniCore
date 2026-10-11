// test/docs-site.test.js
// The docs website, and the one promise that keeps its Default UI page
// honest: every element in the stylesheet is described.
//
// The page is built from two files: core/ui-theme.js (the stylesheet) and
// docs/ui-elements.js (the words about each element). Nothing but this
// test ties them together. Without it, someone adds a class to the
// stylesheet, forgets the description, and the page quietly stops being
// a list of everything -- the kind of drift nobody notices until the
// page is wrong in front of someone. So:
//
//   - every class in the stylesheet has to be named by some element in
//     ui-elements.js (an entry's `sel`)
//   - every class an entry names has to really exist in the stylesheet,
//     so a removed element doesn't leave a description behind
//   - every colour in PALETTES has an explanation, and no explanation is
//     left over for a colour that's gone
//
// Then the site is actually built, into a throwaway folder, to prove it
// still builds and has the pages it should.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// The stylesheet with an install's defaults, not whatever font or text
// size the machine running the tests happens to have saved
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-docs-test-"));
process.env.OMNICORE_DATA_DIR = settingsDir;

const theme = require("../core/ui-theme");
const elements = require("../docs/ui-elements");
const { build, fileNameFor } = require("../scripts/build-docs");

test.after(() => {
	fs.rmSync(settingsDir, { recursive: true, force: true });
});

// Every class name used in a selector in the stylesheet. Comments are
// taken out first: they mention old names (.card, .tile) that aren't
// rules any more. Only the part of each rule before its "{" is read, so a
// number such as 0.5em or a file name in a url() is never mistaken for a
// class.
function stylesheetClasses() {
	const css = theme.uiStyles({ forceMode: "dark" }) + theme.uiStyles({ forceMode: "light" });
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const classes = new Set();

	for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
		const selector = match[1];

		// "@media (...)" and "@font-face" aren't selectors
		if (selector.includes("@")) continue;

		for (const name of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
			classes.add(name[1]);
		}
	}

	return classes;
}

// Every class named in the entries' `sel` fields
function describedClasses() {
	const classes = new Set();

	for (const section of elements.sections) {
		for (const entry of section.entries) {
			for (const name of entry.sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
				classes.add(name[1]);
			}
		}
	}

	return classes;
}

const allEntries = () => elements.sections.flatMap((section) => section.entries);

// --- The Default UI page's descriptions ---------------------------------

test("default UI: the stylesheet is read for real", () => {
	const classes = stylesheetClasses();

	// A sanity check on the reading itself: if it found nothing, the two
	// tests below would pass without checking anything
	assert.ok(classes.size > 30, `found ${classes.size} classes`);
	assert.ok(classes.has("segment") && classes.has("dock") && classes.has("glass"));
	assert.ok(!classes.has("card"), "a name only mentioned in a comment doesn't count");
});

test("default UI: every class in the stylesheet is described", () => {
	const described = describedClasses();
	const missing = [...stylesheetClasses()].filter((name) => !described.has(name)).sort();

	assert.deepEqual(
		missing,
		[],
		`Described nowhere in docs/ui-elements.js: .${missing.join(", .")}\n` +
			"Add an entry for each (or name it in an existing entry's `sel`)."
	);
});

test("default UI: every class described is still in the stylesheet", () => {
	const real = stylesheetClasses();
	const stale = [...describedClasses()].filter((name) => !real.has(name)).sort();

	assert.deepEqual(
		stale,
		[],
		`docs/ui-elements.js names classes ui-theme.js no longer has: .${stale.join(", .")}`
	);
});

test("default UI: every colour has its explanation, and only real colours do", () => {
	const colours = Object.keys(theme.PALETTES.dark);

	assert.deepEqual(Object.keys(theme.PALETTES.light).sort(), [...colours].sort(), "light and dark name the same colours");

	const unexplained = colours.filter((key) => !elements.paletteNotes[key]);
	const leftOver = Object.keys(elements.paletteNotes).filter((key) => !colours.includes(key));

	assert.deepEqual(unexplained, [], "colours with no explanation in paletteNotes");
	assert.deepEqual(leftOver, [], "explanations for colours PALETTES doesn't have");
});

test("default UI: every entry is complete, with its own id", () => {
	const ids = new Set();

	for (const entry of allEntries()) {
		for (const field of ["id", "title", "sel", "desc", "demo", "code"]) {
			assert.ok(typeof entry[field] === "string" && entry[field].trim(), `${entry.id || entry.title}: ${field} is missing`);
		}

		assert.match(entry.id, /^[a-z0-9-]+$/, `${entry.id}: an id is lower case, digits and hyphens`);
		assert.ok(!ids.has(entry.id), `${entry.id} is used twice`);
		ids.add(entry.id);
	}

	// Section ids share the page with element ids, so they can't clash either
	for (const section of elements.sections) {
		assert.ok(!ids.has(section.id), `section id ${section.id} is also an element's id`);
		ids.add(section.id);
	}
});

// --- The site as a whole ------------------------------------------------

test("docs site: builds, with a page for every doc", () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-docs-site-"));

	try {
		build(out);
		const files = new Set(fs.readdirSync(out));

		for (const file of ["index.html", "default-ui.html", "changelog.html", "search-index.js", ".nojekyll"]) {
			assert.ok(files.has(file), `${file} was built`);
		}

		// Every guide in docs/ has a page, and appears in the side nav
		const guides = fs.readdirSync(path.join(ROOT, "docs")).filter((name) => name.endsWith(".md"));
		const home = fs.readFileSync(path.join(out, "index.html"), "utf8");

		assert.ok(guides.length > 0);
		for (const guide of guides) {
			const file = fileNameFor(guide);
			assert.ok(files.has(file), `docs/${guide} has a page (${file})`);
			assert.ok(home.includes(`href="${file}"`), `docs/${guide} is in the nav`);
		}

		// One card for every element on the Default UI page, each with its
		// own anchor
		const ui = fs.readFileSync(path.join(out, "default-ui.html"), "utf8");
		for (const entry of allEntries()) {
			assert.ok(ui.includes(`<article class="segment el" id="${entry.id}">`), `${entry.id} is on the page`);
		}

		// The changelog has every release in CHANGELOG.md
		const changelog = fs.readFileSync(path.join(out, "changelog.html"), "utf8");
		const versions = [...fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").matchAll(/^## (v[\d.]+)/gm)].map((m) => m[1]);
		assert.ok(versions.length > 0);
		for (const version of versions) {
			assert.ok(changelog.includes(`id="${version.replace(/\./g, "-")}"`), `${version} is on the timeline`);
		}

		// Search can find an element by its name
		const index = fs.readFileSync(path.join(out, "search-index.js"), "utf8");
		assert.ok(index.startsWith("window.OMNIA_DOCS_SEARCH = "));
		assert.ok(index.includes('"u":"default-ui.html#dock"'), "the capsule is searchable");

		// The site always shows the default look: no rule loading a
		// downloaded font (the docs themselves can mention its address),
		// and nothing that came out as the word "undefined"
		for (const file of files) {
			if (!file.endsWith(".html")) continue;
			const html = fs.readFileSync(path.join(out, file), "utf8");
			assert.ok(!html.includes('src: url("/ui-font.woff2'), `${file} has no installed font`);
			assert.ok(!/>undefined<|="undefined"/.test(html), `${file} has an undefined in it`);
		}
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
	}
});

test("docs site: building doesn't change this machine's settings folder", () => {
	const before = process.env.OMNICORE_DATA_DIR;
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-docs-site-"));

	try {
		build(out);
		assert.equal(process.env.OMNICORE_DATA_DIR, before, "put back as it was");
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
	}
});
