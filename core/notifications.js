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
// That also settles what happens while nobody is watching: a module only
// runs when something asks it to, and a sleeping OmniView asks for
// nothing. Notifications stop happening on their own, with no scheduler
// to pause and nothing to switch off.

const faceEvents = require("./face-events");
const { readSettings } = require("./settings-store");

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

	const note = {
		title: title,
		description: String((message && message.description) || "").trim(),
		priority: priority,
		seconds: PRIORITY_SECONDS[priority]
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

	.omni-note-title {
		font-size: 1.8em;
		line-height: 1.2;
		margin: 0;
	}

	.omni-note-description {
		margin: 0.6em 0 0;
		color: var(--fg-muted);
		line-height: 1.45;
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

		function build() {
			layer = document.createElement("div");
			layer.className = "omni-note-layer";
			layer.innerHTML =
				'<div class="omni-note">' +
					'<h2 class="omni-note-title"></h2>' +
					'<p class="omni-note-description"></p>' +
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

		function show(note) {
			showing = true;

			layer.querySelector(".omni-note-title").textContent = note.title;

			var description = layer.querySelector(".omni-note-description");
			description.textContent = note.description || "";
			description.style.display = note.description ? "" : "none";

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
			next();
		};
	})();
`;

module.exports = {
	notify,
	releaseHeld,
	resolvePriority,
	PRIORITY_SECONDS,
	OVERLAY_STYLES,
	OVERLAY_SCRIPT
};