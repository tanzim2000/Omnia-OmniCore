// core/module-api.js
// What a module is handed when OmniCore calls it.
//
// A module never reaches into OmniCore. It receives everything it may use
// as one object:
//
//     module.exports = async function (config, richness, omni) { ... }
//
// This is deliberately the opposite of letting a module `require` its way
// into core/. Three things follow from it, and all three matter once
// modules come from other people's repositories.
//
// A MODULE STOPS CARING WHERE IT LIVES
//
// `require("../../core/module-fetch")` only resolves if the module sits
// exactly two folders below core/. That is a fact about OmniCore's layout
// leaking into somebody else's repository. A module written against this
// object has no relative paths at all, so it works the same wherever it
// is installed — and can be tested on its own with a hand-made object.
//
// THE SURFACE IS ONE THING, NOT A SET OF PATHS
//
// Everything a module may use is listed in this file. Nothing is reachable
// that isn't here. That makes the promise to module authors small enough
// to actually keep: this object is the contract, and `version` says which
// shape of it they were given.
//
// IT CAN BE MADE SMALLER LATER
//
// This is the part that matters most. With `require`, a module that can
// reach core/module-fetch can equally reach `fs` and read data/admin.json,
// and nothing in OmniCore is in a position to stop it. Because the module
// is instead HANDED its capabilities, a restricted build can hand over a
// smaller object — fewer helpers, a fetch that only allows certain hosts,
// whatever turns out to be right — without changing a single module that
// plays fair. Sandboxing becomes something OmniCore can do TO a module
// rather than something it has to trust modules not to defeat.

const { fetchCached } = require("./module-fetch");
const priority = require("./priority");
const moduleStorage = require("./module-storage");

// Bumped when the shape below changes in a way modules would notice, so a
// module can say what it was written against. Additions don't count —
// only changes that could break somebody.
const API_VERSION = 1;

// Build the object handed to one module call.
//
// It's built per call rather than shared so that a future restricted
// build can hand different modules different objects — a module allowed
// to reach the network and one that isn't need not receive the same
// `fetch`.
//
// faceId and instanceId identify which instance this call is for — the
// only reason they're needed at all is `storage` below, which has to be
// pointed at that exact instance's own file and no other. Everything
// else this object hands out is already instance-agnostic.
function makeModuleApi(faceId, instanceId) {
	return {
		version: API_VERSION,

		// Fetch a URL through OmniCore's shared cache.
		//
		// Going through here rather than calling out directly is what lets
		// OmniCore hold the timeout, decide how long an answer stays good,
		// and keep a stale copy to hand back when a service is down. It is
		// also the only reason a dashboard with twenty tiles doesn't make
		// twenty times the requests.
		//
		//   fetch(url, { cacheSeconds })  ->  { data, stale }
		fetch: fetchCached,

		// Which of an ordered list a given richness should reveal, in the
		// user's own order. For a module whose content is distinct named
		// fields the user can reorder.
		visible: priority.visible,

		// How many of a list a given richness is worth. For a module whose
		// content is a list of like rows, where there is nothing to
		// reorder and only the count changes.
		share: priority.share,

		// This instance's own persisted data — the first capability a
		// module can WRITE through, not just read. Every module using this
		// gets exactly its own file; there is no way to reach another
		// instance's data through this object, on purpose.
		//
		//   storage.read()      -> whatever this instance last saved, or {}
		//   storage.write(data) -> overwrite it, whole file, no partial merge
		storage: {
			read: () => moduleStorage.readInstanceData(faceId, instanceId),
			write: (data) =>
				moduleStorage.writeInstanceData(faceId, instanceId, data)
		}
	};
}

module.exports = { makeModuleApi, API_VERSION };