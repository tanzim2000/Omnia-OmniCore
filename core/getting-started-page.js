// core/getting-started-page.js
// Getting Started's page and its routes, on 3999/getting-started.
//
// Which steps are still to do, and which device gets to do them, is in
// getting-started.js. This is the wizard itself: one page holding every
// step it has to show, one sheet at a time. Next records the step in the
// datasheet and slides the next sheet in (ui-theme.js, Getting Started).
// A step is recorded as soon as it's done, so a reload, or OmniCore
// restarting for an update, carries on from where it was.
//
// The look: the central theme with the Default background, following the
// device's own dark or light setting (uiStyles({ device: true })), since
// there's no appearance profile of the user's own yet.
//
// Every route here is for the device doing the setup: while Getting
// Started has a step to do, the gate (getting-started.js) lets nobody else
// through. Once nothing is left, they all refuse.

const auth = require("./admin-auth");
const gettingStarted = require("./getting-started");
const { readSettings, writeSettings } = require("./settings-store");
const { getLocation, locationFromBody } = require("./location-service");
const { escapeHtml } = require("./face-links");

const STEP_PATH = "/getting-started/step";
const ALIVE_PATH = "/getting-started/alive";

// --- The sheets ------------------------------------------------------------------
//
// One function per step: its sheet's markup. Its script is in the page's
// script below, under the step's name. Every button that moves on has
// data-next; the step's own script decides when that's allowed.

function welcomeSheet() {
	return `
	<section class="gs-sheet gs-welcome" data-step="welcome">
		<div class="gs-logo" aria-hidden="true"></div>
		<h1>Welcome to Omnia</h1>
		<p class="lede">Let's get your OmniCore ready. It only takes a few minutes, and everything here can be changed later in Settings.</p>
		<button type="button" class="glass big" data-next>Next</button>
	</section>`;
}

function passwordSheet() {
	const { passwordField } = require("./ui-theme");
	return `
	<section class="gs-sheet" data-step="admin-password" hidden>
		<div class="segment">
			<h1>Admin password</h1>
			<p class="lede">The password for OmniCore's Settings. It's kept on this machine only, and nobody can change anything without it.</p>
			<div class="field">
				<label for="gs-password">Password</label>
				${passwordField('<input type="password" id="gs-password" autocomplete="new-password">')}
				<p class="help">At least 8 characters.</p>
			</div>
			<div class="field">
				<label for="gs-password-again">Type it again</label>
				${passwordField('<input type="password" id="gs-password-again" autocomplete="new-password">')}
			</div>
			<div class="buttons to-end">
				<span class="status" id="gs-password-status" aria-live="polite"></span>
				<button type="button" class="glass" data-next>Next</button>
			</div>
		</div>
	</section>`;
}

function wifiSheet() {
	return `
	<section class="gs-sheet" data-step="wifi" hidden>
		<div class="segment">
			<h1>Wi-Fi</h1>
			<p class="lede">How OmniCore is connected. It needs the internet for the weather, the Marketplace and its updates.</p>
			<div class="inset">
				<div class="inset-text">
					<div class="inset-label">CONNECTION</div>
					<div class="inset-value" id="gs-wifi-value"><span class="spinner" aria-hidden="true"></span>Looking…</div>
				</div>
			</div>
			<p class="hint" id="gs-wifi-note"></p>
			<div class="buttons to-end">
				<button type="button" class="glass" data-next>Next</button>
			</div>
		</div>
	</section>`;
}

function locationSheet(settings, current) {
	const manual = settings.locationMode === "manual";
	const currentText = !settings.locationEnabled
		? "Location services are off."
		: current
		? escapeHtml(current.label || "Unnamed") +
		  `<span class="coords">${current.latitude.toFixed(3)}, ${current.longitude.toFixed(3)}</span>`
		: "Not found yet.";

	return `
	<section class="gs-sheet" data-step="location" hidden>
		<div class="segment">
			<h1>Location</h1>
			<p class="lede">Where OmniCore is, for the weather, prayer times and anything else that depends on it. Turn it off and OmniCore never looks one up.</p>

			<label class="option spaced">
				<input type="checkbox" role="switch" id="gs-location-on"${settings.locationEnabled ? " checked" : ""}>
				<span>Let OmniCore know where it is</span>
			</label>

			<div id="gs-location-detail"${settings.locationEnabled ? "" : " hidden"}>
				<div class="tabs spaced" id="gs-location-tabs">
					<button type="button" class="tab-btn${manual ? "" : " active"}" data-value="auto">Work it out automatically</button>
					<button type="button" class="tab-btn${manual ? " active" : ""}" data-value="manual">Set it myself</button>
				</div>

				<div class="inset">
					<div class="inset-text">
						<div class="inset-label">${manual ? "SET" : "DETECTED"}</div>
						<div class="inset-value" id="gs-location-value">${currentText}</div>
					</div>
				</div>

				<div id="gs-location-manual" class="location-manual"${manual ? "" : " hidden"}>
					<div class="field">
						<label for="gs-city">Search for a city</label>
						<div class="search-row">
							<input type="text" id="gs-city" placeholder="Regina">
							<button type="button" class="glass medium" id="gs-search">Search</button>
						</div>
						<div id="gs-results"></div>
					</div>
					<div class="field">
						<label for="gs-label">Place name</label>
						<input type="text" id="gs-label" value="${escapeHtml(settings.locationLabel || "")}" placeholder="Home">
					</div>
					<input type="hidden" id="gs-latitude" value="${settings.latitude === null || settings.latitude === undefined ? "" : escapeHtml(settings.latitude)}">
					<input type="hidden" id="gs-longitude" value="${settings.longitude === null || settings.longitude === undefined ? "" : escapeHtml(settings.longitude)}">
				</div>
			</div>

			<div class="buttons to-end">
				<span class="status" id="gs-location-status" aria-live="polite"></span>
				<button type="button" class="glass" data-next>Next</button>
			</div>
		</div>
	</section>`;
}

function updatesSheet() {
	return `
	<section class="gs-sheet" data-step="updates" hidden>
		<div class="segment">
			<h1>Updates</h1>
			<p class="lede" id="gs-updates-line"><span class="spinner" aria-hidden="true"></span>Checking for updates…</p>
			<div id="gs-major" hidden>
				<div class="major-doc" id="gs-major-doc" tabindex="0"></div>
				<p class="hint" id="gs-major-why" aria-live="polite"></p>
				<div class="buttons to-end">
					<button type="button" class="glass" id="gs-major-later">Not now</button>
					<button type="button" class="glass is-off" id="gs-major-upgrade" aria-disabled="true">Upgrade</button>
				</div>
			</div>
			<div class="buttons to-end" id="gs-updates-next" hidden>
				<button type="button" class="glass" id="gs-updates-again" hidden>Try again</button>
				<button type="button" class="glass" data-next>Next</button>
			</div>
		</div>
	</section>`;
}

// Background, Frosted glass and Font: the Appearance tab itself
// (admin-face.js appearancePane), with Next doing what its Save does.
// This makes the device's first appearance profile.
function lookSheet(pane) {
	return `
	<section class="gs-sheet gs-wide" data-step="look" hidden>
		<div class="segment gs-head">
			<h1>Your look</h1>
			<p class="lede">The background, the frosted glass and the font for OmniCore's own pages. Pick a picture or a colour first: the page shows it at once. This becomes your first appearance profile, and it can all be changed later in Settings, Appearance.</p>
		</div>
		<div class="home-bento">${pane.boxes}</div>
		<div class="buttons to-end">
			<span class="status" id="gs-look-status" aria-live="polite"></span>
			<button type="button" class="glass" data-next>Next</button>
		</div>
	</section>`;
}

// Modules from the Marketplace: what the dashboards are made of. The one
// step that can be skipped.
function modulesSheet() {
	return `
	<section class="gs-sheet" data-step="modules" hidden>
		<div class="segment">
			<h1>Modules</h1>
			<p class="lede">What your dashboards show: the weather, the time, your calendar and more. Install a few now; more can be added any time from Settings, Resources.</p>
			<div class="list tight" id="gs-modules"><p class="hint"><span class="spinner" aria-hidden="true"></span>Looking in the Marketplace…</p></div>
			<div class="buttons to-end">
				<span class="status" id="gs-modules-status" aria-live="polite"></span>
				<button type="button" class="glass" id="gs-modules-skip">Skip for now</button>
				<button type="button" class="glass" data-next id="gs-modules-next" hidden>Next</button>
			</div>
		</div>
	</section>`;
}

// The first dashboard: a name, a theme, and the modules on it
function dashboardSheet() {
	return `
	<section class="gs-sheet" data-step="first-dashboard" hidden>
		<div class="segment">
			<h1>Your first dashboard</h1>
			<p class="lede" id="gs-dash-line">A dashboard is a screen of widgets, for a wall display or any browser. Name it, pick its look, and choose what goes on it.</p>
			<div id="gs-dash-form">
				<div class="field">
					<label for="gs-dash-name">Name</label>
					<input type="text" id="gs-dash-name" maxlength="60">
				</div>
				<div class="field">
					<label for="gs-dash-theme">Theme</label>
					<select id="gs-dash-theme"></select>
				</div>
				<div class="field">
					<span class="label">On it</span>
					<div class="form-stack" id="gs-dash-modules"></div>
				</div>
			</div>
			<button type="button" class="glass" id="gs-dash-another" hidden>Make another one</button>
			<div class="buttons to-end">
				<span class="status" id="gs-dash-status" aria-live="polite"></span>
				<button type="button" class="glass" data-next>Next</button>
			</div>
		</div>
	</section>`;
}

function doneSheet() {
	return `
	<section class="gs-sheet gs-done" data-step="done" hidden>
		<p class="gs-done-word">Done!</p>
		<p class="lede">Enjoy!</p>
	</section>`;
}

const SHEETS = {
	welcome: () => welcomeSheet(),
	"admin-password": () => passwordSheet(),
	wifi: () => wifiSheet(),
	location: (settings, current) => locationSheet(settings, current),
	updates: () => updatesSheet(),
	look: (settings, current, pane) => lookSheet(pane),
	modules: () => modulesSheet(),
	"first-dashboard": () => dashboardSheet(),
	done: () => doneSheet()
};

// --- The page's script --------------------------------------------------------------

function pageScript(plan) {
	const { PLACE_SEARCH_SCRIPT } = require("./place-search-ui");
	return `
	(function () {
		var PLAN = ${JSON.stringify(plan)};
		var OWN_LOOK = ${JSON.stringify(ownLook(plan))};
		var at = 0;
		var moving = false;

		function sheet(id) { return document.querySelector('.gs-sheet[data-step="' + id + '"]'); }

		async function send(address, body) {
			var response = await fetch(address, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body || {})
			});
			var answer = await response.json().catch(function () { return {}; });
			if (!response.ok) throw new Error(answer.error || "That didn't work.");
			return answer;
		}

		function say(id, text, bad) {
			var line = document.getElementById(id);
			if (!line) return;
			line.textContent = text || "";
			line.className = "status" + (bad ? " bad" : "");
		}

		// What each step does when its sheet comes in, and before it moves
		// on (return false to stay). Steps with nothing to do have no entry.
		var STEPS = {};

		// The step's done: it's recorded, and the next sheet slides in,
		// pushing this one off like a sheet of paper
		async function next(options) {
			if (moving) return;
			var id = PLAN[at];
			var step = STEPS[id];
			moving = true;
			try {
				if (step && step.leave && (await step.leave()) === false) {
					moving = false;
					return;
				}
				await send(${JSON.stringify(STEP_PATH)}, { id: id, skipped: Boolean(options && options.skipped) });
			} catch (error) {
				moving = false;
				// Said on the step's own status line, when it has one
				var status = sheet(id).querySelector(".status");
				if (status) say(status.id, error.message, true);
				return;
			}

			// The Look step is drawn in the profile's own look, not the
			// device's: the page comes back in it, at that step
			if (PLAN[at + 1] === "look" && !OWN_LOOK) {
				if (window.omniGo) omniGo(location.href);
				else location.reload();
				return;
			}

			var from = sheet(id);
			at += 1;
			var to = sheet(PLAN[at]);
			from.classList.add("leaving");
			to.hidden = false;
			to.classList.add("arriving");
			setTimeout(function () {
				from.hidden = true;
				from.classList.remove("leaving");
				to.classList.remove("arriving");
				moving = false;
				var first = to.querySelector("input:not([type=hidden]), button");
				if (first && first.focus) first.focus({ preventScroll: true });
			}, 600);
			if (STEPS[PLAN[at]] && STEPS[PLAN[at]].show) STEPS[PLAN[at]].show();
		}

		document.querySelectorAll("[data-next]").forEach(function (button) {
			button.addEventListener("click", function () {
				button.disabled = true;
				next().finally(function () { button.disabled = false; });
			});
		});

		// Still here: the setup stays this device's while the page is open
		setInterval(function () {
			fetch(${JSON.stringify(ALIVE_PATH)}, { method: "POST" }).catch(function () {});
		}, 60 * 1000);

		// --- Admin password ------------------------------------------------
		STEPS["admin-password"] = {
			leave: async function () {
				var one = document.getElementById("gs-password").value;
				var two = document.getElementById("gs-password-again").value;
				if (one.length < 8) { say("gs-password-status", "At least 8 characters.", true); return false; }
				if (one !== two) { say("gs-password-status", "The two don't match.", true); return false; }
				try {
					await send("/getting-started/password", { password: one });
				} catch (error) {
					say("gs-password-status", error.message, true);
					return false;
				}
			}
		};

		// --- Wi-Fi -------------------------------------------------------------
		STEPS.wifi = {
			show: async function () {
				var value = document.getElementById("gs-wifi-value");
				var note = document.getElementById("gs-wifi-note");
				try {
					var answer = await (await fetch("/getting-started/wifi")).json();
					value.textContent = answer.line;
					note.textContent = answer.note || "";
				} catch (error) {
					value.textContent = "OmniCore couldn't look at its connection.";
				}
			}
		};

		// --- Location ------------------------------------------------------------
		(function () {
			var on = document.getElementById("gs-location-on");
			if (!on) return;
			var detail = document.getElementById("gs-location-detail");
			var manual = document.getElementById("gs-location-manual");
			var mode = document.querySelector("#gs-location-tabs .tab-btn.active").dataset.value;

			on.addEventListener("change", function () { detail.hidden = !on.checked; });
			document.querySelectorAll("#gs-location-tabs .tab-btn").forEach(function (tab) {
				tab.addEventListener("click", function () {
					tab.parentElement.querySelectorAll(".tab-btn").forEach(function (each) { each.classList.remove("active"); });
					tab.classList.add("active");
					mode = tab.dataset.value;
					manual.hidden = mode !== "manual";
					if (mode === "manual") document.getElementById("gs-city").focus();
				});
			});

			${PLACE_SEARCH_SCRIPT}

			function search() {
				return findPlaces(document.getElementById("gs-city").value, document.getElementById("gs-results"), function (place) {
					document.getElementById("gs-latitude").value = place.latitude;
					document.getElementById("gs-longitude").value = place.longitude;
					document.getElementById("gs-label").value = place.label;
					document.getElementById("gs-location-value").textContent = place.label;
				});
			}
			document.getElementById("gs-search").addEventListener("click", search);
			document.getElementById("gs-city").addEventListener("keydown", function (event) {
				if (event.key === "Enter") { event.preventDefault(); search(); }
			});

			STEPS.location = {
				leave: async function () {
					var latitude = document.getElementById("gs-latitude").value;
					if (on.checked && mode === "manual" && latitude === "") {
						say("gs-location-status", "Search for a city and pick one first.", true);
						return false;
					}
					try {
						await send("/getting-started/location", {
							locationEnabled: on.checked,
							locationMode: mode,
							locationLabel: document.getElementById("gs-label").value,
							latitude: latitude,
							longitude: document.getElementById("gs-longitude").value
						});
					} catch (error) {
						say("gs-location-status", error.message, true);
						return false;
					}
				}
			};
		})();

		// --- Updates -----------------------------------------------------------------
		(function () {
			var line = document.getElementById("gs-updates-line");
			if (!line) return;
			var nextRow = document.getElementById("gs-updates-next");
			var again = document.getElementById("gs-updates-again");
			var major = document.getElementById("gs-major");
			var doc = document.getElementById("gs-major-doc");
			var upgrade = document.getElementById("gs-major-upgrade");
			var why = document.getElementById("gs-major-why");
			var offered = null;
			var read = false;
			var offReason = "";

			function busy(text) {
				line.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
				line.appendChild(document.createTextNode(text));
				nextRow.hidden = true;
				major.hidden = true;
			}
			function settled(text, canTryAgain) {
				line.textContent = text;
				nextRow.hidden = false;
				again.hidden = !canTryAgain;
			}

			// OmniCore is restarting into the new version: wait until it
			// answers again, then carry on from the datasheet
			function waitForRestart() {
				busy("OmniCore is restarting into the new version…");
				var tries = 0;
				var timer = setInterval(async function () {
					tries += 1;
					try {
						var response = await fetch("/getting-started", { cache: "no-store" });
						if (response.ok && tries > 2) {
							clearInterval(timer);
							location.reload();
						}
					} catch (error) {
						// Still restarting
					}
				}, 3000);
			}

			function follow() {
				var timer = setInterval(async function () {
					try {
						var progress = await (await fetch("/getting-started/updates/progress", { cache: "no-store" })).json();
						if (progress.phase === "failed") {
							clearInterval(timer);
							settled("The update couldn't be installed: " + (progress.error || "something went wrong") + ". You can carry on, and try again later in Settings.", true);
						} else if (progress.phase === "switching") {
							clearInterval(timer);
							waitForRestart();
						} else if (!progress.busy && progress.phase === "idle") {
							clearInterval(timer);
							settled(progress.note || "OmniCore is up to date.", false);
						} else {
							busy((progress.target ? "Installing " + progress.target : "Installing the update") + "…");
						}
					} catch (error) {
						clearInterval(timer);
						waitForRestart();
					}
				}, 1500);
			}

			function refresh() {
				var reason = !read ? "Scroll to the end to read it all first." : offReason;
				upgrade.setAttribute("aria-disabled", reason ? "true" : "false");
				upgrade.classList.toggle("is-off", Boolean(reason));
				why.textContent = reason || "";
			}
			doc.addEventListener("scroll", function () {
				if (doc.scrollHeight - doc.scrollTop - doc.clientHeight <= 4) { read = true; refresh(); }
			}, { passive: true });

			async function offerMajor(version) {
				offered = version;
				line.textContent = "OmniCore " + version + " is out. Read what's changing, then upgrade or carry on with the version you have.";
				try {
					var answer = await (await fetch("/getting-started/updates/major", { cache: "no-store" })).json();
					doc.innerHTML = answer.html || "";
					offReason = answer.offReason || "";
				} catch (error) {
					doc.textContent = "What's changing couldn't be loaded.";
					offReason = "It can't be upgraded to before it's been read.";
				}
				major.hidden = false;
				read = false;
				refresh();
				requestAnimationFrame(function () {
					if (doc.scrollHeight - doc.clientHeight <= 4) { read = true; refresh(); }
				});
			}

			upgrade.addEventListener("click", async function () {
				if (upgrade.getAttribute("aria-disabled") === "true") return;
				try {
					await send("/getting-started/updates/major/apply", { version: offered });
					busy("Starting the upgrade to " + offered + "…");
					follow();
				} catch (error) {
					offReason = error.message;
					refresh();
				}
			});
			document.getElementById("gs-major-later").addEventListener("click", function () {
				major.hidden = true;
				settled("OmniCore " + offered + " can be installed later, from Settings.", false);
			});

			async function check() {
				busy("Checking for updates…");
				try {
					var answer = await send("/getting-started/updates/check");
					if (answer.installing) {
						busy("Installing " + answer.latestVersion + "…");
						follow();
					} else if (answer.nextMajor) {
						nextRow.hidden = false;
						again.hidden = true;
						await offerMajor(answer.nextMajor);
						nextRow.hidden = true;
					} else {
						settled(answer.line, false);
					}
				} catch (error) {
					settled("OmniCore couldn't check for updates: " + error.message, true);
				}
			}
			again.addEventListener("click", check);

			STEPS.updates = { show: check };
		})();

		// --- Your look -----------------------------------------------------------------
		// The Appearance tab's own script runs it all; Next saves what
		// isn't saved, exactly as its Save would
		if (window.omniAppearanceSave) {
			STEPS.look = {
				leave: async function () {
					var kept = await window.omniAppearanceSave();
					if (!kept) say("gs-look-status", "It couldn't be saved. Try again.", true);
					return kept ? undefined : false;
				}
			};
		}

		// --- Modules -------------------------------------------------------------------
		(function () {
			var list = document.getElementById("gs-modules");
			if (!list) return;
			var nextButton = document.getElementById("gs-modules-next");
			var skip = document.getElementById("gs-modules-skip");

			function row(entry) {
				var item = document.createElement("div");
				item.className = "item";
				var text = document.createElement("div");
				text.className = "item-text";
				var name = document.createElement("span");
				name.textContent = entry.name;
				var sub = document.createElement("span");
				sub.className = "item-sub";
				sub.textContent = entry.description || "";
				text.appendChild(name);
				text.appendChild(sub);
				item.appendChild(text);

				var actions = document.createElement("div");
				actions.className = "item-actions";
				var button = document.createElement("button");
				button.type = "button";
				button.className = "glass small";
				function installed() {
					button.textContent = "Installed";
					button.disabled = true;
					item.classList.add("current");
					nextButton.hidden = false;
				}
				if (entry.installed) installed();
				else button.textContent = "Install";
				button.addEventListener("click", async function () {
					button.disabled = true;
					button.textContent = "Installing…";
					try {
						await send("/getting-started/modules/install", { id: entry.id });
						installed();
					} catch (error) {
						button.disabled = false;
						button.textContent = "Install";
						say("gs-modules-status", error.message, true);
					}
				});
				actions.appendChild(button);
				item.appendChild(actions);
				return item;
			}

			skip.addEventListener("click", function () {
				skip.disabled = true;
				next({ skipped: true }).finally(function () { skip.disabled = false; });
			});

			STEPS.modules = {
				show: async function () {
					try {
						var response = await fetch("/getting-started/modules", { cache: "no-store" });
						var answer = await response.json();
						if (!response.ok) throw new Error(answer.error || "The Marketplace couldn't be reached.");
						list.replaceChildren();
						for (var i = 0; i < answer.modules.length; i++) list.appendChild(row(answer.modules[i]));
						if (!answer.modules.length) list.innerHTML = '<p class="hint">The Marketplace has nothing to offer right now.</p>';
					} catch (error) {
						list.innerHTML = "";
						var line = document.createElement("p");
						line.className = "hint";
						line.textContent = error.message + " You can skip this for now and install modules later from Settings, Resources.";
						list.appendChild(line);
					}
				}
			};
		})();

		// --- First dashboard -----------------------------------------------------------
		(function () {
			var form = document.getElementById("gs-dash-form");
			if (!form) return;
			var another = document.getElementById("gs-dash-another");
			var making = true;

			another.addEventListener("click", function () {
				form.hidden = false;
				another.hidden = true;
				making = true;
			});

			STEPS["first-dashboard"] = {
				show: async function () {
					try {
						var parts = await (await fetch("/getting-started/dashboard", { cache: "no-store" })).json();
						document.getElementById("gs-dash-name").value = parts.nextName || "";
						var theme = document.getElementById("gs-dash-theme");
						theme.replaceChildren();
						parts.themes.forEach(function (each) {
							var option = document.createElement("option");
							option.value = each.id;
							option.textContent = each.name;
							theme.appendChild(option);
						});
						var modules = document.getElementById("gs-dash-modules");
						modules.replaceChildren();
						parts.modules.forEach(function (each) {
							var label = document.createElement("label");
							label.className = "option";
							var box = document.createElement("input");
							box.type = "checkbox";
							box.value = each.id;
							box.checked = true;
							var name = document.createElement("span");
							name.textContent = each.name;
							label.appendChild(box);
							label.appendChild(name);
							modules.appendChild(label);
						});
						if (!parts.modules.length) modules.innerHTML = '<p class="hint">No modules are installed yet: the dashboard starts empty, and widgets can be added later in Settings, Manage Faces.</p>';
						// An install that already has dashboards needn't make one
						if (parts.existing > 0) {
							document.getElementById("gs-dash-line").textContent =
								"You already have " + parts.existing + (parts.existing === 1 ? " dashboard" : " dashboards") + ". Carry on, or make another one now.";
							form.hidden = true;
							another.hidden = false;
							making = false;
						}
					} catch (error) {
						say("gs-dash-status", "What's installed couldn't be read.", true);
					}
				},
				leave: async function () {
					if (!making) return;
					var name = document.getElementById("gs-dash-name").value.trim();
					if (!name) { say("gs-dash-status", "Give it a name first.", true); return false; }
					var chosen = Array.prototype.map.call(document.querySelectorAll("#gs-dash-modules input:checked"), function (box) { return box.value; });
					try {
						await send("/getting-started/dashboard", {
							name: name,
							theme: document.getElementById("gs-dash-theme").value,
							modules: chosen
						});
					} catch (error) {
						say("gs-dash-status", error.message, true);
						return false;
					}
				}
			};
		})();

		// --- Done ----------------------------------------------------------------------
		STEPS.done = {
			show: function () {
				// Recorded at once (there's no Next), then on to Settings
				send(${JSON.stringify(STEP_PATH)}, { id: "done" }).catch(function () {});
				setTimeout(function () { omniGo(faceUrl(3000)); }, 3200);
			}
		};

		// The first sheet, and whatever it does when it comes in
		sheet(PLAN[0]).hidden = false;
		if (STEPS[PLAN[0]] && STEPS[PLAN[0]].show) STEPS[PLAN[0]].show();
	})();`;
}

// --- The routes ----------------------------------------------------------------------

function attach(app, options) {
	const createDashboard = options && options.createDashboard;

	// Only while Getting Started has something left to do
	function stillOn(res) {
		if (gettingStarted.needed()) return true;
		res.status(409).json({ error: "OmniCore is already set up." });
		return false;
	}

	// The Look step's routes: the Appearance tab's own, under
	// /getting-started, for the device doing the setup while there's a step
	// left (the gate lets nobody else through)
	require("./admin-face").attachAppearanceRoutes(app, "/getting-started", (req, res, next) => {
		if (stillOn(res)) next();
	});

	// --- Modules: what the Marketplace offers, and installing one
	app.get("/getting-started/modules", async (req, res) => {
		if (!stillOn(res)) return;
		res.setHeader("Cache-Control", "no-store");
		try {
			const available = await require("./marketplace").listAvailable();
			res.json({
				modules: available.modules.map((entry) => ({
					id: entry.id,
					name: entry.name || entry.id,
					description: entry.description || "",
					installed: Boolean(entry.installed)
				}))
			});
		} catch (error) {
			res.status(502).json({ error: "The Marketplace couldn't be reached." });
		}
	});

	app.post("/getting-started/modules/install", async (req, res) => {
		if (!stillOn(res)) return;
		try {
			await require("./marketplace").installEntry("module", String((req.body || {}).id || ""), false);
			res.json({ ok: true });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	// --- First dashboard: what it can be made of, and making it
	app.get("/getting-started/dashboard", (req, res) => {
		if (!stillOn(res)) return;
		res.setHeader("Cache-Control", "no-store");
		const faceStore = require("./face-store");
		const themeLoader = require("./theme-loader");
		const { listModules } = require("./module-loader");
		const { readManifest } = require("./module-config");
		res.json({
			existing: faceStore.readFaces().length,
			nextName: faceStore.defaultFaceName(faceStore.nextDashboardPort()),
			themes: themeLoader.listThemes().map((theme) => ({ id: theme.id, name: theme.name || theme.id })),
			modules: listModules().map((id) => ({ id, name: readManifest(id).name || id }))
		});
	});

	app.post("/getting-started/dashboard", async (req, res) => {
		if (!stillOn(res)) return;
		if (!createDashboard) {
			res.status(500).json({ error: "Dashboards can't be made from here." });
			return;
		}
		const body = req.body || {};
		const theme = String(body.theme || "");
		const themeLoader = require("./theme-loader");
		const { listModules } = require("./module-loader");
		const { readManifest, applyDefaults } = require("./module-config");
		if (!themeLoader.listThemes().some((each) => each.id === theme)) {
			res.status(400).json({ error: "Pick a theme." });
			return;
		}
		const installed = listModules();
		const wanted = (Array.isArray(body.modules) ? body.modules : []).map(String).filter((id) => installed.includes(id));

		// Each module as Create Dashboard would add it with nothing changed:
		// its own defaults, and the theme's for a module with a tile or
		// one that works behind the scenes
		const face = await createDashboard({
			name: String(body.name || "").trim().slice(0, 60),
			title: String(body.name || "").trim().slice(0, 60),
			theme,
			instances: wanted.map((id) => {
				const tile = readManifest(id).tile !== false;
				return {
					module: id,
					label: "",
					config: applyDefaults(id, {}),
					themeConfig: themeLoader.instanceDefaults(theme, tile)
				};
			}),
			themeConfig: themeLoader.applyDefaults(theme, {})
		});
		if (face.error) {
			res.status(400).json(face);
			return;
		}
		res.json({ ok: true, id: face.id });
	});

	app.get("/getting-started", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");

		// Nothing left: on to Settings
		if (!gettingStarted.needed()) {
			res.send(
				gettingStarted.plainPage(
					"Getting Started",
					'<p class="lede">OmniCore is set up. Taking you to Settings…</p>',
					"location.replace(faceUrl(3000));"
				)
			);
			return;
		}

		const plan = gettingStarted.plan();
		const settings = readSettings();
		const current = plan.includes("location") ? await getLocation().catch(() => null) : null;

		// The Look step: the Appearance tab itself, its routes under
		// /getting-started (attached below)
		const pane = plan.includes("look")
			? require("./admin-face").appearancePane(settings, require("./font-service").installedFont(), {
					base: "/getting-started",
					inWizard: true
			  })
			: null;
		const sheets = plan.map((id) => (SHEETS[id] ? SHEETS[id](settings, current, pane) : "")).join("");

		// Drawn in the device's own dark or light until there's a look of
		// the user's own: once the Look step has changed the profile (or
		// it's an install's own from before, with its picture), the page is
		// drawn in it, the picture behind it and all
		const own = ownLook(plan);

		const { uiStyles, styleTag, PASSWORD_TOGGLE_SCRIPT } = require("./ui-theme");
		const { pageStart } = require("./page-motion");
		const { ICON_LINK } = require("./icon");
		const { portLinkScript } = require("./face-links");

		res.send(`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="color-scheme" content="dark light">
	<title>Getting Started</title>
	${ICON_LINK}
	${styleTag(uiStyles(own ? {} : { device: true }))}
</head>
<body class="getting-started">
${pageStart(own ? {} : { plain: true })}
	<main class="gs-stage">${sheets}</main>
	${pane ? pane.modals : ""}
	<script>${portLinkScript}${PASSWORD_TOGGLE_SCRIPT}${pane ? MODAL_SCRIPT + pane.script : ""}${pageScript(plan)}</script>
</body>
</html>`);
	});

	// A step done (or skipped, for the one that can be)
	app.post(STEP_PATH, (req, res) => {
		const body = req.body || {};
		// Done comes after the last real step, when there's nothing left to
		// do: it's still recorded (it clears Welcome and lets the device go)
		if (body.id !== "done" && !stillOn(res)) return;
		const step = gettingStarted.stepById(String(body.id || ""));
		if (!step) {
			res.status(400).json({ error: "There's no such step." });
			return;
		}
		// A step OmniCore checks for itself is only done when it is
		if (step.check && !step.check()) {
			res.status(409).json({ error: "This step isn't done yet." });
			return;
		}
		try {
			gettingStarted.record(step.id, { skipped: Boolean(body.skipped) });
			res.json({ ok: true });
		} catch (error) {
			res.status(400).json({ error: error.message });
		}
	});

	app.post(ALIVE_PATH, (req, res) => {
		gettingStarted.touch(req);
		res.json({ ok: true });
	});

	// The admin password, made once; the device making it is signed in
	app.post("/getting-started/password", (req, res) => {
		if (!stillOn(res)) return;
		const result = auth.createAdmin((req.body || {}).password);
		if (result.error) {
			res.status(400).json(result);
			return;
		}
		auth.setSessionCookie(res, auth.createSession());
		res.json({ ok: true });
	});

	// How OmniCore is connected, in words
	app.get("/getting-started/wifi", async (req, res) => {
		if (!stillOn(res)) return;
		res.setHeader("Cache-Control", "no-store");
		let now = null;
		try {
			now = await require("./network-page").now();
		} catch (error) {
			now = null;
		}
		res.json(wifiWords(now));
	});

	app.post("/getting-started/location", (req, res) => {
		if (!stillOn(res)) return;
		writeSettings(locationFromBody(req.body));
		res.json({ ok: true });
	});

	// --- Updates: the same as Settings' About tab, from here
	app.post("/getting-started/updates/check", async (req, res) => {
		if (!stillOn(res)) return;
		const coreUpdater = require("./core-updater");
		const updateStore = require("./update-store");
		try {
			const status = await coreUpdater.checkForUpdate();
			if (!status) {
				updateStore.recordCheck({ updateAvailable: false });
				res.json({ line: "This is a development build, which doesn't update itself." });
				return;
			}
			updateStore.recordCheck({
				latestVersion: status.latestVersion,
				updateAvailable: status.updateAvailable,
				nextMajor: status.nextMajor
			});

			if (status.updateAvailable) {
				const readiness = await coreUpdater.applyReadiness();
				if (!readiness.ready) {
					res.json({ line: `OmniCore ${status.latestVersion} is out, but it can't be installed from here. ${readiness.reason}` });
					return;
				}
				if (!coreUpdater.currentProgress().busy) {
					coreUpdater.applyUpdate(status.latestVersion).catch((error) => {
						console.log(`  Core update from Getting Started failed: ${error.message}`);
					});
				}
				res.json({ installing: true, latestVersion: status.latestVersion });
				return;
			}

			if (status.nextMajor) {
				res.json({ nextMajor: status.nextMajor });
				return;
			}

			res.json({ line: `OmniCore ${status.currentVersion} is the newest. You're up to date.` });
		} catch (error) {
			updateStore.recordCheck({ error: error.message });
			res.status(502).json({ error: error.message });
		}
	});

	app.get("/getting-started/updates/progress", (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(require("./core-updater").currentProgress());
	});

	app.get("/getting-started/updates/major", async (req, res) => {
		if (!stillOn(res)) return;
		const offer = await require("./major-offer").build();
		res.setHeader("Cache-Control", "no-store");
		res.status(offer.status).json(offer.body);
	});

	app.post("/getting-started/updates/major/apply", async (req, res) => {
		if (!stillOn(res)) return;
		const started = await require("./major-offer").start((req.body || {}).version);
		res.status(started.status).json(started.body);
	});
}

// The steps drawn in the device's own dark or light; from the Look step
// on, the page is drawn in the appearance profile (the black one OmniCore
// made at its first start, until a background is picked; an install's
// own from before, with its picture), since that's what the Look step
// changes and shows. Arriving at the Look step reloads the page into it.
const BEFORE_LOOK = ["welcome", "admin-password", "wifi", "location", "updates"];

function ownLook(plan) {
	return !plan.some((id) => BEFORE_LOOK.includes(id));
}

// The pop-ups the Look step's Appearance tab opens (Change background,
// Choose a font): open, close, and closing on the dimmed area or Escape,
// the same as on Settings
const MODAL_SCRIPT = `
	function openModal(id) { document.getElementById(id).hidden = false; }
	function closeModal(id) { document.getElementById(id).hidden = true; }
	document.querySelectorAll("[data-close]").forEach(function (button) {
		button.addEventListener("click", function () { closeModal(button.dataset.close); });
	});
	document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
		backdrop.addEventListener("click", function (event) {
			if (event.target === backdrop) backdrop.hidden = true;
		});
	});
	document.addEventListener("keydown", function (event) {
		if (event.key === "Escape") {
			document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) { backdrop.hidden = true; });
		}
	});
`;

// The Wi-Fi step's words, from the Network page's look at the Wi-Fi
// (network-page.js now()): { line, note }
function wifiWords(now) {
	const later = "You can change the network any time in Settings, Network.";
	if (!now || !now.available) {
		return {
			line: "OmniCore is online.",
			note: (now && now.message ? now.message + " " : "") + "Its network is looked after by the system it runs on."
		};
	}
	if (now.card && now.card.connected) {
		const bars = Number(now.card.bars) || 0;
		const strength = bars >= 3 ? "a strong signal" : bars === 2 ? "a fair signal" : "a weak signal";
		return { line: `Connected to ${now.card.ssid}, with ${strength}.`, note: later };
	}
	if (now.cable) return { line: "Connected by cable.", note: later };
	return { line: "OmniCore is online.", note: later };
}

module.exports = { attach, wifiWords, ownLook, SHEETS, STEP_PATH, ALIVE_PATH };
