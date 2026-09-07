// core/face-links.js
// Helpers shared by the welcome face (4000) and the setup wizard
// (3999) after those two were split apart into separate servers.
//
// They used to sit inside control-face.js when both lived there. Now
// that they're two processes on two ports that link to each other,
// this is the one copy both use rather than each keeping its own.

// Builds a URL for a different port on the same machine, from inside
// the browser. Needed because OmniCore spreads itself across ports and
// a page on 4000 has to be able to send someone to 3999 or to a
// dashboard face, without ever being told what host it's reachable at.
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

// Ports OmniCore reserves for itself. The wizard moved off 4000 so that
// 4000 could become a pure face-picker, safe for a display that should
// never be able to create or change anything.
const WELCOME_PORT = 4000;
const WIZARD_PORT = 3999;

module.exports = { portLinkScript, escapeHtml, WELCOME_PORT, WIZARD_PORT };