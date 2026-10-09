// test/notifications.test.js
// What a notification can carry: the Markdown subset its description is
// rendered from, and the link shown beside it as a QR code.
//
// The rendering is checked on what it produces, not on how: every case
// below is something a module could really send. The escaping cases
// matter most -- the overlay puts the rendered description into the page
// as markup, so anything that slips through unescaped here is HTML any
// module could put on every OmniView.

require("./helpers");

const test = require("node:test");
const assert = require("node:assert");

const markdown = require("../core/markdown");
const notifications = require("../core/notifications");
const faceEvents = require("../core/face-events");
const { resetState } = require("./helpers");

test("markdown: bold, italic and code", () => {
	assert.equal(
		markdown.render("**Build** failed on *main*, see `npm test`"),
		"<p><strong>Build</strong> failed on <em>main</em>, see <code>npm test</code></p>"
	);
	assert.equal(markdown.render("__bold__ and _italic_"), "<p><strong>bold</strong> and <em>italic</em></p>");
});

test("markdown: nothing inside a code span is formatted", () => {
	assert.equal(markdown.render("`**not bold**`"), "<p><code>**not bold**</code></p>");
});

test("markdown: arithmetic and snake_case are left alone", () => {
	assert.equal(markdown.render("5 * 3 * 2 = 30"), "<p>5 * 3 * 2 = 30</p>");
	assert.equal(markdown.render("set max_retry_count"), "<p>set max_retry_count</p>");
});

test("markdown: stray markers never leave tags crossed", () => {
	for (const source of ["**a *** b*", "__a ___ b_", "*a **b* c**", "***x***"]) {
		const html = markdown.render(source);
		const open = [];

		for (const [, closing, tag] of html.matchAll(/<(\/?)(strong|em|code|p)>/g)) {
			if (!closing) {
				open.push(tag);
			} else {
				assert.equal(open.pop(), tag, `crossed tags from ${source}: ${html}`);
			}
		}

		assert.equal(open.length, 0, `unclosed tag from ${source}: ${html}`);
	}
});

test("markdown: a subtitle keeps a # that belongs to it", () => {
	assert.equal(markdown.render("# Learn C#"), '<p class="omni-md-subtitle">Learn C#</p>');
	assert.equal(markdown.render("## Title ##"), '<p class="omni-md-subtitle">Title</p>');
});

test("markdown: lists, numbered lists keep their first number, and a subtitle", () => {
	assert.equal(
		markdown.render("## Deploy done\n- api\n- web\n\n3. three\n4. four"),
		'<p class="omni-md-subtitle">Deploy done</p>' +
			"<ul><li>api</li><li>web</li></ul>" +
			'<ol start="3"><li>three</li><li>four</li></ol>'
	);
});

test("markdown: blank lines make paragraphs, single breaks stay breaks", () => {
	assert.equal(markdown.render("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
});

test("markdown: links are not links -- they stay exactly as typed", () => {
	assert.equal(
		markdown.render("[open me](https://example.com)"),
		"<p>[open me](https://example.com)</p>"
	);
	assert.ok(!markdown.render("<a href='x'>hi</a>").includes("<a"));
});

test("markdown: HTML in the source is escaped, wherever it is", () => {
	const hostile = [
		"<script>alert(1)</script>",
		"**<img src=x onerror=alert(1)>**",
		"- <b>in a list</b>",
		"# <i>in a subtitle</i>",
		"`<code>`",
		'quote " and apostrophe \' and & amp',
		'| <b>head</b> | x" y |\n|---|---|\n| <img src=x> | \'q\' |',
		"| a |\n|---|\n" + "| row |\n".repeat(20)
	];

	for (const source of hostile) {
		const html = markdown.render(source);
		const withoutOwnTags = html.replace(
			/<\/?(p|strong|em|code|ul|ol|li|br|table|thead|tbody|tr|th|td)( class="omni-md-subtitle"| class="omni-md-table-more"| start="\d+")?>/g,
			""
		);

		assert.ok(!withoutOwnTags.includes("<"), `unescaped < from ${source}: ${html}`);
		assert.ok(!withoutOwnTags.includes(">"), `unescaped > from ${source}: ${html}`);
		assert.ok(!/["']/.test(withoutOwnTags), `unescaped quote from ${source}: ${html}`);
	}
});

test("markdown: a table, with inline formatting in its cells", () => {
	const html = markdown.render(
		"Build 🎉\n\n| Job | Result |\n| --- | :---: |\n| build | **passed** |\n| a\\|b | `ok` |\nafter"
	);

	assert.equal(
		html,
		"<p>Build 🎉</p>" +
			"<table><thead><tr><th>Job</th><th>Result</th></tr></thead>" +
			"<tbody><tr><td>build</td><td><strong>passed</strong></td></tr>" +
			"<tr><td>a|b</td><td><code>ok</code></td></tr></tbody></table>" +
			"<p>after</p>",
		"emoji pass straight through; \\| is a | in the cell; a line with no | ends the table"
	);
});

test("markdown: not a table unless the dashes match the header", () => {
	// Two header cells, one divider cell
	assert.equal(
		markdown.render("| a | b |\n|---|\n| 1 | 2 |"),
		"<p>| a | b |<br>|---|<br>| 1 | 2 |</p>"
	);

	// A line of dashes on its own is just text
	assert.equal(markdown.render("---\nhello"), "<p>---<br>hello</p>");
});

test("markdown: a table is cut to 6 columns and 11 rows, header included, and says so", () => {
	const header = "|" + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => "h" + n).join("|") + "|";
	const divider = "|" + "---|".repeat(8);
	const rows = [];

	for (let row = 0; row < 14; row++) {
		rows.push("|" + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row + "." + n).join("|") + "|");
	}

	const html = markdown.render([header, divider].concat(rows).join("\n"));

	assert.equal((html.match(/<tr>/g) || []).length, 11, "the header and 10 rows");
	assert.equal((html.match(/<th>/g) || []).length, 6, "6 columns");
	assert.ok(!html.includes("h7"), "the 7th column is gone");
	assert.ok(!html.includes(">10.1<"), "the 11th row under the header is gone");
	assert.ok(
		html.endsWith('<p class="omni-md-table-more">\u20264 more rows and 2 more columns not shown</p>'),
		html.slice(-120)
	);

	// Exactly at the limit: nothing cut, nothing said
	const fits = markdown.render(
		[header.split("|").slice(0, 7).join("|") + "|", "|---|---|---|---|---|---|"]
			.concat(rows.slice(0, 10).map((row) => row.split("|").slice(0, 7).join("|") + "|"))
			.join("\n")
	);

	assert.equal((fits.match(/<tr>/g) || []).length, 11);
	assert.ok(!fits.includes("not shown"));
});

test("markdown: a row wider than the limit says its columns weren't shown", () => {
	const html = markdown.render("|a|b|\n|-|-|\n|1|2|3|4|5|6|7|8|");
	assert.ok(html.endsWith("\u20266 more columns not shown</p>"), html);
});

test("source: one tidy line, cut by whole characters", () => {
	assert.equal(notifications.readSource("  ntfy.sh\n\tsecond "), "ntfy.sh second");
	assert.equal(notifications.readSource("a\u0085b\u202ec\u200bd"), "a bcd", "C1, bidi and zero-width");
	assert.equal(notifications.readSource(42), "");

	// 59 letters then an emoji: the emoji is kept whole at the 60th place
	const cut = notifications.readSource("x".repeat(59) + "🎉🎉");
	assert.equal(Array.from(cut).length, 60);
	assert.ok(cut.endsWith("🎉"));
	assert.ok(!/[\ud800-\udbff]$/.test(cut), "no half an emoji");
});

test("markdown: a short row is filled out, a long one cut to the header", () => {
	assert.equal(
		markdown.render("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |"),
		"<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
			"<tbody><tr><td>1</td><td></td></tr><tr><td>1</td><td>2</td></tr></tbody></table>" +
			'<p class="omni-md-table-more">\u20261 more column not shown</p>'
	);
});

test("markdown: empty, missing and huge descriptions", () => {
	assert.equal(markdown.render(""), "");
	assert.equal(markdown.render(undefined), "");
	assert.equal(markdown.render(null), "");

	const huge = markdown.render("x".repeat(markdown.LONGEST * 3));
	assert.ok(huge.length < markdown.LONGEST + 20, "a huge description is cut short");
});

test("link: http and https become a QR code with the address and title", () => {
	const link = notifications.readLink({ url: "https://ntfy.sh/alerts?x=1", title: "Open the log" });

	assert.equal(link.url, "https://ntfy.sh/alerts?x=1");
	assert.equal(link.title, "Open the log");
	assert.ok(link.svg.startsWith("<svg"), "Core drew the code");
	assert.ok(!link.svg.includes("ntfy"), "the address never appears inside the SVG");

	assert.equal(notifications.readLink("http://home.lan:8080").url, "http://home.lan:8080/");
});

test("link: anything a phone shouldn't open is left off", () => {
	for (const bad of [
		"javascript:alert(1)",
		"data:text/html,<b>x</b>",
		"ftp://example.com/file",
		"https://user:secret@example.com",
		"not a url",
		{ url: "" },
		{ title: "no url" },
		"https://example.com/" + "x".repeat(5000)
	]) {
		assert.equal(notifications.readLink(bad), null, JSON.stringify(bad).slice(0, 60));
	}
});

test("notify: the payload carries the rendered description and the link", () => {
	resetState();

	const sent = [];
	const original = faceEvents.pushToFace;
	faceEvents.pushToFace = (faceId, event, note) => {
		sent.push(note);
		return 1;
	};

	try {
		notifications.notify(4001, {
			title: "Backup finished",
			description: "**3** files, `2 MB`",
			priority: 4,
			link: { url: "https://example.com/report", title: "Report" }
		});

		notifications.notify(4001, { title: "Plain one" });

		// Not a table: a long run of dashes and pipes in a message, cut
		// short, must still come out as text
		notifications.notify(4001, { title: "Odd", description: "|||\n---" });

		// Nothing but invisible NULs is nothing at all: not sent
		assert.equal(notifications.notify(4001, { description: "\u0000\u0000" }), false);
	} finally {
		faceEvents.pushToFace = original;
	}

	assert.equal(sent.length, 3);
	assert.equal(sent[0].description, "**3** files, `2 MB`", "the plain text is kept too");
	assert.equal(sent[0].html, "<p><strong>3</strong> files, <code>2 MB</code></p>");
	assert.equal(sent[0].link.url, "https://example.com/report");
	assert.equal(sent[0].seconds, 45);

	assert.equal(sent[1].html, "");
	assert.equal(sent[1].link, null, "no link means the plain single card");

	assert.equal(sent[2].html, "<p>|||<br>---</p>");
});

test("overlay: the waiting line is capped and says how many were skipped", () => {
	// The cap lives in the browser script; this guards that it's still
	// there and still reported, rather than the queue quietly growing again
	assert.match(notifications.OVERLAY_SCRIPT, /MOST_WAITING = 10/);
	assert.match(notifications.OVERLAY_SCRIPT, /earlier notifications skipped/);
	assert.ok(!/innerHTML = note\.(title|description)/.test(notifications.OVERLAY_SCRIPT),
		"title and plain description are only ever set as text");
});