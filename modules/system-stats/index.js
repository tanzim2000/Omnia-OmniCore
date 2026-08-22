// modules/system-stats/index.js
// Every OmniCore module exports one function: (app, options) => { ... }
// It receives the shared Express app and registers whatever routes it needs.

module.exports = function systemStatsModule(app, options) {
	app.get("/api/system-stats", (req, res) => {
		res.json({ message: "system-stats module is working" });
	});
};