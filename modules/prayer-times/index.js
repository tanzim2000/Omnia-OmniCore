// modules/prayer-times/index.js
// Prayer times from the Aladhan API. Free, no key required.
//
// Leads with the NEXT prayer, since that's what's worth glancing at, and
// lists the rest of the day underneath.
//
// Times change once a day, so the cache is deliberately long.

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

function unavailable() {
	return {
		title: "Prayer",
		primary: "—",
		secondary: "Not reachable",
		details: [{ label: "Source", value: "Aladhan" }],
		updated: new Date().toISOString()
	};
}

module.exports = async function prayerTimes(config) {
	if (!config.location) {
		return {
			title: "Prayer",
			primary: "—",
			secondary: "No location",
			details: [{ label: "Set a location", value: "in Settings" }],
			updated: new Date().toISOString()
		};
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
		return unavailable();
	}

	const timings = data.data.timings;

	// Aladhan sometimes appends a timezone, e.g. "17:42 (CST)"
	const clean = {};
	for (const prayer of PRAYERS) {
		if (!timings[prayer]) {
			return unavailable();
		}
		clean[prayer] = timings[prayer].split(" ")[0];
	}

	const now = new Date();
	const nowMinutes = now.getHours() * 60 + now.getMinutes();

	// The first prayer still ahead of us today. If they've all passed, the
	// next one is tomorrow's Fajr.
	const upcoming = PRAYERS.find(
		(prayer) => toMinutes(clean[prayer]) > nowMinutes
	);

	const nextPrayer = upcoming || "Fajr";

	return {
		title: "Prayer",
		primary: formatTime(clean[nextPrayer], use12Hour),
		secondary: upcoming ? nextPrayer : "Fajr (tomorrow)",
		details: PRAYERS.map((prayer) => ({
			label: prayer,
			value: formatTime(clean[prayer], use12Hour)
		})),
		updated: new Date().toISOString()
	};
};