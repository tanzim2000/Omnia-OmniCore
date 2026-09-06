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