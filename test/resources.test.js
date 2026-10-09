// test/resources.test.js
// Installed modules and themes: how current they are, how an update reaches
// code that's already running, and the Installed Resources page that shows
// it all.
//
// No network here. The registry install itself is covered, for real, by
// marketplace.test.js; this file stands in for it where it has to, so it
// can set up exactly the situations a page needs to tell apart -- up to
// date, waiting on a newer OmniCore, dropped in by hand.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resetState, waitForPort, signIn, modulesDir } = helpers;
const installStore = require("../core/install-store");
const updateStore = require("../core/update-store");
const marketplace = require("../core/marketplace");
const resourceScheduler = require("../core/resource-scheduler");
const { loadModule, forgetModule } = require("../core/module-loader");
const background = require("../core/background");
const faceStore = require("../core/face-store");

const PORT = 3000;
let cookie;

// A module on disk, written fresh. `version` ends up in what it returns,
// so a test can tell which copy of the code is the one running.
function writeModule(id, version, { background: runsInBackground } = {}) {
	const dir = path.join(modulesDir, id);
	fs.mkdirSync(dir, { recursive: true });

	fs.writeFileSync(
		path.join(dir, "module.json"),
		JSON.stringify({
			name: id + " module",
			description: "A " + id + " for testing",
			provides: ["text"],
			background: Boolean(runsInBackground)
		})
	);

	fs.writeFileSync(
		path.join(dir, "index.js"),
		`
		module.exports = async function () {
			return { title: "${id}", content: [{ type: "text", value: "${version}" }] };
		};
		module.exports.version = "${version}";
		module.exports.start = async function () {
			(globalThis.__events = globalThis.__events || []).push("start ${version}");
			return {};
		};
		module.exports.stop = async function () {
			(globalThis.__events = globalThis.__events || []).push("stop ${version}");
		};`
	);
}

test("install record: keeps the commit date, and a late date only lands on its own commit", () => {
	resetState();

	installStore.record("module", "alpha", { ref: "aaa", commitDate: "2026-10-08T16:12:00.000Z" });
	assert.equal(installStore.get("module", "alpha").commitDate, "2026-10-08T16:12:00.000Z");

	installStore.record("module", "beta", { ref: "bbb" });
	assert.equal(installStore.get("module", "beta").commitDate, null, "unknown is null, not a guess");

	assert.equal(installStore.setCommitDate("module", "beta", "old-ref", "2020-01-01T00:00:00.000Z"), null);
	assert.equal(installStore.get("module", "beta").commitDate, null, "a date for another commit is refused");

	installStore.setCommitDate("module", "beta", "bbb", "2026-10-01T09:00:00.000Z");
	assert.equal(installStore.get("module", "beta").commitDate, "2026-10-01T09:00:00.000Z");
});

// GitHub, stood in for: the commit date is read out of the API's reply,
// and anything wrong with the reply costs the date, never the install
test("commit date: read from GitHub's reply, and null whenever it can't be", async () => {
	const https = require("https");
	const { PassThrough } = require("stream");
	const original = https.get;
	let reply;

	https.get = (url, options, callback) => {
		const response = new PassThrough();
		response.statusCode = reply.status;
		response.headers = {};
		process.nextTick(() => {
			callback(response);
			response.end(reply.body);
		});
		return { on() { return this; } };
	};

	const entry = { repo: "https://github.com/someone/something", ref: "abc123" };

	try {
		reply = { status: 200, body: JSON.stringify({ commit: { committer: { date: "2026-10-08T16:12:00Z" } } }) };
		assert.equal(await marketplace.fetchCommitDate(entry), "2026-10-08T16:12:00.000Z");

		reply = { status: 403, body: "rate limited" };
		assert.equal(await marketplace.fetchCommitDate(entry), null);

		reply = { status: 200, body: "not json" };
		assert.equal(await marketplace.fetchCommitDate(entry), null);

		reply = { status: 200, body: JSON.stringify({ commit: {} }) };
		assert.equal(await marketplace.fetchCommitDate(entry), null);

		assert.equal(await marketplace.fetchCommitDate({ repo: "not a repo", ref: "x" }), null);
	} finally {
		https.get = original;
	}
});

test("update record: the module check and OmniCore's own check never wipe each other", () => {
	resetState();

	updateStore.recordResourceCheck({ applied: [{ kind: "module", id: "a", ref: "1" }], skipped: [] });
	updateStore.recordCheck({ latestVersion: "9.9.9", updateAvailable: true });

	assert.equal(updateStore.lastResourceCheck().applied[0].id, "a");
	assert.equal(updateStore.lastResult("1.0.0").latestVersion, "9.9.9");

	updateStore.recordResourceCheck({ error: "registry down" });
	assert.equal(updateStore.lastResourceCheck().error, "registry down");
	assert.equal(updateStore.lastResult("1.0.0").latestVersion, "9.9.9");
});

test("an updated module's new code is used without restarting OmniCore", () => {
	writeModule("hot", "one");
	assert.equal(loadModule("hot").version, "one");

	writeModule("hot", "two");
	assert.equal(loadModule("hot").version, "one", "Node still hands back the old copy");

	forgetModule("hot");
	assert.equal(loadModule("hot").version, "two");
});

test("an update reaches a module linked in from another folder too", () => {
	// The normal way to develop a module: its folder is a symlink. Node files
	// what it loads under the real path, so forgetting has to look there.
	const elsewhere = fs.mkdtempSync(path.join(require("os").tmpdir(), "linked-module-"));
	fs.writeFileSync(path.join(elsewhere, "index.js"), 'module.exports = async () => ({}); module.exports.version = "one";');
	fs.symlinkSync(elsewhere, path.join(modulesDir, "linked"));

	assert.equal(loadModule("linked").version, "one");

	fs.writeFileSync(path.join(elsewhere, "index.js"), 'module.exports = async () => ({}); module.exports.version = "two";');
	forgetModule("linked");

	assert.equal(loadModule("linked").version, "two");
});

test("an updated background module is restarted onto its new code, old stop first", async () => {
	resetState();
	globalThis.__events = [];

	writeModule("listener", "one", { background: true });
	const face = faceStore.createFace("Hot", "", "none", [{ module: "listener", config: {} }]);

	await background.syncFace(face);
	assert.deepEqual(globalThis.__events, ["start one"]);

	writeModule("listener", "two", { background: true });
	forgetModule("listener");
	await background.restartModule("listener");

	assert.deepEqual(globalThis.__events, ["start one", "stop one", "start two"]);

	// And a module nobody has placed on a face is a no-op, not an error
	await background.restartModule("nowhere");

	// Tidy up so nothing keeps running into the next test
	faceStore.removeInstance(face.id, face.instances[0].id);
	await background.syncFace(faceStore.findFace(face.id));
});

test("a check already running is joined, not run twice", async () => {
	resetState();

	const original = marketplace.applyAvailableUpdates;
	let calls = 0;

	marketplace.applyAvailableUpdates = async () => {
		calls += 1;
		await new Promise((resolve) => setTimeout(resolve, 100));
		return { applied: [], skipped: [{ kind: "module", id: "x", ref: "r2", reason: "nope" }] };
	};

	try {
		const [first, second] = await Promise.all([
			resourceScheduler.runOnce(),
			resourceScheduler.runOnce()
		]);

		assert.equal(calls, 1);
		assert.equal(first, second);
		assert.equal(updateStore.lastResourceCheck().skipped[0].id, "x", "the result was recorded");

		// Finished, so the next one is a real new check
		await resourceScheduler.runOnce();
		assert.equal(calls, 2);
	} finally {
		marketplace.applyAvailableUpdates = original;
	}
});

test("a registry that can't be reached is recorded as such", async () => {
	resetState();

	const original = marketplace.applyAvailableUpdates;
	marketplace.applyAvailableUpdates = async () => {
		throw new Error("registry unreachable");
	};

	try {
		const result = await resourceScheduler.runOnce();
		assert.equal(result.error, "registry unreachable");
		assert.equal(updateStore.lastResourceCheck().error, "registry unreachable");
	} finally {
		marketplace.applyAvailableUpdates = original;
	}
});

// ---- the page

async function getPage(url) {
	const response = await fetch(`http://127.0.0.1:${PORT}${url}`, { headers: { cookie } });
	assert.equal(response.status, 200, `${url} answered ${response.status}`);
	return response.text();
}

test("installed resources: boots signed in", async () => {
	resetState();
	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("installed resources: before any check, says so and shows no status", async () => {
	writeModule("current", "1");
	installStore.record("module", "current", { ref: "c1", commitDate: "2026-10-08T16:12:00.000Z" });

	const html = await getPage("/installed");

	assert.ok(html.includes("No check has run yet"), "says no check has run");
	assert.ok(!html.includes("Up to date"), "claims nothing it hasn't checked");
	assert.ok(html.includes('datetime="2026-10-08T16:12:00.000Z"'), "the version is the commit date");
});

test("installed resources: up to date, waiting on OmniCore, and dropped in by hand", async () => {
	writeModule("current", "1");
	writeModule("waiting", "1");
	writeModule("byhand", "1");

	installStore.record("module", "current", { ref: "c1", commitDate: "2026-10-08T16:12:00.000Z" });
	installStore.record("module", "waiting", { ref: "deadbeefcafe0123", commitDate: "2026-09-01T10:00:00.000Z" });

	updateStore.recordResourceCheck({
		applied: [],
		skipped: [{
			kind: "module",
			id: "waiting",
			ref: "newer-commit",
			reason: "waiting needs OmniCore 1.99.0 or later",
			needsOmniCore: "1.99.0"
		}]
	});

	const html = await getPage("/installed");

	// Each card, cut out on its own, so a status can't be credited to the
	// wrong one
	const card = (name) => {
		const start = html.indexOf(`<strong>${name} module</strong>`);
		assert.ok(start !== -1, `no card for ${name}`);
		return html.slice(start, html.indexOf("</div>\n\t\t\t</div>", start));
	};

	assert.ok(card("current").includes("Up to date"));
	assert.ok(card("waiting").includes("Update waiting: needs OmniCore 1.99.0"));
	assert.ok(card("byhand").includes("Not from the Marketplace"));
	assert.ok(!card("byhand").includes("datetime"), "nothing to date for a hand-made one");

	assert.ok(html.includes("1 waiting."), "the summary counts it");
	assert.ok(!html.includes("deadbeef"), "no commit hash anywhere on the page");
	assert.ok(html.includes('id="check"'), "Check now is there");
	assert.ok(html.includes('href="/marketplace"'), "and the way to the Marketplace");
});

test("installed resources: once the waiting commit is installed some other way, it isn't waiting", async () => {
	installStore.record("module", "waiting", { ref: "newer-commit", commitDate: "2026-10-09T08:00:00.000Z" });

	const html = await getPage("/installed");
	assert.ok(!html.includes("Update waiting"), "stale skip no longer shown");
});

test("installed resources: Check now runs the check and reports what it did", async () => {
	const original = marketplace.applyAvailableUpdates;
	marketplace.applyAvailableUpdates = async () => ({
		applied: [{ kind: "module", id: "current", ref: "c2" }],
		skipped: []
	});

	try {
		const response = await fetch(`http://127.0.0.1:${PORT}/installed/check`, {
			method: "POST",
			headers: { cookie }
		});
		const data = await response.json();

		assert.equal(response.status, 200);
		assert.equal(data.applied[0].id, "current");
	} finally {
		marketplace.applyAvailableUpdates = original;
	}

	const html = await getPage("/installed");
	assert.ok(html.includes("1 updated: current module."), "the page reports it, by name");
});

test("installed resources: a failed Check now says why", async () => {
	const original = marketplace.applyAvailableUpdates;
	marketplace.applyAvailableUpdates = async () => {
		throw new Error("registry unreachable");
	};

	try {
		const response = await fetch(`http://127.0.0.1:${PORT}/installed/check`, {
			method: "POST",
			headers: { cookie }
		});

		assert.equal(response.status, 502);
		assert.equal((await response.json()).error, "registry unreachable");
	} finally {
		marketplace.applyAvailableUpdates = original;
	}

	assert.ok((await getPage("/installed")).includes("couldn't reach the registry"));
});

test("add a module: offers the way to the Marketplace", async () => {
	const face = faceStore.createFace("Picker", "", "none", []);
	const html = await getPage(`/faces/${face.id}/modules/add`);

	assert.ok(html.includes("Get more modules"));
	assert.ok(html.includes('href="/marketplace"'));
});