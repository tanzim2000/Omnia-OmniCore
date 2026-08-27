// modules/prayer-times/index.js
// Prayer times from the Aladhan API. Free, no key required.
//
// RICHNESS
//
// This module has four steps on its own 1-100 scale. What those numbers
// mean is this module's business — a theme only says how much room it has
// and gets back something that fits:
//
//    1-24    the next prayer's time, nothing else
//   25-49    that time, and which prayer it is
//   50-79    the above, plus the two prayers after it
//   80-100   the above, plus the whole day
//
// The steps are chosen around what's useful at a glance rather than split
// evenly. A small tile wants the time; a large one wants the schedule.

const { fetchCached } = require("../../core/module-fetch");

// Aladhan identifies calculation methods by number. We store the readable
// name in settings and map it here, so the admin page shows words rather
// than a number nobody can interpret.
const METHODS = {
	"Muslim World League": 3,
	"ISNA (North America)": 2,
	"Egyptian General Authority": 5,
	"Umm Al-Qura, Makkah": 4,
	"University of Islamic Sciences, Karachi": 1
};

// Which of the returned timings are actual prayers, in order.
// Aladhan also returns Sunrise, Imsak, Midnight and others.
const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

// Aladhan returns times as "17:42" — turn that into minutes since midnight
// so we can compare them against now
function toMinutes(time) {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

function formatTime(time, use12Hour) {
	if (!use12Hour) {
		return time;
	}

	let [hours, minutes] = time.split(":").map(Number);
	const suffix = hours >= 12 ? "PM" : "AM";

	hours = hours % 12;
	if (hours === 0) hours = 12;

	return hours + ":" + String(minutes).padStart(2, "0") + " " + suffix;
}

function problem(reason) {
	return {
		title: "Prayer",
		content: [
			{ type: "text", emphasis: "primary", value: "—" },
			{ type: "text", emphasis: "secondary", value: reason }
		],
		updated: new Date().toISOString()
	};
}

module.exports = async function prayerTimes(config, richness) {
	// OmniCore resolves the location setting before we see it. Null means
	// there's no location to work with — either location services are off,
	// or detection failed and nothing was set by hand.
	if (!config.location) {
		return problem("No location");
	}

	const use12Hour = config.timeFormat === "12-hour";
	const method = METHODS[config.method] || 2;

	// school: 0 = Shafi (earlier Asr), 1 = Hanafi (later Asr)
	const school = config.school === "Hanafi" ? 1 : 0;

	const url =
		"https://api.aladhan.com/v1/timings" +
		"?latitude=" + encodeURIComponent(config.location.latitude) +
		"&longitude=" + encodeURIComponent(config.location.longitude) +
		"&method=" + method +
		"&school=" + school;

	// Include today's date in the cache key so the cached answer is dropped
	// at midnight rather than carrying yesterday's times over
	const { data } = await fetchCached(url, {
		key: "prayer-times:" + new Date().toDateString() + ":" + url,
		cacheSeconds: Number(config.refreshMinutes) * 60
	});

	if (!data || !data.data || !data.data.timings) {
		return problem("Not reachable");
	}

	const timings = data.data.timings;

	// Aladhan sometimes appends a timezone, e.g. "17:42 (CST)"
	const clean = {};
	for (const prayer of PRAYERS) {
		if (!timings[prayer]) {
			return problem("Not reachable");
		}
		clean[prayer] = timings[prayer].split(" ")[0];
	}

	const now = new Date();
	const nowMinutes = now.getHours() * 60 + now.getMinutes();

	// Where in the day we are. If every prayer has passed, the next one is
	// tomorrow's Fajr.
	const upcomingAt = PRAYERS.findIndex(
		(prayer) => toMinutes(clean[prayer]) > nowMinutes
	);

	const nextAt = upcomingAt === -1 ? 0 : upcomingAt;
	const nextPrayer = PRAYERS[nextAt];

	// The next time is the one thing worth seeing from across a room, so it
	// leads at every richness
	const content = [
		{
			type: "text",
			emphasis: "primary",
			value: formatTime(clean[nextPrayer], use12Hour)
		}
	];

	if (richness >= 25) {
		content.push({
			type: "text",
			emphasis: "secondary",
			value: upcomingAt === -1 ? "Fajr, tomorrow" : nextPrayer
		});
	}

	if (richness >= 80) {
		// Room for the whole day
		for (const prayer of PRAYERS) {
			content.push({
				type: "pair",
				label: prayer,
				value: formatTime(clean[prayer], use12Hour)
			});
		}
	} else if (richness >= 50) {
		// Room for what's coming, but not the whole day. Wrap round the end
		// of the list so late evening still shows tomorrow's start.
		for (let ahead = 1; ahead <= 2; ahead++) {
			const prayer = PRAYERS[(nextAt + ahead) % PRAYERS.length];

			content.push({
				type: "pair",
				label: prayer,
				value: formatTime(clean[prayer], use12Hour)
			});
		}
	}

	return {
		title: "Prayer",
		content: content,
		updated: new Date().toISOString()
	};
};