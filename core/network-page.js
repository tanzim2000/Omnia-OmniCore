// core/network-page.js
// The Network page (since 2.0.0): Settings, Resources tab, Network. The
// server's Wi-Fi on a normal day, when nothing has gone wrong.
//
// WHAT IT SHOWS
//
//   Wi-Fi             the network the server is on, its signal, band,
//                     address and link speed, the card, who looks after
//                     the Wi-Fi, and whether the internet works
//   Known networks    the networks the server already has a password
//                     for, each with Edit (password and security, "Join by
//                     itself", Forget) and, when OmniCore has its password,
//                     Show password (after the admin password: the password
//                     and a QR code any phone camera reads)
//   Networks around   a fresh look around, to join another network, the
//                     same safe way Manual Setup does it (network-setup.js):
//                     if the new one doesn't reach the internet within a
//                     minute, everything is put back as it was
//
// OmniCore keeps the password of every network joined through it,
// encrypted (network-passwords.js), for Show password and the Guest Wi-Fi
// widget. The widget can also add a network around for guests: OmniCore
// joins it just long enough to check its password and comes back
// (a check, network-setup.js), and it becomes a known network that doesn't
// join automatically.
//
// WHEN OMNICORE CAN'T CHANGE THE WI-FI
//
// No Docker access, no Wi-Fi tools in the image, or a Wi-Fi OmniCore
// can't drive: then the Network box on the Resources tab isn't a button
// at all, just a box that says why (ability(), checkAbility()). The page,
// if opened anyway, is one box with the same words.
//
// WHO CAN USE IT
//
// It's on the admin face, after sign-in, like the rest of Settings. Its
// changes are POSTs sent as JSON, which a page on another port can't send
// (see the JSON check in admin-face.js). While the Wi-Fi is disconnected
// the takeover's own setup has the card, so changing it here waits.
//
// FOLLOWING A JOIN
//
// How a join is going comes down the admin face's network stream ("setup"
// events, network-status.js). Joining another network can cut off the
// phone or computer this page is open on: it's on the old network. So the
// last step is kept here too, and the page asks for it when its stream
// comes back (GET /network/join).
//
// WHAT IT NEVER DOES
//
// Print a password from the server's Wi-Fi settings. Reading the known
// networks prints only their names (wpa_supplicant's settings file is read
// for its ssid lines and nothing else; a test checks), and NetworkManager
// is asked for names only. The one password this page can show is one
// OmniCore saved itself, after the admin password is typed again, and
// five wrong tries in a quarter of an hour stop it for a while.

const path = require("path");

const networkHelper = require("./network-helper");
const networkStatus = require("./network-status");
const networkSetup = require("./network-setup");
const networkPasswords = require("./network-passwords");
const qr = require("./qr");
const auth = require("./admin-auth");
const { passwordField } = require("./ui-theme");

const fs = require("fs");

const PAGE_PATH = "/network";
const ABILITY_PATH = "/network/ability";
const NOW_PATH = "/network/now";
const KNOWN_PATH = "/network/known";
const AROUND_PATH = "/network/around";
const JOIN_PATH = "/network/join";
const FORGET_PATH = "/network/forget";
const EDIT_PATH = "/network/edit";
const PASSWORD_SHOW_PATH = "/network/show-password";
const CHECK_PATH = "/network/check";

// Show: how many wrong admin passwords in how long before it stops
// answering for a while
const SHOW_TRIES = 5;
const SHOW_WINDOW_MS = 15 * 60 * 1000;

// How long the last join's outcome is kept for a page that missed it
const LAST_STEP_KEPT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------
// The scripts the helper runs for it

// The networks in wpa_supplicant's settings file, one per line:
// "<who>|<join>|<name>", <who> being "omnicore" for one OmniCore added and
// "other" for the rest, <join> "auto" when it joins automatically and "manual"
// when it doesn't (disabled=1), and the name as the file has it (in quotes,
// in hex, or P"..."). Only those are ever printed: never a password.
const KNOWN_WPA = `
f="${networkHelper.HOST}$OMNI_CONF"
echo "@@ known"
[ -r "$f" ] || exit 0
awk '
	!inside && /^[[:space:]]*network[[:space:]]*=[[:space:]]*\\{/ { inside = 1; name = ""; off = 0; mine = (previous == "# Added by OmniCore"); next }
	inside && /^[[:space:]]*ssid[[:space:]]*=/ { name = $0; sub(/^[[:space:]]*ssid[[:space:]]*=[[:space:]]*/, "", name); sub(/[[:space:]]+$/, "", name); next }
	inside && /^[[:space:]]*disabled[[:space:]]*=[[:space:]]*1/ { off = 1; next }
	inside && /^[[:space:]]*}/ { if (name != "") print (mine ? "omnicore" : "other") "|" (off ? "manual" : "auto") "|" name; inside = 0; previous = ""; next }
	!inside { previous = $0 }
' "$f"
`;

// NetworkManager's Wi-Fi connections: "<uuid>|<join>|<name>" for each,
// <join> being "yes" when it joins automatically. Its own hotspots (mode
// ap, the setup hotspot among them) aren't networks to join.
const KNOWN_NM = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
nm() { timeout 15 chroot ${networkHelper.TOOLS} nmcli "$@" 2>/dev/null; }
echo "@@ known"
nm -t -f UUID,TYPE connection show | while IFS=: read -r uuid type; do
	[ "$type" = 802-11-wireless ] || continue
	[ "$(nm -g 802-11-wireless.mode connection show "$uuid")" = ap ] && continue
	echo "$uuid|$(nm -g connection.autoconnect connection show "$uuid")|$(nm -g 802-11-wireless.ssid connection show "$uuid")"
done
`;

// Forgetting a network in wpa_supplicant's settings file: the file without
// it (the same awk joining uses), then wpa_supplicant told to read it
// again. "nothing" if the file had no network by that name.
const FORGET_WPA = `
f="${networkHelper.HOST}$OMNI_CONF"
${networkSetup.FIND_PROCESS}
if [ ! -w "$f" ]; then echo "@@ result cant-write"; exit 0; fi
${networkSetup.DROP_NAMED} "$f" > "$f.omnicore-new" || { rm -f "$f.omnicore-new"; echo "@@ result cant-write"; exit 0; }
if cmp -s "$f" "$f.omnicore-new"; then rm -f "$f.omnicore-new"; echo "@@ result nothing"; exit 0; fi
chmod "$(stat -c %a "$f")" "$f.omnicore-new"
mv "$f.omnicore-new" "$f"
pid=$(find_process wpa_supplicant | head -n 1)
[ -n "$pid" ] && kill -HUP "$pid"
echo "@@ result forgotten"
`;

// Forgetting NetworkManager connections, by their ids ($OMNI_UUIDS)
const FORGET_NM = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
gone=0
for uuid in $OMNI_UUIDS; do
	timeout 30 chroot ${networkHelper.TOOLS} nmcli connection delete uuid "$uuid" >/dev/null 2>&1 && gone=1
done
[ "$gone" = 1 ] && echo "@@ result forgotten" || echo "@@ result nothing"
`;

// Editing a network in wpa_supplicant's settings file: its block replaced
// when there's a new password ($OMNI_BLOCK), then "Join automatically" set
// ($OMNI_MODE auto or manual, see network-setup.js's SET_FLAGS) and every
// other network tidied the same way. wpa_supplicant is told only with
// $OMNI_RELOAD=1 (never for the network the server is on: telling it makes
// it let go of the network for a moment). "nothing" if there's no network
// by that name.
const WPA_EDIT = `
H=${networkHelper.HOST}
f="$H$OMNI_CONF"
${networkSetup.FIND_PROCESS}
if [ ! -w "$f" ]; then echo "@@ result cant-write"; exit 0; fi
if ${networkSetup.DROP_NAMED} "$f" | cmp -s - "$f"; then echo "@@ result nothing"; exit 0; fi
if [ -n "$OMNI_BLOCK" ]; then
	${networkSetup.DROP_NAMED} "$f" > "$f.omnicore-new" || { rm -f "$f.omnicore-new"; echo "@@ result cant-write"; exit 0; }
	printf '\\n%s\\n' "$(echo "$OMNI_BLOCK" | base64 -d | sed "s/^\\([[:space:]]*priority=\\)${networkSetup.PRIORITY_MARK}\\$/\\1${networkSetup.AUTO_PRIORITY}/")" >> "$f.omnicore-new"
else
	cp -p "$f" "$f.omnicore-new" || { echo "@@ result cant-write"; exit 0; }
fi
${networkSetup.SET_FLAGS} "$f.omnicore-new" > "$f.omnicore-flags" || { rm -f "$f.omnicore-new" "$f.omnicore-flags"; echo "@@ result cant-write"; exit 0; }
rm -f "$f.omnicore-new"
chmod "$(stat -c %a "$f")" "$f.omnicore-flags"
mv "$f.omnicore-flags" "$f"
if [ "$OMNI_RELOAD" = 1 ]; then
	pid=$(find_process wpa_supplicant | head -n 1)
	[ -n "$pid" ] && kill -HUP "$pid"
fi
echo "@@ result changed"
`;

// Editing NetworkManager connections, by their ids ($OMNI_UUIDS): "Join by
// itself" ($OMNI_AUTO yes or no), and a new password ($OMNI_AUTH, $OMNI_KEY)
// when there is one. NetworkManager doesn't let go of a connection that's
// up when it's changed.
const NM_EDIT = `
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/host/run/dbus/system_bus_socket"
nm() { timeout 30 chroot ${networkHelper.TOOLS} nmcli "$@" 2>&1; }
done=0
for uuid in $OMNI_UUIDS; do
	nm connection modify uuid "$uuid" connection.autoconnect "$OMNI_AUTO" >/dev/null || continue
	case "$OMNI_AUTH" in
		psk) nm connection modify uuid "$uuid" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$OMNI_KEY" >/dev/null ;;
		sae) nm connection modify uuid "$uuid" wifi-sec.key-mgmt sae wifi-sec.psk "$OMNI_KEY" >/dev/null ;;
		open) nm connection modify uuid "$uuid" remove 802-11-wireless-security >/dev/null ;;
	esac
	done=1
done
[ "$done" = 1 ] && echo "@@ result changed" || echo "@@ result nothing"
`;

// ---------------------------------------------------------------------
// Reading what they printed

// A network's name as wpa_supplicant's file has it, as plain text:
// "Home" in quotes, 486f6d65 in hex, or P"..." with \n-style escapes
function readSsid(value) {
	const text = String(value || "");
	if (/^".*"$/.test(text)) return text.slice(1, -1);
	if (/^P".*"$/.test(text)) {
		// Byte by byte (\xc3\xa9 is one é in UTF-8), then read as UTF-8
		const bytes = [];
		const inner = text.slice(2, -1);
		for (let at = 0; at < inner.length; at++) {
			if (inner[at] !== "\\" || at === inner.length - 1) {
				bytes.push(...Buffer.from(inner[at], "utf-8"));
				continue;
			}
			const code = inner[++at];
			if (code === "x" && /^[0-9a-fA-F]{2}$/.test(inner.slice(at + 1, at + 3))) {
				bytes.push(parseInt(inner.slice(at + 1, at + 3), 16));
				at += 2;
			} else {
				bytes.push(...Buffer.from({ n: "\n", r: "\r", t: "\t", e: "\x1b" }[code] || code, "utf-8"));
			}
		}
		return Buffer.from(bytes).toString("utf-8");
	}
	if (/^([0-9a-fA-F]{2})+$/.test(text)) return Buffer.from(text, "hex").toString("utf-8");
	return text;
}

// nmcli's terse output: a backslash before a colon or a backslash
function readNmValue(value) {
	return String(value || "").replace(/\\([:\\])/g, "$1");
}

// What the known-networks script printed, as [{ ssid, mine, auto, ids }]:
// one entry per name, whichever way the server keeps them. `auto` is
// whether it joins automatically (true if any of its entries does).
function parseKnown(output, manager) {
	const lines = String(output || "").replace(/\r/g, "").split("\n");
	const start = lines.indexOf("@@ known");
	const byName = new Map();
	for (const line of start === -1 ? [] : lines.slice(start + 1)) {
		const first = line.indexOf("|");
		const second = first === -1 ? -1 : line.indexOf("|", first + 1);
		if (second === -1) continue;
		const who = line.slice(0, first);
		const join = line.slice(first + 1, second);
		const rest = line.slice(second + 1);
		let entry;
		if (manager === "networkmanager") {
			if (!/^[0-9a-fA-F-]{36}$/.test(who)) continue;
			entry = { ssid: readNmValue(rest), mine: false, auto: join !== "no", id: who.toLowerCase() };
		} else {
			if (who !== "omnicore" && who !== "other") continue;
			entry = { ssid: readSsid(rest), mine: who === "omnicore", auto: join !== "manual", id: null };
		}
		if (!entry.ssid) continue;
		const known = byName.get(entry.ssid) || { ssid: entry.ssid, mine: false, auto: false, ids: [] };
		known.mine = known.mine || entry.mine;
		known.auto = known.auto || entry.auto;
		if (entry.id) known.ids.push(entry.id);
		byName.set(entry.ssid, known);
	}
	return [...byName.values()];
}

function result(output) {
	const match = String(output).match(/@@ result (\S+)/);
	return match ? match[1] : null;
}

function bandOf(frequency) {
	if (!frequency) return null;
	return frequency >= 5900 ? "6 GHz" : frequency >= 4900 ? "5 GHz" : "2.4 GHz";
}

// ---------------------------------------------------------------------
// Doing it. `deps` is for the tests.

// The Wi-Fi as it is now, for the page's first box
async function now(deps = {}) {
	const probe = deps.probe || ((options) => networkHelper.probe(options));
	const found = await probe({ fresh: true });
	const state = networkStatus.state();
	const target = networkSetup.changeable(found);
	record(target);
	if (!found.available) {
		return { available: false, state, canChange: false, message: target.problem };
	}
	const card =
		found.wifi.find((wifi) => wifi.name === target.card) ||
		found.wifi.find((wifi) => wifi.connected) ||
		found.wifi[0] ||
		null;
	return {
		available: true,
		state,
		canChange: !target.problem,
		message: target.problem || null,
		manager: found.manager,
		cable: (found.wired || []).some((wired) => wired.cable),
		card: card
			? {
				name: card.name,
				connected: Boolean(card.connected),
				ssid: card.connected ? card.ssid : null,
				signal: card.connected ? card.signal : null,
				bars: card.connected ? card.bars : 0,
				band: card.connected ? bandOf(card.frequency) : null,
				bitrate: card.connected ? card.bitrate || null : null,
				address: card.address || null
			}
			: null
	};
}

// Whether OmniCore can change the Wi-Fi here, as last found out:
// { canChange, message }, or null while nobody knows yet. Only a lasting
// answer is kept (see changeable() in network-setup.js); a helper that
// failed once says nothing either way.
let verdict = null;

function record(target) {
	if (!target.problem) verdict = { canChange: true, message: null };
	else if (target.lasting) verdict = { canChange: false, message: target.problem };
}

// For drawing the Settings home at once, without waiting for the helper:
// what's plain from here (the tools in the image, Docker's socket), or
// what was last found out
function ability() {
	if (!networkHelper.hasTools()) return { canChange: false, message: networkSetup.changeable({ available: false, reason: "no-tools" }).problem };
	if (!fs.existsSync(process.env.OMNICORE_DOCKER_SOCKET || "/var/run/docker.sock")) {
		return { canChange: false, message: networkSetup.changeable({ available: false, reason: "no-docker" }).problem };
	}
	return verdict;
}

// Finding out (the helper's look, shared with anything else asking
// within 5 seconds)
async function checkAbility(deps = {}) {
	const quick = (deps.ability || ability)();
	if (quick && quick.canChange === false) return quick;
	const found = await (deps.probe || ((options) => networkHelper.probe(options)))({ fresh: false });
	record(networkSetup.changeable(found));
	return verdict || { canChange: null, message: null };
}

// The networks the server already knows
async function known(deps = {}) {
	const target = await (deps.target || (() => networkSetup.whatWeCanChange({ fresh: false })))();
	if (target.problem) return { available: false, message: target.problem };
	const run = deps.run || networkHelper.runOnHost;
	const isWpa = target.manager === "wpa_supplicant";
	const output = await run(isWpa ? KNOWN_WPA : KNOWN_NM, { env: isWpa ? { OMNI_CONF: target.config } : {}, timeoutMs: 40000 });
	// Which ones OmniCore has the password for (Show password), and of
	// what kind, so Edit starts on the right security
	const passwords = deps.passwords || networkPasswords;
	const saved = new Map(
		(typeof passwords.list === "function" ? passwords.list() : []).filter((n) => n.readable).map((n) => [n.ssid, n.auth])
	);
	const networks = parseKnown(output, target.manager)
		.map((network) => ({ ...network, saved: saved.has(network.ssid), savedAuth: saved.get(network.ssid) || null }))
		.sort((a, b) => a.ssid.localeCompare(b.ssid));
	return { available: true, manager: target.manager, networks };
}

// Edit a known network: "Join automatically" (`auto`), and a new password and
// security when `auth` is sent. Returns { saved: true }, or, for a new
// password on the network the server is on, { join } to try it like a
// join (put back if it doesn't work within a minute) and maybe `cleanup`
// to run once it has worked. `deps` is for the tests.
async function edit(body, deps = {}) {
	const ssid = body && body.ssid;
	if (typeof ssid !== "string" || !ssid.length || Buffer.byteLength(ssid, "utf-8") > 32) {
		throw Object.assign(new Error("Choose a network."), { status: 400 });
	}
	const auto = body.auto !== false;
	const changing = typeof body.auth === "string";
	const network = changing ? { ssid, auth: body.auth, password: body.auth === "open" ? "" : body.password } : null;
	if (network) {
		const problem = networkSetup.problemWith(network);
		if (problem) throw Object.assign(new Error(problem), { status: 400 });
	}

	const target = await (deps.target || (() => networkSetup.whatWeCanChange({ fresh: false })))();
	if (target.problem) throw Object.assign(new Error(target.problem), { status: 409 });
	const list = await known({ ...deps, target: async () => target });
	const entry = (list.networks || []).find((other) => other.ssid === ssid);
	if (!entry) throw Object.assign(new Error("The server doesn't know a network by that name."), { status: 404 });

	const current = await (deps.now || now)();
	const inUse = Boolean(current.card && current.card.connected && current.card.ssid === ssid);
	const run = deps.run || networkHelper.runOnHost;
	const isWpa = target.manager === "wpa_supplicant";

	// A new password for the network the server is on: tried like a join
	if (network && inUse) {
		const oldIds = entry.ids.filter((id) => /^[0-9a-f-]{36}$/.test(id));
		return {
			join: { ...network, auto },
			// NetworkManager: the join makes a connection of its own, so the
			// old ones for that name go once it works
			cleanup: !isWpa && oldIds.length ? () => run(FORGET_NM, { env: { OMNI_UUIDS: oldIds.join(" ") }, timeoutMs: 60000 }) : null
		};
	}

	let answer;
	if (isWpa) {
		answer = result(
			await run(WPA_EDIT, {
				env: {
					OMNI_CONF: target.config,
					OMNI_SSID_HEX: networkSetup.toHex(ssid),
					OMNI_SSID_QUOTED: /["\\\n]/.test(ssid) ? "" : `"${ssid}"`,
					OMNI_MODE: auto ? "auto" : "manual",
					OMNI_RELOAD: inUse ? "0" : "1",
					OMNI_BLOCK: network ? Buffer.from(networkSetup.wpaBlock(network)).toString("base64") : ""
				},
				writable: [path.posix.dirname(target.config)],
				timeoutMs: 40000
			})
		);
	} else {
		const ids = entry.ids.filter((id) => /^[0-9a-f-]{36}$/.test(id));
		answer = ids.length
			? result(
					await run(NM_EDIT, {
						env: {
							OMNI_UUIDS: ids.join(" "),
							OMNI_AUTO: auto ? "yes" : "no",
							OMNI_AUTH: network ? network.auth : "",
							OMNI_KEY:
								network && network.auth === "psk" && !/^[0-9a-fA-F]{64}$/.test(network.password)
									? networkSetup.wpaKey(network.password, ssid)
									: network
										? network.password
										: ""
						},
						timeoutMs: 60000
					})
				)
			: "nothing";
	}

	if (answer === "nothing") throw Object.assign(new Error("The server doesn't know a network by that name."), { status: 404 });
	if (answer !== "changed") throw Object.assign(new Error("OmniCore couldn't change the server's Wi-Fi settings."), { status: 500 });

	// The new password kept for Show password and the Guest Wi-Fi widget
	if (network) {
		try {
			(deps.passwords || networkPasswords).save(ssid, network.password, network.auth);
		} catch (error) {
			// The Wi-Fi is changed either way
		}
	}
	return { saved: true };
}

// Forget a network the server knows. Never the one it's on: that would
// cut it off, and the takeover would follow.
async function forget(ssid, deps = {}) {
	if (typeof ssid !== "string" || !ssid.length || Buffer.byteLength(ssid, "utf-8") > 32) {
		throw Object.assign(new Error("Choose a network."), { status: 400 });
	}
	const current = await (deps.now || now)();
	if (current.card && current.card.connected && current.card.ssid === ssid) {
		throw Object.assign(new Error("The server is on this network. Join another one first."), { status: 409 });
	}
	const target = await (deps.target || (() => networkSetup.whatWeCanChange({ fresh: false })))();
	if (target.problem) throw Object.assign(new Error(target.problem), { status: 409 });
	const run = deps.run || networkHelper.runOnHost;

	let answer;
	if (target.manager === "wpa_supplicant") {
		answer = result(
			await run(FORGET_WPA, {
				env: {
					OMNI_CONF: target.config,
					OMNI_SSID_HEX: networkSetup.toHex(ssid),
					OMNI_SSID_QUOTED: /["\\\n]/.test(ssid) ? "" : `"${ssid}"`
				},
				writable: [path.posix.dirname(target.config)],
				timeoutMs: 40000
			})
		);
	} else {
		const list = await known({ ...deps, target: async () => target });
		const entry = (list.networks || []).find((network) => network.ssid === ssid);
		const ids = entry ? entry.ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)) : [];
		answer = ids.length ? result(await run(FORGET_NM, { env: { OMNI_UUIDS: ids.join(" ") }, timeoutMs: 60000 })) : "nothing";
	}

	if (answer === "forgotten") {
		// Its saved password goes with it: a network you've told the
		// server to forget shouldn't stay on a guest's QR code
		try {
			(deps.passwords || networkPasswords).forget(ssid);
		} catch (error) {
			// The network is forgotten either way
		}
		return { forgotten: true };
	}
	if (answer === "nothing") throw Object.assign(new Error("The server doesn't know a network by that name."), { status: 404 });
	throw Object.assign(new Error("OmniCore couldn't change the server's Wi-Fi settings."), { status: 500 });
}

// The last join's latest step, for a page that missed it
let lastStep = null;

function remember(step) {
	lastStep = { ...step, at: Date.now() };
}

// Wrong admin passwords typed for Show, by when. Only the last quarter of
// an hour counts.
let wrongShows = [];

function showsLeft(now) {
	wrongShows = wrongShows.filter((at) => now - at < SHOW_WINDOW_MS);
	return SHOW_TRIES - wrongShows.length;
}

// A saved password, opened for the page, after the admin password. Returns
// { status, body }. `deps` is for the tests.
function showPassword(body, deps = {}) {
	const now = (deps.now || Date.now)();
	const passwords = deps.passwords || networkPasswords;
	const check = deps.verify || auth.verifyPassword;
	if (showsLeft(now) <= 0) {
		return { status: 429, body: { error: "Too many wrong passwords. Try again in a few minutes." } };
	}
	if (!check(body && body.adminPassword)) {
		wrongShows.push(now);
		return { status: 401, body: { error: "That isn't the admin password." } };
	}
	const saved = passwords.reveal(body && body.ssid);
	if (!saved) return { status: 404, body: { error: "There's no saved password for that network that OmniCore can open." } };
	// The password, and a QR code holding it that any phone camera reads
	// (drawn by Core from squares alone: safe to put in the page)
	return {
		status: 200,
		body: { ssid: saved.ssid, auth: saved.auth, password: saved.password, svg: qr.toSvg(networkPasswords.qrValue(saved)) }
	};
}

// For the tests: the wrong tries forgotten
function resetShows() {
	wrongShows = [];
}

// ---------------------------------------------------------------------
// The routes, on the admin face after sign-in. `page` is the admin face's
// page(), so the Network page looks like the rest of Settings.

// Why the Wi-Fi can't be changed from here right now, or null
function notNow() {
	if (networkStatus.state() === "disconnected") return "The Wi-Fi is disconnected: use the setup on the server's screen.";
	if (networkSetup.busy()) return "OmniCore is already joining a network.";
	return null;
}

function attach(app, { page }) {
	app.get(PAGE_PATH, (req, res) => {
		res.send(page("Network", PAGE_BODY, PAGE_SCRIPT, "", "/"));
	});

	// What the Network box on the Settings home asks once the page is open
	app.get(ABILITY_PATH, async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		try {
			res.json(await module.exports.checkAbility());
		} catch (error) {
			res.json({ canChange: null, message: null });
		}
	});

	app.get(NOW_PATH, async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		try {
			res.json(await module.exports.now());
		} catch (error) {
			res.json({ available: false, state: networkStatus.state(), message: "OmniCore couldn't look at the Wi-Fi. Try again." });
		}
	});

	app.get(KNOWN_PATH, async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		try {
			res.json(await module.exports.known());
		} catch (error) {
			res.json({ available: false, message: "OmniCore couldn't read the networks the server knows." });
		}
	});

	app.get(AROUND_PATH, async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const why = notNow();
		if (why) {
			res.status(409).json({ available: false, message: why });
			return;
		}
		try {
			res.json(await networkSetup.scan());
		} catch (error) {
			res.json({ available: false, message: "OmniCore couldn't look for networks. Try again." });
		}
	});

	app.get(JOIN_PATH, (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const fresh = lastStep && Date.now() - lastStep.at < LAST_STEP_KEPT_MS;
		res.json({ joining: networkSetup.busy(), last: fresh ? lastStep : null });
	});

	app.post(JOIN_PATH, async (req, res) => {
		const why = notNow();
		if (why) {
			res.status(409).json({ error: why });
			return;
		}
		const network = {
			ssid: req.body && req.body.ssid,
			password: req.body && req.body.password,
			auth: req.body && req.body.auth
		};
		const problem = networkSetup.problemWith(network);
		if (problem) {
			res.status(400).json({ error: problem });
			return;
		}
		// Started, and followed on the admin face's network stream
		res.status(202).json({ started: true });
		// Each step with the time it happened, so a page that hears it
		// twice (on the stream, then again after it lost the server) shows
		// it once
		const report = (step) => {
			remember(step);
			networkStatus.broadcastSetup(lastStep);
		};
		networkSetup.connect(network, report).catch((error) => {
			report({ phase: "failed", ssid: network.ssid, message: error.message });
		});
	});

	app.post(FORGET_PATH, async (req, res) => {
		const why = notNow();
		if (why) {
			res.status(409).json({ error: why });
			return;
		}
		try {
			res.json(await module.exports.forget(req.body && req.body.ssid));
		} catch (error) {
			res.status(error.status || 500).json({ error: error.message });
		}
	});

	// Edit a known network
	app.post(EDIT_PATH, async (req, res) => {
		const why = notNow();
		if (why) {
			res.status(409).json({ error: why });
			return;
		}
		let answer;
		try {
			answer = await module.exports.edit(req.body);
		} catch (error) {
			res.status(error.status || 500).json({ error: error.message });
			return;
		}
		if (!answer.join) {
			res.json(answer);
			return;
		}
		// A new password for the network the server is on: tried like a
		// join, and followed the same way
		res.status(202).json({ started: true });
		const report = (step) => {
			remember(step);
			networkStatus.broadcastSetup(lastStep);
		};
		networkSetup
			.connect(answer.join, report)
			.then((outcome) => (outcome && outcome.ok && answer.cleanup ? answer.cleanup() : null))
			.catch((error) => report({ phase: "failed", ssid: answer.join.ssid, message: error.message }));
	});

	// The Guest Wi-Fi widget's "Add a network around you": joined just long
	// enough to check its password, then back (a check, network-setup.js)
	app.post(CHECK_PATH, async (req, res) => {
		const why = notNow();
		if (why) {
			res.status(409).json({ error: why });
			return;
		}
		const network = {
			ssid: req.body && req.body.ssid,
			password: req.body && req.body.password,
			auth: req.body && req.body.auth,
			check: true
		};
		const problem = networkSetup.problemWith(network);
		if (problem) {
			res.status(400).json({ error: problem });
			return;
		}
		res.status(202).json({ started: true });
		const report = (step) => {
			remember(step);
			networkStatus.broadcastSetup(lastStep);
		};
		networkSetup.connect(network, report).catch((error) => {
			report({ phase: "failed", ssid: network.ssid, message: error.message });
		});
	});

	// One password, as text, after the admin password
	app.post(PASSWORD_SHOW_PATH, (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const answer = module.exports.showPassword(req.body);
		res.status(answer.status).json(answer.body);
	});
}

// ---------------------------------------------------------------------
// The page

const LOCK_SVG =
	'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

// The page's own look: only what the Default UI doesn't already have
const PAGE_CSS = `
	.net-now { display: flex; align-items: center; gap: 1em; margin: 0.25em 0 1em; }
	.net-now svg { flex-shrink: 0; }
	.net-now strong { display: block; font-size: 1.35em; font-weight: 600; overflow-wrap: anywhere; }
	.net-now span { color: var(--fg-muted); font-size: 0.95em; }
	.net-now .net-good { color: var(--success); }
	.net-now .net-bad { color: var(--danger); }
	.net-bars .dim { opacity: 0.25; }
	/* A network around: its signal, its name with a line under it (the
	   band, or why it can't be picked), and a lock if it has a password.
	   The line is under the name, not beside it, so a phone keeps room
	   for the name. */
	#net-around, #net-known { padding: 0.5em; gap: 2px; }
	/* Known networks gets the wider half: its rows have two buttons */
	@media (orientation: landscape) {
		#net-top.two { grid-template-columns: 1fr 1.25fr; }
	}
	.net-row { align-items: center; white-space: normal; }
	.net-row .net-name { display: flex; align-items: center; gap: 0.75em; min-width: 0; }
	.net-row .net-words { display: flex; flex-direction: column; min-width: 0; }
	.net-row .net-words > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.net-row .net-line { color: var(--fg-muted); font-size: 0.8em; }
	.net-row .net-here .net-line, .net-row.net-here .net-line { color: var(--success); }
	.net-row svg { flex-shrink: 0; }
	.net-row[aria-disabled="true"] { cursor: default; }
	.net-row[aria-disabled="true"]:not(.net-here) { opacity: 0.5; }
	.net-row .net-end { display: flex; align-items: center; flex-shrink: 0; color: var(--fg-muted); }
	/* A known network: its name with a line under it, and its buttons at
	   the end. On a phone the buttons go under the name. */
	.net-known { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5em 1em; padding: 0.55em 0.9em; }
	.net-known .net-words { display: flex; flex-direction: column; min-width: 0; flex: 1 1 9em; }
	.net-known .net-words > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.net-known .net-line { color: var(--fg-muted); font-size: 0.8em; }
	.net-known .net-line.net-good { color: var(--success); }
	.net-known .net-actions { display: flex; gap: 0.4em; flex-shrink: 0; }
	.net-known button { padding: 0.45em 0.9em; font-size: 0.85em; }
	/* The windows: Show password and Edit */
	.net-window { max-width: 26em; }
	.net-window .net-qr { width: min(14em, 65vw); margin: 0.25em auto 0.5em; }
	.net-window .net-qr svg { display: block; width: 100%; height: auto; border-radius: 0.5em; }
	.net-window .net-secret { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: center; font-size: 1.05em; user-select: all; overflow-wrap: anywhere; margin: 0 0 0.25em; }
	.net-window form { display: flex; flex-direction: column; gap: 0.55em; }
	.net-window .net-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
	.net-window select, .net-window input[type="password"], .net-window input[type="text"] { width: 100%; box-sizing: border-box; }
	.net-window .hint { margin: 0; }
	.net-window .net-forget { width: 100%; margin-top: 0.4em; }
	#net-join[hidden], #net-around[hidden] { display: none; }
	#net-join { display: flex; flex-direction: column; gap: 0.75em; margin-top: 0.5em; }
	#net-join .net-buttons { display: flex; gap: 0.6em; }
	.net-spin {
		display: inline-block;
		width: 0.9em;
		height: 0.9em;
		margin-right: 0.5em;
		vertical-align: -0.1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: net-spin 0.8s linear infinite;
	}
	@keyframes net-spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .net-spin { animation-duration: 2.4s; } }
`;

const PAGE_BODY = `
	<style>${PAGE_CSS}</style>
	<div class="settings-head">
		<h1>Network</h1>
	</div>
	<div class="bento">
		<div class="bento-row two top" id="net-top">
			<div class="segment">
				<h2>Wi&#8209;Fi</h2>
				<div id="net-now" aria-live="polite"><p class="status"><span class="net-spin" aria-hidden="true"></span>Looking at the Wi&#8209;Fi&hellip;</p></div>
			</div>
			<div class="segment" id="net-known-box">
				<h2>Known networks</h2>
				<p class="hint">Networks the server has the password for. It joins one automatically when it's around.</p>
				<div class="list" id="net-known" role="list"></div>
				<p class="status" id="net-known-status" role="status"></p>
			</div>
		</div>
		<div class="segment" id="net-around-box">
			<div class="box-head">
				<h2>Networks around</h2>
				<button type="button" class="glass" id="net-look" style="padding:0.55em 1em;font-size:0.85em" disabled>Look again</button>
			</div>
			<p class="hint">If a new network doesn't reach the internet within a minute, OmniCore goes back to the one it was on. A phone or computer on this network can lose the server while it switches.</p>
			<div class="list" id="net-around" role="list"></div>
			<form id="net-join" hidden autocomplete="off">
				<label for="net-password" id="net-join-label">Password</label>
				${passwordField('<input type="password" id="net-password" autocomplete="off" spellcheck="false" autocapitalize="off">')}
				<div class="net-buttons">
					<button type="submit" class="glass">Join</button>
					<button type="button" class="glass" id="net-cancel">Cancel</button>
				</div>
			</form>
			<p class="status" id="net-status" role="status" aria-live="polite"></p>
		</div>
	</div>`;

const PAGE_SCRIPT = `
(function () {
	var nowBox = document.getElementById("net-now");
	var knownList = document.getElementById("net-known");
	var knownStatus = document.getElementById("net-known-status");
	var aroundList = document.getElementById("net-around");
	var form = document.getElementById("net-join");
	var password = document.getElementById("net-password");
	var joinLabel = document.getElementById("net-join-label");
	var status = document.getElementById("net-status");
	var lookButton = document.getElementById("net-look");
	var LOCK = ${JSON.stringify(LOCK_SVG)};
	var current = null;
	var chosen = null;
	var joining = false;
	var lastSeenStep = 0;
	var lastNetworks = null;

	function bars(n, size) {
		var parts = [
			'<circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
			'<path d="M8.7 15.4a5 5 0 0 1 6.6 0"' + (n < 2 ? ' class="dim"' : "") + "/>",
			'<path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"' + (n < 3 ? ' class="dim"' : "") + "/>",
			'<path d="M2.5 9a14 14 0 0 1 19 0"' + (n < 4 ? ' class="dim"' : "") + "/>"
		];
		return '<svg class="net-bars" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + parts.join("") + "</svg>";
	}

	function text(tag, value, className) {
		var element = document.createElement(tag);
		if (className) element.className = className;
		element.textContent = value;
		return element;
	}

	function say(where, message, tone, spinning) {
		where.className = "status" + (tone ? " " + tone : "");
		where.innerHTML = spinning ? '<span class="net-spin" aria-hidden="true"></span>' : "";
		where.appendChild(document.createTextNode(message || ""));
	}

	function getJson(url) {
		return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); });
	}

	function postJson(url, body) {
		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}).then(function (r) {
			return r.json().then(function (answer) { return { ok: r.ok, status: r.status, answer: answer || {} }; });
		});
	}

	// --- The Wi-Fi now --------------------------------------------------

	function fact(label, value) {
		var row = document.createElement("div");
		row.className = "fact";
		row.appendChild(text("span", label));
		row.appendChild(text("span", value));
		return row;
	}

	function quality(signal) {
		if (signal === null || signal === undefined) return "";
		if (signal >= -55) return "Excellent";
		if (signal >= -67) return "Good";
		if (signal >= -75) return "Fair";
		return "Weak";
	}

	function showNow(found) {
		current = found;
		nowBox.innerHTML = "";
		if (!found || !found.available) {
			nowBox.appendChild(text("p", (found && found.message) || "OmniCore couldn't look at the Wi-Fi.", "status bad"));
			return;
		}
		var card = found.card;
		var head = document.createElement("div");
		head.className = "net-now";
		head.innerHTML = bars(card && card.connected ? card.bars : 0, 44);
		var words = document.createElement("div");
		words.appendChild(text("strong", card && card.connected ? card.ssid : "Not on a Wi-Fi network"));
		var line =
			found.state === "online" ? ["Connected, and online", "net-good"]
			: found.state === "no-internet" ? ["Connected, but no internet", "net-bad"]
			: card && card.connected ? ["Connected", ""]
			: found.cable ? ["On a cable", ""]
			: ["", ""];
		if (line[0]) words.appendChild(text("span", line[0], line[1]));
		head.appendChild(words);
		nowBox.appendChild(head);

		if (card) {
			if (card.connected) {
				if (card.signal !== null) nowBox.appendChild(fact("Signal", quality(card.signal) + " (" + card.signal + " dBm)"));
				if (card.band) nowBox.appendChild(fact("Band", card.band));
				if (card.bitrate) nowBox.appendChild(fact("Link speed", card.bitrate.replace("MBit/s", "Mbit/s")));
			}
			if (card.address) nowBox.appendChild(fact("Address", card.address));
			nowBox.appendChild(fact("Wi-Fi card", card.name));
		}
		var managers = { wpa_supplicant: "wpa_supplicant", networkmanager: "NetworkManager", iwd: "iwd", none: "Nothing", other: "Something else" };
		nowBox.appendChild(fact("Looked after by", managers[found.manager] || found.manager));
		if (found.message) nowBox.appendChild(text("p", found.message, "status bad"));
	}

	function lookNow() {
		return getJson(${JSON.stringify(NOW_PATH)})
			.then(showNow)
			.catch(function () { showNow({ available: false, message: "OmniCore couldn't look at the Wi-Fi. Try again." }); });
	}

	// --- Known networks -------------------------------------------------

	function showKnown(found) {
		knownList.innerHTML = "";
		say(knownStatus, "");
		if (!found || !found.available) {
			knownList.hidden = true;
			say(knownStatus, (found && found.message) || "", "bad");
			return;
		}
		knownList.hidden = false;
		if (!found.networks.length) {
			knownList.appendChild(text("div", "None yet.", "empty"));
			return;
		}
		found.networks.forEach(function (network) {
			var row = document.createElement("div");
			row.className = "net-known";
			row.setAttribute("role", "listitem");
			var inUse = Boolean(current && current.card && current.card.connected && current.card.ssid === network.ssid);
			var words = document.createElement("div");
			words.className = "net-words";
			words.appendChild(text("span", network.ssid));
			words.appendChild(
				inUse
					? text("span", "In use", "net-line net-good")
					: text("span", network.auto ? "Joins automatically" : "Doesn't join automatically", "net-line")
			);
			row.appendChild(words);

			var actions = document.createElement("div");
			actions.className = "net-actions";
			// Only when OmniCore has the password (it saw it when the
			// network was joined, or it was typed in Edit)
			if (network.saved) {
				var show = text("button", "Show password", "glass");
				show.type = "button";
				show.setAttribute("aria-label", "Show the password for " + network.ssid);
				show.addEventListener("click", function () { showPassword(network); });
				actions.appendChild(show);
			}
			var editButton = text("button", "Edit", "glass");
			editButton.type = "button";
			editButton.setAttribute("aria-label", "Edit " + network.ssid);
			editButton.addEventListener("click", function () { openEdit(network, inUse); });
			actions.appendChild(editButton);
			row.appendChild(actions);
			knownList.appendChild(row);
		});
	}

	function lookKnown() {
		return getJson(${JSON.stringify(KNOWN_PATH)})
			.then(showKnown)
			.catch(function () { showKnown({ available: false, message: "OmniCore couldn't read the networks the server knows." }); });
	}

	// A window over the page, in the Default UI's pop-up style. Escape, a
	// click outside it, or close() takes it away.
	function openWindow(title) {
		var backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		var panel = document.createElement("div");
		panel.className = "modal net-window";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");
		panel.setAttribute("aria-label", title);
		panel.appendChild(text("h2", title));
		backdrop.appendChild(panel);
		document.body.appendChild(backdrop);
		function onKey(event) {
			if (event.key === "Escape") close();
		}
		function close() {
			document.removeEventListener("keydown", onKey);
			backdrop.remove();
		}
		document.addEventListener("keydown", onKey);
		backdrop.addEventListener("click", function (event) {
			if (event.target === backdrop) close();
		});
		return { panel: panel, close: close };
	}

	function buttonRow(buttons) {
		var row = document.createElement("div");
		row.className = "dialog-buttons";
		buttons.forEach(function (button) { row.appendChild(button); });
		return row;
	}

	function button(label, className) {
		var element = text("button", label, "glass" + (className ? " " + className : ""));
		element.type = "button";
		return element;
	}

	// Show password: after the admin password, the password and a QR code
	// any phone camera can read to join
	async function showPassword(network) {
		var adminPassword = await askDialog({
			title: "Show the password for " + network.ssid + "?",
			text: "Type the admin password first.",
			secret: true,
			confirm: "Show"
		});
		if (!adminPassword) return;
		postJson(${JSON.stringify(PASSWORD_SHOW_PATH)}, { ssid: network.ssid, adminPassword: adminPassword })
			.then(function (reply) {
				if (!reply.ok) {
					say(knownStatus, reply.answer.error || "Couldn't show it.", "bad");
					return;
				}
				say(knownStatus, "");
				var w = openWindow(network.ssid);
				if (reply.answer.svg) {
					var code = document.createElement("div");
					code.className = "net-qr";
					// Core's own drawing of the code: squares only, never text
					code.innerHTML = reply.answer.svg;
					w.panel.appendChild(code);
				}
				w.panel.appendChild(
					reply.answer.auth === "open"
						? text("p", "No password", "net-secret")
						: text("p", reply.answer.password, "net-secret")
				);
				w.panel.appendChild(text("p", "Point a phone's camera at the code to join.", "hint"));
				var done = button("Close");
				done.addEventListener("click", w.close);
				w.panel.appendChild(buttonRow([done]));
				done.focus();
			})
			.catch(function () { say(knownStatus, "Couldn't show it. Try again.", "bad"); });
	}

	// Edit: "Join automatically", a new password and security, and Forget
	var PASSWORD_FIELD = ${JSON.stringify(passwordField('<input type="password" id="net-edit-password" autocomplete="off" spellcheck="false" autocapitalize="off">'))};

	function openEdit(network, inUse) {
		var w = openWindow("Edit " + network.ssid);
		var form = document.createElement("form");
		form.autocomplete = "off";

		var switchRow = document.createElement("div");
		switchRow.className = "net-switch-row";
		var autoLabel = text("label", "Join automatically");
		autoLabel.htmlFor = "net-edit-auto";
		var auto = document.createElement("input");
		auto.type = "checkbox";
		auto.id = "net-edit-auto";
		auto.setAttribute("role", "switch");
		auto.checked = Boolean(network.auto);
		switchRow.appendChild(autoLabel);
		switchRow.appendChild(auto);
		form.appendChild(switchRow);

		var securityLabel = text("label", "Security");
		securityLabel.htmlFor = "net-edit-auth";
		form.appendChild(securityLabel);
		var security = document.createElement("select");
		security.id = "net-edit-auth";
		[["psk", "WPA2 or WPA (a password)"], ["sae", "WPA3 only"], ["open", "None (no password)"]].forEach(function (choice) {
			var option = document.createElement("option");
			option.value = choice[0];
			option.textContent = choice[1];
			security.appendChild(option);
		});
		security.value = network.savedAuth || "psk";
		form.appendChild(security);

		var passwordLabel = text("label", "New password");
		passwordLabel.htmlFor = "net-edit-password";
		form.appendChild(passwordLabel);
		var passwordBox = document.createElement("div");
		passwordBox.innerHTML = PASSWORD_FIELD;
		form.appendChild(passwordBox);
		var newPassword = passwordBox.querySelector("input");
		form.appendChild(
			text(
				"p",
				inUse
					? "Leave it empty to keep the password. This is the network the server is on: a new password is tried first, and if it doesn't work within a minute, the old one comes back."
					: "Leave it empty to keep the password. Saving makes the Wi-Fi read its settings again, so the server may drop off its network for a few seconds.",
				"hint"
			)
		);
		function securityPicked() {
			// style rather than hidden: a label's own display rule would win
			var none = security.value === "open";
			passwordLabel.style.display = none ? "none" : "";
			passwordBox.style.display = none ? "none" : "";
		}
		security.addEventListener("change", securityPicked);
		securityPicked();

		var windowStatus = text("p", "", "status");
		windowStatus.setAttribute("role", "status");
		form.appendChild(windowStatus);

		var save = button("Save");
		save.type = "submit";
		var cancel = button("Cancel");
		cancel.addEventListener("click", w.close);
		form.appendChild(buttonRow([cancel, save]));

		// Forget: not the network the server is on
		var forgetButton = button("Forget this network", "glass-danger net-forget");
		if (inUse) {
			forgetButton.disabled = true;
			form.appendChild(forgetButton);
			form.appendChild(text("p", "The server is on this network. Join another one first to forget it.", "hint"));
		} else {
			forgetButton.addEventListener("click", function () {
				w.close();
				forgetNetwork(network.ssid);
			});
			form.appendChild(forgetButton);
		}

		form.addEventListener("submit", function (event) {
			event.preventDefault();
			var body = { ssid: network.ssid, auto: auto.checked };
			// A new password, or a change to an open network: the security
			// and password go too. Nothing typed: only "Join automatically".
			var changing = newPassword.value !== "" || (security.value === "open" && network.savedAuth !== "open");
			if (changing) {
				body.auth = security.value;
				body.password = security.value === "open" ? "" : newPassword.value;
			}
			save.disabled = true;
			say(windowStatus, "Saving\\u2026", "", true);
			postJson(${JSON.stringify(EDIT_PATH)}, body)
				.then(function (reply) {
					newPassword.value = "";
					if (reply.status === 202) {
						// Tried like a join: followed under Networks around
						w.close();
						return;
					}
					if (!reply.ok) {
						save.disabled = false;
						say(windowStatus, reply.answer.error || "Couldn't save it.", "bad");
						return;
					}
					w.close();
					lookKnown().then(function () { say(knownStatus, "Saved " + network.ssid + ".", "good"); });
				})
				.catch(function () {
					save.disabled = false;
					say(windowStatus, "Couldn't save it. Try again.", "bad");
				});
		});

		w.panel.appendChild(form);
		auto.focus();
	}

	async function forgetNetwork(ssid) {
		var sure = await confirmDialog({
			title: "Forget " + ssid + "?",
			text: "The server won't join it automatically any more, and OmniCore forgets its password too. To use it again, join it here with its password.",
			confirm: "Forget",
			danger: true
		});
		if (!sure) return;
		say(knownStatus, "Forgetting " + ssid + "\\u2026", "", true);
		postJson(${JSON.stringify(FORGET_PATH)}, { ssid: ssid })
			.then(function (reply) {
				if (!reply.ok) {
					say(knownStatus, reply.answer.error || "Couldn't forget it.", "bad");
					return;
				}
				lookKnown().then(function () { say(knownStatus, "Forgot " + ssid + ".", "good"); });
			})
			.catch(function () { say(knownStatus, "Couldn't forget it. Try again.", "bad"); });
	}

	// --- Networks around ------------------------------------------------

	// keepStatus: the list again after a join, under how it went
	function showAround(networks, keepStatus) {
		lastNetworks = networks;
		aroundList.innerHTML = "";
		aroundList.hidden = false;
		form.hidden = true;
		if (!networks.length) {
			say(status, "No networks found. Look again in a moment.");
			return;
		}
		networks.forEach(function (network) {
			var row = document.createElement("button");
			row.type = "button";
			row.className = "font-row net-row";
			row.setAttribute("role", "listitem");
			var can = network.auth !== "unsupported";
			var here = current && current.card && current.card.connected && current.card.ssid === network.ssid;
			var name = document.createElement("span");
			name.className = "net-name";
			name.innerHTML = bars(network.bars, 22);
			var words = document.createElement("span");
			words.className = "net-words";
			words.appendChild(text("span", network.ssid));
			var line = here ? "Connected" : !can ? "OmniCore can't join this kind of network yet" : network.band || "";
			if (line) words.appendChild(text("span", line, "net-line"));
			name.appendChild(words);
			row.appendChild(name);
			var end = document.createElement("span");
			end.className = "net-end";
			if (network.auth !== "open") end.innerHTML = LOCK;
			row.appendChild(end);
			if (here) row.classList.add("net-here");
			row.setAttribute(
				"aria-label",
				network.ssid + (here ? ", connected" : "") + (network.auth === "open" ? ", no password" : ", needs a password") + ", signal " + network.bars + " of 4"
			);
			if (!can || here) row.setAttribute("aria-disabled", "true");
			else row.addEventListener("click", function () { choose(network); });
			aroundList.appendChild(row);
		});
		if (!keepStatus) say(status, "");
	}

	// After a join: the Wi-Fi now, what it knows, and the list again with
	// the network it's on marked
	function refresh() {
		return lookNow().then(lookKnown).then(function () {
			if (lastNetworks) showAround(lastNetworks, true);
		});
	}

	function lookAround() {
		if (joining) return;
		lookButton.disabled = true;
		form.hidden = true;
		aroundList.hidden = true;
		say(status, "Looking for networks\\u2026", "", true);
		return getJson(${JSON.stringify(AROUND_PATH)})
			.then(function (found) {
				lookButton.disabled = false;
				if (found && found.available) showAround(found.networks || []);
				else say(status, (found && (found.message || found.error)) || "OmniCore couldn't look for networks.", "bad");
			})
			.catch(function () {
				lookButton.disabled = false;
				say(status, "OmniCore couldn't look for networks. Try again.", "bad");
			});
	}

	function choose(network) {
		if (joining) return;
		chosen = network;
		if (network.auth === "open") {
			join();
			return;
		}
		joinLabel.textContent = "Password for " + network.ssid;
		password.value = "";
		password.type = "password";
		form.hidden = false;
		aroundList.hidden = true;
		say(status, "");
		password.focus();
	}

	function join() {
		if (!chosen || joining) return;
		joining = true;
		lookButton.disabled = true;
		var body = { ssid: chosen.ssid, auth: chosen.auth, password: chosen.auth === "open" ? "" : password.value };
		password.value = "";
		form.hidden = true;
		aroundList.hidden = true;
		say(status, "Connecting to " + chosen.ssid + "\\u2026", "", true);
		postJson(${JSON.stringify(JOIN_PATH)}, body)
			.then(function (reply) {
				if (reply.status === 202) return;
				finished();
				say(status, reply.answer.error || "Couldn't start joining.", "bad");
				aroundList.hidden = false;
			})
			.catch(function () {
				// The page may have lost the server: the switch has begun.
				// The stream says how it went once it's back.
			});
	}

	function finished() {
		joining = false;
		lookButton.disabled = false;
	}

	form.addEventListener("submit", function (event) {
		event.preventDefault();
		join();
	});
	document.getElementById("net-cancel").addEventListener("click", function () {
		password.value = "";
		form.hidden = true;
		aroundList.hidden = false;
		say(status, "");
	});
	lookButton.addEventListener("click", lookAround);

	// --- How a join goes ------------------------------------------------

	function showStep(step) {
		if (!step || !step.phase) return;
		if (step.at) {
			if (step.at <= lastSeenStep) return;
			lastSeenStep = step.at;
		}
		if (step.phase === "connecting") {
			joining = true;
			lookButton.disabled = true;
			form.hidden = true;
			aroundList.hidden = true;
			say(status, "Connecting to " + step.ssid + "\\u2026", "", true);
		} else if (step.phase === "joined") {
			say(status, "Joined " + step.ssid + ". Waiting for the internet\\u2026", "", true);
		} else if (step.phase === "connected") {
			finished();
			say(status, "Connected to " + step.ssid + ".", "good");
			refresh();
		} else if (step.phase === "failed") {
			finished();
			say(status, step.message || "Couldn't join it.", "bad");
			refresh();
		}
	}

	// Steps as they happen, and, when the stream comes back after the page
	// lost the server, the one it missed
	var events = null;
	if (window.EventSource) {
		events = new EventSource(${JSON.stringify(networkStatus.EVENTS_PATH)});
		var opened = false;
		events.addEventListener("setup", function (event) {
			try { showStep(JSON.parse(event.data)); } catch (error) {}
		});
		events.addEventListener("open", function () {
			if (!opened) { opened = true; return; }
			getJson(${JSON.stringify(JOIN_PATH)}).then(function (answer) {
				if (answer && answer.last) showStep(answer.last);
			}).catch(function () {});
		});
	}

	// OmniCore can't change the Wi-Fi here: one box, the Wi-Fi as far as
	// it can be seen and why, and nothing else
	function onlyNow() {
		document.getElementById("net-known-box").remove();
		document.getElementById("net-around-box").remove();
		document.getElementById("net-top").classList.remove("two");
		if (events) events.close();
	}

	// First the Wi-Fi now, then what it knows, then a look around (one
	// thing at a time: they all use the card)
	lookNow()
		.then(function () {
			if (current && current.canChange === false) {
				onlyNow();
				throw "stop";
			}
		})
		.then(lookKnown)
		.then(function () {
			return getJson(${JSON.stringify(JOIN_PATH)}).then(function (answer) {
				if (answer && answer.joining) {
					joining = true;
					say(status, "OmniCore is joining a network\\u2026", "", true);
					return;
				}
				lookButton.disabled = false;
				return lookAround();
			});
		})
		.catch(function (why) { if (why !== "stop") lookButton.disabled = false; });
})();
`;

// "Add a network around you", on the Guest Wi-Fi widget's page (a
// `wifi-add` setting, which only a widget built into OmniCore can have:
// see module-config.js). The button opens a window: the networks around,
// then a password, then a check (CHECK_PATH): the server joins the network
// just long enough to make sure the password works, comes back, and keeps
// it as a known network that doesn't join automatically. Once it's checked,
// it's added to the widget's network list and picked; Save keeps it.
function addNetworkButtonHtml(field, escapeHtml) {
	return (
		`<button type="button" class="glass" data-wifi-add data-wifi-into="${escapeHtml(field.into || "network")}" ` +
		`style="align-self:flex-start;padding:0.6em 1.1em;font-size:0.85em">Add a network around you</button>`
	);
}

const ADD_NETWORK_SCRIPT = `
(function () {
	var buttons = document.querySelectorAll("[data-wifi-add]");
	if (!buttons.length) return;
	var LOCK = ${JSON.stringify(LOCK_SVG)};
	var PASSWORD_FIELD = ${JSON.stringify(passwordField('<input type="password" id="net-add-password" autocomplete="off" spellcheck="false" autocapitalize="off">'))};

	function text(tag, value, className) {
		var element = document.createElement(tag);
		if (className) element.className = className;
		element.textContent = value;
		return element;
	}

	function say(where, message, tone) {
		where.className = "status" + (tone ? " " + tone : "");
		where.textContent = message || "";
	}

	function getJson(url) {
		return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); });
	}

	function postJson(url, body) {
		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}).then(function (r) {
			return r.json().then(function (answer) { return { ok: r.ok, status: r.status, answer: answer || {} }; });
		});
	}

	// The list is hidden with style rather than hidden: the Default UI's
	// .list has a display rule of its own, which would win
	function plainButton(label) {
		var element = text("button", label, "glass");
		element.type = "button";
		return element;
	}

	function open(trigger) {
		var select = document.querySelector('select[data-key="' + trigger.getAttribute("data-wifi-into") + '"]');
		var backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		var panel = document.createElement("div");
		panel.className = "modal";
		panel.style.maxWidth = "28em";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");
		panel.appendChild(text("h2", "Add a network around you"));
		panel.appendChild(text("p", "Pick the network your guests use and type its password. The server joins it for a moment to check the password, then goes back to its own network. It can drop off its network for up to a minute meanwhile.", "dialog-text"));
		var list = document.createElement("div");
		list.className = "list";
		list.style.maxHeight = "16em";
		list.style.overflowY = "auto";
		panel.appendChild(list);
		var form = document.createElement("form");
		form.autocomplete = "off";
		form.hidden = true;
		form.style.flexDirection = "column";
		form.style.gap = "0.6em";
		var label = text("label", "Password");
		label.htmlFor = "net-add-password";
		form.appendChild(label);
		var box = document.createElement("div");
		box.innerHTML = PASSWORD_FIELD;
		form.appendChild(box);
		var password = box.querySelector("input");
		panel.appendChild(form);
		var status = text("p", "", "status");
		status.setAttribute("role", "status");
		panel.appendChild(status);
		var buttonsRow = document.createElement("div");
		buttonsRow.className = "dialog-buttons";
		var close = plainButton("Cancel");
		var check = plainButton("Check and add");
		check.hidden = true;
		buttonsRow.appendChild(close);
		buttonsRow.appendChild(check);
		panel.appendChild(buttonsRow);
		backdrop.appendChild(panel);
		document.body.appendChild(backdrop);

		var chosen = null;
		var checking = false;
		var events = null;
		var lastSeen = 0;

		function shut() {
			if (checking) return;
			if (events) events.close();
			document.removeEventListener("keydown", onKey);
			backdrop.remove();
		}
		function onKey(event) {
			if (event.key === "Escape") shut();
		}
		document.addEventListener("keydown", onKey);
		close.addEventListener("click", shut);
		backdrop.addEventListener("click", function (event) {
			if (event.target === backdrop) shut();
		});

		function pick(network) {
			chosen = network;
			if (network.auth === "open") {
				start("");
				return;
			}
			list.style.display = "none";
			form.hidden = false;
			form.style.display = "flex";
			label.textContent = "Password for " + network.ssid;
			check.hidden = false;
			close.textContent = "Back";
			say(status, "");
			password.focus();
		}

		function backToList() {
			chosen = null;
			password.value = "";
			form.hidden = true;
			form.style.display = "none";
			list.style.display = "";
			check.hidden = true;
			close.textContent = "Cancel";
		}

		close.addEventListener("click", function (event) {
			if (chosen && !checking) {
				event.stopImmediatePropagation();
				backToList();
			}
		}, true);

		function finished(step) {
			checking = false;
			check.disabled = false;
			close.disabled = false;
			if (step.phase === "checked") {
				if (select) {
					var exists = Array.prototype.some.call(select.options, function (option) { return option.value === step.ssid; });
					if (!exists) {
						var option = document.createElement("option");
						option.value = step.ssid;
						option.textContent = step.ssid;
						select.appendChild(option);
					}
					select.value = step.ssid;
					select.dispatchEvent(new Event("change", { bubbles: true }));
				}
				form.hidden = true;
				form.style.display = "none";
				check.hidden = true;
				close.textContent = "Done";
				chosen = null;
				say(status, "The password works. " + step.ssid + " is picked for this widget: Save to keep it.", "good");
			} else {
				say(status, step.message || "Couldn't check it.", "bad");
			}
		}

		function showStep(step) {
			if (!step || !step.phase || !chosen || step.ssid !== chosen.ssid) return;
			if (step.at) {
				if (step.at <= lastSeen) return;
				lastSeen = step.at;
			}
			if (step.phase === "joined") say(status, "Joined " + step.ssid + ". Going back to the server's own network\\u2026");
			if (step.phase === "checked" || step.phase === "failed") finished(step);
		}

		function follow() {
			if (events || !window.EventSource) return;
			events = new EventSource(${JSON.stringify(networkStatus.EVENTS_PATH)});
			var opened = false;
			events.addEventListener("setup", function (event) {
				try { showStep(JSON.parse(event.data)); } catch (error) {}
			});
			// Back after the server dropped off: ask for the step it missed
			events.addEventListener("open", function () {
				if (!opened) { opened = true; return; }
				getJson(${JSON.stringify(JOIN_PATH)}).then(function (answer) {
					if (answer && answer.last) showStep(answer.last);
				}).catch(function () {});
			});
		}

		function start(typed) {
			checking = true;
			check.disabled = true;
			close.disabled = true;
			list.style.display = "none";
			follow();
			say(status, "Checking " + chosen.ssid + "\\u2026 The server may drop off its network for up to a minute.");
			postJson(${JSON.stringify(CHECK_PATH)}, { ssid: chosen.ssid, auth: chosen.auth, password: typed })
				.then(function (reply) {
					password.value = "";
					if (reply.status === 202) return;
					finished({ phase: "failed", message: reply.answer.error || "Couldn't start the check." });
					if (chosen && chosen.auth === "open") backToList();
				})
				.catch(function () {
					// The server may have dropped off already: the stream says
					// how it went once it's back
				});
		}

		check.addEventListener("click", function () {
			if (!chosen || checking) return;
			start(password.value);
		});
		form.addEventListener("submit", function (event) {
			event.preventDefault();
			check.click();
		});

		say(status, "Looking for networks\\u2026");
		getJson(${JSON.stringify(AROUND_PATH)})
			.then(function (found) {
				if (!found || !found.available) {
					say(status, (found && (found.message || found.error)) || "OmniCore couldn't look for networks.", "bad");
					return;
				}
				say(status, "");
				var networks = (found.networks || []).filter(function (network) { return network.auth !== "unsupported"; });
				if (!networks.length) {
					list.appendChild(text("div", "No networks found. Try again in a moment.", "empty"));
					return;
				}
				networks.forEach(function (network) {
					var row = document.createElement("button");
					row.type = "button";
					row.className = "font-row";
					row.style.display = "flex";
					row.style.justifyContent = "space-between";
					row.style.alignItems = "center";
					row.appendChild(text("span", network.ssid));
					var end = document.createElement("span");
					end.innerHTML = network.auth === "open" ? "" : LOCK;
					row.appendChild(end);
					row.setAttribute("aria-label", network.ssid + (network.auth === "open" ? ", no password" : ", needs a password"));
					row.addEventListener("click", function () { pick(network); });
					list.appendChild(row);
				});
			})
			.catch(function () { say(status, "OmniCore couldn't look for networks. Try again.", "bad"); });
	}

	Array.prototype.forEach.call(buttons, function (trigger) {
		trigger.addEventListener("click", function () { open(trigger); });
	});
})();
`;

// The Network box on the Settings home, when it was drawn as a button
// before anyone knew: asks, and if OmniCore can't change the Wi-Fi here,
// turns into a plain box that says why
const TILE_SCRIPT = `
(function () {
	var tile = document.querySelector('a[data-tile="network"]');
	if (!tile || !window.fetch) return;
	fetch(${JSON.stringify(ABILITY_PATH)}, { cache: "no-store", credentials: "same-origin" })
		.then(function (r) { return r.json(); })
		.then(function (answer) {
			if (!answer || answer.canChange !== false) return;
			var box = document.createElement("div");
			box.className = tile.className.replace(/\\bclickable\\b/, "").replace(/\\s+/g, " ").trim() + " home-tile-off";
			box.setAttribute("data-tile", "network");
			while (tile.firstChild) box.appendChild(tile.firstChild);
			var line = box.querySelector(".tile-text > span");
			// "Wi-Fi" never broken across two lines
			if (line) line.textContent = (answer.message || "OmniCore can't change the server's Wi-Fi.").replace(/Wi-Fi/g, "Wi\\u2011Fi");
			tile.replaceWith(box);
		})
		.catch(function () {});
})();
`;

module.exports = {
	PAGE_PATH,
	ABILITY_PATH,
	NOW_PATH,
	KNOWN_PATH,
	AROUND_PATH,
	JOIN_PATH,
	FORGET_PATH,
	EDIT_PATH,
	PASSWORD_SHOW_PATH,
	CHECK_PATH,
	WPA_EDIT,
	NM_EDIT,
	edit,
	addNetworkButtonHtml,
	ADD_NETWORK_SCRIPT,
	SHOW_TRIES,
	showPassword,
	resetShows,
	KNOWN_WPA,
	KNOWN_NM,
	FORGET_WPA,
	FORGET_NM,
	readSsid,
	parseKnown,
	now,
	ability,
	checkAbility,
	known,
	forget,
	attach,
	PAGE_BODY,
	PAGE_SCRIPT,
	TILE_SCRIPT
};
