// core/network-hotspot.js
// The setup hotspot, for OmniSync (since 2.0.0).
//
// WHAT HAPPENS
//
// The Wi-Fi is disconnected (network-watcher.js), and the server's Wi-Fi
// card can run a network of its own (network-helper.js, "hotspot"). So the
// core assumes you'll set it up with OmniSync: it starts a hotspot with a
// name and password made up for this round, and the takeover's setup page
// shows a QR code holding them, encrypted (omnisync.js). Neither is ever
// shown in words. OmniSync scans it, joins, and sends the home Wi-Fi's
// details (POST /omnicore-network/omnisync); OmniCore turns the hotspot
// off and joins that network the way Manual Setup does (network-setup.js).
//
// "Set up manually" on the page turns the hotspot off (the card can't run
// a network and look for others at once) and the page becomes Manual
// Setup. A card that can't run a hotspot goes straight there.
//
// ROUNDS, SO THE WI-FI COMES BACK BY ITSELF
//
// While the hotspot runs, the server can't reconnect to its old network:
// wpa_supplicant is paused (SIGSTOP) so it doesn't fight over the card. So
// a hotspot only ever runs for ten minutes; then it puts everything back
// and wpa_supplicant gets a minute to find a network it knows. Still
// disconnected? A new round, with a new name, password and QR code.
//
// The ten minutes are in the helper's own script, not only in OmniCore: if
// OmniCore stops in the middle, the hotspot still ends on time and still
// unpauses wpa_supplicant. And when OmniCore starts, a hotspot left over
// from before is removed and the Wi-Fi put back (cleanUp).
//
// HOW, ON THE HOST
//
//   wpa_supplicant: pause it; if the radio can run a network alongside a
//     connection, a second interface (omni0) for the hotspot, otherwise the
//     card itself switched to access point; 10.42.0.1 on it; hostapd for
//     the network and dnsmasq for addresses only (no DNS, so nothing like
//     Pi-hole on the server is in the way). Afterwards: all of it undone,
//     wpa_supplicant unpaused and told to look again.
//   NetworkManager: its own hotspot (`nmcli device wifi hotspot`), which is
//     10.42.0.1 too; afterwards, deleted.

const networkHelper = require("./network-helper");
const networkStatus = require("./network-status");
const omnisync = require("./omnisync");
const qr = require("./qr");

const ROUND_SECONDS = 10 * 60;
const REST_MS = 60 * 1000;

const MODE_PATH = "/omnicore-network/mode";
const MANUAL_PATH = "/omnicore-network/manual";
const OMNISYNC_PATH = "/omnicore-network/omnisync";

const FIND_PROCESS = `
find_process() {
	for p in /proc/[0-9]*; do
		first=$({ tr '\\0' '\\n' < "$p/cmdline"; } 2>/dev/null | head -n 1)
		case "$first" in *"$1") echo "\${p##*/}" ;; esac
	done
}
`;

// The hotspot with wpa_supplicant. Env: OMNI_CARD, OMNI_SSID, OMNI_PSK,
// OMNI_ROUND (seconds), OMNI_ALONGSIDE ("1" when the radio can run a
// network alongside a connection).
const HOTSPOT_WPA = `
T=${networkHelper.TOOLS}
${FIND_PROCESS}
wpa=$(find_process wpa_supplicant | head -n 1)
AP=omni0
[ "$OMNI_ALONGSIDE" = 1 ] || AP=$OMNI_CARD

# Everything put back as it was, whenever the round ends: on time, when
# OmniCore asks (SIGTERM), or when something didn't work
undo() {
	trap - TERM INT
	[ -n "$dhcp" ] && kill "$dhcp" 2>/dev/null
	[ -n "$ap" ] && kill "$ap" 2>/dev/null
	sleep 1
	if [ "$OMNI_ALONGSIDE" = 1 ]; then
		[ -e "/sys/class/net/$AP" ] && chroot "$T" iw dev "$AP" del
	else
		ip addr flush dev "$OMNI_CARD" 2>/dev/null
		ip link set "$OMNI_CARD" down
		chroot "$T" iw dev "$OMNI_CARD" set type managed
		ip link set "$OMNI_CARD" up
	fi
	if [ -n "$wpa" ]; then kill -CONT "$wpa"; kill -HUP "$wpa"; fi
	echo "@@ stopped"
	exit 0
}
trap undo TERM INT

# wpa_supplicant waits, so it doesn't fight over the card
[ -n "$wpa" ] && kill -STOP "$wpa"

if [ "$OMNI_ALONGSIDE" = 1 ]; then
	mac=$(cat "/sys/class/net/$OMNI_CARD/address")
	chroot "$T" iw dev "$OMNI_CARD" interface add "$AP" type __ap || { echo "@@ failed interface"; undo; }
	# Its own address, the card's with the first part changed
	ip link set "$AP" address "02:\${mac#*:}" 2>/dev/null
else
	ip link set "$AP" down
	chroot "$T" iw dev "$AP" set type __ap || { echo "@@ failed mode"; undo; }
fi
ip link set "$AP" up
ip addr add 10.42.0.1/24 dev "$AP"

cat > "$T/tmp/omni-hostapd.conf" <<CONF
interface=$AP
driver=nl80211
ssid=$OMNI_SSID
hw_mode=g
channel=6
auth_algs=1
wpa=2
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
wpa_passphrase=$OMNI_PSK
CONF
chroot "$T" hostapd /tmp/omni-hostapd.conf > /tmp/hostapd.log 2>&1 &
ap=$!
# Addresses for whoever joins; no DNS (--port=0)
chroot "$T" dnsmasq --keep-in-foreground --user=root --port=0 --interface="$AP" --bind-interfaces --except-interface=lo --dhcp-range=10.42.0.10,10.42.0.60,255.255.255.0,10m --dhcp-leasefile=/tmp/omni.leases --conf-file=/dev/null > /tmp/dnsmasq.log 2>&1 &
dhcp=$!

# hostapd says AP-ENABLED once the network is up
i=0
while [ $i -lt 20 ]; do
	grep -q AP-ENABLED /tmp/hostapd.log && break
	kill -0 "$ap" 2>/dev/null || break
	i=$((i + 1))
	sleep 1
done
if ! grep -q AP-ENABLED /tmp/hostapd.log; then
	echo "@@ failed hostapd"
	tail -n 5 /tmp/hostapd.log
	undo
elif ! kill -0 "$dhcp" 2>/dev/null; then
	# dnsmasq stopped: something else on the server hands out addresses
	# on this port already. Without addresses a phone can't reach us.
	echo "@@ failed dnsmasq"
	tail -n 5 /tmp/dnsmasq.log
	undo
else
	echo "@@ ready"
fi

sleep "$OMNI_ROUND" & wait $!
undo
`;

// The hotspot with NetworkManager. Env: OMNI_CARD, OMNI_SSID, OMNI_PSK,
// OMNI_ROUND.
const HOTSPOT_NM = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
nm() { timeout 60 chroot ${networkHelper.TOOLS} nmcli "$@" 2>&1; }
undo() {
	trap - TERM INT
	nm connection down omnicore-hotspot >/dev/null
	nm connection delete omnicore-hotspot >/dev/null
	echo "@@ stopped"
	exit 0
}
trap undo TERM INT
nm connection delete omnicore-hotspot >/dev/null 2>&1
if nm device wifi hotspot ifname "$OMNI_CARD" con-name omnicore-hotspot ssid "$OMNI_SSID" password "$OMNI_PSK" >/dev/null; then
	echo "@@ ready"
else
	echo "@@ failed nmcli"
	undo
fi
sleep "$OMNI_ROUND" & wait $!
undo
`;

// Putting things back after a hotspot, whatever state it left them in.
// Safe to run any number of times. Env: OMNI_CARD.
const RESTORE_WPA = `
T=${networkHelper.TOOLS}
${FIND_PROCESS}
[ -e /sys/class/net/omni0 ] && chroot "$T" iw dev omni0 del
if chroot "$T" iw dev "$OMNI_CARD" info 2>/dev/null | grep -q "type AP"; then
	ip addr flush dev "$OMNI_CARD" 2>/dev/null
	ip link set "$OMNI_CARD" down
	chroot "$T" iw dev "$OMNI_CARD" set type managed
	ip link set "$OMNI_CARD" up
fi
for pid in $(find_process hostapd) $(find_process dnsmasq); do
	case "$({ tr '\\0' ' ' < "/proc/$pid/cmdline"; } 2>/dev/null)" in
		*omni-hostapd.conf*|*omni.leases*) kill "$pid" ;;
	esac
done
wpa=$(find_process wpa_supplicant | head -n 1)
if [ -n "$wpa" ]; then kill -CONT "$wpa"; kill -HUP "$wpa"; fi
echo "@@ result restored"
`;

const RESTORE_NM = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
timeout 30 chroot ${networkHelper.TOOLS} nmcli connection delete omnicore-hotspot >/dev/null 2>&1
echo "@@ result restored"
`;

// ---------------------------------------------------------------------
// The controller

// What the setup page shows:
//   "omnisync"  the QR code (and Set up manually)
//   "starting"  the hotspot is coming up
//   "resting"   between rounds: the old network gets its chance
//   "joining"   OmniSync sent a network and it's being joined
//   "manual"    Manual Setup
//   "off"       the Wi-Fi isn't disconnected: nothing to set up
function createController(deps = {}) {
	const helper = deps.helper || networkHelper;
	const status = deps.status || networkStatus;
	const target = deps.target || (() => require("./network-setup").whatWeCanChange());
	const capable = deps.capable || (async (card) => {
		const found = await helper.probe({ fresh: true });
		const wifi = found.available ? (found.wifi || []).find((one) => one.name === card) : null;
		return wifi ? wifi.hotspot : { capable: false, alongside: false };
	});
	const join = deps.join || ((network, report) => require("./network-setup").connect(network, report));
	const restMs = deps.restMs ?? REST_MS;
	const roundSeconds = deps.roundSeconds ?? ROUND_SECONDS;

	let mode = "off";
	let session = null;
	let qrSvg = null;
	let running = null; // the hotspot helper: { finished, stop }
	let where = null; // { manager, card, config } for this outage
	let manual = false;
	let joining = false;
	let resting = null;
	let generation = 0; // which outage, so late callbacks from an old one do nothing

	function setMode(next) {
		if (mode === next) return;
		mode = next;
		status.broadcastMode(next);
	}

	async function restore() {
		if (!where || where.problem) return;
		const script = where.manager === "networkmanager" ? RESTORE_NM : RESTORE_WPA;
		await helper.runOnHost(script, { env: { OMNI_CARD: where.card } }).catch(() => {});
	}

	// The hotspot ended (on time, stopped, or failed): put things back, and
	// unless something else is happening, give the old network its minute
	async function roundEnded(mine) {
		running = null;
		session = null;
		qrSvg = null;
		await restore();
		if (mine !== generation || manual || joining || mode === "off") return;
		setMode("resting");
		clearTimeout(resting);
		resting = setTimeout(() => {
			if (mine === generation && !manual && !joining && mode === "resting") startRound(mine);
		}, restMs);
		if (resting.unref) resting.unref();
	}

	async function startRound(mine) {
		if (running || manual || joining || mine !== generation) return;
		setMode("starting");
		session = omnisync.createSession();
		qrSvg = qr.toSvg(omnisync.qrText(session));
		const env = {
			OMNI_CARD: where.card,
			OMNI_SSID: session.ssid,
			OMNI_PSK: session.password,
			OMNI_ROUND: String(roundSeconds),
			OMNI_ALONGSIDE: where.alongside ? "1" : "0"
		};
		let failed = false;
		try {
			running = await helper.startOnHost(where.manager === "networkmanager" ? HOTSPOT_NM : HOTSPOT_WPA, {
				purpose: "hotspot",
				env,
				onLine: (line) => {
					if (mine !== generation) return;
					if (line.startsWith("@@ ready") && !manual && !joining) setMode("omnisync");
					if (line.startsWith("@@ failed")) failed = true;
				}
			});
		} catch (error) {
			running = null;
			failed = true;
		}
		if (!running) {
			// It couldn't even start: Manual Setup, then
			manual = true;
			setMode("manual");
			return;
		}
		running.finished.then(() => {
			if (failed && mine === generation && !joining) {
				// The hotspot didn't come up: Manual Setup, not another try
				manual = true;
				running = null;
				session = null;
				restore().then(() => setMode("manual"));
				return;
			}
			roundEnded(mine);
		});
	}

	// The Wi-Fi was disconnected: OmniSync first, if the card can
	async function begin() {
		const mine = ++generation;
		manual = false;
		joining = false;
		where = await target().catch(() => ({ problem: "unknown" }));
		if (mine !== generation) return;
		if (where.problem) {
			setMode("manual");
			return;
		}
		const radio = await capable(where.card).catch(() => ({ capable: false }));
		if (mine !== generation) return;
		if (!radio || !radio.capable) {
			setMode("manual");
			return;
		}
		where.alongside = Boolean(radio.alongside);
		await startRound(mine);
	}

	// The Wi-Fi is back (or only the internet is missing): no setup
	async function end() {
		generation++;
		manual = false;
		joining = false;
		clearTimeout(resting);
		setMode("off");
		if (running) await running.stop();
		else if (session) await restore();
	}

	// "Set up manually": the hotspot off, then Manual Setup
	async function chooseManual() {
		if (mode === "off") return false;
		manual = true;
		clearTimeout(resting);
		if (running) await running.stop();
		setMode("manual");
		return true;
	}

	// OmniSync sent the home Wi-Fi: read it, hotspot off, join it. Throws
	// (with .status) if there's nothing waiting for it or it doesn't read.
	async function omnisyncReply(body) {
		if (mode !== "omnisync" || !session) {
			throw Object.assign(new Error("OmniSync setup isn't waiting for anything."), { status: 409 });
		}
		let network;
		try {
			network = omnisync.readReply(session, body);
		} catch (error) {
			throw Object.assign(new Error(error.message), { status: 400 });
		}
		if (!network.auth) network.auth = network.password ? "psk" : "open";
		const problem = require("./network-setup").problemWith(network);
		if (problem) {
			// Read, but not a network that can be joined (a password too
			// short, say): OmniSync may fix it and send again this round
			session.used = false;
			throw Object.assign(new Error(problem), { status: 400 });
		}

		// Answered at once; the hotspot (and the phone with it) goes away next
		const mine = generation;
		joining = true;
		setMode("joining");
		setImmediate(async () => {
			if (running) await running.stop();
			const outcome = await join(network, (step) => status.broadcastSetup(step)).catch(() => ({ ok: false }));
			joining = false;
			if (!outcome.ok && mine === generation && mode !== "off") startRound(mine);
		});
		return { accepted: true };
	}

	function onState(state) {
		if (state === "disconnected") {
			if (mode === "off") begin();
		} else if (mode !== "off") {
			end();
		}
	}

	return {
		onState,
		begin,
		end,
		chooseManual,
		omnisyncReply,
		mode: () => mode,
		qr: () => (mode === "omnisync" ? qrSvg : null),
		session: () => session
	};
}

let controller = null;

function current() {
	if (!controller) controller = createController();
	return controller;
}

// Started with the watcher: listens to the network's state, and first
// clears away a hotspot left over from an OmniCore that stopped mid-round
async function start() {
	const control = module.exports.current();
	networkStatus.onState((state) => control.onState(state));
	try {
		const leftovers = await networkHelper.removeLeftovers("hotspot");
		if (leftovers) {
			const where = await require("./network-setup").whatWeCanChange();
			if (!where.problem) {
				await networkHelper.runOnHost(where.manager === "networkmanager" ? RESTORE_NM : RESTORE_WPA, { env: { OMNI_CARD: where.card } });
			}
			console.log("Removed a setup hotspot left from before, and put the Wi-Fi back");
		}
	} catch (error) {
		// No Docker: no hotspot was ever possible either
	}
}

// --- Routes, on the admin face (network-setup.js attaches them) -----------

function attach(app, express) {
	app.get(MODE_PATH, (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const control = module.exports.current();
		if (networkStatus.state() !== "disconnected") {
			res.status(409).json({ mode: "off" });
			return;
		}
		res.json({ mode: control.mode(), qr: control.qr() });
	});

	app.post(MANUAL_PATH, express.json({ limit: "1kb" }), async (req, res) => {
		if (!req.is("application/json")) {
			res.status(415).json({ error: "Send this as JSON." });
			return;
		}
		if (networkStatus.state() !== "disconnected") {
			res.status(409).json({ error: "Manual Setup is only open while the Wi-Fi is disconnected." });
			return;
		}
		await module.exports.current().chooseManual();
		res.json({ mode: module.exports.current().mode() });
	});

	app.post(OMNISYNC_PATH, express.json({ limit: "8kb" }), async (req, res) => {
		if (!req.is("application/json")) {
			res.status(415).json({ error: "Send this as JSON." });
			return;
		}
		if (networkStatus.state() !== "disconnected") {
			res.status(409).json({ error: "OmniSync setup is only open while the Wi-Fi is disconnected." });
			return;
		}
		try {
			res.status(202).json(await module.exports.current().omnisyncReply(req.body));
		} catch (error) {
			res.status(error.status || 500).json({ error: error.message });
		}
	});
}

module.exports = {
	ROUND_SECONDS,
	REST_MS,
	MODE_PATH,
	MANUAL_PATH,
	OMNISYNC_PATH,
	HOTSPOT_WPA,
	HOTSPOT_NM,
	RESTORE_WPA,
	RESTORE_NM,
	createController,
	current,
	start,
	attach
};
