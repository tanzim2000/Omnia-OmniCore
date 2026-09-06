// core/marketplace.js
// Browsing and installing modules and themes reviewed into the public
// registry, and only that — nothing here ever runs installed code. The
// point where installed code starts running is core/module-loader.js and
// core/theme-loader.js's own require() calls, unchanged by any of this.
//
// THE REGISTRY
//
// A single JSON file, hosted wherever the admin points OmniCore at — by
// default the project's own registry repo. Getting listed there means a
// pull request against that repo was reviewed and merged, so review already
// happened before this file ever runs. What this file does is narrower and
// entirely mechanical: fetch that list, and fetch exactly the pinned commit
// an entry names, never "whatever is on the branch right now".
//
// An entry is usually a whole repo — one module, one repo. It doesn't have
// to be: an optional `path` names a subfolder, so a studio can publish ten
// themes from a single repo and list each one separately. Everything else
// about that entry works exactly the same either way.
//
// Pinning to a commit rather than a branch is the whole point. A reviewed
// module that later turns malicious in a new push can't reach anyone who
// already installed it — the registry entry still points at the old,
// reviewed commit until its own PR bumps it.
//
// INSTALLING
//
// A tarball from GitHub is downloaded, extracted into an isolated staging
// folder, checked for the one file that makes it a real module or theme,
// and only THEN moved into modules/ or themes/. Nothing is written to
// either of those folders until every check has passed — a bad download
// leaves nothing behind to clean up.

const fs = require("https");
const zlib = require("zlib");
const fsSync = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const tar = require("tar");
const semver = require("semver");

const { readSettings, writeSettings } = require("./settings-store");
const omnicoreVersion = require("./version");
const installStore = require("./install-store");

const modulesDir = path.join(__dirname, "..", "modules");
const themesDir = path.join(__dirname, "..", "themes");

// The project's own registry, used whenever the admin hasn't pointed
// OmniCore somewhere else
const DEFAULT_REGISTRY_URL =
	"https://raw.githubusercontent.com/tanzim2000/Omnia-Registry/main/registry.json";

// A plain fetch, following one redirect if GitHub sends one — raw.
// githubusercontent.com doesn't normally, but codeload.github.com
// sometimes does, and failing on a redirect would be a confusing way for
// an install to break.
//
// HTTPS only, deliberately. This fetches a list of code to install and
// then the code itself; over plain HTTP anyone between here and the
// server could swap either one for something else. The check is explicit
// so a mistyped setting says so plainly instead of throwing Node's raw
// protocol error.
function fetchUrl(url, redirectsLeft) {
	const left = redirectsLeft === undefined ? 3 : redirectsLeft;

	if (!/^https:\/\//i.test(String(url || ""))) {
		return Promise.reject(
			new Error(`Registry URLs must start with https:// — got: ${url}`)
		);
	}

	return new Promise((resolve, reject) => {
		fs.get(
			url,
			{ headers: { "User-Agent": "OmniCore" } },
			(response) => {
				if (
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location &&
					left > 0
				) {
					response.resume(); // drain, or the socket never closes
					fetchUrl(response.headers.location, left - 1).then(resolve, reject);
					return;
				}

				if (response.statusCode !== 200) {
					response.resume();
					reject(
						new Error(
							`${url} responded ${response.statusCode}`
						)
					);
					return;
				}

				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => resolve(Buffer.concat(chunks)));
				response.on("error", reject);
			}
		).on("error", reject);
	});
}

// Fetch and parse one registry URL. Shared by the built-in fetch and every
// additional source, so both are held to the same shape.
async function fetchOneRegistry(url) {
	const body = await fetchUrl(url);
	const parsed = JSON.parse(body.toString("utf-8"));

	return {
		modules: Array.isArray(parsed.modules) ? parsed.modules : [],
		themes: Array.isArray(parsed.themes) ? parsed.themes : []
	};
}

// Every module and theme currently reviewed into the registry — the
// built-in one, plus whatever additional sources the admin has chosen to
// trust.
//
// The built-in registry failing is a real error: it's supposed to always
// be there, so if it isn't, something's actually wrong and the Marketplace
// page should say so plainly rather than quietly showing an empty list.
//
// An ADDITIONAL source failing is different. The admin added it
// voluntarily, after being warned, and one broken or slow third party
// shouldn't be able to take the whole Marketplace down for everyone —
// so a failed extra source is skipped, not fatal. `sourceFailures` on the
// result says which ones, so the page can still be honest about it.
async function fetchRegistry() {
	const settings = readSettings();
	const extraUrls = Array.isArray(settings.registrySources)
		? settings.registrySources
		: [];

	const builtIn = await fetchOneRegistry(DEFAULT_REGISTRY_URL);

	const modules = [...builtIn.modules];
	const themes = [...builtIn.themes];
	const sourceFailures = [];

	for (const url of extraUrls) {
		try {
			const extra = await fetchOneRegistry(url);
			modules.push(...extra.modules);
			themes.push(...extra.themes);
		} catch (error) {
			sourceFailures.push({ url, message: error.message });
		}
	}

	return { modules, themes, sourceFailures };
}

// Split a GitHub URL into the two parts a tarball download needs.
// Accepts the usual shapes: with or without a trailing slash, with or
// without a trailing ".git".
function parseRepoUrl(repoUrl) {
	const match = String(repoUrl || "").match(
		/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
	);

	if (!match) {
		throw new Error(`Not a github.com repo URL: ${repoUrl}`);
	}

	return { owner: match[1], repo: match[2] };
}

// GitHub's own archive endpoint. Chosen over the REST API's equivalent
// specifically because it isn't subject to the API's 60-requests-an-hour
// limit for anonymous callers — installing a module is a codeload request,
// nothing else.
function tarballUrl(owner, repo, ref) {
	return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
}

// A destination folder name must be safe to use as a literal path segment.
// The registry is reviewed, but this check costs nothing and means a typo
// or a compromised registry entry can't turn an id into a path.
function assertSafeId(id) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id || ""))) {
		throw new Error(`Not a valid id: ${id}`);
	}
}

// Does this entry's `minOmniCore` allow it to run on the OmniCore that's
// actually running right now?
//
// Interpreted as a caret range: same major version, at least that
// minor/patch. Never an open-ended "any future version" — a resource
// declaring it needs 1.1.0 is a claim about the 1.x line, not a promise
// that it'll still work after some future breaking v2. That upper bound
// is what makes a bare minimum meaningful without ever being asked to
// name a maximum.
//
// Missing `minOmniCore` is not a failure — it means either a registry
// entry from before this field existed, or a third-party registry that
// hasn't adopted it. Nothing to check against, so nothing blocks it; this
// can only get stricter as entries adopt the field, never reject
// something retroactively that installed fine yesterday.
function checkCompatibility(entry) {
	const required = entry && entry.minOmniCore;

	if (!required) {
		return { compatible: true, reason: null };
	}

	const coercedRequired = semver.coerce(required);

	if (!coercedRequired) {
		return {
			compatible: false,
			reason: `${entry.id} declares an invalid minOmniCore: ${required}`
		};
	}

	// A dev build (docker-compose.dev.yml, or "npm start" from a bare
	// clone) has no real release version to compare against. Refusing
	// every install because of that would make local development
	// impossible, so a dev build is trusted rather than blocked here —
	// same as it already is for the module/theme code itself, which a
	// dev build can run unreviewed and unpinned by design.
	const running = omnicoreVersion.comparableVersion();
	if (!running) {
		return { compatible: true, reason: null };
	}

	const ok = semver.satisfies(running, `^${coercedRequired.version}`);

	return {
		compatible: ok,
		reason: ok
			? null
			: `${entry.id} needs OmniCore ${required} or later (same major` +
			  ` version) — this install is running ${running}`
	};
}

// Defense in depth alongside whatever the tar library already refuses.
// Every extracted entry's resolved path must land inside the staging
// folder — never beside it, never above it.
function withinStagingArea(stagingDir, entryPath) {
	const resolved = path.resolve(stagingDir, entryPath);
	return resolved === stagingDir || resolved.startsWith(stagingDir + path.sep);
}

// A module or theme is plain files and folders — text, in every case this
// project ships. Nothing legitimate needs a symlink or a hardlink, and a
// symlink is exactly how a hostile archive escapes a sandboxed extraction
// without ever writing an unsafe PATH: the entry's own name can be
// perfectly safe ("icon.png") while what it POINTS to is
// "/etc/passwd" or a file elsewhere on this machine. Checking the path
// alone, as withinStagingArea does, cannot catch this — it has to be
// rejected by entry type instead.
function isPlainEntry(entry) {
	return entry.type === "File" || entry.type === "Directory";
}

// Unpack a tarball buffer into an isolated temp folder. Split out from
// stageEntry so the extraction mechanics — the part that actually touches
// disk — can be exercised directly against a buffer built by hand, not
// only against whatever a real download happens to contain.
async function extractTarball(tarball) {
	const stagingDir = await fsp.mkdtemp(
		path.join(os.tmpdir(), "omnicore-install-")
	);

	await new Promise((resolve, reject) => {
		const gunzip = zlib.createGunzip();
		const extractor = tar.extract({
			cwd: stagingDir,
			// GitHub wraps everything in one folder named "<repo>-<ref>/".
			// Stripping it means the module's own files land directly in
			// the staging folder rather than one level down.
			strip: 1,
			// Belt and braces on top of tar's own path-escape protection —
			// see withinStagingArea. A path can be entirely safe while what
			// it points to isn't, so entry TYPE is checked too — see
			// isPlainEntry. Anything that fails either is simply left out
			// of the extracted result.
			filter: (entryPath, entry) =>
				withinStagingArea(stagingDir, entryPath) && isPlainEntry(entry)
		});

		extractor.on("error", reject);
		extractor.on("finish", resolve);

		gunzip.on("error", reject);
		gunzip.pipe(extractor);
		gunzip.end(tarball);
	});

	return stagingDir;
}

// Download one registry entry's exact pinned commit and unpack it into an
// isolated temp folder. Nothing under modules/ or themes/ is touched here —
// see installEntry for the part that actually places it.
async function stageEntry(entry) {
	const { owner, repo } = parseRepoUrl(entry.repo);
	const tarball = await fetchUrl(tarballUrl(owner, repo, entry.ref));

	return extractTarball(tarball);
}

// Does a staged folder actually look like the kind of thing it claims to
// be? Checking a file exists, never running it — that stays entirely
// module-loader's and theme-loader's job, at ordinary require() time,
// exactly as it already works for every built-in module and theme.
async function assertLooksReal(stagingDir, kind) {
	const marker = kind === "theme" ? "index.html" : "index.js";
	const markerPath = path.join(stagingDir, marker);

	try {
		await fsp.access(markerPath);
	} catch (error) {
		throw new Error(
			`Downloaded ${kind} has no ${marker} — doesn't look right`
		);
	}
}

// Where in a staged download the actual module or theme lives.
//
// Most entries are the whole repo — one repo, one thing. But a studio
// might publish ten themes from a single repo, in which case an entry
// names a `path` inside it: "themes/metro", say. Empty or missing means
// "the repo root", which is every entry until this is used.
//
// A `path` is still something a registry entry supplies, so it gets the
// same treatment as a path inside a tarball: it must resolve to somewhere
// genuinely inside the staged download, never escape it via "../" — an
// entry can only ever point at part of its own extracted repo, never
// anywhere else on this machine.
function resolveSourceDir(stagingDir, subPath) {
	const clean = String(subPath || "").trim();

	if (!clean) {
		return stagingDir;
	}

	if (!withinStagingArea(stagingDir, clean)) {
		throw new Error(`Registry entry's path escapes its own repo: ${subPath}`);
	}

	const resolved = path.resolve(stagingDir, clean);

	if (!fsSync.existsSync(resolved)) {
		throw new Error(`Registry entry's path doesn't exist in its repo: ${subPath}`);
	}

	return resolved;
}

// Move a directory into place — tolerating source and destination being on
// different filesystems.
//
// fs.rename() is instant, because it only ever repoints a directory entry.
// That only works when both paths sit on the same filesystem, and here
// they often don't: the staging area lives under the OS's temp directory,
// which on plenty of real setups — Codespaces among them — is its own
// separate mount from wherever OmniCore itself lives. Crossing that
// boundary fails with EXDEV, and there is no way to know in advance
// whether it will. So: try the fast path first, and only fall back to an
// actual copy if the OS says no.
async function moveDir(src, dest) {
	try {
		await fsp.rename(src, dest);
	} catch (error) {
		if (error.code !== "EXDEV") {
			throw error;
		}

		await fsp.cp(src, dest, { recursive: true });
		await fsp.rm(src, { recursive: true, force: true });
	}
}
async function installFromEntry(kind, entry, update) {
	assertSafeId(entry.id);

	const destDir = path.join(
		kind === "theme" ? themesDir : modulesDir,
		entry.id
	);

	if (fsSync.existsSync(destDir) && !update) {
		throw new Error(
			`${entry.id} is already installed — pass update to replace it`
		);
	}

	// Checked before anything is downloaded — no point spending a network
	// round trip on code that's about to be refused anyway.
	const compatibility = checkCompatibility(entry);
	if (!compatibility.compatible) {
		throw new Error(compatibility.reason);
	}

	const stagingDir = await stageEntry(entry);

	try {
		const sourceDir = resolveSourceDir(stagingDir, entry.path);
		await assertLooksReal(sourceDir, kind);

		// Only now does anything under modules/ or themes/ change. rm
		// first so an update fully replaces rather than merges with
		// whatever was there before.
		await fsp.rm(destDir, { recursive: true, force: true });
		await moveDir(sourceDir, destDir);
	} finally {
		// Whatever's left of the staged download — all of it if this
		// entry named no path, or the rest of a studio's other themes if
		// it did — never belongs on disk once installation is decided one
		// way or the other. force:true means this is a no-op on the
		// common case where sourceDir WAS stagingDir and already moved.
		await fsp.rm(stagingDir, { recursive: true, force: true });
	}

	// Only recorded once the folder swap above actually succeeded — a
	// failed download or a failed move should never leave behind a record
	// of an install that isn't really sitting on disk.
	const recorded = installStore.record(kind, entry.id, {
		ref: entry.ref,
		minOmniCore: entry.minOmniCore || null
	});

	return {
		id: entry.id,
		kind,
		ref: entry.ref,
		installedAt: recorded.installedAt,
		updatedAt: recorded.updatedAt
	};
}

// Look one entry up in the registry and install it.
//
//   kind    "module" or "theme"
//   id      which entry, matched against entry.id in the registry
//   update  false (default) refuses if the destination already exists,
//           so a fresh install can never silently clobber something —
//           whether that's a previous install or local edits. Pass true
//           to intentionally replace an existing install.
async function installEntry(kind, id, update) {
	assertSafeId(id);

	const registry = await fetchRegistry();
	const list = kind === "theme" ? registry.themes : registry.modules;
	const entry = list.find((item) => item.id === id);

	if (!entry) {
		throw new Error(`${id} is not in the registry`);
	}

	return installFromEntry(kind, entry, update);
}

// Compares every installed module and theme against the registry's
// current entry for it, and reports anything whose pinned commit has
// moved on — that's the whole definition of "an update exists" now that
// resources don't carry a version number of their own: the registry
// entry's `ref` changing IS the update.
//
// Something installed by hand (or before install-store existed) has no
// record here, so it's silently excluded rather than reported as
// unavailable — there is nothing wrong with it, there's just nothing to
// compare it against yet.
async function checkForUpdates() {
	const registry = await fetchRegistry();

	return installStore
		.listAll()
		.map((installed) => {
			const list =
				installed.kind === "theme" ? registry.themes : registry.modules;
			const entry = list.find((item) => item.id === installed.id);

			// No longer listed at all — nothing to compare against, and not
			// this function's place to decide what that means.
			if (!entry) {
				return null;
			}

			if (entry.ref === installed.ref) {
				return null;
			}

			const compatibility = checkCompatibility(entry);

			return {
				id: installed.id,
				kind: installed.kind,
				currentRef: installed.ref,
				availableRef: entry.ref,
				compatible: compatibility.compatible,
				reason: compatibility.reason,
				entry
			};
		})
		.filter(Boolean);
}

// The background half of "auto-install silently": installs every
// compatible update found by checkForUpdates, and leaves incompatible
// ones alone rather than guessing. An incompatible update sitting
// unapplied isn't a bug to fix here — it's exactly the signal that this
// OmniCore itself needs updating before that resource can move forward,
// which is the self-update feature's job, not this one's.
async function applyAvailableUpdates() {
	const candidates = await checkForUpdates();

	const applied = [];
	const skipped = [];

	for (const candidate of candidates) {
		if (!candidate.compatible) {
			skipped.push({
				id: candidate.id,
				kind: candidate.kind,
				reason: candidate.reason
			});
			continue;
		}

		try {
			await installFromEntry(candidate.kind, candidate.entry, true);
			applied.push({
				id: candidate.id,
				kind: candidate.kind,
				ref: candidate.availableRef
			});
		} catch (error) {
			// One resource failing to update — a flaky download, a registry
			// hiccup — shouldn't stop the rest of the batch from being
			// checked.
			skipped.push({
				id: candidate.id,
				kind: candidate.kind,
				reason: error.message
			});
		}
	}

	return { applied, skipped };
}

// The registry, with each entry marked according to what's already on
// disk. This is what the admin face's marketplace page renders.
//
// `installed` is decided by the folder existing, which is the same thing
// module-loader and theme-loader go by — so this can never disagree with
// what OmniCore will actually load.
async function listAvailable() {
	const registry = await fetchRegistry();

	const mark = (kind, entries, dir) =>
		entries.map((entry) => {
			const installed = fsSync.existsSync(
				path.join(dir, String(entry.id || ""))
			);

			// The install-store record is what's actually authoritative for
			// "which commit is this" — the folder existing only ever proved
			// SOMETHING is there. No record (an install predating this
			// file, or dropped in by hand) just means no update can be
			// offered for it yet, not that it's broken.
			const recorded = installed ? installStore.get(kind, entry.id) : null;
			const updateAvailable = Boolean(
				recorded && recorded.ref !== entry.ref
			);

			return {
				...entry,
				installed,
				updateAvailable,
				updateCompatible: updateAvailable
					? checkCompatibility(entry).compatible
					: null
			};
		});

	return {
		modules: mark("module", registry.modules, modulesDir),
		themes: mark("theme", registry.themes, themesDir),
		sourceFailures: registry.sourceFailures
	};
}

// Add a third-party registry as a trusted source. Refuses a plain-HTTP
// URL for the same reason fetchUrl does, refuses the built-in registry's
// own URL (it's already included, always), and refuses one already added.
function addSource(url) {
	const clean = String(url || "").trim();

	if (!/^https:\/\//i.test(clean)) {
		throw new Error("A source must be an https:// URL");
	}

	if (clean === DEFAULT_REGISTRY_URL) {
		throw new Error("That's the built-in registry — it's already included");
	}

	const settings = readSettings();
	const sources = Array.isArray(settings.registrySources)
		? settings.registrySources
		: [];

	if (sources.includes(clean)) {
		throw new Error("That source is already added");
	}

	return writeSettings({ registrySources: [...sources, clean] });
}

// Remove a third-party source. The built-in registry is never in this
// list, so there is nothing here that can remove it.
function removeSource(url) {
	const settings = readSettings();
	const sources = Array.isArray(settings.registrySources)
		? settings.registrySources
		: [];

	return writeSettings({
		registrySources: sources.filter((s) => s !== url)
	});
}

// Cached fetches of module.json/theme.json's extra detail-page fields —
// url -> { data, at }. A detail page shouldn't refetch on every view, and
// a personal registry's traffic is small enough that memory is fine.
const detailCache = new Map();
const DETAIL_CACHE_MS = 10 * 60 * 1000;

// A theme id, the same shape assertSafeId already enforces for install
// destinations — reused here so a screenshot's `theme` field can only
// ever be a bare id, never a URL or anything else an unreviewed author
// might try to slip in.
function isSafeThemeId(value) {
	return /^[a-z0-9][a-z0-9-]*$/.test(String(value || ""));
}

// The two fields a detail page shows beyond what registry.json already
// reviewed: a longer description, and screenshots. Fetched from the
// module's OWN module.json (or theme's theme.json) — but at the exact
// commit registry.json pinned, never the branch, so this is exactly as
// tamper-proof as the installer's own download. Nothing else from that
// file is read: name, description, author and so on stay authoritative
// in registry.json, which is what was actually reviewed.
//
// Every string returned here is attacker-influenced (in the sense that
// whoever's repo this is wrote it, and it was never reviewed the way the
// registry.json entry pointing at it was). The caller MUST escape all of
// it before it touches HTML — this function does no escaping itself,
// since that's a rendering concern, not a fetching one.
async function fetchDetailExtras(kind, entry) {
	if (!entry || !entry.repo || !entry.ref) {
		return { completeDescription: "", screenshots: [] };
	}

	let owner, repo;

	try {
		({ owner, repo } = parseRepoUrl(entry.repo));
	} catch (error) {
		return { completeDescription: "", screenshots: [] };
	}

	const manifestName = kind === "theme" ? "theme.json" : "module.json";
	const subPath = entry.path ? entry.path.replace(/\/+$/, "") + "/" : "";
	const url =
		`https://raw.githubusercontent.com/${owner}/${repo}/${entry.ref}/` +
		`${subPath}${manifestName}`;

	const cached = detailCache.get(url);
	if (cached && Date.now() - cached.at < DETAIL_CACHE_MS) {
		return cached.data;
	}

	let result = { completeDescription: "", screenshots: [] };

	try {
		const body = await fetchUrl(url);
		const parsed = JSON.parse(body.toString("utf-8"));

		result.completeDescription =
			typeof parsed["complete-description"] === "string"
				? parsed["complete-description"]
				: "";

		if (Array.isArray(parsed.screenshots)) {
			result.screenshots = parsed.screenshots
				.filter((s) => s && typeof s.image === "string")
				.slice(0, 10) // a manifest claiming 500 screenshots isn't real
				.map((s) => ({
					image: s.image,
					description:
						typeof s.description === "string" ? s.description : "",
					// A bare theme id only — never trust a URL or markup an
					// unreviewed author's own file might put here
					theme: isSafeThemeId(s.theme) ? s.theme : ""
				}));
		}
	} catch (error) {
		// No module.json, no complete-description, a network hiccup —
		// all the same to the caller: show what registry.json already had
	}

	detailCache.set(url, { data: result, at: Date.now() });
	return result;
}

module.exports = {
	DEFAULT_REGISTRY_URL,
	fetchRegistry,
	listAvailable,
	parseRepoUrl,
	tarballUrl,
	installEntry,
	installFromEntry,
	checkCompatibility,
	checkForUpdates,
	applyAvailableUpdates,
	addSource,
	removeSource,
	fetchDetailExtras,
	// Exposed for testing the extraction and path-safety mechanics in
	// isolation from a real network fetch. Not part of the public surface
	// other files should call.
	extractTarball,
	withinStagingArea,
	isPlainEntry,
	resolveSourceDir
};