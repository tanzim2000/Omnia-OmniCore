// core/network-setup.js
// Manual Setup (since 2.0.0): joining a Wi-Fi network from the takeover,
// typed on a keyboard at the server's own screen.
//
// WHEN IT'S OPEN
//
// Only while the Wi-Fi is disconnected (network-watcher.js said so). Then
// nothing else can reach the server, so the only one who can use it is
// whoever is standing at its screen. Any other time, every route here
// answers 409 and changes nothing. That's what stands in for signing in.
//
// WHERE IT'S DRAWN
//
// The takeover is on every face, a theme's pages too, and a theme's
// JavaScript isn't trusted: a password box drawn into its page could be
// read by it. So Manual Setup is a page of its own, served by the admin
// face (port 3000) at /omnicore-network/setup, and the takeover shows it
// in a frame. A different port is a different origin to the browser: the
// theme can't see into the frame, or the keys typed in it.
//
// HOW A NETWORK IS JOINED, SAFELY
//
//   1. Look at the Wi-Fi again (network-helper.js): who looks after it,
//      which card, where its settings are.
//   2. Change it (the helpers below):
//        wpa_supplicant: its settings file gets the new network (any
//          older entry for the same name taken out), the file as it was is
//          kept beside it (.omnicore-before), and wpa_supplicant is told
//          to read it again (SIGHUP). The password is stored the way
//          wpa_passphrase stores it: as the key worked out from it, not
//          as typed (except WPA3-only networks, which need the password
//          itself).
//        NetworkManager: a connection of its own (omnicore-<name>), and
//          `nmcli connection up` it.
//   3. Wait up to a minute for the internet. With wpa_supplicant, once the
//      card has joined the network, the DHCP client is nudged (udhcpc:
//      release, then renew) so the server gets an address on it.
//   4. Online: keep it (the copy of the old file is removed), and keep the
//      password, encrypted, for the Guest Wi-Fi widget (network-passwords.js).
//      Not online within the minute: put everything back as it was, and
//      keep nothing.
//
// WHICH NETWORK WINS (since 2.0.0, set by OmniCore, not by hand)
//
// Every network that joins automatically ("Join automatically" on, the default)
// gets the same priority, AUTO_PRIORITY, so when several are around the
// server picks the one with the strongest signal. A network with "Join by
// itself" off is never joined automatically (wpa_supplicant's disabled=1;
// NetworkManager's autoconnect no). The one network being joined gets
// TRY_PRIORITY, above all the others, only while it's being tried; once it
// works its priority is written back to the ordinary one, without telling
// wpa_supplicant (so it stays on the network it was just asked to join
// until the next time it reads its settings).
//
// A CHECK, NOT A SWITCH (the Guest Wi-Fi widget)
//
// connect() with `check: true` joins a network only to make sure its
// password works: as soon as the card has joined it (no internet needed,
// a guest network may keep the server off it), the network is kept with
// "Join automatically" off and the server goes back to the networks it
// joins automatically.
//
// Every step is reported to the setup page as it happens ("setup" events
// on the network stream).

const crypto = require("crypto");
const path = require("path");
const express = require("express");

const networkHelper = require("./network-helper");
const networkStatus = require("./network-status");
const theme = require("./ui-theme");

const TRY_FOR_MS = 60 * 1000;
const LOOK_EVERY_MS = 3000;

const SETUP_PATH = "/omnicore-network/setup";
const NEARBY_PATH = "/omnicore-network/nearby";
const CONNECT_PATH = "/omnicore-network/connect";

// ---------------------------------------------------------------------
// The new network, written down

function toHex(text) {
	return Buffer.from(String(text), "utf-8").toString("hex");
}

// What wpa_passphrase works out from a WPA/WPA2 password: the 256-bit key
// itself (PBKDF2 with HMAC-SHA1, the network's name as the salt, 4096
// rounds). Stored instead of the password, so the settings file never
// holds what was typed.
function wpaKey(password, ssid) {
	return crypto.pbkdf2Sync(Buffer.from(password, "utf-8"), Buffer.from(ssid, "utf-8"), 4096, 32, "sha1").toString("hex");
}

// What's wrong with what was typed, in words for the screen, or null
function problemWith({ ssid, password, auth }) {
	if (typeof ssid !== "string" || !ssid.length || Buffer.byteLength(ssid, "utf-8") > 32) {
		return "Choose a network.";
	}
	if (!["open", "psk", "sae"].includes(auth)) {
		return "OmniCore can't join this kind of network yet.";
	}
	if (auth === "open") return null;
	if (typeof password !== "string" || !password.length) return "Type the network's password.";
	if (auth === "psk") {
		if (/^[0-9a-fA-F]{64}$/.test(password)) return null;
		if (password.length < 8 || password.length > 63 || !/^[\x20-\x7e]+$/.test(password)) {
			return "A Wi-Fi password is 8 to 63 letters, numbers and symbols.";
		}
		return null;
	}
	// WPA3-only: kept as typed, in quotes, so no quotes or line breaks
	if (password.length > 128 || /["\r\n\\]/.test(password)) {
		return "This password has a character OmniCore can't store for a WPA3 network.";
	}
	return null;
}

// The network block for wpa_supplicant's settings file. The name is
// written in hex, so no name can break the file however it's spelt.
function wpaBlock({ ssid, password, auth }) {
	const lines = ["# Added by OmniCore", "network={", `\tssid=${toHex(ssid)}`];
	if (auth === "open") {
		lines.push("\tkey_mgmt=NONE");
	} else if (auth === "psk") {
		const key = /^[0-9a-fA-F]{64}$/.test(password) ? password.toLowerCase() : wpaKey(password, ssid);
		lines.push(`\tpsk=${key}`);
	} else {
		lines.push("\tkey_mgmt=SAE", `\tsae_password="${password}"`, "\tieee80211w=2");
	}
	// Above any network the file has: this is the one asked for. The
	// script puts the number in (one more than the highest it finds, and
	// at least 50), so a network joined later always wins over one joined
	// earlier, even when the server is still on that one.
	lines.push(`\tpriority=${PRIORITY_MARK}`, "}");
	return lines.join("\n");
}

// Where the script writes the priority in (see wpaBlock)
const PRIORITY_MARK = "OMNICORE_PRIORITY";

// Every network that joins automatically, and the one being tried, above it
const AUTO_PRIORITY = 50;
const TRY_PRIORITY = 99;

// NetworkManager's name for the connection OmniCore makes for a network
function nmName(ssid) {
	return `omnicore-${toHex(ssid).slice(0, 24)}`;
}

// ---------------------------------------------------------------------
// The scripts the helper runs for it

// The programs' process IDs come from /proc (the helper sees the host's
// processes); the first word of a command line is checked, so the
// script's own command line, which names them, never counts.
const FIND_PROCESS = `
find_process() {
	for p in /proc/[0-9]*; do
		first=$({ tr '\\0' '\\n' < "$p/cmdline"; } 2>/dev/null | head -n 1)
		case "$first" in *"$1") echo "\${p##*/}" ;; esac
	done
}
`;

// An awk command that copies a wpa_supplicant settings file without any
// network named $OMNI_SSID_HEX (the name in hex) or $OMNI_SSID_QUOTED (in
// quotes, the way a file written by hand has it), and without the note
// OmniCore left above one. Joining uses it before adding the network
// again, and the Network page to forget one (network-page.js).
const DROP_NAMED = `awk -v hexname="$OMNI_SSID_HEX" -v quoted="$OMNI_SSID_QUOTED" '
	function close_block() {
		if (!(name == hexname || (quoted != "" && name == quoted))) printf "%s", note block
		block = ""; note = ""; name = ""; inside = 0
	}
	!inside && $0 == "# Added by OmniCore" { note = $0 "\\n"; next }
	!inside && /^[[:space:]]*network[[:space:]]*=[[:space:]]*\\{/ { inside = 1; block = $0 "\\n"; next }
	inside {
		block = block $0 "\\n"
		if ($0 ~ /^[[:space:]]*ssid[[:space:]]*=/) {
			value = $0
			sub(/^[[:space:]]*ssid[[:space:]]*=[[:space:]]*/, "", value)
			sub(/[[:space:]]+$/, "", value)
			name = (tolower(value) == hexname) ? hexname : value
		}
		if ($0 ~ /^[[:space:]]*}/) close_block()
		next
	}
	{ printf "%s", note; note = ""; print }
	END { if (inside) printf "%s", note block }
'`;

// An awk command that copies a wpa_supplicant settings file with the
// priorities OmniCore keeps: the network named $OMNI_SSID_HEX (or
// $OMNI_SSID_QUOTED) set by $OMNI_MODE, and every other network that joins
// automatically given the ordinary priority. A network with disabled=1
// ("Join automatically" off) is left as it is, unless it's the one named.
//
//   try      the network being joined: above all the others
//   auto     joins automatically: the ordinary priority, never disabled
//   manual   never joined automatically: disabled=1
//   leave    the named network as it is (only the others are tidied)
const SET_FLAGS = `awk -v hexname="$OMNI_SSID_HEX" -v quoted="$OMNI_SSID_QUOTED" -v mode="$OMNI_MODE" '
	function flush(   i, disabled, want) {
		disabled = 0
		for (i = 1; i <= count; i++) if (lines[i] ~ /^[[:space:]]*disabled[[:space:]]*=[[:space:]]*1/) disabled = 1
		if (name == hexname || (quoted != "" && name == quoted)) {
			want = (mode == "try") ? "priority=${TRY_PRIORITY}" : (mode == "auto") ? "priority=${AUTO_PRIORITY}" : (mode == "manual") ? "manual" : "leave"
		} else {
			want = disabled ? "leave" : "priority=${AUTO_PRIORITY}"
		}
		for (i = 1; i < count; i++) {
			if (want != "leave" && (lines[i] ~ /^[[:space:]]*priority[[:space:]]*=/ || lines[i] ~ /^[[:space:]]*disabled[[:space:]]*=/)) continue
			print lines[i]
		}
		if (want == "manual") { print "\tpriority=0"; print "\tdisabled=1" }
		else if (want != "leave") print "\t" want
		print lines[count]
		count = 0; name = ""; inside = 0
	}
	!inside && /^[[:space:]]*network[[:space:]]*=[[:space:]]*\\{/ { inside = 1; count = 0; lines[++count] = $0; next }
	inside {
		lines[++count] = $0
		if ($0 ~ /^[[:space:]]*ssid[[:space:]]*=/) {
			value = $0
			sub(/^[[:space:]]*ssid[[:space:]]*=[[:space:]]*/, "", value)
			sub(/[[:space:]]+$/, "", value)
			name = (tolower(value) == hexname) ? hexname : value
		}
		if ($0 ~ /^[[:space:]]*}/) flush()
		next
	}
	{ print }
	END { if (inside) for (i = 1; i <= count; i++) print lines[i] }
'`;

const WPA_APPLY = `
H=${networkHelper.HOST}
f="$H$OMNI_CONF"
before="$f.omnicore-before"
${FIND_PROCESS}
if [ ! -w "$f" ]; then echo "@@ result cant-write"; exit 0; fi
cp -p "$f" "$before" || { echo "@@ result cant-write"; exit 0; }

# The file without any network that has the same name, then the new one
${DROP_NAMED} "$before" > "$f.omnicore-new" || { rm -f "$f.omnicore-new" "$before"; echo "@@ result cant-write"; exit 0; }

# The new network, above every other one while it's tried; the others that
# join automatically all at the ordinary priority
printf '\\n%s\\n' "$(echo "$OMNI_BLOCK" | base64 -d | sed "s/^\\([[:space:]]*priority=\\)${PRIORITY_MARK}\\$/\\1${TRY_PRIORITY}/")" >> "$f.omnicore-new"
OMNI_MODE=try ${SET_FLAGS} "$f.omnicore-new" > "$f.omnicore-flags" || { rm -f "$f.omnicore-new" "$f.omnicore-flags" "$before"; echo "@@ result cant-write"; exit 0; }
rm -f "$f.omnicore-new"
chmod "$(stat -c %a "$before")" "$f.omnicore-flags"
mv "$f.omnicore-flags" "$f"

pid=$(find_process wpa_supplicant | head -n 1)
if [ -z "$pid" ]; then echo "@@ result no-process"; exit 0; fi
kill -HUP "$pid" && echo "@@ result applied"
`;

// It worked: the network's priority written back to the ordinary one
// ($OMNI_MODE auto) or "Join automatically" off ($OMNI_MODE manual), and the copy
// of the old file removed. wpa_supplicant is told only with $OMNI_RELOAD=1
// (a check, which then goes back to the networks it joins automatically);
// otherwise it stays on the network it just joined.
const WPA_KEEP = `
f="${networkHelper.HOST}$OMNI_CONF"
${FIND_PROCESS}
if ${SET_FLAGS} "$f" > "$f.omnicore-flags"; then
	chmod "$(stat -c %a "$f")" "$f.omnicore-flags"
	mv "$f.omnicore-flags" "$f"
else
	rm -f "$f.omnicore-flags"
fi
rm -f "$f.omnicore-before"
if [ "$OMNI_RELOAD" = 1 ]; then
	pid=$(find_process wpa_supplicant | head -n 1)
	[ -n "$pid" ] && kill -HUP "$pid"
fi
echo "@@ result kept"
`;

const WPA_UNDO = `
H=${networkHelper.HOST}
f="$H$OMNI_CONF"
${FIND_PROCESS}
if [ -f "$f.omnicore-before" ]; then
	mv "$f.omnicore-before" "$f"
	pid=$(find_process wpa_supplicant | head -n 1)
	[ -n "$pid" ] && kill -HUP "$pid"
	echo "@@ result undone"
else
	echo "@@ result nothing"
fi
`;

// The DHCP client for this card, told to let go of the old address and
// ask for a new one (busybox's udhcpc: SIGUSR2 releases, SIGUSR1 renews).
// dhcpcd and NetworkManager notice the new network by themselves.
const NUDGE_DHCP = `
for p in /proc/[0-9]*; do
	first=$({ tr '\\0' '\\n' < "$p/cmdline"; } 2>/dev/null | head -n 1)
	case "$first" in *udhcpc) ;; *) continue ;; esac
	line=" $({ tr '\\0' ' ' < "$p/cmdline"; } 2>/dev/null) "
	case "$line" in
		*" -i $OMNI_CARD "*|*" -i$OMNI_CARD "*|*"--interface=$OMNI_CARD "*)
			kill -USR2 "\${p##*/}"; sleep 1; kill -USR1 "\${p##*/}"; echo "@@ result nudged" ;;
	esac
done
`;

const LINK = `
timeout 8 chroot ${networkHelper.TOOLS} iw dev "$OMNI_CARD" link 2>&1
`;

const NM_APPLY = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
nm() { timeout 60 chroot ${networkHelper.TOOLS} nmcli "$@" 2>&1; }
nm connection delete "$OMNI_NAME" >/dev/null 2>&1
# "Join automatically" ($OMNI_AUTO yes or no), at the ordinary priority (0)
auto="\${OMNI_AUTO:-yes}"
case "$OMNI_AUTH" in
	open) nm connection add type wifi ifname "$OMNI_CARD" con-name "$OMNI_NAME" ssid "$OMNI_SSID" connection.autoconnect "$auto" >/dev/null ;;
	psk) nm connection add type wifi ifname "$OMNI_CARD" con-name "$OMNI_NAME" ssid "$OMNI_SSID" connection.autoconnect "$auto" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$OMNI_KEY" >/dev/null ;;
	sae) nm connection add type wifi ifname "$OMNI_CARD" con-name "$OMNI_NAME" ssid "$OMNI_SSID" connection.autoconnect "$auto" wifi-sec.key-mgmt sae wifi-sec.psk "$OMNI_KEY" >/dev/null ;;
esac || { echo "@@ result cant-write"; exit 0; }
if nm --wait 45 connection up "$OMNI_NAME" >/dev/null; then echo "@@ result applied"; else echo "@@ result failed"; fi
`;

// Which connection the card is on now ("@@ active <uuid>"), so a check can
// go back to it
const NM_ACTIVE = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
echo "@@ active $(timeout 15 chroot ${networkHelper.TOOLS} nmcli -g GENERAL.CON-UUID device show "$OMNI_CARD" 2>/dev/null)"
`;

// After a check: back to the connection the card was on ($OMNI_PREV), or
// whichever NetworkManager picks
const NM_RETURN = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
nm() { timeout 60 chroot ${networkHelper.TOOLS} nmcli "$@" 2>&1; }
if [ -n "$OMNI_PREV" ] && nm --wait 45 connection up uuid "$OMNI_PREV" >/dev/null; then echo "@@ result back"
elif nm --wait 45 device connect "$OMNI_CARD" >/dev/null; then echo "@@ result back"
else echo "@@ result not-back"; fi
`;

const NM_UNDO = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
timeout 30 chroot ${networkHelper.TOOLS} nmcli connection delete "$OMNI_NAME" >/dev/null 2>&1
echo "@@ result undone"
`;

// A fresh look around (not just what the card last saw). wpa_supplicant
// may be busy scanning itself; then what it already found will do.
function scanScript(card, manager) {
	if (manager === "networkmanager") {
		return `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
timeout 20 chroot ${networkHelper.TOOLS} nmcli --wait 15 device wifi rescan ifname "${card}" >/dev/null 2>&1
echo "@@ nearby ${card}"
timeout 20 chroot ${networkHelper.TOOLS} iw dev "${card}" scan dump 2>/dev/null | grep -E '^BSS |^[[:space:]]+(freq|signal|SSID|RSN|WPA|capability|\\* Authentication suites):'
`;
	}
	return `
echo "@@ nearby ${card}"
out=$(timeout 20 chroot ${networkHelper.TOOLS} iw dev "${card}" scan 2>/dev/null)
[ -n "$out" ] || out=$(timeout 10 chroot ${networkHelper.TOOLS} iw dev "${card}" scan dump 2>/dev/null)
echo "$out" | grep -E '^BSS |^[[:space:]]+(freq|signal|SSID|RSN|WPA|capability|\\* Authentication suites):'
`;
}

function result(output) {
	const match = String(output).match(/@@ result (\S+)/);
	return match ? match[1] : null;
}

// ---------------------------------------------------------------------
// Doing it

// Who looks after the Wi-Fi, which card, and where its settings are; or
// why OmniCore can't change anything here, in words for the screen.
// `found` is what the helper's probe found (network-helper.js).
//
// A problem is `lasting` when looking again won't change it (no Docker,
// no tools, a Wi-Fi OmniCore can't drive): the Network box on the
// Resources tab then says so instead of leading anywhere. A helper that
// failed once isn't lasting.
function changeable(found) {
	if (!found.available) {
		if (found.reason === "no-docker") {
			return { problem: "OmniCore can't change the server's Wi-Fi: it has no access to Docker.", lasting: true };
		}
		if (found.reason === "no-tools") {
			return { problem: "This OmniCore can't change the server's Wi-Fi: it wasn't built with the Wi-Fi tools.", lasting: true };
		}
		return { problem: "OmniCore couldn't look at the server's Wi-Fi. Try again in a moment.", lasting: false };
	}
	if (!found.supported) {
		return { problem: "OmniCore can't change the Wi-Fi on this server: something other than wpa_supplicant or NetworkManager looks after it.", lasting: true };
	}
	const card = (found.wpa && found.wifi.find((wifi) => wifi.name === found.wpa.interface)) || found.wifi[0];
	if (!card) return { problem: "This server has no Wi-Fi card OmniCore can see.", lasting: true };
	if (found.manager === "wpa_supplicant") {
		const config = found.wpa && found.wpa.config;
		if (!config || !found.wpa.readable || !/^\/[\w./-]+$/.test(config) || config.includes("..")) {
			return { problem: "OmniCore can't find wpa_supplicant's settings file on this server.", lasting: true };
		}
		return { manager: "wpa_supplicant", card: card.name, config };
	}
	return { manager: "networkmanager", card: card.name };
}

// The same, from a fresh look. The Network page passes { fresh: false }
// when it has only just looked (the helper keeps a look for 5 seconds).
async function whatWeCanChange(options = {}) {
	return changeable(await networkHelper.probe({ fresh: options.fresh !== false }));
}

// The networks around, for the setup page
async function scan(options = {}) {
	const target = await (options.target || whatWeCanChange)();
	if (target.problem) return { available: false, message: target.problem };
	const output = await (options.run || networkHelper.runOnHost)(scanScript(target.card, target.manager), { timeoutMs: 40000 });
	const lines = output.replace(/\r/g, "").split("\n");
	const start = lines.findIndex((line) => line.startsWith("@@ nearby"));
	const networks = networkHelper.parseNearby(start === -1 ? [] : lines.slice(start + 1)).map((network) => ({
		ssid: network.ssid,
		bars: network.bars,
		band: network.band,
		security: network.security,
		auth: network.auth
	}));
	return { available: true, networks };
}

let attempt = null;

// Whether a network is being joined right now. The watcher holds its
// tongue meanwhile: the Wi-Fi drops for a moment while it switches.
function busy() {
	return attempt !== null;
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// A network that was joined: its password saved, encrypted, and the
// widget told which network the server is on now (network-passwords.js)
function savePassword(network, options = {}) {
	const passwords = require("./network-passwords");
	passwords.save(network.ssid, network.password || "", network.auth);
	if (options.current !== false) passwords.noteCurrent(network.ssid);
}

// Join a network, or put everything back. `report` is told each step:
// { phase: "connecting" | "joined" | "connected" | "checked" | "failed",
// ssid, message }. `deps` is for the tests.
//
// `network` is { ssid, password, auth }, and may also have:
//
//   auto: false   "Join automatically" off once it's kept (on by default)
//   check: true   only make sure the password works (see the top): kept
//                 with "Join automatically" off, then back to the networks the
//                 server joins automatically; "checked" instead of "connected"
async function connect(network, report, deps = {}) {
	const problem = problemWith(network);
	if (problem) throw Object.assign(new Error(problem), { status: 400 });
	if (attempt) throw Object.assign(new Error("OmniCore is already joining a network."), { status: 409 });

	const run = deps.run || networkHelper.runOnHost;
	const online = deps.internetWorks || require("./network-watcher").internetWorks;
	const now = deps.now || (() => Date.now());
	const pause = deps.wait || wait;
	const tryFor = deps.tryForMs || TRY_FOR_MS;
	const say = (phase, message) => report({ phase, ssid: network.ssid, message: message || null });
	const check = network.check === true;
	// A check never joins automatically afterwards: the server stays on its own
	const auto = check ? false : network.auto !== false;

	attempt = network.ssid;
	try {
		const target = await (deps.target || whatWeCanChange)();
		if (target.problem) {
			say("failed", target.problem);
			return { ok: false, reason: "cant-change" };
		}
		say("connecting");

		const isWpa = target.manager === "wpa_supplicant";
		const env = isWpa
			? {
				OMNI_CONF: target.config,
				OMNI_SSID_HEX: toHex(network.ssid),
				// The name in quotes, the way a file written by hand has it
				// (only when that's unambiguous)
				OMNI_SSID_QUOTED: /["\\\n]/.test(network.ssid) ? "" : `"${network.ssid}"`,
				OMNI_BLOCK: Buffer.from(wpaBlock(network)).toString("base64"),
				OMNI_CARD: target.card
			}
			: {
				OMNI_CARD: target.card,
				OMNI_SSID: network.ssid,
				OMNI_NAME: nmName(network.ssid),
				OMNI_AUTH: network.auth,
				OMNI_AUTO: auto ? "yes" : "no",
				OMNI_KEY: network.auth === "psk" && !/^[0-9a-fA-F]{64}$/.test(network.password) ? wpaKey(network.password, network.ssid) : network.password || ""
			};
		const writable = isWpa ? [path.posix.dirname(target.config)] : [];
		const helperOptions = { env, writable, timeoutMs: 75000 };

		// A check goes back afterwards: with NetworkManager, to the
		// connection the card is on now
		if (check && !isWpa) {
			const line = String(await run(NM_ACTIVE, helperOptions).catch(() => "")).split("\n").find((l) => l.startsWith("@@ active "));
			const uuid = line ? line.slice("@@ active ".length).trim() : "";
			env.OMNI_PREV = /^[0-9a-fA-F-]{36}$/.test(uuid) ? uuid : "";
		}

		const applied = result(await run(isWpa ? WPA_APPLY : NM_APPLY, helperOptions));
		if (applied !== "applied") {
			if (isWpa) await run(WPA_UNDO, helperOptions).catch(() => {});
			else await run(NM_UNDO, helperOptions).catch(() => {});
			const message =
				applied === "cant-write" ? "OmniCore couldn't change the server's Wi-Fi settings."
				: applied === "no-process" ? "The program that looks after the Wi-Fi isn't running."
				: `Couldn't join ${network.ssid}. Check the password and try again.`;
			say("failed", message);
			return { ok: false, reason: applied || "failed" };
		}

		// It works: the password kept (encrypted) for the Guest Wi-Fi
		// widget. Never in the way of the join itself.
		const remember = () => {
			try {
				(deps.savePassword || savePassword)(network, { current: !check });
			} catch (error) {
				console.log(`Couldn't save the password for ${network.ssid}: ${error.message}`);
			}
		};

		// Wait for the card to join, then (unless it's a check) for the
		// internet, up to a minute
		const until = now() + tryFor;
		let joined = !isWpa;
		if (joined && check) say("joined");
		while (now() < until) {
			if (!joined) {
				await pause(LOOK_EVERY_MS);
				const link = networkHelper.parseLink((await run(LINK, helperOptions)).split("\n"));
				if (link.connected && link.ssid === network.ssid) {
					joined = true;
					say("joined");
					if (!check) await run(NUDGE_DHCP, helperOptions).catch(() => {});
				}
				if (!joined) continue;
			}

			if (check) {
				// The password works. Kept with "Join automatically" off, and
				// back to the networks the server joins automatically.
				env.OMNI_MODE = "manual";
				env.OMNI_RELOAD = "1";
				if (isWpa) await run(WPA_KEEP, helperOptions).catch(() => {});
				else await run(NM_RETURN, helperOptions).catch(() => {});
				remember();
				await comeBack(network, { run, online, now, pause, tryFor, helperOptions, isWpa });
				say("checked");
				const watcher = require("./network-watcher");
				if (watcher.checkNow) watcher.checkNow();
				return { ok: true, checked: true };
			}

			await pause(LOOK_EVERY_MS);
			if (await online()) {
				env.OMNI_MODE = auto ? "auto" : "manual";
				env.OMNI_RELOAD = "0";
				if (isWpa) await run(WPA_KEEP, helperOptions).catch(() => {});
				remember();
				say("connected");
				const watcher = require("./network-watcher");
				if (watcher.checkNow) watcher.checkNow();
				return { ok: true };
			}
		}

		// Not online in time: everything back as it was
		await run(isWpa ? WPA_UNDO : NM_UNDO, helperOptions).catch(() => {});
		say(
			"failed",
			joined
				? `${network.ssid} has no internet, so OmniCore put the old settings back.`
				: `Couldn't join ${network.ssid}. Check the password and try again.`
		);
		return { ok: false, reason: joined ? "no-internet" : "not-joined" };
	} finally {
		attempt = null;
	}
}

// After a check: wait (up to a minute) for the server to be back on one of
// its own networks. With wpa_supplicant, the DHCP client is nudged once the
// card is on another network, so the server gets an address there again.
// Whatever happens, the check is done: the watcher takes it from here.
async function comeBack(network, { run, online, now, pause, tryFor, helperOptions, isWpa }) {
	const until = now() + tryFor;
	let nudged = !isWpa;
	while (now() < until) {
		await pause(LOOK_EVERY_MS);
		if (!nudged) {
			const link = networkHelper.parseLink(String(await run(LINK, helperOptions).catch(() => "")).split("\n"));
			if (link.connected && link.ssid !== network.ssid) {
				nudged = true;
				await run(NUDGE_DHCP, helperOptions).catch(() => {});
			}
		}
		if (nudged && (await online())) return true;
	}
	return false;
}

// ---------------------------------------------------------------------
// The page and its routes, on the admin face (before sign-in: see the top)

function openNow(res) {
	if (networkStatus.state() === "disconnected") return true;
	res.status(409).json({ error: "Manual Setup is only open while the Wi-Fi is disconnected." });
	return false;
}

function attach(app) {
	// OmniSync's routes: which view the page shows, "Set up manually", and
	// the phone's reply (network-hotspot.js)
	require("./network-hotspot").attach(app, express);

	app.get(SETUP_PATH, (req, res) => {
		// Shown in a frame by the takeover on any of this server's faces
		// (any port, same host), and nowhere else
		const host = String(req.hostname || "localhost").replace(/[^\w.:\-[\]]/g, "");
		res.setHeader("Content-Security-Policy", `frame-ancestors 'self' http://${host}:* https://${host}:*`);
		res.setHeader("Cache-Control", "no-store");
		res.send(setupPage());
	});

	app.get(NEARBY_PATH, async (req, res) => {
		if (!openNow(res)) return;
		// Not while the OmniSync hotspot has the card: one thing at a time
		const hotspotMode = require("./network-hotspot").current().mode();
		if (!["manual", "off"].includes(hotspotMode)) {
			res.status(409).json({ available: false, message: "Choose Set up manually first." });
			return;
		}
		res.setHeader("Cache-Control", "no-store");
		try {
			res.json(await module.exports.scan());
		} catch (error) {
			res.json({ available: false, message: "OmniCore couldn't look for networks. Try again." });
		}
	});

	app.post(CONNECT_PATH, express.json({ limit: "4kb" }), async (req, res) => {
		if (!req.is("application/json")) {
			res.status(415).json({ error: "Send this as JSON." });
			return;
		}
		if (!openNow(res)) return;
		const network = {
			ssid: req.body && req.body.ssid,
			password: req.body && req.body.password,
			auth: req.body && req.body.auth
		};
		const problem = problemWith(network);
		if (problem) {
			res.status(400).json({ error: problem });
			return;
		}
		if (attempt) {
			res.status(409).json({ error: "OmniCore is already joining a network." });
			return;
		}
		// Started, and followed on the network stream
		res.status(202).json({ started: true });
		module.exports.connect(network, (step) => networkStatus.broadcastSetup(step)).catch((error) => {
			networkStatus.broadcastSetup({ phase: "failed", ssid: network.ssid, message: error.message });
		});
	});
}

// ---------------------------------------------------------------------
// The page

const LOCK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

// Manual Setup's page, built for each request so it's in the font and
// text size chosen in Settings at the time. Only the central theme's
// elements, in dark (it's always over the takeover's dark glass), with no
// background of its own (html.see-through) so the takeover shows through
// the frame.
function setupPage() {
	return `<!DOCTYPE html>
<html lang="en" class="see-through">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Manual Setup</title>
	${theme.styleTag(theme.uiStyles({ forceMode: "dark" }))}
</head>
<body>
	<section class="form-stack centred" id="omnisync" hidden>
		<h2>Set up with OmniSync</h2>
		<div class="qr-box" id="code" aria-label="A code for OmniSync to scan"></div>
		<div id="waiting" hidden><p class="status" id="waiting-text"></p></div>
		<p class="muted" id="omnisync-text">Open OmniSync on your phone and scan this code. Your phone joins the server for a moment and tells it your Wi&#8209;Fi's name and password.</p>
		<button type="button" class="glass" id="manual">Set up manually</button>
	</section>
	<section class="form-stack" id="manual-view" hidden>
		<div class="box-head">
			<h2>Choose a network</h2>
			<button type="button" class="glass small" id="again">Look again</button>
		</div>
		<div class="list tight" id="list" role="list"></div>
		<form class="form-stack" id="join" hidden autocomplete="off">
			<label for="password" id="join-label">Password</label>
			${theme.passwordField('<input type="password" id="password" autocomplete="off" autocapitalize="off" spellcheck="false">')}
			<p class="hint">Type it on a keyboard connected to this screen.</p>
			<div class="buttons">
				<button type="submit" class="glass" id="go">Connect</button>
				<button type="button" class="glass" id="cancel">Cancel</button>
			</div>
		</form>
	</section>
	<p class="status" id="status" role="status" aria-live="polite"></p>
	<script>
	${theme.PASSWORD_TOGGLE_SCRIPT}
	(function () {
		var list = document.getElementById("list");
		var form = document.getElementById("join");
		var password = document.getElementById("password");
		var status = document.getElementById("status");
		var label = document.getElementById("join-label");
		var chosen = null;
		var busy = false;
		var LOCK = ${JSON.stringify(LOCK_SVG)};

		// The central theme's signal icon: the bars it doesn't have are .off
		function bars(n) {
			var parts = [
				'<circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
				'<path d="M8.7 15.4a5 5 0 0 1 6.6 0"' + (n < 2 ? ' class="off"' : "") + '/>',
				'<path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"' + (n < 3 ? ' class="off"' : "") + '/>',
				'<path d="M2.5 9a14 14 0 0 1 19 0"' + (n < 4 ? ' class="off"' : "") + '/>'
			];
			return '<svg class="signal" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + parts.join("") + "</svg>";
		}

		// The password hidden again, and its Show button saying so
		function hidePassword() {
			password.type = "password";
			var toggle = password.parentElement.querySelector("[data-password-toggle]");
			toggle.textContent = "Show";
			toggle.setAttribute("aria-pressed", "false");
			toggle.setAttribute("aria-label", "Show password");
		}

		function say(text, bad, spinning) {
			status.className = "status" + (bad ? " bad" : "");
			status.innerHTML = spinning ? '<span class="spinner" aria-hidden="true"></span>' : "";
			status.appendChild(document.createTextNode(text || ""));
		}

		function choose(network) {
			chosen = network;
			if (network.auth === "open") {
				join();
				return;
			}
			label.textContent = "Password for " + network.ssid;
			password.value = "";
			hidePassword();
			form.hidden = false;
			list.hidden = true;
			say("");
			password.focus();
		}

		function show(networks) {
			list.innerHTML = "";
			list.hidden = false;
			form.hidden = true;
			if (!networks.length) {
				say("No networks found. Move closer to the router, or look again.");
				return;
			}
			// Each one a row of the central theme's list, the same as the
			// Network page's: the bars and the name, a line under it when
			// it can't be joined, and a lock when it needs a password
			networks.forEach(function (network) {
				var row = document.createElement("button");
				row.type = "button";
				row.className = "font-row item";
				row.setAttribute("role", "listitem");
				var can = network.auth !== "unsupported";
				if (!can) row.setAttribute("aria-disabled", "true");
				var main = document.createElement("span");
				main.className = "item-main";
				main.innerHTML = bars(network.bars);
				var words = document.createElement("span");
				words.className = "item-text";
				var name = document.createElement("span");
				name.textContent = network.ssid;
				words.appendChild(name);
				if (!can) {
					var why = document.createElement("span");
					why.className = "item-sub";
					why.textContent = "OmniCore can't join this kind of network yet";
					words.appendChild(why);
				}
				main.appendChild(words);
				row.appendChild(main);
				var end = document.createElement("span");
				end.className = "item-end";
				end.innerHTML = network.auth === "open" ? "" : LOCK;
				row.appendChild(end);
				row.setAttribute("aria-label", network.ssid + (network.auth === "open" ? ", no password" : ", needs a password") + ", signal " + network.bars + " of 4");
				if (can) row.addEventListener("click", function () { if (!busy) choose(network); });
				list.appendChild(row);
			});
			say("");
		}

		function look() {
			if (busy) return;
			say("Looking for networks\\u2026", false, true);
			list.innerHTML = "";
			form.hidden = true;
			fetch(${JSON.stringify(NEARBY_PATH)}, { cache: "no-store" })
				.then(function (r) { return r.json(); })
				.then(function (found) {
					if (found && found.available) show(found.networks || []);
					else say((found && (found.message || found.error)) || "OmniCore couldn't look for networks.", true);
				})
				.catch(function () { say("OmniCore couldn't look for networks. Try again.", true); });
		}

		function join() {
			if (!chosen || busy) return;
			busy = true;
			var body = { ssid: chosen.ssid, auth: chosen.auth, password: chosen.auth === "open" ? "" : password.value };
			password.value = "";
			form.hidden = true;
			list.hidden = true;
			say("Connecting to " + chosen.ssid + "\\u2026", false, true);
			fetch(${JSON.stringify(CONNECT_PATH)}, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}).then(function (r) {
				if (r.status === 202) return;
				return r.json().then(function (answer) {
					busy = false;
					say((answer && answer.error) || "Couldn't start connecting.", true);
					list.hidden = false;
				});
			}).catch(function () {
				busy = false;
				say("Couldn't start connecting. Try again.", true);
				list.hidden = false;
			});
		}

		// --- Which view: OmniSync first, Manual Setup on request ----------
		var omnisyncView = document.getElementById("omnisync");
		var manualView = document.getElementById("manual-view");
		var code = document.getElementById("code");
		var waiting = document.getElementById("waiting");
		var waitingText = document.getElementById("waiting-text");
		var omnisyncText = document.getElementById("omnisync-text");
		var manualButton = document.getElementById("manual");
		var view = null;

		function showMode(answer) {
			var mode = (answer && answer.mode) || "manual";
			if (mode === "manual" || mode === "off") {
				omnisyncView.hidden = true;
				manualView.hidden = false;
				if (view !== "manual") {
					view = "manual";
					look();
				}
				return;
			}
			view = mode;
			manualView.hidden = true;
			omnisyncView.hidden = false;
			if (mode === "omnisync" && answer.qr) {
				code.innerHTML = answer.qr;
				code.hidden = false;
				waiting.hidden = true;
				omnisyncText.hidden = false;
				manualButton.hidden = false;
				say("");
				return;
			}
			code.hidden = true;
			waiting.hidden = false;
			omnisyncText.hidden = true;
			manualButton.hidden = mode === "joining";
			waitingText.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
			waitingText.appendChild(document.createTextNode(
				mode === "starting" ? "Getting OmniSync ready\u2026"
				: mode === "resting" ? "Looking for a Wi\u2011Fi this server knows\u2026"
				: "Joining your Wi\u2011Fi\u2026"
			));
		}

		function askMode() {
			fetch(${JSON.stringify(require("./network-hotspot").MODE_PATH)}, { cache: "no-store" })
				.then(function (r) { return r.json(); })
				.then(showMode)
				.catch(function () { showMode({ mode: "manual" }); });
		}

		manualButton.addEventListener("click", function () {
			manualButton.disabled = true;
			say("Turning off the OmniSync network\u2026", false, true);
			fetch(${JSON.stringify(require("./network-hotspot").MANUAL_PATH)}, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}"
			}).then(function (r) { return r.json(); })
				.then(function () { manualButton.disabled = false; showMode({ mode: "manual" }); })
				.catch(function () { manualButton.disabled = false; say("Couldn't switch. Try again.", true); });
		});

		document.getElementById("again").addEventListener("click", look);
		document.getElementById("cancel").addEventListener("click", function () {
			password.value = "";
			hidePassword();
			form.hidden = true;
			list.hidden = false;
			say("");
		});
		form.addEventListener("submit", function (event) {
			event.preventDefault();
			join();
		});

		// How joining goes, step by step, from the network stream
		var events = new EventSource(${JSON.stringify(networkStatus.EVENTS_PATH)});
		events.addEventListener("setup-mode", function () { askMode(); });

		// While OmniSync's network is being joined, its steps go in the
		// middle, where the code was; in Manual Setup, under the list
		function sayStep(text, spinning) {
			if (view && view !== "manual") {
				waitingText.innerHTML = spinning ? '<span class="spinner" aria-hidden="true"></span>' : "";
				waitingText.appendChild(document.createTextNode(text));
				return;
			}
			say(text, false, spinning);
		}

		events.addEventListener("setup", function (event) {
			var step = {};
			try { step = JSON.parse(event.data); } catch (error) { return; }
			if (step.phase === "connecting") sayStep("Connecting to " + step.ssid + "\\u2026", true);
			else if (step.phase === "joined") sayStep("Joined " + step.ssid + ". Waiting for the internet\\u2026", true);
			else if (step.phase === "connected") sayStep("Connected to " + step.ssid + ". Back in a moment.", false);
			else if (step.phase === "failed") {
				busy = false;
				say(step.message || "Couldn't connect.", true);
				list.hidden = false;
			}
		});

		askMode();
	})();
	</script>
</body>
</html>`;
}

module.exports = {
	SETUP_PATH,
	NEARBY_PATH,
	CONNECT_PATH,
	TRY_FOR_MS,
	toHex,
	wpaKey,
	wpaBlock,
	problemWith,
	nmName,
	scanScript,
	DROP_NAMED,
	FIND_PROCESS,
	WPA_APPLY,
	WPA_KEEP,
	WPA_UNDO,
	NUDGE_DHCP,
	NM_APPLY,
	NM_UNDO,
	changeable,
	whatWeCanChange,
	scan,
	connect,
	busy,
	PRIORITY_MARK,
	AUTO_PRIORITY,
	TRY_PRIORITY,
	SET_FLAGS,
	NM_ACTIVE,
	NM_RETURN,
	attach,
	setupPage
};
