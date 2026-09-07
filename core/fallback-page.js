// core/fallback-page.js
// Built-in screen shown when a face has no theme assigned, or its
// assigned theme is missing.
//
// This is NOT part of any theme — it's OmniCore's own, and it now draws
// from the shared Default UI (core/ui-theme.js) rather than carrying its
// own copy of the same black-background/glass-button CSS.
//
// Its days are numbered by design: once the Default UI can render
// dashboard faces properly, "no theme" stops being a state a face can
// be in at all, and this screen goes away rather than becoming a
// picker with Default on it. See
// docs/planning/default-ui-architecture.md.

const { uiStyles } = require("./ui-theme");

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
${uiStyles()}

		body {
			height: 100vh;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2em;
			padding: 1.5em;
		}

		h1 {
			font-weight: 300;
			font-size: 1.75em;
			text-align: center;
			margin: 0;
		}

		.buttons {
			display: flex;
			flex-wrap: wrap;
			gap: 1em;
			justify-content: center;
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