// core/image-proxy.js
// Fetches images on the display's behalf.
//
// A dashboard showing a Bing wallpaper would otherwise mean every screen in
// the house talking directly to Bing, on every refresh. Routing it through
// OmniCore keeps the promise that a display only ever talks to your own
// server.
//
// Only URLs a module actually returned can be fetched — the caller looks
// them up by instance and block index rather than passing a URL in. That's
// deliberate: accepting a URL would turn this into an open relay that
// anyone on the network could point at anything.

const { Readable } = require("stream");

// What each instance's image blocks currently point at:
// "instanceId:index" -> url
const known = new Map();

// Fetched bytes, so a wallpaper isn't re-downloaded for every display and
// every refresh: url -> { body, type, at }
const cache = new Map();

const CACHE_MS = 30 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024; // don't cache anything unreasonable
const TIMEOUT_MS = 15000;

// How many image references to keep. Generous for any real dashboard, but
// bounded — OmniCore is meant to run for months, and instances that get
// deleted would otherwise leave their entries behind forever.
const MAX_KNOWN = 500;

function remember(instanceId, index, url) {
	const key = instanceId + ":" + index;

	// Re-inserting moves the key to the end, so the eviction below drops
	// whatever genuinely hasn't been seen in the longest time
	known.delete(key);
	known.set(key, url);

	while (known.size > MAX_KNOWN) {
		known.delete(known.keys().next().value);
	}
}

function lookup(instanceId, index) {
	return known.get(instanceId + ":" + index) || null;
}

// Drop anything past its age, so the map doesn't grow forever
function prune() {
	const now = Date.now();

	for (const [url, entry] of cache) {
		if (entry.at + CACHE_MS < now) {
			cache.delete(url);
		}
	}
}

async function fetchImage(url) {
	prune();

	const cached = cache.get(url);
	if (cached) {
		return cached;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) {
			return null;
		}

		const type = response.headers.get("content-type") || "";

		// Refuse anything that isn't an image. A module returning an image
		// block shouldn't be able to make OmniCore relay arbitrary content.
		if (!type.startsWith("image/")) {
			return null;
		}

		const body = Buffer.from(await response.arrayBuffer());
		const entry = { body, type, at: Date.now() };

		if (body.length <= MAX_BYTES) {
			cache.set(url, entry);
		}

		return entry;
	} catch (error) {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// Attach the image route to a face
function attachImageRoute(app) {
	app.get("/api/:instanceId/image/:index", async (req, res) => {
		const url = lookup(req.params.instanceId, Number(req.params.index));

		if (!url) {
			// Either the instance has no such image, or its data hasn't been
			// fetched yet this run
			res.status(404).end();
			return;
		}

		const image = await fetchImage(url);

		if (!image) {
			res.status(502).end();
			return;
		}

		res.setHeader("Content-Type", image.type);
		// Let the browser hold onto it briefly, but check back often enough
		// that a daily wallpaper still turns over
		res.setHeader("Cache-Control", "private, max-age=300");
		res.end(image.body);
	});
}

module.exports = { remember, attachImageRoute };