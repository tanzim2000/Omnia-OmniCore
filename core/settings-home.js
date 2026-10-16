// core/settings-home.js
// The settings home (since v2): four tabs in a notch, on one page.
//
//   General      Location Service, Place search
//   Appearance   Background, Appearance Mode, Back Button, Frosted glass,
//                Text Size and Typography
//   Resources    Manage Faces, the Marketplace, Installed Resources
//   About        OmniCore itself, and its updates
//
// THE NOTCH
//
// A black notch drops from the top of the screen with an icon for each
// tab. The one picked shows its name beside its icon; the others show
// theirs on hover, keyboard focus or a long press, and every one has its
// name for screen readers. A dot on About means an update is ready. The
// icons are drawn here, by hand, as SVG: no icon font, nothing from the
// internet.
//
// THE MOVEMENT
//
// The four tabs sit side by side on one wide strip, and the screen is a
// window over it. Picking a tab slides the window: the boxes of the old tab
// slide out and the new tab's slide in, the way the tab lies (General is
// left of Appearance). The picture behind the page, when there is one,
// moves the same way but only a quarter as far, so the glass crosses
// different parts of it and the blur shows. The notch stays put. Each tab
// scrolls up and down on its own; the ones off the screen can't be reached
// with the keyboard or a screen reader. With reduced motion turned on, the
// tab simply changes.
//
// The address follows the tab (/#appearance), and the last tab is
// remembered in this browser, so opening Settings again, or reloading it,
// starts on the same tab, without any movement.
//
// WITHOUT THE SCRIPT
//
// The four tabs are one long page, one after the other, each with its name
// above it, and the notch's icons are links to them. Nothing is out of
// reach.

// The tabs, in the order they lie on the strip. `icon` is the SVG inside
// a 24 by 24 box, drawn with the text colour.
const TABS = [
	{
		id: "general",
		label: "General",
		icon:
			'<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/>' +
			'<circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'
	},
	{
		id: "resources",
		label: "Resources",
		icon:
			'<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/>' +
			'<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'
	},
	{
		id: "about",
		label: "About",
		icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor"/>'
	}
];

// The icons for the Resources tab's boxes, the same way
const TILE_ICONS = {
	faces: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
	marketplace: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
	installed: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'
};

function svg(paths, size) {
	return (
		`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
		`stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`
	);
}

// The notch. `updateReady` puts the dot on About.
function notchHtml(updateReady) {
	return `
	<nav class="notch" data-omni-notch aria-label="Settings sections">
		${TABS.map(
			(tab) => `<a class="nb" href="#${tab.id}" data-tab="${tab.id}" aria-label="${tab.label}${
				tab.id === "about" && updateReady ? ", an update is ready" : ""
			}">${svg(tab.icon, 22)}${
				tab.id === "about" && updateReady ? '<span class="nb-dot" aria-hidden="true"></span>' : ""
			}<span class="nl" aria-hidden="true">${tab.label}</span></a>`
		).join("")}
	</nav>`;
}

// A whole box on the Resources tab that is a link: its icon at the top,
// its name and a line under it at the foot
function tileHtml(href, icon, name, line, size) {
	return `
	<a class="segment clickable home-tile ${size}" href="${href}">
		${svg(TILE_ICONS[icon], 30)}
		<span class="tile-text"><strong>${name}</strong><span>${line}</span></span>
	</a>`;
}

// The page: the heading, the notch and the four tabs. `panes` holds each
// tab's boxes as HTML, by tab id.
//
// The address (#appearance) points at a tab's heading, not the tab
// itself. With the script, those headings aren't shown, so the browser has
// nothing to jump to or focus, and the script picks the tab; without it,
// they're where the notch's links jump to on the long page.
function homeHtml(panes, updateReady) {
	return `
	<script>${STARTING_TAB_SCRIPT}</script>
	<header class="home-head"><h1>Settings</h1></header>
	${notchHtml(updateReady)}
	<div class="home-panes">
		<div class="home-track">
			${TABS.map(
				(tab) => `
			<section class="home-pane" data-pane="${tab.id}" aria-label="${tab.label}">
				<h2 class="pane-title" id="${tab.id}">${tab.label}</h2>
				<div class="home-bento">${panes[tab.id] || ""}</div>
			</section>`
			).join("")}
		</div>
	</div>`;
}

// Runs before the tabs are drawn, so the page opens on the right tab with
// no movement and no flash of the long page: which tab (the address, or
// the one remembered, or General), and the tabbed layout itself.
const STARTING_TAB_SCRIPT = `
(function () {
	var ids = ${JSON.stringify(TABS.map((tab) => tab.id))};
	var root = document.documentElement;
	var wanted = location.hash.slice(1);
	if (ids.indexOf(wanted) === -1) {
		try { wanted = localStorage.getItem("omnicore-settings-tab") || ""; } catch (error) { wanted = ""; }
	}
	var index = Math.max(0, ids.indexOf(wanted));
	root.classList.add("home-tabs", "home-still");
	root.style.setProperty("--tab", index);
	root.setAttribute("data-tab", ids[index]);
})();
`;

// The tabs at work: picking one, the address, the remembered tab, the
// notch's names on a long press, and the notch sliding up as the page
// fades out (page-motion.js says when)
const HOME_SCRIPT = `
(function () {
	var ids = ${JSON.stringify(TABS.map((tab) => tab.id))};
	var root = document.documentElement;
	var panes = document.querySelectorAll("[data-pane]");
	var buttons = document.querySelectorAll(".notch [data-tab]");
	var notch = document.querySelector(".notch");

	function show(id, moving) {
		var index = ids.indexOf(id);
		if (index === -1) return;
		if (!moving) root.classList.add("home-still");
		root.style.setProperty("--tab", index);
		root.setAttribute("data-tab", id);

		panes.forEach(function (pane) {
			var here = pane.getAttribute("data-pane") === id;
			// The tabs off the screen can't be reached
			if (here) {
				pane.removeAttribute("inert");
				pane.removeAttribute("aria-hidden");
			} else {
				pane.setAttribute("inert", "");
				pane.setAttribute("aria-hidden", "true");
			}
		});

		buttons.forEach(function (button) {
			if (button.getAttribute("data-tab") === id) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});

		try { localStorage.setItem("omnicore-settings-tab", id); } catch (error) {}
		if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);

		if (!moving) {
			requestAnimationFrame(function () {
				requestAnimationFrame(function () { root.classList.remove("home-still"); });
			});
		}
	}

	buttons.forEach(function (button) {
		button.addEventListener("click", function (event) {
			event.preventDefault();
			show(button.getAttribute("data-tab"), true);
		});

		// Left and right move along the notch
		button.addEventListener("keydown", function (event) {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			var list = Array.prototype.slice.call(buttons);
			var next = list.indexOf(button) + (event.key === "ArrowRight" ? 1 : -1);
			if (next >= 0 && next < list.length) list[next].focus();
		});

		// A long press shows the name, for a finger that can't hover
		var held = null;
		button.addEventListener("pointerdown", function () {
			held = setTimeout(function () { button.classList.add("peek"); }, 450);
		});
		["pointerup", "pointerleave", "pointercancel"].forEach(function (name) {
			button.addEventListener(name, function () {
				clearTimeout(held);
				setTimeout(function () { button.classList.remove("peek"); }, 1200);
			});
		});
	});

	// A link to /#about from somewhere else on the page, or the browser's
	// own going back between tabs
	window.addEventListener("hashchange", function () {
		var id = location.hash.slice(1);
		if (ids.indexOf(id) !== -1 && id !== root.getAttribute("data-tab")) show(id, true);
	});

	// Leaving: the notch goes up, then the page fades
	window.addEventListener("omnicore:leaving", function () { notch.classList.add("notch-up"); });
	window.addEventListener("omnicore:stayed", function () { notch.classList.remove("notch-up"); });

	show(root.getAttribute("data-tab") || ids[0], false);
})();
`;

// The look. Added to the admin face's own styles.
const SETTINGS_HOME_CSS = `
	/* ---------------------------------------------------------------
	   The settings home (settings-home.js)
	   --------------------------------------------------------------- */

	/* The notch: black, dropping from the top, with a thin lighter edge
	   so it shows on a black page */
	.notch {
		position: fixed;
		top: 0;
		left: 50%;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 10px 8px;
		background: #000;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-top: 0;
		border-radius: 0 0 1.75em 1.75em;
		box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.1);
		transform: translate(-50%, 0);
		transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.25, 1.05);
	}

	/* Up and out of sight: as the page fades out, and before it drops in
	   when the page fades in */
	.notch.notch-up { transform: translate(-50%, -115%); transition-duration: 0.18s; }
	html.omni-arriving .notch { animation: notch-drop 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.05) 0.3s both; }
	@keyframes notch-drop { from { transform: translate(-50%, -115%); } to { transform: translate(-50%, 0); } }

	.nb {
		position: relative;
		display: flex;
		align-items: center;
		height: 2.75em;
		min-width: 2.75em;
		padding: 0 0.7em;
		border-radius: 1.4em;
		color: #fff;
		text-decoration: none;
		transition: background 0.25s;
	}

	.nb svg { flex: none; }
	.nb:hover, .nb:focus-visible { background: rgba(255, 255, 255, 0.14); outline: none; }
	.nb:focus-visible { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55); }
	.nb[aria-current="page"] { background: rgba(255, 255, 255, 0.18); }

	/* A tab's name: shown beside the picked one, and on hover, focus or a
	   long press */
	.nl {
		max-width: 0;
		overflow: hidden;
		white-space: nowrap;
		opacity: 0;
		font-size: 0.875em;
		transition: max-width 0.45s cubic-bezier(0.65, 0, 0.25, 1), opacity 0.3s, padding 0.45s;
	}

	.nb[aria-current="page"] .nl,
	.nb:hover .nl,
	.nb:focus-visible .nl,
	.nb.peek .nl {
		max-width: 8em;
		opacity: 1;
		padding-left: 0.5em;
	}

	/* An update is ready */
	.nb-dot {
		position: absolute;
		top: 0.45em;
		left: 1.6em;
		width: 0.6em;
		height: 0.6em;
		border-radius: 50%;
		background: #ffb020;
		border: 2px solid #000;
	}

	/* The page: the heading at the top, the tabs filling the rest, edge
	   to edge, so boxes slide in from the screen's edge rather than from
	   a margin. Room for the Back button is left inside each tab
	   instead. */
	body.settings-home {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		padding: 0;
	}

	body.settings-home:has(> .floating.bottom-right),
	body.settings-home:has(> .floating.top-left) { padding: 0; }
	html:has(body.settings-home) { height: 100%; }

	.home-head {
		flex: none;
		display: flex;
		align-items: center;
		min-height: 5.25em;
		padding: 0.9em 1.75em;
		/* The boxes' width plus the tab's own sides, so the heading
		   starts where the boxes do */
		max-width: calc(70em + 3.5em);
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.home-head h1 { margin: 0; }

	.home-panes { flex: 1; min-height: 0; position: relative; overflow: hidden; }

	/* Without the script: one long page */
	html:not(.home-tabs) body.settings-home { height: auto; overflow: visible; }
	html:not(.home-tabs) .home-pane { padding: 0 1.75em 2em; }
	.pane-title { max-width: 70rem; margin: 1em auto 0.75em; font-size: 1.1em; }
	html.home-tabs .pane-title { display: none; }

	/* With it: the strip of four, and the window over it */
	html.home-tabs .home-track {
		display: flex;
		width: 400%;
		height: 100%;
		transform: translateX(calc(var(--tab, 0) * -25%));
		transition: transform 0.72s cubic-bezier(0.65, 0, 0.25, 1);
	}

	html.home-tabs .home-pane {
		width: 25%;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
		padding: 0.25em 1.75em 7em;
		box-sizing: border-box;
	}

	/* The picture moves the same way, a quarter as far: wide enough to
	   pan three quarters of a screen */
	html.home-tabs body.settings-home .omni-backdrop {
		right: auto;
		width: 175vw;
		transform: translateX(calc(var(--tab, 0) * -25vw));
		transition: transform 0.72s cubic-bezier(0.65, 0, 0.25, 1);
	}

	/* Opening the page, or a tab picked from the address: no movement */
	html.home-still .home-track,
	html.home-still body.settings-home .omni-backdrop { transition: none; }

	@media (prefers-reduced-motion: reduce) {
		html.home-tabs .home-track,
		html.home-tabs body.settings-home .omni-backdrop,
		.notch, .nl { transition: none; }
		html.omni-arriving .notch { animation: none; }
	}

	/* The boxes: six columns, of different widths and heights, so a tab
	   isn't a row of even halves */
	.home-bento {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1em;
		max-width: 70em;
		margin: 0 auto;
		align-items: stretch;
	}

	.home-bento > .segment { margin: 0; min-width: 0; }
	.home-bento .c2 { grid-column: span 2; }
	.home-bento .c3 { grid-column: span 3; }
	.home-bento .c4 { grid-column: span 4; }
	.home-bento .c6 { grid-column: 1 / -1; }
	.home-bento .r2 { grid-row: span 2; }

	/* A whole box that is a link (Resources) */
	.home-tile {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.5em;
		min-height: 9.5em;
		color: var(--fg);
		text-decoration: none;
	}

	.tile-text { display: flex; flex-direction: column; gap: 0.25em; }
	.tile-text strong { font-size: 1.2em; font-weight: 600; }
	.tile-text > span { color: var(--fg-muted); font-size: 0.9em; line-height: 1.45; }

	/* The About tab's facts */
	.fact { display: flex; justify-content: space-between; gap: 1em; padding: 0.75em 0; border-top: 1px solid var(--segment-border); font-size: 0.95em; }
	.fact:first-of-type { border-top: 0; }
	.fact span:first-child { color: var(--fg-muted); white-space: nowrap; }

	/* The background's preview: a strip rather than a whole picture */
	.home-bento .backdrop-preview { aspect-ratio: auto; height: 12em; }
	.fact span:last-child { text-align: right; overflow-wrap: anywhere; }

	/* A phone held upright: one column, and the heading below the notch */
	@media (max-width: 42em) {
		.home-head { padding: 4.5em 1em 0.5em; min-height: 0; }
		html.home-tabs .home-pane { padding: 0.25em 1em 7em; }
		html:not(.home-tabs) .home-pane { padding: 0 1em 2em; }
		.home-bento { grid-template-columns: minmax(0, 1fr); }
		.home-bento .c2, .home-bento .c3, .home-bento .c4 { grid-column: 1 / -1; }
		.home-bento .r2 { grid-row: auto; }
		.home-tile { min-height: 7.5em; }
	}

	/* The Back button in the top left: the heading starts after it. On a
	   phone held upright it has a row of its own below the notch, with
	   the heading beside it. */
	body.settings-home:has(> .floating.top-left) .home-head { padding-left: 6em; }
	body.settings-home > .floating.top-left { top: 1.25em; }
	@media (max-width: 42em) {
		body.settings-home > .floating.top-left { top: 4.5em; }
		body.settings-home:has(> .floating.top-left) .home-head { padding-left: 5.5em; padding-top: 4.6em; min-height: 3.4em; }
	}
`;

module.exports = {
	TABS,
	SETTINGS_HOME_CSS,
	HOME_SCRIPT,
	STARTING_TAB_SCRIPT,
	notchHtml,
	tileHtml,
	homeHtml
};
