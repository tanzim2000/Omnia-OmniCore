// test/profiles.test.js
// In short: Appearance profiles, the .ocap file
//
// Appearance profiles (2.0.0). How OmniCore's own pages look is a
// profile, and a profile is one .ocap file: a tar file holding
// profile.json, its maker's signature, and its picture and font.
//
//   - the file: any tar reader opens it; OmniCore reads it back
//   - the signature: a changed setting, a changed picture, a file added,
//     or no signature at all, and it's refused
//   - a profile from a stranger is never trusted as it is: what goes into
//     CSS is held to strict shapes
//   - the first one: made from the look an install already had, or black
//     with white text on a fresh one
//   - saving: the look goes into the profile, everything else into
//     settings.json
//   - each browser its own profile (a cookie), every port following it,
//     and the Profiles pop-up's routes: use, new, rename, default,
//     delete, export and import

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const tar = require("tar");

const { resetState, waitForPort, signIn } = helpers;
const paths = require("../core/paths");
const profiles = require("../core/profiles");
const backdrop = require("../core/backdrop");
const { readSettings, writeSettings, readStoredSettings, writeStoredSettings } = require("../core/settings-store");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(300, 7)]);
const WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(100, 3)]);

function stored() {
	return JSON.parse(fs.readFileSync(path.join(paths.dataDir(), "settings.json"), "utf-8"));
}

// An .ocap built by hand: profile.json as given, signed by `key` (a new
// key, unless one is given), with these files in it
function handMade(about, files, options) {
	const given = options || {};
	const pair = given.pair || crypto.generateKeyPairSync("ed25519");
	const listed = {};
	for (const [name, buffer] of Object.entries(files || {})) {
		listed[name] = { size: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") };
	}
	const json = Buffer.from(
		JSON.stringify({
			format: "ocap",
			version: 1,
			name: "Hand made",
			made: "2026-01-01T00:00:00.000Z",
			author: { key: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") },
			files: listed,
			...about
		})
	);
	const signature = given.noSignature ? null : Buffer.from(crypto.sign(null, json, pair.privateKey).toString("base64"));
	const out = path.join(paths.dataDir(), `hand-${crypto.randomBytes(4).toString("hex")}.tar`);
	profiles.writeTar(out, [
		{ name: "profile.json", buffer: json },
		...(signature ? [{ name: "signature", buffer: signature }] : []),
		...Object.entries({ ...files, ...(given.extra || {}) }).map(([name, buffer]) => ({ name, buffer }))
	]);
	const buffer = fs.readFileSync(out);
	fs.rmSync(out);
	return buffer;
}

const COLOUR = { backgroundKind: "colour", backgroundColor: "#3d5a99", glassBlur: 22, fontColour: "white" };

// --- The file ------------------------------------------------------------------

test("file: a fresh install's first profile is black with white text", () => {
	resetState();
	const made = profiles.ensure();

	assert.equal(made.name, "Default");
	assert.equal(made.values.backgroundKind, "colour", "a profile always has a picture or a colour");
	assert.equal(made.values.backgroundColor, "#000000");
	assert.equal(made.values.fontColour, "white");
	assert.equal(stored().defaultProfile, made.id, "and it's the default");
	assert.equal(profiles.ensure(), null, "only when there's none");
});

test("file: an ordinary tar file, which any tar reader opens", async () => {
	resetState();
	const made = profiles.ensure();
	const names = [];
	await tar.t({ file: made.file, onReadEntry: (entry) => names.push(entry.path) });
	assert.deepEqual(names, ["profile.json", "signature"]);

	const about = JSON.parse(profiles.verify(made.file) && fs.readFileSync(made.file).toString("utf-8", 512, 512 + 4096).replace(/\0[\s\S]*$/, ""));
	assert.equal(about.format, "ocap");
	assert.equal(about.version, 1);
	assert.ok(about.author.key, "its maker's public key");
});

test("file: an install with a picture and a font keeps them in its first profile", () => {
	resetState();
	fs.mkdirSync(backdrop.folder(), { recursive: true });
	fs.writeFileSync(path.join(backdrop.folder(), "backdrop-aaaaaaaaaaaa.jpg"), JPEG);
	fs.writeFileSync(path.join(paths.dataDir(), "ui-font.woff2"), WOFF2);
	writeStoredSettings({
		backgroundKind: "picture",
		backgroundType: "image/jpeg",
		backgroundFile: "backdrop-aaaaaaaaaaaa.jpg",
		backgroundColor: "#884422",
		backgroundMean: 0.4,
		glassDim: 30,
		uiFontFamily: "Inter",
		uiFontSize: 18,
		locationLabel: "Regina"
	});

	const made = profiles.ensure();
	assert.equal(made.name, "My look", "nothing changes on its screens");
	assert.equal(made.values.backgroundFile, "backdrop-aaaaaaaaaaaa.jpg");
	assert.equal(made.values.glassDim, 30);
	assert.equal(made.values.uiFontFamily, "Inter");
	assert.equal(made.values.uiFontSize, 18);
	assert.equal(made.values.locationLabel, undefined, "only the look");
	assert.deepEqual(Object.keys(made.files).sort(), ["backdrop-aaaaaaaaaaaa.jpg", "font.woff2"]);
	assert.deepEqual(fs.readFileSync(made.files["backdrop-aaaaaaaaaaaa.jpg"]), JPEG, "unpacked into the cache, as it was");
	assert.ok(made.files["font.woff2"].startsWith(profiles.cacheRoot()));

	// Default with black text became Beige Cream
	resetState();
	writeStoredSettings({ fontColour: "black" });
	assert.equal(profiles.ensure().values.backgroundColor, "#eedec5");
	fs.rmSync(path.join(paths.dataDir(), "ui-font.woff2"), { force: true });
	fs.rmSync(backdrop.folder(), { recursive: true, force: true });
});

// --- The signature -------------------------------------------------------------

test("signature: one from anyone is taken, and says who signed it", () => {
	resetState();
	profiles.ensure();
	const theirs = profiles.importFile(handMade({ values: COLOUR }));

	assert.equal(theirs.valid, true);
	assert.equal(theirs.author.ours, false);
	assert.match(theirs.author.fingerprint, /^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
	assert.equal(theirs.values.backgroundColor, "#3d5a99");
	assert.equal(profiles.listForPage().find((each) => each.id === theirs.id).maker, `Signed by ${theirs.author.fingerprint}`);
});

test("signature: a changed setting, a changed picture, an extra file or none at all, and it's refused", () => {
	resetState();
	profiles.ensure();
	const values = { backgroundKind: "picture", backgroundType: "image/jpeg", backgroundFile: "backdrop-bbbbbbbbbbbb.jpg", glassBlur: 22 };
	const good = handMade({ values }, { "backdrop-bbbbbbbbbbbb.jpg": JPEG });

	// A setting changed after it was signed
	const setting = Buffer.from(good);
	const at = setting.indexOf('"glassBlur":22');
	setting.write('"glassBlur":29', at);
	assert.throws(() => profiles.importFile(setting), /signature doesn't match/);

	// The picture changed after it was signed
	const picture = Buffer.from(good);
	const inPicture = picture.indexOf(JPEG) + 100;
	picture[inPicture] = picture[inPicture] ^ 0xff;
	assert.throws(() => profiles.importFile(picture), /changed after it was made/);

	// Something it doesn't list
	assert.throws(() => profiles.importFile(handMade({ values }, { "backdrop-bbbbbbbbbbbb.jpg": JPEG }, { extra: { "evil.sh": Buffer.from("rm -rf /") } })), /doesn't list/);

	// No signature
	assert.throws(() => profiles.importFile(handMade({ values: COLOUR }, {}, { noSignature: true })), /no profile in it|isn't signed/);

	// Not a tar at all, or cut short
	assert.throws(() => profiles.importFile(Buffer.from("hello there, this is not an ocap file at all".repeat(20))));
	assert.throws(() => profiles.importFile(good.subarray(0, 1100)));

	// None of those was kept, and the good one is
	assert.equal(profiles.list().length, 1);
	assert.equal(profiles.importFile(good).valid, true);
});

test("signature: a file inside can't be named to land anywhere else", () => {
	resetState();
	assert.throws(
		() => profiles.importFile(handMade({ values: COLOUR }, { "../../settings.json": Buffer.from("{}") })),
		/name a profile doesn't use/
	);
	assert.throws(
		() => profiles.importFile(handMade({ values: { ...COLOUR, backgroundKind: "picture", backgroundFile: "backdrop-cccccccccccc.jpg" } }, { "backdrop-cccccccccccc.jpg": Buffer.from("<svg onload=alert(1)>".padEnd(100)) })),
		/isn't what its name says/
	);
});

test("signature: a profile changed here is signed again by this OmniCore", () => {
	resetState();
	profiles.ensure();
	const theirs = profiles.importFile(handMade({ values: COLOUR }));
	const changed = profiles.update(theirs.id, { glassBlur: 9 });

	assert.equal(changed.values.glassBlur, 9);
	assert.equal(changed.author.ours, true);
	assert.equal(changed.made, "2026-01-01T00:00:00.000Z", "when it was first made is kept");
});

// --- A stranger's values ---------------------------------------------------------

test("values: what goes into CSS is held to strict shapes", () => {
	const clean = profiles.cleanValues(
		{
			uiFontFamily: 'Inter"; } body { display:none } /*',
			uiFontSize: 400,
			backgroundKind: "colour",
			backgroundColor: "red; background:url(https://evil)",
			glassTint: "url(x)",
			glassBlur: -5,
			glassDim: 1e9,
			fontColour: "pink",
			backButtonCorner: "bottom-left",
			locationLabel: "not a look setting"
		},
		{}
	);

	assert.equal(clean.uiFontFamily, undefined, "a font name that isn't one");
	assert.equal(clean.uiFontSize, 24, "brought into range");
	assert.equal(clean.backgroundKind, undefined, "a colour that isn't one is no background");
	assert.equal(clean.glassTint, undefined);
	assert.equal(clean.glassBlur, 0);
	assert.equal(clean.glassDim, backdrop.DIM_MOST);
	assert.equal(clean.fontColour, undefined);
	assert.equal(clean.backButtonCorner, undefined);
	assert.equal(clean.locationLabel, undefined);

	// A font's name only with the font in it
	assert.equal(profiles.cleanValues({ uiFontFamily: "Inter" }, {}).uiFontFamily, "");
	assert.equal(profiles.cleanValues({ uiFontFamily: "Inter" }, { "font.woff2": "x" }).uiFontFamily, "Inter");

	// A profile with no picture and no colour isn't one
	resetState();
	assert.throws(() => profiles.importFile(handMade({ values: { glassBlur: 3 } })), /no picture and no colour/);
});

// --- Saving ----------------------------------------------------------------------

test("saving: the look into the profile, everything else into settings.json", () => {
	resetState();
	const made = profiles.ensure();
	writeSettings({ glassBlur: 33, fontColour: "black", locationLabel: "Regina" });

	assert.equal(readSettings().glassBlur, 33);
	assert.equal(readSettings().profile.id, made.id);
	assert.equal(profiles.load(made.id).values.glassBlur, 33);
	assert.notEqual(stored().glassBlur, 33, "not in settings.json");
	assert.equal(stored().locationLabel, "Regina");

	// A save that would leave it with no picture and no colour is refused
	assert.throws(() => writeSettings({ backgroundKind: "plain" }), /picture or a colour/);
	assert.equal(profiles.load(made.id).valid, true);
});

test("saving: a new picture goes into the profile, and its file is served from the cache", () => {
	resetState();
	const made = profiles.ensure();
	fs.mkdirSync(backdrop.folder(), { recursive: true });
	fs.writeFileSync(path.join(backdrop.folder(), "backdrop-dddddddddddd.jpg"), JPEG);
	writeSettings({ backgroundKind: "picture", backgroundType: "image/jpeg", backgroundFile: "backdrop-dddddddddddd.jpg", backgroundStill: "" });

	const now = profiles.load(made.id);
	assert.equal(now.values.backgroundFile, "backdrop-dddddddddddd.jpg");
	assert.ok(profiles.filePath("backdrop-dddddddddddd.jpg").startsWith(profiles.cacheRoot()));
	assert.equal(profiles.filePath("backdrop-000000000000.jpg"), null, "only its own");

	// The cache can go: it's made again
	fs.rmSync(profiles.cacheRoot(), { recursive: true, force: true });
	fs.utimesSync(now.file, new Date(), new Date(Date.now() + 5000));
	assert.ok(fs.existsSync(profiles.filePath("backdrop-dddddddddddd.jpg")));
	fs.rmSync(backdrop.folder(), { recursive: true, force: true });
});

test("saving: copy, rename, default and delete", () => {
	resetState();
	const first = profiles.ensure();
	const second = profiles.copy(first.id, "Evening");
	assert.equal(second.name, "Evening");
	assert.deepEqual(second.values, first.values);

	profiles.rename(second.id, "  Night <b>time</b>  ");
	assert.equal(profiles.load(second.id).name, "Night btime/b");

	profiles.markDefault(second.id);
	assert.equal(profiles.defaultId(), second.id);
	assert.equal(profiles.current().id, second.id, "a browser that hasn't picked one gets the default");

	profiles.remove(second.id);
	assert.equal(profiles.defaultId(), first.id, "the default moves on when it's deleted");
	assert.throws(() => profiles.remove(first.id), /only profile/);
});

// --- Each browser, every port ------------------------------------------------------

let cookie = "";

async function request(port, address, options) {
	const given = options || {};
	return fetch(`http://127.0.0.1:${port}${address}`, {
		...given,
		headers: { cookie: [cookie, given.profile ? `${profiles.COOKIE}=${given.profile}` : ""].filter(Boolean).join("; "), ...(given.headers || {}) }
	});
}

async function post(address, body, profile) {
	const response = await request(3000, address, {
		method: "POST",
		profile,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body || {})
	});
	return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
}

test("pages: boots OmniCore's own faces with a profile", async () => {
	resetState();
	profiles.ensure();
	require("../core/admin-face")();
	require("../core/control-face")();
	require("../core/wizard-face")();
	await waitForPort(3000);
	await waitForPort(4000);
	await waitForPort(3999);
	cookie = await signIn(3000);
});

test("pages: each browser sees its own profile, on every port", async () => {
	const first = profiles.current();
	const other = profiles.importFile(handMade({ values: { ...COLOUR, glassAuto: false, glassBlur: 7 } }));

	for (const port of [3000, 3999, 4000]) {
		const mine = await (await request(port, "/")).text();
		const theirs = await (await request(port, "/", { profile: other.id })).text();
		assert.ok(!mine.includes("#3d5a99"), `the default on ${port}`);
		assert.ok(theirs.includes("--glass-blur: 7px;"), `the other profile on ${port}`);
	}

	// A pick that isn't a profile any more: the default
	const gone = await (await request(3000, "/", { profile: "ffffffffffff" })).text();
	assert.ok(gone.includes('id="profile-name">' + first.name));
});

test("pages: the Appearance tab names the profile and has the Profiles pop-up", async () => {
	const page = await (await request(3000, "/")).text();
	assert.match(page, /<div class="inset-label">PROFILE ON THIS DEVICE<\/div>\s*<div class="inset-value" id="profile-name">Default<\/div>/);
	assert.ok(page.includes('<button type="button" class="glass" id="open-profiles">Profiles</button>'));
	assert.ok(page.includes('id="profiles-modal"'));
	assert.ok(page.includes("Everything on this tab is saved, in this profile."));
});

test("pages: use, new, rename, default and delete, from the pop-up", async () => {
	const listed = (await (await request(3000, "/profiles")).json()).profiles;
	const other = listed.find((each) => !each.inUse);
	assert.ok(listed.find((each) => each.inUse && each.isDefault), "this browser has the default");

	// Use: a cookie for this browser only, for ten years
	const used = await post("/profiles/use", { id: other.id });
	assert.equal(used.status, 200);
	assert.match(used.headers.get("set-cookie"), new RegExp(`^omnicore_profile=${other.id}; Path=/; Max-Age=315360000; SameSite=Lax$`));
	assert.equal((await post("/profiles/use", { id: "ffffffffffff" })).status, 400);

	// New: a copy of the one this browser uses, and the browser uses it
	const made = await post("/profiles/new", { name: "Evening" }, other.id);
	assert.equal(made.status, 200);
	assert.match(made.headers.get("set-cookie"), new RegExp(`omnicore_profile=${made.body.id}`));
	assert.equal(profiles.load(made.body.id).values.glassBlur, 7);

	assert.equal((await post("/profiles/rename", { id: made.body.id, name: "Night" })).status, 200);
	assert.equal(profiles.load(made.body.id).name, "Night");
	assert.equal((await post("/profiles/default", { id: made.body.id })).status, 200);
	assert.equal(profiles.defaultId(), made.body.id);

	// Saving the Appearance tab saves into this browser's profile only
	await post("/appearance", { uiFontSize: 20 }, made.body.id);
	assert.equal(profiles.load(made.body.id).values.uiFontSize, 20);
	assert.notEqual(profiles.load(other.id).values.uiFontSize, 20);

	assert.equal((await post("/profiles/delete", { id: made.body.id })).status, 200);
	assert.equal(profiles.load(made.body.id).valid, false);
});

test("pages: export and import, as the file itself", async () => {
	const one = profiles.list()[0];
	const exported = await request(3000, `/profiles/${one.id}/export`);
	assert.equal(exported.status, 200);
	assert.match(exported.headers.get("content-disposition"), /^attachment; filename=".+\.ocap"$/);
	const bytes = Buffer.from(await exported.arrayBuffer());
	assert.deepEqual(bytes, fs.readFileSync(one.file), "as it is, signature and all");

	const before = profiles.list().length;
	const imported = await request(3000, "/profiles/import", {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: bytes
	});
	assert.equal(imported.status, 200);
	assert.equal(profiles.list().length, before + 1);

	// A changed one is refused, and says why
	const changed = Buffer.from(bytes);
	changed[changed.indexOf('"glassBlur"') + 2] = 0x58;
	const refused = await request(3000, "/profiles/import", {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: changed
	});
	assert.equal(refused.status, 400);
	assert.match((await refused.json()).error, /signature doesn't match/);

	// Signed out, none of it
	const out = await fetch(`http://127.0.0.1:3000/profiles/${one.id}/export`);
	assert.ok(!(await out.text()).startsWith("profile.json"));
});

test("pages: the font and the picture are the browser's profile's", async () => {
	fs.writeFileSync(path.join(paths.dataDir(), "ui-font.woff2"), WOFF2);
	const withFont = profiles.copy(profiles.list()[0].id, "With a font");
	profiles.update(withFont.id, { uiFontFamily: "Inter" });

	const font = await request(3000, "/ui-font.woff2", { profile: withFont.id });
	assert.equal(font.status, 200);
	assert.deepEqual(Buffer.from(await font.arrayBuffer()), WOFF2);
	const page = await (await request(3000, "/", { profile: withFont.id })).text();
	assert.match(page, /src: url\("\/ui-font\.woff2\?v=\d+"\)/);

	// Another browser on a profile without one: no font
	fs.rmSync(path.join(paths.dataDir(), "ui-font.woff2"));
	assert.equal((await request(3000, "/ui-font.woff2", { profile: profiles.defaultId() })).status, 404);
});

test("boot: start.OmniCore makes the first profile before any face starts", () => {
	const source = fs.readFileSync(path.join(__dirname, "..", "start.OmniCore"), "utf-8");
	assert.ok(source.indexOf('require("./core/profiles").ensure()') < source.indexOf("startFace(face)"));
});
