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
//
// It also says who is asking. Some services refuse a request that doesn't
// (MET Norway and the US National Weather Service both answer 403), so
// every call carries an OmniCore User-Agent unless the module sends its
// own in `headers`.

// Last good response per key: { data, fetchedAt }
const cache = new Map();

// Requests currently in progress, so two faces asking at the same moment
// result in one call rather than two
const inFlight = new Map();

// Who OmniCore says it is when nobody says otherwise. A service that wants
// contact details (MET Norway asks for them) gets them from the module's
// own User-Agent instead, which replaces this one.
const DEFAULT_USER_AGENT =
	"OmniCore (+https://github.com/tanzim2000/Omnia-OmniCore)";

// The headers a call goes out with: the module's own, plus a User-Agent
// when the module didn't give one. Header names are matched without
// caring about capitals, the way HTTP does.
function headersFor(own) {
	const headers = {};

	if (own && typeof own === "object") {
		for (const [name, value] of Object.entries(own)) {
			// Only plain text values; anything else is a mistake, not a header
			if (typeof value === "string" || typeof value === "number") {
				headers[name] = String(value);
			}
		}
	}

	const hasUserAgent = Object.keys(headers).some(
		(name) => name.toLowerCase() === "user-agent"
	);

	if (!hasUserAgent) {
		headers["User-Agent"] = DEFAULT_USER_AGENT;
	}

	return headers;
}

// The cache key when the module doesn't choose one: the URL, plus the
// module's own headers when it sent any. Two calls to the same address
// with different headers (another API key, another language) can get
// different answers, so they mustn't share one.
function keyFor(url, own) {
	if (!own || typeof own !== "object" || Object.keys(own).length === 0) {
		return url;
	}

	// Sorted, so the same headers in another order are the same key
	const sorted = Object.keys(own)
		.sort()
		.map((name) => [name.toLowerCase(), String(own[name])]);

	return url + " " + JSON.stringify(sorted);
}

function fetchWithTimeout(url, headers, timeoutMs) {
	// AbortController is how you cancel a fetch — we start a timer and pull
	// the plug if the service hasn't answered in time
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	return fetch(url, { headers, signal: controller.signal }).finally(() => {
		clearTimeout(timer);
	});
}

// What went wrong, as the module is told it: the service's own status
// code when it answered (401 is a bad API key, 404 a wrong address), or 0
// when it never answered at all (no network, a timeout).
function statusOf(error) {
	return error && Number.isInteger(error.status) ? error.status : 0;
}

// Fetch a URL, reusing a recent answer when there is one.
//
// options:
//   cacheSeconds   how long an answer stays fresh (default 300)
//   timeoutSeconds how long to wait before giving up (default 10)
//   as             "json" (default) or "text"
//   key            cache key, defaults to the URL (plus `headers`, if any)
//   headers        extra request headers, such as { "User-Agent": "..." }
//                  or an API key a service wants in a header
//
// Returns { data, stale, status }:
//   data    the parsed response, or null if there's nothing to show at all
//   stale   true when the service failed and this is an older answer
//   status  only when this call failed: the service's HTTP status (401,
//           404, 500...), or 0 when it never answered. Lets a module say
//           "Invalid API key" instead of just "Not reachable".
async function fetchCached(url, options = {}) {
	const key = options.key || keyFor(url, options.headers);
	const headers = headersFor(options.headers);

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
				? { data: cached.data, stale: true, status: statusOf(error) }
				: { data: null, stale: false, status: statusOf(error) };
		}
	}

	const request = (async () => {
		const response = await fetchWithTimeout(url, headers, timeoutMs);

		if (!response.ok) {
			const error = new Error("Service replied " + response.status);
			error.status = response.status;
			throw error;
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
			? { data: cached.data, stale: true, status: statusOf(error) }
			: { data: null, stale: false, status: statusOf(error) };
	} finally {
		inFlight.delete(key);
	}
}

module.exports = { fetchCached, DEFAULT_USER_AGENT };