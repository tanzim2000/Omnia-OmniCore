// core/built-in/omnicore-guest-wifi/settings.js
// The Guest Wi-Fi widget's settings. A function rather than a
// settings.json, so the list of networks is the ones OmniCore has the
// password for at the moment the form is drawn (only a built-in widget
// can do this: see built-in.js). Under the list, "Add a network around
// you" (a wifi-add setting, also only for a built-in widget).

const passwords = require("../../network-passwords");

// The first choice, and the one a new widget starts on: whichever network
// the server is on at the time
const SERVERS_OWN = "The network the server is on";

module.exports = function () {
	// Only networks whose password can still be opened: one that can't
	// would only ever show "add it again"
	const saved = passwords
		.list()
		.filter((network) => network.readable)
		.map((network) => network.ssid)
		.filter((ssid) => ssid !== SERVERS_OWN);

	return {
		settings: [
			{
				key: "network",
				type: "select",
				label: "Network",
				help: "The networks the server knows whose password OmniCore has: every network joined through OmniCore, and any added below.",
				options: [SERVERS_OWN, ...saved],
				default: SERVERS_OWN
			},
			{
				// A button, not a value: the network it adds goes into the
				// list above (network-page.js, ADD_NETWORK_SCRIPT)
				key: "addNetwork",
				type: "wifi-add",
				label: "Not in the list?",
				help: "Add a network around you, like a guest network the server doesn't use. Its password is checked first.",
				into: "network"
			},
			{
				key: "showPassword",
				type: "boolean",
				label: "Show the password under the code",
				help: "For a guest whose device can't scan a code. Anyone who can see the screen can read it.",
				default: false
			}
		]
	};
};

module.exports.SERVERS_OWN = SERVERS_OWN;
