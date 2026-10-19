// scripts/docs/layout.js
// The frame around every page of the docs site: the bar along the top
// (title, search, Dark / Light / Device), the contents down the side, the
// page's own "On this page" list on the right, the breadcrumb above each
// title, and the footer. Each page only supplies what goes in the middle.
//
// The site is drawn with OmniCore's own stylesheet, core/ui-theme.js,
// passed in as two copies (dark and light). So the docs look like Omnia,
// and a change to the Default UI shows up here the next time the site is
// built, with nothing to copy across by hand.

const esc = (text) =>
	String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Where this browser's Dark / Light / Device choice for the docs is
// remembered. Only a convenience: if the browser won't keep it (a private
// window, say), the site simply follows the device.
const MODE_KEY = "omnia-docs-mode";

// Styles for the site's own frame and for text written in Markdown. The
// buttons, boxes, tabs and so on all come from ui-theme.js; this only
// lays them out and gives long-form reading what a dashboard UI never
// needed (paragraph spacing, tables, quotes).
const SITE_CSS = `
	html { scroll-behavior: smooth; scroll-padding-top: 5.5em; }

	a { color: inherit; text-decoration-color: var(--fg-muted); text-underline-offset: 0.18em; }
	a:hover { text-decoration-color: var(--fg); }

	.skip { position: absolute; left: -999em; }
	.skip:focus { left: 1em; top: 1em; z-index: 200; background: var(--bg); padding: 0.5em 1em; border-radius: 0.5em; }

	/* The bar along the top */
	.top {
		position: sticky; top: 0; z-index: 60;
		display: flex; align-items: center; gap: 0.9em;
		padding: 0.75em 1.25em;
		background: var(--bg);
		border-bottom: 1px solid var(--segment-border);
	}
	.brand { font-weight: 300; font-size: 1.15em; text-decoration: none; white-space: nowrap; }
	.brand b { font-weight: 600; }
	.search { position: relative; flex: 1 1 auto; max-width: 30em; margin-left: auto; }
	.search input { padding-right: 4.6em; }
	.search kbd {
		position: absolute; right: 0.8em; top: 50%; transform: translateY(-50%);
		font-family: inherit; font-size: 0.75em; color: var(--fg-muted);
		border: 1px solid var(--glass-border); border-radius: 0.35em; padding: 0.05em 0.45em;
	}
	.menu-button { display: none; }

	/* Text only a screen reader reads out: the names of the icon-only
	   Dark / Light / Device buttons */
	.sr-only {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}

	/* Dark / Light / Device, as a sun, a moon and a screen */
	#mode-tabs .tab-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5em 0.7em; }
	#mode-tabs svg { width: 1.05em; height: 1.05em; display: block; }

	/* Search results: a panel under the box */
	.results {
		position: absolute; left: 0; right: 0; top: calc(100% + 0.4em);
		max-height: min(70vh, 32em); overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--glass-border); border-radius: var(--radius);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
		padding: 0.4em;
	}
	.results[hidden] { display: none; }
	.results a { display: block; text-decoration: none; padding: 0.6em 0.75em; border-radius: 0.55em; }
	.results a:hover, .results a.selected { background: var(--glass-bg-hover); }
	.results .where { font-size: 0.75em; color: var(--fg-muted); }
	.results .what { font-weight: 600; margin: 0.1em 0; }
	.results .snip { font-size: 0.82em; color: var(--fg-muted); line-height: 1.45; }
	.results mark { background: none; color: var(--fg); font-weight: 700; }
	.results .none { padding: 0.8em; color: var(--fg-muted); font-size: 0.9em; }

	/* The page: contents on the left, the page itself on the right */
	.shell {
		display: grid; grid-template-columns: 15em minmax(0, 1fr);
		gap: 2.5em; max-width: 82em; margin: 0 auto; padding: 1.75em 1.25em 4em;
	}
	nav.side {
		position: sticky; top: 5.5em; align-self: start;
		max-height: calc(100vh - 7em); overflow-y: auto;
		font-size: 0.9em; padding-right: 0.5em;
		scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent;
	}
	nav.side h2 {
		font-size: 0.72em; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
		color: var(--fg-muted); margin: 1.4em 0 0.4em 0.75em;
	}
	nav.side h2:first-child { margin-top: 0; }
	nav.side a { display: block; text-decoration: none; color: var(--fg-muted); padding: 0.38em 0.75em; border-radius: 0.5em; }
	nav.side a:hover { color: var(--fg); background: var(--hover-subtle); }
	nav.side a.current { color: var(--fg); background: var(--glass-bg-hover); box-shadow: inset 0 1px 0 var(--glass-sheen); }
	nav.side .outline { margin: 0.2em 0 0.5em 0.9em; padding-left: 0.6em; border-left: 1px solid var(--segment-border); }
	nav.side .outline a { font-size: 0.92em; padding: 0.28em 0.6em; }

	main { min-width: 0; }

	/* "On this page", on the right, on screens wide enough for a third
	   column without squeezing the page's own tables (about 1400 pixels
	   at the normal text size). Narrower than that, the same list stays under the current
	   page in the contents on the left (nav.side .outline), and this one
	   isn't drawn. */
	aside.toc { display: none; }

	@media (min-width: 88em) {
		.shell.has-toc { grid-template-columns: 15em minmax(0, 1fr) 13em; max-width: 94em; }
		.shell.has-toc nav.side .outline { display: none; }
		.shell.has-toc aside.toc {
			display: block; position: sticky; top: 5.5em; align-self: start;
			max-height: calc(100vh - 7em); overflow-y: auto; font-size: 0.85em;
			scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent;
		}
	}
	aside.toc h2 {
		font-size: 0.75em; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
		color: var(--fg-muted); margin: 0 0 0.6em 0.9em;
	}
	aside.toc nav { border-left: 1px solid var(--segment-border); }
	aside.toc a {
		display: block; text-decoration: none; color: var(--fg-muted);
		padding: 0.3em 0.9em; margin-left: -1px; border-left: 2px solid transparent; line-height: 1.4;
	}
	aside.toc a:hover { color: var(--fg); }

	/* The section being read right now, marked in both lists */
	aside.toc a.active { color: var(--fg); border-left-color: var(--fg); }
	nav.side .outline a.active { color: var(--fg); }

	/* Where this page sits: Docs / Guides / Architecture */
	.crumbs { display: flex; flex-wrap: wrap; gap: 0.4em; font-size: 0.82em; color: var(--fg-muted); margin: 0 0 1.1em; }
	.crumbs a { text-decoration: none; color: var(--fg-muted); }
	.crumbs a:hover { color: var(--fg); }
	.crumbs .sep { opacity: 0.5; }
	.crumbs [aria-current] { color: var(--fg); }

	/* A code block with its Copy button in the top-right corner. The
	   button sits on a wrapper rather than in the block itself, so it
	   stays put when a long line is scrolled sideways. */
	.code-block { position: relative; }
	.code-block pre { padding-right: 5.5em; }
	.copy-button.glass {
		position: absolute; top: 0.45em; right: 0.45em;
		padding: 0.35em 0.75em; font-size: 0.75em; border-radius: 0.5em;
	}
	footer.foot {
		margin-top: 4em; padding-top: 1.25em; border-top: 1px solid var(--segment-border);
		display: flex; flex-wrap: wrap; gap: 0.5em 1.5em; font-size: 0.82em; color: var(--fg-muted);
	}

	/* Text written in Markdown */
	.prose { max-width: 50em; line-height: 1.65; }
	.prose h1 { font-size: 2.1em; margin: 0 0 0.6em; line-height: 1.2; }
	.prose h2 { font-weight: 400; font-size: 1.5em; margin: 2.2em 0 0.6em; padding-top: 0.6em; border-top: 1px solid var(--segment-border); line-height: 1.3; }
	.prose h3 { font-weight: 600; font-size: 1.12em; margin: 1.8em 0 0.5em; }
	.prose h4 { font-weight: 600; font-size: 1em; margin: 1.5em 0 0.4em; }
	.prose p, .prose ul, .prose ol, .prose blockquote, .prose .table-wrap, .prose pre { margin: 0 0 1em; }
	.prose ul, .prose ol { padding-left: 1.5em; }
	.prose li { margin: 0.3em 0; }
	.prose li > p { margin: 0.3em 0; }
	.prose hr { border: 0; border-top: 1px solid var(--segment-border); margin: 2.5em 0; }
	/* Several docs put a --- line before each section. The section's
	   heading already draws a line, so the --- right before one is
	   dropped rather than drawing two lines with a gap between them. */
	.prose hr:has(+ h2) { display: none; }
	.prose blockquote {
		padding: 0.8em 1.1em; border-left: 3px solid var(--glass-border);
		background: var(--segment-bg); border-radius: 0 var(--radius) var(--radius) 0; color: var(--fg-muted);
	}
	.prose blockquote > :last-child { margin-bottom: 0; }
	.prose .anchor { opacity: 0; text-decoration: none; color: var(--fg-muted); font-weight: 400; transition: opacity 0.15s; }
	.prose h2:hover .anchor, .prose h3:hover .anchor, .prose h4:hover .anchor, .prose .anchor:focus { opacity: 1; }

	code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86em; }
	:not(pre) > code, a > code {
		background: var(--hover-subtle); border: 1px solid var(--segment-border);
		border-radius: 0.35em; padding: 0.08em 0.38em; overflow-wrap: anywhere;
	}
	pre {
		padding: 0.9em 1.1em; background: var(--well-bg); border: 1px solid var(--segment-border);
		border-radius: 0.6em; overflow-x: auto; line-height: 1.5; tab-size: 4;
	}
	pre code { font-size: 0.82em; }

	.table-wrap { overflow-x: auto; border: 1px solid var(--segment-border); border-radius: var(--radius); }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; vertical-align: top; padding: 0.6em 0.8em; border-bottom: 1px solid var(--segment-border); font-size: 0.9em; }
	tr:last-child td { border-bottom: 0; }
	th { font-weight: 600; background: var(--segment-bg); }
	/* A file name in a table cell stays on one line ("settings-store.js",
	   not "settin / gs-st / ore.js"): the column widens to fit it, and the
	   description beside it wraps instead */
	.prose td code, .prose th code { overflow-wrap: normal; white-space: nowrap; }

	/* Page headers that aren't Markdown (home, Default UI, changelog) */
	.page-head { margin-bottom: 2em; max-width: 50em; }
	.page-head h1 { font-size: 2.1em; line-height: 1.2; }
	.page-head .lede { font-size: 1em; line-height: 1.55; }

	@media (max-width: 56em) {
		.shell { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 1.25em; }
		.menu-button { display: inline-flex; padding: 0.45em 0.75em; font-size: 1.1em; line-height: 1; }
		.top { gap: 0.6em; padding: 0.7em 1em; }
		.top .tab-btn { padding: 0.5em 0.75em; font-size: 0.85em; }
		#mode-tabs { margin-left: auto; }
		nav.side { display: none; position: static; max-height: none; margin-bottom: 1.5em; }
		body.nav-open nav.side { display: block; }
		.brand span { display: none; }
		.top { flex-wrap: wrap; }
		.search { order: 3; flex-basis: 100%; max-width: none; }
		.search kbd { display: none; }
	}
`;

// Runs in the <head>, before anything is drawn, so the page appears in
// the right colours rather than flashing the wrong ones first. The two
// stylesheets are both on the page; this only decides which one counts.
const MODE_HEAD_SCRIPT = `
	(function () {
		var mode = null;
		try { mode = localStorage.getItem(${JSON.stringify(MODE_KEY)}); } catch (e) {}
		var light = document.getElementById("css-light");
		light.media = mode === "light" ? "all" : mode === "dark" ? "not all" : "(prefers-color-scheme: light)";
		document.documentElement.dataset.mode = mode === "light" || mode === "dark" ? mode : "device";
	})();
`;

// Everything the frame does once the page is on screen: the Dark / Light /
// Device tabs, the Contents button on a phone, and search.
//
// Search loads its list of everything (search-index.js) only the first
// time someone uses the box, so a page that's just being read doesn't
// download it. It's a script rather than a data file so it also works
// when the site is opened straight from a folder, with no server.
const FRAME_SCRIPT = `
	(function () {
		// --- Dark / Light / Device ---------------------------------------
		var tabs = document.getElementById("mode-tabs");
		function markMode() {
			var now = document.documentElement.dataset.mode;
			tabs.querySelectorAll(".tab-btn").forEach(function (b) {
				b.classList.toggle("active", b.dataset.mode === now);
				b.setAttribute("aria-pressed", String(b.dataset.mode === now));
			});
		}
		tabs.addEventListener("click", function (event) {
			var button = event.target.closest("[data-mode]");
			if (!button) return;
			var mode = button.dataset.mode;
			var light = document.getElementById("css-light");
			light.media = mode === "light" ? "all" : mode === "dark" ? "not all" : "(prefers-color-scheme: light)";
			document.documentElement.dataset.mode = mode;
			try {
				if (mode === "device") localStorage.removeItem(${JSON.stringify(MODE_KEY)});
				else localStorage.setItem(${JSON.stringify(MODE_KEY)}, mode);
			} catch (e) {}
			markMode();
		});
		markMode();

		// --- Contents button (phones) ------------------------------------
		var menu = document.getElementById("menu-button");
		menu.addEventListener("click", function () {
			var open = document.body.classList.toggle("nav-open");
			menu.setAttribute("aria-expanded", String(open));
		});

		// --- Search ------------------------------------------------------
		var box = document.getElementById("search-box");
		var panel = document.getElementById("search-results");
		var selected = -1;

		function loadIndex(then) {
			if (window.OMNIA_DOCS_SEARCH) return then();
			var script = document.createElement("script");
			script.src = "search-index.js";
			script.onload = then;
			document.head.appendChild(script);
		}

		function escapeHtml(text) {
			return text.replace(/[&<>"]/g, function (c) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
			});
		}

		function highlight(text, terms) {
			var html = escapeHtml(text);
			terms.forEach(function (term) {
				var safe = escapeHtml(term).replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
				html = html.replace(new RegExp("(" + safe + ")", "gi"), "<mark>$1</mark>");
			});
			return html;
		}

		// A few words either side of the first match, so a result shows
		// why it matched
		function snippet(text, terms) {
			var lower = text.toLowerCase();
			var at = -1;
			terms.forEach(function (term) {
				var i = lower.indexOf(term);
				if (i !== -1 && (at === -1 || i < at)) at = i;
			});
			if (at === -1) return text.slice(0, 150);
			var start = Math.max(0, at - 50);
			return (start > 0 ? "…" : "") + text.slice(start, start + 170) + (start + 170 < text.length ? "…" : "");
		}

		function search(query) {
			var terms = query.toLowerCase().split(/\\s+/).filter(Boolean);
			if (!terms.length) return [];
			var found = [];
			window.OMNIA_DOCS_SEARCH.forEach(function (entry) {
				var title = (entry.t || "").toLowerCase();
				var page = entry.p.toLowerCase();
				var hay = title + " " + page + " " + entry.x.toLowerCase();
				// Every word typed has to be in there somewhere
				if (!terms.every(function (term) { return hay.indexOf(term) !== -1; })) return;
				var score = 0;
				terms.forEach(function (term) {
					if (title.indexOf(term) !== -1) score += 10;
					if (page.indexOf(term) !== -1) score += 3;
					score += Math.min(5, entry.x.toLowerCase().split(term).length - 1);
				});
				found.push({ entry: entry, score: score });
			});
			found.sort(function (a, b) { return b.score - a.score; });
			return found.slice(0, 12).map(function (f) { return f.entry; });
		}

		function show() {
			var query = box.value.trim();
			if (!query) { panel.hidden = true; return; }
			var terms = query.toLowerCase().split(/\\s+/).filter(Boolean);
			var results = search(query);
			selected = results.length ? 0 : -1;
			panel.innerHTML = results.length
				? results.map(function (r, i) {
					return '<a href="' + r.u + '"' + (i === 0 ? ' class="selected"' : "") + '>' +
						'<div class="where">' + escapeHtml(r.p) + "</div>" +
						'<div class="what">' + highlight(r.t || r.p, terms) + "</div>" +
						'<div class="snip">' + highlight(snippet(r.x, terms), terms) + "</div></a>";
				}).join("")
				: '<div class="none">Nothing matches “' + escapeHtml(query) + '”.</div>';
			panel.hidden = false;
		}

		function move(step) {
			var links = panel.querySelectorAll("a");
			if (!links.length) return;
			selected = (selected + step + links.length) % links.length;
			links.forEach(function (a, i) { a.classList.toggle("selected", i === selected); });
			links[selected].scrollIntoView({ block: "nearest" });
		}

		box.addEventListener("input", function () { loadIndex(show); });
		box.addEventListener("focus", function () { loadIndex(function () { if (box.value.trim()) show(); }); });
		box.addEventListener("keydown", function (event) {
			if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
			else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
			else if (event.key === "Enter") {
				var link = panel.querySelectorAll("a")[selected];
				if (link) location.href = link.href;
			} else if (event.key === "Escape") { panel.hidden = true; box.blur(); }
		});

		// A click anywhere else closes the results; picking one closes them too
		document.addEventListener("click", function (event) {
			if (!event.target.closest(".search")) panel.hidden = true;
		});
		panel.addEventListener("click", function () { panel.hidden = true; });

		// Two ways to the search box from anywhere: "/", as on GitHub, and
		// Ctrl K (Cmd K on a Mac), as on most docs sites. Ctrl K works even
		// while typing somewhere else, since it doesn't type anything.
		var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
		var hint = document.getElementById("search-key");
		hint.textContent = mac ? "\u2318K" : "Ctrl K";
		box.title = "Search (" + (mac ? "\u2318K" : "Ctrl K") + " or /)";

		document.addEventListener("keydown", function (event) {
			var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
			var k = event.key && event.key.toLowerCase() === "k" && (mac ? event.metaKey : event.ctrlKey);
			if (k || (event.key === "/" && !typing)) {
				event.preventDefault();
				box.focus();
				box.select();
			}
		});

		// --- Copy buttons on code blocks ------------------------------------
		// Added here rather than written into each page, so every code
		// block on every page has one: the guides' and the Default UI
		// page's alike
		function copyText(text) {
			if (navigator.clipboard && window.isSecureContext) {
				return navigator.clipboard.writeText(text);
			}
			// Opened straight from a folder (file://), the clipboard API
			// isn't allowed; the older way still is
			return new Promise(function (resolve, reject) {
				var area = document.createElement("textarea");
				area.value = text;
				area.style.position = "fixed";
				area.style.opacity = "0";
				document.body.appendChild(area);
				area.select();
				var done = false;
				try { done = document.execCommand("copy"); } catch (e) {}
				document.body.removeChild(area);
				done ? resolve() : reject();
			});
		}

		document.querySelectorAll("main pre").forEach(function (pre) {
			var wrap = document.createElement("div");
			wrap.className = "code-block";
			pre.parentNode.insertBefore(wrap, pre);
			wrap.appendChild(pre);

			var button = document.createElement("button");
			button.type = "button";
			button.className = "glass copy-button";
			button.textContent = "Copy";
			button.setAttribute("aria-label", "Copy this code");
			wrap.appendChild(button);

			var timer;
			button.addEventListener("click", function () {
				copyText(pre.innerText.replace(/\\n$/, "")).then(
					function () { button.textContent = "Copied"; },
					function () { button.textContent = "Couldn't copy"; }
				);
				clearTimeout(timer);
				timer = setTimeout(function () { button.textContent = "Copy"; }, 1600);
			});
		});

		// --- On this page: the section being read ----------------------
		// The last heading that has scrolled up past the top bar is the one
		// being read. Marked in the right-hand list and in the contents on
		// the left (which shows it on narrower screens).
		var outlineLinks = Array.prototype.slice.call(
			document.querySelectorAll('aside.toc a[href^="#"], nav.side .outline a[href^="#"]')
		);
		var targets = [];
		outlineLinks.forEach(function (a) {
			var id = decodeURIComponent(a.getAttribute("href").slice(1));
			var el = document.getElementById(id);
			if (el && targets.indexOf(el) === -1) targets.push(el);
		});

		function markReading() {
			if (!targets.length) return;
			var line = 120;
			var current = targets[0];
			targets.forEach(function (el) {
				// A closed release on the changelog has no height to scroll
				// past, but still counts by where it is
				if (el.getBoundingClientRect().top <= line) current = el;
			});
			// Scrolled to the very bottom: the last section, even if it's
			// too short to reach the top
			if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
				current = targets[targets.length - 1];
			}
			outlineLinks.forEach(function (a) {
				var on = decodeURIComponent(a.getAttribute("href").slice(1)) === current.id;
				a.classList.toggle("active", on);
			});
		}

		var queued = false;
		window.addEventListener("scroll", function () {
			if (queued) return;
			queued = true;
			requestAnimationFrame(function () { queued = false; markReading(); });
		}, { passive: true });
		window.addEventListener("hashchange", markReading);
		markReading();
	})();
`;

// Dark / Light / Device as icons. The sun and the moon are the same
// drawings as the sign-in page's light/dark switch (modeSwitch() in
// core/ui-theme.js); the screen is drawn here in the same style. Each
// button's name is still there for screen readers (.sr-only), and shows
// as a tooltip when pointed at.
const MODE_ICONS = {
	dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>`,
	light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>`,
	device: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8M12 16v4"></path></svg>`
};

const modeButton = (mode, name, help) =>
	`<button type="button" class="tab-btn" data-mode="${mode}" title="${help}">${MODE_ICONS[mode]}<span class="sr-only">${name}</span></button>`;

// "On this page", on the right: the current page's own headings
function tableOfContents(outline) {
	if (!outline.length) return "";

	return `<aside class="toc" aria-label="On this page">
		<h2>On this page</h2>
		<nav>${outline.map((o) => `<a href="#${esc(o.id)}">${esc(o.text)}</a>`).join("")}</nav>
	</aside>`;
}

// Docs / Guides / Architecture: where this page sits. The group has no page
// of its own, so it's plain text. The home page has none: it IS "Docs".
function breadcrumb(groups, currentFile, title) {
	if (currentFile === "index.html") return "";

	const group = groups.find((g) => g.pages.some((p) => p.file === currentFile));
	const parts = [
		`<a href="index.html">Docs</a>`,
		group ? `<span>${esc(group.title)}</span>` : "",
		`<span aria-current="page">${esc(title)}</span>`
	].filter(Boolean);

	return `<nav class="crumbs" aria-label="Breadcrumb">${parts.join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
}

// The contents down the side: every page, in its group, with the current
// page's own headings listed under it.
function sideNav(groups, currentFile, outline) {
	return groups
		.map((group) => {
			const links = group.pages
				.map((page) => {
					const current = page.file === currentFile;
					const sub = current && outline.length
						? `<div class="outline">${outline.map((o) => `<a href="#${esc(o.id)}">${esc(o.text)}</a>`).join("")}</div>`
						: "";

					return `<a href="${page.file}"${current ? ' class="current" aria-current="page"' : ""}>${esc(page.navTitle)}</a>${sub}`;
				})
				.join("");

			return `<h2>${esc(group.title)}</h2>${links}`;
		})
		.join("");
}

// site:   { name, darkCss, lightCss, groups, repoUrl, commit, builtOn }
// page:   { file, title, body, outline, sourcePath, head, scripts }
function renderPage(site, page) {
	const outline = page.outline || [];
	const footer = [
		page.sourcePath && site.repoUrl
			? `<a href="${site.repoUrl}/blob/main/${encodeURI(page.sourcePath)}">Edit this page on GitHub</a>`
			: "",
		site.repoUrl ? `<a href="${site.repoUrl}">${esc(site.repoUrl.replace(/^https:\/\//, ""))}</a>` : "",
		`<span>Built ${esc(site.builtOn)}${site.commit ? ` from <code>${esc(site.commit.slice(0, 7))}</code>` : ""}</span>`,
		// The docs' licence (LICENSING.md)
		"<span>© 2026 Tanzim Ahmed. Docs all rights reserved, code examples 0BSD.</span>"
	].filter(Boolean).join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}${page.file === "index.html" ? "" : " · " + esc(site.name)}</title>
<meta name="color-scheme" content="dark light">
<style id="css-dark">${site.darkCss}</style>
<style id="css-light" media="(prefers-color-scheme: light)">${site.lightCss}</style>
<script>${MODE_HEAD_SCRIPT}</script>
<style>${SITE_CSS}</style>
${page.head || ""}
</head>
<body>
<a class="skip" href="#content">Skip to the page</a>
<header class="top">
	<button type="button" class="glass menu-button" id="menu-button" aria-expanded="false" aria-controls="side-nav" aria-label="Contents">&#9776;</button>
	<a class="brand" href="index.html"><b>Omnia</b> <span>OmniCore docs</span></a>
	<div class="search" role="search">
		<input type="text" id="search-box" placeholder="Search the docs" aria-label="Search the docs" autocomplete="off" spellcheck="false">
		<kbd id="search-key">Ctrl K</kbd>
		<div class="results" id="search-results" hidden></div>
	</div>
	<div class="tabs" id="mode-tabs" role="group" aria-label="Colours">
		${modeButton("dark", "Dark", "Dark")}
		${modeButton("light", "Light", "Light")}
		${modeButton("device", "Device", "Follow this device")}
	</div>
</header>
<div class="shell${outline.length ? " has-toc" : ""}">
	<nav class="side" id="side-nav" aria-label="Contents">${sideNav(site.groups, page.file, outline)}</nav>
	<main id="content">
		${breadcrumb(site.groups, page.file, page.title)}
		${page.body}
		<footer class="foot">${footer}</footer>
	</main>
	${tableOfContents(outline)}
</div>
<script>${FRAME_SCRIPT}</script>
${page.scripts || ""}
</body>
</html>
`;
}

module.exports = { renderPage, esc };
