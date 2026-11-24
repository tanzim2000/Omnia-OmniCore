// core/settings-home.js
// The settings home (since v2): four tabs in a notch, on one page.
//
//   General      Location Service, Place search, Saved keys, a box to try
//                a search
//   Appearance   Frosted glass, Background (with the Back button's
//                corner), Appearance Mode, Typography
//   Resources    Network, Manage Faces, Installed Resources, the
//                Marketplace
//   About        OmniCore itself, and its updates
//
// THE NOTCH
//
// On a phone held upright (under 42em wide) the notch is a CAPSULE instead:
// a narrow pill of frosted glass floating at the bottom, above the home
// bar, where a thumb reaches it. Same four icons and the same glass on the
// picked tab. The capsule is as narrow as its icons. When the tab changes
// (a tap or a swipe) the glass slides to it and its name opens beside the
// icon in the same motion, the capsule widening to make room, and about a
// second later it closes again. A long press opens any tab's name for as
// long as the finger is down. The update dot is green and sends out radar
// rings. Everywhere else the notch is as follows.
//
// A black notch hangs from the top edge of the screen with an icon for
// each tab, shaped like a drop of water: its top corners curve outward
// into the edge, its bottom corners are round. No tab keeps its name
// showing. A name opens beside its icon, and the notch widens to make room
// for it, on hover, keyboard focus or a long press (a finger can't hover,
// so a tap never leaves a name stuck open). Every tab has its name for
// screen readers. The tab picked has a piece of clear glass on its icon,
// with no blur so the icon stays sharp, and the glass slides from tab to
// tab. A dot on About means an update is ready. The icons are drawn here,
// by hand, as SVG: no icon font, nothing from the internet.
//
// THE MOVEMENT (sideways since the v2 test run)
//
// The four tabs lie side by side on one strip that scrolls sideways, never
// up and down. Each tab is at least a screen wide, and its boxes sit on a
// grid whose two rows fit the screen's height and whose columns go on to
// the right: a tab with more boxes than fit is wider, not taller. Only
// sideways movement moves the strip: a trackpad's sideways swipe, a tilt
// wheel, Shift and the wheel, a finger, and the Left and Right keys. The
// ordinary up and down wheel never changes tab: it scrolls whatever is
// under it (the release notes, a box with more in it than fits, a list)
// and stops there. (Until the v2 test run it turned sideways once that
// thing reached its end, and a box that ran out mid-scroll threw you into
// the next tab.) Scrolling on past a tab's end goes into the next one;
// the notch marks whichever
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
	network:
		'<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path d="M8.7 15.4a5 5 0 0 1 6.6 0"/>' +
		'<circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
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
		<span class="nb-pill" aria-hidden="true"></span>
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
// its name and a line under it at the foot. `attrs` is anything else the
// box needs (the Marketplace's has data-market-slides).
function tileHtml(href, icon, name, line, size, attrs) {
	return `
	<a class="segment clickable home-tile ${size}" href="${href}"${attrs ? " " + attrs : ""}>
		${svg(TILE_ICONS[icon], 30)}
		<span class="tile-text"><strong>${name}</strong><span>${line}</span></span>
	</a>`;
}

// The same box when it leads nowhere: a plain box, not a button, its line
// saying why (the Network box, when OmniCore can't change the Wi-Fi). The
// line is passed as plain text and escaped here.
function staticTileHtml(icon, name, line, size, attrs) {
	// "Wi-Fi" never broken across two lines
	const safe = String(line)
		.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
		.replace(/Wi-Fi/g, "Wi&#8209;Fi");
	return `
	<div class="segment home-tile home-tile-off ${size}"${attrs ? " " + attrs : ""}>
		${svg(TILE_ICONS[icon], 30)}
		<span class="tile-text"><strong>${name}</strong><span>${safe}</span></span>
	</div>`;
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

// The tabs at work: the strip scrolling sideways (snapping, the notch,
// the Left and Right keys, the tab in view), the address, the remembered tab, the picture panning,
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
	var pill = document.querySelector(".notch .nb-pill");
	var wide = window.matchMedia("(min-width: 42.01em)");
	var still = window.matchMedia("(prefers-reduced-motion: reduce)");
	var current = null;
	var closeTimer = null;
	var settling = null;
	var animating = false;   // a name is opening: the glass is on its way there
	var glideUntil = 0;      // a tap's own glide: its scrolling isn't a swipe

	function paneOf(id) {
		return document.querySelector('[data-pane="' + id + '"]');
	}

	// The piece of clear glass sits on the picked tab. It moves with a
	// slide when the tab changes, and it's as wide as the tab, name and all:
	// when the name opens (hover, focus, a long press, the capsule's own
	// opening) the glass holds it, never a second shape beside it.
	function place() {
		var picked = document.querySelector(".notch [aria-current]");
		if (!picked || !pill) return;
		pill.style.setProperty("--pill-x", picked.offsetLeft + "px");
		pill.style.setProperty("--pill-w", picked.offsetWidth + "px");
	}

	function closeNames() {
		buttons.forEach(function (button) { button.classList.remove("show"); });
	}

	// How wide a tab's name is, padding included, so the name and the glass
	// reach their final size at the same moment
	function nameWidth(button) {
		var label = button.querySelector(".nl");
		var size = parseFloat(getComputedStyle(label).fontSize) || 14;
		button.style.setProperty("--nl", Math.ceil(label.scrollWidth + size * 0.65) + "px");
	}

	// The capsule's final shape, measured with the name open and the other
	// names shut, without anything moving: where the tab ends up and how wide
	function measure(button) {
		var others = Array.prototype.filter.call(buttons, function (other) {
			return other !== button && other.classList.contains("show");
		});
		var was = button.classList.contains("show");
		notch.classList.add("measuring");
		others.forEach(function (other) { other.classList.remove("show"); });
		nameWidth(button);
		button.classList.add("show");
		var end = { left: button.offsetLeft, width: button.offsetWidth };
		if (!was) button.classList.remove("show");
		others.forEach(function (other) { other.classList.add("show"); });
		void notch.offsetWidth;
		notch.classList.remove("measuring");
		void notch.offsetWidth;
		return end;
	}

	// The tab's name opens and the glass moves to it, in one motion: the name,
	// the capsule and the glass all go to the measured end together, with the
	// same timing. About a second later the name closes again.
	function openName(button) {
		clearTimeout(closeTimer);
		var end = measure(button);
		animating = true;
		clearTimeout(settling);
		Array.prototype.forEach.call(buttons, function (other) {
			if (other !== button) other.classList.remove("show");
		});
		button.classList.add("show");
		if (button.getAttribute("aria-current") === "page") {
			pill.style.setProperty("--pill-x", end.left + "px");
			pill.style.setProperty("--pill-w", end.width + "px");
		}
		settling = setTimeout(function () { animating = false; place(); }, 560);
		closeTimer = setTimeout(closeNames, 1600);
	}

	// The notch, the address and the remembered tab follow the tab in view
	function mark(id) {
		if (id === current || ids.indexOf(id) === -1) return;
		var first = current === null;
		current = id;
		root.setAttribute("data-tab", id);
		root.style.setProperty("--tab", ids.indexOf(id));

		buttons.forEach(function (button) {
			if (button.getAttribute("data-tab") === id) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});

		// A phone's capsule opens the new tab's name; opening the page doesn't
		var picked = document.querySelector('.notch [data-tab="' + id + '"]');
		if (!first && !wide.matches && picked) openName(picked);
		else place();

		try { localStorage.setItem("omnicore-settings-tab", id); } catch (error) {}
		if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
	}

	// Go to a tab: glide there, or jump (opening the page, reduced motion)
	function show(id, moving) {
		var pane = paneOf(id);
		if (!pane) return;
		gliding = moving && !still.matches;
		if (moving) glideUntil = Date.now() + 800;
		started = null;
		strip.scrollTo({ left: pane.offsetLeft, behavior: gliding ? "smooth" : "auto" });
		mark(id);
	}

	// SNAPPING (wide screens; a phone's own scroll snapping does it there).
	// The strip moves freely while a finger, a trackpad or a tilt wheel
	// pushes it sideways. Once it stops between two tabs, it glides on to the next
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
			if (bento.style.getPropertyValue("--rows")) bento.style.removeProperty("--rows");
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
		if (bento.style.getPropertyValue("--rows") !== value) bento.style.setProperty("--rows", value);
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
			// The glide of a tap on the capsule passes the tabs in between:
			// they aren't opened
			if (wide.matches || Date.now() > glideUntil) mark(inView());
		});
	}, { passive: true });

	// The up and down wheel never changes tab: it scrolls whatever is under
	// it (the release notes, a box with more in it than fits) and stops
	// there. Only sideways movement moves the strip: a trackpad's sideways
	// swipe, a tilt wheel, Shift and the wheel (the browser turns that
	// sideways by itself), a finger. The scroll listener above sees it and
	// snapping finishes the move.

	// A sideways push in the middle of one of our glides takes over from it
	strip.addEventListener("wheel", function (event) {
		if (!gliding) return;
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
			gliding = false;
			started = null;
			strip.scrollTo({ left: strip.scrollLeft, behavior: "instant" });
		}
	}, { passive: true });

	// Left and Right change tab, unless they're busy doing something else:
	// typing, a slider, a list, a pop-up, or with a modifier key held
	function busy(event) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
		var target = event.target;
		if (target && target.closest) {
			if (target.closest("input, textarea, select, [contenteditable], [role=slider], [role=listbox], [role=tablist], .notch")) return true;
		}
		return !!document.querySelector(".modal-backdrop:not([hidden])");
	}

	document.addEventListener("keydown", function (event) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		if (event.defaultPrevented || busy(event)) return;
		var next = ids.indexOf(current) + (event.key === "ArrowRight" ? 1 : -1);
		if (next < 0 || next >= ids.length) return;
		event.preventDefault();
		show(ids[next], true);
	});

	buttons.forEach(function (button) {
		button.addEventListener("click", function (event) {
			event.preventDefault();
			// The click that ends a long press only showed the name
			if (button.classList.contains("peek")) return;
			// Tapping the tab you're on opens its name again
			if (!wide.matches && button.getAttribute("aria-current") === "page") {
				openName(button);
				return;
			}
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
			held = setTimeout(function () {
				nameWidth(button);
				button.classList.add("peek");
			}, 450);
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

	// A name opening or closing moves the tabs along the notch. The glass
	// keeps up with its tab frame by frame, instead of sliding after it.
	var catching = null;
	if (window.ResizeObserver && pill) {
		new ResizeObserver(function () {
			if (animating) return;
			pill.classList.add("keeping-up");
			place();
			clearTimeout(catching);
			catching = setTimeout(function () { pill.classList.remove("keeping-up"); }, 120);
		}).observe(notch);
	}

	// Leaving: the notch goes up, then the page fades
	window.addEventListener("omnicore:leaving", function () { notch.classList.add("notch-up"); });
	window.addEventListener("omnicore:stayed", function () { notch.classList.remove("notch-up"); });

	show(root.getAttribute("data-tab") || ids[0], false);
	fit();
	pan();
	requestAnimationFrame(function () {
		requestAnimationFrame(function () {
			root.classList.remove("home-still");
			// The glass only starts sliding once it has been put in place
			if (pill) pill.classList.add("ready");
		});
	});
})();
`;

// The Marketplace tile's pictures: the banner of each registry OmniCore
// reads (the built-in one, then any added under Sources), one after the
// other, crossfading every six seconds behind the tile's name. One banner
// stays still; none, or none that load, and the tile is as it always was.
// Asked for once the page is open, so a slow registry never holds Settings
// up. With reduced motion only the first one shows, and nothing changes
// while the page isn't being looked at.
const MARKET_TILE_SCRIPT = `
(function () {
	var tile = document.querySelector("[data-market-slides]");
	if (!tile || !window.fetch) return;
	var still = window.matchMedia("(prefers-reduced-motion: reduce)");

	fetch("/marketplace/banners", { credentials: "same-origin" })
		.then(function (response) { return response.ok ? response.json() : []; })
		.then(function (banners) {
			if (!Array.isArray(banners) || !banners.length) return;

			var holder = document.createElement("span");
			holder.className = "tile-slides";
			holder.setAttribute("aria-hidden", "true");
			var pictures = [];

			banners.forEach(function (banner) {
				if (!banner || typeof banner.src !== "string" || banner.src.indexOf("/marketplace/") !== 0) return;
				var picture = new Image();
				picture.alt = "";
				picture.decoding = "async";
				picture.addEventListener("load", function () {
					// The first picture to arrive shows; the tile goes dark
					// behind its text only once there's a picture to see
					if (!holder.querySelector(".on")) picture.classList.add("on");
					tile.classList.add("has-slides");
				});
				picture.addEventListener("error", function () {
					var at = pictures.indexOf(picture);
					if (at !== -1) pictures.splice(at, 1);
					picture.remove();
					if (!pictures.length) tile.classList.remove("has-slides");
				});
				picture.src = banner.src;
				holder.appendChild(picture);
				pictures.push(picture);
			});

			tile.insertBefore(holder, tile.firstChild);

			setInterval(function () {
				if (still.matches || document.hidden) return;
				var ready = pictures.filter(function (picture) { return picture.complete && picture.naturalWidth; });
				if (ready.length < 2) return;
				var showing = holder.querySelector(".on");
				var next = ready[(ready.indexOf(showing) + 1) % ready.length];
				if (showing) showing.classList.remove("on");
				next.classList.add("on");
			}, 6000);
		})
		.catch(function () {});
})();
`;

// The look. Added to the admin face's own styles.

module.exports = {
	TABS,
	HOME_SCRIPT,
	STARTING_TAB_SCRIPT,
	notchHtml,
	tileHtml,
	staticTileHtml,
	MARKET_TILE_SCRIPT,
	homeHtml
};
