// core/face-events.js
// Server-Sent Events (SSE) — lets OmniCore push messages TO a browser
// showing a face. Normally a browser has to ask and the server answers;
// SSE keeps a connection open so the server can speak first.
// One-way (server → browser), built into Node and browsers, and the
// browser auto-reconnects if the connection drops — which matters for an
// unattended kiosk on flaky wifi.

// Open connections, keyed by face id (port)
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
		const events = new EventSource("/events");
		let everConnected = false;

		events.addEventListener("face-changed", function () {
			location.reload();
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
		connections.get(face.id).add(res);

		// Clean up when the browser closes the tab or navigates away
		req.on("close", () => {
			connections.get(face.id).delete(res);
		});
	});
}

// Push a message to every browser currently showing this face
function pushToFace(faceId, eventName, data) {
	const listeners = connections.get(faceId);

	if (!listeners) {
		return;
	}

	// SSE wire format: an event name line, a data line, then a blank line
	const payload =
		`event: ${eventName}\n` +
		`data: ${JSON.stringify(data || {})}\n\n`;

	for (const res of listeners) {
		res.write(payload);
	}
}

module.exports = { attachEvents, pushToFace, CLIENT_SCRIPT };