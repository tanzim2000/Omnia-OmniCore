// test/background.test.js
// Background modules: the shared connection manager on its own, then the
// whole lifecycle -- started, restarted, stopped -- driven the way a real
// person drives it, through the admin face over real HTTP.
//
// The modules used here are written into the sandbox by this file. They
// report what happened to them into arrays on `global`, which works
// because the suite runs every face in this same process: the module
// OmniCore loads and the test reading the arrays share one `global`.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir } = require("./helpers");

const sharedConnections = require("../core/shared-connections");
const background = require("../core/background");
const notifications = require("../core/notifications");
const faceStore = require("../core/face-store");
const { startFace } = require("../core/face-loader");
const { makeModuleApi } = require("../core/module-api");

const ADMIN_PORT = 3000;

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Long enough for a burst of joins and leaves to settle into one
// open or close, with room to spare on a slow machine
function settle() {
	return wait(sharedConnections.SETTLE_MS * 4);
}

// Poll until something is true, rather than guessing a fixed sleep
async function waitFor(check, what) {
	const deadline = Date.now() + 5000;

	while (Date.now() < deadline) {
		if (check()) {
			return;
		}

		await wait(20);
	}

	throw new Error("Timed out waiting for " + what);
}

// A pretend connection opener that records what it was asked to do,
// for testing shared-connections.js without any real server
function recordingOpener() {
	const opens = [];

	function open(context) {
		const record = { ...context, closed: false };
		opens.push(record);

		return () => {
			record.closed = true;
		};
	}

	return { opens, open };
}

// ---------------------------------------------------------------------
// The shared connection manager

test("shared connections: instances on one server share one connection", async () => {
	const { opens, open } = recordingOpener();
	const heardByA = [];
	const heardByB = [];

	const a = sharedConnections.join("test-share", {
		key: "https://one.example",
		interest: "alpha",
		open,
		onEvent: (event) => heardByA.push(event)
	});

	const b = sharedConnections.join("test-share", {
		key: "https://one.example",
		interest: "beta",
		open,
		onEvent: (event) => heardByB.push(event)
	});

	await settle();

	assert.equal(opens.length, 1, "two members, one connection");
	assert.deepEqual(opens[0].interests, ["alpha", "beta"]);

	// Routed by interest when the opener says which one an event is for,
	// and to everyone when it doesn't
	opens[0].emit("for alpha", "alpha");
	opens[0].emit("for everyone");
	await settle();

	assert.deepEqual(heardByA, ["for alpha", "for everyone"]);
	assert.deepEqual(heardByB, ["for everyone"]);

	a.leave();
	b.leave();
	await settle();

	assert.equal(opens[0].closed, true, "closed once nobody is left");
	assert.equal(opens[0].signal.aborted, true, "and its signal aborted");
	assert.equal(
		sharedConnections.list().filter((pool) => pool.moduleId === "test-share")
			.length,
		0,
		"and the pool forgotten"
	);
});

test("shared connections: a burst of joins opens once, a new interest reopens", async () => {
	const { opens, open } = recordingOpener();
	const members = [];

	// Five instances joining back to back, the way they do on boot
	for (let i = 0; i < 5; i++) {
		members.push(
			sharedConnections.join("test-burst", {
				key: "https://two.example",
				interest: "same-topic",
				open,
				onEvent: () => {}
			})
		);
	}

	await settle();
	assert.equal(opens.length, 1, "five joins, one open");
	assert.deepEqual(opens[0].interests, ["same-topic"]);

	// Someone wanting something new means the connection has to be
	// reopened with the longer list -- the old one closed, not leaked
	members.push(
		sharedConnections.join("test-burst", {
			key: "https://two.example",
			interest: "new-topic",
			open,
			onEvent: () => {}
		})
	);

	await settle();
	assert.equal(opens.length, 2);
	assert.equal(opens[0].closed, true, "the old connection was closed");
	assert.deepEqual(opens[1].interests, ["new-topic", "same-topic"]);

	// Leaving while others still want the same topic changes nothing
	members[0].leave();
	await settle();
	assert.equal(opens.length, 2, "no reopen when the list didn't change");

	for (const member of members) {
		member.leave();
	}

	await settle();
	assert.equal(opens[1].closed, true);
});

test("shared connections: different modules never share, even on one server", async () => {
	const first = recordingOpener();
	const second = recordingOpener();

	const a = sharedConnections.join("test-module-a", {
		key: "https://three.example",
		interest: "x",
		open: first.open,
		onEvent: () => {}
	});

	const b = sharedConnections.join("test-module-b", {
		key: "https://three.example",
		interest: "x",
		open: second.open,
		onEvent: () => {}
	});

	await settle();
	assert.equal(first.opens.length, 1);
	assert.equal(second.opens.length, 1, "each module opened its own");

	a.leave();
	b.leave();
	await settle();
});

test("shared connections: a dropped connection is reopened by Core", async () => {
	const { opens, open } = recordingOpener();

	const member = sharedConnections.join("test-drop", {
		key: "https://four.example",
		interest: "t",
		open,
		onEvent: () => {}
	});

	await settle();
	assert.equal(opens.length, 1);

	// The module reports the connection lost; Core waits (one second,
	// first time) and tries again on its own
	opens[0].drop(new Error("server went away"));
	assert.equal(opens[0].signal.aborted, true, "the lost one is cleaned up");

	await waitFor(() => opens.length === 2, "a reconnect");
	assert.deepEqual(opens[1].interests, ["t"]);

	// Anything late from the dead connection is ignored, not delivered
	opens[0].drop(new Error("late error from the old one"));
	await wait(1500);
	assert.equal(opens.length, 2, "a stale drop doesn't trigger another reconnect");

	member.leave();
	await settle();
});

test("shared connections: a failing opener is retried, a failing listener costs one event", async () => {
	let attempts = 0;
	const heard = [];
	let emit;

	// One opener for both, as two instances of one module would have
	const open = (context) => {
		attempts++;

		if (attempts === 1) {
			throw new Error("couldn't connect");
		}

		emit = context.emit;
	};

	const member = sharedConnections.join("test-failures", {
		key: "https://five.example",
		open,
		onEvent: () => {
			throw new Error("listener bug");
		}
	});

	const healthy = sharedConnections.join("test-failures", {
		key: "https://five.example",
		open,
		onEvent: (event) => heard.push(event)
	});

	await waitFor(() => attempts === 2, "a retry after the first open threw");

	emit("hello");
	await settle();
	assert.deepEqual(heard, ["hello"], "the other member still got it");

	member.leave();
	healthy.leave();
	await settle();
});

test("shared connections: a member rejoining with new settings reopens with them", async () => {
	// What a password change looks like from here: the instance restarts,
	// leaving and rejoining in a moment, wanting the same topic as before
	// but carrying a different password in its `open`
	const opened = [];
	const openWith = (password) => (context) => {
		opened.push({ password, interests: context.interests });
	};

	const before = sharedConnections.join("test-rejoin", {
		key: "https://six.example",
		interest: "t",
		open: openWith("old-password"),
		onEvent: () => {}
	});

	await settle();

	before.leave();
	const after = sharedConnections.join("test-rejoin", {
		key: "https://six.example",
		interest: "t",
		open: openWith("new-password"),
		onEvent: () => {}
	});

	await settle();

	assert.deepEqual(
		opened.map((open) => open.password),
		["old-password", "new-password"],
		"same topics, but reopened with the new settings"
	);

	after.leave();
	await settle();
});

test("shared connections: refuses a join that's missing what it needs", () => {
	assert.throws(() =>
		sharedConnections.join("test-bad", { open: () => {}, onEvent: () => {} })
	);
	assert.throws(() =>
		sharedConnections.join("test-bad", { key: "k", onEvent: () => {} })
	);
	assert.throws(() =>
		sharedConnections.join("test-bad", { key: "k", open: () => {} })
	);
});

// ---------------------------------------------------------------------
// The lifecycle, end to end

// The module OmniCore will actually run. Its tile shows whatever the
// background half last put in memory, which is the whole point of
// `omni.memory` -- the two halves of one instance talking to each other.
function writeBackgroundModule() {
	const dir = path.join(modulesDir, "smoke-background");
	fs.mkdirSync(dir, { recursive: true });

	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "Background Smoke", background: true })
	);

	fs.writeFileSync(
		path.join(dir, "settings.json"),
		JSON.stringify({
			settings: [{ key: "word", type: "text", label: "Word", default: "hello" }]
		})
	);

	fs.writeFileSync(
		path.join(dir, "index.js"),
		`
module.exports = async function (config, richness, omni) {
	const memory = omni.memory.read();
	return {
		title: "Background Smoke",
		content: [
			{ type: "text", value: String(memory.heard || "nothing yet") },
			// Proves the tile function is NOT handed notify
			{ type: "text", value: typeof omni.notify }
		]
	};
};

module.exports.start = async function (config, omni) {
	omni.memory.write({ heard: config.word });

	omni.connections.join({
		key: "smoke-server",
		interest: config.word,
		open: () => {},
		onEvent: () => {}
	});

	omni.notify({ title: "Listening for " + config.word });

	global.__backgroundSignals.push(omni.signal);
	global.__lastBackgroundOmni = omni;
	global.__backgroundLog.push("start " + config.word);

	// Something the module set up entirely by itself, which only its own
	// stop can clean up
	const timer = setInterval(() => {}, 100000);
	return { timer: timer, word: config.word };
};

module.exports.stop = async function (handle) {
	clearInterval(handle.timer);

	// A stop that takes a moment, so a restart that doesn't wait for it
	// would log the new start before this
	await new Promise((resolve) => setTimeout(resolve, 50));
	global.__backgroundLog.push("stop " + handle.word);
};
`
	);
}

// Says it runs in the background but forgot start: half-written, so it
// must be treated as an ordinary module, not guessed at
function writeModuleWithoutStart() {
	const dir = path.join(modulesDir, "smoke-background-no-start");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "No Start", background: true })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async function () { return { title: 'x', primary: 'ok' }; };\n"
	);
}

// Exports start but never asked to run in the background: also not run
function writeModuleWithoutFlag() {
	const dir = path.join(modulesDir, "smoke-background-no-flag");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "No Flag" })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async function () { return { title: 'x', primary: 'ok' }; };\n" +
			"module.exports.start = async function () { global.__backgroundLog.push('should never run'); };\n"
	);
}

// Fails on start -- and with no Error at all, just an empty rejection,
// which is exactly the case where reading `.message` while cleaning up
// would itself throw. Must cost only itself.
function writeModuleThatFailsToStart() {
	const dir = path.join(modulesDir, "smoke-background-broken");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({ name: "Broken Start", background: true })
	);
	fs.writeFileSync(
		path.join(dir, "index.js"),
		"module.exports = async function () { return { title: 'x', primary: 'still renders' }; };\n" +
			"module.exports.start = function () { return Promise.reject(); };\n"
	);
}

let cookie;
let face;
let instanceId;
const raised = [];

function smokePools() {
	return sharedConnections
		.list()
		.filter((pool) => pool.moduleId === "smoke-background");
}

async function tile() {
	const response = await fetch(`http://127.0.0.1:${face.id}/api/${instanceId}`);
	return response.json();
}

test("background: setup", async () => {
	resetState();
	global.__backgroundLog = [];
	global.__backgroundSignals = [];

	writeBackgroundModule();
	writeModuleWithoutStart();
	writeModuleWithoutFlag();
	writeModuleThatFailsToStart();

	// Watch what reaches the notification system, rather than needing an
	// OmniView connected to see it arrive
	notifications.notify = (faceId, message) => {
		raised.push({ faceId, title: message.title });
		return true;
	};

	require("../core/admin-face")();
	await waitForPort(ADMIN_PORT);
	cookie = await signIn(ADMIN_PORT);

	face = faceStore.createFace("Background Face", "", "no-theme", []);
	await startFace(face);
});

test("background: adding the instance starts it, and its tile sees what it heard", async () => {
	const response = await fetch(
		`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", cookie },
			body: JSON.stringify({ module: "smoke-background" })
		}
	);

	assert.equal(response.status, 200);
	instanceId = (await response.json()).id;

	await waitFor(
		() => global.__backgroundLog.includes("start hello"),
		"the instance to start"
	);

	const body = await tile();
	assert.equal(body.content[0].value, "hello", "memory reached the tile");
	assert.equal(body.content[1].value, "undefined", "the tile has no notify");

	await settle();
	assert.deepEqual(smokePools().map((pool) => pool.interests), [["hello"]]);

	assert.deepEqual(raised, [{ faceId: face.id, title: "Listening for hello" }]);
});

test("background: the tile function is never handed notify", async () => {
	// Checked above through the module itself; this checks the object
	// Core builds for a tile call directly, so it holds for every module
	const omni = makeModuleApi(face.id, instanceId);
	assert.equal(omni.notify, undefined);
	assert.equal(omni.connections, undefined);
});

test("background: changing a setting restarts it with the new one", async () => {
	const response = await fetch(
		`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules/${instanceId}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", cookie },
			body: JSON.stringify({
				label: "Smoke",
				config: { word: "world" },
				themeConfig: {}
			})
		}
	);

	assert.equal(response.status, 200);

	await waitFor(
		() => global.__backgroundLog.includes("start world"),
		"the restart"
	);

	// In this order: the new start waited for the old stop to finish
	assert.deepEqual(global.__backgroundLog, [
		"start hello",
		"stop hello",
		"start world"
	]);

	assert.equal(
		global.__backgroundSignals[0].aborted,
		true,
		"the old run's signal was aborted"
	);

	const body = await tile();
	assert.equal(body.content[0].value, "world");

	await settle();
	assert.deepEqual(
		smokePools().map((pool) => pool.interests),
		[["world"]],
		"the old interest left the shared connection, the new one joined"
	);
});

test("background: changing only the label doesn't restart anything", async () => {
	await fetch(
		`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules/${instanceId}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", cookie },
			body: JSON.stringify({
				label: "A new name",
				config: { word: "world" },
				themeConfig: {}
			})
		}
	);

	await wait(200);
	assert.equal(global.__backgroundLog.length, 3, "nothing stopped or started");
});

test("background: saving twice at once leaves exactly one running", async () => {
	const save = (word) =>
		fetch(
			`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules/${instanceId}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", cookie },
				body: JSON.stringify({ label: "", config: { word }, themeConfig: {} })
			}
		);

	await Promise.all([save("first"), save("second")]);
	await wait(300);

	const mine = background
		.list()
		.filter((run) => run.instanceId === instanceId);

	assert.equal(mine.length, 1);

	// Every start has a matching stop, except the one still running
	const starts = global.__backgroundLog.filter((line) => line.startsWith("start"));
	const stops = global.__backgroundLog.filter((line) => line.startsWith("stop"));
	assert.equal(starts.length - stops.length, 1, global.__backgroundLog.join(", "));
});

test("background: half-written, unflagged and broken modules don't take anything down", async () => {
	for (const moduleId of [
		"smoke-background-no-start",
		"smoke-background-no-flag",
		"smoke-background-broken"
	]) {
		const response = await fetch(
			`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", cookie },
				body: JSON.stringify({ module: moduleId })
			}
		);

		assert.equal(response.status, 200, moduleId);
	}

	await wait(300);

	const runningModules = background.list().map((run) => run.moduleId);
	assert.deepEqual(runningModules, ["smoke-background"], "only the real one runs");
	assert.ok(!global.__backgroundLog.includes("should never run"));

	// The broken one's tile still renders -- failing to start costs its
	// background work, not its tile
	const broken = faceStore
		.findFace(face.id)
		.instances.find((instance) => instance.module === "smoke-background-broken");

	const body = await (
		await fetch(`http://127.0.0.1:${face.id}/api/${broken.id}`)
	).json();

	assert.equal(body.content[0].value, "still renders");
});

test("background: removing the instance stops it and forgets its memory", async () => {
	const response = await fetch(
		`http://127.0.0.1:${ADMIN_PORT}/faces/${face.id}/modules/${instanceId}`,
		{ method: "DELETE", headers: { cookie } }
	);

	assert.equal(response.status, 200);

	await waitFor(
		() => background.list().every((run) => run.instanceId !== instanceId),
		"the instance to stop"
	);

	const last = global.__backgroundLog[global.__backgroundLog.length - 1];
	assert.ok(last.startsWith("stop"), "its own stop ran: " + last);

	await settle();
	assert.equal(smokePools().length, 0, "its shared connection closed");

	// A timer firing one last time after removal can't bring back what
	// removing the instance deleted
	global.__lastBackgroundOmni.memory.write({ late: true });
	global.__lastBackgroundOmni.storage.write({ late: true });

	const omni = makeModuleApi(face.id, instanceId);
	assert.deepEqual(omni.memory.read(), {}, "memory stayed gone");
	assert.deepEqual(omni.storage.read(), {}, "no file was recreated");
});

test("background: boot starts every background instance on a face", async () => {
	// What start.OmniCore does for each face on its way up
	const booted = faceStore.createFace("Booted Face", "", "no-theme", [
		{ module: "smoke-background", config: { word: "booted" } }
	]);

	await background.syncFace(booted);

	assert.ok(global.__backgroundLog.includes("start booted"));

	// Calling it again with nothing changed is a no-op, not a restart
	const before = global.__backgroundLog.length;
	await background.syncFace(faceStore.findFace(booted.id));
	assert.equal(global.__backgroundLog.length, before);
});