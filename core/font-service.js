// core/font-service.js
// Picking a font for OmniCore's own UI, from Google Fonts.
//
// The font is DOWNLOADED, once, and served by OmniCore itself from then
// on — never linked from Google's CDN at page-render time. Two reasons,
// both deliberate:
//
//   1. The admin UI has to work with no internet. Everything else in
//      OmniCore holds that line (World Clock's "This machine" mode
//      exists precisely to avoid a network call), and the screen you
//      use to FIX a broken network shouldn't itself need the network.
//   2. A CDN link means every page load tells Google who's looking and
//      from where. Same reasoning the image proxy already exists for.
//
// No API key. Both endpoints used here are the ones Google's own font
// picker uses from a browser, and neither requires credentials —
// consistent with how `weather` uses Open-Meteo rather than a keyed
// service.

const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const path = require("path");
const paths = require("./paths");

function dataDir() {
	return paths.dataDir();
}

function fontFile() {
	return path.join(dataDir(), "ui-font.woff2");
}

function metaFile() {
	return path.join(dataDir(), "ui-font.json");
}

// Google returns woff2 only when it believes the caller can handle it,
// and decides that from the User-Agent. Ask as an old browser and it
// serves TTF instead — several times the size for the same glyphs.
const MODERN_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TIMEOUT_MS = 15000;

function get(url, headers) {
	return new Promise((resolve, reject) => {
		const request = https.get(
			url,
			{ headers: { "User-Agent": MODERN_UA, ...(headers || {}) } },
			(response) => {
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`${url} responded ${response.statusCode}`));
					return;
				}

				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => resolve(Buffer.concat(chunks)));
				response.on("error", reject);
			}
		);

		request.on("error", reject);
		request.setTimeout(TIMEOUT_MS, () => {
			request.destroy();
			reject(new Error("Timed out reaching Google Fonts"));
		});
	});
}

// Google's own font-picker metadata. Cached in memory for the process's
// life — it's a ~1MB list that changes maybe monthly, and re-fetching it
// on every keystroke of a search box would be absurd.
let catalogue = null;

// The response is JSON with a short anti-hijacking prefix Google puts on
// its internal endpoints. Strip anything before the first brace rather
// than matching the exact prefix, which isn't documented and could
// change.
function parseCatalogue(raw) {
	const text = raw.toString("utf-8");
	const start = text.indexOf("{");

	if (start === -1) {
		throw new Error("Unrecognised font catalogue format");
	}

	return JSON.parse(text.slice(start));
}

async function loadCatalogue() {
	if (catalogue) {
		return catalogue;
	}

	const raw = await get("https://fonts.google.com/metadata/fonts");
	const parsed = parseCatalogue(raw);

	catalogue = (parsed.familyMetadataList || []).map((entry) => ({
		family: entry.family,
		category: entry.category
	}));

	return catalogue;
}

// Families matching a search, best-first. Deliberately capped — this
// feeds a picker someone scrolls, not a report.
async function searchFonts(query, limit) {
	const all = await loadCatalogue();
	const needle = String(query || "").trim().toLowerCase();

	if (!needle) {
		return all.slice(0, limit || 20);
	}

	const matches = all.filter((font) =>
		font.family.toLowerCase().includes(needle)
	);

	// A family whose name STARTS with the query is almost always what
	// someone meant — "Roboto" should beat "Roboto Condensed".
	matches.sort((a, b) => {
		const aStarts = a.family.toLowerCase().startsWith(needle);
		const bStarts = b.family.toLowerCase().startsWith(needle);

		if (aStarts !== bStarts) {
			return aStarts ? -1 : 1;
		}

		return a.family.localeCompare(b.family);
	});

	return matches.slice(0, limit || 20);
}

// Pull the first woff2 URL out of a Google Fonts CSS response.
function firstWoff2Url(css) {
	const match = css.match(/url\((https:\/\/[^)]+\.woff2)\)/);
	return match ? match[1] : null;
}

// Download one family's regular weight and keep it. Returns the family
// name on success so the caller can record it in settings.
//
// Only weight 400 is fetched: the UI uses one weight throughout, and
// pulling every weight of a large family would mean megabytes for
// glyphs nothing ever renders.
async function installFont(family) {
	const clean = String(family || "").trim();

	if (!clean) {
		throw new Error("No font family given");
	}

	// Confirm it's a real family rather than trusting the input — this
	// value ends up in a URL and in a CSS font-family declaration.
	const all = await loadCatalogue();
	const known = all.find(
		(font) => font.family.toLowerCase() === clean.toLowerCase()
	);

	if (!known) {
		throw new Error(`No Google font called "${clean}"`);
	}

	const cssUrl =
		"https://fonts.googleapis.com/css2?family=" +
		encodeURIComponent(known.family).replace(/%20/g, "+") +
		":wght@400&display=swap";

	const css = (await get(cssUrl)).toString("utf-8");
	const woff2Url = firstWoff2Url(css);

	if (!woff2Url) {
		throw new Error(`Google returned no woff2 for "${known.family}"`);
	}

	const font = await get(woff2Url);

	await fsp.mkdir(dataDir(), { recursive: true });
	await fsp.writeFile(fontFile(), font);
	await fsp.writeFile(
		metaFile(),
		JSON.stringify(
			{ family: known.family, installedAt: new Date().toISOString() },
			null,
			"\t"
		)
	);

	return known.family;
}

// Back to the system font. The file goes rather than lingering as dead
// weight in data/.
async function removeFont() {
	try {
		await fsp.unlink(fontFile());
	} catch (error) {
		// Already gone, which is the desired end state anyway
	}

	try {
		await fsp.unlink(metaFile());
	} catch (error) {
		// Same
	}
}

// Where the downloaded font actually is, or null if there isn't one.
// The routes that serve /ui-font.woff2 use this.
function installedFontPath() {
	return fs.existsSync(fontFile()) ? fontFile() : null;
}

function installedFont() {
	if (!fs.existsSync(metaFile())) {
		return null;
	}

	try {
		return JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
	} catch (error) {
		return null;
	}
}

// The Omnia wordmark's typeface. Fixed at Adamina rather than
// following the UI font setting -- a wordmark that changes typeface
// isn't a wordmark. Fetched once and stored alongside everything else,
// then served locally forever after; the About face falls back to a
// system serif until this succeeds, which still reads correctly.
//
// Separate from installFont above on purpose: that one is the user's
// choice and can be changed or removed, this one isn't and can't.
const TITLE_FONT_FAMILY = "Adamina";
function titleFontFile() {
	return path.join(dataDir(), "omnia-title.woff2");
}

async function ensureTitleFont() {
	if (fs.existsSync(titleFontFile())) {
		return true;
	}

	try {
		const css = (
			await get(
				"https://fonts.googleapis.com/css2?family=" +
					encodeURIComponent(TITLE_FONT_FAMILY) +
					"&display=swap"
			)
		).toString("utf-8");

		const url = firstWoff2Url(css);

		if (!url) {
			return false;
		}

		await fsp.mkdir(dataDir(), { recursive: true });
		await fsp.writeFile(titleFontFile(), await get(url));

		return true;
	} catch (error) {
		// No internet on first boot is a normal situation, not a
		// failure worth logging loudly -- the fallback serif is fine,
		// and the next start tries again.
		return false;
	}
}

// Mounts GET /ui-font.woff2 on a face's own Express app.
//
// Every face that renders the Default UI needs this, because a browser
// resolves the @font-face URL against the page's OWN origin — and each
// face is a different port, so each is a different origin. One shared
// route rather than three hand-written copies, for the same reason the
// stylesheet itself is shared.
//
// A 404 when no font is installed is correct, not a failure: the
// stylesheet only emits an @font-face rule at all once someone has
// picked something, so nothing requests this until there's a file to
// serve.
function attachFontRoute(app) {
	app.get("/ui-font.woff2", (req, res) => {
		const filePath = installedFontPath();

		if (!filePath) {
			res.status(404).end();
			return;
		}

		// Immutable in practice: picking a different font writes a
		// different file, and the browser is told to re-check on a
		// normal reload anyway.
		res.type("font/woff2");
		res.sendFile(filePath);
	});
}

module.exports = {
	searchFonts,
	installFont,
	removeFont,
	installedFontPath,
	installedFont,
	attachFontRoute,
	ensureTitleFont,
	TITLE_FONT_FAMILY,
	// Exported for tests: parsing shouldn't only be reachable through a
	// network call.
	parseCatalogue,
	firstWoff2Url
};