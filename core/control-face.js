// core/control-face.js
// The control face on port 4000. OmniVision talks to this to discover and
// pick which dashboard face to display. Also where new dashboard faces
// (4001, 4002, ...) get created via a proper setup page.

const express = require("express");
const { readFaces, createFace } = require("./face-store");
const { startFace } = require("./face-loader");
const { listThemes } = require("./theme-loader");
const { listModules } = require("./module-loader");

const CONTROL_PORT = 4000;

// Shared styling for both control pages — black bg, white text, glass buttons
const styles = `
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
		gap: 24px;
		padding: 40px 20px;
		box-sizing: border-box;
	}

	h1 { font-weight: 300; font-size: 28px; margin: 0; }
	h2 { font-weight: 300; font-size: 18px; margin: 0 0 12px 0; opacity: 0.7; }

	.list { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 420px; }

	.face {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 20px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		color: #fff;
		text-decoration: none;
		cursor: pointer;
	}

	.face:hover { background: rgba(255, 255, 255, 0.05); }
	.face span { opacity: 0.6; font-size: 14px; }

	.panel {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	label { display: block; font-size: 14px; opacity: 0.7; margin-bottom: 8px; }

	input[type="text"] {
		width: 100%;
		box-sizing: border-box;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		color: #fff;
		font-size: 16px;
		padding: 12px 16px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		margin-bottom: 8px;
		cursor: pointer;
	}

	.option:hover { background: rgba(255, 255, 255, 0.05); }

	.empty { opacity: 0.5; font-size: 14px; }

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
		text-decoration: none;
		display: inline-block;
		text-align: center;
	}

	.glass:hover { background: rgba(255, 255, 255, 0.12); }
	.glass:disabled { opacity: 0.35; cursor: not-allowed; }

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
`;

// Codespaces gives every port its own hostname, so we can't just link to
// localhost:PORT. This rewrites the current URL's port for whichever
// environment we're in — works both in Codespaces and on a real server.
const portLinkScript = `
	function faceUrl(port) {
		const host = location.hostname;

		// Codespaces hostnames look like: name-3000.app.github.dev
		const codespaceMatch = host.match(/^(.*)-\\d+(\\.app\\.github\\.dev)$/);
		if (codespaceMatch) {
			return location.protocol + "//" + codespaceMatch[1] + "-" + port + codespaceMatch[2];
		}

		// Normal server: same host, different port
		return location.protocol + "//" + host + ":" + port;
	}
`;

function startControlFace() {
	const app = express();
	app.use(express.json());

	// Machine-readable face registry — this is what OmniVision will call
	app.get("/faces", (req, res) => {
		res.json(readFaces());
	});

	// Create a new dashboard face and start it immediately
	app.post("/faces", async (req, res) => {
		const { name, theme, modules } = req.body;

		// A face cannot exist without a theme
		if (!theme) {
			res.status(400).json({ error: "A theme is required" });
			return;
		}

		const face = createFace(name || "Untitled Face", theme, modules || []);

		// Wait until the face's server is genuinely accepting connections
		// before responding, so the browser never redirects too early
		await startFace(face);

		res.json(face);
	});

	// The face setup page
	app.get("/faces/new", (req, res) => {
		res.send(renderSetupPage(listThemes(), listModules()));
	});

	// Human-facing page: list existing faces, or create the first one
	app.get("/", (req, res) => {
		res.send(renderControlPage(readFaces()));
	});

	app.listen(CONTROL_PORT, () => {
		console.log(`Control face listening on port ${CONTROL_PORT}`);
	});
}

function renderControlPage(faces) {
	const hasFaces = faces.length > 0;

	// Each face is a clickable link straight to its own port
	const faceList = faces
		.map(
			(face) => `
			<a class="face" href="#" onclick="goToFace(${face.id}); return false;">
				<strong>${face.name}</strong>
				<span>port ${face.id} · theme: ${face.theme || "none"}</span>
			</a>`
		)
		.join("");

	const body = hasFaces
		? `<h1>Faces</h1>
		   <div class="list">${faceList}</div>
		   <a class="glass" href="/faces/new">Create a new face</a>`
		: `<h1>No faces yet</h1>
		   <a class="glass" href="/faces/new">Create your first face</a>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>OmniCore Control</title>
	<style>${styles}</style>
</head>
<body>
	${body}
	<script>
		${portLinkScript}

		function goToFace(port) {
			location.href = faceUrl(port);
		}
	</script>
</body>
</html>`;
}

function renderSetupPage(themes, modules) {
	// Themes are radio buttons — exactly one is required
	const themeOptions = themes.length
		? themes
				.map(
					(theme) => `
			<label class="option">
				<input type="radio" name="theme" value="${theme.id}">
				<span>${theme.name}</span>
			</label>`
				)
				.join("")
		: `<div class="empty">No themes installed — add one to themes/ first.</div>`;

	// Modules are checkboxes — a face can have any number, including none
	const moduleOptions = modules.length
		? modules
				.map(
					(moduleId) => `
			<label class="option">
				<input type="checkbox" name="module" value="${moduleId}">
				<span>${moduleId}</span>
			</label>`
				)
				.join("")
		: `<div class="empty">No modules installed.</div>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>New Face — OmniCore</title>
	<style>${styles}</style>
</head>
<body>
	<h1>New face</h1>

	<div class="panel">
		<div>
			<label for="name">Name</label>
			<input type="text" id="name" placeholder="Living room display">
		</div>

		<div>
			<h2>Theme</h2>
			${themeOptions}
		</div>

		<div>
			<h2>Modules</h2>
			${moduleOptions}
		</div>

		<button class="glass" id="submit" onclick="submitFace()">Create face</button>
	</div>

	<script>
		${portLinkScript}

		async function submitFace() {
			const button = document.getElementById("submit");
			const name = document.getElementById("name").value.trim();

			const themeInput = document.querySelector('input[name="theme"]:checked');
			if (!themeInput) {
				alert("Please select a theme.");
				return;
			}

			// Collect every checked module checkbox
			const modules = Array.from(
				document.querySelectorAll('input[name="module"]:checked')
			).map((input) => input.value);

			// Show progress — creating a face can take a few seconds
			button.disabled = true;
			button.textContent = "Creating face…";

			const response = await fetch("/faces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, theme: themeInput.value, modules })
			});

			const face = await response.json();
			const url = faceUrl(face.id);

			// Poll until the new face actually answers before redirecting.
			// On a normal server this passes instantly; in Codespaces it covers
			// the short delay before the new port's hostname is published.
			for (let attempt = 0; attempt < 20; attempt++) {
				try {
					await fetch(url, { mode: "no-cors" });
					break;
				} catch (error) {
					await new Promise((r) => setTimeout(r, 500));
				}
			}

			location.href = url;
		}
	</script>
</body>
</html>`;
}

module.exports = startControlFace;