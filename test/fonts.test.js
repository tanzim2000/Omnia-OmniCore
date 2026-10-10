// test/fonts.test.js
// Choosing a font from Google (v1.19.3).
//
// Google sends a font as one file per alphabet. The first one listed is
// "latin-ext", which has no ordinary letters in it, and that is the one
// OmniCore used to save. These tests check the right file is chosen, using
// a reply shaped like Google's real one, so they never touch the network.

const test = require("node:test");
const assert = require("node:assert");

const fontService = require("../core/font-service");

// Shaped like what fonts.googleapis.com sends for a font with two alphabets
const TWO_ALPHABETS = `
/* latin-ext */
@font-face {
  font-family: 'Sample';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/sample/v1/EXT.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Sample';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/sample/v1/LATIN.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;

const ONE_ALPHABET = `
/* latin */
@font-face {
  font-family: 'Adamina';
  src: url(https://fonts.gstatic.com/s/adamina/v22/ONLY.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

const NO_LATIN = `
/* cyrillic */
@font-face {
  font-family: 'Sample';
  src: url(https://fonts.gstatic.com/s/sample/v1/CYR.woff2) format('woff2');
}
/* greek */
@font-face {
  font-family: 'Sample';
  src: url(https://fonts.gstatic.com/s/sample/v1/GREEK.woff2) format('woff2');
}`;

test("fonts: the latin file is chosen, not the first one listed", () => {
	assert.equal(
		fontService.latinWoff2Url(TWO_ALPHABETS),
		"https://fonts.gstatic.com/s/sample/v1/LATIN.woff2"
	);

	// ...which is the mistake the old function made
	assert.equal(
		fontService.firstWoff2Url(TWO_ALPHABETS),
		"https://fonts.gstatic.com/s/sample/v1/EXT.woff2"
	);
});

test("fonts: a font with only a latin file still works", () => {
	assert.equal(
		fontService.latinWoff2Url(ONE_ALPHABET),
		"https://fonts.gstatic.com/s/adamina/v22/ONLY.woff2"
	);
});

test("fonts: latin-ext is never mistaken for latin", () => {
	const onlyExt = TWO_ALPHABETS.slice(0, TWO_ALPHABETS.indexOf("/* latin */"));

	// With no plain "latin" block it falls back to the first file rather
	// than pretending latin-ext is latin by name
	assert.equal(
		fontService.latinWoff2Url(onlyExt),
		"https://fonts.gstatic.com/s/sample/v1/EXT.woff2"
	);
});

test("fonts: a font with no latin file falls back to its first file", () => {
	assert.equal(
		fontService.latinWoff2Url(NO_LATIN),
		"https://fonts.gstatic.com/s/sample/v1/CYR.woff2"
	);
});

test("fonts: nothing to download is nothing, not a crash", () => {
	assert.equal(fontService.latinWoff2Url(""), null);
	assert.equal(fontService.latinWoff2Url("no fonts here"), null);
});