// faces/kiosk/index.js
// The "kiosk" face — the physical AiO screen display.
// For now this just proves the face pattern works end to end.
// Real tile add/modify UI logic for this specific face gets built here later.

module.exports = function kioskFace(app, options) {
	app.get("/face-info", (req, res) => {
		res.json({ face: "kiosk" });
	});
};