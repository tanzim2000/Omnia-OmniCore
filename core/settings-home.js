// core/settings-home.js
// The settings home (since v2): four tabs in a notch, on one page.
//
//   General      Location Service, Place search, Saved keys, a box to try
//                a search
//   Appearance   Frosted glass, Background (with the Back button's
//                corner), Appearance Mode, Text Size and Typography
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
// THE MOVEMENT (sideways since the v2 test run)
//
// The four tabs lie side by side on one strip that scrolls sideways, never
// up and down. Each tab is at least a screen wide, and its boxes sit on a
// grid whose two rows fit the screen's height and whose columns go on to
// the right: a tab with more boxes than fit is wider, not taller. The
// mouse wheel moves the strip sideways (a trackpad's sideways swipe does
// too), except over something that scrolls by itself (the release notes, a
// box with more in it than fits, a list), which scrolls as usual. Scrolling
// on past a tab's end goes into the next one; the notch marks whichever
// tab is in the middle of the screen, and the address and the remembered
// tab follow. Let go between two tabs and the strip snaps: it glides on to
// the next tab the way it was going, or back if it was only nudged.
// Picking a tab in the notch glides there (jumps, with reduced motion).
// The picture behind the page, when there is one, pans along, three
// quarters of a screen from one end of the strip to the other, so the
// glass crosses different parts of it and the blur shows.
//
// A box gets the height its row gives it. The two rows share the screen's
// height fairly: a row that needs less than half gets all it needs, so one
// tall box can't squeeze the other row to nothing. A box with more in it
// than fits (a short window, say) scrolls inside itself. A box with a
// search list open never cuts the list off.
//
// A phone held upright keeps one column of boxes up and down per tab,
// below the heading, and a sideways swipe changes tab, one whole tab at a
// time.
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

// The tabs at work: the strip scrolling sideways (the wheel, the notch,
// the tab in view), the address, the remembered tab, the picture panning,
// boxes that scroll inside themselves, the notch's names on a long press,
// and the notch sliding up as the page fades out (page-motion.js says when)
const HOME_SCRIPT = `
(function () {
	var ids = ${JSON.stringify(TABS.map((tab) => tab.id))};
	var root = document.documentElement;
	var strip = document.querySelector(".home-panes");
	var panes = Array.prototype.slice.call(document.querySelectorAll("[data-pane]"));
	var buttons = document.querySelectorAll(".notch [data-tab]");
	var notch = document.querySelector(".notch");
	var wide = window.matchMedia("(min-width: 42.01em)");
	var still = window.matchMedia("(prefers-reduced-motion: reduce)");
	var current = null;

	function paneOf(id) {
		return document.querySelector('[data-pane="' + id + '"]');
	}

	// The notch, the address and the remembered tab follow the tab in view
	function mark(id) {
		if (id === current || ids.indexOf(id) === -1) return;
		current = id;
		root.setAttribute("data-tab", id);
		root.style.setProperty("--tab", ids.indexOf(id));

		buttons.forEach(function (button) {
			if (button.getAttribute("data-tab") === id) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});

		try { localStorage.setItem("omnicore-settings-tab", id); } catch (error) {}
		if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
	}

	// Go to a tab: glide there, or jump (opening the page, reduced motion)
	function show(id, moving) {
		var pane = paneOf(id);
		if (!pane) return;
		gliding = moving && !still.matches;
		started = null;
		strip.scrollTo({ left: pane.offsetLeft, behavior: gliding ? "smooth" : "auto" });
		mark(id);
	}

	// SNAPPING (wide screens; a phone's own scroll snapping does it there).
	// The strip moves freely while the wheel turns or a finger or trackpad
	// pushes it. Once it stops between two tabs, it glides on to the next
	// tab the way it was going, or back if it hardly moved (a nudge).
	var gliding = false;   // our own glide, not the person's
	var started = null;    // where the person's push began
	var heading = 0;       // which way they pushed: 1 right, -1 left
	var lastLeft = 0;
	var holding = false;   // a finger still on the screen
	var resting = null;
	var NUDGE = 48;

	// Where the strip can rest: the start of each tab, and its end too if
	// a tab is wider than the screen (anywhere in between is fine there)
	function stops() {
		var list = [];
		panes.forEach(function (pane) {
			var start = pane.offsetLeft;
			var end = Math.max(start, start + pane.offsetWidth - strip.clientWidth);
			list.push([start, end]);
		});
		return list;
	}

	function settle() {
		resting = null;
		if (!wide.matches || holding) return;
		var left = strip.scrollLeft;
		var points = [];
		var inside = stops().some(function (stop) {
			points.push(stop[0], stop[1]);
			return left >= stop[0] - 2 && left <= stop[1] + 2;
		});
		var from = started;
		started = null;
		gliding = false;
		if (inside) return;

		points.sort(function (a, b) { return a - b; });
		var target;
		if (from === null || Math.abs(left - from) < NUDGE) {
			// A nudge, or a glide that was cut short: the nearest place
			target = points.reduce(function (best, point) {
				return Math.abs(point - left) < Math.abs(best - left) ? point : best;
			}, points[0]);
		} else if (heading > 0) {
			target = points.filter(function (point) { return point > left; })[0];
			if (target === undefined) target = points[points.length - 1];
		} else {
			target = points.filter(function (point) { return point < left; }).pop();
			if (target === undefined) target = points[0];
		}

		gliding = !still.matches;
		strip.scrollTo({ left: target, behavior: gliding ? "smooth" : "auto" });
	}

	// Wait for the strip to be still for a moment before snapping
	function settleSoon() {
		clearTimeout(resting);
		resting = setTimeout(settle, 140);
	}

	// The person moved it (not our glide): remember where from and which
	// way
	function pushed(from, by) {
		// They took over in the middle of a glide: stop it where it is
		if (gliding) strip.scrollTo({ left: from, behavior: "instant" });
		gliding = false;
		if (started === null) started = from;
		if (by) heading = by > 0 ? 1 : -1;
	}

	strip.addEventListener("touchstart", function () { holding = true; gliding = false; }, { passive: true });
	["touchend", "touchcancel"].forEach(function (name) {
		strip.addEventListener(name, function () { holding = false; settleSoon(); }, { passive: true });
	});

	// The tab under the middle of the screen
	function inView() {
		var middle = strip.scrollLeft + strip.clientWidth / 2;
		var found = ids[0];
		panes.forEach(function (pane) {
			if (pane.offsetLeft <= middle) found = pane.getAttribute("data-pane");
		});
		return found;
	}

	// The picture pans along: 0 at the start of the strip, 1 at its end
	function pan() {
		var most = strip.scrollWidth - strip.clientWidth;
		root.style.setProperty("--pan", most > 0 ? strip.scrollLeft / most : 0);
	}

	// The two rows of a tab share its height fairly. Each row is measured
	// at the height its boxes want. If both fit, the first gets what it
	// wants and the second the rest. If not, a row that wants less than
	// half gets all it wants, and the other row the rest; if both want
	// more than half, they get half each. So one tall box can't squeeze
	// the other row down to nothing. (Resources has its own even rows.)
	function rows(bento) {
		var first = bento.querySelectorAll(":scope > .row1");
		var second = bento.querySelectorAll(":scope > .row2");
		if (!wide.matches || !first.length || !second.length || bento.querySelector(".home-tile")) {
			if (bento.style.gridTemplateRows) bento.style.gridTemplateRows = "";
			return;
		}

		// Measure: for a moment, every box its own natural height
		bento.classList.add("measuring");
		var want1 = 0;
		var want2 = 0;
		first.forEach(function (box) { want1 = Math.max(want1, box.offsetHeight); });
		second.forEach(function (box) { want2 = Math.max(want2, box.offsetHeight); });
		bento.classList.remove("measuring");

		var gap = parseFloat(getComputedStyle(bento).rowGap) || 0;
		var room = bento.clientHeight - gap;
		var half = room / 2;
		var top;
		if (want1 + want2 <= room || want1 <= half) top = want1;
		else if (want2 <= half) top = room - want2;
		else top = half;

		var value = Math.max(0, Math.floor(top)) + "px minmax(0, 1fr)";
		if (bento.style.gridTemplateRows !== value) bento.style.gridTemplateRows = value;
	}

	// Rows shared out, then a box with more in it than its place on the
	// grid has room for scrolls inside itself. A box with a search list
	// open is left alone: the list floats over the page, outside the box,
	// and isn't more for the box to hold.
	function fit() {
		document.querySelectorAll(".home-bento").forEach(rows);
		document.querySelectorAll(".home-bento > .segment").forEach(function (box) {
			if (box.classList.contains("float-open")) return;
			box.classList.remove("box-scroll");
			if (wide.matches && box.scrollHeight > box.clientHeight + 1) box.classList.add("box-scroll");
		});
	}

	var waiting = false;
	function soon(work) {
		if (waiting) return;
		waiting = true;
		requestAnimationFrame(function () {
			waiting = false;
			work();
		});
	}

	strip.addEventListener("scroll", function () {
		// A trackpad's sideways swipe or a finger moves the strip itself
		var left = strip.scrollLeft;
		if (!gliding && left !== lastLeft) pushed(lastLeft, left - lastLeft);
		lastLeft = left;
		settleSoon();

		soon(function () {
			pan();
			mark(inView());
		});
	}, { passive: true });

	// Can this element, or one around it inside the strip, still scroll
	// up or down that way? Then the wheel is for it.
	function scrollsItself(element, delta) {
		for (var at = element; at && at !== strip; at = at.parentElement) {
			var overflow = getComputedStyle(at).overflowY;
			if ((overflow === "auto" || overflow === "scroll") && at.scrollHeight > at.clientHeight + 1) {
				if (delta < 0 ? at.scrollTop > 0 : at.scrollTop + at.clientHeight < at.scrollHeight - 1) return true;
			}
		}
		return false;
	}

	// The wheel moves the strip sideways. A sideways swipe on a trackpad
	// already does, and a phone's tabs scroll up and down by themselves.
	strip.addEventListener("wheel", function (event) {
		if (event.ctrlKey || !wide.matches) return;
		if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
		if (scrollsItself(event.target, event.deltaY)) return;
		var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
		event.preventDefault();
		var from = strip.scrollLeft;
		pushed(from, event.deltaY);
		strip.scrollLeft = from + event.deltaY * unit;
		lastLeft = strip.scrollLeft;
		settleSoon();
	}, { passive: false });

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
		if (ids.indexOf(id) !== -1 && id !== current) show(id, true);
	});

	// A new window size: the tab in view stays in view, boxes are measured
	// again
	window.addEventListener("resize", function () {
		soon(function () {
			var id = current;
			current = null;
			show(id || ids[0], false);
			fit();
			pan();
		});
	});

	// Something in a box opened or closed (Set it myself, a warning, a
	// list): measure again
	new MutationObserver(function () { soon(fit); }).observe(strip, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["hidden", "style"]
	});

	// Or something in a box changed size (the text size, a font that
	// arrived late, a longer line of text)
	if (window.ResizeObserver) {
		var sizes = new ResizeObserver(function () { soon(fit); });
		document.querySelectorAll(".home-bento > .segment").forEach(function (box) {
			sizes.observe(box);
			Array.prototype.forEach.call(box.children, function (part) { sizes.observe(part); });
		});
	}
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { soon(fit); });

	// Leaving: the notch goes up, then the page fades
	window.addEventListener("omnicore:leaving", function () { notch.classList.add("notch-up"); });
	window.addEventListener("omnicore:stayed", function () { notch.classList.remove("notch-up"); });

	show(root.getAttribute("data-tab") || ids[0], false);
	fit();
	pan();
	requestAnimationFrame(function () {
		requestAnimationFrame(function () { root.classList.remove("home-still"); });
	});
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

	/* The tabs start 3em higher than they look, under the heading, with
	   that 3em given back as padding inside each tab. The strip cuts off
	   anything outside it, and a glowing box in the first row would have
	   its glow cut off in a straight line where the tabs begin. The extra
	   room is where that glow goes. */
	.home-panes { flex: 1; min-height: 0; position: relative; overflow: hidden; margin-top: -3em; }
	html:not(.home-tabs) .home-panes { margin-top: 0; }

	/* Without the script: one long page */
	html:not(.home-tabs) body.settings-home { height: auto; overflow: visible; }
	html:not(.home-tabs) .home-pane { padding: 0 1.75em 2em; }
	.pane-title { max-width: 70rem; margin: 1em auto 0.75em; font-size: 1.1em; }
	html.home-tabs .pane-title { display: none; }

	/* With it: one strip of the four tabs, scrolling sideways. No
	   scrollbar: the notch says where you are. */
	html.home-tabs .home-panes {
		width: 100%;
		max-width: 100vw;
		min-width: 0;
		align-self: stretch;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	html.home-tabs .home-panes::-webkit-scrollbar { display: none; }

	html.home-tabs .home-track {
		display: flex;
		width: max-content;
		height: 100%;
	}

	/* The picture pans along with the strip (--pan, 0 to 1, set by the
	   script as it scrolls): wide enough to pan three quarters of a
	   screen */
	html.home-tabs body.settings-home .omni-backdrop {
		right: auto;
		width: 175vw;
		transform: translateX(calc(var(--pan, 0) * -75vw));
	}

	@media (prefers-reduced-motion: reduce) {
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
		/* Each box its own height, so a short one beside a tall one isn't
		   stretched into an empty frame; a box two rows tall (r2) fills
		   both */
		align-items: start;
	}

	.home-bento > .segment { margin: 0; min-width: 0; }
	.home-bento .c2 { grid-column: span 2; }
	.home-bento .c3 { grid-column: span 3; }
	.home-bento .c4 { grid-column: span 4; }
	.home-bento .c6 { grid-column: 1 / -1; }
	.home-bento .r2 { grid-row: span 2; align-self: stretch; }

	/* Anything but a phone held upright: the grid goes sideways. Two rows
	   that fit the screen (the first as tall as its boxes need, the second
	   what's left), and columns a sixth of the boxes' width that go on to
	   the right, so the first six are the screen and any more make the
	   tab wider. Each tab is at least a screen wide, its first screen in
	   the middle as before. */
	@media (min-width: 42.01em) {
		html.home-tabs .home-pane {
			--home-width: min(100vw - 3.5em, 70em);
			flex: none;
			height: 100%;
			min-width: 100vw;
			box-sizing: border-box;
			padding: 3.25em max(1.75em, calc((100vw - 70em) / 2)) 1.75em;
		}

		/* Room for the Back button in the bottom right corner */
		body.settings-home:has(> .floating.bottom-right) .home-pane { padding-bottom: 6em; }

		html.home-tabs .home-bento {
			height: 100%;
			max-width: none;
			margin: 0;
			grid-template-columns: none;
			/* The first row as tall as its boxes need, but never taller
			   than the room left once the second has at least 10em (or
			   45% on a very short screen); the second gets the rest. The
			   script then shares the height out fairly (rows(), set on
			   the grid itself); this is how it starts. */
			grid-template-rows: minmax(0, auto) minmax(min(10em, 45%), 1fr);
			grid-auto-flow: column dense;
			grid-auto-columns: calc((var(--home-width) - 5em) / 6);
		}

		html.home-tabs .home-bento .c6 { grid-column: span 6; }

		/* Which row a box is on, so it stays there however the grid fills
		   (sideways, it fills each column top to bottom first). The boxes
		   of the first row end level with each other. */
		html.home-tabs .home-bento .row1 { grid-row: 1; align-self: stretch; }
		html.home-tabs .home-bento .row2 { grid-row: 2; }
		html.home-tabs .home-bento .r2 { grid-row: 1 / span 2; }

		/* Resources: three big tiles that fill the screen, two rows of the
		   same height */
		html.home-tabs .home-pane[data-pane=resources] .home-bento { grid-template-rows: repeat(2, minmax(0, 1fr)); }
		html.home-tabs .home-bento > .home-tile { align-self: stretch; }

		/* A box never taller than its place; one with more in it scrolls
		   inside itself (box-scroll, set by the script only when needed) */
		html.home-tabs .home-bento > .segment { max-height: 100%; }
		html.home-tabs .home-bento > .segment.box-scroll {
			overflow-y: auto;
			overscroll-behavior: contain;
			scrollbar-width: thin;
			scrollbar-color: var(--scroll-thumb) transparent;
		}

		/* A box with a search list open never cuts the list off: the list
		   floats over the page, and only the window's edge limits it */
		html.home-tabs .home-bento > .segment.float-open { overflow: visible; }

		/* For a moment, while the script measures the height each box
		   wants: every box at its natural height */
		html.home-tabs .home-bento.measuring { grid-template-rows: auto auto !important; }
		html.home-tabs .home-bento.measuring > .segment { max-height: none; align-self: start; }
	}

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
	.home-bento .backdrop-preview { aspect-ratio: auto; height: 10em; }
	.fact span:last-child { text-align: right; overflow-wrap: anywhere; }

	/* A phone held upright: one column, and the heading below the notch.
	   Each tab a screen wide, scrolling up and down by itself; a sideways
	   swipe moves a whole tab at a time. */
	@media (max-width: 42em) {
		.home-head { padding: 4.5em 1em 0.5em; min-height: 0; }
		/* Here the tabs start right under the heading, not 3em above it:
		   each tab scrolls up and down, and its boxes go out of sight at
		   the heading's lower edge instead of sliding over the heading
		   and the Back button. (A fade there would also stop the boxes'
		   frosted glass from blurring the picture, so it's a clean
		   edge.) */
		html.home-tabs .home-panes { scroll-snap-type: x mandatory; margin-top: 0; }
		html.home-tabs .home-pane {
			flex: none;
			width: 100vw;
			height: 100%;
			box-sizing: border-box;
			overflow-y: auto;
			overscroll-behavior-y: contain;
			scrollbar-width: thin;
			scrollbar-color: var(--scroll-thumb) transparent;
			scroll-snap-align: start;
			scroll-snap-stop: always;
			padding: 1em 1em 7em;
		}
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
