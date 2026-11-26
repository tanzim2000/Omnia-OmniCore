// core/getting-started.js
// Getting Started: which of its steps are still to do, and the one device
// that gets to do them.
//
// Getting Started is the first-time wizard (3999/getting-started; its
// pages are in getting-started-page.js). It runs on a new install, and
// once after an upgrade that brings steps the install hasn't been
// through. This file is the part every port shares:
//
// --- The datasheet ------------------------------------------------------------
//
// data/getting-started.json says which steps were done, each by its id,
// with the version of the step that was done:
//
//   { "steps": { "location": { "version": 1, "at": "2026-…" }, … },
//     "holder": { "token": "<sha256 of the cookie>", "seen": 1764… } }
//
// Every time a page is asked for, OmniCore checks it: a step with no
// record, or with an older version's, is still to do. So a later version
// that reworks a step (version 2) shows it once more to everyone, filled
// in with what's already set, to confirm or change. Nothing is ever wiped.
// A step about something OmniCore can check for itself (the admin
// password exists) is checked for real, rather than trusted to the record.
// Having an .ocap doesn't count as having done the appearance step: only
// its record does.
//
// --- One device at a time ---------------------------------------------------
//
// While there's a step to do, every page on every port shows only the
// screen before Getting Started: "Please connect to your OmniCore with a
// browser or via OmniSync to get started", and Okay. Okay makes that
// browser the one doing the setup (a token in a cookie, its fingerprint
// in the datasheet, so it survives a restart for an update), and every
// other screen shows "OmniCore is being set up on another device" with
// Use this screen instead. Once the admin password exists, both ask for
// it. If the browser doing the setup goes quiet for IDLE_MS (closed,
// asleep, its battery gone), the setup is let go, so it can never lock
// OmniCore for good; nothing is lost, the datasheet says where it was.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const paths = require("./paths");
const auth = require("./admin-auth");

// The steps, in order. `version` goes up when a step is reworked enough
// that everyone should see it again. `check`, for a step about something
// OmniCore can look at for itself: done when it says so, whatever the
// record. `frame`: Welcome and Done, shown whenever the wizard runs, but
// never a reason on their own to run it. `skippable`: the one step that
// has a "Skip for now", where skipping counts as done.
//
// Steps join this list as they're built. (The terms join it once they're
// written, after Updates: adding a step is all it takes for every install
// to be shown it once.)
const STEPS = [
	{ id: "welcome", version: 1, frame: true },
	{ id: "admin-password", version: 1, check: () => auth.isSetUp() },
	{ id: "wifi", version: 1 },
	{ id: "location", version: 1 },
	{ id: "updates", version: 1 },
	{ id: "done", version: 1, frame: true }
];

const COOKIE = "omnicore_setup";

// How long the browser doing the setup can go quiet before it's let go:
// long enough for a phone to sleep through a slow step, short enough
// that a forgotten tab doesn't keep everyone else out for long
const IDLE_MS = 15 * 60 * 1000;

function datasheetPath() {
	return path.join(paths.dataDir(), "getting-started.json");
}

function readDatasheet() {
	try {
		const saved = JSON.parse(fs.readFileSync(datasheetPath(), "utf-8"));
		return {
			steps: saved && typeof saved.steps === "object" && saved.steps ? saved.steps : {},
			holder: saved && saved.holder && typeof saved.holder === "object" ? saved.holder : null
		};
	} catch (error) {
		return { steps: {}, holder: null };
	}
}

function writeDatasheet(sheet) {
	fs.mkdirSync(path.dirname(datasheetPath()), { recursive: true });
	const temporary = `${datasheetPath()}.new`;
	fs.writeFileSync(temporary, JSON.stringify(sheet, null, "\t"));
	fs.renameSync(temporary, datasheetPath());
}

function stepById(id) {
	return STEPS.find((step) => step.id === id) || null;
}

// Whether one step is done: by checking, for a step that can be checked,
// otherwise by its record being this step's version or later
function isDone(step, sheet) {
	if (step.check) return Boolean(step.check());
	const record = (sheet || readDatasheet()).steps[step.id];
	return Boolean(record) && Number(record.version) >= step.version;
}

// The steps still to do, in order (frame steps included, so the wizard
// knows to show them)
function toDo() {
	const sheet = readDatasheet();
	return STEPS.filter((step) => !isDone(step, sheet));
}

// Whether Getting Started has anything to show: a step to do that isn't
// only Welcome or Done
function needed() {
	return toDo().some((step) => !step.frame);
}

// What the wizard runs through now: Welcome, then the steps to do, then
// Done. Ids only. Welcome is left out when the wizard is carrying on from
// where it was (after OmniCore restarted for an update, say): it's
// recorded once seen, and that record is cleared at Done, so the next
// time the wizard runs it says Welcome again.
function plan() {
	if (!needed()) return [];
	const left = new Set(toDo().map((step) => step.id));
	return STEPS.filter((step) => step.id === "done" || left.has(step.id)).map((step) => step.id);
}

// A step done (or skipped, for the one that can be). The record keeps the
// version done, so a later version can ask again.
function record(id, options) {
	const step = stepById(id);
	if (!step) throw new Error(`There's no step called ${id}.`);
	if (options && options.skipped && !step.skippable) throw new Error("This step can't be skipped.");

	const sheet = readDatasheet();
	sheet.steps[id] = {
		version: step.version,
		at: new Date().toISOString(),
		...(options && options.skipped ? { skipped: true } : {})
	};
	// Done is the end: whoever was doing the setup is let go, and Welcome
	// is said again the next time the wizard runs
	if (id === "done") {
		sheet.holder = null;
		delete sheet.steps.welcome;
	}
	writeDatasheet(sheet);
}

// --- Who's doing the setup ------------------------------------------------------

function fingerprintOf(token) {
	return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function readCookie(req, name) {
	const header = (req.headers && req.headers.cookie) || "";
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at > -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
	return "";
}

// "holder": this browser is doing the setup. "taken": another one is,
// and hasn't gone quiet. "free": nobody is.
function holderState(req) {
	const holder = readDatasheet().holder;
	if (!holder || !holder.token || Date.now() - Number(holder.seen || 0) > IDLE_MS) return "free";
	const token = readCookie(req, COOKIE);
	if (token && fingerprintOf(token) === holder.token) return "holder";
	return "taken";
}

// The browser doing the setup is still there: every request it makes,
// and the wizard's own heartbeat, say so. Written at most every 30
// seconds, not on every request.
function touch(req) {
	const sheet = readDatasheet();
	if (!sheet.holder) return;
	const token = readCookie(req, COOKIE);
	if (!token || fingerprintOf(token) !== sheet.holder.token) return;
	if (Date.now() - Number(sheet.holder.seen || 0) < 30 * 1000) return;
	sheet.holder.seen = Date.now();
	writeDatasheet(sheet);
}

// Makes this browser the one doing the setup (Okay, or Use this screen
// instead). Once the admin password exists, only with it. Returns the
// cookie to send, or { error }.
function claim(password) {
	if (auth.isSetUp() && !auth.verify(password)) {
		return { error: "That isn't the admin password." };
	}
	const token = crypto.randomBytes(32).toString("hex");
	const sheet = readDatasheet();
	sheet.holder = { token: fingerprintOf(token), seen: Date.now() };
	writeDatasheet(sheet);
	return {
		ok: true,
		cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
	};
}

// --- Every port ---------------------------------------------------------------------

// What every page needs even while the setup is going on: the Wi-Fi
// takeover's own routes (whoever is in front of the screen has to be able
// to get it online), the picture and the font a page draws with.
const ALWAYS_OPEN = ["/omnicore-network/", "/backdrop/", "/ui-font.woff2"];

const CLAIM_PATH = "/getting-started/claim";

// OMNICORE_GETTING_STARTED=off turns it off: for the test suite, whose
// tests are about everything else (test/helpers.js sets it; the tests
// for Getting Started turn it back on).
//
// Express middleware, on every port's app before its own routes. While
// Getting Started has a step to do:
//   - the browser doing it goes to 3999/getting-started from any page
//     (its requests for anything else are let through: the wizard uses
//     them)
//   - every other page shows the screen before Getting Started
//   - anything else from anyone else is refused (423, Locked)
function gate(req, res, next) {
	if (process.env.OMNICORE_GETTING_STARTED === "off" || !needed()) return next();
	if (ALWAYS_OPEN.some((open) => req.path.startsWith(open))) return next();

	if (req.method === "POST" && req.path === CLAIM_PATH) {
		readBody(req, (body) => {
			const result = claim(body.password);
			if (result.error) {
				res.status(403).json({ error: result.error });
				return;
			}
			res.setHeader("Set-Cookie", result.cookie);
			res.json({ ok: true });
		});
		return;
	}

	const state = holderState(req);
	const page = req.method === "GET" && String(req.headers.accept || "").includes("text/html");

	if (state === "holder") {
		touch(req);
		// The wizard itself (on 3999), and what it asks for, go through
		if (!page || (req.socket.localPort === 3999 && req.path.startsWith("/getting-started"))) return next();
		res.send(goToWizardPage());
		return;
	}

	if (!page) {
		res.status(423).json({ error: "OmniCore is being set up. Try again once that's finished." });
		return;
	}
	res.status(423).send(connectPage(state));
}

// A small JSON body, read by hand: the gate runs before a port's own
// express.json()
function readBody(req, done) {
	let text = "";
	req.setEncoding("utf8");
	req.on("data", (piece) => {
		text += piece;
		if (text.length > 4096) req.destroy();
	});
	req.on("end", () => {
		try {
			done(JSON.parse(text || "{}") || {});
		} catch (error) {
			done({});
		}
	});
}

// --- The screens -------------------------------------------------------------------

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

// A page in the central theme with the Default background, following
// the device's own dark or light setting: there's no appearance profile
// of the user's own yet
function plainPage(title, body, script) {
	const { uiStyles, styleTag, PASSWORD_TOGGLE_SCRIPT } = require("./ui-theme");
	const { pageStart } = require("./page-motion");
	const { ICON_LINK } = require("./icon");
	const { portLinkScript } = require("./face-links");
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="color-scheme" content="dark light">
	<title>${escapeHtml(title)}</title>
	${ICON_LINK}
	${styleTag(uiStyles({ device: true }))}
</head>
<body class="centred-page">
${pageStart({ plain: true })}
	${body}
	<script>${portLinkScript}${PASSWORD_TOGGLE_SCRIPT}${script || ""}</script>
</body>
</html>`;
}

// The screen before Getting Started. "free": nobody is setting OmniCore
// up, Okay starts it here. "taken": another device is, Use this screen
// instead moves it here. Either asks for the admin password once there
// is one.
function connectPage(state) {
	const { passwordField } = require("./ui-theme");
	const asks = auth.isSetUp();
	const taken = state === "taken";
	const text = taken
		? "OmniCore is being set up on another device."
		: "Please connect to your OmniCore with a browser or via OmniSync to get started.";
	const button = taken ? "Use this screen instead" : "Okay";

	const body = `
	<div class="form-stack centred" id="connect">
		<p class="lede">${text}</p>
		${
			asks
				? `<div class="field">
			<label for="password">Admin password</label>
			${passwordField('<input type="password" id="password" autocomplete="current-password">')}
		</div>`
				: ""
		}
		<button type="button" class="glass big" id="go">${button}</button>
		<p class="status" id="status" aria-live="polite"></p>
	</div>`;

	const script = `
	(function () {
		const go = document.getElementById("go");
		const status = document.getElementById("status");
		const password = document.getElementById("password");

		async function start() {
			go.disabled = true;
			status.textContent = "";
			status.className = "status";
			try {
				const response = await fetch(${JSON.stringify(CLAIM_PATH)}, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: password ? password.value : "" })
				});
				const answer = await response.json().catch(function () { return {}; });
				if (!response.ok) throw new Error(answer.error || "That didn't work.");
				location.replace(faceUrl(3999) + "/getting-started");
			} catch (error) {
				status.textContent = error.message;
				status.className = "status bad";
				go.disabled = false;
			}
		}

		go.addEventListener("click", start);
		if (password) {
			password.addEventListener("keydown", function (event) {
				if (event.key === "Enter") start();
			});
		}
	})();`;

	return plainPage("Getting Started", body, script);
}

// For the browser doing the setup, asking for any other page: back to
// the wizard, on 3999, whatever address this page was opened on
function goToWizardPage() {
	return plainPage(
		"Getting Started",
		'<p class="lede">Taking you back to Getting Started…</p>',
		'location.replace(faceUrl(3999) + "/getting-started");'
	);
}

module.exports = {
	STEPS,
	COOKIE,
	IDLE_MS,
	CLAIM_PATH,
	datasheetPath,
	readDatasheet,
	stepById,
	isDone,
	toDo,
	needed,
	plan,
	record,
	holderState,
	touch,
	claim,
	gate,
	plainPage,
	connectPage
};
