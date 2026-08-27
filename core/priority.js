// core/priority.js
// Support for `priority` settings: a named list of the things a module can
// show, which the user can reorder to say what matters to them.
//
// WHY THIS EXISTS
//
// Richness tells a module how much room a tile has, on a 1-100 scale. The
// module then decides what to show at that size. Until now each module made
// that decision entirely on its own — weather led with the temperature,
// then the condition, then humidity, and so on, hardcoded in that order.
//
// That's a reasonable default, but it is the module author's taste rather
// than the user's. Somebody who mainly cares about wind shouldn't have to
// give up a Large tile just to see it. A `priority` setting hands the
// ordering over: whatever sits at the top survives even the smallest tile,
// and the rest appear as the tile gets bigger.
//
// Note what has NOT changed. A module still decides what its own content
// means and how many pieces it has; a theme still only sends one number.
// Neither side learns anything new about the other. The user simply gets a
// say in what that number buys them first.
//
// Two small jobs live here:
//
//   normalize()  keeps a stored order sane. Used by OmniCore when loading
//                and saving settings.
//   visible()    turns an order plus a richness number into "show these".
//                Used by modules.

// A value coming back from a settings form is text, not an array — the
// browser has no notion of an array in an input. Accept either shape and
// always hand back a real array, so nothing downstream has to check.
function toArray(value) {
	if (Array.isArray(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim() !== "") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			// Not JSON. Treat it as nothing rather than guessing — normalize
			// will rebuild the full list from the module's declared options.
			return [];
		}
	}

	return [];
}

// Reconcile a stored order against the list the module currently declares.
//
// Two things drift apart over time, and both are handled here rather than
// in every module:
//
//   - A module DROPS an item. The stored order still names it, so it is
//     left out rather than handed to a module that no longer knows what
//     that name means.
//   - A module ADDS an item. The stored order has never heard of it, so it
//     is appended at the end. The user's existing choices survive intact,
//     and the new item quietly shows up on larger tiles until they move it.
//
// This is the same instinct as a theme falling back to `block.text` for a
// block type it doesn't recognise: the list is allowed to change without
// breaking what somebody already configured.
function normalize(value, options) {
	const declared = Array.isArray(options) ? options : [];
	const stored = toArray(value);
	const kept = [];

	// Keep the user's order, dropping anything no longer declared. The
	// duplicate check matters because a hand-edited faces.json could name
	// the same item twice, and a module would then render it twice.
	for (const item of stored) {
		if (declared.includes(item) && !kept.includes(item)) {
			kept.push(item);
		}
	}

	// Anything declared but not mentioned goes on the end, in the order the
	// module declared it
	for (const item of declared) {
		if (!kept.includes(item)) {
			kept.push(item);
		}
	}

	return kept;
}

// How many of a list a given richness is worth.
//
// Richness is spread evenly across however many items there are, so the
// first survives the smallest tile and the last needs a richness close to
// 100. Pulled out on its own because two kinds of module want it:
//
//   - a module with distinct fields asks which fields to show
//   - a module with a list of rows asks how many rows to show
//
//   options.minimum   fewest to show whatever the richness. Defaults to 1,
//                     because an empty tile is worse than a cramped one.
//                     Pass 0 where showing none is genuinely right — a
//                     summary count with no room for the rows beneath it.
function share(total, richness, options) {
	const settings = options || {};
	const count = Math.max(0, Number(total) || 0);

	if (count === 0) {
		return 0;
	}

	// OmniCore clamps richness before a module sees it, but a module can be
	// called from a test or a script, so don't assume
	const level = Number(richness);
	const safe = Number.isFinite(level) ? Math.min(100, Math.max(1, level)) : 50;

	const minimum =
		settings.minimum === undefined
			? 1
			: Math.max(0, Number(settings.minimum) || 0);

	const wanted = Math.round((safe / 100) * count);

	return Math.max(Math.min(minimum, count), Math.min(count, wanted));
}

// Which items a given richness should reveal, in the user's own order.
//
// The scale still belongs to the module — this is only the arithmetic most
// modules would otherwise write for themselves. A module is free to ignore
// it and work out its own steps; nothing here is enforced.
function visible(order, richness, options) {
	const list = toArray(order);

	return list.slice(0, share(list.length, richness, options));
}

module.exports = { normalize, visible, share };