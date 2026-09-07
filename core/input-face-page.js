// core/input-face-page.js
// The page shown on an input face's own port. This is NOT a theme and
// never will be for now — the module declares WHAT controls exist
// (input.json), OmniCore alone decides how they look. Same black
// background, glass visual language as fallback-page.js, since both are
// OmniCore's own built-in UI rather than anything installable.

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

// One control -> one glass element. Unrecognised types are skipped
// rather than guessed at, so a module declaring something OmniCore
// doesn't understand yet just gets fewer controls, never a broken page.
function renderControl(control) {
	const key = escapeJs(control.key);

	if (control.type === "button") {
		return `
		<button class="glass tappable" onclick="press('${key}', this)">
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
		<div class="field glass">
			${label}
			<input
				id="field-${key}"
				type="number"
				inputmode="decimal"
				step="any"
				placeholder="${escapeHtml(control.placeholder || "")}">
			<button class="tappable" onclick="submitNumber('${key}', this)">
				${escapeHtml(control.submitLabel || "Save")}
			</button>
		</div>`;
	}

	return "";
}

function renderInputFacePage(label, controls) {
	const rendered = controls.map(renderControl).join("");

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(label)} — OmniCore</title>
	<style>
		body {
			background: #000;
			color: #fff;
			font-family: system-ui, sans-serif;
			min-height: 100vh;
			margin: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 32px;
			padding: 24px;
			box-sizing: border-box;
		}

		h1 {
			font-weight: 300;
			font-size: 22px;
			opacity: 0.85;
			text-align: center;
		}

		.controls {
			display: flex;
			flex-wrap: wrap;
			gap: 16px;
			justify-content: center;
		}

		.glass {
			position: relative;
			overflow: hidden;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid rgba(255, 255, 255, 0.15);
			border-radius: 12px;
			backdrop-filter: blur(12px);
			color: #fff;
		}

		.glass::before {
			content: "";
			position: absolute;
			top: 0; left: 0; right: 0;
			height: 50%;
			background: linear-gradient(
				to bottom, rgba(255, 255, 255, 0.14), transparent
			);
			pointer-events: none;
		}

		button.glass {
			font-size: 18px;
			padding: 24px 40px;
			cursor: pointer;
			transition: background 0.2s, transform 0.1s;
		}

		button.glass:hover { background: rgba(255, 255, 255, 0.12); }
		.tappable:active { transform: scale(0.96); }

		/* Momentary feedback after a tap, so someone on a phone knows it
		   actually registered before the control resets itself */
		.done { background: rgba(120, 255, 160, 0.18) !important; }

		.field {
			display: flex;
			flex-direction: column;
			gap: 12px;
			padding: 20px;
			min-width: 200px;
		}

		.field label {
			font-size: 14px;
			opacity: 0.7;
		}

		.field input {
			background: rgba(0, 0, 0, 0.3);
			border: 1px solid rgba(255, 255, 255, 0.2);
			border-radius: 8px;
			color: #fff;
			font-size: 24px;
			padding: 12px;
			width: 100%;
			box-sizing: border-box;
			text-align: center;
		}

		.field input:focus {
			outline: none;
			border-color: rgba(255, 255, 255, 0.45);
		}

		.field button {
			background: rgba(255, 255, 255, 0.1);
			border: 1px solid rgba(255, 255, 255, 0.15);
			border-radius: 8px;
			color: #fff;
			font-size: 16px;
			padding: 12px;
			cursor: pointer;
			transition: background 0.2s, transform 0.1s;
		}

		.field button:hover { background: rgba(255, 255, 255, 0.16); }
	</style>
</head>
<body>
	<h1>${escapeHtml(label)}</h1>
	<div class="controls">${rendered}</div>
	<script>
		async function send(payload) {
			await fetch("/input", {
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

module.exports = renderInputFacePage;