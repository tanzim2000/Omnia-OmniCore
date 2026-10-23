// test/settings-home.test.js
// The settings home with its notch and four tabs, and the page fades
// (v2).
//
//   - Which clicks fade the page out, and which arrivals fade it in.
//   - Every page OmniCore draws starts with the curtain; a face too, right
//     after <body>, unless its theme says "coreFade": false, when only the
//     signal is sent.
//   - Page changes from a script go through omniGo, so they fade too.
//   - The settings home: four tabs on one page, the notch, the address
//     pointing at a tab's heading, the remembered tab, no version pill,
//     every box on its tab, the location set right in its box.
//
// What a browser does with all of it (the movement, the curtain's timing,
// the back button) was checked in a real browser while it was built; here
// is what can be checked without one.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { resetState, waitForPort, signIn, themesDir } = helpers;
const pageMotion = require("../core/page-motion");
const settingsHome = require("../core/settings-home");
const faceStore = require("../core/face-store");

const HERE = { href: "http://box:3000/faces", origin: "http://box:3000", pathname: "/faces", search: "" };

// A link as the browser gives it to the click handler
function link(href, attributes) {
	const all = { href, ...(attributes || {}) };
	return {
		getAttribute: (name) => (name in all ? all[name] : null),
		hasAttribute: (name) => name in all
	};
}

const click = (extra) => ({ button: 0, defaultPrevented: false, ...(extra || {}) });

// --- Which clicks fade -----------------------------------------------------------

test("fades out: an ordinary link to another page, here or on another port", () => {
	assert.equal(pageMotion.leavingTarget(link("/marketplace"), click(), HERE), "http://box:3000/marketplace");
	assert.equal(pageMotion.leavingTarget(link("http://box:4001/"), click(), HERE), "http://box:4001/");
	assert.equal(pageMotion.leavingTarget(link("/#appearance"), click(), HERE), "http://box:3000/#appearance", "another page's tab");
	assert.equal(pageMotion.leavingTarget(link("?from=about"), click(), HERE), "http://box:3000/faces?from=about");
});

test("doesn't fade: a new tab, a download, the same page, a page that handled it, not a page at all", () => {
	const none = [
		[link("/marketplace"), click({ ctrlKey: true })],
		[link("/marketplace"), click({ metaKey: true })],
		[link("/marketplace"), click({ shiftKey: true })],
		[link("/marketplace"), click({ altKey: true })],
		[link("/marketplace"), click({ button: 1 })],
		[link("/marketplace"), click({ defaultPrevented: true })],
		[link("/marketplace", { target: "_blank" }), click()],
		[link("/marketplace", { download: "" }), click()],
		[link("/marketplace", { "data-no-fade": "" }), click()],
		[link("#general"), click()],
		[link("/faces#top"), click()],
		[link("mailto:someone@example.com"), click()],
		[link("javascript:void(0)"), click()],
		[link(""), click()],
		[null, click()]
	];
	for (const [target, event] of none) {
		assert.equal(pageMotion.leavingTarget(target, event, HERE), null, JSON.stringify(event) + " " + (target && target.getAttribute("href")));
	}
	assert.equal(pageMotion.leavingTarget(link("/x", { target: "_self" }), click(), HERE), "http://box:3000/x", "_self is this tab");
});

test("fades in: arriving by a link, an address or first opening; never a reload or back", () => {
	assert.equal(pageMotion.fadesIn("navigate"), true);
	assert.equal(pageMotion.fadesIn(undefined), true, "a browser that doesn't say");
	assert.equal(pageMotion.fadesIn("reload"), false, "a reload, which is how a face refreshes");
	assert.equal(pageMotion.fadesIn("back_forward"), false);
	assert.equal(pageMotion.fadesIn("prerender"), false);
});

test("the curtain's script parses, with and without the fade in", () => {
	for (const fadeIn of [true, false]) {
		const html = pageMotion.curtainHtml({ fadeIn, styles: true, light: null });
		const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
		assert.doesNotThrow(() => new vm.Script(script));
		assert.ok(script.includes(`if (${fadeIn} && !still && fadesIn(arrival))`));
		assert.ok(html.includes("prefers-color-scheme: light"), "follows the device when no mode is picked");
	}
	assert.match(pageMotion.curtainHtml({ styles: true, light: true }), /--curtain: #eedec5;/);
	assert.match(pageMotion.curtainHtml({ styles: true, light: false }), /--curtain: #000000;/);
	assert.ok(!pageMotion.curtainHtml().includes("<style>"), "OmniCore's own pages have it in uiStyles");
	assert.equal(pageMotion.goScript("'/x'"), "(window.omniGo || function (a) { location.href = a; })('/x')");
});

test("the stylesheet has the curtain, in the page's base colour", () => {
	const { uiStyles } = require("../core/ui-theme");
	assert.ok(uiStyles({ forceMode: "dark" }).includes("--curtain: #000000;"));
	assert.ok(uiStyles({ forceMode: "light" }).includes("--curtain: #eedec5;"));
	assert.ok(uiStyles().includes(".omni-curtain {"));
	assert.ok(uiStyles().includes("html.omni-leaving .omni-curtain"));
});

test("no page changes by setting location.href any more, only through omniGo", () => {
	const core = path.join(__dirname, "..", "core");
	for (const file of fs.readdirSync(core).filter((name) => name.endsWith(".js"))) {
		if (file === "page-motion.js") continue;
		const text = fs.readFileSync(path.join(core, file), "utf8");
		const plain = text.match(/(^|[^a])location\.href\s*=\s*[^=]/gm) || [];
		// face-events.js may be on a theme's page before page-motion's
		// script, so it brings its own fallback, like goScript
		const allowed = (text.match(/function \(a\) \{ location\.href = a; \}/g) || []).length;
		assert.equal(plain.length, allowed, `${file} changes page without the fade`);
	}
});

// --- The settings home, without a server ----------------------------------------

test("the notch: four tabs, each a link, with a name for screen readers", () => {
	const notch = settingsHome.notchHtml(false);
	assert.ok(notch.includes("data-omni-notch"), "page-motion slides it up when leaving");
	for (const [id, label] of [["general", "General"], ["appearance", "Appearance"], ["resources", "Resources"], ["about", "About"]]) {
		assert.ok(notch.includes(`<a class="nb" href="#${id}" data-tab="${id}" aria-label="${label}">`), id);
	}
	assert.equal((notch.match(/<svg /g) || []).length, 4, "four icons, drawn here");
	assert.ok(!notch.includes("http"), "nothing from the internet");
	assert.ok(!notch.includes("nb-dot"));

	const ready = settingsHome.notchHtml(true);
	assert.ok(ready.includes('aria-label="About, an update is ready"'));
	assert.ok(ready.includes('<span class="nb-dot" aria-hidden="true"></span>'));
});

test("the tabs: one page, the address points at each tab's heading, the scripts parse", () => {
	const html = settingsHome.homeHtml({ general: "G", appearance: "A", resources: "R", about: "B" }, false);
	for (const id of ["general", "appearance", "resources", "about"]) {
		assert.match(html, new RegExp(`<section class="home-pane" data-pane="${id}"[^>]*>\\s*<h2 class="pane-title" id="${id}">`));
	}
	assert.ok(!/<section[^>]* id="/.test(html), "not the tab itself: the browser would focus it and scroll the strip");
	assert.ok(html.indexOf("home-still") < html.indexOf("home-track"), "the starting tab is picked before the tabs are drawn");
	assert.doesNotThrow(() => new vm.Script(settingsHome.STARTING_TAB_SCRIPT));
	assert.doesNotThrow(() => new vm.Script(settingsHome.HOME_SCRIPT));
	assert.ok(settingsHome.HOME_SCRIPT.includes('localStorage.setItem("omnicore-settings-tab"'), "remembered");
	assert.ok(settingsHome.HOME_SCRIPT.includes("strip.scrollTo({ left: pane.offsetLeft"), "picking a tab glides the strip there");
	assert.ok(!settingsHome.HOME_SCRIPT.includes("{ passive: false }"), "the up and down wheel is never taken over: it never changes tab");
	assert.ok(!settingsHome.HOME_SCRIPT.includes("scrollsItself"), "not even once what's under it reaches its end");
	assert.ok(settingsHome.HOME_SCRIPT.includes('if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;\n\t\tif (event.defaultPrevented || busy(event)) return;'), "Left and Right change tab");
	assert.ok(settingsHome.HOME_SCRIPT.includes('target.closest("input, textarea, select, [contenteditable], [role=slider], [role=listbox], [role=tablist], .notch")'), "but not while typing, on a slider or a list, or in the notch");
	assert.ok(settingsHome.HOME_SCRIPT.includes('document.querySelector(".modal-backdrop:not([hidden])")'), "or with a pop-up open");
	assert.ok(settingsHome.HOME_SCRIPT.includes("if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;"), "or with a modifier key");
	assert.ok(settingsHome.HOME_SCRIPT.includes("mark(inView())"), "the notch follows the tab in view");
	assert.ok(settingsHome.HOME_SCRIPT.includes("history.replaceState"), "the address follows the tab");
});

test("the movement: one strip scrolling sideways, a grid that grows to the right, the picture panning along", () => {
	const css = settingsHome.SETTINGS_HOME_CSS;
	assert.match(css, /html\.home-tabs \.home-panes \{[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/, "sideways, never up and down");
	assert.match(css, /grid-auto-flow: column dense;/, "more boxes make a tab wider, not taller");
	assert.match(css, /grid-template-rows: minmax\(0, auto\) minmax\(min\(10em, 45%\), 1fr\);/, "two rows that fit the screen");
	assert.match(css, /\.home-bento > \.segment\.box-scroll \{[^}]*overflow-y: auto;/, "a box with more in it scrolls inside itself");
	assert.ok(css.includes("width: 175vw;") && css.includes("transform: translateX(calc(var(--pan, 0) * -75vw));"), "the picture pans along");
	assert.match(css, /@media \(max-width: 42em\) \{[\s\S]*?scroll-snap-type: x mandatory;/, "a phone: a swipe moves a whole tab");
	assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition: none;/);
	assert.match(css, /html:not\(\.home-tabs\) body\.settings-home \{ height: auto; overflow: visible; \}/, "one long page without the script");
	assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/, "six columns");
	assert.match(css, /@media \(max-width: 42em\) \{[\s\S]*?\.home-panes \{[^}]*margin-top: 0;/, "a phone: the tabs start under the heading, so boxes never slide over it");
});

test("the rows share the height fairly, and a box never cuts off its search list", () => {
	const css = settingsHome.SETTINGS_HOME_CSS;
	const script = settingsHome.HOME_SCRIPT;
	assert.ok(script.includes('bento.classList.add("measuring")'), "each row is measured at the height its boxes want");
	assert.match(css, /\.home-bento\.measuring > \.segment \{[^}]*max-height: none;/, "measured at full height");
	assert.ok(script.includes("if (want1 + want2 <= room || want1 <= half) top = want1;"), "a row that needs less than half gets all it needs");
	assert.ok(script.includes("else if (want2 <= half) top = room - want2;"), "so the other row can't take it");
	assert.ok(script.includes("else top = half;"), "both too big: half each");
	assert.ok(script.includes("bento.style.gridTemplateRows !== value"), "set only when it changes, or it would measure itself forever");
	assert.ok(script.includes('if (box.classList.contains("float-open")) return;'), "an open list doesn't make its box scroll");
	assert.match(css, /\.home-bento > \.segment\.float-open \{ overflow: visible; \}/, "and the box never cuts it off");
	assert.ok(script.includes("new ResizeObserver"), "measured again when something in a box changes size");
});

test("snapping: let go between two tabs and it goes on to the next, or back after a nudge", () => {
	const script = settingsHome.HOME_SCRIPT;
	assert.ok(script.includes("resting = setTimeout(settle, 140);"), "once the strip has been still a moment");
	assert.ok(script.includes("if (!wide.matches || holding) return;"), "not on a phone (its own snapping does it), not with a finger still down");
	assert.ok(script.includes("Math.abs(left - from) < NUDGE"), "a nudge goes back");
	assert.ok(script.includes("} else if (heading > 0) {"), "otherwise on the way it was going");
	assert.ok(script.includes('if (gliding) strip.scrollTo({ left: from, behavior: "instant" });'), "pushing it mid-glide takes over");
	assert.ok(script.includes("if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {"), "a sideways swipe or Shift and the wheel, too");
	assert.ok(script.includes("var end = Math.max(start, start + pane.offsetWidth - strip.clientWidth);"), "a tab wider than the screen can rest anywhere inside it");
});

// --- With a server --------------------------------------------------------------

let cookie;
let face;
let plainFace;

async function get(port, address) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, { headers: { cookie } });
	return { status: response.status, text: await response.text() };
}

test("pages: boots signed in, with a face whose theme does its own entrance", async () => {
	resetState();

	// Two themes: one says nothing, one does its own entrance
	for (const [id, manifest] of [["sh-quiet", { name: "Quiet" }], ["sh-own", { name: "Own entrance", coreFade: false }]]) {
		const dir = path.join(themesDir, id);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "theme.json"), JSON.stringify(manifest));
		fs.writeFileSync(path.join(dir, "index.html"), '<!DOCTYPE html><html><head><title>t</title></head><body class="theme"><main>tiles</main></body></html>');
	}

	face = faceStore.createFace("", "", "sh-own", []);
	plainFace = faceStore.createFace("", "", "sh-quiet", []);

	require("../core/admin-face")();
	require("../core/wizard-face")();
	require("../core/about-face")();
	require("../core/control-face")();
	const { startFace } = require("../core/face-loader");
	await startFace(face);
	await startFace(plainFace);
	for (const port of [3000, 3999, 1303, 4000, face.id, plainFace.id]) await waitForPort(port);
	cookie = await signIn(3000);
});

test.after(() => {
	for (const id of ["sh-quiet", "sh-own"]) fs.rmSync(path.join(themesDir, id), { recursive: true, force: true });
});

test("pages: every page OmniCore draws starts with the curtain", async () => {
	for (const [port, address] of [[3000, "/"], [3000, "/faces"], [3999, "/faces/new"], [1303, "/"], [4000, "/"]]) {
		const { text } = await get(port, address);
		const body = text.slice(text.indexOf("<body", text.indexOf("</head>")));
		const first = body.slice(body.indexOf(">") + 1).trim();
		assert.ok(first.startsWith('<div class="omni-curtain" aria-hidden="true"></div><script>'), `${port}${address}`);
		assert.ok(text.includes("window.omniGo = go;"));
	}
});

test("pages: a face fades in right after <body>, unless its theme does its own entrance", async () => {
	const quiet = (await get(plainFace.id, "/")).text;
	assert.match(quiet, /<body class="theme"><style>[\s\S]*?\.omni-curtain[\s\S]*?<\/style><div class="omni-curtain" aria-hidden="true"><\/div><script>/);
	assert.ok(quiet.includes("if (true && !still && fadesIn(arrival))"));
	assert.ok(quiet.indexOf("omni-curtain") < quiet.indexOf("<main>tiles</main>"), "before the theme");

	const own = (await get(face.id, "/")).text;
	assert.ok(own.includes("if (false && !still && fadesIn(arrival))"), "no fade in: only the signal");
	assert.ok(own.includes('window.dispatchEvent(new Event("omnicore:revealed"))'));

	// The curtain's colour follows this browser's Appearance Mode
	const lightPage = await (await fetch(`http://127.0.0.1:${plainFace.id}/`, { headers: { cookie: "omnicore_ui_mode=light" } })).text();
	assert.ok(lightPage.includes(":root { --curtain: #eedec5; }"));
});

test("pages: the settings home has four tabs, and no version pill", async () => {
	const { status, text } = await get(3000, "/");
	assert.equal(status, 200);
	assert.ok(text.includes('<body class="settings-home">'));
	assert.ok(text.includes("data-omni-notch"));
	assert.ok(!text.includes("version-pill"), "the About tab has the version");

	// Each box on its own tab
	const pane = (id) => {
		const start = text.indexOf(`data-pane="${id}"`);
		const next = text.indexOf('data-pane="', start + 10);
		return text.slice(start, next === -1 ? text.indexOf('id="font-modal"') : next);
	};
	for (const [id, boxes] of [
		["general", ["Location Service", "Place search", "Saved keys", "Try a city search"]],
		["appearance", ["Frosted glass", "Background", "Appearance Mode", "Text Size"]],
		["resources", ["Manage Faces", "Marketplace", "Installed Resources"]],
		["about", ["OmniCore 1.19.", "Address", "Updates", "Release notes"]]
	]) {
		for (const box of boxes) assert.ok(pane(id).includes(box), `${box} on ${id}`);
	}

	// Gone since the test run of v2: boxes that were too much for what
	// they held
	assert.ok(!pane("general").includes("Place search keys"), "keys are asked for when a service is picked");
	assert.ok(!pane("general").includes("The services"), "each service is described in its key question");
	assert.ok(!pane("appearance").includes("Back Button Position"), "the corner is picked in Background");

	// Different widths and heights, each box on its row of the sideways
	// grid: Frosted glass and a narrower Background on the first row,
	// Place search two rows tall beside Location Service, Saved keys and
	// the search box, the Marketplace beside the other two
	assert.match(pane("appearance"), /class="segment c4 row1" id="glass"/);
	assert.match(pane("appearance"), /class="segment c2 row1" id="background"/);
	assert.match(pane("general"), /class="segment c2 r2" id="place-search"/);
	assert.match(pane("general"), /class="segment c2 row2" id="saved-keys"/);
	assert.match(pane("general"), /class="segment c2 row2" id="place-try"/);
	assert.match(pane("resources"), /class="segment clickable home-tile c2 r2" href="\/marketplace"/);

	// The location is set right in its box
	assert.ok(pane("general").includes('id="location-manual"'));
	assert.ok(!text.includes('id="location-modal"'));

	for (const source of [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
		assert.doesNotThrow(() => new vm.Script(source));
	}
});

test("pages: a development build's Updates box says it doesn't check", async () => {
	const { text } = await get(3000, "/");
	assert.ok(text.includes("A development build doesn't check for updates."));
	assert.ok(!text.includes('id="check"'), "nothing to check");
	assert.ok(!text.includes('id="apply"'), "nothing to install");
	assert.ok(text.includes('<div class="segment c6 row2" id="release-notes">'), "its notes instead");
});
