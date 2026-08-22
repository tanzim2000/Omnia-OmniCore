// core/fallback-page.js
// Built-in screen shown when a face has no theme assigned, or its assigned
// theme is missing. This is NOT part of any theme — it's OmniCore's own
// bare fallback: pure black background, white text, glass-style buttons.

function renderFallbackPage(themes) {
	const hasThemes = themes.length > 0;

	// One glass button per available theme
	const buttons = themes
		.map(
			(theme) => `
			<button class="glass" onclick="selectTheme('${theme.id}')">
				${theme.name}
			</button>`
		)
		.join("");

	const body = hasThemes
		? `<h1>Please select a theme</h1><div class="buttons">${buttons}</div>`
		: `<h1>No Theme available.</h1>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>OmniCore</title>
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
			font-size: 28px;
		}

		.buttons {
			display: flex;
			flex-wrap: wrap;
			gap: 16px;
			justify-content: center;
		}

		/* Glass-style button with a soft light reflection */
		.glass {
			position: relative;
			overflow: hidden;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid rgba(255, 255, 255, 0.15);
			border-radius: 12px;
			backdrop-filter: blur(12px);
			color: #fff;
			font-size: 16px;
			padding: 16px 32px;
			cursor: pointer;
			transition: background 0.2s;
		}

		.glass:hover {
			background: rgba(255, 255, 255, 0.12);
		}

		/* The reflection: a light sheen across the upper half */
		.glass::before {
			content: "";
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			height: 50%;
			background: linear-gradient(
				to bottom,
				rgba(255, 255, 255, 0.14),
				transparent
			);
			pointer-events: none;
		}
	</style>
</head>
<body>
	${body}
	<script>
		// Send the chosen theme back to this face, then reload to render it
		async function selectTheme(themeId) {
			await fetch("/select-theme", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ theme: themeId })
			});
			location.reload();
		}
	</script>
</body>
</html>`;
}

module.exports = renderFallbackPage;