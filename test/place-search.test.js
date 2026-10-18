// test/place-search.test.js
// Place search (v2): eight services, a Primary and a Secondary, and what
// the pages are told.
//
//   - Every service's answer is read into the same shape, from saved
//     answers (test/fixtures/place-search; see its README for which are
//     real and which are written from the documentation). Nothing here
//     calls a real service.
//   - The Secondary is asked when the Primary finds nothing, can't be
//     reached, refuses its key, or has no key saved, and the page is told
//     why. A Primary with no key is never even asked.
//   - Keys only ever go to their own service, never back to a page.
//   - The same search is answered from memory for a day; Nominatim and
//     Geocode.maps.co are never asked twice within a second.
//   - The setting: what may be saved, and the warning when it won't work.
//   - The pages: the settings page, /geocode on both ports, and the shared
//     browser code on all three pages that search.
//   - A hand-run image is a development build, with the CHANGELOG in it.

const helpers = require("./helpers");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { resetState, waitForPort, signIn } = helpers;
const placeSearch = require("../core/place-search");
const { readSettings, writeSettings } = require("../core/settings-store");

const FIXTURES = path.join(__dirname, "fixtures", "place-search");
const ROOT = path.join(__dirname, "..");
const saved = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8"));

const HOSTS = {
	"geocoding-api.open-meteo.com": "open-meteo",
	"nominatim.openstreetmap.org": "nominatim",
	"photon.komoot.io": "photon",
	"secure.geonames.org": "geonames",
	"us1.locationiq.com": "locationiq",
	"api.geoapify.com": "geoapify",
	"geocode.maps.co": "geocode-maps-co"
};

// Every request made, and what each service answers: { service: answer }
// where an answer is { status, data }, or "down" for no answer at all
let calls = [];
let answers = {};

function fake(url, headers) {
	const service = HOSTS[new URL(url).hostname];
	calls.push({ service, url, headers: headers || {}, at: Date.now() });
	const answer = answers[service];
	if (!answer || answer === "down") return Promise.reject(new Error("no answer"));
	return Promise.resolve(answer);
}

const ok = (name) => ({ status: 200, data: saved(name) });

function fresh(services) {
	calls = [];
	answers = services || {};
	placeSearch.setRequestForTests(fake);
}

const KEYS = {
	geonames: "my-geonames-user",
	locationiq: "pk.locationiq-secret",
	geoapify: "geoapify-secret",
	"geocode-maps-co": "maps-co-secret"
};

const only = (primary, secondary, keys) => ({
	placeSearchPrimary: primary,
	placeSearchSecondary: secondary || "none",
	placeSearchKeys: keys || KEYS
});

test.after(() => placeSearch.setRequestForTests(null));

// --- Reading each service --------------------------------------------------------

test("seven services, two without a key by default, and no Google", () => {
	assert.deepEqual(
		placeSearch.SERVICES.map((s) => s.id),
		["open-meteo", "nominatim", "photon", "geonames", "locationiq", "geoapify", "geocode-maps-co"]
	);

	// Dropped when v2 was finished: a Google choice saved before then is
	// unknown, so the default Primary is used, or no Secondary
	const old = placeSearch.chosen({ placeSearchPrimary: "google", placeSearchSecondary: "google" });
	assert.equal(old.primary.id, "open-meteo");
	assert.equal(old.secondary, null);
	assert.ok(!placeSearch.servicesForPage({ placeSearchKeys: { google: "k" } }).some((s) => s.id === "google"));
	assert.equal(placeSearch.DEFAULT_PRIMARY, "open-meteo");
	assert.equal(placeSearch.DEFAULT_SECONDARY, "nominatim");
	for (const id of ["open-meteo", "nominatim", "photon"]) {
		assert.ok(!placeSearch.SERVICES.find((s) => s.id === id).key, `${id} needs no key`);
	}
});

test("every service's answer is read into label, latitude and longitude", async () => {
	const cases = [
		["open-meteo", "open-meteo-regina", "Regina", "Regina, Saskatchewan, Canada", 50.45008],
		["nominatim", "nominatim-bekkestua", "Bekkestua", "Bekkestua, Bærum, Akershus, Norway", 59.9173125],
		["photon", "photon-bekkestua", "Bekkestua", "Bekkestua, Akershus, Norway", 59.9173125],
		["geonames", "geonames-bekkestua", "Bekkestua", "Bekkestua, Akershus, Norway", 59.91775],
		["locationiq", "locationiq-bekkestua", "Bekkestua", "Bekkestua, Bærum, Akershus, Norway", 59.9177484],
		["geoapify", "geoapify-bekkestua", "Bekkestua", "Bekkestua, Bærum, Akershus, Norway", 59.9177484],
		["geocode-maps-co", "geocode-maps-co-bekkestua", "Bekkestua", "Bekkestua, Bærum, Akershus, Norway", 59.9177484]
	];

	for (const [id, file, query, label, latitude] of cases) {
		fresh({ [id]: ok(file) });
		const answer = await placeSearch.searchPlaces(query, only(id));

		assert.equal(answer.service.id, id, `${id} answered`);
		assert.ok(answer.places.length > 0, `${id} found something`);
		assert.equal(answer.places[0].label, label, `${id}'s first label`);
		assert.equal(answer.places[0].latitude, latitude, `${id}'s latitude, as a number`);
		assert.equal(typeof answer.places[0].longitude, "number");
		assert.equal(answer.note, null, "the Primary answered: nothing to explain");
		assert.ok(answer.places.length <= 6, "six at most");
	}
});

test("two matches that read the same are shown once", async () => {
	// Nominatim's Bekkestua: the station and the village have the same
	// label, so only the first is kept
	fresh({ nominatim: ok("nominatim-bekkestua") });
	const { places } = await placeSearch.searchPlaces("Bekkestua", only("nominatim"));
	const labels = places.map((p) => p.label);
	assert.equal(new Set(labels).size, labels.length);
	assert.equal(labels.filter((l) => l === "Bekkestua, Bærum, Akershus, Norway").length, 1);
});

// --- Primary, then Secondary ---------------------------------------------------------

test("default: Open-Meteo finds no Bekkestua, so Nominatim is asked, and says so", async () => {
	fresh({ "open-meteo": ok("open-meteo-bekkestua"), nominatim: ok("nominatim-bekkestua") });
	const answer = await placeSearch.searchPlaces("Bekkestua", {});

	assert.deepEqual(calls.map((c) => c.service), ["open-meteo", "nominatim"]);
	assert.equal(answer.service.id, "nominatim");
	assert.equal(answer.note, "Open-Meteo found nothing, so Nominatim (OpenStreetMap) was asked.");
	assert.equal(answer.places[0].label, "Bekkestua, Bærum, Akershus, Norway");

	// Nominatim's credit, and OpenStreetMap's
	assert.equal(answer.credit.text, "Search by Nominatim");
	assert.equal(answer.credit.osm.text, "© OpenStreetMap contributors");
	assert.equal(answer.credit.osm.url, "https://www.openstreetmap.org/copyright");
});

test("Bærum: Nominatim finds the municipality", async () => {
	fresh({ nominatim: ok("nominatim-baerum") });
	const { places } = await placeSearch.searchPlaces("Bærum", only("nominatim"));
	assert.equal(places[0].label, "Bærum, Akershus, Norway");
});

test("a Primary that finds something is the only one asked", async () => {
	fresh({ "open-meteo": ok("open-meteo-regina"), nominatim: ok("nominatim-bekkestua") });
	const answer = await placeSearch.searchPlaces("Regina", {});
	assert.deepEqual(calls.map((c) => c.service), ["open-meteo"]);
	assert.equal(answer.credit.osm, null, "Open-Meteo isn't OpenStreetMap");
});

test("a Primary with no key saved is never asked, and the Secondary is", async () => {
	fresh({ geonames: ok("geonames-bekkestua"), photon: ok("photon-bekkestua") });
	const answer = await placeSearch.searchPlaces("Bekkestua", only("geonames", "photon", {}));

	assert.deepEqual(calls.map((c) => c.service), ["photon"]);
	assert.equal(answer.note, "GeoNames has no key saved, so Photon (komoot) was asked.");
});

test("a refused key, a service that's down, too many searches: the Secondary is asked", async () => {
	const cases = [
		["geonames", { status: 200, data: saved("geonames-refused") }, "GeoNames refused its key"],
		["geonames", { status: 200, data: saved("geonames-limit") }, "GeoNames said too many searches"],
		["locationiq", { status: 401, data: saved("locationiq-refused") }, "LocationIQ refused its key"],
		["geoapify", { status: 401, data: saved("geoapify-refused") }, "Geoapify refused its key"],
		["geocode-maps-co", { status: 429, data: null }, "Geocode.maps.co said too many searches"],
		["open-meteo", "down", "Open-Meteo couldn't be reached"],
		["open-meteo", { status: 500, data: null }, "Open-Meteo couldn't be reached"],
		["open-meteo", { status: 200, data: "<html>" }, "Open-Meteo couldn't be reached"]
	];

	for (const [id, answer, why] of cases) {
		fresh({ [id]: answer, nominatim: ok("nominatim-bekkestua") });
		const result = await placeSearch.searchPlaces("Bekkestua", only(id, "nominatim"));
		assert.equal(result.note, `${why}, so Nominatim (OpenStreetMap) was asked.`, id);
		assert.equal(result.service.id, "nominatim");
	}
});

test("nothing found: LocationIQ's 404 is an answer, not a failure", async () => {
	fresh({ locationiq: { status: 404, data: saved("locationiq-nothing") } });
	assert.equal((await placeSearch.searchPlaces("Nowhere", only("locationiq"))).note, null);
});

test("when neither finds it, or neither can, the page is told", async () => {
	fresh({ "open-meteo": ok("open-meteo-bekkestua"), nominatim: ok("nominatim-nothing") });
	let answer = await placeSearch.searchPlaces("zzqxvb", {});
	assert.deepEqual(answer.places, []);
	assert.equal(answer.service, null);
	assert.equal(answer.credit, null);
	assert.equal(answer.note, "Neither Open-Meteo nor Nominatim (OpenStreetMap) found it.");

	fresh({ "open-meteo": "down", nominatim: "down" });
	answer = await placeSearch.searchPlaces("Regina", {});
	assert.equal(answer.note, "Open-Meteo couldn't be reached, and Nominatim (OpenStreetMap) couldn't be reached.");
});

test("no Secondary: only the Primary is asked", async () => {
	fresh({ "open-meteo": ok("open-meteo-bekkestua"), nominatim: ok("nominatim-bekkestua") });
	const answer = await placeSearch.searchPlaces("Bekkestua", only("open-meteo", "none"));
	assert.deepEqual(calls.map((c) => c.service), ["open-meteo"]);
	assert.deepEqual(answer.places, []);
	assert.equal(answer.note, null, "plain nothing found");
});

test("a Secondary the same as the Primary, or unknown, is none", () => {
	assert.equal(placeSearch.chosen({ placeSearchPrimary: "photon", placeSearchSecondary: "photon" }).secondary, null);
	assert.equal(placeSearch.chosen({ placeSearchSecondary: "made-up" }).secondary, null);
	assert.equal(placeSearch.chosen({ placeSearchPrimary: "made-up" }).primary.id, "open-meteo");
});

test("a search under two letters asks nobody", async () => {
	fresh({});
	for (const query of ["", " ", "a", " b ", null, 42]) {
		assert.deepEqual((await placeSearch.searchPlaces(query, {})).places, []);
	}
	assert.equal(calls.length, 0);
});

// --- Keys --------------------------------------------------------------------------------

test("a key only ever goes to its own service, and Geocode.maps.co's in a header", async () => {
	const everything = {};
	for (const id of Object.keys(KEYS)) everything[id] = "down";
	everything.nominatim = ok("nominatim-nothing");

	for (const id of Object.keys(KEYS)) {
		fresh(everything);
		await placeSearch.searchPlaces("Bekkestua", only(id, "nominatim"));

		for (const call of calls) {
			const sent = call.url + " " + JSON.stringify(call.headers);
			for (const [owner, key] of Object.entries(KEYS)) {
				if (owner === call.service) continue;
				assert.ok(!sent.includes(key), `${owner}'s key never goes to ${call.service}`);
			}
		}

		const own = calls.find((c) => c.service === id);
		if (id === "geocode-maps-co") {
			assert.equal(own.headers.Authorization, "Bearer " + KEYS[id]);
			assert.ok(!own.url.includes(KEYS[id]), "not in the address");
		} else {
			assert.ok(own.url.includes(encodeURIComponent(KEYS[id])), `${id} gets its key`);
		}
	}
});

test("the same search is answered from memory; another key asks again", async () => {
	fresh({ photon: ok("photon-bekkestua") });
	await placeSearch.searchPlaces("Bekkestua", only("photon"));
	await placeSearch.searchPlaces("bekkestua ", only("photon"));
	assert.equal(calls.length, 1, "the same words, any capitals: one request");

	fresh({ geoapify: ok("geoapify-bekkestua") });
	await placeSearch.searchPlaces("Bekkestua", only("geoapify", "none", { geoapify: "one" }));
	await placeSearch.searchPlaces("Bekkestua", only("geoapify", "none", { geoapify: "two" }));
	assert.equal(calls.length, 2, "a new key could get another answer");
});

test("Nominatim is never asked twice within a second", async () => {
	fresh({ nominatim: ok("nominatim-bekkestua") });
	await Promise.all([
		placeSearch.searchPlaces("Bekkestua", only("nominatim")),
		placeSearch.searchPlaces("Stabekk", only("nominatim")),
		placeSearch.searchPlaces("Lysaker", only("nominatim"))
	]);
	assert.equal(calls.length, 3);
	const at = calls.map((c) => c.at).sort((a, b) => a - b);
	assert.ok(at[1] - at[0] >= 990 && at[2] - at[1] >= 990, `a second apart: ${at[1] - at[0]}ms, ${at[2] - at[1]}ms`);
});

test("every request says it comes from OmniCore", async () => {
	// The real request adds the User-Agent; checked by reading it
	const source = fs.readFileSync(path.join(ROOT, "core", "place-search.js"), "utf8");
	assert.match(source, /"User-Agent": DEFAULT_USER_AGENT/);
});

// --- The setting ------------------------------------------------------------------------

test("setting: known services only, the Secondary never the Primary", () => {
	assert.deepEqual(placeSearch.cleanSetting({ primary: "photon", secondary: "nominatim" }, {}), {
		placeSearchPrimary: "photon",
		placeSearchSecondary: "nominatim"
	});
	assert.deepEqual(placeSearch.cleanSetting({ primary: "made-up", secondary: "<script>" }, {}), {});
	assert.deepEqual(placeSearch.cleanSetting({ primary: "photon", secondary: "photon" }, {}), {
		placeSearchPrimary: "photon",
		placeSearchSecondary: "none"
	});
	// Changing only the Primary to what the Secondary was
	assert.deepEqual(placeSearch.cleanSetting({ primary: "nominatim" }, { placeSearchSecondary: "nominatim" }), {
		placeSearchPrimary: "nominatim",
		placeSearchSecondary: "none"
	});
});

test("setting: keys are trimmed, kept only for services that take one, and an empty box keeps the saved one", () => {
	const current = { placeSearchKeys: { geonames: "old-user", geoapify: "old-geoapify" } };

	const changes = placeSearch.cleanSetting(
		{
			keys: { geonames: "  new-user  ", "open-meteo": "nope", madeup: "nope", geoapify: "", locationiq: 7 },
			removeKeys: []
		},
		current
	);
	assert.deepEqual(changes.placeSearchKeys, { geonames: "new-user", geoapify: "old-geoapify" });

	const removed = placeSearch.cleanSetting({ removeKeys: ["geoapify", "made-up"] }, current);
	assert.deepEqual(removed.placeSearchKeys, { geonames: "old-user" });

	const long = placeSearch.cleanSetting({ keys: { geoapify: "x".repeat(500) } }, {});
	assert.equal(long.placeSearchKeys.geoapify.length, 200);

	assert.deepEqual(placeSearch.cleanSetting({ keys: {} }, current), {}, "nothing typed: nothing changes");
});

test("setting: the page is told whether a key is saved, never the key", () => {
	const services = placeSearch.servicesForPage({ placeSearchKeys: KEYS });
	const text = JSON.stringify(services);
	for (const key of Object.values(KEYS)) assert.ok(!text.includes(key));
	assert.equal(services.find((s) => s.id === "geonames").keySaved, true);
	assert.equal(services.find((s) => s.id === "geonames").key, "username");
	assert.equal(services.find((s) => s.id === "open-meteo").keySaved, false);
	assert.ok(services.find((s) => s.id === "nominatim").terms.includes("operations.osmfoundation.org"));
});

test("setting: a warning when what's saved won't work as it reads", () => {
	assert.equal(placeSearch.warningFor({}), null);
	assert.equal(
		placeSearch.warningFor({ placeSearchPrimary: "geonames", placeSearchSecondary: "nominatim" }),
		"GeoNames has no key saved, so every search goes straight to Nominatim (OpenStreetMap)."
	);
	assert.equal(
		placeSearch.warningFor({ placeSearchPrimary: "locationiq", placeSearchSecondary: "none" }),
		"LocationIQ has no key saved, and there's nothing to fall back on, so searches find nothing."
	);
	assert.equal(
		placeSearch.warningFor({ placeSearchPrimary: "photon", placeSearchSecondary: "geoapify" }),
		"Geoapify has no key saved, so it's never asked."
	);
	assert.equal(
		placeSearch.warningFor({ placeSearchPrimary: "locationiq", placeSearchSecondary: "none", placeSearchKeys: { locationiq: "k" } }),
		null
	);
});

// --- The pages --------------------------------------------------------------------------

let cookie;

function assertScriptsParse(html, where) {
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	assert.ok(scripts.length > 0, `${where} has scripts`);
	for (const source of scripts) {
		assert.doesNotThrow(() => new vm.Script(source), `${where}: a script that doesn't parse`);
	}
}

async function get(port, address) {
	const response = await fetch(`http://127.0.0.1:${port}${address}`, { headers: { cookie } });
	return { status: response.status, text: await response.text() };
}

async function post(address, body) {
	const response = await fetch(`http://127.0.0.1:3000${address}`, {
		method: "POST",
		headers: { cookie, "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	return { status: response.status, text: await response.text() };
}

test("pages: boots signed in", async () => {
	resetState();
	require("../core/admin-face")();
	require("../core/wizard-face")();
	await waitForPort(3000);
	await waitForPort(3999);
	cookie = await signIn(3000);
});

test("pages: a fresh install searches Open-Meteo, then Nominatim", () => {
	const settings = readSettings();
	assert.equal(settings.placeSearchPrimary, "open-meteo");
	assert.equal(settings.placeSearchSecondary, "nominatim");
	assert.deepEqual(settings.placeSearchKeys, {});
});

test("pages: /geocode on the admin pages and in the wizard gives the matches, who found them, and the credit", async () => {
	fresh({ "open-meteo": ok("open-meteo-bekkestua"), nominatim: ok("nominatim-bekkestua") });

	for (const port of [3000, 3999]) {
		const { status, text } = await get(port, "/geocode?q=Bekkestua");
		assert.equal(status, 200);
		const answer = JSON.parse(text);
		assert.equal(answer.service.id, "nominatim", `port ${port}`);
		assert.ok(answer.places.length > 0);
		assert.ok(answer.note.includes("so Nominatim (OpenStreetMap) was asked"));
		assert.equal(answer.credit.osm.text, "© OpenStreetMap contributors");
	}
});

test("pages: Place search on Settings' General tab, with keys never on it", async () => {
	writeSettings({ placeSearchPrimary: "geonames", placeSearchSecondary: "nominatim", placeSearchKeys: { geonames: "my-geonames-user" } });

	// Its page from earlier in v2 opens the tab now
	const old = await fetch("http://127.0.0.1:3000/place-search", { headers: { cookie }, redirect: "manual" });
	assert.equal(old.status, 302);
	assert.equal(old.headers.get("location"), "/#general");

	const { status, text } = await get(3000, "/");
	assert.equal(status, 200);
	const general = text.slice(text.indexOf('data-pane="general"'), text.indexOf('data-pane="appearance"'));
	assert.ok(general.includes('<div class="segment c2 r2" id="place-search">'), "on the General tab");
	assert.ok(!text.includes("my-geonames-user"), "the saved key isn't on the page");
	assert.match(general, /<option value="geonames" selected>GeoNames \(needs a username\)<\/option>/);
	assert.ok(!general.includes('value="google"'), "Google isn't offered");
	assert.ok(general.includes("Only what you type is sent"), "says what leaves the machine");

	// Saved keys: a row for each saved one, with Change and Remove; the
	// rest are there, hidden, for a key saved later
	assert.ok(general.includes('<div class="segment c4" id="saved-keys">'));
	assert.ok(general.includes('<div class="saved-key" data-key-row="geonames">'), "the saved one shows");
	assert.ok(general.includes('<div class="saved-key" data-key-row="geoapify" hidden>'), "one not saved doesn't");
	assert.ok(general.includes('data-change-key="geonames"') && general.includes('data-remove-key="geonames"'));
	assert.ok(general.includes("Username saved"));
	assert.match(general, /id="no-keys" hidden>/, "no \"None yet\" with one saved");

	// Nowhere to type a key ahead of time: it's asked for when its
	// service is picked, with a link to get one, and "a", never "an"
	assert.ok(!general.includes("data-key-for"), "no key boxes");
	assert.ok(!general.includes("Place search keys") && !general.includes("The services"));
	assert.ok(text.includes('title: "Do you have a " + service.name'));
	assert.ok(text.includes('link: { text: "Get one from " + service.name, url: service.signUp }'));
	assert.ok(general.includes('id="place-warning" hidden'), "nothing to warn about");
	assert.ok(general.includes('id="try-search"'), "a box to try a search");
	assertScriptsParse(text, "Settings");

	writeSettings({ placeSearchKeys: {} });
	const warned = await get(3000, "/");
	assert.match(warned.text, /id="no-keys">/, "None yet, with nothing saved");
	assert.ok(warned.text.includes("GeoNames has no key saved, so every search goes straight to Nominatim (OpenStreetMap)."));
});

test("pages: saving the setting, and nothing that answers carries a key", async () => {
	const saved = await post("/place-search", {
		primary: "locationiq",
		secondary: "photon",
		keys: { locationiq: "pk.secret-123" }
	});
	assert.equal(saved.status, 200);
	assert.ok(!saved.text.includes("pk.secret-123"), "not in the answer");

	const settings = readSettings();
	assert.equal(settings.placeSearchPrimary, "locationiq");
	assert.equal(settings.placeSearchSecondary, "photon");
	assert.equal(settings.placeSearchKeys.locationiq, "pk.secret-123");

	// The location route used to send the whole settings file back
	const location = await post("/location", { locationEnabled: true, locationMode: "auto" });
	assert.equal(location.status, 200);
	assert.ok(!location.text.includes("pk.secret-123"));
	assert.ok(!location.text.includes("placeSearchKeys"));

	assert.ok(!(await get(3000, "/")).text.includes("pk.secret-123"), "Settings doesn't show it");

	writeSettings({ placeSearchPrimary: "open-meteo", placeSearchSecondary: "nominatim", placeSearchKeys: {} });
});

test("pages: all three that search share the same drawing, with the credit line", async () => {
	const home = await get(3000, "/");
	assert.ok(home.text.includes("function findPlaces("), "Settings");
	assert.ok(home.text.includes(".place-credit"), "and its look");
	assertScriptsParse(home.text, "Settings");

	const wizard = await get(3999, "/faces/new");
	assert.ok(wizard.text.includes("function findPlaces("), "the wizard");
	assert.ok(!wizard.text.includes("window.pickCity"), "the wizard's old copy is gone");
	assertScriptsParse(wizard.text, "the wizard");

	const { PLACE_SEARCH_SCRIPT } = require("../core/place-search-ui");
	assert.ok(PLACE_SEARCH_SCRIPT.includes('rel="noopener noreferrer"'));
});

// --- A hand-run image -------------------------------------------------------------------

test("a hand-run image is a development build, and has the CHANGELOG", () => {
	const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "Publish Container Image.yml"), "utf8");
	assert.ok(
		workflow.includes("OMNICORE_VERSION=${{ github.event_name == 'workflow_dispatch' && 'dev' || github.ref_name }}"),
		"dev when run by hand, the tag otherwise"
	);

	const ignored = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf8").split("\n").map((l) => l.trim());
	assert.ok(ignored.includes("!CHANGELOG.md"), "the CHANGELOG isn't left out");
	assert.ok(ignored.indexOf("!CHANGELOG.md") > ignored.indexOf("*.md"), "after *.md, so it wins");
	assert.ok(!ignored.includes("CHANGELOG.md"));

	const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
	assert.match(dockerfile, /^COPY CHANGELOG\.md \.\/$/m);
	assert.ok(!/^RUN /m.test(dockerfile.slice(dockerfile.lastIndexOf("FROM "))), "still no RUN in the final stage");
});
