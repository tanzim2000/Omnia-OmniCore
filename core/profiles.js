// core/profiles.js
// Appearance profiles: the .ocap file (OmniCore Appearance Profile).
//
// Since 2.0.0 there's no Light or Dark mode. How OmniCore's own pages look
// (the background, the glass, the font colour, the font, its size, the
// Back button's corner) is a profile, and a profile is one .ocap file:
//
//   data/profiles/<id>.ocap
//
// Profiles are kept here on the server, so every device sees the same
// list. Each browser remembers which one it uses, in a cookie
// (omnicore_profile); a browser that hasn't picked one gets the default
// profile. Changing a profile changes it for every device using it.
//
// --- What's inside an .ocap ---------------------------------------------------
//
// An ordinary tar file, so anyone can look inside one (tar -tf):
//
//   profile.json   what it is: its name, when it was made, the settings
//                  (values), and every file in it with its size and its
//                  SHA-256 fingerprint
//   signature      the maker's Ed25519 signature of profile.json, exactly
//                  as it is, byte for byte
//   backdrop-…     the picture, animation or video, and its still frame
//   font.woff2     the font, when one was picked
//
// profile.json carries its maker's public key (author.key). A file whose
// signature doesn't match, or whose pictures don't match their
// fingerprints, is refused: if anyone changes a single byte (a setting or
// the picture), OmniCore can tell. Signing says who made it and that it's
// as they made it. It can't stop an exact copy being passed on: a copy is
// still authentic. That needs licences, later, in the Registry.
//
// This OmniCore signs with a key of its own (data/ocap-signing-key.pem,
// made the first time one is needed). A profile changed here is signed
// again with that key: it's this OmniCore's from then on.
//
// --- Reading one quickly ------------------------------------------------------
//
// Pages ask for the settings all the time, so a profile is read once and
// kept in memory until its file changes. Reading it checks everything
// (the signature and every file's fingerprint) and puts its pictures and
// its font in a cache folder (data/cache/ocap/<id>-<digest>/), where
// they're sent to the browser from. A 50 MB video is streamed from that
// copy, not pulled out of the .ocap every time. The cache can be deleted
// whenever: it's made again the next time it's needed.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const paths = require("./paths");

// The settings a profile holds: everything about how OmniCore's own pages
// look. Anything else in settings.json is the install's, not a profile's.
const KEYS = [
	"uiFontFamily",
	"uiFontSize",
	"backButtonCorner",
	"backgroundKind",
	"backgroundType",
	"backgroundFile",
	"backgroundStill",
	"backgroundColor",
	"backgroundVibrant",
	"backgroundLow",
	"backgroundHigh",
	"backgroundMean",
	"pictureBrightness",
	"glassAuto",
	"glassPinned",
	"glassBlur",
	"glassTint",
	"glassTintStrength",
	"glassDim",
	"fontColour"
];

const FORMAT = "ocap";
const VERSION = 1;
const COOKIE = "omnicore_profile";
const ID = /^[0-9a-f]{12}$/;

// The names a file inside an .ocap may have. Nothing else is ever read
// out of one, so a file can't put anything anywhere else.
const PICTURE_NAME = /^backdrop-[0-9a-f]{12}(-still)?\.(jpg|png|gif|webp|mp4|webm)$/;
const FONT_NAME = "font.woff2";

// How big things may be: the picture as big as an upload may be, the
// rest small. An .ocap bigger than this isn't one.
const MAX_JSON = 64 * 1024;
const MAX_SIGNATURE = 1024;
const MAX_FONT = 2 * 1024 * 1024;
const MAX_FILE = 70 * 1024 * 1024;

// A name for a profile: what someone typed, tidied, up to 40 characters
const NAME_MOST = 40;

function folder() {
	return path.join(paths.dataDir(), "profiles");
}

function fileOf(id) {
	return path.join(folder(), `${id}.ocap`);
}

function cacheRoot() {
	return path.join(paths.dataDir(), "cache", "ocap");
}

function keyFile() {
	return path.join(paths.dataDir(), "ocap-signing-key.pem");
}

function newId() {
	return crypto.randomBytes(6).toString("hex");
}

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cleanName(value, fallback) {
	const text = String(value === undefined || value === null ? "" : value)
		.replace(/[\u0000-\u001f\u007f<>]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, NAME_MOST);
	return text || fallback || "Profile";
}

// --- The tar file -------------------------------------------------------------
//
// A tar file is a row of 512-byte blocks: for each file, one block saying
// its name and size (the header), then the file itself, padded to a whole
// block. Two empty blocks end it. Written and read here rather than with
// a library, so reading profile.json never has to read past a 50 MB video
// to get to it, and nothing can be unpacked anywhere but where this says.

const BLOCK = 512;

function tarHeader(name, size) {
	const header = Buffer.alloc(BLOCK, 0);
	header.write(name, 0, 100, "utf-8");
	header.write("0000644\0", 100, "ascii"); // who may read it
	header.write("0000000\0", 108, "ascii"); // owner
	header.write("0000000\0", 116, "ascii"); // group
	header.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
	header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
	header.write("        ", 148, "ascii"); // the checksum's place, as spaces while it's added up
	header.write("0", 156, "ascii"); // an ordinary file
	header.write("ustar\0", 257, "ascii");
	header.write("00", 263, "ascii");

	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
	return header;
}

// Writes the tar to `target` in one go: to a .new file first, then renamed,
// so a profile is never half written. Each entry is { name, buffer } or
// { name, from } (a file to copy in, a piece at a time).
function writeTar(target, entries) {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const temporary = `${target}.new`;
	const out = fs.openSync(temporary, "w");
	const piece = Buffer.alloc(1024 * 1024);

	try {
		for (const entry of entries) {
			const size = entry.buffer ? entry.buffer.length : fs.statSync(entry.from).size;
			fs.writeSync(out, tarHeader(entry.name, size));

			if (entry.buffer) {
				fs.writeSync(out, entry.buffer);
			} else {
				const input = fs.openSync(entry.from, "r");
				try {
					let read;
					while ((read = fs.readSync(input, piece, 0, piece.length, null)) > 0) {
						fs.writeSync(out, piece, 0, read);
					}
				} finally {
					fs.closeSync(input);
				}
			}

			const padding = (BLOCK - (size % BLOCK)) % BLOCK;
			if (padding) fs.writeSync(out, Buffer.alloc(padding, 0));
		}
		fs.writeSync(out, Buffer.alloc(BLOCK * 2, 0));
	} finally {
		fs.closeSync(out);
	}

	fs.renameSync(temporary, target);
}

// What's in a tar file, without reading the files themselves:
// Map of name -> { offset, size }. Throws when it isn't a tar file this
// understands.
function readIndex(file) {
	const descriptor = fs.openSync(file, "r");
	try {
		const total = fs.fstatSync(descriptor).size;
		const header = Buffer.alloc(BLOCK);
		const entries = new Map();
		let at = 0;

		while (at + BLOCK <= total) {
			fs.readSync(descriptor, header, 0, BLOCK, at);
			if (header.every((byte) => byte === 0)) return entries;

			// The checksum: every byte of the header added up, with the
			// checksum's own place counted as spaces
			let sum = 0;
			for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
			const saved = parseInt(header.toString("ascii", 148, 156).replace(/\0.*$/s, "").trim(), 8);
			if (saved !== sum) throw new Error("This isn't an .ocap file OmniCore can read.");

			const name = header.toString("utf-8", 0, 100).replace(/\0.*$/s, "");
			const size = parseInt(header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
			const type = header[156];
			if (!Number.isFinite(size) || size < 0 || at + BLOCK + size > total) {
				throw new Error("This .ocap file is cut short.");
			}

			// Only ordinary files ("0", or an empty type in very old tars)
			if (type === 0x30 || type === 0) {
				if (entries.has(name)) throw new Error("This .ocap file has the same file in it twice.");
				entries.set(name, { offset: at + BLOCK, size });
			} else {
				throw new Error("This .ocap file has something in it that isn't a file.");
			}
			if (entries.size > 8) throw new Error("This .ocap file has more in it than a profile has.");

			at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
		}
		return entries;
	} finally {
		fs.closeSync(descriptor);
	}
}

function readEntry(file, entry) {
	const buffer = Buffer.alloc(entry.size);
	const descriptor = fs.openSync(file, "r");
	try {
		fs.readSync(descriptor, buffer, 0, entry.size, entry.offset);
	} finally {
		fs.closeSync(descriptor);
	}
	return buffer;
}

// A file inside the tar: its fingerprint, and a copy of it at `to` (when
// given), in one pass, a piece at a time
function hashEntry(file, entry, to) {
	const hash = crypto.createHash("sha256");
	const piece = Buffer.alloc(1024 * 1024);
	const descriptor = fs.openSync(file, "r");
	const out = to ? fs.openSync(to, "w") : null;
	try {
		let left = entry.size;
		let at = entry.offset;
		while (left > 0) {
			const read = fs.readSync(descriptor, piece, 0, Math.min(piece.length, left), at);
			if (read <= 0) throw new Error("This .ocap file is cut short.");
			hash.update(piece.subarray(0, read));
			if (out !== null) fs.writeSync(out, piece, 0, read);
			left -= read;
			at += read;
		}
	} finally {
		fs.closeSync(descriptor);
		if (out !== null) fs.closeSync(out);
	}
	return hash.digest("hex");
}

// --- Signing ------------------------------------------------------------------

// This OmniCore's own key, made the first time one is needed. Only ever
// on this server; profile.json carries the public half.
let keyCache = null;
function ownKey() {
	const file = keyFile();
	if (keyCache && keyCache.file === file && fs.existsSync(file)) return keyCache.key;
	if (!fs.existsSync(file)) {
		const pair = crypto.generateKeyPairSync("ed25519");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
	}
	const privateKey = crypto.createPrivateKey(fs.readFileSync(file));
	const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
	keyCache = { file, key: { privateKey, publicKey } };
	return keyCache.key;
}

// A short, readable form of a public key: the start of its fingerprint, in
// groups of four (like 3F2A 91C0 7B44 0E19)
function fingerprint(publicKey) {
	return sha256(Buffer.from(String(publicKey), "base64"))
		.slice(0, 16)
		.toUpperCase()
		.replace(/(.{4})(?!$)/g, "$1 ");
}

// --- What a profile may say ---------------------------------------------------
//
// A profile can come from anyone (bought, swapped, downloaded), so its
// settings are never trusted as they are: every one is checked here, and
// anything that isn't what it should be is left out (the install's own
// setting is used instead). The font's name goes into CSS and a colour
// into a style, so they're held to strict shapes.

const KINDS = ["picture", "animated", "video", "colour"];
const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", ""];
const PINS = ["blur", "tintStrength", "dim"];

const hex = (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null);
const unitOf = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null);
const between = (value, least, most) =>
	typeof value === "number" && Number.isFinite(value) ? Math.min(most, Math.max(least, Math.round(value))) : null;

function cleanValues(given, files) {
	const backdrop = require("./backdrop");
	const values = given && typeof given === "object" ? given : {};
	const has = (name) => Boolean(name) && Object.prototype.hasOwnProperty.call(files, name);
	const out = {};

	if (typeof values.uiFontFamily === "string" && /^[A-Za-z0-9 \-]{0,60}$/.test(values.uiFontFamily)) {
		// A font's name is only kept with the font itself
		out.uiFontFamily = has(FONT_NAME) ? values.uiFontFamily.trim() : "";
	}
	const size = between(values.uiFontSize, 12, 24);
	if (size !== null) out.uiFontSize = size;
	if (values.backButtonCorner === "bottom-right" || values.backButtonCorner === "top-left") {
		out.backButtonCorner = values.backButtonCorner;
	}

	// The background: a picture of some kind with its file in the profile,
	// or a colour. Nothing else makes a profile.
	if (KINDS.includes(values.backgroundKind)) {
		if (values.backgroundKind === "colour") {
			const colour = hex(values.backgroundColor);
			if (colour) {
				Object.assign(out, backdrop.useColour(colour).changes);
			}
		} else if (has(values.backgroundFile) && PICTURE_NAME.test(values.backgroundFile)) {
			const still = has(values.backgroundStill) && PICTURE_NAME.test(values.backgroundStill) ? values.backgroundStill : "";
			// A moving one needs its still frame, for reduced motion
			if (values.backgroundKind === "picture" || still) {
				Object.assign(out, {
					backgroundKind: values.backgroundKind,
					backgroundType: TYPES.includes(values.backgroundType) ? values.backgroundType : "",
					backgroundFile: values.backgroundFile,
					backgroundStill: still,
					backgroundColor: hex(values.backgroundColor) || "",
					backgroundVibrant: hex(values.backgroundVibrant) || hex(values.backgroundColor) || "",
					backgroundLow: unitOf(values.backgroundLow) === null ? 0.2 : unitOf(values.backgroundLow),
					backgroundHigh: unitOf(values.backgroundHigh) === null ? 0.8 : unitOf(values.backgroundHigh),
					backgroundMean: unitOf(values.backgroundMean) === null ? 0.5 : unitOf(values.backgroundMean)
				});
			}
		}
	}
	if (out.backgroundKind && out.backgroundKind !== "colour") {
		const brightness = between(values.pictureBrightness, backdrop.BRIGHTNESS_LEAST, backdrop.BRIGHTNESS_MOST);
		if (brightness !== null) out.pictureBrightness = brightness;
	}

	if (typeof values.glassAuto === "boolean") out.glassAuto = values.glassAuto;
	if (Array.isArray(values.glassPinned)) {
		out.glassPinned = PINS.filter((name) => values.glassPinned.includes(name));
	}
	const blur = between(values.glassBlur, 0, backdrop.BLUR_MOST);
	if (blur !== null) out.glassBlur = blur;
	const strength = between(values.glassTintStrength, 0, backdrop.TINT_STRENGTH_MOST);
	if (strength !== null) out.glassTintStrength = strength;
	const dim = between(values.glassDim, 0, backdrop.DIM_MOST);
	if (dim !== null) out.glassDim = dim;
	if (["none", "dominant", "vibrant"].includes(values.glassTint) || hex(values.glassTint)) {
		out.glassTint = hex(values.glassTint) || values.glassTint;
	}
	if (values.fontColour === "white" || values.fontColour === "black") out.fontColour = values.fontColour;

	return out;
}

// --- Reading a profile --------------------------------------------------------

// Every profile read so far, by id, with the size and time of the file it
// was read from: read again only once that changes
const memory = new Map();

// What one .ocap is, checked from end to end:
//
//   { id, valid: true, name, made, changed, author: { key, fingerprint,
//     ours }, values, files: { name: path of its copy in the cache },
//     digest, file }
//
// or { id, valid: false, error } when it can't be used.
function load(id) {
	if (!ID.test(String(id))) return { id, valid: false, error: "There's no such profile." };
	const file = fileOf(id);

	let stat;
	try {
		stat = fs.statSync(file);
	} catch (error) {
		memory.delete(id);
		return { id, valid: false, error: "There's no such profile." };
	}

	const stamp = `${stat.mtimeMs}:${stat.size}`;
	const known = memory.get(id);
	if (known && known.stamp === stamp) return known.profile;

	let profile;
	try {
		profile = { id, valid: true, file, ...verify(file, { cacheAs: id }) };
	} catch (error) {
		profile = { id, valid: false, error: error.message };
	}
	memory.set(id, { stamp, profile });
	return profile;
}

// Checks an .ocap file from end to end, and (with cacheAs) puts its files
// in the cache. Throws, saying what's wrong, when it can't be used.
function verify(file, options) {
	const given = options || {};
	const index = readIndex(file);

	const jsonEntry = index.get("profile.json");
	const signatureEntry = index.get("signature");
	if (!jsonEntry || !signatureEntry) throw new Error("This isn't an .ocap file: there's no profile in it.");
	if (jsonEntry.size > MAX_JSON || signatureEntry.size > MAX_SIGNATURE) {
		throw new Error("This .ocap file's profile is bigger than a profile is.");
	}

	const jsonBytes = readEntry(file, jsonEntry);
	let about;
	try {
		about = JSON.parse(jsonBytes.toString("utf-8"));
	} catch (error) {
		throw new Error("This .ocap file's profile can't be read.");
	}
	if (!about || about.format !== FORMAT || typeof about.version !== "number") {
		throw new Error("This isn't an .ocap file OmniCore can read.");
	}
	if (about.version > VERSION) {
		throw new Error("This profile was made by a newer OmniCore. Update OmniCore to use it.");
	}

	// The signature, over profile.json exactly as it is
	let publicKey;
	try {
		publicKey = crypto.createPublicKey({
			key: Buffer.from(String(about.author && about.author.key), "base64"),
			format: "der",
			type: "spki"
		});
	} catch (error) {
		throw new Error("This profile isn't signed, so OmniCore can't tell who made it or whether it was changed.");
	}
	if (publicKey.asymmetricKeyType !== "ed25519") {
		throw new Error("This profile isn't signed the way OmniCore signs profiles.");
	}
	const signature = Buffer.from(readEntry(file, signatureEntry).toString("ascii").trim(), "base64");
	if (!crypto.verify(null, jsonBytes, publicKey, signature)) {
		throw new Error("This profile's signature doesn't match: it was changed after it was made.");
	}

	// Every file it lists, and nothing it doesn't
	const listed = about.files && typeof about.files === "object" ? about.files : {};
	for (const name of index.keys()) {
		if (name !== "profile.json" && name !== "signature" && !Object.prototype.hasOwnProperty.call(listed, name)) {
			throw new Error("This .ocap file has something in it its profile doesn't list.");
		}
	}

	const digest = sha256(jsonBytes).slice(0, 16);
	const cacheDir = given.cacheAs ? path.join(cacheRoot(), `${given.cacheAs}-${digest}`) : null;
	const ready = cacheDir && fs.existsSync(cacheDir);
	const working = cacheDir && !ready ? `${cacheDir}.new-${process.pid}` : null;
	if (working) {
		fs.rmSync(working, { recursive: true, force: true });
		fs.mkdirSync(working, { recursive: true });
	}

	const backdrop = require("./backdrop");
	const files = {};
	try {
		for (const [name, info] of Object.entries(listed)) {
			if (name !== FONT_NAME && !PICTURE_NAME.test(name)) {
				throw new Error("This .ocap file has a file in it with a name a profile doesn't use.");
			}
			const entry = index.get(name);
			if (!entry || !info || entry.size !== info.size) {
				throw new Error("This .ocap file is missing a file its profile lists.");
			}
			if (entry.size > (name === FONT_NAME ? MAX_FONT : MAX_FILE)) {
				throw new Error("A file in this .ocap is bigger than OmniCore takes.");
			}

			// What it really is, by its first bytes, not its name
			const head = readEntry(file, { offset: entry.offset, size: Math.min(entry.size, 4096) });
			if (name === FONT_NAME) {
				if (head.toString("ascii", 0, 4) !== "wOF2") throw new Error("The font in this .ocap isn't a font.");
			} else {
				const found = backdrop.sniff(head);
				if (!found || found.ext !== name.split(".").pop()) {
					throw new Error("A picture in this .ocap isn't what its name says.");
				}
			}

			const copy = working ? path.join(working, name) : null;
			if (ready) {
				// Already in the cache: checked when it was put there, and the
				// cache is only ever this file's (its name has the digest)
				files[name] = path.join(cacheDir, name);
				continue;
			}
			if (hashEntry(file, entry, copy) !== String(info.sha256)) {
				throw new Error("A file in this .ocap was changed after it was made.");
			}
			files[name] = cacheDir ? path.join(cacheDir, name) : null;
		}

		if (working) {
			fs.renameSync(working, cacheDir);
		}
	} catch (error) {
		if (working) fs.rmSync(working, { recursive: true, force: true });
		throw error;
	}

	// An earlier copy of this profile in the cache isn't needed any more
	if (given.cacheAs) {
		try {
			for (const name of fs.readdirSync(cacheRoot())) {
				if (name.startsWith(`${given.cacheAs}-`) && name !== `${given.cacheAs}-${digest}`) {
					fs.rmSync(path.join(cacheRoot(), name), { recursive: true, force: true });
				}
			}
		} catch (error) {
			// Nothing to tidy
		}
	}

	const values = cleanValues(about.values, files);
	if (!values.backgroundKind) {
		throw new Error("This profile has no picture and no colour. A profile needs one or the other.");
	}

	const key = String(about.author.key);
	return {
		name: cleanName(about.name),
		made: typeof about.made === "string" ? about.made : "",
		changed: typeof about.changed === "string" ? about.changed : "",
		author: { key, fingerprint: fingerprint(key), ours: key === ownKey().publicKey },
		values,
		files,
		digest
	};
}

// --- Writing a profile --------------------------------------------------------

// Writes a profile, signed by this OmniCore. `sources` names where each
// of its files is now: { "backdrop-….jpg": "/path/to/it", "font.woff2": … }.
function write(id, about, values, sources) {
	const key = ownKey();
	const files = {};
	const entries = [];

	for (const [name, from] of Object.entries(sources)) {
		files[name] = { size: fs.statSync(from).size, sha256: hashFile(from) };
		entries.push({ name, from });
	}

	const now = new Date().toISOString();
	const json = Buffer.from(
		JSON.stringify(
			{
				format: FORMAT,
				version: VERSION,
				name: cleanName(about.name),
				made: about.made || now,
				changed: now,
				author: { key: key.publicKey },
				values,
				files
			},
			null,
			"\t"
		)
	);
	const signature = Buffer.from(crypto.sign(null, json, key.privateKey).toString("base64"));

	writeTar(fileOf(id), [{ name: "profile.json", buffer: json }, { name: "signature", buffer: signature }, ...entries]);
	memory.delete(id);
	return load(id);
}

function hashFile(file) {
	const hash = crypto.createHash("sha256");
	const piece = Buffer.alloc(1024 * 1024);
	const descriptor = fs.openSync(file, "r");
	try {
		let read;
		while ((read = fs.readSync(descriptor, piece, 0, piece.length, null)) > 0) hash.update(piece.subarray(0, read));
	} finally {
		fs.closeSync(descriptor);
	}
	return hash.digest("hex");
}

// The files a profile with these values needs, and where each is now:
// a new picture or font just saved (data/backdrop/, data/ui-font.woff2), or
// the copy in the cache of the profile it was before (`was`)
function sourcesFor(values, was, fresh) {
	const backdrop = require("./backdrop");
	const fontService = require("./font-service");
	const given = fresh || {};
	const sources = {};
	const find = (name) => {
		const saved = path.join(backdrop.folder(), name);
		if (fs.existsSync(saved)) return saved;
		if (was && was.files && was.files[name] && fs.existsSync(was.files[name])) return was.files[name];
		return null;
	};

	if (values.backgroundKind && values.backgroundKind !== "colour") {
		for (const name of [values.backgroundFile, values.backgroundStill]) {
			if (!name) continue;
			const from = find(name);
			if (!from) throw new Error("The picture for this profile can't be found any more.");
			sources[name] = from;
		}
	}

	if (values.uiFontFamily) {
		// A font just picked is in data/; otherwise the one the profile had
		const from = given.newFont
			? fontService.downloadedFontPath()
			: was && was.files && was.files[FONT_NAME] && fs.existsSync(was.files[FONT_NAME])
			? was.files[FONT_NAME]
			: fontService.downloadedFontPath();
		if (from) sources[FONT_NAME] = from;
	}
	return sources;
}

// Changes some of a profile's settings (the Appearance tab, saving) and
// writes it again, signed by this OmniCore. Only the profile's own
// settings (KEYS); anything else is ignored.
function update(id, changes) {
	const profile = load(id);
	if (!profile.valid) throw new Error(profile.error);

	const picked = {};
	for (const name of KEYS) {
		if (Object.prototype.hasOwnProperty.call(changes, name)) picked[name] = changes[name];
	}
	if (Object.keys(picked).length === 0) return profile;

	const values = { ...profile.values, ...picked };
	if (!values.uiFontFamily) delete values.uiFontFamily;
	const sources = sourcesFor(values, profile, { newFont: Boolean(picked.uiFontFamily) });
	if (values.uiFontFamily && !sources[FONT_NAME]) values.uiFontFamily = "";

	// Checked the way a profile is when it's read, before it's written, so
	// a save can never leave a profile that can't be used (one with no
	// picture and no colour, say)
	const checked = cleanValues(values, sources);
	if (!checked.backgroundKind) throw new Error("A profile needs a picture or a colour.");

	return write(id, { name: profile.name, made: profile.made }, values, sources);
}

// --- Which profiles there are, and which one is whose ------------------------

function ids() {
	try {
		return fs
			.readdirSync(folder())
			.filter((name) => /^[0-9a-f]{12}\.ocap$/.test(name))
			.map((name) => name.slice(0, 12));
	} catch (error) {
		return [];
	}
}

// Every profile, the ones that can be used first, oldest first
function list() {
	return ids()
		.map(load)
		.sort((a, b) => (a.valid === b.valid ? String(a.made).localeCompare(String(b.made)) : a.valid ? -1 : 1));
}

function storedSettings() {
	return require("./settings-store").readStoredSettings();
}

// The profile a browser that hasn't picked one gets: the one marked
// default (defaultProfile in settings.json), or the oldest that works
function defaultId() {
	const usable = list().filter((profile) => profile.valid);
	if (!usable.length) return null;
	const marked = storedSettings().defaultProfile;
	return usable.some((profile) => profile.id === marked) ? marked : usable[0].id;
}

// Which profile the browser asking now uses: its own pick (the cookie,
// through rememberProfile) when that's still a profile that works,
// otherwise the default
const asking = new AsyncLocalStorage();

function pickedId() {
	const store = asking.getStore();
	return store && store.id ? store.id : null;
}

function current() {
	try {
		const picked = pickedId();
		if (picked) {
			const profile = load(picked);
			if (profile.valid) return profile;
		}
		const fallback = defaultId();
		return fallback ? load(fallback) : null;
	} catch (error) {
		return null;
	}
}

function readCookie(req, name) {
	const header = (req && req.headers && req.headers.cookie) || "";
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at > -1 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
	}
	return "";
}

// Express middleware: on every port that draws OmniCore's own pages, so
// what the page reads (readSettings) is this browser's profile. The cookie
// reaches every port: a cookie is the address's, whatever the port.
function rememberProfile(req, res, next) {
	const id = readCookie(req, COOKIE);
	asking.run({ id: ID.test(id) ? id : null }, next);
}

// Runs `work` as a browser that picked this profile would (tests, and a
// page made for one profile)
function asProfile(id, work) {
	return asking.run({ id: ID.test(String(id)) ? id : null }, work);
}

// The cookie that makes this browser use a profile. Ten years: until it's
// changed. Readable by page scripts on purpose: it holds nothing secret,
// only which look this screen picked.
function cookieFor(id) {
	return `${COOKIE}=${id}; Path=/; Max-Age=315360000; SameSite=Lax`;
}

// --- Making, copying, importing, removing -------------------------------------

// The first profile, when there's none: made from the settings as they
// are (an install from before profiles keeps its look), and on a fresh
// install black with white text. A profile needs a picture or a colour,
// so the Default background becomes its colour: black, or Beige Cream
// when the text was black.
function ensure() {
	if (list().some((profile) => profile.valid)) {
		if (!storedSettings().defaultProfile || !load(storedSettings().defaultProfile).valid) markDefault(defaultId());
		return null;
	}

	const backdrop = require("./backdrop");
	const fontService = require("./font-service");
	const { DEFAULT_LIGHT, DEFAULT_DARK } = require("./ui-theme");
	const stored = storedSettings();
	const values = {};
	for (const name of KEYS) values[name] = stored[name];

	let sources = {};
	let customised = backdrop.hasBackdrop(stored) || Boolean(stored.uiFontFamily);
	if (backdrop.hasPicture(stored)) {
		try {
			sources = sourcesFor(values, null, { newFont: true });
		} catch (error) {
			// The picture has gone missing: black instead
			Object.assign(values, backdrop.useColour(DEFAULT_DARK).changes, { fontColour: "white" });
			customised = Boolean(stored.uiFontFamily);
		}
	}
	if (!backdrop.hasBackdrop(values)) {
		Object.assign(values, backdrop.useColour(values.fontColour === "black" ? DEFAULT_LIGHT : DEFAULT_DARK).changes);
	}
	if (!values.uiFontFamily) delete values.uiFontFamily;
	if (values.uiFontFamily) {
		const font = fontService.downloadedFontPath();
		if (font) sources[FONT_NAME] = font;
		else delete values.uiFontFamily;
	}
	if (!sources[FONT_NAME]) delete sources[FONT_NAME];

	const id = newId();
	const made = write(id, { name: customised ? "My look" : "Default" }, values, sources);
	markDefault(id);
	return made;
}

function markDefault(id) {
	if (id) require("./settings-store").writeStoredSettings({ defaultProfile: id });
}

// A new profile, a copy of another one (the one this browser uses), with
// a name of its own. Signed by this OmniCore.
function copy(fromId, name) {
	const from = load(fromId);
	if (!from.valid) throw new Error(from.error);
	const sources = {};
	for (const [file, at] of Object.entries(from.files)) sources[file] = at;
	return write(newId(), { name: cleanName(name, `${from.name} copy`) }, from.values, sources);
}

function rename(id, name) {
	const profile = load(id);
	if (!profile.valid) throw new Error(profile.error);
	return write(id, { name: cleanName(name, profile.name), made: profile.made }, profile.values, { ...profile.files });
}

// An .ocap someone brought: kept as it is (with its maker's signature),
// under a new id, once it checks out. Returns the profile, or throws
// saying why it can't be used.
function importFile(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Nothing arrived.");
	if (buffer.length > MAX_FILE + 4 * 1024 * 1024) throw new Error("That file is bigger than an .ocap can be.");

	fs.mkdirSync(folder(), { recursive: true });
	const id = newId();
	const waiting = path.join(folder(), `${id}.ocap.checking`);
	fs.writeFileSync(waiting, buffer);
	try {
		verify(waiting);
	} catch (error) {
		fs.rmSync(waiting, { force: true });
		throw error;
	}
	fs.renameSync(waiting, fileOf(id));
	const profile = load(id);
	if (!profile.valid) {
		remove(id, { force: true });
		throw new Error(profile.error);
	}
	return profile;
}

// Removes a profile and its cache. Not the last one that works: there's
// always one. When it was the default, the oldest one left is.
function remove(id, options) {
	const force = options && options.force;
	const profile = load(id);
	if (!force && profile.valid && list().filter((each) => each.valid).length <= 1) {
		throw new Error("This is the only profile. There's always one, so it can't be deleted.");
	}
	fs.rmSync(fileOf(id), { force: true });
	memory.delete(id);
	try {
		for (const name of fs.readdirSync(cacheRoot())) {
			if (name.startsWith(`${id}-`)) fs.rmSync(path.join(cacheRoot(), name), { recursive: true, force: true });
		}
	} catch (error) {
		// No cache to tidy
	}
	if (storedSettings().defaultProfile === id) markDefault(defaultId());
}

// --- For the pages --------------------------------------------------------------

// Where a file of the profile this browser uses is, to send it: its copy
// in the cache. Null when it isn't one of this profile's.
function filePath(name) {
	const profile = current();
	if (!profile || !profile.valid) return null;
	const at = profile.files[name];
	return at && fs.existsSync(at) ? at : null;
}

// A profile as the Profiles pop-up shows it: nothing secret, nothing that
// isn't needed
function forPage(profile, inUse, marked) {
	if (!profile.valid) return { id: profile.id, valid: false, error: profile.error };
	const values = profile.values;
	return {
		id: profile.id,
		valid: true,
		name: profile.name,
		background:
			values.backgroundKind === "colour"
				? `Colour ${values.backgroundColor}`
				: values.backgroundKind === "video"
				? "Video"
				: values.backgroundKind === "animated"
				? "Animation"
				: "Picture",
		maker: profile.author.ours ? "Made on this OmniCore" : `Signed by ${profile.author.fingerprint}`,
		ours: profile.author.ours,
		inUse: profile.id === inUse,
		isDefault: profile.id === marked
	};
}

function listForPage() {
	const inUse = current();
	const marked = defaultId();
	return list().map((profile) => forPage(profile, inUse && inUse.id, marked));
}

// The file name an exported .ocap is given: its name, kept to safe letters
function exportName(profile) {
	return `${profile.name.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "profile"}.ocap`;
}

module.exports = {
	KEYS,
	COOKIE,
	FORMAT,
	VERSION,
	FONT_NAME,
	folder,
	fileOf,
	cacheRoot,
	load,
	verify,
	list,
	listForPage,
	current,
	defaultId,
	markDefault,
	ensure,
	update,
	copy,
	rename,
	importFile,
	remove,
	filePath,
	rememberProfile,
	asProfile,
	cookieFor,
	exportName,
	fingerprint,
	cleanValues,
	writeTar,
	readIndex
};
