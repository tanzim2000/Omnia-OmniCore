// core/ask-first.js
// A choice that asks before it's taken (since v1.19.8).
//
// Some choices in a module's settings only work with something the person
// has to bring: an API key for a weather service that needs one, say.
// Picking it and finding out later that the widget can't work is a poor
// way to learn that. So a `select` setting can name the options that ask
// first:
//
//     {
//       "key": "source",
//       "type": "select",
//       "options": ["Open-Meteo", "OpenWeatherMap"],
//       "ask": {
//         "OpenWeatherMap": {
//           "question": "Do you have an OpenWeatherMap API key?",
//           "text": "It's free, from openweathermap.org.",
//           "into": "owmKey",
//           "prompt": "Your OpenWeatherMap API key"
//         }
//       }
//     },
//     { "key": "owmKey", "label": "API key", "type": "password",
//       "showWhen": { "key": "source", "equals": "OpenWeatherMap" } }
//
// Picking OpenWeatherMap then asks the question in a pop-up. No puts the
// choice back to what it was. Yes asks for the key in a second pop-up and
// writes it into the `into` setting; cancelling that one puts the choice
// back too. When `into` already has something in it, nothing is asked:
// the key is already there. Without `into`, a Yes is all it takes.
//
// The pop-ups are the shared ones (DIALOG_SCRIPT in ui-theme.js), so this
// works the same on a widget's page and in the setup wizard.

// What an `ask` entry may say, and how long each part may be. Anything
// longer is cut: these are lines in a pop-up, not documents.
const PARTS = {
	question: 160,
	text: 400,
	prompt: 160,
	placeholder: 80
};

// A select field's `ask`, made safe: only entries for options the field
// really has, each with a question, and an `into` only when it names
// another setting in the same list (`keys`). Returns null when nothing
// usable is left. `warn` is told what was dropped.
function cleanAsk(field, keys, warn) {
	const ask = field.ask;

	if (field.type !== "select") {
		warn(`setting "${field.key}" has an "ask", but only a select can ask first, so it never will.`);
		return null;
	}

	if (!ask || typeof ask !== "object" || Array.isArray(ask)) {
		warn(`setting "${field.key}" has an "ask" that isn't a list of options, so nothing asks first.`);
		return null;
	}

	const options = (field.options || []).map(String);
	const clean = {};

	for (const [option, entry] of Object.entries(ask)) {
		if (!options.includes(option)) {
			warn(`setting "${field.key}" asks first for "${option}", which isn't one of its options.`);
			continue;
		}

		if (!entry || typeof entry !== "object" || typeof entry.question !== "string" || !entry.question.trim()) {
			warn(`setting "${field.key}" asks first for "${option}" without a "question", so it doesn't ask.`);
			continue;
		}

		const kept = {};

		for (const [part, most] of Object.entries(PARTS)) {
			if (typeof entry[part] === "string" && entry[part].trim()) {
				kept[part] = entry[part].trim().slice(0, most);
			}
		}

		if (entry.into !== undefined) {
			if (typeof entry.into === "string" && entry.into !== field.key && keys.includes(entry.into)) {
				kept.into = entry.into;
			} else {
				warn(`setting "${field.key}" asks first for "${option}" "into" a setting that doesn't exist, so it only asks the question.`);
			}
		}

		clean[option] = kept;
	}

	return Object.keys(clean).length ? clean : null;
}

// The attribute a select carries into the page when it asks first
function askAttribute(field, escapeHtml) {
	return field.type === "select" && field.ask
		? ` data-ask="${escapeHtml(JSON.stringify(field.ask))}"`
		: "";
}

// Runs in the browser. Needs DIALOG_SCRIPT on the page. setUpAskFirst()
// looks for selects that ask first and wires each one up once, so a page
// that redraws its form (the wizard does, on every step) calls it again
// after each redraw.
const ASK_FIRST_SCRIPT = `
	function setUpAskFirst() {
		for (const select of document.querySelectorAll("select[data-ask]")) {
			if (select.dataset.askReady) continue;
			select.dataset.askReady = "yes";

			let asks = {};
			try { asks = JSON.parse(select.dataset.ask); } catch (error) { continue; }

			// What it was before this change, to go back to on a No
			let previous = select.value;

			select.addEventListener("change", async function () {
				const chosen = select.value;

				// Going back to where it was (a No below) asks nothing
				if (chosen === previous) return;

				const ask = asks[chosen];

				// The setting the answer goes into: same owner (a module's
				// settings or a theme's), same name
				const target = ask && ask.into
					? document.querySelector(
						'[data-key="' + CSS.escape(ask.into) + '"]' +
						'[data-scope="' + CSS.escape(select.dataset.scope || "") + '"]'
					)
					: null;

				// Nothing to ask, or the answer is already there
				if (!ask || (target && target.value.trim())) {
					previous = chosen;
					return;
				}

				let taken = await confirmDialog({
					title: ask.question,
					text: ask.text || "",
					confirm: "Yes",
					cancel: "No"
				});

				if (taken && target) {
					const answer = await askDialog({
						title: ask.prompt || ask.question,
						placeholder: ask.placeholder || "",
						secret: target.type === "password",
						confirm: "Save"
					});

					if (answer) {
						target.value = answer;
						target.dispatchEvent(new Event("input", { bubbles: true }));
						target.dispatchEvent(new Event("change", { bubbles: true }));
					} else {
						taken = false;
					}
				}

				if (taken) {
					previous = chosen;
					return;
				}

				// No: back to what it was, and tell the rest of the page,
				// so fields that follow this one (showWhen) follow it back
				select.value = previous;
				select.dispatchEvent(new Event("change", { bubbles: true }));
			});
		}
	}

	setUpAskFirst();
`;

module.exports = { cleanAsk, askAttribute, ASK_FIRST_SCRIPT, PARTS };
