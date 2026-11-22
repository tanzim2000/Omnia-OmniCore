// test/network-page.test.js
// The Network page (since 2.0.0): the server's Wi-Fi on a normal day.
//
//   - The scripts, run for real by this machine's sh against a pretend
//     settings file: the known networks are read by name only (never a
//     password), forgetting takes out only that network, and a network
//     joined later always gets a higher priority than any before it
//   - Names read back from every way wpa_supplicant and NetworkManager
//     write them
//   - The Wi-Fi now, from what the helper found
//   - Forgetting: never the network the server is on
//   - The routes: not while the Wi-Fi is disconnected or a join is under
//     way, a join's steps kept for a page that lost the server meanwhile
//   - The Resources tab's Network box leads here
//   - Saved passwords: listed by name, added and removed, and shown only
//     after the admin password, with a limit on wrong tries; forgetting a
//     network takes its saved password too

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const express = require("express");

// A data folder of its own, for the saved passwords
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-network-page-"));
process.env.OMNICORE_DATA_DIR = dataDir;

const networkPage = require("../core/network-page");
const networkPasswords = require("../core/network-passwords");
const networkSetup = require("../core/network-setup");
const networkHelper = require("../core/network-helper");
const status = require("../core/network-status");

// --- The scripts, for real ----------------------------------------------

const SETTINGS = `ctrl_interface=/run/wpa_supplicant
update_config=1

network={
	ssid="Home"
	psk="secret-home-pass"
	priority=5
}
# Added by OmniCore
network={
	ssid=43616665
	psk=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
	priority=50
}
network={
	ssid=P"Tab\\there"
	key_mgmt=NONE
}
`;

// A pretend host: a folder standing in for the host's files, with the
// settings file where wpa_supplicant keeps it
function pretendHost() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-net-"));
	fs.mkdirSync(path.join(root, "etc", "wpa_supplicant"), { recursive: true });
	const file = path.join(root, "etc", "wpa_supplicant", "wpa_supplicant.conf");
	fs.writeFileSync(file, SETTINGS, { mode: 0o600 });
	const run = (script, env) =>
		execFileSync("sh", ["-c", script.split(networkHelper.HOST).join(root)], {
			env: { PATH: process.env.PATH, OMNI_CONF: "/etc/wpa_supplicant/wpa_supplicant.conf", ...env },
			encoding: "utf-8"
		});
	return { root, file, run, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("the known networks: their names only, never a password", () => {
	const host = pretendHost();
	try {
		const output = host.run(networkPage.KNOWN_WPA);
		assert.ok(!/secret-home-pass|aaaaaaaa|psk/.test(output), "nothing but names");
		assert.deepEqual(networkPage.parseKnown(output, "wpa_supplicant"), [
			{ ssid: "Home", mine: false, ids: [] },
			{ ssid: "Cafe", mine: true, ids: [] },
			{ ssid: "Tab\there", mine: false, ids: [] }
		]);
	} finally {
		host.done();
	}
});

test("forgetting a network takes out that one, and only once", () => {
	const host = pretendHost();
	try {
		const env = { OMNI_SSID_HEX: networkSetup.toHex("Home"), OMNI_SSID_QUOTED: '"Home"' };
		assert.match(host.run(networkPage.FORGET_WPA, env), /@@ result forgotten/);
		const after = fs.readFileSync(host.file, "utf-8");
		assert.ok(!after.includes('"Home"') && !after.includes("secret-home-pass"));
		assert.ok(after.includes("ssid=43616665") && after.includes('ssid=P"Tab\\there"'), "the others stay");
		assert.ok(after.startsWith("ctrl_interface=/run/wpa_supplicant\nupdate_config=1\n"), "and the rest of the file");
		assert.equal(fs.statSync(host.file).mode & 0o777, 0o600, "still readable by its owner only");
		assert.match(host.run(networkPage.FORGET_WPA, env), /@@ result nothing/);
		assert.ok(!fs.existsSync(host.file + ".omnicore-new"));
	} finally {
		host.done();
	}
});

test("a network joined later always wins: one above the highest priority in the file", () => {
	const host = pretendHost();
	try {
		const join = (ssid) =>
			host.run(networkSetup.WPA_APPLY, {
				OMNI_SSID_HEX: networkSetup.toHex(ssid),
				OMNI_SSID_QUOTED: `"${ssid}"`,
				OMNI_BLOCK: Buffer.from(networkSetup.wpaBlock({ ssid, password: "correct horse battery", auth: "psk" })).toString("base64"),
				OMNI_CARD: "wlan0"
			});
		// No wpa_supplicant to tell on this machine: the file is written all the same
		assert.match(join("New Place"), /@@ result (applied|no-process)/);
		let file = fs.readFileSync(host.file, "utf-8");
		assert.match(file, /ssid=4e657720506c616365\n\tpsk=[0-9a-f]{64}\n\tpriority=51\n\}/, "above the 50 already there");
		assert.ok(!file.includes(networkSetup.PRIORITY_MARK));
		fs.rmSync(host.file + ".omnicore-before", { force: true });
		join("Cafe");
		file = fs.readFileSync(host.file, "utf-8");
		assert.equal((file.match(/ssid=43616665/g) || []).length, 1, "the old Cafe taken out");
		assert.match(file, /ssid=43616665\n\tpsk=[0-9a-f]{64}\n\tpriority=52\n\}/, "and Cafe again goes on top");
	} finally {
		host.done();
	}
});

// --- Names --------------------------------------------------------------

test("names, however they're written down", () => {
	assert.equal(networkPage.readSsid('"Home"'), "Home");
	assert.equal(networkPage.readSsid("4e657720506c616365"), "New Place");
	assert.equal(networkPage.readSsid('P"caf\\xc3\\xa9"'), "café", "bytes, read as UTF-8");
	assert.equal(networkPage.readSsid('P"a\\"b"'), 'a"b');
	const nm = networkPage.parseKnown(
		"noise\n@@ known\n0b8e3c52-1111-4c4c-9d9d-123456789abc|Caf\\:e\n0B8E3C52-2222-4c4c-9d9d-123456789abc|Caf\\:e\nnot-a-uuid|X\n",
		"networkmanager"
	);
	assert.deepEqual(nm, [
		{ ssid: "Caf:e", mine: false, ids: ["0b8e3c52-1111-4c4c-9d9d-123456789abc", "0b8e3c52-2222-4c4c-9d9d-123456789abc"] }
	]);
});

// --- The Wi-Fi now --------------------------------------------------------

const FOUND = {
	available: true,
	supported: true,
	manager: "wpa_supplicant",
	wpa: { config: "/etc/wpa_supplicant/wpa_supplicant.conf", interface: "wlan0", readable: true },
	wifi: [{ name: "wlan0", connected: true, ssid: "Home", signal: -58, bars: 3, frequency: 5180, bitrate: "300.0 MBit/s", address: "192.168.1.42" }],
	wired: []
};

test("the Wi-Fi now: its name, signal, band and address, and whether it can be changed", async () => {
	status.reset();
	status.setState("online");
	try {
		const now = await networkPage.now({ probe: async () => FOUND });
		assert.equal(now.state, "online");
		assert.equal(now.canChange, true);
		assert.deepEqual(now.card, { name: "wlan0", connected: true, ssid: "Home", signal: -58, bars: 3, band: "5 GHz", bitrate: "300.0 MBit/s", address: "192.168.1.42" });

		const iwd = await networkPage.now({ probe: async () => ({ ...FOUND, supported: false, manager: "iwd" }) });
		assert.equal(iwd.canChange, false);
		assert.match(iwd.message, /something other than wpa_supplicant/);
		assert.equal(iwd.card.ssid, "Home", "still shows what it can");

		const none = await networkPage.now({ probe: async () => ({ available: false, reason: "no-docker" }) });
		assert.equal(none.available, false);
		assert.match(none.message, /Docker/);
	} finally {
		status.reset();
	}
});

// --- Forgetting -------------------------------------------------------------

test("forgetting: never the network the server is on; otherwise by name or by connection", async () => {
	const onHome = async () => ({ card: { connected: true, ssid: "Home" } });
	await assert.rejects(networkPage.forget("Home", { now: onHome }), (error) => error.status === 409);
	await assert.rejects(networkPage.forget("", { now: onHome }), (error) => error.status === 400);

	const ran = [];
	const wpaTarget = async () => ({ manager: "wpa_supplicant", card: "wlan0", config: "/etc/wpa_supplicant/wpa_supplicant.conf" });
	const forgotten = await networkPage.forget("Cafe", {
		now: onHome,
		target: wpaTarget,
		run: async (script, options) => {
			ran.push({ script, options });
			return "@@ result forgotten";
		}
	});
	assert.deepEqual(forgotten, { forgotten: true });
	assert.equal(ran[0].script, networkPage.FORGET_WPA);
	assert.deepEqual(ran[0].options.env, { OMNI_CONF: "/etc/wpa_supplicant/wpa_supplicant.conf", OMNI_SSID_HEX: "43616665", OMNI_SSID_QUOTED: '"Cafe"' });
	assert.deepEqual(ran[0].options.writable, ["/etc/wpa_supplicant"], "only the settings file's folder");

	await assert.rejects(
		networkPage.forget("Nowhere", { now: onHome, target: wpaTarget, run: async () => "@@ result nothing" }),
		(error) => error.status === 404
	);

	const nmRan = [];
	await networkPage.forget("Cafe", {
		now: onHome,
		target: async () => ({ manager: "networkmanager", card: "wlan0" }),
		run: async (script, options) => {
			nmRan.push({ script, options });
			if (script === networkPage.KNOWN_NM) return "@@ known\n0b8e3c52-1111-4c4c-9d9d-123456789abc|Cafe\n";
			return "@@ result forgotten";
		}
	});
	assert.equal(nmRan[1].script, networkPage.FORGET_NM);
	assert.deepEqual(nmRan[1].options.env, { OMNI_UUIDS: "0b8e3c52-1111-4c4c-9d9d-123456789abc" });
});

test("forgetting a network takes its saved password too, and only once it's forgotten", async () => {
	const onHome = async () => ({ card: { connected: true, ssid: "Home" } });
	const wpaTarget = async () => ({ manager: "wpa_supplicant", card: "wlan0", config: "/etc/wpa_supplicant/wpa_supplicant.conf" });
	const removed = [];
	const passwords = { forget: (ssid) => removed.push(ssid) };

	await networkPage.forget("Cafe", { now: onHome, target: wpaTarget, run: async () => "@@ result forgotten", passwords });
	assert.deepEqual(removed, ["Cafe"]);

	await assert.rejects(networkPage.forget("Nowhere", { now: onHome, target: wpaTarget, run: async () => "@@ result nothing", passwords }));
	await assert.rejects(networkPage.forget("Home", { now: onHome, passwords }), (error) => error.status === 409);
	assert.deepEqual(removed, ["Cafe"], "nothing removed when the network wasn't forgotten");
});

test("Show: only after the admin password, and five wrong tries stop it for a while", () => {
	networkPage.resetShows();
	let clock = 1_000_000;
	const saved = { reveal: (ssid) => (ssid === "Home" ? { ssid: "Home", auth: "psk", password: "secret-home-pass" } : null) };
	const deps = { now: () => clock, passwords: saved, verify: (typed) => typed === "admin-password" };

	assert.deepEqual(networkPage.showPassword({ ssid: "Home", adminPassword: "admin-password" }, deps), {
		status: 200,
		body: { ssid: "Home", password: "secret-home-pass" }
	});
	assert.equal(networkPage.showPassword({ ssid: "Nowhere", adminPassword: "admin-password" }, deps).status, 404);

	for (let tries = 0; tries < networkPage.SHOW_TRIES; tries++) {
		const answer = networkPage.showPassword({ ssid: "Home", adminPassword: "guess" }, deps);
		assert.equal(answer.status, 401);
		assert.ok(!JSON.stringify(answer).includes("secret-home-pass"));
	}
	const stopped = networkPage.showPassword({ ssid: "Home", adminPassword: "admin-password" }, deps);
	assert.equal(stopped.status, 429, "even the right password waits");
	assert.ok(!JSON.stringify(stopped).includes("secret-home-pass"));

	clock += 15 * 60 * 1000;
	assert.equal(networkPage.showPassword({ ssid: "Home", adminPassword: "admin-password" }, deps).status, 200, "after a quarter of an hour, it answers again");
	networkPage.resetShows();
});

// --- The routes -------------------------------------------------------------

async function serve() {
	const app = express();
	app.use(express.json());
	networkPage.attach(app, { page: (title, body, script) => `<title>${title}</title>${body}<script>${script}</script>` });
	const server = await new Promise((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const post = (url, body) =>
		fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	return { server, base, post };
}

test("the routes: joining starts, is followed, and is kept for a page that lost the server", async () => {
	const realConnect = networkSetup.connect;
	const { server, base, post } = await serve();
	let joined = null;
	try {
		status.reset();
		status.setState("online");
		networkSetup.connect = async (network, report) => {
			joined = network;
			report({ phase: "connecting", ssid: network.ssid });
			report({ phase: "failed", ssid: network.ssid, message: "Couldn't join Cafe. Check the password and try again." });
			return { ok: false };
		};

		assert.equal((await post(networkPage.JOIN_PATH, { ssid: "Cafe", auth: "psk", password: "short" })).status, 400);
		assert.equal((await post(networkPage.JOIN_PATH, { ssid: "Cafe", auth: "psk", password: "correct horse battery" })).status, 202);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(joined, { ssid: "Cafe", auth: "psk", password: "correct horse battery" });

		const last = await (await fetch(base + networkPage.JOIN_PATH)).json();
		assert.equal(last.joining, false);
		assert.equal(last.last.phase, "failed");
		assert.ok(last.last.at > 0, "with when it happened, so it's shown once");
		assert.ok(!JSON.stringify(last).includes("correct horse"), "never the password");

		// Not while the takeover's own setup has the card
		status.setState("disconnected");
		assert.equal((await post(networkPage.JOIN_PATH, { ssid: "Cafe", auth: "open" })).status, 409);
		assert.equal((await fetch(base + networkPage.AROUND_PATH)).status, 409);
		assert.equal((await post(networkPage.FORGET_PATH, { ssid: "Cafe" })).status, 409);

		const page = await (await fetch(base + networkPage.PAGE_PATH)).text();
		assert.ok(page.includes("<title>Network</title>"));
		assert.ok(page.includes("Known networks") && page.includes("Networks around"));
	} finally {
		networkSetup.connect = realConnect;
		status.reset();
		server.close();
	}
});

test("the routes for saved passwords: names only, add, replace, remove, and Show asks first", async () => {
	const { server, base, post } = await serve();
	try {
		networkPage.resetShows();
		assert.deepEqual(await (await fetch(base + networkPage.PASSWORDS_PATH)).json(), { networks: [] });

		const short = await post(networkPage.PASSWORDS_PATH, { ssid: "Guest", auth: "psk", password: "short" });
		assert.equal(short.status, 400);
		assert.match((await short.json()).error, /8 to 63/);

		const added = await post(networkPage.PASSWORDS_PATH, { ssid: "Guest", auth: "psk", password: "guests-welcome-1" });
		assert.equal(added.status, 200);
		const list = await added.json();
		assert.deepEqual(list.networks.map((n) => [n.ssid, n.auth, n.readable]), [["Guest", "psk", true]]);
		assert.ok(!JSON.stringify(list).includes("guests-welcome-1"), "the list never has a password");

		// The same name replaces it; an open network needs none
		await post(networkPage.PASSWORDS_PATH, { ssid: "Guest", auth: "psk", password: "guests-welcome-2" });
		await post(networkPage.PASSWORDS_PATH, { ssid: "Cafe", auth: "open", password: "ignored" });
		assert.equal(networkPasswords.reveal("Guest").password, "guests-welcome-2");
		assert.equal(networkPasswords.reveal("Cafe").password, "");

		// No admin account in this folder, so no password is the admin's
		const show = await post(networkPage.PASSWORD_SHOW_PATH, { ssid: "Guest", adminPassword: "anything" });
		assert.equal(show.status, 401);
		assert.ok(!(await show.text()).includes("guests-welcome"));
		assert.equal(show.headers.get("cache-control"), "no-store");

		const removed = await (await post(networkPage.PASSWORD_REMOVE_PATH, { ssid: "Guest" })).json();
		assert.equal(removed.removed, true);
		assert.deepEqual(removed.networks.map((n) => n.ssid), ["Cafe"]);

		// They don't use the card, so they work while the Wi-Fi is down too
		status.setState("disconnected");
		assert.equal((await fetch(base + networkPage.PASSWORDS_PATH)).status, 200);

		const page = await (await fetch(base + networkPage.PAGE_PATH)).text();
		assert.ok(page.includes("Saved passwords") && page.includes("Guest Wi&#8209;Fi widget"));
	} finally {
		networkPage.resetShows();
		networkPasswords.forget("Cafe");
		status.reset();
		server.close();
	}
});

test("the page's script parses, and its words have no em dashes", () => {
	new Function(networkPage.PAGE_SCRIPT);
	assert.ok(!/—/.test(networkPage.PAGE_BODY + networkPage.PAGE_SCRIPT));
	assert.ok(networkPage.PAGE_SCRIPT.includes('"Content-Type": "application/json"'), "changes go as JSON");
});

test("the Resources tab's Network box leads here", () => {
	const admin = fs.readFileSync(path.join(__dirname, "..", "core", "admin-face.js"), "utf-8");
	assert.ok(admin.includes('settingsHome.tileHtml("/network", "network", "Network"'));
	assert.ok(admin.indexOf("networkPage.attach(app, { page })") > admin.indexOf("Gate everything except the setup and login endpoints"), "after sign-in");
});

test("the helper reads each Wi-Fi card's address, without the /24", () => {
	const found = networkHelper.parseProbe(
		[
			"@@ interfaces",
			"wlan0|wifi|up|1|10|20|phy0",
			"@@ link wlan0",
			"Connected to 11:22:33:44:55:66 (on wlan0)",
			"\tSSID: Home",
			"\tfreq: 5180",
			"\tsignal: -58 dBm",
			"@@ address wlan0",
			"192.168.1.42/24",
			"@@ end"
		].join("\n")
	);
	assert.equal(found.wifi[0].address, "192.168.1.42");
	assert.equal(found.wifi[0].ssid, "Home");
	assert.ok(networkHelper.probeScript().includes('echo "@@ address $n"'));
});

// --- When OmniCore can't change the Wi-Fi ----------------------------------

test("can't change the Wi-Fi: the reason, kept only when looking again won't change it", async () => {
	const lasting = await networkPage.checkAbility({
		ability: () => null,
		probe: async () => ({ ...FOUND, supported: false, manager: "iwd" })
	});
	assert.deepEqual(lasting, {
		canChange: false,
		message: "OmniCore can't change the Wi-Fi on this server: something other than wpa_supplicant or NetworkManager looks after it."
	});
	assert.equal((await networkPage.checkAbility({ ability: () => null, probe: async () => FOUND })).canChange, true);
	const failedOnce = await networkPage.checkAbility({ ability: () => null, probe: async () => ({ available: false, reason: "failed" }) });
	assert.equal(failedOnce.canChange, true, "a helper that failed once changes nothing: the last answer stands");

	// Plain from here: an OmniCore without the Wi-Fi tools (this one, run
	// from source)
	assert.ok(!networkHelper.hasTools());
	assert.deepEqual(networkPage.ability(), {
		canChange: false,
		message: "This OmniCore can't change the server's Wi-Fi: it wasn't built with the Wi-Fi tools."
	});
	assert.match(networkSetup.changeable({ available: false, reason: "no-docker" }).problem, /no access to Docker/);
});

test("the Network box when it leads nowhere: a plain box with the reason, not a button", () => {
	const box = require("../core/settings-home").staticTileHtml("network", "Network", "Can't <b>here</b>", "c2 row2", 'data-tile="network"');
	assert.match(box, /^\s*<div class="segment home-tile home-tile-off c2 row2" data-tile="network">/);
	assert.ok(!box.includes("href") && !box.includes("clickable"));
	assert.ok(box.includes("Can't &lt;b&gt;here&lt;/b&gt;"), "the reason as text");
	// Drawn as a button before anyone knew: it turns into the same plain box
	new Function(networkPage.TILE_SCRIPT);
	assert.ok(networkPage.TILE_SCRIPT.includes("answer.canChange !== false"));
	assert.ok(networkPage.TILE_SCRIPT.includes('box.className = tile.className.replace(/\\bclickable\\b/'));
	assert.ok(networkPage.TILE_SCRIPT.includes("line.textContent = (answer.message"), "the reason as text there too");
	// The page itself, opened anyway: one box
	assert.ok(networkPage.PAGE_SCRIPT.includes('getElementById("net-known-box").remove()'));
	assert.ok(networkPage.PAGE_SCRIPT.includes('getElementById("net-around-box").remove()'));
});

test.after(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
});
