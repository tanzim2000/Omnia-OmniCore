// core/priority-ui.js
// How a `priority` setting (an "Info order") is drawn and moved, the same
// on a widget's page and in the setup wizard.
//
// A short list (4 items or fewer) is drawn in place: the rows themselves,
// numbered, each with a grip to drag it by and arrows to move it one step.
// On a widget's page it gets a box of its own (see the widget page in
// admin-face.js).
//
// A longer list would push everything else off the screen (Weather's are
// 10 to 13 items), so it's drawn as one button instead, saying the order
// in short form: "Temperature, Condition, Alert and 8 more". The button
// opens a pop-up with the whole list, where the rows are dragged or moved
// with the arrows, then kept with Done or thrown away with Cancel.
//
// Either way the order is stored in a hidden input as JSON, so the save
// code on every page reads it off .value like any text box, with no
// special case. The pop-up only writes to that input when Done is
// pressed.
//
// WHY THE FUNCTIONS ARE WRITTEN THIS WAY
//
// The wizard draws its form in the browser, the widget page on the
// server. Rather than two copies that drift apart, the drawing functions
// below are plain functions with no outside variables, so the wizard can
// be sent their source (fn.toString()) and run the very same code. That's
// why they take `escape` as an argument instead of using a shared helper.
//
// Dragging uses pointer events, which work the same for a mouse, a pen
// and a finger. A mouse can drag a row from anywhere on it; a finger only
// by the grip, so that a finger brushing the list still scrolls the page.

// Up to this many items are drawn in place. One more, and it's a button.
const INLINE_MAX = 4;

// "Temperature, Condition, Alert and 8 more". The first three, then a
// count of the rest. A list of three or fewer is just written out.
function prioritySummary(order) {
	if (order.length <= 3) {
		return order.join(", ");
	}

	return order.slice(0, 3).join(", ") + " and " + (order.length - 3) + " more";
}

// The rows of a list, numbered. `escape` makes text safe for HTML.
function priorityRowsHtml(order, escape) {
	// Six dots, the usual sign for "drag me"
	var grip =
		'<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false">' +
		'<circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/>' +
		'<circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/>' +
		'<circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/>' +
		"</svg>";

	return order
		.map(function (item, index) {
			var name = escape(item);

			return (
				'<div class="priority-row" data-priority-item="' + name + '">' +
				'<span class="priority-grip" data-priority-grip title="Drag to move">' + grip + "</span>" +
				'<span class="priority-rank" data-priority-rank>' + (index + 1) + "</span>" +
				'<span class="priority-name">' + name + "</span>" +
				'<button type="button" class="priority-move" data-priority-move="up" ' +
				'title="Move up" aria-label="Move ' + name + ' up">↑</button>' +
				'<button type="button" class="priority-move" data-priority-move="down" ' +
				'title="Move down" aria-label="Move ' + name + ' down">↓</button>' +
				"</div>"
			);
		})
		.join("");
}

// A whole priority setting: the hidden input that holds the order, and
// either the rows (a short list) or the button that opens the pop-up (a
// long one). `owner` is "module" or "theme", whose setting it is.
function priorityFieldHtml(field, order, owner, escape) {
	var store =
		'<input type="hidden" data-key="' + escape(field.key) + '" ' +
		'data-scope="' + escape(owner) + '" data-type="priority" ' +
		'value="' + escape(JSON.stringify(order)) + '">';

	// Written as a number rather than INLINE_MAX: this function is sent to
	// the wizard on its own, without the line above it
	if (order.length <= 4) {
		return "<div data-priority>" + store + priorityRowsHtml(order, escape) + "</div>";
	}

	return (
		'<div data-priority-long data-priority-title="' + escape(field.label || field.key) + '">' +
		store +
		'<button type="button" class="glass priority-open" data-priority-open>' +
		'<span class="priority-summary" data-priority-summary>' + escape(prioritySummary(order)) + "</span>" +
		'<span class="priority-open-hint">Change</span>' +
		"</button>" +
		"</div>"
	);
}

// Everything that runs in the browser: the arrows, dragging, and the
// pop-up. Written as a real function so it's checked like the rest of
// this file; the page gets its source and runs it once.
//
// One listener on the document handles every list on the page. That
// matters in the wizard, which redraws its form on every step:
// listeners on the rows themselves would be lost with them.
function priorityClient() {
	function escape(text) {
		return String(text)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function rowsOf(container) {
		return Array.prototype.slice.call(container.querySelectorAll("[data-priority-item]"));
	}

	function orderOf(container) {
		return rowsOf(container).map(function (row) {
			return row.dataset.priorityItem;
		});
	}

	// After any move: write the order into the hidden input (when the
	// list has one; the pop-up's list doesn't, it waits for Done), number
	// the rows again, and switch off the arrows that can't go further.
	function syncPriority(container) {
		var rows = rowsOf(container);
		var store = container.querySelector("[data-type='priority']");

		if (store) {
			store.value = JSON.stringify(orderOf(container));
		}

		rows.forEach(function (row, index) {
			var rank = row.querySelector("[data-priority-rank]");
			var up = row.querySelector("[data-priority-move='up']");
			var down = row.querySelector("[data-priority-move='down']");

			if (rank) rank.textContent = index + 1;
			if (up) up.disabled = index === 0;
			if (down) down.disabled = index === rows.length - 1;
		});
	}

	// The wizard calls this after drawing a step
	window.syncAllPriorities = function () {
		document.querySelectorAll("[data-priority]").forEach(syncPriority);
	};

	// The arrows: one step up or down
	document.addEventListener("click", function (event) {
		var button = event.target.closest("[data-priority-move]");
		if (!button) return;

		event.preventDefault();

		var container = button.closest("[data-priority]");
		var row = button.closest("[data-priority-item]");
		var rows = rowsOf(container);
		var index = rows.indexOf(row);
		var target = button.dataset.priorityMove === "up" ? index - 1 : index + 1;

		if (target < 0 || target >= rows.length) return;

		if (target < index) {
			container.insertBefore(row, rows[target]);
		} else {
			container.insertBefore(rows[target], row);
		}

		syncPriority(container);

		// Keep the focus on the same arrow, so pressing it again keeps
		// moving the same row. If that arrow just switched off (the row
		// reached the end), the other one takes the focus.
		if (button.disabled) {
			var other = row.querySelector(
				"[data-priority-move='" + (button.dataset.priorityMove === "up" ? "down" : "up") + "']"
			);
			if (other) other.focus();
		} else {
			button.focus();
		}
	});

	// Dragging. The row follows the pointer; whenever it's been pulled
	// more than half way over its neighbour, the two swap places in the
	// list, and the row's offset is corrected so it stays under the
	// pointer. The list itself is always in the real order, so letting
	// go only has to drop the row into place.
	var drag = null;

	// Near the top or bottom edge of a list that scrolls (the pop-up's,
	// or a long page), the list scrolls by itself while a row is held there
	var EDGE = 40;

	function scrollerOf(element) {
		for (var node = element.parentElement; node; node = node.parentElement) {
			var style = getComputedStyle(node);
			if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
				return node;
			}
		}
		return document.scrollingElement || document.documentElement;
	}

	function neighbour(row, direction) {
		var node = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
		while (node && !node.hasAttribute("data-priority-item")) {
			node = direction < 0 ? node.previousElementSibling : node.nextElementSibling;
		}
		return node;
	}

	function place() {
		var row = drag.row;

		// Pulled up past half of the row above: swap
		var above = neighbour(row, -1);
		while (above && drag.offset < -(row.offsetTop - above.offsetTop) / 2) {
			var stepUp = row.offsetTop - above.offsetTop;
			drag.container.insertBefore(row, above);
			drag.offset += stepUp;
			drag.moved = true;
			above = neighbour(row, -1);
		}

		// Pulled down past half of the row below: swap
		var below = neighbour(row, 1);
		while (below && drag.offset > (below.offsetTop - row.offsetTop) / 2) {
			var stepDown = below.offsetTop - row.offsetTop;
			drag.container.insertBefore(below, row);
			drag.offset -= stepDown;
			drag.moved = true;
			below = neighbour(row, 1);
		}

		row.style.transform = "translateY(" + drag.offset + "px)";
	}

	function autoScroll() {
		if (!drag) return;

		var box = drag.scroller === document.scrollingElement || drag.scroller === document.documentElement
			? { top: 0, bottom: window.innerHeight }
			: drag.scroller.getBoundingClientRect();
		var speed = 0;

		if (drag.y < box.top + EDGE) speed = -Math.ceil((box.top + EDGE - drag.y) / 4);
		else if (drag.y > box.bottom - EDGE) speed = Math.ceil((drag.y - (box.bottom - EDGE)) / 4);

		if (speed) {
			var before = drag.scroller.scrollTop;
			drag.scroller.scrollTop = before + speed;

			// The list moved under a still pointer: the row has to move
			// with the pointer, not with the list
			drag.offset += drag.scroller.scrollTop - before;
			place();
		}

		drag.frame = requestAnimationFrame(autoScroll);
	}

	document.addEventListener("pointerdown", function (event) {
		var row = event.target.closest("[data-priority-item]");
		if (!row || drag) return;

		// The main button only, and never when pressing an arrow
		if (event.button !== 0 || event.target.closest("button")) return;

		// A finger or a pen drags by the grip; anywhere else it scrolls
		if (event.pointerType !== "mouse" && !event.target.closest("[data-priority-grip]")) return;

		// Stops the mouse from selecting text while dragging
		event.preventDefault();

		var container = row.closest("[data-priority]");

		drag = {
			row: row,
			container: container,
			pointer: event.pointerId,
			y: event.clientY,
			offset: 0,
			moved: false,
			scroller: scrollerOf(container),
			frame: 0
		};

		row.classList.add("dragging");
		container.classList.add("sorting");
		drag.frame = requestAnimationFrame(autoScroll);
	});

	document.addEventListener("pointermove", function (event) {
		if (!drag || event.pointerId !== drag.pointer) return;

		event.preventDefault();
		drag.offset += event.clientY - drag.y;
		drag.y = event.clientY;
		place();
	});

	function drop(event) {
		if (!drag || event.pointerId !== drag.pointer) return;

		cancelAnimationFrame(drag.frame);
		drag.row.classList.remove("dragging");
		drag.row.style.transform = "";
		drag.container.classList.remove("sorting");

		if (drag.moved) {
			syncPriority(drag.container);
		}

		drag = null;
	}

	document.addEventListener("pointerup", drop);
	document.addEventListener("pointercancel", drop);

	// The pop-up for a long list
	function openList(field) {
		var store = field.querySelector("[data-type='priority']");
		var opener = field.querySelector("[data-priority-open]");
		var order;

		try {
			order = JSON.parse(store.value);
		} catch (error) {
			order = [];
		}

		var backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";

		var panel = document.createElement("div");
		panel.className = "modal priority-modal";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");

		var title = document.createElement("h2");
		title.textContent = field.dataset.priorityTitle || "Order";
		panel.appendChild(title);

		var text = document.createElement("p");
		text.className = "dialog-text";
		text.textContent =
			"Drag a row, or move it with the arrows. What's at the top shows even on the smallest tile.";
		panel.appendChild(text);

		// The same rows as a short list, without a hidden input: nothing
		// is kept until Done
		var list = document.createElement("div");
		list.className = "priority-list";
		list.setAttribute("data-priority", "");
		list.innerHTML = priorityRowsHtml(order, escape);
		panel.appendChild(list);

		var buttons = document.createElement("div");
		buttons.className = "dialog-buttons";

		var cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "glass";
		cancel.textContent = "Cancel";

		var done = document.createElement("button");
		done.type = "button";
		done.className = "glass";
		done.textContent = "Done";

		buttons.appendChild(cancel);
		buttons.appendChild(done);
		panel.appendChild(buttons);
		backdrop.appendChild(panel);
		document.body.appendChild(backdrop);
		syncPriority(list);

		function close() {
			document.removeEventListener("keydown", onKey);
			backdrop.remove();
			if (opener) opener.focus();
		}

		function keep() {
			var chosen = orderOf(list);

			store.value = JSON.stringify(chosen);
			var summary = field.querySelector("[data-priority-summary]");
			if (summary) summary.textContent = prioritySummary(chosen);

			// The same event any other setting fires when it changes
			store.dispatchEvent(new Event("change", { bubbles: true }));
			close();
		}

		function onKey(event) {
			if (event.key === "Escape") close();
		}

		cancel.addEventListener("click", close);
		done.addEventListener("click", keep);

		// A click on the dimmed area outside the panel is Cancel. Only a
		// click that also started there: letting go of a dragged row
		// outside the panel isn't one.
		var downOutside = false;
		backdrop.addEventListener("pointerdown", function (event) {
			downOutside = event.target === backdrop;
		});
		backdrop.addEventListener("click", function (event) {
			if (downOutside && event.target === backdrop) close();
		});

		document.addEventListener("keydown", onKey);
		done.focus();
	}

	document.addEventListener("click", function (event) {
		var opener = event.target.closest("[data-priority-open]");
		if (!opener) return;

		event.preventDefault();
		openList(opener.closest("[data-priority-long]"));
	});

	window.syncAllPriorities();
}

// The script a page includes: the drawing functions, then the browser
// code, run once.
const PRIORITY_SCRIPT = `
	${prioritySummary.toString()}
	${priorityRowsHtml.toString()}
	(${priorityClient.toString()})();
`;

// The look, shared by the widget page and the wizard
const PRIORITY_CSS = `
	/* A reorderable list. Looks like the .option rows, since it's the
	   same kind of choice made a different way. */
	[data-priority] { position: relative; }

	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0.5em 0.6em 0.5em 0.4em;
		border: 1px solid var(--segment-border);
		border-radius: 0.6579em;
		margin-bottom: 8px;
		font-size: 0.95em;
		user-select: none;
		-webkit-user-select: none;
		cursor: grab;
		position: relative;
	}

	.priority-row:last-child { margin-bottom: 0; }

	/* The row being dragged sits above the others and follows the
	   pointer. It's given the page's own colour so the rows it passes
	   over don't show through it. */
	.priority-row.dragging {
		z-index: 2;
		cursor: grabbing;
		border-color: var(--glass-border);
		background: var(--bg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.sorting, .sorting * { cursor: grabbing; }

	.priority-grip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 32px;
		flex: none;
		color: var(--fg-muted);
		fill: currentColor;
		opacity: 0.6;
		/* A finger on the grip drags instead of scrolling the page */
		touch-action: none;
	}

	.priority-row:hover .priority-grip { opacity: 1; }

	.priority-rank {
		color: var(--fg-muted);
		font-size: 0.8em;
		min-width: 16px;
		text-align: right;
	}

	.priority-name { flex: 1; }

	.priority-move {
		appearance: none;
		-webkit-appearance: none;
		width: 32px;
		height: 32px;
		padding: 0;
		margin: 0;
		flex: none;
		font-size: 0.85em;
		line-height: 1;
		cursor: pointer;
		color: inherit;
		border-radius: 0.5882em;
		border: 1px solid var(--segment-border);
		background: var(--glass-bg);
	}

	.priority-move:hover:not(:disabled) { background: var(--glass-bg-hover); }
	.priority-move:disabled { opacity: 0.2; cursor: default; }

	/* A long list's button: the order in short form, and "Change" */
	.glass.priority-open {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
		width: 100%;
		text-align: left;
		padding: 0.75em 1em;
	}

	.priority-summary {
		flex: 1;
		min-width: 0;
		line-height: 1.4;
	}

	.priority-open-hint {
		flex: none;
		color: var(--fg-muted);
		font-size: 0.9em;
	}

	.priority-open-hint::after { content: " ›"; }

	/* The pop-up: taller than a question, and its list scrolls while the
	   heading and the buttons stay put */
	.modal.priority-modal { max-width: 28em; max-height: 85vh; max-height: 85dvh; }

	.priority-list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 2px;
		margin: 0 -2px;
	}
`;

module.exports = {
	INLINE_MAX,
	prioritySummary,
	priorityRowsHtml,
	priorityFieldHtml,
	PRIORITY_SCRIPT,
	PRIORITY_CSS
};
