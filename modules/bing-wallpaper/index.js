// modules/bing-wallpaper/index.js
// Bing's picture of the day.
//
// Returns an image block. It has no idea whether a theme will show it as a
// wallpaper, a tile background, or not at all — that's the theme's and the
// user's decision, not this module's.

const { fetchCached } = require("../../core/module-fetch");

const ENDPOINT = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1";

module.exports = async function bingWallpaper(config, richness) {
	const url = ENDPOINT + "&mkt=" + encodeURIComponent(config.market);

	const { data } = await fetchCached(url, {
		// The picture changes once a day
		cacheSeconds: Number(config.refreshMinutes) * 60
	});

	const image = data && data.images && data.images[0];

	if (!image) {
		return {
			title: "Wallpaper",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "Not reachable" }
			],
			updated: new Date().toISOString()
		};
	}

	// Bing gives a path, not a full address
	const picture = "https://www.bing.com" + image.url;

	// Two blocks for the same picture, saying two different things:
	// a background is for the page behind everything, an image is content
	// for this module's own tile. A theme honours whichever it wants.
	//
	// RICHNESS
	//
	// This module has the shallowest scale of any of them — two steps —
	// and that is the right number rather than a shortcut. The background
	// is page-level, so it costs a tile nothing and is always sent. The
	// picture itself is the content. The only real question is whether
	// there is room for Bing's copyright line, which is long enough to
	// swamp a small tile and is the first thing worth dropping.
	//
	// More steps would mean inventing distinctions this module doesn't
	// have. Two well-chosen steps beat twenty arbitrary ones.
	const content = [
		{ type: "background", url: picture },
		{ type: "image", url: picture, alt: image.copyright || "", fit: "cover" }
	];

	if (richness >= 50 && image.copyright) {
		content.push({
			type: "text",
			emphasis: "secondary",
			value: image.copyright
		});
	}

	return {
		title: "Wallpaper",
		content: content,
		updated: new Date().toISOString()
	};
};