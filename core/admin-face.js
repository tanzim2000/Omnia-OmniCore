// core/admin-face.js
// OmniCore's built-in admin face, on port 3000.
//
// Admin faces live in the 3xxx range and are OmniCore's own UI — no themes,
// no marketplace code ever runs here. That's precisely why it's the safe
// place for anything that WRITES.
//
// Structure:
//   /                  Settings — the sections of OmniCore you can change
//   /modules           Modules that have settings
//   /modules/:id       One module's settings form
//
// Every settings form is generated from what a module declared in its
// settings.json. Modules never supply HTML, which is what keeps admin pages
// consistent no matter who wrote the module.

const express = require("express");
const { listModules } = require("./module-loader");
const {
	readManifest,
	readSchema,
	readConfig,
	writeConfig
} = require("./module-config");
const { listThemes } = require("./theme-loader");
const { readFaces } = require("./face-store");
const { updateFace } = require("./face-loader");
const auth = require("./admin-auth");

const ADMIN_PORT = 3000;

const styles = `
	body {
		background: #000;
		color: #fff;
		font-family: system-ui, sans-serif;
		min-height: 100vh;
		margin: 0;
		padding: 48px 24px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
	}

	/* Only the sign-in and setup screens centre vertically. "safe" falls
	   back to top-aligned if content is ever taller than the screen, so
	   nothing gets cut off with no way to scroll to it. */
	body.centered { justify-content: safe center; }

	.panel { width: 100%; max-width: 460px; }

	h1 { font-weight: 300; font-size: 28px; margin: 0; }
	.lede { opacity: 0.55; font-size: 14px; margin: 10px 0 0 0; }

	a { color: #fff; text-decoration: none; }

	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 20px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		margin-bottom: 10px;
	}

	.row span { opacity: 0.55; font-size: 13px; }

	/* Clickable rows get the same glass treatment as buttons, so anything
	   you can act on looks the same everywhere in OmniCore's own UI */
	a.row {
		position: relative;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(12px);
	}

	a.row:hover { background: rgba(255, 255, 255, 0.12); }

	a.row::before {
		content: "";
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 50%;
		background: linear-gradient(
			to bottom, rgba(255, 255, 255, 0.14), transparent
		);
		pointer-events: none;
	}

	.field { margin-bottom: 20px; }

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		margin-bottom: 8px;
		cursor: pointer;
		font-size: 15px;
	}

	.option:hover { background: rgba(255, 255, 255, 0.05); }
	.option input { width: 17px; height: 17px; }

	label {
		display: block;
		font-size: 14px;
		opacity: 0.7;
		margin-bottom: 8px;
	}

	.help { font-size: 12px; opacity: 0.45; margin-top: 6px; }

	input[type="text"],
	input[type="url"],
	input[type="number"],
	input[type="password"],
	select {
		width: 100%;
		box-sizing: border-box;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		color: #fff;
		font-size: 16px;
		padding: 12px 16px;
	}

	input[type="checkbox"] { width: 18px; height: 18px; }

	.back { font-size: 14px; opacity: 0.6; }
	.empty { opacity: 0.5; font-size: 14px; }
	.status { font-size: 14px; min-height: 20px; margin-top: 14px; }
	.status.good { color: #6bd968; }
	.status.bad { color: #ff8a8a; }

	.footer { opacity: 0.4; font-size: 13px; }

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
		padding: 14px 28px;
		cursor: pointer;
		width: 100%;
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

function page(title, body, script, bodyClass) {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(title)} — OmniCore</title>
	<style>${styles}</style>
</head>
<body class="${bodyClass || ""}">
	${body}
	<script>${script || ""}</script>
</body>
</html>`;
}

// Shared by the setup and login pages — both are a username, a password,
// and one button
function credentialsPage(options) {
	const body = `
		<div class="panel">
			<h1>${escapeHtml(options.heading)}</h1>
			<p class="lede">${escapeHtml(options.lede)}</p>
		</div>
		<div class="panel">
			<div class="field">
				<label for="username">Username</label>
				<input type="text" id="username" autocomplete="username">
			</div>
			<div class="field">
				<label for="password">Password</label>
				<input type="password" id="password"
					autocomplete="${options.isSetup ? "new-password" : "current-password"}">
			</div>
			<button class="glass" id="submit">${escapeHtml(options.button)}</button>
			<p class="status" id="status"></p>
		</div>`;

	const script = `
		const endpoint = ${JSON.stringify(options.endpoint)};
		const status = document.getElementById("status");
		const button = document.getElementById("submit");

		async function submit() {
			const username = document.getElementById("username").value;
			const password = document.getElementById("password").value;

			button.disabled = true;
			status.textContent = "";
			status.className = "status";

			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ username, password })
				});

				const result = await response.json();

				if (!response.ok) {
					status.textContent = result.error || "That didn't work.";
					status.className = "status bad";
					button.disabled = false;
					return;
				}

				location.href = "/";
			} catch (error) {
				status.textContent = "Couldn't reach OmniCore.";
				status.className = "status bad";
				button.disabled = false;
			}
		}

		button.addEventListener("click", submit);

		// Enter submits, from either field
		for (const field of document.querySelectorAll("input")) {
			field.addEventListener("keydown", function (event) {
				if (event.key === "Enter") submit();
			});
		}
	`;

	return page(options.heading, body, script, "centered");
}

function startAdminFace() {
	const app = express();
	app.use(express.json());

	// Gate everything except the setup and login endpoints
	app.use((req, res, next) => {
		const open = ["/setup", "/login"];

		if (open.includes(req.path) || auth.isLoggedIn(req)) {
			next();
			return;
		}

		// No account yet — first thing to do is create one
		if (!auth.isSetUp()) {
			res.send(
				credentialsPage({
					heading: "Set up OmniCore",
					lede: "Create the admin account. It's stored on this machine only.",
					button: "Create account",
					endpoint: "/setup",
					isSetup: true
				})
			);
			return;
		}

		res.send(
			credentialsPage({
				heading: "Sign in",
				lede: "Sign in to change OmniCore's settings.",
				button: "Sign in",
				endpoint: "/login",
				isSetup: false
			})
		);
	});

	// Create the admin account — only possible once
	app.post("/setup", (req, res) => {
		const result = auth.createAdmin(req.body.username, req.body.password);

		if (result.error) {
			res.status(400).json(result);
			return;
		}

		// Creating the account signs you straight in
		auth.setSessionCookie(res, auth.createSession());
		res.json({ ok: true });
	});

	app.post("/login", (req, res) => {
		if (!auth.verify(req.body.username, req.body.password)) {
			// Deliberately vague: saying which half was wrong would tell an
			// attacker whether a username exists
			res.status(401).json({ error: "Wrong username or password." });
			return;
		}

		auth.setSessionCookie(res, auth.createSession());
		res.json({ ok: true });
	});

	app.get("/logout", (req, res) => {
		auth.destroySession(auth.readCookie(req, auth.SESSION_COOKIE));
		auth.clearSessionCookie(res);
		res.redirect("/");
	});

	// Settings — the sections of OmniCore you can change.
	// OmniCore's own settings will join these as they appear.
	app.get("/", (req, res) => {
		const moduleCount = listModules().filter((id) => readSchema(id)).length;
		const faceCount = readFaces().length;

		const moduleDetail = moduleCount
			? moduleCount + (moduleCount === 1 ? " module" : " modules")
			: "Nothing to configure";

		const faceDetail = faceCount
			? faceCount + (faceCount === 1 ? " face" : " faces")
			: "No faces yet";

		const body = `
			<div class="panel">
				<h1>Settings</h1>
			</div>
			<div class="panel">
				<a class="row" href="/faces">
					<strong>Faces</strong>
					<span>${faceDetail}</span>
				</a>
				<a class="row" href="/modules">
					<strong>Modules</strong>
					<span>${moduleDetail}</span>
				</a>
			</div>
			<div class="panel footer">
				<a href="/logout">Sign out</a>
			</div>`;

		res.send(page("Settings", body));
	});

	// Every dashboard face
	app.get("/faces", (req, res) => {
		const faces = readFaces()
			.map(
				(face) => `
				<a class="row" href="/faces/${face.id}">
					<strong>${escapeHtml(face.name)}</strong>
					<span>port ${face.id} · ${escapeHtml(face.theme || "no theme")}</span>
				</a>`
			)
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/">← Settings</a>
				<h1 style="margin-top:12px">Faces</h1>
			</div>
			<div class="panel">
				${faces || '<div class="empty">No faces yet. Create one on port 4000.</div>'}
			</div>`;

		res.send(page("Faces", body));
	});

	// One face's settings. A face has exactly four attributes; its ID is its
	// port number and can't change, so the other three are what's editable.
	app.get("/faces/:id", (req, res) => {
		const id = Number(req.params.id);
		const face = readFaces().find((candidate) => candidate.id === id);

		if (!face) {
			res.status(404).send(
				page(
					"Not found",
					`<div class="panel">
						<h1>No such face</h1>
						<p><a class="back" href="/faces">← Faces</a></p>
					</div>`
				)
			);
			return;
		}

		const themeOptions = listThemes()
			.map(
				(theme) => `
				<label class="option">
					<input type="radio" name="theme" value="${escapeHtml(theme.id)}"
						${theme.id === face.theme ? "checked" : ""}>
					<span>${escapeHtml(theme.name)}</span>
				</label>`
			)
			.join("");

		const moduleOptions = listModules()
			.map(
				(moduleId) => `
				<label class="option">
					<input type="checkbox" name="module" value="${escapeHtml(moduleId)}"
						${face.modules.includes(moduleId) ? "checked" : ""}>
					<span>${escapeHtml(readManifest(moduleId).name)}</span>
				</label>`
			)
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/faces">← Faces</a>
				<h1 style="margin-top:12px">${escapeHtml(face.name)}</h1>
				<p class="lede">Running on port ${face.id}</p>
			</div>
			<div class="panel">
				<div class="field">
					<label for="name">Name</label>
					<input type="text" id="name" value="${escapeHtml(face.name)}">
				</div>

				<div class="field">
					<label>Theme</label>
					${themeOptions || '<div class="empty">No themes installed.</div>'}
				</div>

				<div class="field">
					<label>Modules</label>
					${moduleOptions || '<div class="empty">No modules installed.</div>'}
				</div>

				<button class="glass" id="save">Save face</button>
				<p class="status" id="status"></p>
			</div>`;

		const script = `
			const faceId = ${face.id};

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");

				const themeInput = document.querySelector('input[name="theme"]:checked');

				const modules = Array.from(
					document.querySelectorAll('input[name="module"]:checked')
				).map(function (input) { return input.value; });

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch("/faces/" + faceId, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							name: document.getElementById("name").value,
							theme: themeInput ? themeInput.value : null,
							modules: modules
						})
					});

					if (!response.ok) throw new Error();

					// The face resolves all of this per request, so it's
					// already live — and any display showing it reloads itself
					status.textContent = "Saved. The face has updated itself.";
					status.className = "status good";
				} catch (error) {
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}

				button.disabled = false;
			});
		`;

		res.send(page(face.name, body, script));
	});

	// Save a face. Goes through face-loader so the change is persisted,
	// applied to the running face, and pushed to any display showing it.
	app.post("/faces/:id", (req, res) => {
		const updated = updateFace(Number(req.params.id), {
			name: req.body.name,
			theme: req.body.theme,
			modules: req.body.modules
		});

		if (!updated) {
			res.status(404).json({ error: "No such face" });
			return;
		}

		res.json(updated);
	});

	// Modules that have settings. Ones with nothing to change aren't listed,
	// since there'd be nowhere for them to go.
	app.get("/modules", (req, res) => {
		const modules = listModules()
			.filter((id) => readSchema(id))
			.map((id) => {
				const manifest = readManifest(id);
				const count = readSchema(id).length;

				// Prefer the module's own description; fall back to a count
				const detail =
					manifest.description ||
					count + (count === 1 ? " setting" : " settings");

				return `
					<a class="row" href="/modules/${encodeURIComponent(id)}">
						<strong>${escapeHtml(manifest.name)}</strong>
						<span>${escapeHtml(detail)}</span>
					</a>`;
			})
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/">← Settings</a>
				<h1 style="margin-top:12px">Modules</h1>
			</div>
			<div class="panel">
				${modules || '<div class="empty">No installed module has settings.</div>'}
			</div>`;

		res.send(page("Modules", body));
	});

	// A module's settings form, generated from what the module declared
	app.get("/modules/:moduleId", (req, res) => {
		const moduleId = req.params.moduleId;
		const schema = readSchema(moduleId);

		if (!schema) {
			res.status(404).send(
				page(
					"Not found",
					`<div class="panel">
						<h1>No settings</h1>
						<p class="empty">This module has nothing to configure.</p>
						<p><a class="back" href="/modules">← Modules</a></p>
					</div>`
				)
			);
			return;
		}

		const config = readConfig(moduleId);
		const manifest = readManifest(moduleId);

		const fields = schema
			.map((field) => {
				const value = config[field.key];
				const help = field.help
					? `<div class="help">${escapeHtml(field.help)}</div>`
					: "";

				let input;

				if (field.type === "boolean") {
					input =
						`<input type="checkbox" data-key="${escapeHtml(field.key)}" ` +
						`data-type="boolean" ${value ? "checked" : ""}>`;
				} else if (field.type === "select") {
					const options = (field.options || [])
						.map(
							(option) =>
								`<option value="${escapeHtml(option)}" ` +
								`${option === value ? "selected" : ""}>` +
								`${escapeHtml(option)}</option>`
						)
						.join("");

					input =
						`<select data-key="${escapeHtml(field.key)}" ` +
						`data-type="select">${options}</select>`;
				} else {
					// text, url, number, password all render as an input
					const type = ["url", "number", "password"].includes(field.type)
						? field.type
						: "text";

					input =
						`<input type="${type}" data-key="${escapeHtml(field.key)}" ` +
						`data-type="${escapeHtml(field.type)}" ` +
						`value="${escapeHtml(value === undefined ? "" : value)}">`;
				}

				return `
					<div class="field">
						<label>${escapeHtml(field.label || field.key)}</label>
						${input}
						${help}
					</div>`;
			})
			.join("");

		const body = `
			<div class="panel">
				<a class="back" href="/modules">← Modules</a>
				<h1 style="margin-top:12px">${escapeHtml(manifest.name)}</h1>
				${
					manifest.description
						? `<p class="lede">${escapeHtml(manifest.description)}</p>`
						: ""
				}
			</div>
			<div class="panel">
				${fields}
				<button class="glass" id="save">Save settings</button>
				<p class="status" id="status"></p>
			</div>`;

		const script = `
			const moduleId = ${JSON.stringify(moduleId)};

			document.getElementById("save").addEventListener("click", async function () {
				const button = this;
				const status = document.getElementById("status");
				const values = {};

				// Collect every field on the page by the key it declared
				for (const input of document.querySelectorAll("[data-key]")) {
					values[input.dataset.key] =
						input.dataset.type === "boolean" ? input.checked : input.value;
				}

				button.disabled = true;
				status.textContent = "";
				status.className = "status";

				try {
					const response = await fetch(
						"/modules/" + encodeURIComponent(moduleId),
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(values)
						}
					);

					if (!response.ok) throw new Error();

					// Modules read their settings per request, so this is
					// already live — no restart needed
					status.textContent = "Saved. Already in effect.";
					status.className = "status good";
				} catch (error) {
					status.textContent = "Couldn't save. Check OmniCore is still running.";
					status.className = "status bad";
				}

				button.disabled = false;
			});
		`;

		res.send(page(manifest.name, body, script));
	});

	// Save a module's settings
	app.post("/modules/:moduleId", (req, res) => {
		const moduleId = req.params.moduleId;

		if (!readSchema(moduleId)) {
			res.status(404).json({ error: "This module has no settings" });
			return;
		}

		res.json(writeConfig(moduleId, req.body));
	});

	app.listen(ADMIN_PORT, () => {
		console.log(`Admin face listening on port ${ADMIN_PORT}`);
	});
}

module.exports = startAdminFace;