// core/input-face-page.js
// The page shown on an input face's own port. This is NOT a theme and
// isn't one yet by design — the module declares WHAT controls exist
// (input.json), OmniCore alone decides how they look, drawing on the
// shared Default UI in core/ui-theme.js.
//
// Input faces will gain the ability to swap themes later, at which
// point the `forceMode` seam in ui-theme.js is what a theme would use
// to override the global light/dark setting. Not today.
//
// No floating back button here: an input face is one flat page with
// controls on it, no sub-navigation at all, so there is genuinely
// nowhere for "back" to lead.

const { pageStart } = require("./page-motion");
const { ICON_LINK } = require("./icon");
const { uiStyles, styleTag } = require("./ui-theme");

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, function (character) {
		return {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;"
		}[character];
	});
}

// A control's key reaches the browser inside a JS string literal, so it
// needs escaping for that context too — not just for HTML. Keys come
// from an installed module's own input.json, which is reviewed, but
// "reviewed" is not the same as "can never contain a quote".
function escapeJs(text) {
	return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// One control -> one element. Unrecognised types are skipped rather
// than guessed at, so a module declaring something OmniCore doesn't
// understand yet just gets fewer controls, never a broken page.
function renderControl(control) {
	const key = escapeJs(control.key);

	if (control.type === "button") {
		return `
		<button class="glass big" onclick="press('${key}', this)">
			${escapeHtml(control.label || control.key)}
		</button>`;
	}

	// A number to type, plus its own submit. Deliberately its own little
	// unit rather than one shared submit for the whole page: a module
	// with two number controls means two independent facts, and pairing
	// each with its own button keeps which-value-goes-where obvious.
	if (control.type === "number") {
		const label = control.label
			? `<label for="field-${key}">${escapeHtml(control.label)}</label>`
			: "";

		return `
		<div class="field segment number-field">
			${label}
			<input
				id="field-${key}"
				type="number"
				inputmode="decimal"
				step="any"
				placeholder="${escapeHtml(control.placeholder || "")}">
			<button class="glass" onclick="submitNumber('${key}', this)">
				${escapeHtml(control.submitLabel || "Save")}
			</button>
		</div>`;
	}

	return "";
}

// `postTo` is where this page sends input. It used to always be
// "/input", back when an instance owned an entire port to itself. Now
// several instances share their face's one Inport and are told apart by
// path, so each page is told its own.
function renderInputFacePage(label, controls, postTo) {
	const rendered = controls.map(renderControl).join("");

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(label)}</title>
	${ICON_LINK}
	${styleTag(uiStyles())}
</head>
<body class="centred-page inport-page">
${pageStart()}
	<h1>${escapeHtml(label)}</h1>
	<div class="controls">${rendered}</div>
	<script>
		async function send(payload) {
			await fetch(${JSON.stringify(postTo || "/input")}, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
		}

		function flash(el) {
			el.classList.add("done");
			setTimeout(function () { el.classList.remove("done"); }, 400);
		}

		async function press(key, el) {
			el.disabled = true;
			try {
				await send({ key: key });
				flash(el);
			} catch (error) {
				// Offline or unreachable — nothing useful to show on a
				// walk-up display beyond just letting them try again
			}
			el.disabled = false;
		}

		async function submitNumber(key, el) {
			var input = document.getElementById("field-" + key);
			var value = parseFloat(input.value);

			// An empty or non-numeric box is a slip, not an event worth
			// recording — do nothing rather than send a null through.
			if (isNaN(value)) {
				input.focus();
				return;
			}

			el.disabled = true;
			try {
				await send({ key: key, value: value });
				input.value = "";
				flash(el.parentElement);
			} catch (error) {
				// Same as above — leave the typed value alone so it
				// isn't lost, and let them press again.
			}
			el.disabled = false;
		}
	</script>
</body>
</html>`;
}

// Shown at an Inport's root when a face has more than one instance
// taking input. With exactly one, the root serves that instance's page
// directly instead -- a menu with a single item in it is just an extra
// tap for no reason.
function renderInputPickerPage(faceName, entries) {
	const rows = entries
		.map(
			(entry) =>
				`<a class="segment clickable" href="${escapeHtml(entry.path)}">` +
				`<strong>${escapeHtml(entry.label)}</strong>` +
				`</a>`
		)
		.join("");

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(faceName)}</title>
	${ICON_LINK}
	${styleTag(uiStyles())}
</head>
<body class="centred-page inport-page">
${pageStart()}
	<h1>${escapeHtml(faceName)}</h1>
	<div class="list">${rows}</div>
</body>
</html>`;
}

module.exports = renderInputFacePage;
module.exports.renderInputPickerPage = renderInputPickerPage;