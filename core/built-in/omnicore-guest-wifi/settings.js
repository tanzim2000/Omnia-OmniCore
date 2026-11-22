// core/built-in/omnicore-guest-wifi/settings.js
// The Guest Wi-Fi widget's settings. A function rather than a
// settings.json, so the list of networks is the saved ones at the moment
// the form is drawn (only a built-in widget can do this: see built-in.js).

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
				help: "The saved networks are on the Network page, in Settings. A network joined through OmniCore is saved by itself.",
				options: [SERVERS_OWN, ...saved],
				default: SERVERS_OWN
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
