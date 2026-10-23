// test/compatibility.test.js
// Which modules and themes an OmniCore will install: a registry entry's
// `minOmniCore` against the running version (v2). Until v2 it meant "the
// same major version", so on OmniCore 2.0.0 every module made for 1.x
// would have been refused, though nothing they use had changed. Now: this
// OmniCore must be at least that version, and that version no older than
// the oldest OmniCore whose resources this one still runs.

const test = require("node:test");
const assert = require("node:assert");

const marketplace = require("../core/marketplace");

// Runs `check` as if OmniCore were `version` (unset: a development build)
function as(version, check) {
	const original = process.env.OMNICORE_VERSION;
	if (version === undefined) delete process.env.OMNICORE_VERSION;
	else process.env.OMNICORE_VERSION = version;
	try {
		return check();
	} finally {
		if (original === undefined) delete process.env.OMNICORE_VERSION;
		else process.env.OMNICORE_VERSION = original;
	}
}

const fits = (minOmniCore) => marketplace.checkCompatibility({ id: "thing", minOmniCore }).compatible;

test("resources made for 1.x install on 2.0.0", () => {
	assert.equal(marketplace.OLDEST_RESOURCES, "1.0.0", "nothing a resource uses changed in 2.0.0");
	as("2.0.0", () => {
		for (const made of ["1.0.0", "1.1.0", "1.19.8", "v1.19.9", "2.0.0"]) {
			assert.equal(fits(made), true, made);
		}
	});
});

test("one needing a newer OmniCore than this is still refused, and says why", () => {
	as("2.0.0", () => {
		assert.equal(fits("2.1.0"), false);
		assert.equal(fits("3.0.0"), false);
		assert.equal(
			marketplace.checkCompatibility({ id: "thing", minOmniCore: "2.1.0" }).reason,
			"thing needs OmniCore 2.1.0 or later. This install is running 2.0.0"
		);
	});
	as("1.19.9", () => {
		assert.equal(fits("1.19.8"), true);
		assert.equal(fits("2.0.0"), false, "a 1.x OmniCore can't run something made for 2.0.0");
	});
});

test("one made for an OmniCore older than this still runs resources for is refused", () => {
	as("2.0.0", () => {
		assert.equal(fits("0.9.0"), false);
		assert.match(
			marketplace.checkCompatibility({ id: "thing", minOmniCore: "0.9.0" }).reason,
			/made for OmniCore 0\.9\.0, and this one runs resources made for 1\.0\.0 or later/
		);
	});
});

test("no minOmniCore, or a development build: nothing to check against", () => {
	as("2.0.0", () => assert.equal(marketplace.checkCompatibility({ id: "thing" }).compatible, true));
	as(undefined, () => assert.equal(fits("9.0.0"), true));
	as("2.0.0", () => assert.equal(fits("not a version"), false, "a field that isn't a version is refused"));
});
