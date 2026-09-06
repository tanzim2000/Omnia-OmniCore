// core/time-service.js
// OmniCore's system time read — the single place that knows what time
// this machine thinks it is, so a module or theme reads that instead of
// each calling Date()/Intl itself.
//
// Same tier as location-service.js: infrastructure, not a module. No
// settings.json, no marketplace listing, nothing appears on any
// dashboard just because this file exists — it only does anything if a
// module or theme actually calls it. Nothing here ticks on its own
// either, same as every other server-side piece: it returns one
// snapshot per call, whenever asked, and that's all.
//
// Read-only, for now. The ability to CHANGE the system's time is a real
// security question of its own, deliberately parked rather than folded
// in here — see docs/Architecture.md.

function readSystemTime() {
	return {
		timestamp: new Date().toISOString(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
	};
}

module.exports = { readSystemTime };