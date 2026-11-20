// core/network-watcher.js
// Keeping an eye on the network (since 2.0.0), and deciding what every face
// shows about it (network-status.js draws it).
//
// THREE STATES
//
//   online         the internet works. Nothing on screen. (However the
//                  server gets it: working internet over a cable counts.)
//   no-internet    the Wi-Fi (or a cable) is connected, but nothing gets
//                  through: the router or the internet provider is down.
//                  OmniCore never drops a working connection over this.
//                  Every face shows the drawer with a question mark until
//                  the internet is back.
//   disconnected   no network at all. The core takes over every face:
//                  "Wi-Fi disconnected".
//
// HOW IT KNOWS
//
// First: does the internet work? A plain request to github.com, the
// company OmniCore already talks to for updates, so this adds nobody new.
// Any answer at all means yes; nothing within eight seconds means no.
//
// Only if not: what about the Wi-Fi? The network helper (network-helper.js)
// looks at the host's cards. A connected Wi-Fi card, or a cable that's
// plugged in, means "no-internet"; neither means "disconnected". An
// OmniCore that can't look (no Docker access, or no network tools) can't
// tell the two apart, and says only what it knows: "no-internet".
//
// NOT JUMPING AT SHADOWS
//
// Wi-Fi blips. So:
//   - nothing bad is said in the first 90 seconds after OmniCore starts:
//     after a power cut, the Wi-Fi is often still connecting
//   - a bad state is only said once it has lasted 30 seconds, checked again
//     every ten seconds meanwhile
//   - good news is said at once
// It checks once a minute while everything's fine, every 30 seconds while
// something's wrong.
//
// THE WI-FI COMING BACK
//
// From "disconnected" to "online": the takeover ends, and dashboard faces
// get the drawer with the Wi-Fi's signal and live speeds for ten seconds.
//
// OMNICORE_NETWORK_WATCH=off in the compose file turns all of this off.

const networkHelper = require("./network-helper");
const networkStatus = require("./network-status");

const BOOT_GRACE_MS = 90 * 1000;
const DROP_GRACE_MS = 30 * 1000;
const CHECK_WHEN_FINE_MS = 60 * 1000;
const CHECK_WHEN_WRONG_MS = 30 * 1000;
const CHECK_WHILE_UNSURE_MS = 10 * 1000;
const INTERNET_TIMEOUT_MS = 8000;

// Where "does the internet work?" is asked
const INTERNET_CHECK_URL = "https://github.com/";

async function internetWorks() {
	try {
		await fetch(INTERNET_CHECK_URL, {
			method: "HEAD",
			redirect: "manual",
			signal: AbortSignal.timeout(INTERNET_TIMEOUT_MS)
		});
		// Any answer at all, even an error page: something got through
		return true;
	} catch (error) {
		return false;
	}
}

// What the helper says about the Wi-Fi, as the state it means, plus the
// connected card (for the drawer's signal and speeds)
function readNetwork(found) {
	if (!found || !found.available) return { state: "no-internet", card: null };
	const card = (found.wifi || []).find((wifi) => wifi.connected) || null;
	const cable = (found.wired || []).some((wired) => wired.cable);
	return { state: card || cable ? "no-internet" : "disconnected", card };
}

// The watcher. `deps` is for the tests: what checks the internet, what
// looks at the Wi-Fi, the clock, what's told, and how speeds are read.
function createWatcher(deps = {}) {
	const checkInternet = deps.checkInternet || internetWorks;
	const probe = deps.probe || (() => networkHelper.probe({ fresh: true }));
	const now = deps.now || (() => Date.now());
	const status = deps.status || networkStatus;
	const watchCounters = deps.watchCounters || networkHelper.watchCounters;

	const startedAt = now();
	let state = "starting";
	let pending = null; // { state, since }: a bad state not yet said
	let timer = null;
	let stopped = false;

	function say(next, card) {
		const previous = state;
		state = next;
		status.setState(next);

		// The Wi-Fi is back: its signal and live speeds, on dashboards
		if (previous === "disconnected" && next === "online") {
			status.showReconnected(card ? card.bars : 0);
			if (card && card.name) {
				watchCounters(card.name, Math.round(networkStatus.RECONNECT_SHOWN_MS / 1000), (sample) =>
					status.showSpeed(sample.down, sample.up)
				).catch(() => {
					// No speeds, then: the drawer shows dashes
				});
			}
		}
	}

	// One look. Returns how long until the next.
	async function check() {
		const online = await checkInternet();
		const at = now();

		if (online) {
			pending = null;
			let card = null;
			// Coming back from "disconnected": which card, for its signal
			if (state === "disconnected") {
				try {
					card = readNetwork(await probe()).card;
				} catch (error) {
					card = null;
				}
			}
			if (state !== "online") say("online", card);
			return CHECK_WHEN_FINE_MS;
		}

		let seen;
		try {
			seen = readNetwork(await probe()).state;
		} catch (error) {
			seen = "no-internet";
		}

		if (state === seen) {
			pending = null;
			return CHECK_WHEN_WRONG_MS;
		}
		if (!pending || pending.state !== seen) pending = { state: seen, since: at };

		const pastBoot = at - startedAt >= BOOT_GRACE_MS;
		const lasted = at - pending.since >= DROP_GRACE_MS;
		if (pastBoot && lasted) {
			pending = null;
			say(seen, null);
			return CHECK_WHEN_WRONG_MS;
		}
		return CHECK_WHILE_UNSURE_MS;
	}

	function schedule(ms) {
		if (stopped) return;
		timer = setTimeout(async () => {
			let next = CHECK_WHEN_WRONG_MS;
			try {
				next = await check();
			} catch (error) {
				console.log(`Network check failed: ${error.message}`);
			}
			schedule(next);
		}, ms);
		if (timer.unref) timer.unref();
	}

	return {
		check,
		start() {
			stopped = false;
			schedule(0);
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
		},
		// Look now, not at the next turn (Manual Setup has just joined a
		// network)
		checkNow() {
			if (stopped) return;
			clearTimeout(timer);
			schedule(0);
		},
		state: () => state
	};
}

let running = null;

// Start watching (start.OmniCore does, once)
function start() {
	if (process.env.OMNICORE_NETWORK_WATCH === "off") {
		console.log("Network watching is off (OMNICORE_NETWORK_WATCH=off)");
		return null;
	}
	if (!running) {
		running = createWatcher();
		running.start();
	}
	return running;
}

function checkNow() {
	if (running) running.checkNow();
}

module.exports = {
	checkNow,
	BOOT_GRACE_MS,
	DROP_GRACE_MS,
	CHECK_WHEN_FINE_MS,
	CHECK_WHEN_WRONG_MS,
	CHECK_WHILE_UNSURE_MS,
	INTERNET_CHECK_URL,
	internetWorks,
	readNetwork,
	createWatcher,
	start
};
