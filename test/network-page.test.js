// test/network-page.test.js
// The Network page (since 2.0.0): the server's Wi-Fi on a normal day.
//
//   - The scripts, run for real by this machine's sh against a pretend
//     settings file: the known networks are read by name and "Join by
//     itself" only (never a password), forgetting takes out only that
//     network, and OmniCore keeps the priorities: every network that joins
//     by itself the same (the strongest signal wins), the one being tried
//     above them, and "Join automatically" off as disabled=1
//   - Names read back from every way wpa_supplicant and NetworkManager
//     write them
//   - The Wi-Fi now, from what the helper found
//   - Forgetting: never the network the server is on
//   - The routes: not while the Wi-Fi is disconnected or a join is under
//     way, a join's steps kept for a page that lost the server meanwhile
//   - The Resources tab's Network box leads here
//   - Edit: "Join automatically" and a new password written for real into a
//     pretend settings file; a new password for the network the server is
//     on tried like a join instead
//   - Show password: only after the admin password, with a limit on wrong
//     tries, and with a QR code any phone reads; forgetting a network takes
//     its saved password too
//   - The Guest Wi-Fi widget's check: started like a join, followed the same way

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
network={
	ssid="Guests"
	psk="guest-pass-here"
	priority=0
	disabled=1
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
		assert.ok(!/secret-home-pass|aaaaaaaa|guest-pass|psk/.test(output), "nothing but names");
		assert.deepEqual(networkPage.parseKnown(output, "wpa_supplicant"), [
			{ ssid: "Home", mine: false, auto: true, ids: [] },
			{ ssid: "Cafe", mine: true, auto: true, ids: [] },
			{ ssid: "Tab\there", mine: false, auto: true, ids: [] },
			{ ssid: "Guests", mine: false, auto: false, ids: [] }
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

// The priority each network has in the file, by name
function priorities(file) {
	const found = {};
	for (const block of file.split("network={").slice(1)) {
		const name = (block.match(/ssid=(\S+)/) || [])[1];
		const priority = (block.match(/priority=(\d+)/) || [])[1];
		found[networkPage.readSsid(name)] = { priority: priority === undefined ? null : Number(priority), disabled: /disabled=1/.test(block) };
	}
	return found;
}

test("OmniCore keeps the priorities: the one being tried on top, then all alike", () => {
	const host = pretendHost();
	try {
		const env = (ssid, extra) => ({
			OMNI_SSID_HEX: networkSetup.toHex(ssid),
			OMNI_SSID_QUOTED: `"${ssid}"`,
			OMNI_BLOCK: Buffer.from(networkSetup.wpaBlock({ ssid, password: "correct horse battery", auth: "psk" })).toString("base64"),
			OMNI_CARD: "wlan0",
			...extra
		});

		// While it's tried: above every other network, which all join by
		// themselves at the ordinary priority. "Join automatically" off stays off.
		// (No wpa_supplicant to tell on this machine: the file is written all the same.)
		assert.match(host.run(networkSetup.WPA_APPLY, env("New Place")), /@@ result (applied|no-process)/);
		let file = fs.readFileSync(host.file, "utf-8");
		assert.ok(!file.includes(networkSetup.PRIORITY_MARK));
		assert.deepEqual(priorities(file), {
			Home: { priority: 50, disabled: false },
			Cafe: { priority: 50, disabled: false },
			"Tab\there": { priority: 50, disabled: false },
			Guests: { priority: 0, disabled: true },
			"New Place": { priority: networkSetup.TRY_PRIORITY, disabled: false }
		});
		assert.ok(file.includes('psk="secret-home-pass"'), "nothing else in a block is touched");

		// It worked: back to the ordinary priority, and the copy removed
		assert.match(host.run(networkSetup.WPA_KEEP, env("New Place", { OMNI_MODE: "auto" })), /@@ result kept/);
		file = fs.readFileSync(host.file, "utf-8");
		assert.deepEqual(priorities(file)["New Place"], { priority: 50, disabled: false });
		assert.ok(!fs.existsSync(host.file + ".omnicore-before"));
		assert.equal(fs.statSync(host.file).mode & 0o777, 0o600, "still readable by its owner only");

		// Joined again: the old entry taken out, one entry left
		host.run(networkSetup.WPA_APPLY, env("Cafe"));
		host.run(networkSetup.WPA_KEEP, env("Cafe", { OMNI_MODE: "auto" }));
		file = fs.readFileSync(host.file, "utf-8");
		assert.equal((file.match(/ssid=43616665/g) || []).length, 1, "the old Cafe taken out");
		assert.deepEqual(priorities(file).Cafe, { priority: 50, disabled: false });

		// A check keeps it with "Join automatically" off
		host.run(networkSetup.WPA_APPLY, env("Lobby"));
		host.run(networkSetup.WPA_KEEP, env("Lobby", { OMNI_MODE: "manual", OMNI_RELOAD: "1" }));
		file = fs.readFileSync(host.file, "utf-8");
		assert.deepEqual(priorities(file).Lobby, { priority: 0, disabled: true });
		assert.deepEqual(Object.values(priorities(file)).filter((n) => n.priority > 50), [], "nothing left above the ordinary priority");
		assert.ok(!/@@|omnicore-flags/.test(file), "no script output in the file");
		assert.ok(!fs.existsSync(host.file + ".omnicore-flags"));
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
		"noise\n@@ known\n0b8e3c52-1111-4c4c-9d9d-123456789abc|no|Caf\\:e\n0B8E3C52-2222-4c4c-9d9d-123456789abc|yes|Caf\\:e\nnot-a-uuid|yes|X\n",
		"networkmanager"
	);
	assert.deepEqual(nm, [
		{ ssid: "Caf:e", mine: false, auto: true, ids: ["0b8e3c52-1111-4c4c-9d9d-123456789abc", "0b8e3c52-2222-4c4c-9d9d-123456789abc"] }
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
			if (script === networkPage.KNOWN_NM) return "@@ known\n0b8e3c52-1111-4c4c-9d9d-123456789abc|yes|Cafe\n";
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

	const shown = networkPage.showPassword({ ssid: "Home", adminPassword: "admin-password" }, deps);
	assert.equal(shown.status, 200);
	assert.equal(shown.body.password, "secret-home-pass");
	assert.ok(shown.body.svg.startsWith("<svg") && !shown.body.svg.includes("secret-home-pass"), "a QR code, drawn from squares only");
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

test("editing for real: Join automatically, and a new password, in the settings file", () => {
	const host = pretendHost();
	try {
		const env = (ssid, extra) => ({ OMNI_SSID_HEX: networkSetup.toHex(ssid), OMNI_SSID_QUOTED: `"${ssid}"`, ...extra });

		// "Join automatically" off for Home: disabled, and its password untouched
		assert.match(host.run(networkPage.WPA_EDIT, env("Home", { OMNI_MODE: "manual" })), /@@ result changed/);
		let file = fs.readFileSync(host.file, "utf-8");
		assert.deepEqual(priorities(file).Home, { priority: 0, disabled: true });
		assert.ok(file.includes('psk="secret-home-pass"'), "only the flags change");

		// And back on, at the ordinary priority
		host.run(networkPage.WPA_EDIT, env("Home", { OMNI_MODE: "auto" }));
		assert.deepEqual(priorities(fs.readFileSync(host.file, "utf-8")).Home, { priority: 50, disabled: false });

		// A new password for Guests, which doesn't join automatically: replaced, still off
		const block = Buffer.from(networkSetup.wpaBlock({ ssid: "Guests", password: "a-new-guest-pass", auth: "psk" })).toString("base64");
		host.run(networkPage.WPA_EDIT, env("Guests", { OMNI_MODE: "manual", OMNI_BLOCK: block }));
		file = fs.readFileSync(host.file, "utf-8");
		assert.ok(!file.includes("guest-pass-here") && !file.includes("a-new-guest-pass"), "the old password gone, the new one only as its key");
		assert.equal((file.match(/ssid=477565737473/g) || []).length, 1, "one entry for it");
		assert.deepEqual(priorities(file).Guests, { priority: 0, disabled: true });
		assert.equal(fs.statSync(host.file).mode & 0o777, 0o600);

		assert.match(host.run(networkPage.WPA_EDIT, env("Nowhere", { OMNI_MODE: "auto" })), /@@ result nothing/);
		assert.ok(!fs.existsSync(host.file + ".omnicore-new") && !fs.existsSync(host.file + ".omnicore-flags"));
	} finally {
		host.done();
	}
});

test("Edit: what it changes, and a new password for the network in use tried like a join", async () => {
	const wpaTarget = async () => ({ manager: "wpa_supplicant", card: "wlan0", config: "/etc/wpa_supplicant/wpa_supplicant.conf" });
	const knownOutput = "@@ known\nother|auto|\"Home\"\nother|manual|\"Guests\"\n";
	const onHome = async () => ({ card: { connected: true, ssid: "Home" } });
	const saved = [];
	const passwords = { list: () => [], save: (...args) => saved.push(args) };
	const ran = [];
	const run = async (script, options) => {
		if (script === networkPage.KNOWN_WPA) return knownOutput;
		ran.push({ script, options });
		return "@@ result changed";
	};
	const deps = { target: wpaTarget, now: onHome, run, passwords };

	// Only "Join automatically", for a network not in use: written, and wpa_supplicant told
	assert.deepEqual(await networkPage.edit({ ssid: "Guests", auto: true }, deps), { saved: true });
	assert.equal(ran[0].script, networkPage.WPA_EDIT);
	assert.equal(ran[0].options.env.OMNI_MODE, "auto");
	assert.equal(ran[0].options.env.OMNI_RELOAD, "1");
	assert.equal(ran[0].options.env.OMNI_BLOCK, "");
	assert.deepEqual(saved, [], "no password, nothing saved");

	// The network in use: never told (it would let go of it for a moment)
	await networkPage.edit({ ssid: "Home", auto: false }, deps);
	assert.equal(ran[1].options.env.OMNI_RELOAD, "0");
	assert.equal(ran[1].options.env.OMNI_MODE, "manual");

	// A new password for a network not in use: written, and kept for Show password
	await networkPage.edit({ ssid: "Guests", auto: false, auth: "psk", password: "guests-welcome-3" }, deps);
	assert.ok(ran[2].options.env.OMNI_BLOCK.length > 0);
	assert.ok(!JSON.stringify(ran[2].options.env).includes("guests-welcome-3"), "the password never leaves as typed");
	assert.deepEqual(saved, [["Guests", "guests-welcome-3", "psk"]]);

	// A new password for the network in use: a join, not an edit
	const answer = await networkPage.edit({ ssid: "Home", auto: true, auth: "psk", password: "home-new-pass-1" }, deps);
	assert.deepEqual(answer.join, { ssid: "Home", auth: "psk", password: "home-new-pass-1", auto: true });
	assert.equal(ran.length, 3, "nothing run for it here");

	await assert.rejects(networkPage.edit({ ssid: "Nowhere", auto: true }, deps), (error) => error.status === 404);
	await assert.rejects(networkPage.edit({ ssid: "Guests", auth: "psk", password: "short" }, deps), (error) => error.status === 400);

	// NetworkManager: autoconnect and the key on each of its connections
	const nmRan = [];
	await networkPage.edit(
		{ ssid: "Cafe", auto: false, auth: "psk", password: "correct horse battery" },
		{
			target: async () => ({ manager: "networkmanager", card: "wlan0" }),
			now: onHome,
			passwords,
			run: async (script, options) => {
				if (script === networkPage.KNOWN_NM) return "@@ known\n0b8e3c52-1111-4c4c-9d9d-123456789abc|yes|Cafe\n";
				nmRan.push({ script, options });
				return "@@ result changed";
			}
		}
	);
	assert.equal(nmRan[0].script, networkPage.NM_EDIT);
	assert.equal(nmRan[0].options.env.OMNI_AUTO, "no");
	assert.equal(nmRan[0].options.env.OMNI_KEY, networkSetup.wpaKey("correct horse battery", "Cafe"), "the key, never the password");
});

test("the routes: Edit, the widget's check, and Show password", async () => {
	const realConnect = networkSetup.connect;
	const realEdit = networkPage.edit;
	const { server, base, post } = await serve();
	const joins = [];
	try {
		status.reset();
		status.setState("online");
		networkPage.resetShows();
		networkSetup.connect = async (network, report) => {
			joins.push(network);
			report({ phase: network.check ? "checked" : "connected", ssid: network.ssid });
			return { ok: true };
		};

		// Edit, only "Join automatically": answered at once
		networkPage.edit = async () => ({ saved: true });
		const saved = await post(networkPage.EDIT_PATH, { ssid: "Guests", auto: false });
		assert.equal(saved.status, 200);

		// A new password for the network in use: started like a join
		let cleaned = false;
		networkPage.edit = async () => ({ join: { ssid: "Home", auth: "psk", password: "home-new-pass-1", auto: true }, cleanup: async () => { cleaned = true; } });
		assert.equal((await post(networkPage.EDIT_PATH, { ssid: "Home", auth: "psk", password: "home-new-pass-1" })).status, 202);
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(joins.at(-1).ssid, "Home");
		assert.equal(cleaned, true, "the old connections go once it works");

		// The widget's check: a join that only checks
		assert.equal((await post(networkPage.CHECK_PATH, { ssid: "Lobby", auth: "psk", password: "short" })).status, 400);
		assert.equal((await post(networkPage.CHECK_PATH, { ssid: "Lobby", auth: "psk", password: "lobby-guests-1" })).status, 202);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(joins.at(-1), { ssid: "Lobby", auth: "psk", password: "lobby-guests-1", check: true });
		const last = await (await fetch(base + networkPage.JOIN_PATH)).json();
		assert.equal(last.last.phase, "checked", "kept for a page that lost the server meanwhile");
		assert.ok(!JSON.stringify(last).includes("lobby-guests"), "never the password");

		// No admin account in this folder, so no password is the admin's
		const show = await post(networkPage.PASSWORD_SHOW_PATH, { ssid: "Home", adminPassword: "anything" });
		assert.equal(show.status, 401);
		assert.equal(show.headers.get("cache-control"), "no-store");

		// None of them while the takeover's own setup has the card
		status.setState("disconnected");
		assert.equal((await post(networkPage.EDIT_PATH, { ssid: "Home", auto: true })).status, 409);
		assert.equal((await post(networkPage.CHECK_PATH, { ssid: "Lobby", auth: "open" })).status, 409);

		const page = await (await fetch(base + networkPage.PAGE_PATH)).text();
		assert.ok(page.includes("Known networks") && page.includes("Networks around"));
		assert.ok(!page.includes("Saved passwords"), "no box of its own any more");
	} finally {
		networkSetup.connect = realConnect;
		networkPage.edit = realEdit;
		networkPage.resetShows();
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
