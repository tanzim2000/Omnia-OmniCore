// core/version.js
// What OmniCore knows about its own version — the other half of the
// compatibility question every module and theme install has to answer:
// "does the OmniCore running right now support what this needs?"
//
// The value comes from OMNICORE_VERSION, an environment variable baked
// into the image at build time (see Dockerfile / the publish workflow).
// It is never read from package.json — package.json says what the source
// claims to be, not what was actually built and shipped. Those can and do
// drift apart; the env var can't lie about what image is actually running.

const semver = require("semver");

// A local build — docker-compose.dev.yml, or "npm start" straight from a
// clone — has no release tag to report, so this is what it gets instead.
const DEV_VERSION = "dev";

// Raw env value, tags included ("v1.1.0"), exactly as baked into the image.
function rawVersion() {
	return process.env.OMNICORE_VERSION || DEV_VERSION;
}

// True for a local/development build — nothing meaningful to compare
// against, and never something a compatibility check should block on.
function isDevBuild() {
	return rawVersion() === DEV_VERSION;
}

// A bare semver OmniCore can actually compare against modules' and themes'
// `minOmniCore` fields — "v1.1.0" becomes "1.1.0". null for a dev build,
// or for anything that somehow isn't a real version (a bad build-arg
// shouldn't crash OmniCore — it should just make every compatibility
// check honest about not being able to answer).
function comparableVersion() {
	if (isDevBuild()) {
		return null;
	}

	return semver.valid(semver.coerce(rawVersion()));
}

module.exports = { rawVersion, isDevBuild, comparableVersion, DEV_VERSION };