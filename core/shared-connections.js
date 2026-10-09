// core/shared-connections.js
// One live connection per server, shared by every instance that needs it.
//
// THE PROBLEM THIS SOLVES
//
// A background module keeps a connection open for as long as it runs --
// a stream of messages from a server, say. Put three of them on a
// dashboard, all pointed at the same server but listening for different
// things, and the obvious version opens three connections: three sockets,
// three sets of reconnect timers, three times the work for a machine
// that's already running everything else in the house.
//
// Plenty of services let one connection carry several subscriptions at
// once (ntfy takes a comma-separated list of topics on a single stream),
// so those three instances only ever needed one. This file is what lets
// them share it, without any of them knowing the others exist.
//
// HOW IT WORKS
//
// An instance JOINS a pool, naming two things:
//
//   key       which connection it wants -- usually the server's address.
//             Instances naming the same key share one connection.
//   interest  what it wants from that connection -- a topic, a channel.
//             Optional; a connection with nothing to choose between
//             doesn't need one.
//
// Core keeps the list of everyone in each pool, and is the only thing
// that ever opens or closes the real connection. It does that by calling
// the module's own `open` function -- the one from whoever joined most
// recently, so the newest settings win -- handing it every member's
// interest at once. When the list of interests changes -- someone joins wanting a
// new topic, the last one wanting a topic leaves -- Core closes the
// connection and opens it again with the new list. The same happens when
// a new member joins a connection already running, so it gets whatever
// the connection sends at the start (a replay of recent messages, say)
// like everyone else did. When the last member leaves, the connection
// closes for good.
//
// Core knows nothing about what's on the other end. It doesn't speak
// ntfy, or anything else: opening, reading and parsing are all the
// module's job. What Core owns is the bookkeeping that's identical for
// every kind of connection -- who's sharing it, when to open and close
// it, and how long to wait before trying again when it drops.
//
// WHY A POOL BELONGS TO ONE MODULE
//
// Two different modules can both talk to "https://example.com" in
// completely different ways. So a pool is keyed by module AND key, never
// by key alone: instances of the same module share, instances of
// different modules never do.

// How long to let changes settle before acting on them.
//
// On boot every instance joins one after another in a fraction of a
// second, and a settings change is a leave immediately followed by a
// join. Acting on each one separately would open, close and reopen the
// same connection several times over. Waiting this long first means a
// burst of changes costs one open.
const SETTLE_MS = 50;

// Reconnecting after a drop: wait 1s, then 2s, 4s, 8s... up to a minute.
// Doubling the wait each time stops a server that's down from being
// hammered with attempts, and the ceiling stops it ever giving up.
const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 60 * 1000;

// A connection that stayed up at least this long before dropping was
// working fine -- the next attempt starts again from the short wait
// rather than carrying on from wherever the count had reached.
const HEALTHY_AFTER_MS = 60 * 1000;

// Every pool, keyed by module and key: "<moduleId> <key>"
const pools = new Map();

// What went wrong, as words. A module can reject with anything at all --
// `undefined`, a string, a plain object -- and reading `.message` off
// those would itself throw, in the middle of cleaning up after them.
function describe(error) {
	return error && error.message ? error.message : String(error);
}

function poolKeyFor(moduleId, key) {
	return moduleId + " " + key;
}

// Every distinct interest in a pool, sorted, so the same set of interests
// always comes out the same way regardless of who joined first. Members
// with no interest add nothing to the list.
function interestsOf(pool) {
	const all = new Set();

	for (const member of pool.members) {
		if (member.interest !== null) {
			all.add(member.interest);
		}
	}

	return [...all].sort();
}

// Hand one event to one member. Whatever the member does with it is
// caught here: a member that throws loses that one event, and nothing
// else -- not the connection, not the other members.
function deliver(pool, member, event) {
	Promise.resolve()
		.then(() => member.onEvent(event))
		.catch((error) => {
			console.log(
				`  ${pool.moduleId}: a listener failed on an event — ${describe(error)}`
			);
		});
}

// Close whatever connection the pool has open right now, if any.
function closeConnection(pool) {
	const connection = pool.connection;

	if (!connection) {
		return;
	}

	pool.connection = null;

	// The signal is what a fetch-based connection listens to: aborting it
	// ends the request on the module's side without the module having
	// written any closing code at all
	connection.controller.abort();

	// And the close function, if the module handed one back, for anything
	// that a signal can't reach (a socket, a timer of its own)
	if (typeof connection.close === "function") {
		try {
			connection.close();
		} catch (error) {
			console.log(
				`  ${pool.moduleId}: closing a connection failed — ${describe(error)}`
			);
		}
	}
}

// The member whose `open` is used: whoever joined most recently.
//
// Every member is an instance of the same module, so it's the same CODE
// whoever brought it -- but not the same closure. An `open` can carry
// its own instance's settings with it (a password, a token), so the
// newest member is the one with the most current version of those. A Set
// remembers the order things were added in, so the last one is newest.
function newestMember(pool) {
	let newest = null;

	for (const member of pool.members) {
		newest = member;
	}

	return newest;
}

// Open the real connection, using the module's own `open` function.
function openConnection(pool) {
	const controller = new AbortController();
	const interests = interestsOf(pool);
	const opener = newestMember(pool);

	const connection = {
		controller: controller,
		close: null,
		interestsKey: JSON.stringify(interests),
		// Whose `open` this connection came from. If that member leaves,
		// the connection is reopened with someone else's -- see sync().
		openedBy: opener,
		// Everyone who was a member when it opened. Someone joining later
		// gets the connection reopened for them -- see sync().
		openedFor: new Set(pool.members),
		openedAt: Date.now()
	};

	pool.connection = connection;

	// Is this still the connection the pool is using? A connection that's
	// since been closed or replaced can still have a late event or error
	// arrive from the module's side. Those are ignored, not delivered --
	// otherwise a closed connection could keep reaching members, or
	// trigger a reconnect nobody asked for.
	const isCurrent = () => pool.connection === connection;

	// Delivered to every member, or only to those whose interest matches
	// when the module says which one an event is for
	function emit(event, interest) {
		if (!isCurrent()) {
			return;
		}

		for (const member of pool.members) {
			if (interest === undefined || member.interest === String(interest)) {
				deliver(pool, member, event);
			}
		}
	}

	// The module calls this when the connection is lost: the server
	// closed it, the network went away, anything. Core takes it from there.
	function drop(error) {
		if (!isCurrent()) {
			return;
		}

		if (error) {
			console.log(
				`  ${pool.moduleId}: connection to ${pool.key} dropped — ${describe(
					error
				)}`
			);
		}

		closeConnection(pool);
		scheduleReconnect(pool, connection.openedAt);
	}

	// Kicked off rather than awaited: opening a connection can take as
	// long as the network does, and nothing else should wait on it.
	Promise.resolve()
		.then(() =>
			opener.open({
				interests: interests,
				emit: emit,
				drop: drop,
				signal: controller.signal
			})
		)
		.then((close) => {
			if (isCurrent()) {
				connection.close = close;
			} else if (typeof close === "function") {
				// It was closed while it was still opening. Whatever it
				// just opened gets closed straight away rather than leaked.
				try {
					close();
				} catch (error) {
					// Already being thrown away; nothing more to do
				}
			}
		})
		.catch((error) => drop(error));
}

// Try again after a drop, waiting longer each time it keeps failing.
function scheduleReconnect(pool, openedAt) {
	if (Date.now() - openedAt >= HEALTHY_AFTER_MS) {
		pool.attempt = 0;
	}

	const wait = Math.min(
		LONGEST_RETRY_MS,
		FIRST_RETRY_MS * Math.pow(2, pool.attempt)
	);

	pool.attempt++;

	clearTimeout(pool.retryTimer);

	pool.retryTimer = setTimeout(() => {
		pool.retryTimer = null;

		// Only if it's still wanted and nothing has reopened it since. The
		// last member may have left a moment ago, with the pool's own
		// cleanup still waiting to run -- nobody left means nothing to open.
		if (
			pools.get(pool.poolKey) === pool &&
			!pool.connection &&
			pool.members.size > 0
		) {
			openConnection(pool);
		}
	}, wait);

	// A pending retry should never be what keeps OmniCore from exiting
	pool.retryTimer.unref();
}

// Bring a pool's real connection in line with who's in it right now.
// Always called through scheduleSync, never directly, so a burst of
// changes is acted on once.
function sync(pool) {
	pool.syncTimer = null;

	// Nobody left: close it, and forget the pool entirely
	if (pool.members.size === 0) {
		clearTimeout(pool.retryTimer);
		closeConnection(pool);

		if (pools.get(pool.poolKey) === pool) {
			pools.delete(pool.poolKey);
		}

		return;
	}

	const wantedKey = JSON.stringify(interestsOf(pool));

	// Already open, with exactly the right interests, opened by a member
	// that's still here, and every member there since it opened. Nothing
	// to do. Each of those last two conditions earns its place:
	//
	// Opened by a member that's still here: that's what makes a settings
	// change take effect. Changing a password restarts the instance: it
	// leaves and joins again in a moment, wanting the same topics as
	// before. Without this, the interests would look unchanged and the
	// connection would carry on with the old password for as long as it
	// stayed up.
	//
	// Every member there since it opened: plenty of services send
	// something only at the START of a connection -- a greeting, a replay
	// of recent messages. A member joining a connection that's already
	// running would never see any of that, and would sit empty until
	// something new happened to arrive. So a newcomer gets the connection
	// reopened, and starts from the beginning like everyone else. Joins
	// only happen when an instance starts (boot, being added, a settings
	// change), so this costs a reconnect at those moments and no others.
	// Someone LEAVING never needs one; the rest already have what they need.
	const everyoneWasThere = [...pool.members].every((member) =>
		pool.connection ? pool.connection.openedFor.has(member) : false
	);

	if (
		pool.connection &&
		pool.connection.interestsKey === wantedKey &&
		pool.members.has(pool.connection.openedBy) &&
		everyoneWasThere
	) {
		return;
	}

	if (!pool.connection && pool.retryTimer) {
		// It dropped, and a retry is already waiting. The retry will open
		// it with whatever the interests are by then, so starting another
		// attempt now would only cut the wait short.
		return;
	}

	// Either never opened, or open with an out-of-date list. A change of
	// interests is a deliberate reopen, not a failure, so it starts the
	// reconnect count afresh.
	closeConnection(pool);
	pool.attempt = 0;
	openConnection(pool);
}

function scheduleSync(pool) {
	if (pool.syncTimer) {
		return;
	}

	pool.syncTimer = setTimeout(() => sync(pool), SETTLE_MS);
	pool.syncTimer.unref();
}

// Join the pool for one connection. Returns `{ leave }`.
//
//   moduleId   which module is asking -- supplied by Core, never by the
//              module, so a module can't join another module's pools
//   key        which connection: usually the server's address
//   interest   what this member wants from it, or omitted for nothing
//   open       ({ interests, emit, drop, signal }) => close function
//              The module's own code for opening the real connection.
//              Only ever called by Core. See the top of this file.
//   onEvent    (event) => ...  Called for each event meant for this member
function join(moduleId, options) {
	const { key, interest, open, onEvent } = options || {};

	if (typeof key !== "string" || key === "") {
		throw new Error("A shared connection needs a key (its server's address)");
	}

	if (typeof open !== "function") {
		throw new Error("A shared connection needs an open function");
	}

	if (typeof onEvent !== "function") {
		throw new Error("A shared connection needs an onEvent function");
	}

	const poolKey = poolKeyFor(moduleId, key);

	if (!pools.has(poolKey)) {
		pools.set(poolKey, {
			poolKey: poolKey,
			moduleId: moduleId,
			key: key,
			members: new Set(),
			connection: null,
			attempt: 0,
			syncTimer: null,
			retryTimer: null
		});
	}

	const pool = pools.get(poolKey);

	const member = {
		interest:
			interest === undefined || interest === null ? null : String(interest),
		open: open,
		onEvent: onEvent
	};

	pool.members.add(member);
	scheduleSync(pool);

	let left = false;

	return {
		// Safe to call more than once; only the first one does anything
		leave() {
			if (left) {
				return;
			}

			left = true;
			pool.members.delete(member);
			scheduleSync(pool);
		}
	};
}

// What's open right now, for tests and for anyone curious. A snapshot;
// changing it changes nothing.
function list() {
	return [...pools.values()].map((pool) => ({
		moduleId: pool.moduleId,
		key: pool.key,
		members: pool.members.size,
		interests: interestsOf(pool),
		open: pool.connection !== null
	}));
}

module.exports = { join, list, SETTLE_MS };