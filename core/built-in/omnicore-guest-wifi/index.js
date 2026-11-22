// core/built-in/omnicore-guest-wifi/index.js
// The Guest Wi-Fi widget (since 2.0.0): a QR code a guest's phone scans to
// join the Wi-Fi.
//
// Built into OmniCore rather than a module from a Registry, because it
// needs a saved Wi-Fi password, and those never leave Core
// (network-passwords.js). The password is opened here, written into the
// code's contents, and let go. Core draws the code (qr.js); the theme only
// places it.
//
// WHAT IT SHOWS, BY ROOM (richness)
//
//   any       the code
//   over 33   the network's name under it
//   over 66   a line saying what to do with it
//   setting   the password as text, only when "Show the password under the
//             code" is on (off by default)
//
// A theme that can't draw a QR code prints the network's name instead of
// the code's contents (the block's `fallback`), so the password is never
// printed by accident.

const passwords = require("../../network-passwords");
const { SERVERS_OWN } = require("./settings");

const TITLE = "Guest Wi-Fi";

// Which network this widget shows: the one picked, or the server's own
function pickedName(config) {
	const picked = config && typeof config.network === "string" && config.network ? config.network : SERVERS_OWN;
	return picked;
}

// Two lines of words, for when there's no code to show
function words(primary, secondary) {
	return {
		title: TITLE,
		content: [
			{ type: "text", emphasis: "primary", value: primary },
			{ type: "text", emphasis: "secondary", value: secondary }
		]
	};
}

module.exports = async function guestWifi(config, richness) {
	const picked = pickedName(config);
	const ssid = picked === SERVERS_OWN ? await passwords.currentSsid() : picked;

	if (!ssid) {
		return words("Not on Wi-Fi", "The server isn't on a Wi-Fi network right now. Pick a saved network in this widget's settings.");
	}

	const network = passwords.reveal(ssid);
	if (!network) {
		return words(ssid, "OmniCore has no saved password for this network. Add it on the Network page, in Settings.");
	}

	const room = Number(richness) || 50;
	const content = [
		{
			type: "qr",
			value: passwords.qrValue(network),
			label: `Join ${network.ssid}`,
			// What a theme that can't draw the code prints instead: never
			// the code's contents, which hold the password
			fallback: network.ssid
		}
	];

	if (room > 33) content.push({ type: "text", emphasis: "primary", value: network.ssid });
	if (room > 66) {
		content.push({ type: "text", emphasis: "secondary", value: "Point your phone's camera at the code to join." });
	}
	if (config && config.showPassword === true) {
		content.push({ type: "pair", label: "Password", value: network.auth === "open" ? "None" : network.password });
	}

	return { title: TITLE, content };
};

// The widget's name in lists: the network, when one is picked
module.exports.label = async function (config) {
	const picked = pickedName(config);
	return picked === SERVERS_OWN ? "" : `${TITLE}: ${picked}`;
};
