// core/page-motion.js
// Going from one page to another (since v2): the page fades out to its
// base colour, the next one fades in from it: the Default background,
// black in dark mode and Beige Cream in light (black and white before the
// v2 test run), following Appearance Mode, and the device's own
// setting when that's left on Device.
//
// On every page OmniCore draws (Settings, the setup wizard, the welcome
// face, About, an Inport's page) and on every face, faces with a theme
// included: Core draws the curtain, and the theme runs its own entrance
// once the curtain has lifted (see THE SIGNAL below).
//
// WHEN IT FADES IN
//
// Only on arriving: by a link, by typing the address, or opening it for
// the first time. Never on a reload, which is also how faces refresh
// themselves, so a wall display doesn't flash; and never when going back
// or forward, which can bring a page back from the browser's memory as it
// was.
//
// WHEN IT FADES OUT
//
// On a click on an ordinary link to another page, or when a page's own
// script moves on with omniGo(address) instead of setting location.href.
// Not for a link opened in a new tab or window (Ctrl, Cmd, Shift or the
// middle button, or target="_blank"), a download, or a link to somewhere
// else on the same page (#...). If the next page doesn't come within a few
// seconds (a slow or failed load, or a link that turned out to be a
// download), the old page comes back.
//
// With reduced motion turned on in the device's settings, none of this
// happens: pages simply change.
//
// THE SIGNAL
//
// When the curtain has lifted (or straight away, when there is none),
// Core sets data-omnicore-revealed on <html> and fires "omnicore:revealed"
// on window. A theme starts its entrance then rather than on load, so it
// doesn't play behind the curtain:
//
//     function intro() { ... }
//     if (document.documentElement.hasAttribute("data-omnicore-revealed")) intro();
//     else window.addEventListener("omnicore:revealed", intro, { once: true });
//
// A theme that would rather do the whole entrance itself says
// "coreFade": false in its theme.json: Core then doesn't fade it in, and
// the signal comes straight away. It still fades out when leaving.
//
// The settings home also listens for "omnicore:leaving", to slide its
// notch up before the fade.

// How long each part takes, in milliseconds. In a little slower than out:
// the new page is what's worth looking at. (The curtain's colours and look
// are the central theme's: ui-theme.js, CURTAIN_CSS.)
const IN_MS = 420;
const OUT_MS = 250;
const GIVE_UP_MS = 5000;

// Where a click on this link should go with a fade, or null when it's
// none of the fade's business. A plain function, so it can be tested
// without a browser (test/page-motion.test.js) and sent to the page as
// source.
//
//   link    the <a> clicked, or null
//   event   the click: button, defaultPrevented and the modifier keys
//   here    where the page is: an object with href, origin, pathname, search
function leavingTarget(link, event, here) {
	if (!link || !event) return null;
	if (event.defaultPrevented || event.button !== 0) return null;
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

	var href = link.getAttribute ? link.getAttribute("href") : link.href;
	if (!href) return null;

	var target = link.getAttribute ? link.getAttribute("target") : link.target;
	if (target && target !== "_self") return null;

	if (link.hasAttribute && (link.hasAttribute("download") || link.hasAttribute("data-no-fade"))) return null;

	var url;
	try {
		url = new URL(href, here.href);
	} catch (error) {
		return null;
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") return null;

	// Only the part after # is different: the same page, somewhere else
	// on it
	if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search && url.hash) {
		return null;
	}

	return url.href;
}

// Whether arriving this way should fade in. `type` is how the page was
// reached, from the browser (performance navigation entry): "navigate",
// "reload", "back_forward" or "prerender".
function fadesIn(type) {
	return type === "navigate" || type === undefined || type === null;
}


// The browser half. Runs at the very start of <body>, before anything is
// drawn, so a page that fades in is never seen before its curtain.
function curtainScript(fadeIn) {
	return `
(function () {
	var IN_MS = ${IN_MS}, OUT_MS = ${OUT_MS}, GIVE_UP_MS = ${GIVE_UP_MS};
	var root = document.documentElement;
	var still = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	${leavingTarget.toString()}
	${fadesIn.toString()}

	var arrival;
	try {
		var entry = performance.getEntriesByType("navigation")[0];
		arrival = entry && entry.type;
	} catch (error) {}

	var revealed = false;
	function reveal() {
		if (revealed) return;
		revealed = true;
		root.classList.remove("omni-arriving");
		root.setAttribute("data-omnicore-revealed", "");
		window.dispatchEvent(new Event("omnicore:revealed"));
	}

	if (${fadeIn ? "true" : "false"} && !still && fadesIn(arrival)) {
		root.classList.add("omni-arriving");
		setTimeout(reveal, IN_MS);
	} else if (document.readyState === "loading") {
		// No curtain: the signal once the page's own scripts are in, so a
		// theme listening for it hears it
		document.addEventListener("DOMContentLoaded", function () { setTimeout(reveal, 0); });
	} else {
		setTimeout(reveal, 0);
	}

	var giveUp = null;
	function go(address) {
		if (still) {
			location.href = address;
			return;
		}
		window.dispatchEvent(new Event("omnicore:leaving"));
		// The settings home's notch slides up first
		var notch = document.querySelector("[data-omni-notch]") ? 180 : 0;
		setTimeout(function () {
			root.classList.remove("omni-arriving");
			root.classList.add("omni-leaving");
			setTimeout(function () { location.href = address; }, OUT_MS);
			clearTimeout(giveUp);
			giveUp = setTimeout(function () {
				root.classList.remove("omni-leaving");
				window.dispatchEvent(new Event("omnicore:stayed"));
			}, OUT_MS + GIVE_UP_MS);
		}, notch);
	}
	window.omniGo = go;

	document.addEventListener("click", function (event) {
		var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
		var address = leavingTarget(link, event, location);
		if (!address) return;
		event.preventDefault();
		go(address);
	});

	// Back or forward to a page the browser kept as it was: it was kept
	// mid-fade, so take the curtain away
	window.addEventListener("pageshow", function (event) {
		if (!event.persisted) return;
		clearTimeout(giveUp);
		root.classList.remove("omni-leaving");
		root.classList.remove("omni-arriving");
		window.dispatchEvent(new Event("omnicore:stayed"));
	});
})();
`;
}

// The curtain itself: the first thing inside <body> on every page.
//
//   options.fadeIn   false for a theme that does its own entrance
//   options.styles   true to bring its own CSS, for a face with a theme
//                    (which doesn't have uiStyles); `light` then picks
//                    the colour: true, false, or null to follow the device
function curtainHtml(options) {
	const settings = options || {};
	const fadeIn = settings.fadeIn !== false;

	// The curtain's look, from the central theme's overlay bundle
	// (ui-theme.js), with the colour for this page
	const theme = require("./ui-theme");
	const styles = settings.styles ? theme.styleTag(theme.curtainStyles(settings.light)) : "";

	return `${styles}<div class="omni-curtain" aria-hidden="true"></div><script>${curtainScript(fadeIn)}</script>`;
}

// What every page OmniCore draws starts its <body> with: the curtain, the
// picture behind the page (backdrop.js), and the status drawer and the
// takeover (network-status.js)
// options.plain: no picture or colour behind the page, whatever the
// appearance profile says (Getting Started, and the screen before it,
// drawn with uiStyles({ device: true }))
function pageStart(options) {
	const { backdropHtml } = require("./backdrop");
	const plain = Boolean(options && options.plain);
	return curtainHtml() + (plain ? "" : backdropHtml()) + require("./network-status").CLIENT_HTML;
}

// Moving on from a page's own script: with the fade where there is one.
// For an inline onclick, where the page's script may not be in yet.
function goScript(address) {
	return `(window.omniGo || function (a) { location.href = a; })(${address})`;
}

module.exports = {
	IN_MS,
	OUT_MS,
	GIVE_UP_MS,
	leavingTarget,
	fadesIn,
	curtainScript,
	curtainHtml,
	pageStart,
	goScript
};
