// core/input-face-page.js
// The page shown on an input face's own port. This is NOT a theme and
// never will be for now — the module declares WHAT controls exist
// (input.json), OmniCore alone decides how they look. Same black
// background, glass-button visual language as fallback-page.js, since
// both are OmniCore's own built-in UI rather than anything installable.

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

// One control -> one glass button. `button` is the only control type
// today; an unrecognised type is skipped rather than guessed at, so a
// module declaring something OmniCore doesn't understand yet just gets
// fewer buttons, never a broken page.
function renderControl(control) {
	if (control.type !== "button") {
		return "";
	}

	return `
		<button class="glass" onclick="press('${control.key}', this)">
			${escapeHtml(control.label || control.key)}
		</button>`;
}

function renderInputFacePage(label, controls) {
	const buttons = controls.map(renderControl).join("");

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
			height: 100vh;
			margin: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 32px;
		}

		h1 {
			font-weight: 300;
			font-size: 22px;
			opacity: 0.85;
		}

		.buttons {
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
			font-size: 18px;
			padding: 24px 40px;
			cursor: pointer;
			transition: background 0.2s, transform 0.1s;
		}

		.glass:hover { background: rgba(255, 255, 255, 0.12); }
		.glass:active { transform: scale(0.96); }

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

		/* Momentary feedback after a tap, so someone on a phone knows it
		   actually registered before the button resets itself */
		.glass.done { background: rgba(120, 255, 160, 0.18); }
	</style>
</head>
<body>
	<h1>${escapeHtml(label)}</h1>
	<div class="buttons">${buttons}</div>
	<script>
		async function press(key, el) {
			el.disabled = true;
			try {
				await fetch("/input", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ key: key })
				});
				el.classList.add("done");
				setTimeout(() => el.classList.remove("done"), 400);
			} catch (error) {
				// Offline or unreachable — nothing useful to show on a
				// walk-up display beyond just letting them try again
			}
			el.disabled = false;
		}
	</script>
</body>
</html>`;
}

module.exports = renderInputFacePage;