// scripts/build-docs.js
// Builds the docs website from the docs themselves.
//
//   npm run docs              builds into _site/
//   node scripts/build-docs.js some/folder    builds somewhere else
//
// Then open _site/index.html in a browser. On GitHub, the "Publish docs
// site" workflow runs this on every push to main and puts the result on
// GitHub Pages.
//
// Nothing here is written by hand twice. Every page comes from a file
// that already exists for its own reasons:
//
//   README.md               the home page
//   docs/*.md               the guides (Architecture, Building modules...)
//   core/ui-theme.js        the Default UI page's samples and colours...
//   docs/ui-elements.js     ...and its words
//   CHANGELOG.md            the Changelog timeline
//   BACKLOG.md,             the Project pages
//   docs/planning/*.md
//
// A new .md file dropped into docs/ or docs/planning/ gets a page and a
// place in the side nav by itself, the next time the site is built.
//
// _site/ is never committed (it's in .gitignore): it's built output, the
// same way the container image is built from the code rather than kept in
// the repo.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { createRenderer } = require("./docs/markdown");
const { renderPage, esc } = require("./docs/layout");
const { renderCatalogue } = require("./docs/catalogue");
const { renderChangelog } = require("./docs/changelog");

const ROOT = path.join(__dirname, "..");

// The guides, in the order they're best read. A doc in docs/ that isn't
// named here still gets a page, after these, in alphabetical order.
const GUIDE_ORDER = ["Architecture.md", "Building modules.md", "Building theme.md"];

// "Building modules.md" -> "building-modules.html"
const fileNameFor = (name) =>
	name.replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".html";

// Runs git, or returns "" when git isn't there (a download without its
// history, say). The site still builds; it just can't say which commit.
function git(args) {
	try {
		return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

// "https://github.com/owner/repo", for "Edit this page" and for links to
// code files. On GitHub Actions it's handed over directly; in a clone it's
// read from where the clone came from.
function repoUrl() {
	if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY) {
		return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;
	}

	const remote = git(["remote", "get-url", "origin"]);
	const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/);
	return match ? `https://github.com/${match[1]}` : null;
}

// The stylesheet in both colours, exactly as an OmniCore page gets it.
//
// uiStyles() normally reads the install's own settings (a chosen font, a
// text size). The site should always show the plain default, whatever
// happens to be set on the machine building it, so it's pointed at an
// empty settings folder for the moment it runs.
function defaultStylesheets() {
	const theme = require("../core/ui-theme");
	const previous = process.env.OMNICORE_DATA_DIR;
	const empty = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-docs-"));

	process.env.OMNICORE_DATA_DIR = empty;

	try {
		return {
			theme,
			darkCss: theme.uiStyles({ forceMode: "dark" }),
			lightCss: theme.uiStyles({ forceMode: "light" })
		};
	} finally {
		// Put things back as they were. Assigning undefined would store the
		// word "undefined", so a variable that wasn't set is removed instead.
		if (previous === undefined) delete process.env.OMNICORE_DATA_DIR;
		else process.env.OMNICORE_DATA_DIR = previous;
		fs.rmSync(empty, { recursive: true, force: true });
	}
}

// Every page the site has, before any of them is drawn, so each page's
// side nav can list all the others
function collectPages() {
	const pages = [];
	const markdownIn = (dir) =>
		fs.existsSync(path.join(ROOT, dir))
			? fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.toLowerCase().endsWith(".md"))
			: [];

	pages.push({ kind: "home", group: "Start", file: "index.html", source: "README.md", navTitle: "Overview" });

	const guides = markdownIn("docs").sort((a, b) => {
		const ia = GUIDE_ORDER.indexOf(a);
		const ib = GUIDE_ORDER.indexOf(b);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
	});

	for (const name of guides) {
		pages.push({ kind: "markdown", group: "Guides", file: fileNameFor(name), source: `docs/${name}` });
	}

	pages.push({ kind: "catalogue", group: "Reference", file: "default-ui.html", source: "docs/ui-elements.js", navTitle: "Default UI" });
	pages.push({ kind: "changelog", group: "Reference", file: "changelog.html", source: "CHANGELOG.md", navTitle: "Changelog" });

	if (fs.existsSync(path.join(ROOT, "BACKLOG.md"))) {
		pages.push({ kind: "markdown", group: "Project", file: "backlog.html", source: "BACKLOG.md" });
	}

	for (const name of markdownIn("docs/planning").sort()) {
		pages.push({ kind: "markdown", group: "Project", file: "planning-" + fileNameFor(name), source: `docs/planning/${name}` });
	}

	return pages;
}

function build(outDir) {
	const site = {
		name: "Omnia OmniCore docs",
		repoUrl: repoUrl(),
		commit: process.env.GITHUB_SHA || git(["rev-parse", "HEAD"]),
		builtOn: new Date().toISOString().slice(0, 10)
	};

	const { theme, darkCss, lightCss } = defaultStylesheets();
	site.darkCss = darkCss;
	site.lightCss = lightCss;

	const pages = collectPages();
	// Looked up in lower case: the docs sometimes write a name differently
	// from the file ("docs/ARCHITECTURE.md" for docs/Architecture.md),
	// and both should lead to the same page
	const pageBySource = new Map(pages.map((p) => [p.source.toLowerCase(), p.file]));
	// The Default UI page is also where the stylesheet itself should lead
	pageBySource.set("core/ui-theme.js", "default-ui.html");

	const pageFor = (repoPath) => pageBySource.get(String(repoPath).toLowerCase()) || null;

	// A file name written as code: its page if it has one, otherwise the
	// file on GitHub if it really exists in the repo, otherwise nothing
	// (so `omni.time()` and the like stay plain code)
	const linkFor = (text) => {
		if (pageFor(text)) return pageFor(text);
		if (!site.repoUrl || !/^[\w.-]+(\/[\w. -]+)+\.\w+$|^[\w-]+\.(js|json|md|yml|yaml)$/.test(text)) return null;
		if (!fs.existsSync(path.join(ROOT, text))) return null;
		return `${site.repoUrl}/blob/main/${encodeURI(text)}`;
	};

	const rendererFor = (sourcePath) =>
		createRenderer({ sourcePath, pageFor, linkFor, repoUrl: site.repoUrl, branch: "main" });

	// First pass: read every Markdown page, for its title and summary,
	// which the side nav and the home page's cards need
	for (const page of pages) {
		if (page.kind === "markdown" || page.kind === "home") {
			page.markdown = fs.readFileSync(path.join(ROOT, page.source), "utf8");
			page.rendered = rendererFor(page.source)(page.markdown);
			page.title = page.rendered.title || page.source;
			page.navTitle = page.navTitle || page.title;
			page.summary = page.rendered.summary;
		}
	}

	pages.find((p) => p.kind === "catalogue").summary =
		"Every element of OmniCore's own look, with live samples, its colours, and the markup to copy.";
	pages.find((p) => p.kind === "changelog").summary =
		"Every release, newest first, as a timeline: how OmniCore grew, one step at a time.";

	site.groups = [];
	for (const page of pages) {
		let group = site.groups.find((g) => g.title === page.group);
		if (!group) site.groups.push((group = { title: page.group, pages: [] }));
		group.pages.push(page);
	}

	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	const search = [];
	const write = (file, html) => fs.writeFileSync(path.join(outDir, file), html);

	for (const page of pages) {
		if (page.kind === "markdown") {
			write(page.file, renderPage(site, {
				file: page.file,
				title: page.title,
				sourcePath: page.source,
				outline: page.rendered.outline,
				body: `<article class="prose">${page.rendered.html}</article>`
			}));

			for (const section of page.rendered.sections) {
				search.push({ p: page.navTitle, t: section.title, u: section.id ? `${page.file}#${section.id}` : page.file, x: section.text });
			}
		}

		if (page.kind === "home") {
			write(page.file, renderPage(site, homePage(page, pages)));

			for (const section of page.rendered.sections) {
				search.push({ p: "Overview", t: section.title, u: section.id ? `index.html#${section.id}` : "index.html", x: section.text });
			}
		}

		if (page.kind === "catalogue") {
			const data = require(path.join(ROOT, "docs/ui-elements.js"));
			const result = renderCatalogue(theme, data, page.file);
			page.title = "Default UI";
			write(page.file, renderPage(site, { file: page.file, title: page.title, sourcePath: page.source, ...result }));
			search.push(...result.searchEntries.map((e) => ({ p: "Default UI", ...e })));
		}

		if (page.kind === "changelog") {
			const result = renderChangelog({
				source: fs.readFileSync(path.join(ROOT, page.source), "utf8"),
				renderMd: rendererFor(page.source),
				cwd: ROOT,
				file: page.file
			});
			page.title = "Changelog";
			write(page.file, renderPage(site, { file: page.file, title: page.title, sourcePath: page.source, ...result }));
			search.push(...result.searchEntries.map((e) => ({ p: "Changelog", ...e })));
		}
	}

	// Everything search can find, as a script the pages load when the box
	// is first used. Long sections are cut down: search only needs enough
	// words to match on and to show a snippet.
	const index = search
		.filter((e) => e.t || e.x)
		.map((e) => ({ ...e, x: e.x.length > 4000 ? e.x.slice(0, 4000) : e.x }));
	write("search-index.js", `window.OMNIA_DOCS_SEARCH = ${JSON.stringify(index)};\n`);

	// Tells GitHub Pages to serve the files exactly as they are, without
	// running its own site builder (Jekyll) over them first
	write(".nojekyll", "");

	return { outDir, pages: pages.map((p) => ({ file: p.file, title: p.title || p.navTitle, group: p.group })), searchEntries: index.length };
}

// The home page: the README, with a card for every other page above it
function homePage(page, pages) {
	// The README's own title and first line become the page's header, so
	// they're taken off the top of the README text below it
	const withoutTop = page.markdown.replace(/^# .*\n+/, "").replace(/^(?!#)[^\n]+(\n[^\n]+)*\n+/, "");
	const rendered = createRenderer({
		sourcePath: page.source,
		pageFor: () => null,
		linkFor: (text) => {
			const target = pages.find((p) => p.source.toLowerCase() === text.toLowerCase());
			return target ? target.file : null;
		},
		repoUrl: null,
		branch: "main"
	})(withoutTop);

	const cards = pages
		.filter((p) => p.kind !== "home")
		.map((p) => {
			const summary = p.summary && p.summary.length > 170 ? p.summary.slice(0, 167).replace(/\s+\S*$/, "") + "…" : p.summary || "";
			return `<a class="segment clickable card" href="${p.file}"><span class="card-group">${esc(p.group)}</span><b>${esc(p.navTitle)}</b><span class="card-text">${esc(summary)}</span></a>`;
		})
		.join("");

	return {
		file: page.file,
		title: page.title,
		sourcePath: page.source,
		outline: page.rendered.outline,
		head: `<style>
	.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(15em, 1fr)); gap: 0.9em; margin: 0 0 3em; max-width: 60em; }
	.card { display: flex; flex-direction: column; gap: 0.35em; text-decoration: none; }
	.card b { font-size: 1.05em; font-weight: 600; }
	.card-group { font-size: 0.7em; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-muted); }
	.card-text { font-size: 0.86em; color: var(--fg-muted); line-height: 1.5; }
</style>`,
		body: `
<div class="page-head">
	<h1>${esc(page.title)}</h1>
	<p class="lede">${esc(page.summary)}</p>
</div>
<div class="cards">${cards}</div>
<article class="prose">${rendered.html}</article>`
	};
}

module.exports = { build, fileNameFor };

// Run straight from the command line (npm run docs): build into the
// folder given, or _site/
if (require.main === module) {
	const outDir = path.resolve(process.argv[2] || path.join(ROOT, "_site"));
	const result = build(outDir);
	console.log(`Docs site built: ${result.pages.length} pages, ${result.searchEntries} search entries, in ${path.relative(process.cwd(), outDir) || "."}`);
	for (const page of result.pages) console.log(`  ${page.file.padEnd(34)} ${page.title}`);
}
