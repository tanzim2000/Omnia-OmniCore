// core/widget-types.js
// Widget types: the different shapes one module can show its data in.
//
// A calendar might offer a month grid and an agenda list. Both are the
// same module reading the same calendar; they only differ in what the
// tile looks like. So a widget type is NOT a new kind of thing you
// install or add. An instance is still exactly what it always was -- a
// module plus its settings, on a face -- and which widget type it shows
// is just one more of those settings, `widgetType`.
//
// A module offers widget types by listing them in its module.json:
//
//     "widgets": [
//         { "id": "month-view", "name": "Month View", "description": "The whole month" },
//         { "id": "agenda-view", "name": "Agenda View" }
//     ]
//
// A module that lists none (every module written before this existed)
// has exactly one widget type, named after the module itself, and none
// of what follows applies to it. Its settings look exactly as they did.
//
// Once a module offers two or more, every field in its settings.json has
// to say which widget types it belongs to, with a `widgets` tag: a list
// of ids, or the word "all". The settings form then only shows the
// fields for the widget type that's picked. Values for the others stay
// stored, so switching back finds them as they were.
//
// Widget types are entirely the module's business. A theme never learns
// which one a tile is showing: it gives the tile room and sends a
// richness number, and the module decides what fits, the same as for any
// other module. A month grid in a small tile is the module's problem to
// solve (show less), not the theme's. That's the line between modules
// and themes richness exists to hold, and widget types don't cross it.
//
// Everything that's wrong in a declaration is dropped with a warning in
// the log, never thrown. A module with one broken field still shows up
// with the rest of its settings; a broken module.json can't take a face
// down. Same spirit as an unreadable settings.json.

// What an id may look like. Plain and short, because ids end up inside
// HTML attributes and get joined with "|" there -- so no spaces, quotes
// or bars can ever be part of one.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

// The key OmniCore keeps the picked widget type under. A module can't
// declare a setting of its own with this name once it offers widget
// types -- it would be fighting OmniCore for the same value.
const KEY = "widgetType";

// Each warning is logged once, not on every request. readSchema runs
// every time a display asks for a tile, so without this one broken field
// would fill the log every few seconds.
const warned = new Set();

function warnOnce(message) {
	if (warned.has(message)) {
		return;
	}

	warned.add(message);
	console.log(`  ${message}`);
}

// The widget types a module.json declares, checked. Returns an empty
// list for a module that offers no choice -- which includes one that
// lists only a single type, since a picker with one button picks
// nothing.
function readWidgets(moduleId, raw) {
	if (raw === undefined) {
		return [];
	}

	if (!Array.isArray(raw)) {
		warnOnce(`Module ${moduleId}: "widgets" in module.json isn't a list, so it's ignored.`);
		return [];
	}

	const widgets = [];

	for (const entry of raw) {
		const id = entry && typeof entry === "object" ? entry.id : undefined;

		if (typeof id !== "string" || !ID_PATTERN.test(id)) {
			warnOnce(
				`Module ${moduleId}: a widget type with a missing or unusable id ` +
					`(${JSON.stringify(id)}) was skipped. Ids are letters, digits, - and _.`
			);
			continue;
		}

		if (widgets.some((widget) => widget.id === id)) {
			warnOnce(`Module ${moduleId}: widget type "${id}" is listed twice; the second was skipped.`);
			continue;
		}

		widgets.push({
			id: id,
			// No name means the id is shown instead, the same fallback a
			// module without a name gets
			name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
			// Optional. A name like "Agenda View" often says enough.
			description: typeof entry.description === "string" ? entry.description : ""
		});
	}

	if (widgets.length === 1) {
		warnOnce(
			`Module ${moduleId}: lists only one widget type. Two or more are needed ` +
				"to offer a choice, so it's treated as a module without widget types."
		);
		return [];
	}

	return widgets;
}

// Does this module offer a choice of widget types? `manifest` is what
// module-config.readManifest returns.
function offersChoice(manifest) {
	return Boolean(manifest && manifest.widgets && manifest.widgets.length >= 2);
}

// Every widget type a module can show. A module without a choice has
// exactly one, named after the module itself.
function typesOf(manifest) {
	return offersChoice(manifest)
		? manifest.widgets.map((widget) => widget.id)
		: [manifest.id];
}

// Which widget type an instance actually shows, from what was stored. A
// value the module no longer offers (renamed, or removed in an update)
// falls back to the module's first one rather than to nothing -- the
// same way priority.normalize() reconciles a stored list against what's
// true now.
function resolve(manifest, stored) {
	const types = typesOf(manifest);
	return types.includes(stored) ? stored : types[0];
}

// A field's `widgets` tag, read. Returns:
//   "all"       it belongs to every widget type
//   [ids...]    it belongs to these
//   undefined   there's no tag at all
//   null        there's a tag, but it's neither of the shapes above
function readTag(field) {
	const tag = field.widgets;

	if (tag === undefined) {
		return undefined;
	}

	if (tag === "all") {
		return "all";
	}

	if (
		Array.isArray(tag) &&
		tag.length &&
		tag.every((id) => typeof id === "string" && ID_PATTERN.test(id))
	) {
		// Duplicates removed, so "listed twice" can't mean anything
		return Array.from(new Set(tag));
	}

	return null;
}

// A module's settings fields, made ready for a module that offers widget
// types: every field keeps a clean `widgets` tag, or is dropped with a
// warning saying why. A module WITHOUT widget types never comes through
// here -- its fields are used exactly as written.
function moduleFields(moduleId, schema, widgets) {
	const ids = widgets.map((widget) => widget.id);
	const kept = [];

	for (const field of schema) {
		// Not a field at all (a stray null in the list, say)
		if (!field || typeof field !== "object") {
			continue;
		}

		const name = field.key ? `"${field.key}"` : "(no key)";

		if (field.key === KEY) {
			warnOnce(
				`Module ${moduleId}: setting ${name} was skipped. OmniCore keeps the ` +
					"picked widget type under that name itself."
			);
			continue;
		}

		const tag = readTag(field);

		if (tag === undefined) {
			warnOnce(
				`Module ${moduleId}: setting ${name} was skipped because it doesn't say ` +
					'which widget types it belongs to. Give it "widgets": [ids] or "widgets": "all".'
			);
			continue;
		}

		if (tag === null) {
			warnOnce(
				`Module ${moduleId}: setting ${name} was skipped. Its "widgets" tag ` +
					'must be a list of widget type ids, or "all".'
			);
			continue;
		}

		if (tag === "all") {
			kept.push({ ...field, widgets: "all" });
			continue;
		}

		// Ids the module doesn't declare are ignored. If that leaves
		// nothing, the field belongs to no widget type that exists, and
		// a form could never show it.
		const known = tag.filter((id) => ids.includes(id));

		for (const id of tag) {
			if (!known.includes(id)) {
				warnOnce(
					`Module ${moduleId}: setting ${name} names widget type "${id}", ` +
						"which the module doesn't declare."
				);
			}
		}

		if (!known.length) {
			warnOnce(`Module ${moduleId}: setting ${name} was skipped; none of its widget types exist.`);
			continue;
		}

		kept.push({ ...field, widgets: known });
	}

	return kept;
}

// The row of buttons, one per widget type, that sits at the top of an
// instance's settings. The picked id lives in a hidden input marked
// data-key="widgetType", so every settings page saves it the same way it
// saves a text box: by reading .value.
//
// Written as a plain function with nothing from outside it, on purpose:
// the setup wizard runs in the browser and is handed this function's own
// source, rather than a second copy that could drift. `escape` is passed
// in because each page already has its own.
function pickerHtml(widgets, current, escape) {
	let buttons = "";

	for (let index = 0; index < widgets.length; index++) {
		const widget = widgets[index];
		const on = widget.id === current;

		buttons +=
			'<button type="button" class="widget-choice' + (on ? " active" : "") + '" ' +
			'role="radio" aria-checked="' + (on ? "true" : "false") + '" ' +
			'data-widget-choice="' + escape(widget.id) + '">' +
			"<strong>" + escape(widget.name) + "</strong>" +
			(widget.description ? "<small>" + escape(widget.description) + "</small>" : "") +
			"</button>";
	}

	return '<div class="field">' +
		"<label>Widget</label>" +
		'<input type="hidden" data-key="widgetType" data-scope="module" ' +
			'data-type="widgetType" value="' + escape(current) + '">' +
		'<div class="widget-picker" role="radiogroup" aria-label="Widget">' + buttons + "</div>" +
		"</div>";
}

// The browser side of the picker, shared by the admin face and the
// wizard. Clicking a button stores its id and re-filters the form; one
// listener on the document covers it, so it keeps working after the
// wizard rebuilds its form on each step.
//
// A field marked data-widgets="a|b" is shown only while "a" or "b" is
// picked. It's hidden with a class rather than style.display, because fields that depend on
// another field's value (showWhen) already use style.display, and the
// two mustn't undo each other.
//
// Picking also fires a "change" on the hidden input, the event every
// other field fires, so a showWhen that looks at widgetType updates too.
const pickerScript = `
	function applyWidgetFilter() {
		const store = document.querySelector('[data-type="widgetType"]');
		const current = store ? store.value : null;

		for (const field of document.querySelectorAll("[data-widgets]")) {
			const fits = current === null ||
				field.dataset.widgets.split("|").indexOf(current) !== -1;
			field.classList.toggle("widget-off", !fits);
		}

		for (const choice of document.querySelectorAll("[data-widget-choice]")) {
			const on = choice.dataset.widgetChoice === current;
			choice.classList.toggle("active", on);
			choice.setAttribute("aria-checked", on ? "true" : "false");
		}
	}

	document.addEventListener("click", function (event) {
		const choice = event.target.closest("[data-widget-choice]");
		if (!choice) return;

		event.preventDefault();

		const store = document.querySelector('[data-type="widgetType"]');
		if (store) {
			store.value = choice.dataset.widgetChoice;
			store.dispatchEvent(new Event("change"));
		}

		applyWidgetFilter();
	});
`;

// The attribute a field wrapper carries when it only belongs to some
// widget types. Nothing for a field that belongs to all of them.
//
// Every id is checked against the same pattern ID_PATTERN uses before it
// goes anywhere near the page. Only a cleaned module tag should ever
// arrive here (a module without widget types, and every theme, has its
// tags taken off when read), but a tag is text from somebody else's
// module, so this doesn't rely on that. One id that isn't plain means no
// attribute at all, rather than a quote breaking out of it. The pattern is written out
// here rather than shared because the wizard gets this function's source
// on its own.
function widgetsAttribute(field) {
	const ids = field.widgets;

	if (!Array.isArray(ids) || !ids.length) {
		return "";
	}

	for (let index = 0; index < ids.length; index++) {
		if (typeof ids[index] !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(ids[index])) {
			return "";
		}
	}

	return ' data-widgets="' + ids.join("|") + '"';
}

module.exports = {
	KEY,
	readWidgets,
	offersChoice,
	typesOf,
	resolve,
	moduleFields,
	pickerHtml,
	pickerScript,
	widgetsAttribute
};