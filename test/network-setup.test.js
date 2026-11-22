// test/network-setup.test.js
// Manual Setup (since 2.0.0): joining a Wi-Fi network from the takeover.
//
//   - What's typed is checked, in words for the screen
//   - The network is written down safely: the name in hex, a WPA/WPA2
//     password as the key wpa_passphrase works out (never as typed)
//   - Joining: change, wait for the card to join, nudge DHCP, wait for the
//     internet, keep it; or, within a minute, put everything back
//   - It's only open while the Wi-Fi is disconnected, only takes JSON, and
//     its page can only be framed by this server's own faces
//
// The helper and the internet are stand-ins here. The scripts themselves
// were run against a pretend host (a settings file, a wpa_supplicant and a
// udhcpc that record their signals) through the real helper while this
// was written.

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

// A data folder of its own: a join that works saves its password there
// (network-passwords.js), never in the project's own data folder
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnicore-setup-"));
process.env.OMNICORE_DATA_DIR = dataDir;

const setup = require("../core/network-setup");
const status = require("../core/network-status");
const passwords = require("../core/network-passwords");

test("what's typed is checked", () => {
	assert.equal(setup.problemWith({ ssid: "Home", auth: "open" }), null);
	assert.equal(setup.problemWith({ ssid: "Home", auth: "psk", password: "12345678" }), null);
	assert.equal(setup.problemWith({ ssid: "Home", auth: "psk", password: "a".repeat(64).replace(/a/g, "f") }), null, "the 64-character key itself");
	assert.match(setup.problemWith({ ssid: "Home", auth: "psk", password: "short" }), /8 to 63/);
	assert.match(setup.problemWith({ ssid: "Home", auth: "psk", password: "" }), /password/);
	assert.match(setup.problemWith({ ssid: "", auth: "open" }), /Choose/);
	assert.match(setup.problemWith({ ssid: "x".repeat(33), auth: "open" }), /Choose/, "a name is at most 32 bytes");
	assert.match(setup.problemWith({ ssid: "Work", auth: "unsupported" }), /can't join/);
	assert.match(setup.problemWith({ ssid: "W3", auth: "sae", password: 'has"quote' }), /character/);
});

test("the network written down: name in hex, the key and never the password", () => {
	const block = setup.wpaBlock({ ssid: "New Place", password: "correct horse battery", auth: "psk" });
	assert.equal(block, [
		"# Added by OmniCore",
		"network={",
		"\tssid=4e657720506c616365",
		// What `wpa_passphrase "New Place" "correct horse battery"` prints
		"\tpsk=3413cbaabf8b108cb6f7e0bbd5c2fd549aa0878b4f4004acebf72446aab373b0",
		// The script writes the number in: one above the highest in the file
		"\tpriority=OMNICORE_PRIORITY",
		"}"
	].join("\n"));
	assert.ok(!block.includes("correct horse"));
	assert.match(setup.wpaBlock({ ssid: "Cafe", auth: "open" }), /key_mgmt=NONE/);
	const wpa3 = setup.wpaBlock({ ssid: "W3", auth: "sae", password: "sae-pass" });
	assert.match(wpa3, /key_mgmt=SAE\n\tsae_password="sae-pass"\n\tieee80211w=2/);
	assert.equal(setup.toHex('a"b\n'), "6122620a", "no name can break the file");
});

// A pretend host for connect(): what each script answers, and every
// script that ran, in order
function host(answers) {
	const ran = [];
	const run = async (script, options) => {
		const name =
			script === setup.WPA_APPLY ? "apply"
			: script === setup.WPA_KEEP ? "keep"
			: script === setup.WPA_UNDO ? "undo"
			: script === setup.NUDGE_DHCP ? "nudge"
			: script === setup.NM_APPLY ? "nm-apply"
			: script === setup.NM_UNDO ? "nm-undo"
			: /iw dev "\$OMNI_CARD" link/.test(script) ? "link"
			: "other";
		ran.push({ name, options });
		const answer = answers[name];
		return typeof answer === "function" ? answer() : answer || "";
	};
	return { ran, run, names: () => ran.map((step) => step.name) };
}

const WPA_TARGET = async () => ({ manager: "wpa_supplicant", card: "wlan0", config: "/etc/wpa_supplicant/wpa_supplicant.conf" });

function clock() {
	let at = 0;
	return { now: () => at, wait: async (ms) => { at += ms; } };
}

test("joining: changed, joined, DHCP nudged, online, kept", async () => {
	const h = host({ apply: "@@ result applied", link: "Connected to aa:bb (on wlan0)\n\tSSID: New Place\n\tsignal: -50 dBm", keep: "@@ result kept" });
	const steps = [];
	let lookedForInternet = 0;
	const c = clock();
	const outcome = await setup.connect(
		{ ssid: "New Place", password: "correct horse battery", auth: "psk" },
		(step) => steps.push(step.phase),
		{ run: h.run, target: WPA_TARGET, internetWorks: async () => ++lookedForInternet >= 2, ...c }
	);
	assert.deepEqual(outcome, { ok: true });
	assert.deepEqual(h.names(), ["apply", "link", "nudge", "keep"]);
	assert.deepEqual(steps, ["connecting", "joined", "connected"]);

	const apply = h.ran[0].options;
	assert.deepEqual(apply.writable, ["/etc/wpa_supplicant"], "only the settings file's folder is writable");
	assert.equal(apply.env.OMNI_SSID_QUOTED, '"New Place"');
	assert.ok(!JSON.stringify(apply.env).includes("correct horse"), "the password never leaves as typed");

	// It worked, so the password is kept, encrypted, for the Guest Wi-Fi
	// widget, and the widget knows which network the server is on now
	assert.deepEqual(passwords.reveal("New Place"), { ssid: "New Place", auth: "psk", password: "correct horse battery" });
	assert.equal(await passwords.currentSsid({ probe: async () => { throw new Error("not asked"); } }), "New Place");
});

test("a wrong password: never joins, and within the minute it's all put back", async () => {
	const h = host({ apply: "@@ result applied", link: "Not connected.", undo: "@@ result undone" });
	const steps = [];
	const c = clock();
	const outcome = await setup.connect(
		{ ssid: "New Place", password: "wrong-password", auth: "psk" },
		(step) => steps.push(`${step.phase}${step.message ? ": " + step.message : ""}`),
		{ run: h.run, target: WPA_TARGET, internetWorks: async () => false, ...c, tryForMs: 9000 }
	);
	assert.deepEqual(outcome, { ok: false, reason: "not-joined" });
	assert.deepEqual(h.names(), ["apply", "link", "link", "link", "undo"]);
	assert.deepEqual(steps, ["connecting", "failed: Couldn't join New Place. Check the password and try again."]);
	assert.equal(passwords.reveal("New Place").password, "correct horse battery", "a wrong password is never saved over the right one");
});

test("joined, but no internet: put back too, and said so", async () => {
	const h = host({ apply: "@@ result applied", link: "Connected to aa:bb\n\tSSID: New Place" });
	const steps = [];
	const c = clock();
	const outcome = await setup.connect(
		{ ssid: "New Place", password: "correct horse battery", auth: "psk" },
		(step) => steps.push(step.message || step.phase),
		{ run: h.run, target: WPA_TARGET, internetWorks: async () => false, ...c, tryForMs: 9000 }
	);
	assert.equal(outcome.reason, "no-internet");
	assert.equal(h.names().at(-1), "undo");
	assert.match(steps.at(-1), /has no internet, so OmniCore put the old settings back/);
});

test("a join that doesn't work keeps no password", async () => {
	const h = host({ apply: "@@ result applied", link: "Not connected.", undo: "@@ result undone" });
	await setup.connect(
		{ ssid: "Never Joined", password: "some password here", auth: "psk" },
		() => {},
		{ run: h.run, target: WPA_TARGET, internetWorks: async () => false, ...clock(), tryForMs: 6000 }
	);
	assert.equal(passwords.has("Never Joined"), false);
});

test("a password that can't be saved never stops the join", async () => {
	const h = host({ apply: "@@ result applied", link: "Connected to aa:bb\n\tSSID: Cafe", keep: "@@ result kept" });
	const steps = [];
	const outcome = await setup.connect({ ssid: "Cafe", auth: "open" }, (step) => steps.push(step.phase), {
		run: h.run,
		target: WPA_TARGET,
		internetWorks: async () => true,
		savePassword: () => { throw new Error("disk full"); },
		...clock()
	});
	assert.deepEqual(outcome, { ok: true });
	assert.equal(steps.at(-1), "connected");
});

test("a change that couldn't be made is undone and explained", async () => {
	for (const [answer, words] of [
		["@@ result cant-write", /couldn't change the server's Wi-Fi settings/],
		["@@ result no-process", /isn't running/]
	]) {
		const h = host({ apply: answer });
		const steps = [];
		const outcome = await setup.connect({ ssid: "X", auth: "open" }, (step) => steps.push(step.message || step.phase), {
			run: h.run,
			target: WPA_TARGET,
			internetWorks: async () => true,
			...clock()
		});
		assert.equal(outcome.ok, false);
		assert.deepEqual(h.names(), ["apply", "undo"]);
		assert.match(steps.at(-1), words);
	}
});

test("nothing it can change: said in words, nothing run", async () => {
	const h = host({});
	const steps = [];
	await setup.connect({ ssid: "X", auth: "open" }, (step) => steps.push(step.message), {
		run: h.run,
		target: async () => ({ problem: "This server has no Wi-Fi card OmniCore can see." })
	});
	assert.deepEqual(h.names(), []);
	assert.deepEqual(steps, ["This server has no Wi-Fi card OmniCore can see."]);
});

test("NetworkManager: a connection of its own, brought up, and deleted if it doesn't work", async () => {
	const ok = host({ "nm-apply": "@@ result applied" });
	const c = clock();
	await setup.connect({ ssid: "Home", password: "correct horse battery", auth: "psk" }, () => {}, {
		run: ok.run,
		target: async () => ({ manager: "networkmanager", card: "wlan0" }),
		internetWorks: async () => true,
		...c
	});
	assert.deepEqual(ok.names(), ["nm-apply"], "NetworkManager joins and gets an address by itself");
	const env = ok.ran[0].options.env;
	assert.equal(env.OMNI_NAME, setup.nmName("Home"));
	assert.equal(env.OMNI_KEY, setup.wpaKey("correct horse battery", "Home"), "the key, not the password");
	assert.deepEqual(ok.ran[0].options.writable, []);

	const bad = host({ "nm-apply": "@@ result failed", "nm-undo": "@@ result undone" });
	const steps = [];
	await setup.connect({ ssid: "Home", password: "wrong-password", auth: "psk" }, (step) => steps.push(step.phase), {
		run: bad.run,
		target: async () => ({ manager: "networkmanager", card: "wlan0" }),
		internetWorks: async () => true,
		...clock()
	});
	assert.deepEqual(bad.names(), ["nm-apply", "nm-undo"]);
	assert.deepEqual(steps, ["connecting", "failed"]);
});

test("one at a time", async () => {
	let release;
	const h = host({ apply: () => new Promise((resolve) => { release = () => resolve("@@ result cant-write"); }), undo: "" });
	const first = setup.connect({ ssid: "A", auth: "open" }, () => {}, { run: h.run, target: WPA_TARGET, ...clock() });
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(setup.connect({ ssid: "B", auth: "open" }, () => {}, { run: h.run, target: WPA_TARGET }), /already joining/);
	release();
	await first;
});

// --- The routes ------------------------------------------------------------

async function serve() {
	const app = express();
	setup.attach(app);
	return new Promise((resolve) => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
	});
}

test("only open while the Wi-Fi is disconnected, and only for JSON", async () => {
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const realScan = setup.scan;
	const realConnect = setup.connect;
	let started = null;
	setup.scan = async () => ({ available: true, networks: [{ ssid: "Home", bars: 3, auth: "psk" }] });
	setup.connect = async (network) => {
		started = network;
		return { ok: true };
	};
	try {
		status.reset();
		status.setState("online");
		assert.equal((await fetch(base + setup.NEARBY_PATH)).status, 409);
		const closed = await fetch(base + setup.CONNECT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ssid: "Home", auth: "open" }) });
		assert.equal(closed.status, 409);

		status.setState("disconnected");
		const nearby = await (await fetch(base + setup.NEARBY_PATH)).json();
		assert.equal(nearby.networks[0].ssid, "Home");

		const form = await fetch(base + setup.CONNECT_PATH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "ssid=Home&auth=open" });
		assert.equal(form.status, 415, "a page elsewhere can't send it as a form");

		const short = await fetch(base + setup.CONNECT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ssid: "Home", auth: "psk", password: "short" }) });
		assert.equal(short.status, 400);
		assert.match((await short.json()).error, /8 to 63/);

		const go = await fetch(base + setup.CONNECT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ssid: "Home", auth: "psk", password: "correct horse battery" }) });
		assert.equal(go.status, 202);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(started, { ssid: "Home", auth: "psk", password: "correct horse battery" });
	} finally {
		setup.scan = realScan;
		setup.connect = realConnect;
		status.reset();
		server.close();
	}
});

test("the setup page: framed only by this server's own faces, and never itself a face", async () => {
	const server = await serve();
	try {
		const answer = await fetch(`http://127.0.0.1:${server.address().port}${setup.SETUP_PATH}`);
		assert.equal(answer.headers.get("content-security-policy"), "frame-ancestors 'self' http://127.0.0.1:* https://127.0.0.1:*");
		const page = await answer.text();
		assert.ok(page.includes("Choose a network"));
		assert.ok(page.includes('type="password"'));
		assert.ok(!page.includes("__omniNetworkStatus"), "no takeover inside the takeover");
		const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
		new Function(script);
	} finally {
		server.close();
	}
});

test("the takeover shows Manual Setup from the admin face's port", () => {
	assert.ok(status.CLIENT_SCRIPT.includes('":3000/omnicore-network/setup"'));
	assert.ok(status.CLIENT_SCRIPT.includes('frame.title = "Manual Setup"'));
});

test.after(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
});
