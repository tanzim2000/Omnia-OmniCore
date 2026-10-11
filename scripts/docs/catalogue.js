// scripts/docs/catalogue.js
// The "Default UI" page: every element in core/ui-theme.js with its name,
// what it's for, a live sample and the markup to copy.
//
// Two sources, put together here:
//   core/ui-theme.js       the real colours (PALETTES) and, through the
//                          page frame, the real stylesheet, so every sample
//                          is the actual element and not a picture of it
//   docs/ui-elements.js    the words: names, descriptions, samples, notes

const { esc } = require("./layout");

// "glassBgHover" -> "--glass-bg-hover", the CSS variable each colour becomes
const cssVariable = (key) => "--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

// Styles only this page needs: the colour table, and the dashed box each
// sample sits in
const CATALOGUE_CSS = `
	.ui-section { margin-bottom: 3em; }
	.ui-section > h2 { font-weight: 300; font-size: 1.6em; margin: 0 0 0.25em; }
	.ui-section > .intro { color: var(--fg-muted); margin: 0 0 1.2em; }
	.el { margin-bottom: 1.2em; }
	.el > header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5em 1em; margin-bottom: 0.5em; }
	.el h3 { margin: 0; font-size: 1.08em; font-weight: 600; }
	.el h3 a { text-decoration: none; }
	.sel { color: var(--fg-muted); }
	.el .desc { margin: 0 0 1em; max-width: 52em; line-height: 1.6; }
	.stage { border: 1px dashed var(--border); border-radius: var(--radius); padding: 1.1em; margin-bottom: 0.8em; }
	/* A box that holds things normally pinned to the window (floating
	   buttons, pop-ups): "transform" makes it the frame they pin to */
	.stage.fenced { position: relative; transform: translateZ(0); overflow: hidden; }
	.stage .center-row { display: flex; justify-content: center; }
	.stage .stage-caption { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); white-space: nowrap; }
	.stage .field:last-child { margin-bottom: 0; }
	.stage h1 { font-size: 1.75em; }
	.el pre { margin: 0; }
	.el .note { margin: 0.8em 0 0; font-size: 0.86em; color: var(--fg-muted); max-width: 52em; line-height: 1.55; }
	.el .note b { color: var(--fg); }
	.plain td:first-child { white-space: nowrap; padding-right: 1.2em; }
	.colours td:nth-child(-n+3) { white-space: nowrap; }
	.colours tr.group th { background: none; padding-top: 1.2em; }
	.colours .table-wrap table { min-width: 42em; }
	.chip-base { display: inline-block; vertical-align: middle; margin-right: 0.6em; border-radius: 0.4em; border: 1px solid var(--segment-border); }
	.chip { display: block; width: 2.4em; height: 1.5em; border-radius: 0.35em; }
	.colours code { font-size: 0.75em; vertical-align: middle; }
`;

// The samples that do something when clicked: tabs that switch, a stepper
// that counts. The Show / Hide button uses ui-theme.js's own script.
function sampleScripts(passwordScript) {
	return `
<script>${passwordScript}</script>
<script>
	document.querySelectorAll("[data-demo-tabs]").forEach(function (tabs) {
		tabs.addEventListener("click", function (event) {
			var button = event.target.closest(".tab-btn");
			if (!button) return;
			tabs.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.toggle("active", b === button); });
		});
	});
	document.querySelectorAll("[data-demo-stepper]").forEach(function (stepper) {
		var input = stepper.querySelector("input");
		stepper.addEventListener("click", function (event) {
			var button = event.target.closest("[data-step]");
			if (!button) return;
			var next = Number(input.value) + Number(button.dataset.step);
			input.value = Math.min(Number(input.max), Math.max(Number(input.min), next));
		});
	});
</script>`;
}

function colourTable(palettes, notes, groups) {
	const keys = Object.keys(palettes.dark);
	const placed = new Set(groups.flatMap(([, list]) => list));
	const leftover = keys.filter((key) => !placed.has(key));
	const allGroups = leftover.length ? [...groups, ["Other", leftover]] : groups;

	const cell = (key, value, backing) => {
		// A shadow isn't a colour, so there's nothing to show a square of
		const chip = /shadow/i.test(key)
			? ""
			: `<span class="chip-base" style="background:${backing}"><span class="chip" style="background:${esc(value)}"></span></span>`;
		return `<td>${chip}<code>${esc(value)}</code></td>`;
	};

	const rows = allGroups
		.map(([title, list]) => {
			const head = `<tr class="group"><th colspan="4">${esc(title)}</th></tr>`;
			const body = list
				.filter((key) => key in palettes.dark)
				.map((key) =>
					`<tr><td><code>${cssVariable(key)}</code></td>` +
					cell(key, palettes.dark[key], "#000") +
					cell(key, palettes.light[key], "#f2f2f4") +
					`<td>${esc(notes[key] || "")}</td></tr>`)
				.join("");
			return head + body;
		})
		.join("");

	return `<div class="table-wrap"><table><thead><tr><th>Variable</th><th>Dark</th><th>Light</th><th>Used for</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function elementCard(entry) {
	const fenced = entry.stage ? " fenced" : "";
	const height = entry.stage ? ` style="height:${Number(entry.stage)}px"` : "";

	return `
<article class="segment el" id="${esc(entry.id)}">
	<header><h3><a href="#${esc(entry.id)}">${esc(entry.title)}</a></h3><code class="sel">${esc(entry.sel)}</code></header>
	<p class="desc">${entry.desc}</p>
	<div class="stage${fenced}"${height}>${entry.demo}</div>
	<pre><code>${esc(entry.code)}</code></pre>
	${entry.note ? `<p class="note"><b>Note.</b> ${entry.note}</p>` : ""}
</article>`;
}

function twoColumnTable(rows) {
	return `<div class="table-wrap"><table class="plain">${rows
		.map(([name, text]) => `<tr><td><code>${esc(name)}</code></td><td>${esc(text)}</td></tr>`)
		.join("")}</table></div>`;
}

// Strips tags off a description so search can read it as plain words
const textOf = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

// theme:   core/ui-theme.js
// data:    docs/ui-elements.js
// file:    this page's file name, for search results to link to
function renderCatalogue(theme, data, file) {
	const { paletteNotes, paletteGroups, sections, helpers, elsewhere } = data;
	const colourCount = Object.keys(theme.PALETTES.dark).length;
	const elementCount = sections.reduce((n, s) => n + s.entries.length, 0);

	const body = `
<div class="page-head">
	<h1>Default UI</h1>
	<p class="lede">Every element in <code>core/ui-theme.js</code>, the stylesheet behind the pages OmniCore draws itself: Settings, the welcome face, the setup wizard and input faces. ${elementCount} elements and ${colourCount} colours. The samples are the real thing, drawn with the real stylesheet: point at them, click them, and switch Dark / Light at the top to see both.</p>
</div>

<section class="ui-section colours" id="colours">
	<h2>Colours</h2>
	<p class="intro">Every colour is a CSS variable, filled in from the <code>PALETTES</code> table at the top of <code>ui-theme.js</code>; light mode is just the other table. Each square sits on that mode's page colour, so the see-through ones show as they really look.</p>
	${colourTable(theme.PALETTES, paletteNotes, paletteGroups)}
</section>

${sections.map((section) => `
<section class="ui-section" id="${esc(section.id)}">
	<h2>${esc(section.title)}</h2>
	<p class="intro">${esc(section.intro)}</p>
	${section.entries.map(elementCard).join("")}
</section>`).join("")}

<section class="ui-section" id="helpers">
	<h2>Helpers and scripts</h2>
	<p class="intro">Not things you see, but what <code>ui-theme.js</code> hands to the pages that use it.</p>
	${twoColumnTable(helpers)}
</section>

<section class="ui-section" id="elsewhere">
	<h2>Not in this file</h2>
	<p class="intro">Things people look for in <code>ui-theme.js</code> that are really defined somewhere else.</p>
	${twoColumnTable(elsewhere)}
</section>`;

	const outline = [
		{ id: "colours", text: "Colours" },
		...sections.map((s) => ({ id: s.id, text: s.title })),
		{ id: "helpers", text: "Helpers and scripts" },
		{ id: "elsewhere", text: "Not in this file" }
	];

	// One search result per element, so typing "capsule" lands on it
	const searchEntries = [
		{ t: "Colours", u: `${file}#colours`, x: Object.entries(paletteNotes).map(([k, v]) => `${cssVariable(k)} ${v}`).join(" ") },
		...sections.flatMap((s) => s.entries.map((e) => ({
			t: e.title,
			u: `${file}#${e.id}`,
			x: `${e.sel} ${textOf(e.desc)} ${e.note ? textOf(e.note) : ""}`
		}))),
		{ t: "Helpers and scripts", u: `${file}#helpers`, x: helpers.map((h) => h.join(" ")).join(" ") },
		{ t: "Not in this file", u: `${file}#elsewhere`, x: elsewhere.map((h) => h.join(" ")).join(" ") }
	];

	return {
		body,
		outline,
		searchEntries,
		head: `<style>${CATALOGUE_CSS}</style>`,
		scripts: sampleScripts(theme.PASSWORD_TOGGLE_SCRIPT)
	};
}

module.exports = { renderCatalogue, cssVariable };
