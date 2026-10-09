// core/schema-fields.js
// Makes a list of fields read from somebody else's JSON file safe to use.
//
// Modules and themes describe their settings as a list of fields:
//
//     "settings": [
//         { "key": "topic", "type": "text", "label": "Topic" },
//         { "key": "units", "type": "select", "options": ["metric", "imperial"] }
//     ]
//
// Everything in OmniCore that draws a form or fills in defaults walks that
// list and reads `field.key`, `field.options` and so on. One bad entry --
// a stray `null` left behind by a hand edit, a number, a field with no
// key -- used to make that walk throw, and the settings page for the
// whole face would fail to open.
//
// So every list is cleaned once, here, the moment it's read from disk, and
// nothing further along has to be careful. Same spirit as everything else
// OmniCore reads from a module: what's broken is dropped with a line in
// the log, never thrown, and the rest of the module keeps working.
//
// Used for settings.json and input.json (modules), and settings.json and
// instance-settings.json (themes).

// Each warning is logged once rather than on every request. These files
// are re-read every time a display asks for a tile, so without this one
// bad entry would fill the log every few seconds.
const warned = new Set();

function warnOnce(message) {
	if (warned.has(message)) {
		return;
	}

	warned.add(message);
	console.log(`  ${message}`);
}

// Is this something a list of choices can hold? Plain text or a number.
// A null, an object or a list in there would show up as "null" or
// "[object Object]" in the form, or throw.
function isChoice(value) {
	return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

// The usable fields out of a list read from a file.
//
// `owner` is only for the log line, e.g. 'Module "ntfy" settings.json'.
// `fields` is whatever the file had. Anything that isn't a list at all
// counts as an empty one.
//
// A field is kept when it's an object with a name (`key`) that is
// non-empty text. Two parts of a kept field are tidied as well, because
// they're read without checking:
//
//   options    choices for a select or priority field: anything that
//              isn't text or a number is taken out of the list
//   showWhen   "only show me when another field has this value": must be
//              an object naming that field and the value (`equals`), or
//              it's taken off and the field is simply always shown
function usableFields(owner, fields) {
	if (!Array.isArray(fields)) {
		return [];
	}

	const kept = [];

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];

		// A field is an object. Not null, not a list, not a number.
		if (!field || typeof field !== "object" || Array.isArray(field)) {
			warnOnce(
				`${owner}: entry ${index + 1} isn't a setting (found ${JSON.stringify(field)}), so it was skipped.`
			);
			continue;
		}

		// Without a name there's nowhere to store its value
		if (typeof field.key !== "string" || !field.key.trim()) {
			warnOnce(`${owner}: entry ${index + 1} has no "key", so it was skipped.`);
			continue;
		}

		let clean = field;

		if ("options" in field) {
			const options = Array.isArray(field.options) ? field.options : [];
			const choices = options.filter(isChoice);

			if (!Array.isArray(field.options) || choices.length !== options.length) {
				warnOnce(
					`${owner}: setting "${field.key}" had choices that aren't text or numbers; those were skipped.`
				);
				clean = { ...clean, options: choices };
			}
		}

		if ("showWhen" in field) {
			const when = field.showWhen;

			// A showWhen with nothing to compare against would hide its
			// field for good, with no way to bring it back
			if (
				!when ||
				typeof when !== "object" ||
				typeof when.key !== "string" ||
				when.equals === undefined ||
				when.equals === null
			) {
				warnOnce(
					`${owner}: setting "${field.key}" has a "showWhen" without a "key" and an "equals", so it's always shown.`
				);

				const { showWhen, ...rest } = clean;
				clean = rest;
			}
		}

		kept.push(clean);
	}

	return kept;
}

module.exports = { usableFields };