// modules/calendar/index.js
// Upcoming events from an ICS calendar feed (Google Calendar, Nextcloud,
// Outlook — anything that publishes a .ics URL).
// Read-only.
//
// ICS is parsed here by hand rather than with a library, to keep OmniCore
// dependency-free. That means this handles ordinary one-off events well,
// but NOT repeating ones — see the note by parseEvents below.
//
// Feeds can be large, so the fetch is cached — re-downloading the whole
// calendar every few seconds would be wasteful for both ends.

const { fetchCached } = require("../../core/module-fetch");
const { share } = require("../../core/priority");

// ICS wraps long lines by starting the continuation with a space or tab.
// Join those back together before parsing anything.
function unfold(text) {
	return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

// ICS dates come as "20260822T183000Z" or "20260822" for all-day events
function parseDate(value) {
	const match = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/
	);

	if (!match) {
		return null;
	}

	const [, year, month, day, hour, minute, second, utc] = match;

	// All-day events have no time part
	if (hour === undefined) {
		return {
			date: new Date(Number(year), Number(month) - 1, Number(day)),
			allDay: true
		};
	}

	const parts = [
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second)
	];

	return {
		date: utc ? new Date(Date.UTC(...parts)) : new Date(...parts),
		allDay: false
	};
}

// Pull one-off events out of an ICS feed.
//
// Repeating events (those with an RRULE) are skipped. Working out every
// occurrence of a rule like "third Tuesday, except holidays" is a genuinely
// hard problem, and getting it subtly wrong on a wall display is worse than
// not showing it. A library would be the right answer if you need them.
function parseEvents(text) {
	const events = [];
	const blocks = unfold(text).split("BEGIN:VEVENT").slice(1);

	for (const block of blocks) {
		const body = block.split("END:VEVENT")[0];

		if (/\nRRULE[:;]/.test(body)) {
			continue; // repeating — skip it
		}

		const startMatch = body.match(/\nDTSTART[^:\n]*:([^\r\n]+)/);
		const summaryMatch = body.match(/\nSUMMARY[^:\n]*:([^\r\n]+)/);

		if (!startMatch) continue;

		const start = parseDate(startMatch[1].trim());
		if (!start) continue;

		events.push({
			start: start.date,
			allDay: start.allDay,
			// ICS escapes commas and semicolons with a backslash
			summary: summaryMatch
				? summaryMatch[1].replace(/\\([,;\\])/g, "$1").trim()
				: "(no title)"
		});
	}

	return events;
}

// A short label like "Today 3:00 PM" or "Mon 9:00 AM"
function whenLabel(event) {
	const now = new Date();
	const start = event.start;

	const sameDay = start.toDateString() === now.toDateString();

	const tomorrow = new Date(now);
	tomorrow.setDate(now.getDate() + 1);
	const isTomorrow = start.toDateString() === tomorrow.toDateString();

	let day;
	if (sameDay) day = "Today";
	else if (isTomorrow) day = "Tmrw";
	else day = start.toLocaleDateString(undefined, { weekday: "short" });

	if (event.allDay) {
		return day;
	}

	const time = start.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit"
	});

	return day + " " + time;
}

module.exports = async function calendar(config, richness) {
	if (!config.url) {
		return {
			title: "Calendar",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "No feed set" }
			],
			updated: new Date().toISOString()
		};
	}

	// Calendar feeds are plain text, not JSON
	const { data, stale } = await fetchCached(config.url, {
		as: "text",
		cacheSeconds: Number(config.refreshMinutes) * 60
	});

	if (!data) {
		return {
			title: "Calendar",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "Not reachable" }
			],
			updated: new Date().toISOString()
		};
	}

	const now = new Date();
	const horizon = new Date(now);
	horizon.setDate(now.getDate() + Number(config.daysAhead));

	// Note this filtering runs on every request even when the feed came from
	// cache, so "Today" and "Tmrw" stay correct as time passes
	const upcoming = parseEvents(data)
		.filter((event) => event.start >= now && event.start <= horizon)
		.sort((a, b) => a.start - b.start);

	const window =
		"in " + config.daysAhead +
		(Number(config.daysAhead) === 1 ? " day" : " days");

	// RICHNESS
	//
	// Every row here is the same kind of thing — one event — so there is
	// nothing meaningful for a user to reorder. What changes with the size
	// of the tile is simply how many of them fit. The count leads at every
	// size, because it is the one thing worth reading from across a room.
	const content = [
		{ type: "text", emphasis: "primary", value: String(upcoming.length) }
	];

	if (richness >= 25) {
		content.push({
			type: "text",
			emphasis: "secondary",
			value: window + (stale ? " (last known)" : "")
		});
	}

	// The user's own limit is the ceiling; richness decides how much of it
	// a given tile actually earns. minimum 0 because a tile with room for
	// nothing but the count should show nothing but the count.
	const room = share(
		Math.min(upcoming.length, Number(config.limit)),
		richness,
		{ minimum: 0 }
	);

	for (const event of upcoming.slice(0, room)) {
		content.push({
			type: "pair",
			label: whenLabel(event),
			value: event.summary
		});
	}

	return {
		title: "Calendar",
		content: content,
		updated: new Date().toISOString()
	};
};