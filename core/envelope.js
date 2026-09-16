// core/envelope.js
// Turns whatever a module returned into content blocks.
//
// THE CONTENT CONTRACT
//
// A module describes WHAT it has, never how it should look. It returns a
// list of blocks:
//
//   { type: "text",       value, emphasis: "primary"|"secondary"|"body" }
//   { type: "quote",      value }
//   { type: "pair",       label, value, emphasis?: "primary"|"secondary" }
//   { type: "image",      url, alt, fit: "cover"|"contain" }
//   { type: "background", url }
//   { type: "progress",   value: 0..1, label }
//
// A "pair" is a NAME and a VALUE kept apart. A module always sends both;
// whether a theme draws the name, hides it, or puts it elsewhere is the
// theme's decision. A module must never fold a label into a value string —
// that is a module deciding how it looks, which is exactly what the split
// exists to prevent. `emphasis` says which pair matters most; what that
// looks like is still the theme's call.
//
// "image" is a picture the tile should show. "background" is a picture
// meant to sit behind something — the module says what the picture is FOR,
// and the theme decides where that ends up.
//
// Every block also carries a `text` string: its plain-text rendering. A
// theme that has never heard of a block type falls back to that and still
// looks fine. That fallback is what lets the type list grow without
// breaking themes people already installed.
//
// Modules may also return the older flat shape — title, primary, secondary
// and details — and OmniCore converts it here. So a module only moves to
// blocks when it needs something the flat shape can't express, and themes
// only ever deal with blocks.

// Formats a count of seconds as "M:SS", or "H:MM:SS" once it's over an
// hour — shared by every `time` kind that has to show elapsed or
// remaining seconds as a fallback.
function formatDuration(totalSeconds) {
	const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const paddedSecs = String(secs).padStart(2, "0");

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSecs}`;
	}

	return `${minutes}:${paddedSecs}`;
}

// ---------------------------------------------------------------------
// Event dates
//
// An `event` block carries its dates in one of two deliberately different
// shapes, and which one it is carries real meaning:
//
//   "2026-09-15T09:00:00.000Z"  an INSTANT — a specific moment
//   "2026-09-20"                a DATE — a whole calendar day, no time
//
// An all-day event genuinely has no time and no timezone attached. The
// bare form is how it says so, and it must never be turned into an
// instant: `new Date("2026-09-20")` is read by JavaScript as UTC
// midnight, which is the evening of the 19th anywhere west of UTC — the
// event would land on the wrong day. So the bare form is taken apart by
// hand and rebuilt as a local date, where a calendar day belongs.
function readEventDate(value) {
	if (typeof value !== "string") {
		return null;
	}

	const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

	if (dateOnly) {
		return {
			allDay: true,
			date: new Date(
				Number(dateOnly[1]),
				Number(dateOnly[2]) - 1,
				Number(dateOnly[3])
			)
		};
	}

	const instant = new Date(value);

	if (Number.isNaN(instant.getTime())) {
		return null;
	}

	return { allDay: false, date: instant };
}

function isSameDay(a, b) {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function formatDay(date) {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatClock(date) {
	return date.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit"
	});
}

// When an event happens, as plainly as it can be said.
//
// This is only ever the FALLBACK rendering — a theme that understands
// `event` blocks does its own thing with the raw dates and never sees
// this. So it aims at "readable in one line", not at completeness.
function describeWhen(start, end) {
	const startDay = formatDay(start.date);

	if (start.allDay) {
		// One day, or a span. A multi-day all-day event reports the last
		// day it's actually on, so the two ends can be printed as-is.
		if (!end || isSameDay(start.date, end.date)) {
			return startDay;
		}

		return `${startDay} – ${formatDay(end.date)}`;
	}

	const startTime = formatClock(start.date);

	// An event with no duration — the feed gave no end at all
	if (!end || end.date.getTime() === start.date.getTime()) {
		return `${startDay}, ${startTime}`;
	}

	if (isSameDay(start.date, end.date)) {
		return `${startDay}, ${startTime} – ${formatClock(end.date)}`;
	}

	return `${startDay}, ${startTime} – ${formatDay(end.date)}, ${formatClock(
		end.date
	)}`;
}

// Give a block a plain-text form if it doesn't already have one
function withFallbackText(block) {
	if (block.text) {
		return block;
	}

	let text = "";

	if (block.type === "text" || block.type === "quote") {
		text = String(block.value === undefined ? "" : block.value);
	} else if (block.type === "pair") {
		text = block.label + ": " + block.value;
	} else if (block.type === "image" || block.type === "background") {
		text = block.alt || "";
	} else if (block.type === "progress") {
		text = Math.round(Number(block.value) * 100) + "%";
	} else if (block.type === "time") {
		// A raw instant, in whichever IANA zone the module resolved —
		// see docs/Architecture.md. Every `kind` shares one `timestamp`;
		// what else there is to say depends on which kind it is.
		const instant = new Date(block.timestamp);

		if (block.kind === "clock") {
			try {
				text = new Intl.DateTimeFormat("en-US", {
					timeZone: block.timezone,
					hour: "numeric",
					minute: "2-digit"
				}).format(instant);
			} catch (error) {
				// An invalid or missing IANA zone name shouldn't take the
				// whole tile down — fall back to the system's own zone.
				text = instant.toLocaleTimeString("en-US", {
					hour: "numeric",
					minute: "2-digit"
				});
			}
		} else if (block.kind === "countdown") {
			const remainingMs = new Date(block.target) - instant;

			if (remainingMs <= 0) {
				text = "Now";
			} else {
				const days = Math.floor(remainingMs / 86400000);
				text =
					days >= 1
						? `${days}d ${Math.floor((remainingMs % 86400000) / 3600000)}h`
						: formatDuration(remainingMs / 1000);
			}
		} else if (block.kind === "stopwatch") {
			text = formatDuration(block.position);
		} else if (block.kind === "position") {
			text = `${formatDuration(block.position)} / ${formatDuration(
				block.duration
			)}`;
		}
	} else if (block.type === "graphdata") {
		// The fallback for a theme with no chart support is the most
		// recent value, not the shape of the whole series — a theme that
		// can't draw a graph still shouldn't show nothing.
		const points = Array.isArray(block.points) ? block.points : [];
		const latest = points[points.length - 1];

		text =
			latest === undefined
				? "No data"
				: String(latest.y) + (block.unit ? " " + block.unit : "");
	} else if (block.type === "event") {
		// One event. The fallback is a single readable line — a theme
		// that can't draw a calendar should still be able to list what's
		// on, the same way one that can't draw a chart still shows a
		// number.
		const summary = block.summary || "(no title)";
		const start = readEventDate(block.start);
		const end = readEventDate(block.end);

		// A block with an unreadable start is still worth showing by
		// name; dropping it entirely would be worse than saying less.
		text = start ? `${describeWhen(start, end)} — ${summary}` : summary;
	}

	return { ...block, text: text };
}

// Convert the flat envelope into blocks
function fromFlat(envelope) {
	const blocks = [];

	if (envelope.primary !== undefined && envelope.primary !== "") {
		blocks.push({
			type: "text",
			emphasis: "primary",
			value: String(envelope.primary)
		});
	}

	if (envelope.secondary) {
		blocks.push({
			type: "text",
			emphasis: "secondary",
			value: String(envelope.secondary)
		});
	}

	for (const detail of envelope.details || []) {
		blocks.push({
			type: "pair",
			label: String(detail.label),
			value: String(detail.value)
		});
	}

	return blocks;
}

// The blocks for an envelope, whichever shape the module used
function toBlocks(envelope) {
	const blocks = Array.isArray(envelope.content)
		? envelope.content
		: fromFlat(envelope);

	return blocks.filter(Boolean).map(withFallbackText);
}

// Replace external picture URLs with paths back to OmniCore, and hand the
// real URL to `remember` so the proxy can find it again.
//
// The browser never sees where an image really came from, and OmniCore
// will only ever fetch URLs a module actually returned — which is what
// stops the proxy becoming an open relay for arbitrary addresses.
function proxyImages(blocks, instanceId, remember) {
	return blocks.map((block, index) => {
		const isPicture = block.type === "image" || block.type === "background";

		if (!isPicture || !block.url) {
			return block;
		}

		remember(instanceId + ":" + index, block.url);

		return {
			...block,
			url: "/api/" + encodeURIComponent(instanceId) + "/image/" + index
		};
	});
}

module.exports = { toBlocks, proxyImages };