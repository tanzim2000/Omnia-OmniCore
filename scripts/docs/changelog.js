// scripts/docs/changelog.js
// The "Changelog" page: CHANGELOG.md drawn as a timeline, newest at the
// top, so how OmniCore grew can be read at a glance and opened up for
// detail.
//
// CHANGELOG.md is the only source. Every entry already has the same
// shape, and this relies on it:
//
//   ## v1.19.4                    the version
//   One line saying what it is    the intro (one paragraph or more)
//   ### Changed                   sections: Added, Changed, Fixed,
//   - ...                         Security, Notes, Upgrading...
//
// The date beside each version isn't written in the changelog. It's the
// date of that version's git tag; for a version not tagged yet (it was
// just written, and the tag comes after), the day its "## v..." line was
// added to CHANGELOG.md. With no git history at all, the date is simply
// left off.

const { execFileSync } = require("child_process");
const { esc } = require("./layout");

// "v1.19.4" -> "v1-19-4", the id a link to that release uses. Dots become
// hyphens rather than being dropped, so v1.1.0 and v1.10 can never collide.
const idFor = (text) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

const TIMELINE_CSS = `
	.stats { display: flex; flex-wrap: wrap; gap: 0.8em; margin: 0 0 2.2em; }
	.stat { padding: 0.9em 1.2em; min-width: 9em; }
	.stat b { display: block; font-size: 1.6em; font-weight: 300; line-height: 1.2; }
	.stat span { color: var(--fg-muted); font-size: 0.85em; }

	.timeline { position: relative; max-width: 54em; padding-left: 1.9em; }
	/* The line down the left that every release hangs off */
	.timeline::before {
		content: ""; position: absolute; left: 0.45em; top: 0.5em; bottom: 0.5em;
		width: 2px; background: var(--segment-border); border-radius: 1px;
	}
	.series { position: relative; font-size: 0.85em; font-weight: 600; letter-spacing: 0.04em; color: var(--fg-muted); margin: 2.2em 0 0.9em; }
	.series:first-child { margin-top: 0; }
	.release { position: relative; margin-bottom: 0.9em; padding: 0; }
	/* The dot on the line */
	.release::before {
		content: ""; position: absolute; left: -1.9em; top: 1.25em;
		width: 0.7em; height: 0.7em; margin-left: 0.17em; border-radius: 50%;
		background: var(--bg); border: 2px solid var(--fg-muted);
	}
	.release.latest::before { background: var(--success); border-color: var(--success); }
	.release summary {
		list-style: none; cursor: pointer; padding: 1em 1.2em; border-radius: var(--radius);
		display: grid; grid-template-columns: auto 1fr auto; gap: 0.2em 1em; align-items: baseline;
	}
	.release summary::-webkit-details-marker { display: none; }
	.release summary:hover { background: var(--hover-subtle); }
	.release summary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--glow-strong); }
	.release .version { font-weight: 600; font-size: 1.05em; }
	.release .date { color: var(--fg-muted); font-size: 0.82em; white-space: nowrap; }
	.release .tagline { grid-column: 1 / -1; line-height: 1.5; }
	.release .counts { grid-column: 1 / -1; font-size: 0.78em; color: var(--fg-muted); }
	.release .counts span + span::before { content: " · "; }
	.release .chevron { color: var(--fg-muted); transition: transform 0.2s; }
	.release[open] .chevron { transform: rotate(90deg); }
	.release .detail { padding: 0 1.2em 1.2em; border-top: 1px solid var(--segment-border); padding-top: 1em; }
	.release .detail h3 { font-size: 0.95em; margin: 1.2em 0 0.4em; }
	.release .detail h3:first-child { margin-top: 0; }
	.timeline-tools { display: flex; gap: 0.6em; margin: -1em 0 1.5em; }
`;

// Each version's tag date, from git: { "v1.19.4": "2026-10-11", ... }
function tagDates(cwd) {
	try {
		const out = execFileSync(
			"git",
			["for-each-ref", "--format=%(refname:short)%09%(creatordate:short)", "refs/tags"],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
		);
		return Object.fromEntries(out.trim().split("\n").filter(Boolean).map((line) => line.split("\t")));
	} catch {
		return {};
	}
}

// The day a version's heading first appeared in CHANGELOG.md. git log -S
// finds the commits that added or removed that exact text; --reverse puts
// the first one first.
function addedOn(cwd, version) {
	try {
		const out = execFileSync(
			"git",
			["log", "--reverse", "--format=%cs", "-S", `## ${version}\n`, "--", "CHANGELOG.md"],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
		);
		return out.split("\n")[0].trim() || null;
	} catch {
		return null;
	}
}

// "2026-10-11" -> "11 Oct 2026". Written out by hand rather than with the
// computer's language settings, so the site builds the same everywhere.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(iso) {
	const [y, m, d] = (iso || "").split("-").map(Number);
	return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : "";
}

// CHANGELOG.md -> [{ version, intro, sections: [{ name, markdown }] }]
function parseChangelog(source) {
	return source
		.split(/^## /m)
		.slice(1)
		.map((chunk) => {
			const [firstLine, ...rest] = chunk.split("\n");
			const parts = rest.join("\n").split(/^### /m);
			return {
				version: firstLine.trim(),
				intro: parts[0].trim(),
				sections: parts.slice(1).map((part) => {
					const [name, ...lines] = part.split("\n");
					return { name: name.trim(), markdown: lines.join("\n").trim() };
				})
			};
		});
}

// options:
//   source      CHANGELOG.md's text
//   renderMd    Markdown -> { html, ... } (from markdown.js)
//   cwd         the repo, for reading tag dates
//   file        this page's file name, for search results
function renderChangelog({ source, renderMd, cwd, file }) {
	const releases = parseChangelog(source);
	const dates = tagDates(cwd);

	// A version that isn't tagged yet: the day it was written down instead
	for (const release of releases) {
		if (!dates[release.version]) {
			const day = addedOn(cwd, release.version);
			if (day) dates[release.version] = day;
		}
	}

	// Releases grouped by their first two numbers ("v1.19"), the way the
	// work was actually done: a series of small steps on one idea
	const series = [];
	for (const release of releases) {
		const key = release.version.split(".").slice(0, 2).join(".");
		const last = series[series.length - 1];
		if (last && last.key === key) last.releases.push(release);
		else series.push({ key, releases: [release] });
	}

	const searchEntries = [];

	const card = (release, isLatest) => {
		const id = idFor(release.version);
		const date = prettyDate(dates[release.version]);
		// The intro's first paragraph is the one-line summary shown when
		// the release is closed; anything after it (a warning, say) goes
		// inside with the details
		const [tagline, ...moreIntro] = release.intro.split(/\n\s*\n/);
		const counts = release.sections
			.map((s) => {
				const n = (s.markdown.match(/^- /gm) || []).length;
				return `<span>${esc(s.name)}${n ? " " + n : ""}</span>`;
			})
			.join("");
		const detail = [
			moreIntro.length ? renderMd(moreIntro.join("\n\n")).html : "",
			...release.sections.map((s) => `<h3>${esc(s.name)}</h3>${renderMd(s.markdown).html}`)
		].join("");

		searchEntries.push({
			t: release.version + (date ? ` (${date})` : ""),
			u: `${file}#${id}`,
			x: renderMd(release.intro + "\n\n" + release.sections.map((s) => s.markdown).join("\n\n")).sections.map((s) => s.text).join(" ")
		});

		return `
<details class="segment release${isLatest ? " latest" : ""}" id="${esc(id)}"${isLatest ? " open" : ""}>
	<summary>
		<span class="version">${esc(release.version)}</span>
		<span class="date">${esc(date)}</span>
		<span class="chevron" aria-hidden="true">›</span>
		<span class="tagline">${renderMd(tagline).html.replace(/^<p>|<\/p>\s*$/g, "")}</span>
		<span class="counts">${counts}</span>
	</summary>
	<div class="detail prose">${detail}</div>
</details>`;
	};

	const first = releases[releases.length - 1];
	const latest = releases[0];
	const firstDate = first && dates[first.version];
	const latestDate = latest && dates[latest.version];
	const days = firstDate && latestDate
		? Math.round((Date.parse(latestDate) - Date.parse(firstDate)) / 86400000)
		: null;

	const stats = [
		[releases.length, "releases"],
		latest ? [esc(latest.version), latestDate ? `latest, ${prettyDate(latestDate)}` : "latest"] : null,
		first ? [esc(first.version), firstDate ? `first, ${prettyDate(firstDate)}` : "first"] : null,
		days !== null ? [days, "days from first to latest"] : null
	].filter(Boolean);

	const body = `
<div class="page-head">
	<h1>Changelog</h1>
	<p class="lede">Every OmniCore release, newest first: how it grew, one step at a time. Open a release to see everything in it. Written in <code>CHANGELOG.md</code>; each date is when that version was tagged, or written down if it isn't tagged yet.</p>
</div>
<div class="stats">${stats.map(([big, small]) => `<div class="segment stat"><b>${big}</b><span>${small}</span></div>`).join("")}</div>
<div class="timeline-tools">
	<button type="button" class="glass" id="open-all" style="padding:0.5em 1.1em">Open all</button>
	<button type="button" class="glass" id="close-all" style="padding:0.5em 1.1em">Close all</button>
</div>
<div class="timeline">
	${series.map((group, gi) => `
	<div class="series" id="${esc(idFor(group.key))}">${esc(group.key)}.x</div>
	${group.releases.map((release, ri) => card(release, gi === 0 && ri === 0)).join("")}`).join("")}
</div>`;

	// Opening a link to one release (from search, say) opens that release
	const scripts = `
<script>
	(function () {
		function openFromHash() {
			var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
			if (target && target.tagName === "DETAILS") target.open = true;
		}
		window.addEventListener("hashchange", openFromHash);
		openFromHash();
		function setAll(open) {
			document.querySelectorAll(".release").forEach(function (d) { d.open = open; });
		}
		document.getElementById("open-all").addEventListener("click", function () { setAll(true); });
		document.getElementById("close-all").addEventListener("click", function () { setAll(false); });
	})();
</script>`;

	return {
		body,
		outline: series.map((group) => ({ id: idFor(group.key), text: `${group.key}.x` })),
		searchEntries,
		head: `<style>${TIMELINE_CSS}</style>`,
		scripts
	};
}

module.exports = { renderChangelog, parseChangelog };
