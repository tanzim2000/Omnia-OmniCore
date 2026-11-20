// test/network-hotspot.test.js
// The setup hotspot and OmniSync (since 2.0.0).
//
//   - The QR code: only OmniSync's key reads it; the hotspot's name and
//     password are in it and nowhere on the page in words
//   - The reply: only this OmniCore, in this session, reads it, and once
//   - OmniSync first: disconnected, a card that can, a hotspot, the QR
//     code; a card that can't, or a hotspot that fails, Manual Setup
//   - "Set up manually" turns the hotspot off
//   - Rounds: a hotspot ends, things are put back, the old network gets
//     its minute, then a new round with a new name and password
//   - OmniSync's network: hotspot off, joined; if that fails, a new round
//   - The routes: disconnected only, JSON only
//
// The host is a stand-in. The scripts were run through the real helper
// while this was written: a hotspot that can't start puts wpa_supplicant
// back, and a hotspot stopped mid-round unpauses it.

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const omnisync = require("../core/omnisync");
const hotspot = require("../core/network-hotspot");
const status = require("../core/network-status");

test("the QR code: OmniSync reads it, and it holds what the phone needs", () => {
	const session = omnisync.createSession();
	const text = omnisync.qrText(session);
	assert.ok(text.startsWith("OMNISYNC:1:"));
	assert.ok(!text.includes(session.password) && !text.includes(session.ssid), "nothing readable without OmniSync's key");
	const read = omnisync.readQr(text);
	assert.deepEqual(
		{ ssid: read.ssid, password: read.password, host: read.host, port: read.port, session: read.session, key: read.key },
		{ ssid: session.ssid, password: session.password, host: "10.42.0.1", port: 3000, session: session.id, key: session.publicKey }
	);
	assert.match(session.ssid, /^OmniCore-[A-Za-z2-9]{6}$/);
	assert.match(session.password, /^[A-Za-z2-9]{16}$/);
	assert.notEqual(omnisync.createSession().password, session.password, "new every round");
});

test("the reply: only this session reads it, and only once", () => {
	const session = omnisync.createSession();
	const qr = omnisync.readQr(omnisync.qrText(session));
	const reply = omnisync.makeReply(qr, { ssid: "Home", password: "correct horse battery" });
	assert.ok(!JSON.stringify(reply).includes("correct horse"));

	const other = omnisync.createSession();
	assert.throws(() => omnisync.readReply(other, reply), /another setup/);
	assert.throws(() => omnisync.readReply(other, { ...reply, session: other.id }), "another session's key can't open it");

	assert.deepEqual(omnisync.readReply(session, reply), { ssid: "Home", password: "correct horse battery", auth: undefined });
	assert.throws(() => omnisync.readReply(session, reply), /No setup is waiting/);

	const tampered = omnisync.makeReply(omnisync.readQr(omnisync.qrText(omnisync.createSession())), { ssid: "X" });
	const fresh = omnisync.createSession();
	assert.throws(() => omnisync.readReply(fresh, { ...tampered, session: fresh.id }));
	assert.throws(() => omnisync.readReply(fresh, { session: fresh.id, key: "!!", nonce: "", data: "" }));
});

// A pretend host for the controller
function rig(options = {}) {
	const modes = [];
	const ran = [];
	const hotspots = [];
	const joined = [];
	const helper = {
		runOnHost: async (script, opts) => {
			ran.push(script === hotspot.RESTORE_WPA ? "restore-wpa" : script === hotspot.RESTORE_NM ? "restore-nm" : "other");
			return "@@ result restored";
		},
		startOnHost: async (script, opts) => {
			if (options.cantStart) throw new Error("no Docker");
			let end;
			const finished = new Promise((resolve) => { end = resolve; });
			const one = {
				script: script === hotspot.HOTSPOT_NM ? "nm" : "wpa",
				env: opts.env,
				say: (line) => opts.onLine(line),
				end: () => end(),
				stopped: false,
				finished,
				stop: async () => { one.stopped = true; end(); await finished; }
			};
			hotspots.push(one);
			if (options.fails) { opts.onLine("@@ failed hostapd"); setImmediate(end); }
			else setImmediate(() => opts.onLine("@@ ready"));
			return one;
		}
	};
	const control = hotspot.createController({
		helper,
		status: { broadcastMode: (mode) => modes.push(mode), broadcastSetup: () => {} },
		target: async () => options.target || { manager: "wpa_supplicant", card: "wlan0", config: "/etc/wpa_supplicant/wpa_supplicant.conf" },
		capable: async () => options.radio || { capable: true, alongside: true },
		join: async (network) => {
			joined.push(network);
			return { ok: !options.joinFails };
		},
		restMs: 20,
		roundSeconds: 600
	});
	return { control, modes, ran, hotspots, joined };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("disconnected, a card that can: a hotspot, then the QR code", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	assert.deepEqual(r.modes, ["starting", "omnisync"]);
	assert.equal(r.hotspots.length, 1);
	const env = r.hotspots[0].env;
	assert.match(env.OMNI_SSID, /^OmniCore-/);
	assert.equal(env.OMNI_ALONGSIDE, "1");
	assert.equal(env.OMNI_ROUND, "600");
	assert.match(r.control.qr(), /^<svg/);
	assert.ok(!r.control.qr().includes(env.OMNI_PSK), "the drawing carries no text");
});

test("a card that can't, or nothing to change: straight to Manual Setup", async () => {
	const r = rig({ radio: { capable: false } });
	r.control.onState("disconnected");
	await tick(150);
	assert.deepEqual(r.modes, ["manual"]);
	assert.equal(r.hotspots.length, 0);

	const none = rig({ target: { problem: "no card" } });
	none.control.onState("disconnected");
	await tick(150);
	assert.deepEqual(none.modes, ["manual"]);
});

test("a hotspot that doesn't come up: Manual Setup, with things put back", async () => {
	const r = rig({ fails: true });
	r.control.onState("disconnected");
	await tick(150);
	assert.equal(r.modes.at(-1), "manual");
	assert.ok(r.ran.includes("restore-wpa"));
	const cant = rig({ cantStart: true });
	cant.control.onState("disconnected");
	await tick(150);
	assert.equal(cant.modes.at(-1), "manual");
});

test("Set up manually: the hotspot off, then Manual Setup", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	assert.equal(await r.control.chooseManual(), true);
	assert.equal(r.hotspots[0].stopped, true);
	assert.equal(r.modes.at(-1), "manual");
	await tick(300);
	assert.equal(r.hotspots.length, 1, "no new round after choosing manual");
});

test("rounds: a hotspot ends, things put back, a minute for the old network, a new round", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	const first = r.hotspots[0].env.OMNI_PSK;
	r.hotspots[0].end();
	await tick(300);
	assert.deepEqual(r.modes, ["starting", "omnisync", "resting", "starting", "omnisync"]);
	assert.ok(r.ran.includes("restore-wpa"));
	assert.equal(r.hotspots.length, 2);
	assert.notEqual(r.hotspots[1].env.OMNI_PSK, first, "a new password");
	assert.equal(r.modes.at(-1), "omnisync");
});

test("the Wi-Fi back: hotspot stopped, nothing more", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	r.control.onState("online");
	await tick(300);
	assert.equal(r.hotspots[0].stopped, true);
	assert.equal(r.modes.at(-1), "off");
	assert.equal(r.hotspots.length, 1);
});

test("OmniSync sends the network: hotspot off, joined; if that fails, a new round", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	const qr = omnisync.readQr(omnisync.qrText(r.control.session()));
	const reply = omnisync.makeReply(qr, { ssid: "Home", password: "correct horse battery" });
	assert.deepEqual(await r.control.omnisyncReply(reply), { accepted: true });
	await tick(150);
	assert.equal(r.hotspots[0].stopped, true);
	assert.deepEqual(r.joined, [{ ssid: "Home", password: "correct horse battery", auth: "psk" }]);
	assert.ok(r.modes.includes("joining"));
	await assert.rejects(r.control.omnisyncReply(reply), /isn't waiting/);

	const bad = rig({ joinFails: true });
	bad.control.onState("disconnected");
	await tick(150);
	const qr2 = omnisync.readQr(omnisync.qrText(bad.control.session()));
	await bad.control.omnisyncReply(omnisync.makeReply(qr2, { ssid: "Home", password: "wrong-password" }));
	await tick(150);
	assert.equal(bad.hotspots.length, 2, "a new round for another try");
	assert.equal(bad.modes.at(-1), "omnisync");
});

test("a reply that doesn't read, or isn't a usable network, is refused", async () => {
	const r = rig();
	r.control.onState("disconnected");
	await tick(150);
	await assert.rejects(r.control.omnisyncReply({ session: "nope" }), (error) => error.status === 400);
	const qr = omnisync.readQr(omnisync.qrText(r.control.session()));
	await assert.rejects(r.control.omnisyncReply(omnisync.makeReply(qr, { ssid: "Home", password: "short" })), /8 to 63/);
	assert.deepEqual(
		await r.control.omnisyncReply(omnisync.makeReply(qr, { ssid: "Home", password: "long enough now" })),
		{ accepted: true },
		"a refused network doesn't use up the round: OmniSync can send it again, fixed"
	);
});

test("NetworkManager: its own hotspot, and its own way back", async () => {
	const r = rig({ target: { manager: "networkmanager", card: "wlan0" } });
	r.control.onState("disconnected");
	await tick(150);
	assert.equal(r.hotspots[0].script, "nm");
	r.control.onState("online");
	await tick(150);
	assert.equal(r.hotspots[0].stopped, true);
});

test("the routes: disconnected only, JSON only", async () => {
	const app = express();
	hotspot.attach(app, express);
	const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		status.reset();
		status.setState("online");
		assert.equal((await fetch(base + hotspot.MODE_PATH)).status, 409);
		const omni = await fetch(base + hotspot.OMNISYNC_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
		assert.equal(omni.status, 409);
		status.setState("disconnected");
		const form = await fetch(base + hotspot.MANUAL_PATH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=b" });
		assert.equal(form.status, 415);
		const nothing = await fetch(base + hotspot.OMNISYNC_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
		assert.equal(nothing.status, 409, "no QR code on screen, nothing to answer");
	} finally {
		status.reset();
		server.close();
	}
});

test("the hotspot scripts: rounds end by themselves, things are put back, no DNS", () => {
	for (const script of [hotspot.HOTSPOT_WPA, hotspot.HOTSPOT_NM]) {
		assert.ok(script.includes('sleep "$OMNI_ROUND" & wait $!'), "a round ends by itself");
		assert.ok(script.includes("trap undo TERM INT"), "stopping it puts things back");
	}
	assert.ok(hotspot.HOTSPOT_WPA.includes('kill -STOP "$wpa"') && hotspot.HOTSPOT_WPA.includes('kill -CONT "$wpa"'));
	assert.ok(hotspot.HOTSPOT_WPA.includes("--port=0"), "no DNS: nothing on the server is in its way");
	assert.ok(hotspot.RESTORE_WPA.includes('kill -CONT "$wpa"'));
});
