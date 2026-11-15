// test/marketplace-pictures.test.js
// Pictures in the Marketplace (since 2.0.0): a registry's `banner` and each
// entry's `icon`.
//
//   - Only an https:// address is used, and OmniCore 1.x reads neither
//     field, so a registry can carry them without breaking an older install
//   - The browser never gets the address itself: every picture goes
//     through the image proxy, under a short key
//   - The Marketplace shows the built-in registry's banner at the top, an
//     icon on every listing (or a coloured letter without one), and the
//     Sources page shows each registry's banner beside its name
//   - The Settings home's Marketplace tile asks for the registries'
//     banners once it's open, and crossfades them
//
// The registry and the picture fetching are replaced with fixed stand-ins,
// so nothing here touches the network.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");

const { resetState, waitForPort, signIn } = helpers;
const marketplace = require("../core/marketplace");
const imageProxy = require("../core/image-proxy");
const settingsHome = require("../core/settings-home");

const PORT = 3000;
let cookie;

const BANNER = "https://pictures.example/registry-banner.png";
const FRIEND_BANNER = "https://friend.example/banner.webp";
const ICON = "https://pictures.example/weather-icon.png";

let sources = [
	{ url: marketplace.DEFAULT_REGISTRY_URL, builtIn: true, banner: BANNER },
	{ url: "https://friend.example/registry.json", builtIn: false, banner: FRIEND_BANNER }
];

const REGISTRY = () => ({
	modules: [
		{ id: "weather", name: "Weather", author: "tanzim2000", description: "The weather", icon: ICON, minOmniCore: "1.0.0", installed: false },
		{ id: "disk-space", name: "disk Space", author: "tanzim2000", description: "Free space", icon: null, minOmniCore: "1.0.0", installed: false }
	],
	themes: [],
	sourceFailures: [],
	sources
});

const real = {
	listAvailable: marketplace.listAvailable,
	registrySources: marketplace.registrySources,
	fetchImage: imageProxy.fetchImage
};

marketplace.listAvailable = async () => REGISTRY();
marketplace.registrySources = async () => sources;
// Any picture asked for is a tiny PNG; nothing is fetched for real
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
let fetched = [];
imageProxy.fetchImage = async (url) => {
	fetched.push(url);
	return { body: PNG, type: "image/png", at: Date.now() };
};

test.after(() => {
	Object.assign(marketplace, { listAvailable: real.listAvailable, registrySources: real.registrySources });
	imageProxy.fetchImage = real.fetchImage;
});

async function get(path) {
	const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { Cookie: cookie } });
	return { status: response.status, headers: response.headers, text: await response.text() };
}

// --- Reading a registry ------------------------------------------------------

test("only an https:// picture address is used", () => {
	assert.equal(marketplace.safeImageUrl(" https://a.example/b.png "), "https://a.example/b.png");
	for (const bad of ["http://a.example/b.png", "javascript:alert(1)", "/local.png", "https://a b.png", 42, null, "https://" + "a".repeat(3000)]) {
		assert.equal(marketplace.safeImageUrl(bad), null, String(bad).slice(0, 30));
	}
});

test("a registry's banner is read with its lists; without one it's null", () => {
	const read = marketplace.readRegistry({ banner: BANNER, modules: [{ id: "a" }], themes: [] });
	assert.equal(read.banner, BANNER);
	assert.equal(read.modules.length, 1);
	assert.equal(marketplace.readRegistry({ modules: [] }).banner, null, "an older registry");
	assert.equal(marketplace.readRegistry({ banner: "http://plain.example/b.png" }).banner, null, "not https");
	assert.deepEqual(marketplace.readRegistry(null), { modules: [], themes: [], banner: null });
});

// --- The pages ---------------------------------------------------------------

test("marketplace pictures: boots signed in", async () => {
	resetState();
	require("../core/admin-face")();
	await waitForPort(PORT);
	cookie = await signIn(PORT);
});

test("the Marketplace: the built-in banner at the top, an icon or a letter on each listing", async () => {
	const { status, text } = await get("/marketplace");
	assert.equal(status, 200);
	assert.ok(text.includes('class="segment market-head has-banner"'), "the header with a banner");
	assert.match(text, /<img class="market-banner" src="\/marketplace\/screenshot\/banner%3A[0-9a-f]{16}" alt="">/);
	assert.match(text, /<img class="market-icon" src="\/marketplace\/screenshot\/icon%3A[0-9a-f]{16}"/);
	assert.ok(text.includes('<span class="market-icon market-initial" style="--hue:'), "a letter for the one without an icon");
	assert.ok(text.includes('aria-hidden="true">D</span>'), "its first letter, as a capital");
	assert.ok(!text.includes("pictures.example") && !text.includes("friend.example/banner"), "no picture's real address reaches the browser");
	assert.ok(text.includes("market-source-banner"), "the script that takes away a picture that won't load");
});

test("a registry without a banner: the header as it always was", async () => {
	const kept = sources;
	sources = [{ url: marketplace.DEFAULT_REGISTRY_URL, builtIn: true, banner: null }];
	try {
		const { text } = await get("/marketplace");
		assert.ok(text.includes('class="segment market-head"'));
		assert.ok(!text.includes('market-head has-banner"') && !text.includes('class="market-banner"'), "no banner");
		const banners = await get("/marketplace/banners");
		assert.deepEqual(JSON.parse(banners.text), [], "nothing for the Settings tile");
	} finally {
		sources = kept;
	}
});

test("the banners for the Settings tile: every registry's, built-in first, through the proxy", async () => {
	const { status, text } = await get("/marketplace/banners");
	assert.equal(status, 200);
	const banners = JSON.parse(text);
	assert.equal(banners.length, 2);
	for (const banner of banners) assert.match(banner.src, /^\/marketplace\/screenshot\/banner%3A[0-9a-f]{16}$/);

	fetched = [];
	const picture = await get(banners[0].src);
	assert.equal(picture.status, 200);
	assert.deepEqual(fetched, [BANNER], "the built-in registry's comes first");
	assert.equal(picture.headers.get("x-content-type-options"), "nosniff");
	assert.ok(picture.headers.get("content-security-policy").includes("sandbox"), "an SVG opened on its own can't run anything");
});

test("Sources: each registry's banner beside its name", async () => {
	const { text } = await get("/marketplace/sources");
	assert.match(text, /<img class="market-source-banner" src="\/marketplace\/screenshot\/banner%3A[0-9a-f]{16}"/);
});

test("the Settings home: the Marketplace tile asks for the banners once the page is open", async () => {
	const { text } = await get("/");
	assert.ok(/<a class="segment clickable home-tile c2 r2" href="\/marketplace" data-market-slides>/.test(text));
	assert.ok(text.includes('fetch("/marketplace/banners"'), "the slideshow script is on the page");
	assert.ok(!text.includes("pictures.example"), "the page itself carries no picture address");
});

test("the tile's slideshow: one at a time, still with reduced motion, only OmniCore's own addresses", () => {
	const script = settingsHome.MARKET_TILE_SCRIPT;
	assert.ok(script.includes('banner.src.indexOf("/marketplace/") !== 0'), "nothing from anywhere else");
	assert.ok(script.includes("still.matches || document.hidden"), "no movement with reduced motion, or unseen");
	assert.ok(script.includes("ready.length < 2"), "one banner stays still");
	assert.ok(settingsHome.SETTINGS_HOME_CSS.includes(".tile-slides img { transition: none; }"));
});
