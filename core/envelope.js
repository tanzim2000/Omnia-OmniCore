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
//   { type: "pair",       label, value }
//   { type: "image",      url, alt, fit: "cover"|"contain" }
//   { type: "background", url }
//   { type: "progress",   value: 0..1, label }
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

		remember(instanceId, index, block.url);

		return {
			...block,
			url: "/api/" + encodeURIComponent(instanceId) + "/image/" + index
		};
	});
}

module.exports = { toBlocks, proxyImages };