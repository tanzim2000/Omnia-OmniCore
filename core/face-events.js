// core/face-events.js
// Server-Sent Events (SSE) — lets OmniCore push messages TO a browser
// showing a face. Normally a browser has to ask and the server answers;
// SSE keeps a connection open so the server can speak first.
// One-way (server → browser), built into Node and browsers, and the
// browser auto-reconnects if the connection drops — which matters for an
// unattended kiosk on flaky wifi.

// Open connections, keyed by face id (port). Each entry is the response
// stream plus what the client said it was when it connected.
const connections = new Map();

// OmniCore's own client script, injected into every theme page by
// face-loader.js. Themes never implement this themselves — that way a
// theme can't make itself un-switchable by forgetting to handle it.
//
// "face-changed" means anything about this face was edited — its theme,
// its name, its modules. The page just reloads and picks up whatever
// changed, so displays nobody is standing in front of stay current.
const CLIENT_SCRIPT = `<script>
	(function () {
		// Is this a real OmniView, or just a browser tab pointed at the
		// face? OmniView is a specialised browser and announces itself by
		// defining window.OmniView before the page's own scripts run.
		//
		// This decides one thing only: whether this display receives
		// notifications. Everything else on this connection works the
		// same either way.
		const isOmniView = Boolean(window.OmniView);

		const events = new EventSource(
			isOmniView ? "/events?client=omniview" : "/events"
		);
		let everConnected = false;

		events.addEventListener("face-changed", function () {
			location.reload();
		});

		// Only ever arrives on an OmniView connection, since Core sends
		// this event nowhere else. The overlay that draws it is Core's
		// own -- see notifications.js -- so no theme implements, styles,
		// or can accidentally swallow it.
		events.addEventListener("notification", function (event) {
			if (typeof window.omniNotify !== "function") {
				return;
			}

			try {
				window.omniNotify(JSON.parse(event.data));
			} catch (error) {
				// A malformed message is not worth taking the page down for
			}
		});

		// EventSource reconnects on its own after a dropout, but a page that
		// has been disconnected has no idea what it missed while it was
		// away. Reloading on RE-connection is what lets an unattended
		// display recover by itself after OmniCore restarts, rather than
		// sitting there showing something stale until somebody notices.
		events.addEventListener("open", function () {
			if (everConnected) {
				location.reload();
				return;
			}

			everConnected = true;
		});
	})();
</script>`;

// Attach the /events endpoint to a face's app
function attachEvents(app, face) {
	app.get("/events", (req, res) => {
		// These headers tell the browser this is a stream that stays open,
		// not a normal request that ends
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		if (!connections.has(face.id)) {
			connections.set(face.id, new Set());
		}

		// A display says what it is when it connects. OmniView sends
		// `?client=omniview`; an ordinary browser tab sends nothing,
		// because nothing tells it to.
		//
		// This is what decides who sees a notification, and it needs no
		// checking on Core's side: a plain browser never asks for them,
		// so it never gets any. See notifications.js.
		const listener = {
			res: res,
			isOmniView: req.query.client === "omniview"
		};

		connections.get(face.id).add(listener);

		// An OmniView arriving is the moment "nobody was watching" stops
		// being true, so anything held for this face goes out now.
		// Required lazily to avoid a circular import.
		if (listener.isOmniView) {
			setImmediate(() => require("./notifications").releaseHeld(face.id));
		}

		// Clean up when the browser closes the tab or navigates away
		req.on("close", () => {
			connections.get(face.id).delete(listener);
		});
	});
}

// Push a message to every browser currently showing this face.
//
// `options.omniViewOnly` limits it to displays that identified as an
// OmniView. Used by notifications, which are deliberately not something
// a face opened in an ordinary browser tab ever receives.
function pushToFace(faceId, eventName, data, options) {
	const listeners = connections.get(faceId);

	if (!listeners) {
		return 0;
	}

	const omniViewOnly = Boolean(options && options.omniViewOnly);

	// SSE wire format: an event name line, a data line, then a blank line
	const payload =
		`event: ${eventName}\n` +
		`data: ${JSON.stringify(data || {})}\n\n`;

	let sent = 0;

	for (const listener of listeners) {
		if (omniViewOnly && !listener.isOmniView) {
			continue;
		}

		listener.res.write(payload);
		sent += 1;
	}

	return sent;
}

// Everything Core injects into a page, in one block: the reload
// listener, the notification listener, and the overlay that draws one.
//
// Bundled together on purpose. Anything that already injects
// CLIENT_SCRIPT gets notifications without having to know they exist,
// which is the same reason themes never implement the reload behaviour
// themselves.
function clientBundle() {
	// Required here rather than at the top of the file: notifications.js
	// requires this module, so importing it up there would be circular.
	const notifications = require("./notifications");

	return (
		`<style>${notifications.OVERLAY_STYLES}</style>\n` +
		`<script>${notifications.OVERLAY_SCRIPT}</script>\n` +
		CLIENT_SCRIPT
	);
}

module.exports = { attachEvents, pushToFace, CLIENT_SCRIPT, clientBundle };