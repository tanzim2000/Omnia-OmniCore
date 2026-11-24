// test/reporter.js
// How `npm test` prints what happened: one line per test file, and the
// failures in full, rather than every single test scrolling past.
//
//   ✔ network-page      18 passed
//   ✖ settings-home     30 passed, 1 failed
//       ✖ the notch has a tab for each pane
//         Expected values to be strictly equal: 3 !== 4
//         test/settings-home.test.js:42
//
//   42 files: 41 passed, 1 failed (settings-home). 1,203 tests in 48s.
//
// Every file runs, even after one fails, so the last line always says
// how all of them went. A failing file also shows the last lines it
// printed, which is usually where the reason is.
//
// Node's test runner hands a reporter every event as it happens (a test
// passed, a test failed, a file printed something); this one gathers them
// by file and prints each file's line when the next one starts. For the
// whole long report instead, run `npm run test:full`.

"use strict";

const path = require("path");

// Colours only on a terminal, and never when NO_COLOR is set
const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColour ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (text) => paint(32, text);
const red = (text) => paint(31, text);
const quiet = (text) => paint(2, text);
const bold = (text) => paint(1, text);

// "test/network-page.test.js" -> "network-page"
function shortName(file) {
	if (!file) return "(no file)";
	return path.basename(file).replace(/\.test\.js$/, "");
}

// The words that say why a test failed: the assertion's own message,
// a few lines of it at most
function reasonOf(error) {
	if (!error) return [];
	const cause = error.cause || error;
	const message = String((cause && cause.message) || cause || "").trim();
	const lines = message.split("\n").filter((line) => line.trim() !== "");
	return lines.length > 8 ? [...lines.slice(0, 8), "..."] : lines;
}

module.exports = async function* reporter(source) {
	const started = Date.now();
	const files = new Map();
	const printed = new Set();
	let current = null;

	function fileEntry(name) {
		if (!files.has(name)) {
			files.set(name, { passed: 0, failed: 0, skipped: 0, failures: [], output: [] });
		}
		return files.get(name);
	}

	// The line for one file, and its failures under it
	function report(name) {
		printed.add(name);
		const file = files.get(name);
		const counts = [`${file.passed} passed`];
		if (file.failed) counts.push(`${file.failed} failed`);
		if (file.skipped) counts.push(`${file.skipped} skipped`);
		const label = shortName(name).padEnd(22);

		if (!file.failed) {
			return `  ${green("✔")} ${label} ${quiet(counts.join(", "))}\n`;
		}

		let text = `  ${red("✖")} ${bold(label)} ${counts.join(", ")}\n`;
		for (const failure of file.failures) {
			text += `      ${red("✖ " + failure.name)}\n`;
			for (const line of failure.reason) text += `        ${line}\n`;
			if (failure.where) text += `        ${quiet(failure.where)}\n`;
		}
		if (file.output.length) {
			// The first error it printed (a file that couldn't even start
			// says why here), then the last few lines
			const firstError = file.output.find((line) => /\b\w*Error\b/.test(line));
			const last = file.output.slice(-8);
			const lines = firstError && !last.includes(firstError) ? [firstError, "...", ...last] : last;
			text += `      ${quiet("What it printed:")}\n`;
			for (const line of lines) text += `        ${quiet(line)}\n`;
		}
		return text;
	}

	for await (const event of source) {
		const data = event.data || {};
		if (!["test:pass", "test:fail", "test:stdout", "test:stderr"].includes(event.type)) continue;

		const name = data.file ? path.relative(process.cwd(), data.file) : current || "(no file)";

		// A new file has started: the one before it is finished
		if (current && name !== current && !printed.has(current)) yield report(current);
		current = name;
		const file = fileEntry(name);

		if (event.type === "test:stdout" || event.type === "test:stderr") {
			for (const line of String(data.message).split("\n")) {
				if (line.trim()) file.output.push(line);
			}
			continue;
		}

		// A group of tests passes or fails with what's inside it, so only
		// the tests themselves are counted
		const details = data.details || {};
		if (details.type === "suite") continue;

		if (event.type === "test:pass") {
			if (data.skip || data.todo) file.skipped++;
			else file.passed++;
			continue;
		}

		// A test that failed only because one inside it did: the inner
		// one is the one to read about
		if (details.error && details.error.failureType === "subtestsFailed") continue;

		file.failed++;
		file.failures.push({
			name: data.name,
			reason: reasonOf(details.error),
			where: data.line ? `${name}:${data.line}` : ""
		});
	}

	if (current && !printed.has(current)) yield report(current);

	// The last line: how all of it went
	const names = [...files.keys()];
	const failedFiles = names.filter((name) => files.get(name).failed);
	const tests = names.reduce((sum, name) => sum + files.get(name).passed + files.get(name).failed, 0);
	const seconds = Math.round((Date.now() - started) / 1000);
	const testWord = `${tests.toLocaleString("en-US")} tests in ${seconds}s.`;

	const fileWord = `${names.length} ${names.length === 1 ? "file" : "files"}`;

	if (failedFiles.length) {
		yield `\n  ${red(bold(`${fileWord}: ${names.length - failedFiles.length} passed, ${failedFiles.length} failed`))} ${red(`(${failedFiles.map(shortName).join(", ")}).`)} ${quiet(testWord)}\n`;
	} else {
		yield `\n  ${green(bold(`${fileWord}: all passed.`))} ${quiet(testWord)}\n`;
	}
};
