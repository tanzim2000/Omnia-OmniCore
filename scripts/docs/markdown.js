// scripts/docs/markdown.js
// Turns one Markdown file into what a docs page needs: its HTML, its
// title, the outline for the side nav, and the text the search box looks
// through.
//
// The actual Markdown reading is done by markdown-it, a library (installed
// as a dev dependency, so it never reaches the OmniCore image). This file
// only adds the few things a docs SITE needs on top of plain conversion:
//
//   - every heading gets an id, so a link can jump straight to it
//     (".../architecture.html#9-security-posture"), with the same naming
//     GitHub uses, so a link copied from GitHub still lands in the right place
//   - a link to another doc ("Architecture.md") points at that doc's page
//     instead, and a link to a code file points at it on GitHub
//   - a file name written as code, like `docs/Architecture.md`, becomes a
//     link to that page, since that's how the README refers to the docs
//   - wide tables scroll sideways on a phone instead of stretching the page

const path = require("path");
const MarkdownIt = require("markdown-it");

// GitHub's way of turning a heading into an id: lower case, punctuation
// dropped, spaces turned into hyphens. "9. Security posture" becomes
// "9-security-posture". Repeats get -1, -2 after them, also like GitHub.
function slugify(text) {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

function uniqueSlugger() {
	const seen = new Map();

	return function (text) {
		const base = slugify(text) || "section";
		const count = seen.get(base) || 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count}`;
	};
}

// The visible text of a heading or paragraph, with Markdown's markup
// (bold, code, links) taken off
function plainText(inlineToken) {
	if (!inlineToken || !inlineToken.children) {
		return inlineToken ? inlineToken.content : "";
	}

	// A line break inside a paragraph is a space between two words, not
	// nothing, or "your own\nhardware" would read as "your ownhardware"
	return inlineToken.children
		.map((child) => {
			if (child.type === "text" || child.type === "code_inline") return child.content;
			if (child.type === "softbreak" || child.type === "hardbreak") return " ";
			return "";
		})
		.join("");
}

// options:
//   sourcePath   where this file is in the repo ("docs/Architecture.md")
//   pageFor      a function: repo path -> page file name, or null when that
//                file has no page ("docs/Architecture.md" -> "architecture.html")
//   linkFor      a function: text written as code -> where it should link,
//                or null to leave it as plain code. Used for file names:
//                a doc goes to its page, a code file to GitHub.
//   repoUrl      "https://github.com/owner/repo", or null if unknown
//   branch       which branch a code link should point at
function createRenderer(options) {
	const { sourcePath, pageFor, linkFor, repoUrl, branch } = options;
	const sourceDir = path.posix.dirname(sourcePath);

	// html: false means raw HTML written in a doc is shown as text rather
	// than run. Docs are written in Markdown, and this keeps a stray
	// <script> in a code sample from ever doing anything on the site.
	// linkify turns a bare web address into a link, as GitHub does.
	const md = new MarkdownIt({ html: false, linkify: true });

	// Where a relative link written in this doc should really go
	function resolveLink(href) {
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) {
			return href;
		}

		const [filePart, hash] = href.split("#");
		const repoPath = path.posix.normalize(path.posix.join(sourceDir, decodeURI(filePart)));
		const page = pageFor(repoPath);

		if (page) {
			return page + (hash ? "#" + hash : "");
		}

		// A file with no page of its own (a code file, a picture): show it
		// on GitHub, where at least it can be read
		if (repoUrl) {
			return `${repoUrl}/blob/${branch}/${encodeURI(repoPath)}` + (hash ? "#" + hash : "");
		}

		return href;
	}

	const defaultLinkOpen = md.renderer.rules.link_open ||
		((tokens, index, opts, env, self) => self.renderToken(tokens, index, opts));

	md.renderer.rules.link_open = function (tokens, index, opts, env, self) {
		const token = tokens[index];
		token.attrSet("href", resolveLink(token.attrGet("href")));
		return defaultLinkOpen(tokens, index, opts, env, self);
	};

	// `docs/Architecture.md` written as code: a link to its page, still
	// looking like code. `core/face-store.js`: a link to the file on GitHub.
	md.renderer.rules.code_inline = function (tokens, index) {
		const content = tokens[index].content;
		const target = linkFor ? linkFor(content.trim()) : pageFor(content.trim());
		const code = `<code>${md.utils.escapeHtml(content)}</code>`;

		return target ? `<a href="${md.utils.escapeHtml(target)}">${code}</a>` : code;
	};

	md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
	md.renderer.rules.table_close = () => "</table></div>\n";

	// A small "#" after each heading's words, which is the link to that
	// heading. Shown when the heading is pointed at.
	md.renderer.rules.heading_close = function (tokens, index, opts, env, self) {
		const open = tokens[index - 2];
		const id = open && open.attrGet("id");
		const anchor = id && open.tag !== "h1"
			? ` <a class="anchor" href="#${id}" aria-label="Link to this section">#</a>`
			: "";

		return anchor + self.renderToken(tokens, index, opts);
	};

	return function render(source) {
		const tokens = md.parse(source, {});
		const slug = uniqueSlugger();

		let title = "";
		let summary = "";
		const outline = [];

		// Search works by section: each heading and the text under it,
		// so a result can jump to the right place rather than the top of
		// a long page
		const sections = [{ id: "", title: "", text: [] }];

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];

			if (token.type === "heading_open") {
				const text = plainText(tokens[i + 1]);
				const id = slug(text);
				token.attrSet("id", id);

				if (token.tag === "h1" && !title) {
					title = text;
				} else if (token.tag === "h2") {
					outline.push({ id, text });
				}

				if (token.tag === "h2" || token.tag === "h3") {
					sections.push({ id, title: text, text: [] });
				}

				// Skip the heading's own words so they aren't counted twice
				i += 1;
				continue;
			}

			// The first paragraph after the title: the one-line description
			// on the home page's cards
			if (token.type === "paragraph_open" && !summary && title) {
				summary = plainText(tokens[i + 1]);
			}

			if (token.type === "inline") {
				sections[sections.length - 1].text.push(plainText(token));
			} else if (token.type === "fence" || token.type === "code_block") {
				sections[sections.length - 1].text.push(token.content);
			}
		}

		return {
			html: md.renderer.render(tokens, md.options, {}),
			title,
			summary,
			outline,
			sections: sections
				.map((s) => ({ id: s.id, title: s.title, text: s.text.join(" ").replace(/\s+/g, " ").trim() }))
				.filter((s) => s.title || s.text)
		};
	};
}

module.exports = { createRenderer, slugify };
