// modules/bing-wallpaper/index.js
// Bing's picture of the day.
//
// Returns an image block. It has no idea whether a theme will show it as a
// wallpaper, a tile background, or not at all — that's the theme's and the
// user's decision, not this module's.

const { fetchCached } = require("../../core/module-fetch");

const ENDPOINT = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1";

module.exports = async function bingWallpaper(config) {
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
	return {
		title: "Wallpaper",
		content: [
			{ type: "background", url: picture },
			{ type: "image", url: picture, alt: image.copyright || "", fit: "cover" },
			{ type: "text", emphasis: "secondary", value: image.copyright || "" }
		],
		updated: new Date().toISOString()
	};
};