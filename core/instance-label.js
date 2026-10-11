// core/instance-label.js
// What a widget is called, wherever OmniCore shows it: the tile's title,
// its own page, the list of a face's widgets.
//
// Three places a name can come from, first one wins:
//
//   1. The label the user typed on the widget's page. Their word is
//      final: once typed, it sticks.
//   2. The module's own suggestion, worked out from its settings. A
//      module can hang a `label` function on its main one:
//
//          module.exports.label = function (config) {
//              return config.location ? config.location.label : "";
//          };
//
//      It gets the same settings its tile function gets (defaults filled
//      in, locations turned into { latitude, longitude, label }) and
//      returns a short line of text, or nothing. So a weather widget is
//      "Regina" until somebody types something else, and goes on
//      following the location when it changes.
//   3. The module's name, from its module.json. What every widget was
//      called before v1.19.7, and still what one is called when its
//      module doesn't suggest anything.
//
// Clearing the Label box puts a widget back on 2: it follows its
// settings again.

const { loadModule } = require("./module-loader");
const { readManifest, applyDefaults } = require("./module-config");
const { resolveLocations } = require("./location-service");

// Longest suggestion kept. It's a title, not a sentence.
const SUGGESTION_LONGEST = 60;

// How long a page waits for a suggestion before giving up on it. Working
// one out can mean looking up OmniCore's own location, which is cached
// but may need the network the first time; a page should never hang on
// a name.
const SUGGESTION_WAIT_MS = 1500;

// The user's own label, or "" when they haven't typed one. Spaces alone
// count as nothing.
function ownLabel(instance) {
	return String((instance && instance.label) || "").trim();
}

// A suggestion, made safe to show: one line, no invisible characters, not
// too long. "" for anything that isn't usable text.
function tidy(value) {
	if (typeof value !== "string") {
		return "";
	}

	const line = value
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/[​-‏‪-‮⁠-⁩﻿]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	// Cut by characters, not by JavaScript's half-characters, so an emoji
	// at the cut is kept or dropped whole
	return Array.from(line).slice(0, SUGGESTION_LONGEST).join("").trim();
}

// What the module suggests for this widget, or "" when it doesn't
// suggest anything (no `label` function, it returned nothing, it threw,
// or it took too long).
async function suggestedLabel(instance) {
	const moduleFn = loadModule(instance.module);

	if (!moduleFn || typeof moduleFn.label !== "function") {
		return "";
	}

	const work = (async () => {
		const config = applyDefaults(instance.module, instance.config);
		await resolveLocations(instance.module, config);
		return tidy(await moduleFn.label(config));
	})();

	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve(""), SUGGESTION_WAIT_MS);
	});

	try {
		return await Promise.race([work, timeout]);
	} catch (error) {
		// A module's mistake costs it its suggestion, nothing more
		console.log(`  Module "${instance.module}" label failed: ${error.message}`);
		return "";
	} finally {
		clearTimeout(timer);
		// Keep a late failure from being reported as unhandled
		work.catch(() => {});
	}
}

// The name to show for a widget: its own label, else the module's
// suggestion, else the module's name.
async function labelFor(instance) {
	const own = ownLabel(instance);

	if (own) {
		return own;
	}

	const suggested = await suggestedLabel(instance);

	if (suggested) {
		return suggested;
	}

	return readManifest(instance.module).name || instance.module;
}

// labelFor for every widget on a face at once, as { instanceId: name }.
// For pages that list them.
async function labelsFor(instances) {
	const names = await Promise.all((instances || []).map(labelFor));
	const byId = {};

	(instances || []).forEach((instance, index) => {
		byId[instance.id] = names[index];
	});

	return byId;
}

module.exports = {
	ownLabel,
	suggestedLabel,
	labelFor,
	labelsFor,
	SUGGESTION_LONGEST
};
