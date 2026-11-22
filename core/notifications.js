// core/notifications.js
// Notifications: a message that appears over whatever a display is
// showing, holds for a few seconds, and goes away again.
//
// WHY THIS IS CORE'S JOB AND NOT A THEME'S
//
// Everything else a display shows travels under the Content Contract,
// where a module says what it has and the theme decides how it looks.
// Notifications deliberately break that rule, for the same reason the
// reload-on-change script in face-events.js does: a theme that forgot to
// implement it, or implemented it badly, would be a theme that silently
// swallows the one message somebody actually needed to see. So the
// overlay is Core's, start to finish -- its shape, its timing, its
// animation -- and no theme has to know it exists.
//
// WHO ACTUALLY SEES ONE
//
// Every display showing the face: a browser tab, a kiosk browser, a
// laptop with the face open. Each one draws this overlay. Two tabs on
// the same face both show it.
//
// (Before 1.18.2 only an OmniView got them, so in practice nothing did:
// OmniView isn't built yet. When it is, it gets a kind of notification
// of its own, and this overlay will be switched off for it then.
// face-events.js still records which displays are an OmniView, ready for
// that.)
//
// WHO RAISES ONE
//
// A background module (see core/background.js), through `omni.notify`.
// Those keep running while nobody is watching -- that's what they're
// for -- so a notification can be raised with no display there to see
// it. What happens then is the install's own setting: dropped (the
// default), or held for the next display that connects. See notify()
// below.
//
// An ordinary tile module can't raise one at all. It only runs when a
// display asks for its tile, every few seconds, so anything it raised
// would be raised again on every poll.
//
// WHAT ONE CAN SAY
//
//   title        optional, plain text
//   description  optional, a small subset of Markdown -- bold, italic,
//                code, lists, a subtitle, tables. See core/markdown.js for
//                exactly which, and why links aren't one of them.
//                A notification needs a title, a description, or both.
//   source       optional, plain text: where the message came from, shown
//                in its own small box at the top. Leave it out and Core
//                fills in the module's name. A module only needs it to
//                say something more useful than its name -- ntfy says
//                which server, "ntfy.sh". It's never a place for a secret:
//                everyone in the room can read it.
//   priority     1 to 5; decides how long it stays up (see below)
//   link         optional { url, title }. Nothing on a display can be
//                clicked, so a link is shown as a QR code beside the
//                message, with the address printed under it, for a phone
//                to pick up. Only http and https; anything else -- or an
//                address with a username and password in it -- is left
//                off rather than shown.

const faceEvents = require("./face-events");
const markdown = require("./markdown");
const qr = require("./qr");
const { readSettings } = require("./settings-store");
const theme = require("./ui-theme");
const { TABLE_TEXT_SCALE, EMOJI_FONTS } = theme;

// Longest link title kept. The overlay doesn't show a link's title any
// more (v1.19.7: the QR box is the code and its address, nothing else),
// but it's still passed along for anything that might, like OmniView.
const LINK_TITLE_LONGEST = 80;

// Most links one notification can carry. Each gets a QR box of its own,
// stacked beside the message; more than two would crowd the message out.
const MOST_LINKS = 2;

// Longest source worth showing. It's a label -- "ntfy.sh", "Calendar" --
// not a sentence.
const SOURCE_LONGEST = 60;




// HOW LONG ONE STAYS UP
//
// Five priorities, five durations. A more urgent message is not louder
// or bigger, it simply stays long enough that somebody walking past has
// a chance to read it. Everything else about how it looks is identical,
// so priority never becomes a way to shout.
const PRIORITY_SECONDS = {
	1: 10,
	2: 15,
	3: 30,
	4: 45,
	5: 60
};

const DEFAULT_PRIORITY = 3;

// Clamp whatever arrived to a real priority. A bad value becomes the
// middle one rather than an error: a notification that failed to show
// because its priority was "high" instead of 4 would be a worse outcome
// than one that showed for thirty seconds.
function resolvePriority(value) {
	const priority = Math.round(Number(value));

	if (!PRIORITY_SECONDS[priority]) {
		return DEFAULT_PRIORITY;
	}

	return priority;
}

// A notification's `link`, made ready for the overlay -- or null when
// there's nothing that should be shown.
//
// The QR code is drawn here, by Core's own engine (core/qr.js), so the
// overlay only ever inserts an SVG built from numbers, never from text a
// module sent. The address and the title are handed over as plain text
// and set as text on the other side.
//
// Accepts { url, title } or just the address as a string.
function readLink(link) {
	if (!link) {
		return null;
	}

	const raw = typeof link === "string" ? link : link.url;
	let url;

	try {
		url = new URL(String(raw || "").trim());
	} catch (error) {
		return null;
	}

	// Something a phone's browser can open. A javascript: or data: link
	// has no business being handed to whoever scans a wall display.
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return null;
	}

	// A password in the address would be printed under the code, in big
	// enough letters to read from across the room
	if (url.username || url.password) {
		return null;
	}

	const svg = qr.toSvg(url.href);

	// Too long for any QR code to hold. The message still shows; the link
	// just isn't part of it.
	if (!svg) {
		return null;
	}

	const title =
		typeof link === "object" && link.title
			? String(link.title).trim().slice(0, LINK_TITLE_LONGEST)
			: "";

	return { url: url.href, title: title, svg: svg };
}

// Every link a notification asked for, made ready (see readLink), in
// order: `link` first, then each of `links`. One the overlay can't show
// is left out, the same address twice is shown once, and past MOST_LINKS
// the rest are dropped. Always an array, empty when there's nothing.
function readLinks(message) {
	if (!message) {
		return [];
	}

	const asked = [];

	if (message.link) {
		asked.push(message.link);
	}

	if (Array.isArray(message.links)) {
		asked.push(...message.links);
	}

	const ready = [];

	for (const candidate of asked) {
		const link = readLink(candidate);

		if (link && !ready.some((already) => already.url === link.url)) {
			ready.push(link);
		}

		if (ready.length === MOST_LINKS) {
			break;
		}
	}

	return ready;
}

// A source label, made safe to show: plain text on one line, not too
// long. Returns "" for nothing usable. It's set as text on the page, never
// as markup, so this is about tidiness, not safety.
function readSource(value) {
	if (typeof value !== "string") {
		return "";
	}

	const tidy = value
		// Line breaks, tabs and other control characters become plain
		// spaces -- a label is one line
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		// Invisible characters that change how text around them is shown
		// -- zero-width spaces, and the marks that flip text right to
		// left -- are taken out: a label should read as it looks
		.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// Cut by characters rather than by JavaScript's half-characters, so
	// an emoji at the cut is kept or dropped whole, never split in two
	return Array.from(tidy).slice(0, SOURCE_LONGEST).join("").trim();
}

// Notifications raised while nobody was watching, keyed by face id.
//
// Only used when the install has asked for it. In memory rather than on
// disk on purpose: something held here is worth showing to whoever walks
// up next, not worth surviving a restart of OmniCore itself.
const held = new Map();

// Send one notification to every display currently showing this face.
//
// `faceId` is the face's own id (its port). `message` is what the module
// passed to omni.notify. `origin` is the name of the module that raised
// it, filled in by Core (see background.js) -- the module doesn't get a
// say in it, and it's what the source box shows when the module didn't
// name a source of its own.
//
// A title or a description is required, either will do; a notification
// with nothing to say is not worth interrupting anyone for.
function notify(faceId, message, origin) {
	const settings = readSettings();

	if (!settings.notificationsEnabled) {
		return false;
	}

	// Invisible NUL characters taken out first: they're dropped when the
	// description is rendered anyway, and a description made of nothing
	// else must count as empty, not show up as a blank box
	const title = String((message && message.title) || "").replace(/\u0000/g, "").trim();
	const description = String((message && message.description) || "").replace(/\u0000/g, "").trim();

	if (!title && !description) {
		return false;
	}

	const priority = resolvePriority(message && message.priority);

	if (priority < Number(settings.notificationsMinimumPriority || 1)) {
		return false;
	}

	// Drawn only now, once it's certain to be shown or held
	const links = readLinks(message);

	const note = {
		// Where it came from: what the module said, or else its name
		source: readSource(message && message.source) || readSource(origin),
		title: title,
		// Both: the plain text, and the same rendered from Markdown. The
		// overlay shows the rendered one; the plain one is there for
		// anything that can't, and for tests.
		description: description,
		html: markdown.render(description),
		priority: priority,
		seconds: PRIORITY_SECONDS[priority],
		// Up to two, each drawn as its own QR box. `link` is the first of
		// them, kept for anything written before there could be two.
		links: links,
		link: links[0] || null
	};

	// Every display showing this face, browser tabs included
	const delivered = faceEvents.pushToFace(faceId, "notification", note);

	if (delivered > 0) {
		return true;
	}

	// Nothing was watching. Either this is dropped, or it waits.
	if (!settings.notificationsStoreWhileAsleep) {
		return false;
	}

	if (!held.has(faceId)) {
		held.set(faceId, []);
	}

	const queue = held.get(faceId);
	queue.push(note);

	// Oldest go first once the ceiling is reached, so a module stuck in a
	// loop costs the newest messages nothing
	const max = Math.max(1, Number(settings.notificationsStoredMax) || 20);

	while (queue.length > max) {
		queue.shift();
	}

	return true;
}

// A deleted face's held notifications have nobody left to go to
function forgetFace(faceId) {
	held.delete(faceId);
}

// Hand over anything held for this face and forget it.
//
// Called when any display connects, which is the moment "nobody was
// watching" stops being true. The first display to connect gets them all;
// a second one opening a moment later doesn't see them again.
function releaseHeld(faceId) {
	const queue = held.get(faceId);

	if (!queue || queue.length === 0) {
		return;
	}

	held.delete(faceId);

	for (const note of queue) {
		faceEvents.pushToFace(faceId, "notification", note);
	}
}

// ---------------------------------------------------------------------
// The overlay itself
//
// Built out of the Default UI's look -- its segments, its colours, its
// font, the timer lamp -- so a notification reads as part of OmniCore
// rather than something bolted on. See
// docs/planning/default-ui-architecture.md.
//
// It carries that look with it. The overlay is drawn on top of a theme's
// page as often as on OmniCore's own, and a theme's page has none of the
// Default UI's colours or font in it. So the overlay sets its own copies
// on itself (the --omni-note-* values below), each time a page is
// served: the install's font and size, and the light or dark chosen for
// that FACE (its notificationMode, set on the face's page in the admin
// face; dark unless changed). Per face rather than per browser because
// a face's screen is usually a TV or a wall tablet nobody signs in on,
// so there's no browser choice there to follow. Whatever theme is
// underneath, a notification looks the same.
//
// Three kinds of box, a bento:
//
//   +--------------------------------------+
//   |  Module name                         |   where it came from, drawn
//   +-------------------------+------------+   like a page's heading
//   |  Title                  |   QR code  |
//   |  Description, Markdown  |   address  |   one box per link, up to
//   |                         +------------+   two, stacked; no box at
//   |                         |   QR code  |   all when there's no link
//   |                         |   address  |
//   +-------------------------+------------+
//
// Every box is frosted glass: see-through, blurred, with no glow and no
// sheen. On a screen taller than it is wide, the QR boxes go under the
// message, side by side.

// The overlay's look (its frosted glass per mode, and every rule) is the
// central theme's: ui-theme.js, notificationStyles(). `mode` is the face's
// notificationMode: "light", or anything else for dark.
function overlayStyles(mode) {
	return theme.notificationStyles(mode);
}

// The client half. Injected into a page by whoever is rendering it, and
// written to do nothing at all until a notification actually arrives --
// no element exists in the page before then.
const OVERLAY_SCRIPT = `
	(function () {
		// One at a time, in the order they arrived. Two notifications
		// stacked on top of each other is two nobody reads.
		var queue = [];
		var showing = false;
		var layer = null;
		var lamp = null;
		var ticker = null;

		// The most that wait their turn. Each one holds the screen for up
		// to a minute, so a burst from several modules at once could
		// otherwise keep the display covered for an hour. Past this, the
		// OLDEST waiting are let go -- the newest are the likeliest to
		// still matter -- and the next one shown says how many were.
		var MOST_WAITING = 10;
		var skipped = 0;

		function build() {
			layer = document.createElement("div");
			layer.className = "omni-note-layer";
			layer.innerHTML =
				'<div class="omni-note-bento" role="status" aria-live="polite">' +
					'<div class="omni-note omni-note-source">' +
						'<span class="omni-note-source-icon" aria-hidden="true"></span>' +
						'<span class="omni-note-source-name"></span>' +
					'</div>' +
					'<div class="omni-note-row">' +
						'<div class="omni-note omni-note-main">' +
							'<h2 class="omni-note-title"></h2>' +
							'<div class="omni-note-description"></div>' +
							'<p class="omni-note-skipped"></p>' +
						'</div>' +
						'<div class="omni-note-links"></div>' +
					'</div>' +
				'</div>' +
				'<div class="omni-note-timer">' +
					'<div class="omni-note-lamp"></div>' +
				'</div>';
			document.body.appendChild(layer);
			lamp = layer.querySelector(".omni-note-lamp");
		}

		function finish() {
			clearInterval(ticker);
			layer.classList.remove("is-open");
			layer.classList.add("is-closing");

			// Let the leaving animation actually run before the next one
			// starts arriving
			setTimeout(function () {
				layer.classList.remove("is-closing");
				showing = false;
				next();
			}, 260);
		}

		// Set something as plain text, and hide it when there's nothing
		function setText(selector, text) {
			var element = layer.querySelector(selector);
			element.textContent = text || "";
			element.hidden = !text;
		}

		function show(note) {
			showing = true;

			// Where it came from. Set as text: it's whatever the module
			// said, so it's never read as markup. The whole box goes when
			// there's nothing to say (only an older Core sends none).
			setText(".omni-note-source-name", note.source);
			layer.querySelector(".omni-note-source").hidden = !note.source;

			setText(".omni-note-title", note.title);

			// The description arrives already rendered by Core from its
			// Markdown subset, with everything the module wrote escaped
			// (see core/markdown.js) -- which is what makes it safe to set
			// as markup. Older Cores sent only plain text; that's set as text.
			var description = layer.querySelector(".omni-note-description");

			if (note.html) {
				description.innerHTML = note.html;
			} else {
				description.textContent = note.description || "";
			}

			description.hidden = !(note.html || note.description);
			description.classList.toggle("is-alone", !note.title);

			setText(
				".omni-note-skipped",
				skipped > 0
					? skipped + (skipped === 1
						? " earlier notification skipped"
						: " earlier notifications skipped")
					: ""
			);
			skipped = 0;

			// The QR column: a box for each link, emptied first so the
			// last notification's codes never linger. Each code is Core's
			// own drawing -- an SVG built from numbers only (see
			// core/qr.js) -- and the address goes in as plain text. A
			// notification from before v1.19.7 has only "link", not
			// "links", so that's read too.
			var links = Array.isArray(note.links) ? note.links : (note.link ? [note.link] : []);
			links = links.filter(function (link) { return link && link.svg; }).slice(0, ${MOST_LINKS});

			var column = layer.querySelector(".omni-note-links");
			column.innerHTML = "";

			links.forEach(function (link) {
				var box = document.createElement("div");
				box.className = "omni-note omni-note-link";

				var code = document.createElement("div");
				code.className = "omni-note-qr";
				code.innerHTML = link.svg;

				var address = document.createElement("p");
				address.className = "omni-note-link-url";
				address.textContent = link.url;

				box.appendChild(code);
				box.appendChild(address);
				column.appendChild(box);
			});

			layer.classList.toggle("has-link", links.length > 0);

			var total = Number(note.seconds) || 30;
			var left = total;

			lamp.style.setProperty("--remaining", "1");

			// Force the browser to notice the starting state before the
			// class changes it, or there is nothing to animate from
			void layer.offsetWidth;
			layer.classList.add("is-open");

			ticker = setInterval(function () {
				left -= 1;
				lamp.style.setProperty("--remaining", String(Math.max(0, left / total)));

				if (left <= 0) {
					finish();
				}
			}, 1000);
		}

		function next() {
			if (showing || queue.length === 0) {
				return;
			}

			show(queue.shift());
		}

		window.omniNotify = function (note) {
			// Something to say: a title, a description, or both
			if (!note || !(note.title || note.description || note.html)) {
				return;
			}

			if (!layer) {
				build();
			}

			queue.push(note);

			while (queue.length > MOST_WAITING) {
				queue.shift();
				skipped += 1;
			}

			next();
		};
	})();
`;

module.exports = {
	notify,
	releaseHeld,
	forgetFace,
	resolvePriority,
	readLink,
	readLinks,
	readSource,
	overlayStyles,
	PRIORITY_SECONDS,
	MOST_LINKS,
	TABLE_TEXT_SCALE,
	EMOJI_FONTS,
	OVERLAY_SCRIPT
};