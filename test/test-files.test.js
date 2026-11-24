// test/test-files.test.js
// In short: Every test file says what it checks
//
// `npm test` prints one line per test file, ending in a few words about
// what that file checks (test/reporter.js). Those words are the file's own
// "In short:" line, the second line of the file, right under its name:
//
//   // test/qr.test.js
//   // In short: QR codes
//
// A file's name is short for whoever wrote it, and doesn't always say
// much to anyone else (backdrop and background test different things).
// So a new test file without that line fails here, rather than printing
// a bare name.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Long enough to say something, short enough to fit on the line
const LONGEST = 60;

const testFiles = fs
	.readdirSync(__dirname)
	.filter((name) => name.endsWith(".test.js"))
	.sort();

test("every test file has an In short line, right under its name", () => {
	const missing = testFiles.filter((name) => {
		const lines = fs.readFileSync(path.join(__dirname, name), "utf-8").split("\n");
		return lines[0] !== `// test/${name}` || !/^\/\/ In short: \S/.test(lines[1]);
	});

	assert.deepEqual(missing, [], 'line 1: "// test/<name>.test.js", line 2: "// In short: <what it checks>"');
});

test("every In short line fits on the report's line", () => {
	const tooLong = testFiles.filter((name) => {
		const line = fs.readFileSync(path.join(__dirname, name), "utf-8").split("\n")[1] || "";
		return line.replace("// In short: ", "").length > LONGEST;
	});

	assert.deepEqual(tooLong, [], `${LONGEST} characters at most`);
});
