// test/network-watcher.test.js
// Network Management's second part (since 2.0.0): deciding what every face
// shows about the network, and getting it there.
//
//   - Online, no internet, disconnected: worked out from the internet
//     check and, only when that fails, the Wi-Fi
//   - Not jumping at shadows: nothing bad in the first 90 seconds, and a
//     bad state only once it has lasted 30
//   - The Wi-Fi coming back after a disconnect: the drawer with its
//     signal on dashboards, and live speeds from the card's counters
//   - Every kind of face gets the stream; only dashboards get the
//     drawer for the Wi-Fi coming back; a page opened during an outage
//     shows it at once
//   - Every page OmniCore draws, and every theme's, gets the client
//
// The clock, the internet check and the Wi-Fi are stand-ins.

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

const watcher = require("../core/network-watcher");
const status = require("../core/network-status");
const networkHelper = require("../core/network-helper");

// A watcher on a clock the test moves, with the internet and the Wi-Fi as
// the test says, and everything it would show written down
function rig() {
	const world = { internet: true, wifi: "connected", available: true, joining: false };
	let clock = 1000000;
	const said = [];
	const speeds = [];
	const fakeStatus = {
		setState: (state) => said.push(state),
		showReconnected: (bars) => said.push(`reconnected:${bars}`),
		showSpeed: (down, up) => speeds.push([down, up])
	};
	const found = () => {
		if (!world.available) return { available: false, reason: "no-docker" };
		return {
			available: true,
			wifi: [{ name: "wlan0", connected: world.wifi === "connected", bars: 3 }],
			wired: [{ name: "eth0", cable: world.wifi === "cable" }]
		};
	};
	let counted = null;
	const w = watcher.createWatcher({
		checkInternet: async () => world.internet,
		probe: async () => found(),
		now: () => clock,
		status: fakeStatus,
		busy: () => world.joining,
		watchCounters: async (card, seconds, onSample) => {
			counted = { card, seconds };
			onSample({ down: 125000, up: 4000 });
		}
	});
	return {
		world,
		said,
		speeds,
		counted: () => counted,
		w,
		at: (seconds) => {
			clock = 1000000 + seconds * 1000;
		}
	};
}

test("what the Wi-Fi means when the internet doesn't work", () => {
	assert.equal(watcher.readNetwork({ available: true, wifi: [{ connected: true }], wired: [] }).state, "no-internet");
	assert.equal(watcher.readNetwork({ available: true, wifi: [{ connected: false }], wired: [{ cable: true }] }).state, "no-internet", "a cable plugged in");
	assert.equal(watcher.readNetwork({ available: true, wifi: [{ connected: false }], wired: [{ cable: false }] }).state, "disconnected");
	assert.equal(watcher.readNetwork({ available: false, reason: "no-docker" }).state, "no-internet", "can't look: says only what it knows");
});

test("online at once; the internet going needs 30 seconds, and the first 90 are quiet", async () => {
	const r = rig();
	r.at(0);
	assert.equal(await r.w.check(), watcher.CHECK_WHEN_FINE_MS);
	assert.deepEqual(r.said, ["online"]);

	r.world.internet = false;
	r.at(10);
	assert.equal(await r.w.check(), watcher.CHECK_WHILE_UNSURE_MS, "not yet: 90 seconds after starting");
	r.at(60);
	await r.w.check();
	assert.deepEqual(r.said, ["online"], "still within the first 90 seconds");
	r.at(90);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "no-internet"], "80 seconds of it, and past 90: said");
	assert.equal(await r.w.check(), watcher.CHECK_WHEN_WRONG_MS);

	r.world.internet = true;
	r.at(100);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "no-internet", "online"], "good news at once");
});

test("joining another network on purpose: nothing said while it switches", async () => {
	const r = rig();
	r.at(0);
	await r.w.check();
	r.world.joining = true;
	r.world.internet = false;
	r.world.wifi = "gone";
	r.at(100);
	assert.equal(await r.w.check(), watcher.CHECK_WHILE_UNSURE_MS);
	r.at(160);
	await r.w.check();
	assert.deepEqual(r.said, ["online"], "a minute without the Wi-Fi, and no takeover");
	// Done, and it didn't work out: from then on, as usual
	r.world.joining = false;
	r.at(170);
	await r.w.check();
	r.at(200);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "disconnected"]);
});

test("a blip shorter than 30 seconds is never shown", async () => {
	const r = rig();
	r.at(0);
	await r.w.check();
	r.world.internet = false;
	r.at(200);
	await r.w.check();
	r.at(220);
	await r.w.check();
	r.world.internet = true;
	r.at(225);
	await r.w.check();
	assert.deepEqual(r.said, ["online"]);
});

test("the Wi-Fi gone: disconnected; back: online, the drawer with its signal, and live speeds", async () => {
	const r = rig();
	r.at(0);
	await r.w.check();
	r.world.internet = false;
	r.world.wifi = "gone";
	r.at(100);
	await r.w.check();
	r.at(130);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "disconnected"]);

	r.world.internet = true;
	r.world.wifi = "connected";
	r.at(160);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "disconnected", "online", "reconnected:3"]);
	assert.deepEqual(r.counted(), { card: "wlan0", seconds: 10 });
	assert.deepEqual(r.speeds, [[125000, 4000]]);
});

test("no-internet to online isn't the Wi-Fi coming back: no drawer", async () => {
	const r = rig();
	r.at(0);
	await r.w.check();
	r.world.internet = false;
	r.at(100);
	await r.w.check();
	r.at(140);
	await r.w.check();
	r.world.internet = true;
	r.at(150);
	await r.w.check();
	assert.deepEqual(r.said, ["online", "no-internet", "online"]);
});

test("disconnected changing to no-internet waits its 30 seconds too", async () => {
	const r = rig();
	r.world.internet = false;
	r.world.wifi = "gone";
	r.at(0);
	await r.w.check();
	r.at(95);
	await r.w.check();
	assert.deepEqual(r.said, ["disconnected"], "from the start, once past 90 seconds");
	r.world.wifi = "cable";
	r.at(100);
	await r.w.check();
	assert.deepEqual(r.said, ["disconnected"]);
	r.at(131);
	await r.w.check();
	assert.deepEqual(r.said, ["disconnected", "no-internet"]);
});

test("OMNICORE_NETWORK_WATCH=off turns it off", () => {
	process.env.OMNICORE_NETWORK_WATCH = "off";
	try {
		assert.equal(watcher.start(), null);
	} finally {
		delete process.env.OMNICORE_NETWORK_WATCH;
	}
});

test("live speeds: bytes a second from the card's counters", async () => {
	const samples = [];
	let script = "";
	await networkHelper.watchCounters("wlan0", 3, (sample) => samples.push(sample), {
		run: async (given, options) => {
			script = given;
			options.onLine("@@ count 1000 500");
			await new Promise((resolve) => setTimeout(resolve, 250));
			options.onLine("@@ count 2000 600");
			options.onLine("noise");
		}
	});
	assert.match(script, /\/sys\/class\/net\/wlan0\/statistics/);
	assert.equal(samples.length, 1);
	assert.ok(samples[0].down > 2000 && samples[0].down <= 5000, "about 1000 bytes in a quarter second");
	await assert.rejects(networkHelper.watchCounters("wlan0; rm -rf /", 3, () => {}), /name/);
});

// --- The stream ----------------------------------------------------------

async function listen(kind) {
	const app = express();
	status.attach(app, kind);
	const server = await new Promise((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	return server;
}

// Read a stream until `until` says it has what it needs
async function read(server, until) {
	const controller = new AbortController();
	const response = await fetch(`http://127.0.0.1:${server.address().port}${status.EVENTS_PATH}`, { signal: controller.signal });
	assert.equal(response.headers.get("content-type"), "text/event-stream");
	const reader = response.body.getReader();
	let text = "";
	const deadline = Date.now() + 3000;
	// One read at a time: a read still waiting when the 200 ms are up is
	// kept for the next turn, so nothing that arrives late is lost
	let pending = null;
	while (!until(text) && Date.now() < deadline) {
		if (!pending) pending = reader.read();
		const { value, done, waited } = await Promise.race([
			pending,
			new Promise((resolve) => setTimeout(() => resolve({ waited: true }), 200))
		]);
		if (waited) continue;
		pending = null;
		if (done) break;
		if (value) text += Buffer.from(value).toString("utf-8");
	}
	controller.abort();
	return text;
}

test("the stream: a page opened during an outage hears it at once", async () => {
	status.reset();
	status.setState("no-internet");
	const server = await listen("other");
	try {
		const text = await read(server, (t) => t.includes("no-internet"));
		assert.match(text, /event: state\ndata: \{"state":"no-internet"\}/);
	} finally {
		server.close();
		status.reset();
	}
});

test("the drawer for the Wi-Fi coming back: dashboards only, with no network's name", async () => {
	status.reset();
	status.setState("disconnected");
	status.setState("online");
	status.showReconnected(2);
	status.showSpeed(1500000, 20000);
	const dashboard = await listen("dashboard");
	const settings = await listen("other");
	try {
		const onDashboard = await read(dashboard, (t) => t.includes("speed"));
		assert.match(onDashboard, /event: reconnected\ndata: \{"bars":2,"ms":\d+\}/);
		assert.match(onDashboard, /event: speed\ndata: \{"down":1500000,"up":20000\}/);
		const onSettings = await read(settings, (t) => t.includes("online"));
		assert.ok(!onSettings.includes("reconnected"), "not on Settings");
		assert.ok(!/ssid|name/i.test(onDashboard), "nothing to look up");
	} finally {
		dashboard.close();
		settings.close();
		status.reset();
	}
});

test("every page OmniCore draws, and every theme's, gets the drawer and the takeover", () => {
	assert.ok(require("../core/page-motion").pageStart().includes(status.CLIENT_HTML));
	assert.ok(require("../core/face-events").clientBundle({}).includes(status.CLIENT_HTML));
	// It parses, and it runs once per page however often it's included
	new Function(status.CLIENT_SCRIPT);
	assert.ok(status.CLIENT_SCRIPT.includes("window.__omniNetworkStatus"));
	assert.ok(status.CLIENT_SCRIPT.includes('"omnicore:network"'), "the event a theme hears");
	assert.ok(status.CLIENT_SCRIPT.includes("data-omnicore-network"));
	assert.ok(status.CLIENT_SCRIPT.includes("Wi-Fi disconnected"));
	assert.ok(status.CLIENT_CSS.includes("pointer-events: none"), "the drawer lets every touch through");
	assert.ok(!/blur\(/.test(status.CLIENT_CSS.split(".omni-net-takeover")[0]), "the drawer is clear glass: no blur");
	assert.ok(status.CLIENT_SCRIPT.includes("prefers-reduced-motion"));
});

test("every kind of face has the stream, Settings' sign-in included", () => {
	const fs = require("fs");
	for (const [file, kind] of [
		["core/face-loader.js", "dashboard"],
		["core/input-face-loader.js", "other"],
		["core/control-face.js", "other"],
		["core/wizard-face.js", "other"],
		["core/about-face.js", "other"],
		["core/admin-face.js", "admin"]
	]) {
		const source = fs.readFileSync(require("path").join(__dirname, "..", file), "utf-8");
		assert.ok(source.includes(`require("./network-status").attach(app, "${kind}");`), file);
	}
	const admin = fs.readFileSync(require("path").join(__dirname, "..", "core/admin-face.js"), "utf-8");
	assert.ok(admin.indexOf('attach(app, "admin")') < admin.indexOf("Gate everything except the setup and login endpoints"), "before sign-in");
});

test("joining a network's steps, with its name: the admin face's stream only", async () => {
	status.reset();
	status.setState("online");
	const admin = await listen("admin");
	const theme = await listen("dashboard");
	const other = await listen("other");
	try {
		const reading = [
			read(admin, (t) => t.includes("Kitchen")),
			read(theme, (t) => t.includes("Kitchen")),
			read(other, (t) => t.includes("Kitchen"))
		];
		await new Promise((resolve) => setTimeout(resolve, 300));
		status.broadcastSetup({ phase: "connecting", ssid: "Kitchen" });
		status.broadcastMode("manual");
		const [onAdmin, onTheme, onOther] = await Promise.all(reading);
		assert.match(onAdmin, /event: setup\ndata: \{"phase":"connecting","ssid":"Kitchen"\}/);
		assert.ok(!onTheme.includes("Kitchen") && !onTheme.includes("setup-mode"), "a theme never hears a network's name");
		assert.ok(!onOther.includes("Kitchen") && !onOther.includes("setup-mode"));
	} finally {
		admin.close();
		theme.close();
		other.close();
		status.reset();
	}
});
