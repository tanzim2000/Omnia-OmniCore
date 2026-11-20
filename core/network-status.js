// core/network-status.js
// What every face shows about the network (since 2.0.0): the status
// drawer and the takeover.
//
// THE TWO THINGS ON SCREEN
//
//   The status drawer: a clear pane of glass that comes out of the
//   top-right corner. It has no buttons and lets every touch through; when
//   it's closed it's entirely out of sight. Its motion: it drops in from
//   the top with only a sliver of it on screen, slides open to the left,
//   and leaves by sliding straight up. It shows
//
//     - the Wi-Fi logo with a question mark, on EVERY face (Settings,
//       About, Inports, dashboards, all of them), for as long as the Wi-Fi
//       is connected but the internet isn't there
//     - the Wi-Fi logo with its signal, and live download and upload
//       speeds, on DASHBOARD faces (port 4000 and up) only, for ten seconds,
//       when the Wi-Fi comes back after being disconnected
//
//   The takeover: when the Wi-Fi is disconnected, the core's core takes
//   over every face, pauses it, and says so: "Wi-Fi disconnected". No
//   drawer then. Under that, Manual Setup (network-setup.js), in a frame
//   from the admin face's port so that a theme's page can't read what's
//   typed into it.
//
// HOW IT GETS THERE
//
// Every face's server, whatever kind of face, gets one small stream,
// /omnicore-network/events (attach()), and every page OmniCore draws gets
// the same client (CLIENT_HTML): page-motion.js's pageStart() for OmniCore's
// own pages, face-events.js's clientBundle() for a theme's. The server
// knows what kind of face each stream is for and sends the dashboard-only
// drawer only to dashboards, so the client never has to know.
//
// What goes down the stream is only the state and, for the ten seconds,
// signal bars and speeds: never a network's name. It's open to everyone
// who can reach the face (Settings' sign-in page too: that's a face to
// take over as well), so it holds nothing to look up.
//
// A THEME
//
// Hears about it: <html> carries data-omnicore-network="online",
// "no-internet" or "disconnected", and the window gets an
// "omnicore:network" event with { state } whenever it changes. A theme
// that wants to show it its own way can hide Core's drawer
// (.omni-net-drawer { display: none }); the takeover can't be hidden.

const EVENTS_PATH = "/omnicore-network/events";

// Manual Setup's page, on the admin face (network-setup.js has the same
// path; written out here too, as requiring that file here would go round
// in a circle)
const SETUP_PATH = "/omnicore-network/setup";
const { ADMIN_PORT } = require("./face-links");

// How long the drawer stays out when the Wi-Fi comes back
const RECONNECT_SHOWN_MS = 10000;

// Every open stream: its response and what kind of face it's on
const clients = new Set();

// What's true now, for anyone who connects later
let current = { state: "starting" };
let reconnect = null; // { until, bars, down, up } for the ten seconds

let keepAlive = null;

function send(client, event, data) {
	try {
		client.res.write(`event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`);
	} catch (error) {
		clients.delete(client);
	}
}

function broadcast(event, data, onlyKind) {
	for (const client of clients) {
		if (onlyKind && client.kind !== onlyKind) continue;
		send(client, event, data);
	}
}

// Give a face's server the stream. `kind` is "dashboard" for a dashboard
// face (port 4000 and up) and "other" for everything else.
function attach(app, kind) {
	app.get(EVENTS_PATH, (req, res) => {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		const client = { res, kind: kind === "dashboard" ? "dashboard" : "other" };
		clients.add(client);

		// What's true now, so a page opened during an outage shows it
		send(client, "state", current);
		if (client.kind === "dashboard" && reconnect && reconnect.until > Date.now()) {
			send(client, "reconnected", { bars: reconnect.bars, ms: reconnect.until - Date.now() });
			if (reconnect.down !== null) send(client, "speed", { down: reconnect.down, up: reconnect.up });
		}

		// A comment now and then, so nothing between here and the screen
		// decides the quiet stream is dead
		if (!keepAlive) {
			keepAlive = setInterval(() => {
				for (const open of clients) {
					try {
						open.res.write(":\n\n");
					} catch (error) {
						clients.delete(open);
					}
				}
			}, 25000);
			keepAlive.unref();
		}

		req.on("close", () => clients.delete(client));
	});
}

// --- What the watcher (network-watcher.js) tells it ---------------------

// "online", "no-internet" or "disconnected"
function setState(state) {
	if (current.state === state) return;
	current = { state };
	if (state !== "online") reconnect = null;
	broadcast("state", current);
}

// The Wi-Fi is back after being disconnected: the drawer on dashboards,
// with its signal, for ten seconds
function showReconnected(bars) {
	reconnect = { until: Date.now() + RECONNECT_SHOWN_MS, bars: Number(bars) || 0, down: null, up: null };
	broadcast("reconnected", { bars: reconnect.bars, ms: RECONNECT_SHOWN_MS }, "dashboard");
}

// Bytes a second, down and up, while the drawer is out
function showSpeed(down, up) {
	if (!reconnect || reconnect.until <= Date.now()) return;
	reconnect.down = down;
	reconnect.up = up;
	broadcast("speed", { down, up }, "dashboard");
}

function state() {
	return current.state;
}

// How joining a network in Manual Setup is going (network-setup.js), for
// the setup page: { phase, ssid, message }
function broadcastSetup(step) {
	broadcast("setup", step || {});
}

// ---------------------------------------------------------------------
// The client: one <style> and one <script>, the same on every page

// The Wi-Fi logo: a dot and three arcs. `lit` is how many of the four
// parts are bright (signal bars); the rest are faint.
function wifiSvg(extra) {
	return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
		<path class="omni-net-b3" d="M2.5 9a14 14 0 0 1 19 0"/>
		<path class="omni-net-b2" d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/>
		<path class="omni-net-b1" d="M8.7 15.4a5 5 0 0 1 6.6 0"/>
		<circle class="omni-net-b0" cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>
		${extra || ""}
	</svg>`;
}

const CLIENT_CSS = `
	/* The status drawer. The pane is bigger than what's seen: it runs past
	   the top and right edges of the screen, so only its bottom-left corner
	   is round on screen. Every touch goes through it. */
	.omni-net-drawer {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 2147483000;
		pointer-events: none;
		font: 500 15px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		color: #fff;
	}
	.omni-net-drawer[hidden] { display: none; }
	.omni-net-pane {
		position: absolute;
		top: -1.25em;
		right: -1.25em;
		display: flex;
		align-items: center;
		gap: 0.75em;
		padding: calc(1.25em + 0.7em) calc(1.25em + 1em) 0.7em 1em;
		border-radius: 1.4em;
		white-space: nowrap;
		/* Clear glass: no blur, a faint tint, a bright rim, and what's
		   behind a little darker so white stays readable on anything */
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05));
		border: 1px solid rgba(255, 255, 255, 0.32);
		box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.25), 0 6px 22px rgba(0, 0, 0, 0.28);
		-webkit-backdrop-filter: brightness(0.82) saturate(1.3);
		backdrop-filter: brightness(0.82) saturate(1.3);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
		/* Out of sight until it moves (the script moves it) */
		transform: translate(0, -150%);
	}
	.omni-net-pane svg { flex: none; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45)); }
	.omni-net-pane .omni-net-dim { opacity: 0.3; }
	.omni-net-speeds { display: flex; gap: 0.9em; font-variant-numeric: tabular-nums; }
	.omni-net-speeds span { min-width: 5.2em; }
	.omni-net-hidden-text {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* The takeover: the whole screen, above everything, the page paused
	   under it */
	.omni-net-takeover {
		position: fixed;
		inset: 0;
		z-index: 2147483600;
		display: grid;
		place-items: center;
		padding: 2em;
		background: rgba(0, 0, 0, 0.82);
		-webkit-backdrop-filter: blur(24px) saturate(1.2);
		backdrop-filter: blur(24px) saturate(1.2);
		color: #fff;
		font: 400 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
		text-align: center;
		opacity: 0;
		transition: opacity 0.4s ease;
	}
	.omni-net-takeover[hidden] { display: none; }
	.omni-net-takeover.on { opacity: 1; }
	.omni-net-takeover-card { width: min(34em, 100%); display: grid; justify-items: center; gap: 0.75em; }
	.omni-net-setup {
		width: 100%;
		height: min(30em, 58vh);
		margin-top: 0.75em;
		border: 0;
		background: transparent;
		color-scheme: dark;
	}
	.omni-net-takeover svg { width: 4.5em; height: 4.5em; opacity: 0.9; }
	.omni-net-takeover h1 { margin: 0.25em 0 0; font-size: 2em; font-weight: 600; letter-spacing: -0.01em; }
	.omni-net-takeover p { margin: 0; color: rgba(255, 255, 255, 0.75); }
	@media (prefers-reduced-motion: reduce) {
		.omni-net-takeover { transition: none; }
	}
`;

const CLIENT_SCRIPT = `
(function () {
	// Once per page, and only where a browser can listen
	if (window.__omniNetworkStatus || !window.EventSource || !document.body) return;
	window.__omniNetworkStatus = true;

	var still = window.matchMedia("(prefers-reduced-motion: reduce)");
	var root = document.documentElement;

	// --- The drawer -------------------------------------------------------
	var drawer = document.createElement("div");
	drawer.className = "omni-net-drawer";
	drawer.setAttribute("role", "status");
	drawer.hidden = true;
	var pane = document.createElement("div");
	pane.className = "omni-net-pane";
	drawer.appendChild(pane);
	document.body.appendChild(drawer);

	var WIFI = ${JSON.stringify(wifiSvg())};
	var QUESTION = ${JSON.stringify(wifiSvg('<path class="omni-net-q" d="M16.6 13.4a2.7 2.7 0 1 1 3.8 2.5c-.7.3-1 .8-1 1.5v.5" stroke-width="2.1"/><circle class="omni-net-q" cx="19.4" cy="21.3" r="1.2" fill="currentColor" stroke="none"/>'))};

	// Where the pane is at each moment of its motion:
	//   gone    above the screen, pushed almost all the way right
	//   sliver  dropped to its height, a sliver on screen at the right
	//   open    in the corner
	//   up      straight up and out of sight, from wherever it is
	var GONE = "translate(calc(100% - 2.25em), -150%)";
	var SLIVER = "translate(calc(100% - 2.25em), 0)";
	var OPEN = "translate(0, 0)";
	var UP = "translate(0, -150%)";

	var showing = null; // "no-internet", "connected" or null
	pane.style.transform = GONE;
	var motion = null;
	var closing = null;

	function setTransform(value) {
		pane.style.transform = value;
	}

	function play(frames, duration, easing) {
		if (motion) motion.cancel();
		if (!pane.animate) {
			var last = frames[frames.length - 1].transform;
			if (last) setTransform(last);
			return Promise.resolve();
		}
		motion = pane.animate(frames, { duration: duration, easing: easing, fill: "forwards" });
		var mine = motion;
		return mine.finished.then(function () {
			var end = frames[frames.length - 1].transform;
			if (end) setTransform(end);
			// Keep the end where it is without the animation holding it
			if (motion === mine) { mine.cancel(); motion = null; }
		}, function () {});
	}

	function openDrawer() {
		clearTimeout(closing);
		if (!drawer.hidden && pane.dataset.at === "open") return;
		drawer.hidden = false;
		pane.dataset.at = "open";
		if (still.matches) {
			setTransform(OPEN);
			pane.style.opacity = "0";
			play([{ opacity: 0, transform: OPEN }, { opacity: 1, transform: OPEN }], 200, "linear").then(function () { pane.style.opacity = ""; });
			return;
		}
		// Drop in (a quick fall that settles with a little give), then
		// slide open into the corner without overshooting
		play([{ transform: GONE }, { transform: SLIVER }], 250, "cubic-bezier(0.25, 0.9, 0.3, 1.18)").then(function () {
			if (pane.dataset.at !== "open") return;
			play([{ transform: SLIVER }, { transform: OPEN }], 400, "cubic-bezier(0.32, 0.72, 0, 1)");
		});
	}

	function closeDrawer() {
		clearTimeout(closing);
		showing = null;
		if (drawer.hidden) return;
		pane.dataset.at = "up";
		var from = getComputedStyle(pane).transform;
		var leave = still.matches
			? play([{ opacity: 1 }, { opacity: 0 }], 200, "linear")
			: play([{ transform: from === "none" ? OPEN : from }, { transform: UP }], 350, "cubic-bezier(0.5, 0, 0.75, 0)");
		leave.then(function () {
			if (pane.dataset.at !== "up") return;
			drawer.hidden = true;
			pane.style.opacity = "";
			setTransform(GONE);
		});
	}

	// Bytes a second, the way a person reads it
	function rate(value) {
		if (typeof value !== "number" || !isFinite(value)) return "\\u2013";
		var units = ["B/s", "KB/s", "MB/s", "GB/s"];
		var at = 0;
		while (value >= 1000 && at < units.length - 1) { value = value / 1000; at++; }
		return (value >= 100 || at === 0 ? Math.round(value) : value.toFixed(1)) + " " + units[at];
	}

	function showNoInternet() {
		showing = "no-internet";
		pane.innerHTML = QUESTION + '<span class="omni-net-hidden-text">Connected to Wi-Fi, but there is no internet</span>';
		pane.querySelectorAll(".omni-net-b0, .omni-net-b1, .omni-net-b2, .omni-net-b3").forEach(function (part) { part.classList.add("omni-net-dim"); });
		openDrawer();
	}

	function showConnected(bars, ms) {
		// After the takeover has finished leaving, never under it
		var wait = takeoverGoneAt - Date.now();
		if (wait > 0) {
			setTimeout(function () { showConnected(bars, ms - wait); }, wait + 30);
			return;
		}
		showing = "connected";
		pane.innerHTML = WIFI +
			'<span class="omni-net-speeds"><span data-down>\\u2193 \\u2013</span><span data-up>\\u2191 \\u2013</span></span>' +
			'<span class="omni-net-hidden-text">Wi-Fi connected</span>';
		for (var level = 1; level < 4; level++) {
			// The dot is always lit; each bar past the first lights one
			// more arc outwards (four bars: the dot and all three)
			if (level >= bars) {
				var part = pane.querySelector(".omni-net-b" + level);
				if (part) part.classList.add("omni-net-dim");
			}
		}
		openDrawer();
		clearTimeout(closing);
		closing = setTimeout(function () { if (showing === "connected") closeDrawer(); }, ms || 10000);
	}

	// --- The takeover -----------------------------------------------------
	var takeover = null;
	var takeoverWanted = false;
	var takeoverGoneAt = 0;
	function setTakeover(on) {
		takeoverWanted = on;
		if (on) {
			if (!takeover) {
				takeover = document.createElement("div");
				takeover.className = "omni-net-takeover";
				takeover.setAttribute("role", "alertdialog");
				takeover.setAttribute("aria-live", "assertive");
				takeover.innerHTML = '<div class="omni-net-takeover-card">' +
					${JSON.stringify(wifiSvg('<path d="M3 3l18 18" stroke-width="2.2"/>'))} +
					'<h1>Wi-Fi disconnected</h1>' +
					"<p>OmniCore lost its Wi-Fi and has paused everything until it's back. It keeps trying to reconnect on its own.</p>" +
					'</div>';
				document.body.appendChild(takeover);
			}
			// Manual Setup, from the admin face's port: a different origin,
			// so a theme's script on this page can't read the password
			// typed into it. Fresh each time the takeover comes up.
			if (!takeover.querySelector("iframe")) {
				var frame = document.createElement("iframe");
				frame.className = "omni-net-setup";
				frame.title = "Manual Setup";
				frame.src = location.protocol + "//" + location.hostname + ":${ADMIN_PORT}${SETUP_PATH}";
				takeover.querySelector(".omni-net-takeover-card").appendChild(frame);
			}
			takeover.hidden = false;
			// The next frame, so it fades in rather than appearing; and
			// only if it's still wanted by then (the Wi-Fi can come back
			// within the same moment)
			requestAnimationFrame(function () {
				requestAnimationFrame(function () { if (takeoverWanted) takeover.classList.add("on"); });
			});
		} else if (takeover && !takeover.hidden) {
			takeover.classList.remove("on");
			var fade = still.matches ? 0 : 400;
			takeoverGoneAt = Date.now() + fade;
			setTimeout(function () {
				if (takeoverWanted) return;
				takeover.hidden = true;
				var frame = takeover.querySelector("iframe");
				if (frame) frame.remove();
			}, fade);
		}
	}

	// --- Listening ----------------------------------------------------------
	function announce(state) {
		if (root.getAttribute("data-omnicore-network") === state) return;
		root.setAttribute("data-omnicore-network", state);
		try {
			window.dispatchEvent(new CustomEvent("omnicore:network", { detail: { state: state } }));
		} catch (error) {}
	}

	var source = new EventSource(${JSON.stringify(EVENTS_PATH)});
	function read(event) {
		try { return JSON.parse(event.data); } catch (error) { return {}; }
	}

	source.addEventListener("state", function (event) {
		var state = read(event).state;
		if (state === "starting") state = "online";
		announce(state);
		if (state === "disconnected") {
			// No drawer then: the takeover says it
			if (showing) {
				showing = null;
				drawer.hidden = true;
				setTransform(GONE);
			}
			setTakeover(true);
		} else if (state === "no-internet") {
			setTakeover(false);
			showNoInternet();
		} else {
			setTakeover(false);
			if (showing === "no-internet") closeDrawer();
		}
	});

	source.addEventListener("reconnected", function (event) {
		var data = read(event);
		showConnected(Number(data.bars) || 0, Number(data.ms) || 10000);
	});

	source.addEventListener("speed", function (event) {
		if (showing !== "connected") return;
		var data = read(event);
		var down = pane.querySelector("[data-down]");
		var up = pane.querySelector("[data-up]");
		if (down) down.textContent = "\\u2193 " + rate(data.down);
		if (up) up.textContent = "\\u2191 " + rate(data.up);
	});
})();
`;

const CLIENT_HTML = `<style>${CLIENT_CSS}</style><script>${CLIENT_SCRIPT}</script>`;

// For the tests: forget everything
function reset() {
	for (const client of clients) {
		try {
			client.res.end();
		} catch (error) {
			// Already gone
		}
	}
	clients.clear();
	current = { state: "starting" };
	reconnect = null;
}

module.exports = {
	EVENTS_PATH,
	RECONNECT_SHOWN_MS,
	attach,
	setState,
	showReconnected,
	showSpeed,
	state,
	broadcastSetup,
	CLIENT_HTML,
	CLIENT_CSS,
	CLIENT_SCRIPT,
	reset
};
