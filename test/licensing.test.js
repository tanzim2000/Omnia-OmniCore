// test/licensing.test.js
// The licence, said the same way everywhere (v2). Before v2 the LICENSE
// file said AGPL-3.0, package.json said ISC and the README said MIT; these
// tests keep them from drifting apart again, and check the files that go
// with the licence are where people (and the image) will find them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// The sentence a contributor posts to agree to the CLA: the same wherever
// it's quoted, or someone copies a version that doesn't match
const AGREE = "I have read the Contributor Licence Agreement (CLA.md) and I agree to it.";

test("one licence everywhere: AGPL-3.0-only", () => {
	assert.match(read("LICENSE"), /^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
	assert.equal(JSON.parse(read("package.json")).license, "AGPL-3.0-only");
	assert.equal(JSON.parse(read("package-lock.json")).packages[""].license, "AGPL-3.0-only");

	const readme = read("README.md");
	const section = readme.slice(readme.indexOf("## Licence"));
	assert.ok(section.includes("AGPL-3.0-only"), "the README says so");
	assert.ok(!/\bMIT\b|\bISC\b/.test(section), "and nothing else");
	assert.ok(section.includes("Copyright (C) 2026 Tanzim Ahmed"));
});

test("LICENSING.md: the Resources permission and the additional terms, in full", () => {
	const text = read("LICENSING.md");
	assert.ok(text.includes("Additional permission under GNU AGPL version 3 section 7"));
	assert.ok(text.includes("without those Resources being covered by the GNU\n> Affero General Public License"), "a Resource is its own work");
	assert.ok(text.includes("Additional terms under GNU AGPL version 3 section 7"));
	assert.ok(text.includes("Modified versions must be marked as different"), "7(c)");
	assert.ok(text.includes("No rights to the names"), "7(e)");
	assert.ok(text.includes("All rights reserved"), "the docs");
	assert.ok(text.includes("Permission to use, copy, modify, and/or distribute this software for\n> any purpose with or without fee is hereby granted."), "0BSD for the code examples, its text included");
	assert.ok(text.includes("github.com/tanzim2000"), "where to ask for other licences");
});

test("TRADEMARKS.md names every name", () => {
	const text = read("TRADEMARKS.md");
	for (const name of ["Omnia", "OmniCore", "OmniView", "OmniVision", "OmniSync", "OmniAccess", "OmniView REVIVE", "OmniSense"]) {
		assert.ok(text.includes(name), name);
	}
	assert.ok(text.includes("None is registered, so ® is not\nused"), "™ only, nothing claimed that isn't so");
});

test("the CLA: agreed to with one sentence, quoted the same everywhere", () => {
	assert.ok(read("CLA.md").includes(AGREE));
	assert.ok(read("CONTRIBUTING.md").includes(AGREE));
	assert.ok(read(".github/pull_request_template.md").includes(AGREE));
	assert.ok(read("CLA.md").includes("**You keep the\ncopyright to your contribution.**"));
	assert.ok(read("CONTRIBUTING.md").includes("Nothing from outside is merged until that comment is there."));
});

test("the docs say they're all rights reserved, with code examples 0BSD", () => {
	for (const file of fs.readdirSync(path.join(ROOT, "docs")).filter((name) => name.endsWith(".md"))) {
		const text = read(path.join("docs", file));
		const top = text.split("\n").slice(0, 8).join("\n");
		assert.ok(top.includes("All rights reserved") && top.includes("0BSD"), `docs/${file}`);
	}
	assert.ok(read("scripts/docs/layout.js").includes("Docs all rights reserved, code examples 0BSD."), "and the docs site's footer");
});

test("the licence files go into the image, and the About page shows the notice", () => {
	assert.ok(read("Dockerfile").includes("COPY LICENSE LICENSING.md TRADEMARKS.md ./"));
	const ignore = read(".dockerignore");
	assert.ok(ignore.includes("!LICENSING.md") && ignore.includes("!TRADEMARKS.md"), "not left out by *.md");

	const about = read("core/about-face.js");
	assert.ok(about.includes("Free software under the"), "the Appropriate Legal Notices the AGPL asks for");
	assert.ok(about.includes("Omnia and OmniCore are trademarks of Tanzim Ahmed."));
});

test("no long dash in the new files people read", () => {
	for (const file of ["LICENSING.md", "TRADEMARKS.md", "CLA.md", "CONTRIBUTING.md", ".github/pull_request_template.md"]) {
		assert.ok(!read(file).includes("—"), file);
	}
});
