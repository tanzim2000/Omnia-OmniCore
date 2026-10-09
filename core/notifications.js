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
// Only an OmniView. A notification is pushed to displays that identified
// themselves as one when they connected (see face-events.js), which
// means a face opened in an ordinary browser tab never receives any --
// not because Core checks and refuses, but because a plain browser never
// asks for them in the first place.
//
// WHO RAISES ONE
//
// A background module (see core/background.js), through `omni.notify`.
// Those keep running while nobody is watching -- that's what they're
// for -- so a notification can be raised with no OmniView there to see
// it. What happens then is the install's own setting: dropped (the
// default), or held for the next OmniView that connects. See notify()
// below.
//
// An ordinary tile module can't raise one at all. It only runs when a
// display asks for its tile, every few seconds, so anything it raised
// would be raised again on every poll.
//
// WHAT ONE CAN SAY
//
//   title        required, plain text
//   description  optional, a small subset of Markdown -- bold, italic,
//                code, lists, a subtitle. See core/markdown.js for exactly
//                which, and why links aren't one of them.
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

// Longest link title worth showing above a QR code. It's a caption for a
// code, not a second message.
const LINK_TITLE_LONGEST = 80;

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

// Notifications raised while nobody was watching, keyed by face id.
//
// Only used when the install has asked for it. In memory rather than on
// disk on purpose: something held here is worth showing to whoever walks
// up next, not worth surviving a restart of OmniCore itself.
const held = new Map();

// Send one notification to every OmniView currently showing this face.
//
// `faceId` is the face's own id (its port). `title` is required; a
// notification with nothing to say is not worth interrupting anyone for.
function notify(faceId, message) {
	const settings = readSettings();

	if (!settings.notificationsEnabled) {
		return false;
	}

	const title = String((message && message.title) || "").trim();

	if (!title) {
		return false;
	}

	const priority = resolvePriority(message && message.priority);

	if (priority < Number(settings.notificationsMinimumPriority || 1)) {
		return false;
	}

	const description = String((message && message.description) || "").trim();

	const note = {
		title: title,
		// Both: the plain text, and the same rendered from Markdown. The
		// overlay shows the rendered one; the plain one is there for
		// anything that can't, and for tests.
		description: description,
		html: markdown.render(description),
		priority: priority,
		seconds: PRIORITY_SECONDS[priority],
		link: readLink(message && message.link)
	};

	// OmniView only. A plain browser tab showing this same face gets
	// nothing, which is the intended behaviour rather than a gap.
	const delivered = faceEvents.pushToFace(faceId, "notification", note, {
		omniViewOnly: true
	});

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

// Hand over anything held for this face and forget it.
//
// Called when an OmniView connects, which is the moment "nobody was
// watching" stops being true.
function releaseHeld(faceId) {
	const queue = held.get(faceId);

	if (!queue || queue.length === 0) {
		return;
	}

	held.delete(faceId);

	for (const note of queue) {
		faceEvents.pushToFace(faceId, "notification", note, {
			omniViewOnly: true
		});
	}
}

// ---------------------------------------------------------------------
// The overlay itself
//
// Built out of the Default UI's own tokens (`--card-bg`, `--radius`, the
// glass sheen, the timer lamp) rather than its own look, so a
// notification reads as part of OmniCore rather than something bolted
// on. See docs/planning/default-ui-architecture.md.

const OVERLAY_STYLES = `
	/* The dimmed layer behind the card. Sits above everything a theme
	   draws, which is the whole point of an overlay. */
	.omni-note-layer {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(6px);
		z-index: 9000;
		opacity: 0;
		transition: opacity 260ms ease;
		pointer-events: none;
	}

	.omni-note-layer.is-open { opacity: 1; }

	/* The card and, when there's a link, its QR pane beside it: a bento
	   pair, the message the bigger of the two. On a screen taller than it
	   is wide, the pane goes underneath instead. */
	.omni-note-bento {
		display: flex;
		align-items: stretch;
		justify-content: center;
		gap: 1.2em;
		max-width: 94vw;
	}

	@media (max-aspect-ratio: 1/1) {
		.omni-note-bento {
			flex-direction: column;
			align-items: center;
		}
	}

	/* The card. Same glass treatment as every other surface in the
	   Default UI, just larger and centred. */
	.omni-note {
		width: min(70vw, 34em);
		padding: 2.5em 2em;
		text-align: center;
		border-radius: var(--radius);
		border: 1px solid var(--glass-border);
		background: var(--card-bg);
		backdrop-filter: blur(14px);
		box-shadow: 0 0 2.5em var(--glow);
		position: relative;
		overflow: hidden;

		/* Start small. The open class scales it to 1 with an overshoot,
		   which is what gives the bounce. */
		transform: scale(0.82);
		opacity: 0;
		transition:
			transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 200ms ease;
	}

	.omni-note-layer.is-open .omni-note {
		transform: scale(1);
		opacity: 1;
	}

	/* Leaving is deliberately not the reverse of arriving. A bounce on
	   the way out reads as indecision -- it should simply go. */
	.omni-note-layer.is-closing .omni-note {
		transform: scale(0.9);
		opacity: 0;
		transition:
			transform 220ms ease-in,
			opacity 200ms ease-in;
	}

	/* The sheen across the top, same as the glass buttons */
	.omni-note::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 40%;
		background: linear-gradient(
			to bottom, var(--glass-sheen), transparent
		);
		pointer-events: none;
	}

	/* Narrower when it shares the screen with a QR pane, and centred
	   top to bottom, since the pane is usually the taller of the two */
	.omni-note-layer.has-link .omni-note-main {
		width: min(56vw, 30em);
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.omni-note-title {
		font-size: 1.8em;
		line-height: 1.2;
		margin: 0;
	}

	/* The description, rendered from Markdown. Capped in height: a wall
	   of text was never going to be read in passing, and it mustn't push
	   the title off the screen. */
	.omni-note-description {
		margin: 0.6em 0 0;
		color: var(--fg-muted);
		line-height: 1.45;
		max-height: 45vh;
		overflow: hidden;
	}

	.omni-note-description p { margin: 0 0 0.5em; }
	.omni-note-description > :last-child { margin-bottom: 0; }

	/* The card is centred, but a list reads badly centred line by line.
	   As a table it shrinks to fit and sits in the middle as a whole, with
	   its own lines lined up on the left -- and, unlike an inline block,
	   two lists in a row still stack rather than sitting side by side. */
	.omni-note-description ul,
	.omni-note-description ol {
		display: table;
		text-align: left;
		margin: 0 auto 0.5em;
		padding-left: 1.3em;
	}

	.omni-note-description code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.9em;
		padding: 0.05em 0.35em;
		border-radius: 0.3em;
		background: rgba(255, 255, 255, 0.1);
	}

	.omni-note-description strong { color: var(--fg); }

	.omni-md-subtitle {
		color: var(--fg);
		font-weight: 600;
		font-size: 1.1em;
	}

	/* "3 earlier notifications skipped" -- small, under everything */
	.omni-note-skipped {
		margin: 0.9em 0 0;
		font-size: 0.8em;
		color: var(--fg-muted);
		opacity: 0.8;
	}

	/* The QR pane. Only there when the notification has a link. */
	.omni-note-link {
		/* As wide as what's in it, not as wide as a message card */
		width: auto;
		display: none;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1.5em;
	}

	.omni-note-layer.has-link .omni-note-link { display: flex; }

	.omni-note-link-title {
		margin: 0 0 0.7em;
		font-weight: 600;
		max-width: 16em;
	}

	/* Big enough to scan from a few steps away, never bigger than the
	   screen can spare */
	.omni-note-qr svg {
		display: block;
		width: min(30vh, 14em);
		height: auto;
		border-radius: 0.4em;
	}

	/* The address itself: not clickable -- nothing here is -- but
	   readable, for anyone who'd rather type it */
	.omni-note-link-url {
		margin: 0.7em 0 0;
		max-width: 16em;
		font-size: 0.8em;
		color: var(--fg-muted);
		word-break: break-all;
	}

	/* The timer, bottom-left. Deliberately the same lamp the welcome
	   face's auto-advance uses -- a draining amber wedge under a domed
	   lens -- because "time is running out on this thing on screen"
	   already has a look in OmniCore and should not grow a second one.
	   Bottom-left is reserved for exactly this; the floating back button
	   only ever offers bottom-right and top-left so the two can't
	   collide. */
	.omni-note-timer {
		position: fixed;
		bottom: 1.5em;
		left: 1.5em;
		width: 3.2em;
		height: 3.2em;
		border-radius: 50%;
		border: 1px solid var(--glass-border);
		background: var(--card-bg);
		backdrop-filter: blur(12px);
		overflow: hidden;
		z-index: 9001;
		opacity: 0;
		transform: scale(0.82);
		transition:
			transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 200ms ease;
	}

	.omni-note-layer.is-open .omni-note-timer {
		opacity: 1;
		transform: scale(1);
	}

	.omni-note-layer.is-closing .omni-note-timer {
		opacity: 0;
		transform: scale(0.9);
		transition:
			transform 220ms ease-in,
			opacity 200ms ease-in;
	}

	.omni-note-lamp {
		position: absolute;
		inset: 0.45em;
		border-radius: 50%;
		background: conic-gradient(
			#ffb43a calc(var(--remaining) * 1turn),
			rgba(255, 180, 58, 0.12) 0
		);
		box-shadow: 0 0 0.75em rgba(255, 180, 58, 0.35);
		transition: background 1s linear;
	}

	.omni-note-timer::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, var(--glass-sheen), transparent
		);
		pointer-events: none;
	}

	/* Someone who has asked their system for less motion gets the same
	   notification without the movement. It still arrives, holds and
	   leaves -- only the scaling stops. */
	@media (prefers-reduced-motion: reduce) {
		.omni-note,
		.omni-note-timer,
		.omni-note-layer.is-closing .omni-note,
		.omni-note-layer.is-closing .omni-note-timer {
			transition: opacity 200ms ease;
			transform: none;
		}
	}
`;

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
				'<div class="omni-note-bento">' +
					'<div class="omni-note omni-note-main">' +
						'<h2 class="omni-note-title"></h2>' +
						'<div class="omni-note-description"></div>' +
						'<p class="omni-note-skipped"></p>' +
					'</div>' +
					'<div class="omni-note omni-note-link">' +
						'<p class="omni-note-link-title"></p>' +
						'<div class="omni-note-qr"></div>' +
						'<p class="omni-note-link-url"></p>' +
					'</div>' +
				'</div>' +
				'<div class="omni-note-timer">' +
					'<div class="omni-note-lamp" style="--remaining: 1"></div>' +
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

		function setText(selector, text) {
			var element = layer.querySelector(selector);
			element.textContent = text || "";
			element.style.display = text ? "" : "none";
		}

		function show(note) {
			showing = true;

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

			description.style.display = note.html || note.description ? "" : "none";

			setText(
				".omni-note-skipped",
				skipped > 0
					? skipped + (skipped === 1
						? " earlier notification skipped"
						: " earlier notifications skipped")
					: ""
			);
			skipped = 0;

			// The QR pane. The code is Core's own drawing -- an SVG built
			// from numbers only (see core/qr.js) -- and the address and its
			// title go in as plain text.
			var link = note.link && note.link.svg ? note.link : null;
			layer.classList.toggle("has-link", Boolean(link));
			layer.querySelector(".omni-note-qr").innerHTML = link ? link.svg : "";
			setText(".omni-note-link-title", link ? link.title : "");
			setText(".omni-note-link-url", link ? link.url : "");

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
			if (!note || !note.title) {
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
	resolvePriority,
	readLink,
	PRIORITY_SECONDS,
	OVERLAY_STYLES,
	OVERLAY_SCRIPT
};