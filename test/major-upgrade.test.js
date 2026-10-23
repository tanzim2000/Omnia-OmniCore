// test/major-upgrade.test.js
// Upgrading to a new major version (since 1.20.0): finding it, the box and
// its pop-up on the settings home, the backup, the helper container's
// script (putting the data back, keeping docker-compose.yml in step), and
// the new version bringing the data up to date when it starts.
//
// The helper's script is run for real here, by the shell, with a stand-in
// for the docker command: a script that answers the few things the helper
// asks (a container's health) and keeps a list of what it was told to do.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { resetState, waitForPort, signIn } = helpers;

const coreUpdater = require("../core/core-updater");
const updateStore = require("../core/update-store");
const upgrades = require("../core/upgrades");
const upgradeNotes = require("../core/upgrade-notes");
const paths = require("../core/paths");

const PORT = 3000;
let cookie;

// A folder of its own for each test that writes files
function scratch(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `omnicore-major-${name}-`));
}

// --- Finding the next major version ------------------------------------------

test("the next major: the newest real release of it, never a test release", () => {
	const tags = ["v1.19.9", "v1.20.0", "v2.0.0", "v2.0.1", "v2.1.0-rc.1", "v3.0.0", "nonsense"];
	assert.equal(coreUpdater.newestOfMajor(tags, 1), "v1.20.0");
	assert.equal(coreUpdater.newestOfMajor(tags, 2), "v2.0.1", "2.1.0-rc.1 isn't released");
	assert.equal(coreUpdater.newestOfMajor(tags, 4), null);
});

test("its image: the same name with the major as its tag", () => {
	assert.equal(coreUpdater.majorImageRef("ghcr.io/tanzim2000/omnia-omnicore:1", 2), "ghcr.io/tanzim2000/omnia-omnicore:2");
	assert.equal(coreUpdater.majorImageRef("ghcr.io/tanzim2000/omnia-omnicore:1.19.9", 2), "ghcr.io/tanzim2000/omnia-omnicore:2");
	assert.equal(coreUpdater.majorImageRef("ghcr.io/tanzim2000/omnia-omnicore", 2), "ghcr.io/tanzim2000/omnia-omnicore:2");
	assert.equal(coreUpdater.majorImageRef("ghcr.io/tanzim2000/omnia-omnicore:1@sha256:abc", 2), "ghcr.io/tanzim2000/omnia-omnicore:2");
	assert.equal(coreUpdater.majorImageRef("localhost:5000/omnicore:1", 2), "localhost:5000/omnicore:2", "a registry with a port");
});

test("the stored check: the next major only while it's the next one", () => {
	resetState();
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: "2.0.0" });
	assert.equal(updateStore.lastResult("v1.20.0").nextMajor, "2.0.0");
	assert.equal(updateStore.lastResult("v2.0.0").nextMajor, null, "once it's running, nothing to offer");
	assert.equal(updateStore.lastResult("dev").nextMajor, null);

	// A failed check keeps what was found before
	updateStore.recordCheck({ error: "GitHub didn't answer" });
	assert.equal(updateStore.lastResult("v1.20.0").nextMajor, "2.0.0");
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: null });
	assert.equal(updateStore.lastResult("v1.20.0").nextMajor, null);
});

// --- docker-compose.yml ---------------------------------------------------------

test("where docker-compose.yml is: from Compose's label, plain absolute paths only", () => {
	const files = coreUpdater.composeFiles({
		Config: {
			Labels: {
				"com.docker.compose.project.config_files":
					"/home/me/omnicore/docker-compose.yml,/home/me/omnicore/docker-compose.override.yml,relative.yml,C:\\\\omni\\\\docker-compose.yml,/home/me/../etc/x.yml"
			}
		}
	});
	assert.deepEqual(files, ["/home/me/omnicore/docker-compose.yml", "/home/me/omnicore/docker-compose.override.yml"]);
	assert.deepEqual(coreUpdater.composeFiles({ Config: { Labels: {} } }), [], "not made by Compose");

	assert.deepEqual(coreUpdater.composeMounts(files), [
		{ host: "/home/me/omnicore/docker-compose.yml", inside: "/omnicore-compose/0/docker-compose.yml" },
		{ host: "/home/me/omnicore/docker-compose.override.yml", inside: "/omnicore-compose/1/docker-compose.override.yml" }
	]);
	assert.deepEqual(
		coreUpdater.helperMounts({ Id: "abc" }, { compose: { files: coreUpdater.composeMounts(files) } }),
		{ VolumesFrom: ["abc"], Binds: ["/home/me/omnicore:/omnicore-compose/0", "/home/me/omnicore:/omnicore-compose/1"] }
	);
	assert.deepEqual(
		coreUpdater.helperMounts({ HostConfig: {} }, {}),
		{ Binds: ["/var/run/docker.sock:/var/run/docker.sock"] },
		"an ordinary update: the socket and nothing else"
	);
});

test("an image name that isn't plain gets no edit at all", () => {
	const files = [{ host: "/x/docker-compose.yml", inside: "/omnicore-compose/0/docker-compose.yml" }];
	assert.equal(coreUpdater.composeEditScript({ files, fromRef: "x:1; rm -rf /", toRef: "x:2", version: "2.0.0" }), "");
	assert.equal(coreUpdater.composeEditScript({ files: [], fromRef: "x:1", toRef: "x:2", version: "2.0.0" }), "");
});

// --- The backup ------------------------------------------------------------------

test("the backup: everything in the data folder but older backups, replaced for the same version", () => {
	const data = scratch("backup");
	fs.writeFileSync(path.join(data, "settings.json"), '{"a":1}');
	fs.mkdirSync(path.join(data, "faces"));
	fs.writeFileSync(path.join(data, "faces", "f.json"), "{}");
	fs.mkdirSync(path.join(data, "backups", "before-1.5.0"), { recursive: true });

	const target = coreUpdater.backupData("2.0.0", data);
	assert.equal(target, path.join(data, "backups", "before-2.0.0"));
	assert.deepEqual(fs.readdirSync(target).sort(), ["faces", "settings.json"]);
	assert.ok(fs.existsSync(path.join(data, "backups", "before-1.5.0")), "older backups left alone");

	fs.writeFileSync(path.join(data, "settings.json"), '{"a":2}');
	coreUpdater.backupData("2.0.0", data);
	assert.equal(fs.readFileSync(path.join(target, "settings.json"), "utf-8"), '{"a":2}', "replaced");
});

// --- The helper's script, run for real ----------------------------------------------

// A stand-in for docker: logs every call, answers `inspect` with $FAKE_HEALTH
function fakeDocker(dir) {
	const bin = path.join(dir, "bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, "docker"),
		`#!/bin/sh
echo "$*" >> "${dir}/calls"
# What the data said whenever a container was started
[ "$1" = start ] && [ -n "$CHECK_FILE" ] && echo "data at start: $(cat "$CHECK_FILE" 2>/dev/null)" >> "${dir}/calls"
case "$1" in
	inspect) case "$*" in *Running*) echo true ;; *) echo "$FAKE_HEALTH" ;; esac ;;
	logs) echo "(the new version's last lines)" ;;
esac
exit 0
`,
		{ mode: 0o755 }
	);
	return bin;
}

function runHelper(dir, health, options, checkFile) {
	const script = coreUpdater.helperScript({
		originalName: "omnicore",
		previousName: "omnicore-previous",
		incomingName: "omnicore-incoming",
		failedName: "omnicore-failed",
		networkLines: "",
		...options
	});
	try {
		const out = execFileSync("sh", ["-c", script], {
			env: { ...process.env, PATH: `${fakeDocker(dir)}:${process.env.PATH}`, FAKE_HEALTH: health, CHECK_FILE: checkFile || "" },
			encoding: "utf-8"
		});
		return { code: 0, out };
	} catch (error) {
		return { code: error.status, out: String(error.stdout) };
	}
}

test("helper: a new major that isn't healthy brings back the old version with the old data", () => {
	const dir = scratch("helper-back");
	const data = path.join(dir, "data");
	fs.mkdirSync(path.join(data, "backups", "before-2.0.0"), { recursive: true });
	fs.writeFileSync(path.join(data, "backups", "before-2.0.0", "settings.json"), "old");
	fs.writeFileSync(path.join(data, "settings.json"), "converted by 2.0.0");
	fs.writeFileSync(path.join(data, "data-version.json"), '{"version":"2.0.0"}');
	fs.writeFileSync(path.join(data, ".hidden"), "made by 2.0.0");

	const { code, out } = runHelper(dir, "unhealthy", {
		dataDir: data,
		backup: path.join(data, "backups", "before-2.0.0")
	}, path.join(data, "settings.json"));

	assert.equal(code, 1);
	assert.match(out, /The new version is unhealthy -- putting the old version back/);
	assert.match(out, /Putting back the data from/);
	assert.equal(fs.readFileSync(path.join(data, "settings.json"), "utf-8"), "old", "the copy is back");
	assert.ok(!fs.existsSync(path.join(data, "data-version.json")), "nothing of 2.0.0's left");
	assert.ok(!fs.existsSync(path.join(data, ".hidden")), "hidden files too");
	assert.ok(fs.existsSync(path.join(data, "backups", "before-2.0.0", "settings.json")), "the backup itself kept");

	// The new version started on its converted data; the old one only once
	// its own data was back
	const starts = fs.readFileSync(path.join(dir, "calls"), "utf-8").match(/data at start: .*/g);
	assert.deepEqual(starts, ["data at start: converted by 2.0.0", "data at start: old"]);
});

test("helper: an ordinary update that fails has no data to put back", () => {
	const dir = scratch("helper-plain");
	const { code, out } = runHelper(dir, "unhealthy", {});
	assert.equal(code, 1);
	assert.ok(!out.includes("Putting back the data"));
});

test("helper: once healthy, docker-compose.yml says the new image, with a copy kept and nothing else changed", () => {
	const dir = scratch("helper-compose");
	const folder = path.join(dir, "omnicore");
	fs.mkdirSync(folder);
	const file = path.join(folder, "docker-compose.yml");
	const before = [
		"services:",
		"  omnicore:",
		"    image: ghcr.io/tanzim2000/omnia-omnicore:1   # the major, see below",
		"    ports:",
		'      - "3000:3000"',
		"  other:",
		"    image: ghcr.io/tanzim2000/omnia-omnicore:10",
		""
	].join("\n");
	fs.writeFileSync(file, before);

	const compose = {
		files: [{ host: "/home/me/omnicore/docker-compose.yml", inside: file }],
		fromRef: "ghcr.io/tanzim2000/omnia-omnicore:1",
		toRef: "ghcr.io/tanzim2000/omnia-omnicore:2",
		version: "2.0.0"
	};
	const { code, out } = runHelper(dir, "healthy", { composeEdit: coreUpdater.composeEditScript(compose) });

	assert.equal(code, 0, out);
	assert.match(out, /docker-compose\.yml now says ghcr\.io\/tanzim2000\/omnia-omnicore:2/);
	const after = fs.readFileSync(file, "utf-8");
	assert.ok(after.includes("    image: ghcr.io/tanzim2000/omnia-omnicore:2   # the major, see below"));
	assert.ok(after.includes("    image: ghcr.io/tanzim2000/omnia-omnicore:10"), "only the exact image, not one that starts the same");
	assert.equal(after.split("\n").length, before.split("\n").length);
	assert.equal(fs.readFileSync(file + ".before-2.0.0", "utf-8"), before, "the copy");
});

test("helper: a docker-compose.yml without the plain line is left as it was", () => {
	const dir = scratch("helper-custom");
	const file = path.join(dir, "docker-compose.yml");
	fs.writeFileSync(file, "services:\n  omnicore:\n    image: ${OMNICORE_IMAGE}\n");

	const compose = {
		files: [{ host: "/x/docker-compose.yml", inside: file }],
		fromRef: "ghcr.io/tanzim2000/omnia-omnicore:1",
		toRef: "ghcr.io/tanzim2000/omnia-omnicore:2",
		version: "2.0.0"
	};
	const { code, out } = runHelper(dir, "healthy", { composeEdit: coreUpdater.composeEditScript(compose) });

	assert.equal(code, 0);
	assert.match(out, /says ghcr\.io\/tanzim2000\/omnia-omnicore:1: left as it was/);
	assert.ok(!fs.existsSync(file + ".before-2.0.0"));
});

test("helper: a failed upgrade never touches docker-compose.yml", () => {
	const dir = scratch("helper-nocompose");
	const file = path.join(dir, "docker-compose.yml");
	fs.writeFileSync(file, "    image: ghcr.io/tanzim2000/omnia-omnicore:1\n");
	const compose = {
		files: [{ host: "/x/docker-compose.yml", inside: file }],
		fromRef: "ghcr.io/tanzim2000/omnia-omnicore:1",
		toRef: "ghcr.io/tanzim2000/omnia-omnicore:2",
		version: "2.0.0"
	};
	runHelper(dir, "unhealthy", { composeEdit: coreUpdater.composeEditScript(compose) });
	assert.equal(fs.readFileSync(file, "utf-8"), "    image: ghcr.io/tanzim2000/omnia-omnicore:1\n");
});

// --- Bringing the data up to date ----------------------------------------------

test("data: a fresh install is as new as the version running, with nothing to run", () => {
	const data = scratch("fresh");
	const result = upgrades.start({ dataDir: data, running: "2.0.0", steps: [{ version: "2.0.0", about: "x", run() { throw new Error("must not run"); } }] });
	assert.deepEqual(result, { from: "2.0.0", to: "2.0.0", ran: [] });
	assert.equal(JSON.parse(fs.readFileSync(path.join(data, "data-version.json"), "utf-8")).version, "2.0.0");
});

test("data: older data runs every step after it, in order, and remembers each one", () => {
	const data = scratch("steps");
	fs.writeFileSync(path.join(data, "settings.json"), "{}"); // data from before 1.20.0: no version file
	const ran = [];
	const steps = [
		{ version: "2.1.0", about: "later", run() { ran.push("2.1.0"); } },
		{ version: "1.5.0", about: "already done", run() { ran.push("1.5.0"); } },
		{ version: "2.0.0", about: "first", run(dir) { assert.equal(dir, data); ran.push("2.0.0"); } },
		{ version: "3.0.0", about: "not yet", run() { ran.push("3.0.0"); } }
	];

	fs.writeFileSync(path.join(data, "data-version.json"), '{"version":"1.20.0"}');
	const result = upgrades.start({ dataDir: data, running: "2.1.0", steps });
	assert.deepEqual(ran, ["2.0.0", "2.1.0"]);
	assert.deepEqual(result, { from: "1.20.0", to: "2.1.0", ran: ["2.0.0", "2.1.0"] });
});

test("data: from before 1.20.0 (no version file) counts as 1.0.0", () => {
	const data = scratch("old");
	fs.writeFileSync(path.join(data, "faces.json"), "[]");
	assert.equal(upgrades.storedVersion(data, "2.0.0"), "1.0.0");
	assert.equal(upgrades.storedVersion(scratch("empty"), "2.0.0"), "2.0.0", "an empty folder is a fresh install");
});

test("data: a step that fails stops there, and is the one tried next time", () => {
	const data = scratch("fail");
	fs.writeFileSync(path.join(data, "data-version.json"), '{"version":"1.20.0"}');
	let tries = 0;
	const steps = [
		{ version: "2.0.0", about: "works", run() {} },
		{ version: "2.0.1", about: "breaks once", run() { tries += 1; if (tries === 1) throw new Error("power cut"); } }
	];

	assert.throws(() => upgrades.start({ dataDir: data, running: "2.0.1", steps }), /power cut/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(data, "data-version.json"), "utf-8")).version, "2.0.0", "the one that worked is remembered");

	const result = upgrades.start({ dataDir: data, running: "2.0.1", steps });
	assert.deepEqual(result.ran, ["2.0.1"]);
});

test("data: a newer major's data is refused; a newer minor's isn't moved back", () => {
	const data = scratch("newer");
	fs.writeFileSync(path.join(data, "data-version.json"), '{"version":"2.0.0"}');
	assert.throws(
		() => upgrades.start({ dataDir: data, running: "1.20.0", steps: [] }),
		(error) => error.name === "DataFromNewerVersion" && /last used by OmniCore 2\.0\.0/.test(error.message)
	);

	fs.writeFileSync(path.join(data, "data-version.json"), '{"version":"1.21.0"}');
	upgrades.start({ dataDir: data, running: "1.20.0", steps: [] });
	assert.equal(JSON.parse(fs.readFileSync(path.join(data, "data-version.json"), "utf-8")).version, "1.21.0");
});

test("start.OmniCore brings the data up to date before anything else, and stops if it can't", () => {
	const start = fs.readFileSync(path.join(__dirname, "..", "start.OmniCore"), "utf-8");
	assert.ok(start.indexOf('require("./core/upgrades").start()') < start.indexOf("const faces = readFaces();"));
	assert.ok(start.includes("process.exit(1);"));
});

// --- The document --------------------------------------------------------------

test("the document: fetched at the version's own tag, drawn safely", () => {
	assert.equal(
		upgradeNotes.notesUrl("2.0.0"),
		"https://raw.githubusercontent.com/tanzim2000/Omnia-OmniCore/v2.0.0/docs/upgrades/2.0.0.md"
	);

	const html = upgradeNotes.render(
		"# What's new\n\nOmniCore **2.0** is _here_. [Read more](https://example.com/a) " +
			"[not this](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n- one\n- `a<b`\n\n1. first\n\n> quoted\n\n```\nimage: x:2\n```"
	);
	assert.ok(html.includes("<h3>What&#39;s new</h3>"));
	assert.ok(html.includes("<strong>2.0</strong>") && html.includes("<em>here</em>"));
	assert.ok(html.includes('<a href="https://example.com/a" target="_blank" rel="noopener">Read more</a>'));
	assert.ok(html.includes("[not this](javascript:alert(1))"), "only https links");
	assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "markup stays text");
	assert.ok(html.includes("<li><code>a&lt;b</code></li>"));
	assert.ok(html.includes("<ol>\n<li>first</li>\n</ol>"));
	assert.ok(html.includes("<blockquote>quoted</blockquote>"));
	assert.ok(html.includes("<pre><code>image: x:2</code></pre>"));
});

// --- The settings home ----------------------------------------------------------

async function get(address) {
	return fetch(`http://127.0.0.1:${PORT}${address}`, { headers: { cookie, Accept: "application/json" } });
}

async function post(address, body) {
	return fetch(`http://127.0.0.1:${PORT}${address}`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body)
	});
}

test("setup: the admin face is up", async () => {
	resetState();
	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("settings home: the box is there only while a new major version is", async () => {
	process.env.OMNICORE_VERSION = "v1.20.0";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: null });
	let html = await (await get("/")).text();
	assert.ok(!html.includes('id="major-box"'));

	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: "2.0.0" });
	html = await (await get("/")).text();
	assert.match(html, /<button type="button" class="segment clickable major-box" id="major-box"\s+data-version="2\.0\.0"/);
	assert.ok(html.includes("<strong>OmniCore 2.0.0 is out</strong>"));
	assert.ok(html.indexOf('id="major-box"') < html.indexOf("<h2>Location Service</h2>"), "first on the page");

	// Its pop-up: Upgrade starts off, says why on hover, and on a phone under it
	assert.ok(html.includes('id="major-modal" hidden'));
	assert.match(html, /id="major-upgrade"\s+aria-disabled="true" title="Loading what&#39;s changing…"|id="major-upgrade"\s+aria-disabled="true" title="Loading what's changing…"/);
	assert.ok(html.includes('class="hint major-why" id="major-why"'));
	assert.match(html, /\.major-actions \.major-why \{ display: none;[^}]*\}\s*@media \(max-width: 42em\) \{\s*\.major-actions \.major-why \{ display: block; \}/);
	assert.ok(html.includes('if (!read) return "Scroll to the end to read it all first.";'));
	assert.ok(html.includes("doc.scrollHeight - doc.scrollTop - doc.clientHeight <= 4"), "read means reached the end");
	assert.ok(!/id="major-upgrade"[^>]*\sdisabled[\s>]/.test(html), "not the disabled attribute, which would hide its title");
});

test("the version at the top: \"OmniCore 2 is here!\" while a new major is out, opening its pop-up", async () => {
	process.env.OMNICORE_VERSION = "v1.20.1";
	updateStore.recordCheck({ latestVersion: "1.20.2", updateAvailable: true, nextMajor: "2.0.0" });
	let html = await (await get("/")).text();
	assert.match(html, /<button class="version-pill" id="version-pill"\s+title="Read what's changing in OmniCore 2\.0\.0">\s*<span class="version-dot"><\/span>\s*OmniCore 2 is here!\s*<\/button>/);
	assert.ok(!html.includes("update ready"), "the major version wins over an ordinary update");
	assert.ok(html.includes("if (window.openMajor) window.openMajor();"), "it opens the same pop-up as the box");

	updateStore.recordCheck({ latestVersion: "1.20.2", updateAvailable: true, nextMajor: null });
	html = await (await get("/")).text();
	assert.ok(html.includes(" · update ready"), "without one, as before");
	assert.ok(!html.includes("is here!"));
});

test("release notes: a name between backticks is drawn as code", async () => {
	process.env.OMNICORE_VERSION = "dev";
	const html = await (await get("/updates")).text();
	assert.ok(!/`[^`<]+`/.test(html.slice(html.indexOf('class="changelog"'), html.indexOf("</div>", html.indexOf('class="changelog"')))), "no backticks left in the notes");
	assert.ok(html.includes("<code>docker-compose.yml</code>"), "drawn as code (this version's own notes)");
	assert.match(html, /\.changelog code \{/);
});

test("the pop-up's contents: the document, then what happens to the data and docker-compose.yml", async () => {
	process.env.OMNICORE_VERSION = "v1.20.0";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: "2.0.0" });

	const real = {
		notes: upgradeNotes.fetchUpgradeNotes,
		ready: coreUpdater.applyReadiness,
		compose: coreUpdater.checkComposeFile
	};
	upgradeNotes.fetchUpgradeNotes = async (version) => ({ html: `<h3>About ${version}</h3>`, from: "document" });
	coreUpdater.applyReadiness = async () => ({ ready: true, reason: null });
	coreUpdater.checkComposeFile = async () => ({
		state: "ready",
		file: "/home/me/omnicore/docker-compose.yml",
		from: "image: ghcr.io/tanzim2000/omnia-omnicore:1",
		to: "image: ghcr.io/tanzim2000/omnia-omnicore:2"
	});

	try {
		let answer = await (await get("/updates/major")).json();
		assert.equal(answer.version, "2.0.0");
		assert.equal(answer.offReason, null, "nothing in the way but reading it");
		assert.ok(answer.html.startsWith("<h3>About 2.0.0</h3>"));
		assert.ok(answer.html.includes("<code>data/backups/before-2.0.0</code>"));
		assert.ok(answer.html.includes("You don't need to change anything."));

		coreUpdater.checkComposeFile = async () => ({ state: "manual", file: "/stack/compose.yml", from: "image: a:1", to: "image: a:2" });
		answer = await (await get("/updates/major")).json();
		assert.ok(answer.html.includes("One thing to do by hand, this time only."));
		assert.ok(answer.html.includes("<code>image: a:1</code> to"));

		// No Docker: it can be read, never pressed
		coreUpdater.applyReadiness = async () => ({ ready: false, reason: "no Docker" });
		answer = await (await get("/updates/major")).json();
		assert.match(answer.offReason, /^Updates are turned off on this install: OmniCore has no access to Docker/);

		// Nothing could be fetched: nothing to read, so it can't be pressed
		coreUpdater.applyReadiness = async () => ({ ready: true, reason: null });
		upgradeNotes.fetchUpgradeNotes = async () => null;
		answer = await (await get("/updates/major")).json();
		assert.match(answer.offReason, /couldn't be loaded from GitHub/);
	} finally {
		upgradeNotes.fetchUpgradeNotes = real.notes;
		coreUpdater.applyReadiness = real.ready;
		coreUpdater.checkComposeFile = real.compose;
	}
});

test("upgrade: only the version on offer, only where OmniCore can install it", async () => {
	process.env.OMNICORE_VERSION = "v1.20.0";
	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: "2.0.0" });

	let response = await post("/updates/major/apply", { version: "3.0.0" });
	assert.equal(response.status, 409);

	const realReady = coreUpdater.applyReadiness;
	coreUpdater.applyReadiness = async () => ({ ready: false, reason: "OmniCore can't reach Docker." });
	try {
		response = await post("/updates/major/apply", { version: "2.0.0" });
		assert.equal(response.status, 409);
		assert.equal((await response.json()).error, "OmniCore can't reach Docker.");
	} finally {
		coreUpdater.applyReadiness = realReady;
	}

	updateStore.recordCheck({ latestVersion: "1.20.0", updateAvailable: false, nextMajor: null });
	response = await post("/updates/major/apply", { version: "2.0.0" });
	assert.equal(response.status, 409, "nothing on offer");
	assert.equal((await get("/updates/major")).status, 404);
});

test("applyMajorUpgrade: only ever the next major after the one running", async () => {
	process.env.OMNICORE_VERSION = "v1.20.0";
	for (const version of ["1.21.0", "3.0.0", "nonsense"]) {
		const result = await coreUpdater.applyMajorUpgrade(version);
		assert.equal(result.updated, false, version);
		assert.match(result.reason, /isn't the next major version after 1\.20\.0/);
	}
	assert.equal(coreUpdater.currentProgress().busy, false, "nothing was started");
});
