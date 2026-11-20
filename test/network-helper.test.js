// test/network-helper.test.js
// Network Management's first part (since 2.0.0): reading the host's
// network through a short-lived helper container.
//
//   - What the helper prints is read correctly: the network in use, the
//     networks nearby, what the Wi-Fi card can do, and who looks after the
//     Wi-Fi (wpa_supplicant or NetworkManager)
//   - The helper is made the way it must be: OmniCore's own image (works
//     with no internet), the host's network and processes, the host's
//     files read-only, and it's removed afterwards
//   - The script never prints a Wi-Fi password
//   - Without Docker, or without the tools, it says so instead of failing
//
// The output below is shaped like what `iw` prints on a real Intel card,
// trimmed the way the helper's script trims it.

const test = require("node:test");
const assert = require("node:assert");

const network = require("../core/network-helper");

const LINK = `Connected to 64:66:b3:aa:bb:cc (on wlan0)
	SSID: Home WiFi
	freq: 2437
	RX: 123456 bytes (1000 packets)
	TX: 23456 bytes (200 packets)
	signal: -52 dBm
	rx bitrate: 72.2 MBit/s MCS 7 short GI
	tx bitrate: 65.0 MBit/s MCS 6

	bss flags:	short-preamble short-slot-time`;

const NEARBY = `BSS 64:66:b3:aa:bb:cc(on wlan0) -- associated
	freq: 2437.0
	capability: ESS Privacy ShortPreamble ShortSlotTime (0x0431)
	signal: -52.00 dBm
	SSID: Home WiFi
	RSN:	 * Version: 1
		 * Authentication suites: PSK
BSS 64:66:b3:aa:bb:cd(on wlan0)
	freq: 5180
	capability: ESS Privacy (0x0011)
	signal: -63.00 dBm
	SSID: Home WiFi
	RSN:	 * Version: 1
		 * Authentication suites: PSK
BSS 10:20:30:40:50:60(on wlan0)
	freq: 2412
	capability: ESS (0x0401)
	signal: -71.00 dBm
	SSID: Caf\\xc3\\xa9 Libre
BSS 10:20:30:40:50:61(on wlan0)
	freq: 5745
	capability: ESS Privacy (0x0011)
	signal: -80.00 dBm
	SSID: Neighbour
	RSN:	 * Version: 1
		 * Authentication suites: SAE
BSS 10:20:30:40:50:62(on wlan0)
	freq: 2462
	capability: ESS Privacy (0x0011)
	signal: -40.00 dBm
	SSID:
	RSN:	 * Version: 1`;

const RADIO = `	Supported interface modes:
		 * IBSS
		 * managed
		 * AP
		 * AP/VLAN
		 * monitor
	valid interface combinations:
		 * #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1,
		   total <= 2, #channels <= 1
	HT Capability overrides:`;

function output(extra) {
	return [
		"@@ os",
		'PRETTY_NAME="Alpine Linux v3.22"',
		"VERSION_ID=3.22.1",
		"ID=alpine",
		"@@ interfaces",
		"eth0|wired|down|0|0|0|",
		"wlan0|wifi|up|1|987654|123456|phy0",
		"docker0|other|up|1|10|10|",
		"@@ processes",
		"2601|/sbin/wpa_supplicant -B -c/etc/wpa_supplicant/wpa_supplicant.conf -i wlan0 -P /run/wpa_supplicant.pid",
		"2650|udhcpc -b -p /run/udhcpc.wlan0.pid -i wlan0",
		"@@ wpa",
		"/etc/wpa_supplicant/wpa_supplicant.conf|wlan0|readable|2|DIR=/run/wpa_supplicant GROUP=wheel|1",
		"@@ wpa-sockets",
		"/run/wpa_supplicant|wlan0",
		"@@ link wlan0",
		LINK,
		"@@ nearby wlan0",
		NEARBY,
		"@@ radio wlan0",
		RADIO,
		...(extra || []),
		"@@ end"
	].join("\n");
}

test("signal strength becomes the bars a phone shows", () => {
	assert.deepEqual([-40, -55, -60, -67, -70, -80, -90].map(network.bars), [4, 4, 3, 3, 2, 1, 0]);
	assert.equal(network.bars(null), 0);
});

test("the network in use: its name, signal, band and speed", () => {
	const link = network.parseLink(LINK.split("\n"));
	assert.deepEqual(link, {
		connected: true,
		ssid: "Home WiFi",
		frequency: 2437,
		signal: -52,
		bars: 4,
		bitrate: "65.0 MBit/s"
	});
	assert.deepEqual(network.parseLink(["Not connected."]), { connected: false });
});

test("networks nearby: one per name, the strongest first, with their kind of password", () => {
	const nearby = network.parseNearby(NEARBY.split("\n"));
	assert.deepEqual(nearby.map((n) => [n.ssid, n.signal, n.security, n.band]), [
		["Home WiFi", -52, "WPA2", "2.4 GHz"],
		["Café Libre", -71, "Open", "2.4 GHz"],
		["Neighbour", -80, "WPA3", "5 GHz"]
	], "the 5 GHz Home WiFi is the same network, weaker; the hidden one is left out");
});

test("a name iw escaped is read back as it was", () => {
	assert.equal(network.unescapeSsid("Caf\\xc3\\xa9"), "Café");
	assert.equal(network.unescapeSsid("Plain"), "Plain");
});

test("the radio: whether it can run a network of its own, and alongside a connection", () => {
	assert.deepEqual(network.parseRadio(RADIO.split("\n")), { capable: true, alongside: true }, "a combination wrapped onto two lines");
	assert.deepEqual(
		network.parseRadio(["	Supported interface modes:", "		 * managed", "		 * monitor"]),
		{ capable: false, alongside: false }
	);
	assert.deepEqual(
		network.parseRadio(["	Supported interface modes:", "		 * managed", "		 * AP", "	valid interface combinations:", "		 * #{ managed } <= 1, #{ AP } <= 1, total <= 1"]),
		{ capable: true, alongside: false },
		"a hotspot, but only instead of a connection"
	);
});

test("everything together: a server on wpa_supplicant, like Alpine", () => {
	const read = network.parseProbe(output());
	assert.equal(read.complete, true);
	assert.deepEqual(read.os, { id: "alpine", version: "3.22.1", name: "Alpine Linux v3.22" });
	assert.equal(read.manager, "wpa_supplicant");
	assert.equal(read.supported, true);
	assert.deepEqual(read.wpa, {
		config: "/etc/wpa_supplicant/wpa_supplicant.conf",
		interface: "wlan0",
		readable: true,
		networks: 2,
		controlDir: "/run/wpa_supplicant",
		canSave: true,
		sockets: [{ dir: "/run/wpa_supplicant", interface: "wlan0" }]
	});
	assert.equal(read.wifi.length, 1);
	const card = read.wifi[0];
	assert.equal(card.name, "wlan0");
	assert.equal(card.ssid, "Home WiFi");
	assert.equal(card.bars, 4);
	assert.equal(card.rxBytes, 987654, "the counters live speeds are worked out from");
	assert.deepEqual(card.hotspot, { capable: true, alongside: true });
	assert.equal(card.nearby.length, 3);
	assert.deepEqual(read.wired, [{ name: "eth0", state: "down", cable: false }], "docker0 isn't a real card");
});

test("who looks after the Wi-Fi", () => {
	const withProcesses = (lines) =>
		network.parseProbe(["@@ processes", ...lines, "@@ end"].join("\n"));
	assert.equal(withProcesses(["10|/usr/sbin/NetworkManager --no-daemon", "11|/sbin/wpa_supplicant -u -s -O /run/wpa_supplicant"]).manager, "networkmanager", "NetworkManager runs its own wpa_supplicant underneath");
	assert.equal(withProcesses(["10|/usr/libexec/iwd"]).manager, "iwd");
	assert.equal(withProcesses(["10|/usr/libexec/iwd"]).supported, false);
	assert.equal(withProcesses(["10|/lib/systemd/systemd-networkd"]).manager, "other");
	assert.equal(withProcesses([]).manager, "none");
});

test("a helper that stopped halfway isn't trusted", () => {
	assert.equal(network.parseProbe("@@ os\nID=alpine").complete, false);
});

test("the script never prints a Wi-Fi password", () => {
	const script = network.probeScript();
	// The settings file is only ever grepped for counts and the control
	// socket, never printed: no cat, head or plain grep of it
	const settingsReads = script.split("\n").filter((line) => line.includes('"$f"'));
	assert.ok(settingsReads.length >= 3);
	for (const line of settingsReads) {
		assert.ok(!/\bcat\b|\bhead\b.*"\$f"|\bless\b|\bmore\b/.test(line), line);
		assert.ok(/grep -c|ctrl_interface|-r "\$f"/.test(line), `only counts or the control socket: ${line}`);
	}
	const commands = script.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
	assert.ok(!/psk|password|passphrase/i.test(commands), "never looks for one");
});

test("the helper is OmniCore's own image, on the host's network, with the host read-only, and removed", async () => {
	let made = null;
	let removed = false;
	const fakeDocker = {
		getContainer: () => ({
			inspect: async () => ({ Name: "/omnicore", Image: "sha256:own-image" })
		}),
		createContainer: async (options) => {
			made = options;
			return {
				start: async () => {},
				wait: async () => ({ StatusCode: 0 }),
				logs: async () => Buffer.from("@@ end\n"),
				remove: async () => {
					removed = true;
				}
			};
		}
	};

	const said = await network.runOnHost("echo hi", { docker: fakeDocker });
	assert.equal(said, "@@ end\n");
	assert.equal(made.Image, "sha256:own-image", "nothing to download");
	assert.match(made.name, /^omnicore-network-\d+$/);
	assert.equal(made.HostConfig.NetworkMode, "host");
	assert.equal(made.HostConfig.PidMode, "host");
	assert.deepEqual(made.HostConfig.CapAdd, ["NET_ADMIN", "NET_RAW"]);
	assert.equal(made.HostConfig.Privileged, undefined, "never privileged");
	assert.deepEqual(made.HostConfig.Mounts, [{ Type: "bind", Source: "/", Target: network.HOST, ReadOnly: true }]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(removed, true);
});

test("without the tools, or without Docker, it says so instead of failing", async () => {
	assert.deepEqual(await network.probe({ fresh: true, tools: () => false }), { available: false, reason: "no-tools" });
	assert.deepEqual(
		await network.probe({ fresh: true, tools: () => true, run: async () => { throw new Error("connect ENOENT /var/run/docker.sock"); } }),
		{ available: false, reason: "no-docker" }
	);
	const half = await network.probe({ fresh: true, tools: () => true, run: async () => "@@ os\nID=alpine" });
	assert.equal(half.available, false);
	assert.equal(half.reason, "failed");
	const whole = await network.probe({ fresh: true, tools: () => true, run: async () => output() });
	assert.equal(whole.available, true);
	assert.equal(whole.manager, "wpa_supplicant");
	assert.ok(!("raw" in whole), "what the helper printed only when asked for");
});
