// core/content-tag.js
// One short string standing for "this is exactly what that tile was
// showing last time".
//
// WHY THIS EXISTS
//
// A dashboard face asks every instance for its content every few seconds,
// forever. Most of those answers are identical to the one before — a
// calendar feed that only regenerates a few times a day, a disk that
// hasn't filled up since the last poll, an idle machine sitting at the
// same CPU reading. OmniCore was sending the whole payload every time
// regardless, and a theme had no way to tell a genuinely new reading
// apart from the same one arriving again.
//
// That second part is the one that actually matters. A theme that wants
// to animate on new data — flip a tile, slide a number, fade something
// in — needs to know when data is NEW. Without a signal from OmniCore,
// every theme has to work it out for itself by diffing rendered output,
// which is what windows8 ended up doing. This puts the answer in one
// place so no theme has to solve it again.
//
// The tag is an HTTP ETag, so the normal HTTP machinery handles it: a
// theme can read it off the response, and a theme that asks for one
// thing and gets the same tag back knows nothing changed without
// reading the body at all.

const crypto = require("crypto");

// What a tile is SHOWING — deliberately not everything in the response.
//
// `updated` is left out on purpose. It's a fresh timestamp on every
// single call by design, so including it would make every tag unique and
// the whole thing pointless. What we want to know is whether the content
// differs, not whether time has passed.
function contentTag(title, blocks) {
	const shape = JSON.stringify({ title: title, content: blocks });

	// Not a security boundary — nobody is attacking this, it just needs
	// to be short and to change when the content does. sha1 is fine and
	// fast for that.
	const digest = crypto.createHash("sha1").update(shape).digest("hex");

	// Quoted, because that's the shape an ETag takes in HTTP
	return '"' + digest + '"';
}

module.exports = { contentTag };