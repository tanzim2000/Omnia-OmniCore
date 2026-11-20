// core/network-helper.js
// Network Management, part one: reading the HOST's network (since 2.0.0).
//
// THE PROBLEM
//
// OmniCore runs inside Docker, in a network of its own. From in here it
// can't see the server's Wi-Fi card, which network it's on, or what's
// nearby, let alone change any of it. Those belong to the host.
//
// THE WAY IN
//
// The same one updates use (core-updater.js): OmniCore can already talk
// to Docker, so it starts a short-lived copy of ITSELF (the same image,
// so nothing is downloaded, which matters most exactly when there's no
// internet) with three things a normal container doesn't get:
//
//   - the host's network (NetworkMode "host"), so it sees the real Wi-Fi
//     card instead of Docker's pretend one
//   - the host's processes (PidMode "host"), so it can see which program
//     looks after the Wi-Fi (wpa_supplicant or NetworkManager)
//   - the host's files, READ-ONLY, at /opt/omnicore-net/host, so it can
//     find that program's settings and reach its control socket
//
// plus permission to look at network cards (NET_ADMIN, NET_RAW). It runs
// one small shell script, prints what it found, and is removed. Nothing
// on the host is changed by anything in this file.
//
// The Wi-Fi tools themselves (wpa_cli, nmcli, iw) are in the image, in an
// Alpine of their own at /opt/omnicore-net (see the Dockerfile), and are
// run with `chroot` into it, so they find their own libraries.
//
// WHAT IT NEVER DOES
//
// Print a Wi-Fi password. The script reads wpa_supplicant's settings file
// only to count its networks and to see whether it can be talked to; it
// never prints a line of it. A test checks the script for that.
//
// WHEN IT CAN'T
//
// probe() answers { available: false, reason } instead of throwing:
//
//   "no-docker"   OmniCore can't reach Docker (the socket isn't mounted,
//                 as for someone who opted out of updates)
//   "no-tools"    this OmniCore wasn't built with the network tools
//                 (running from source, or an image from before 2.0.0)
//   "failed"      the helper ran but something went wrong; `error` says
//                 what

const fs = require("fs");
const os = require("os");
const Docker = require("dockerode");

// Where the tools live in the image, and where the helper puts the host
const TOOLS = "/opt/omnicore-net";
const HOST = `${TOOLS}/host`;

// The longest a probe may take. Reading what the card already knows is
// quick; this is for a host that's slow to answer.
const PROBE_TIMEOUT_MS = 45000;

// The same Docker OmniCore updates through. OMNICORE_DOCKER_SOCKET is for
// the tests.
function connectToDocker() {
	return new Docker({ socketPath: process.env.OMNICORE_DOCKER_SOCKET || "/var/run/docker.sock" });
}

// ---------------------------------------------------------------------
// The script the helper runs
//
// Plain POSIX shell for busybox. Its output is sections, each starting
// with a line "@@ name", that parseProbe() reads.

function probeScript() {
	return `
T=${TOOLS}
H=${HOST}

# A tool from the network tools, with a time limit so nothing can hang
tool() { limit=$1; shift; timeout "$limit" chroot "$T" "$@" 2>&1; }

echo "@@ os"
grep -E '^(ID|VERSION_ID|PRETTY_NAME)=' "$H/etc/os-release" 2>/dev/null

# Every network card but the loopback: name, kind, state, cable, bytes in
# and out, and the Wi-Fi radio it belongs to
echo "@@ interfaces"
for d in /sys/class/net/*; do
	n=\${d##*/}
	[ "$n" = lo ] && continue
	kind=other
	if [ -d "$d/wireless" ] || [ -e "$d/phy80211" ]; then kind=wifi
	elif [ -e "$d/device" ]; then kind=wired
	fi
	phy=""
	[ -r "$d/phy80211/name" ] && phy=$(cat "$d/phy80211/name")
	echo "$n|$kind|$(cat "$d/operstate" 2>/dev/null)|$(cat "$d/carrier" 2>/dev/null)|$(cat "$d/statistics/rx_bytes" 2>/dev/null)|$(cat "$d/statistics/tx_bytes" 2>/dev/null)|$phy"
done

# The programs that look after networks, by their command lines (never
# this script itself, whose own command line mentions them all)
echo "@@ processes"
for p in /proc/[0-9]*; do
	first=$(tr '\\0' '\\n' < "$p/cmdline" 2>/dev/null | head -n 1)
	case "$first" in
		*wpa_supplicant|*NetworkManager|*iwd|*udhcpc|*dhcpcd|*dhclient|*connmand|*systemd-networkd)
			echo "\${p##*/}|$(tr '\\0' ' ' < "$p/cmdline" 2>/dev/null)" ;;
	esac
done

# wpa_supplicant's settings file and its interface, from its command line.
# Of the file, only: whether it can be read, how many networks it has,
# where its control socket is and whether it may save changes. Never a
# line of the file itself: that's where the passwords are.
echo "@@ wpa"
for p in /proc/[0-9]*; do
	first=$(tr '\\0' '\\n' < "$p/cmdline" 2>/dev/null | head -n 1)
	case "$first" in *wpa_supplicant) ;; *) continue ;; esac
	conf=$(tr '\\0' '\\n' < "$p/cmdline" | awk 'previous == "-c" { print; exit } /^-c./ { print substr($0, 3); exit } { previous = $0 }')
	iface=$(tr '\\0' '\\n' < "$p/cmdline" | awk 'previous == "-i" { print; exit } /^-i./ { print substr($0, 3); exit } { previous = $0 }')
	f="$H$conf"
	if [ -n "$conf" ] && [ -r "$f" ]; then
		networks=$(grep -cE '^[[:space:]]*network[[:space:]]*=' "$f")
		control=$(grep -E '^[[:space:]]*ctrl_interface[[:space:]]*=' "$f" | head -n 1 | sed 's/^[^=]*=[[:space:]]*//')
		saves=$(grep -cE '^[[:space:]]*update_config[[:space:]]*=[[:space:]]*1' "$f")
		echo "$conf|$iface|readable|$networks|$control|$saves"
	else
		echo "$conf|$iface|missing|||"
	fi
done

# wpa_supplicant's control sockets, where they usually are. /var/run is
# often a link to /run; a link here would point into this container, not
# the host, so it's only looked in when it's a real folder.
echo "@@ wpa-sockets"
for dir in /run/wpa_supplicant /var/run/wpa_supplicant; do
	case "$dir" in /var/run/*) [ -L "$H/var/run" ] && continue ;; esac
	[ -d "$H$dir" ] || continue
	for s in "$H$dir"/*; do
		[ -S "$s" ] && echo "$dir|\${s##*/}"
	done
done

# NetworkManager, through the host's system bus
if [ -S "$H/run/dbus/system_bus_socket" ]; then
	export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
	echo "@@ nm-general"
	tool 8 nmcli -t -f RUNNING,STATE,WIFI general status
	echo "@@ nm-devices"
	tool 8 nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device
fi

# Each Wi-Fi card: the network it's on, the networks it already knows are
# nearby (from its last look around, so this is quick and changes
# nothing), and what its radio can do
for d in /sys/class/net/*; do
	n=\${d##*/}
	[ -d "$d/wireless" ] || [ -e "$d/phy80211" ] || continue
	echo "@@ link $n"
	tool 8 iw dev "$n" link
	echo "@@ nearby $n"
	tool 12 iw dev "$n" scan dump | grep -E '^BSS |^[[:space:]]+(freq|signal|SSID|RSN|WPA|capability|\\* Authentication suites):'
	if [ -r "$d/phy80211/name" ]; then
		phy=$(cat "$d/phy80211/name")
		echo "@@ radio $n"
		tool 8 iw phy "$phy" info | awk '/Supported interface modes:/ { modes = 1; print; next } modes && /^[[:space:]]+\\*/ { print; next } { modes = 0 } /valid interface combinations/ { combos = 1 } combos { print }'
	fi
done

echo "@@ end"
`;
}

// ---------------------------------------------------------------------
// Reading what it printed

function sections(text) {
	const found = {};
	let current = null;
	for (const raw of String(text).replace(/\r/g, "").split("\n")) {
		const header = raw.match(/^@@ (.+)$/);
		if (header) {
			current = header[1].trim();
			found[current] = found[current] || [];
			continue;
		}
		if (current) found[current].push(raw);
	}
	return found;
}

// iw writes anything unprintable in an SSID as \xNN
function unescapeSsid(text) {
	const bytes = [];
	const raw = String(text);
	for (let i = 0; i < raw.length; i++) {
		const escape = raw.slice(i).match(/^\\x([0-9a-fA-F]{2})/);
		if (escape) {
			bytes.push(parseInt(escape[1], 16));
			i += 3;
		} else {
			bytes.push(...Buffer.from(raw[i], "utf-8"));
		}
	}
	return Buffer.from(bytes).toString("utf-8");
}

// Signal in dBm, as the 0 to 4 bars a phone shows
function bars(dbm) {
	if (typeof dbm !== "number" || !isFinite(dbm)) return 0;
	if (dbm >= -55) return 4;
	if (dbm >= -67) return 3;
	if (dbm >= -75) return 2;
	if (dbm >= -85) return 1;
	return 0;
}

function parseLink(lines) {
	const text = lines.join("\n");
	if (!/Connected to/i.test(text)) return { connected: false };
	const pick = (pattern) => {
		const match = text.match(pattern);
		return match ? match[1].trim() : null;
	};
	const signal = Number(pick(/signal:\s*(-?[\d.]+)\s*dBm/i));
	return {
		connected: true,
		ssid: unescapeSsid(pick(/SSID:\s*(.*)/) || ""),
		frequency: Number(pick(/freq:\s*([\d.]+)/)) || null,
		signal: isFinite(signal) ? signal : null,
		bars: bars(signal),
		bitrate: pick(/tx bitrate:\s*([\d.]+\s*\S+)/i)
	};
}

// What `iw scan dump` printed, as one entry per network name: the
// strongest of its access points, with what kind of password it asks for.
// Hidden networks (no name) are left out.
function parseNearby(lines) {
	const points = [];
	let point = null;
	for (const line of lines) {
		if (/^BSS /.test(line)) {
			point = { ssid: "", signal: null, frequency: null, rsn: false, wpa: false, privacy: false, sae: false };
			points.push(point);
			continue;
		}
		if (!point) continue;
		const value = line.replace(/^\s+/, "");
		if (/^SSID:/.test(value)) point.ssid = unescapeSsid(value.replace(/^SSID:\s?/, ""));
		else if (/^signal:/.test(value)) point.signal = Number(value.match(/-?[\d.]+/)[0]);
		else if (/^freq:/.test(value)) point.frequency = Number(value.match(/[\d.]+/)[0]);
		else if (/^RSN:/.test(value)) point.rsn = true;
		else if (/^WPA:/.test(value)) point.wpa = true;
		else if (/^capability:/.test(value) && /Privacy/.test(value)) point.privacy = true;
		else if (/Authentication suites:/.test(value) && /SAE/.test(value)) point.sae = true;
	}

	const byName = new Map();
	for (const found of points) {
		if (!found.ssid || /^\\x00/.test(found.ssid) || /^\0+$/.test(found.ssid)) continue;
		const security = found.sae ? "WPA3" : found.rsn ? "WPA2" : found.wpa ? "WPA" : found.privacy ? "WEP" : "Open";
		const entry = {
			ssid: found.ssid,
			signal: found.signal,
			bars: bars(found.signal),
			frequency: found.frequency,
			band: found.frequency >= 5900 ? "6 GHz" : found.frequency >= 4900 ? "5 GHz" : found.frequency ? "2.4 GHz" : null,
			security
		};
		const kept = byName.get(entry.ssid);
		if (!kept || (entry.signal !== null && (kept.signal === null || entry.signal > kept.signal))) byName.set(entry.ssid, entry);
	}
	return [...byName.values()].sort((a, b) => (b.signal ?? -999) - (a.signal ?? -999));
}

// Whether the radio can run a network of its own (an access point), and
// whether it can do that while staying connected to another network
function parseRadio(lines) {
	const modes = [];
	let inModes = false;
	const combinations = [];
	let inCombos = false;
	for (const line of lines) {
		if (/Supported interface modes:/.test(line)) {
			inModes = true;
			continue;
		}
		if (inModes && /^\s+\*\s+/.test(line)) {
			modes.push(line.replace(/^\s+\*\s+/, "").trim());
			continue;
		}
		inModes = false;
		if (/valid interface combinations/.test(line)) {
			inCombos = true;
			continue;
		}
		if (!inCombos) continue;
		// Each combination starts with "*", and a long one carries on,
		// indented, on the next line ("total <= 2, #channels <= 1")
		if (/^\s*\*/.test(line)) combinations.push(line.trim());
		else if (/^\s{3,}\S/.test(line) && combinations.length) combinations[combinations.length - 1] += " " + line.trim();
		else inCombos = false;
	}
	const capable = modes.includes("AP");
	const alongside = capable && combinations.some((combo) => {
		const total = Number((combo.match(/total <= (\d+)/) || [])[1] || 0);
		return /managed/.test(combo) && /\bAP\b/.test(combo) && total >= 2;
	});
	return { capable, alongside };
}

function parseProbe(text) {
	const found = sections(text);

	const osInfo = {};
	for (const line of found.os || []) {
		const match = line.match(/^(\w+)=(.*)$/);
		if (match) osInfo[match[1]] = match[2].replace(/^"|"$/g, "");
	}

	const interfaces = (found.interfaces || [])
		.filter((line) => line.includes("|"))
		.map((line) => {
			const [name, kind, state, carrier, rx, tx, phy] = line.split("|");
			return { name, kind, state: state || "unknown", carrier: carrier === "1", rxBytes: Number(rx) || 0, txBytes: Number(tx) || 0, phy: phy || null };
		});

	const processes = (found.processes || [])
		.filter((line) => line.includes("|"))
		.map((line) => {
			const at = line.indexOf("|");
			return { pid: Number(line.slice(0, at)), command: line.slice(at + 1).trim() };
		});
	const running = (name) => processes.some((proc) => new RegExp(`(^|/)${name}( |$)`).test(proc.command));

	// Who looks after the Wi-Fi. NetworkManager runs a wpa_supplicant of
	// its own underneath, so it's asked about first.
	let manager = "none";
	if (running("NetworkManager")) manager = "networkmanager";
	else if (running("wpa_supplicant")) manager = "wpa_supplicant";
	else if (running("iwd")) manager = "iwd";
	else if (running("connmand") || running("systemd-networkd")) manager = "other";

	const sockets = (found["wpa-sockets"] || []).filter((line) => line.includes("|")).map((line) => {
		const [dir, name] = line.split("|");
		return { dir, interface: name };
	});

	let wpa = null;
	const wpaLine = (found.wpa || []).find((line) => line.includes("|"));
	if (wpaLine) {
		const [config, iface, readable, networks, control, saves] = wpaLine.split("|");
		const controlDir = (String(control || "").match(/(?:DIR=)?(\/[^\s]+)/) || [])[1] || null;
		wpa = {
			config: config || null,
			interface: iface || null,
			readable: readable === "readable",
			networks: Number(networks) || 0,
			controlDir,
			canSave: Number(saves) > 0,
			sockets
		};
	}

	const wifi = interfaces.filter((card) => card.kind === "wifi").map((card) => {
		const link = parseLink(found[`link ${card.name}`] || []);
		return {
			name: card.name,
			state: card.state,
			...link,
			rxBytes: card.rxBytes,
			txBytes: card.txBytes,
			phy: card.phy,
			hotspot: parseRadio(found[`radio ${card.name}`] || []),
			nearby: parseNearby(found[`nearby ${card.name}`] || [])
		};
	});

	const wired = interfaces.filter((card) => card.kind === "wired").map((card) => ({
		name: card.name,
		state: card.state,
		cable: card.carrier
	}));

	return {
		os: { id: osInfo.ID || null, version: osInfo.VERSION_ID || null, name: osInfo.PRETTY_NAME || null },
		manager,
		supported: manager === "wpa_supplicant" || manager === "networkmanager",
		wpa,
		wifi,
		wired,
		complete: Object.prototype.hasOwnProperty.call(found, "end")
	};
}

// ---------------------------------------------------------------------
// Running it

// Who OmniCore is, so the helper can be the same image. Docker sets a
// container's hostname to its own short ID (see core-updater.js).
async function selfContainer(docker) {
	const container = docker.getContainer(os.hostname());
	return { container, info: await container.inspect() };
}

// Run a script in a helper on the host's network, and return what it
// printed. `docker` is for the tests.
async function runOnHost(script, options = {}) {
	const docker = options.docker || connectToDocker();
	const self = await selfContainer(docker);
	const name = `${String(self.info.Name || "omnicore").replace(/^\//, "")}-network-${Date.now()}`;

	const helper = await docker.createContainer({
		name,
		// The image OmniCore is running right now: already here, so this
		// works with no internet at all
		Image: self.info.Image,
		Entrypoint: ["sh", "-c"],
		Cmd: [script],
		Tty: true,
		Labels: { "omnicore.helper": "network" },
		HostConfig: {
			NetworkMode: "host",
			PidMode: "host",
			CapAdd: ["NET_ADMIN", "NET_RAW"],
			Mounts: [{ Type: "bind", Source: "/", Target: HOST, ReadOnly: true }],
			AutoRemove: false
		}
	});

	try {
		await helper.start();
		await Promise.race([
			helper.wait(),
			new Promise((resolve, reject) => setTimeout(() => reject(new Error("The network helper took too long")), options.timeoutMs || PROBE_TIMEOUT_MS).unref())
		]);
		return String(await helper.logs({ stdout: true, stderr: true }));
	} finally {
		helper.remove({ force: true }).catch(() => {});
	}
}

// Whether this OmniCore has the network tools at all: an image from 2.0.0
// on does; running from source doesn't
function hasTools() {
	return fs.existsSync(`${TOOLS}/usr/sbin/iw`) || fs.existsSync(`${TOOLS}/sbin/iw`);
}

// One look at a time: two pages asking at once share it. A finished look
// is reused for a few seconds.
let running = null;
let last = null;
const FRESH_MS = 5000;

async function probe(options = {}) {
	if (!options.fresh && last && Date.now() - last.at < FRESH_MS) return last.result;
	if (running) return running;

	running = (async () => {
		if (!(options.tools || hasTools)()) {
			return { available: false, reason: "no-tools" };
		}
		let output;
		try {
			output = await (options.run || runOnHost)(probeScript(), options);
		} catch (error) {
			const noDocker = /ENOENT|ECONNREFUSED|EACCES|no such container|connect/i.test(error.message);
			return noDocker
				? { available: false, reason: "no-docker" }
				: { available: false, reason: "failed", error: error.message };
		}
		const parsed = parseProbe(output);
		if (!parsed.complete) {
			return { available: false, reason: "failed", error: "The network helper stopped before it finished", ...(options.raw ? { raw: output } : {}) };
		}
		return { available: true, checkedAt: new Date().toISOString(), ...parsed, ...(options.raw ? { raw: output } : {}) };
	})();

	try {
		const result = await running;
		last = { at: Date.now(), result };
		return result;
	} finally {
		running = null;
	}
}

module.exports = {
	TOOLS,
	HOST,
	probe,
	probeScript,
	parseProbe,
	parseLink,
	parseNearby,
	parseRadio,
	unescapeSsid,
	bars,
	runOnHost,
	hasTools
};
