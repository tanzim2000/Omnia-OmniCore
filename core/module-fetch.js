// core/module-fetch.js
// Shared network helper for modules that call an outside service.
//
// Three problems this solves, once, for every module including ones people
// write themselves:
//
// 1. CACHING. A face polls its modules every few seconds. Without a cache
//    that's hundreds of calls an hour to somebody else's free API, from
//    every face you run — a good way to get rate-limited. Prayer times
//    change once a day; there's no reason to ask more often than that.
//
// 2. TIMEOUTS. fetch() will wait forever by default. One unreachable
//    service shouldn't leave a tile hanging indefinitely.
//
// 3. STALE DATA BEATS NO DATA. If a service is briefly down, a wall display
//    showing a twenty-minute-old temperature is more useful than one
//    showing a dash. So we keep the last good answer and fall back to it.

// Last good response per key: { data, fetchedAt }
const cache = new Map();

// Requests currently in progress, so two faces asking at the same moment
// result in one call rather than two
const inFlight = new Map();

function fetchWithTimeout(url, timeoutMs) {
	// AbortController is how you cancel a fetch — we start a timer and pull
	// the plug if the service hasn't answered in time
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	return fetch(url, { signal: controller.signal }).finally(() => {
		clearTimeout(timer);
	});
}

// Fetch a URL, reusing a recent answer when there is one.
//
// options:
//   cacheSeconds   how long an answer stays fresh (default 300)
//   timeoutSeconds how long to wait before giving up (default 10)
//   as             "json" (default) or "text"
//   key            cache key, defaults to the URL
//
// Returns { data, stale }:
//   data   the parsed response, or null if there's nothing to show at all
//   stale  true when the service failed and this is an older answer
async function fetchCached(url, options = {}) {
	const key = options.key || url;

	const cacheMs =
		(options.cacheSeconds === undefined ? 300 : options.cacheSeconds) * 1000;
	const timeoutMs =
		(options.timeoutSeconds === undefined ? 10 : options.timeoutSeconds) * 1000;

	const cached = cache.get(key);

	// Recent enough — don't call out at all
	if (cached && cached.fetchedAt + cacheMs > Date.now()) {
		return { data: cached.data, stale: false };
	}

	// Someone else is already asking for this — wait for their answer
	if (inFlight.has(key)) {
		try {
			return { data: await inFlight.get(key), stale: false };
		} catch (error) {
			return cached
				? { data: cached.data, stale: true }
				: { data: null, stale: false };
		}
	}

	const request = (async () => {
		const response = await fetchWithTimeout(url, timeoutMs);

		if (!response.ok) {
			throw new Error("Service replied " + response.status);
		}

		const data =
			options.as === "text" ? await response.text() : await response.json();

		cache.set(key, { data, fetchedAt: Date.now() });
		return data;
	})();

	inFlight.set(key, request);

	try {
		return { data: await request, stale: false };
	} catch (error) {
		// Fall back to the last good answer if we have one
		return cached
			? { data: cached.data, stale: true }
			: { data: null, stale: false };
	} finally {
		inFlight.delete(key);
	}
}

module.exports = { fetchCached };