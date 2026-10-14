// test/module-fetch.test.js
// omni.fetch, the network helper every module uses: headers (since
// v1.19.8), the User-Agent it sends by default, the cache key, and the
// status a failed call reports.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const { fetchCached, DEFAULT_USER_AGENT } = require("../core/module-fetch");

// A tiny stand-in service: remembers each request's headers, answers
// with JSON, or with whatever status the path asks for ("/status/401")
const seen = [];
let base;

const server = http.createServer((req, res) => {
	seen.push({ url: req.url, headers: req.headers });

	const asked = req.url.match(/^\/status\/(\d+)/);

	if (asked) {
		res.writeHead(Number(asked[1]), { "content-type": "application/json" });
		res.end('{"message":"no"}');
		return;
	}

	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({ count: seen.length, path: req.url }));
});

test.before(async () => {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

// The headers the stand-in saw on its most recent request
function lastHeaders() {
	return seen[seen.length - 1].headers;
}

test("every call says it's OmniCore when the module doesn't say otherwise", async () => {
	const { data, stale, status } = await fetchCached(`${base}/plain`, { cacheSeconds: 0 });

	assert.equal(data.path, "/plain");
	assert.equal(stale, false);
	assert.equal(status, undefined, "a call that worked has no status");
	assert.equal(lastHeaders()["user-agent"], DEFAULT_USER_AGENT);
});

test("a module's own headers go out, and its User-Agent replaces OmniCore's", async () => {
	await fetchCached(`${base}/own`, {
		cacheSeconds: 0,
		headers: { "user-agent": "Weather/1 (someone@example.com)", "X-Api-Key": "abc" }
	});

	assert.equal(lastHeaders()["user-agent"], "Weather/1 (someone@example.com)");
	assert.equal(lastHeaders()["x-api-key"], "abc");
});

test("headers that aren't text or numbers are left out", async () => {
	await fetchCached(`${base}/odd`, {
		cacheSeconds: 0,
		headers: { "X-Good": 7, "X-Bad": { nested: true }, "X-Gone": null }
	});

	const headers = lastHeaders();
	assert.equal(headers["x-good"], "7");
	assert.equal(headers["x-bad"], undefined);
	assert.equal(headers["x-gone"], undefined);
});

test("different headers to the same address are cached apart", async () => {
	const url = `${base}/keyed`;

	const first = await fetchCached(url, { cacheSeconds: 60, headers: { "X-Api-Key": "one" } });
	const again = await fetchCached(url, { cacheSeconds: 60, headers: { "X-Api-Key": "one" } });
	const other = await fetchCached(url, { cacheSeconds: 60, headers: { "X-Api-Key": "two" } });

	assert.equal(again.data.count, first.data.count, "same headers: the cached answer");
	assert.notEqual(other.data.count, first.data.count, "other headers: asked again");

	// The same headers in another order, or other capitals, are the same
	const reordered = await fetchCached(`${base}/order`, {
		cacheSeconds: 60,
		headers: { A: "1", B: "2" }
	});
	const sameAgain = await fetchCached(`${base}/order`, {
		cacheSeconds: 60,
		headers: { b: "2", a: "1" }
	});
	assert.equal(sameAgain.data.count, reordered.data.count);
});

test("a failed call reports the service's status, or 0 when nothing answered", async () => {
	const refused = await fetchCached(`${base}/status/401`, { cacheSeconds: 0 });
	assert.deepEqual(refused, { data: null, stale: false, status: 401 });

	const broken = await fetchCached(`${base}/status/500`, { cacheSeconds: 0 });
	assert.equal(broken.status, 500);

	// Nothing listening on this port at all
	const nobody = await fetchCached("http://127.0.0.1:1/nothing", {
		cacheSeconds: 0,
		timeoutSeconds: 2
	});
	assert.deepEqual(nobody, { data: null, stale: false, status: 0 });
});

test("a failure after a good answer gives the old answer, marked stale, with the status", async () => {
	let fail = false;
	const flaky = http.createServer((req, res) => {
		res.writeHead(fail ? 503 : 200, { "content-type": "application/json" });
		res.end(fail ? "{}" : '{"temp":8}');
	});
	await new Promise((resolve) => flaky.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${flaky.address().port}/weather`;

	try {
		const good = await fetchCached(url, { cacheSeconds: 0 });
		assert.deepEqual(good.data, { temp: 8 });

		fail = true;
		const later = await fetchCached(url, { cacheSeconds: 0 });
		assert.deepEqual(later, { data: { temp: 8 }, stale: true, status: 503 });
	} finally {
		flaky.close();
	}
});
