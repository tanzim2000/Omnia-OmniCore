// core/place-search-ui.js
// The browser half of place search (see place-search.js): what a "Search
// for a city" box does with the answer. Shared by the three pages that
// have one: the Location Service on the settings page, a widget's
// location setting, and the setup wizard. Before v2 each had its own copy.
//
// Under the matches go two small lines:
//
//   - a note when the Secondary was asked, saying why ("Open-Meteo found
//     nothing, so Nominatim (OpenStreetMap) was asked."), or why nothing
//     could be found
//   - the credit for whoever found them, linked, with "© OpenStreetMap
//     contributors" for the services built on OpenStreetMap. Several of
//     them only allow their results to be shown with it.
//
// Picking a match hands it to the page (onPick), and the credit stays
// under the box: the place's name came from that service.

// Runs in the browser. Defines findPlaces(query, results, onPick):
//
//   query     what was typed
//   results   the element the matches are drawn in: right after the row
//             with the search box, in the same parent
//   onPick    called with { label, latitude, longitude } when one is picked
//
// Since the v2 test run the matches float: a glass list dropping from
// under the search box, over the page, so nothing on the page moves (in
// a box spanning two rows it used to push the whole tab around). About
// five rows show, then it scrolls. It closes on a pick, on Escape, or on
// a click anywhere else. After a pick, only the credit stays, under the
// box, in the page: the place's name came from that service.
const PLACE_SEARCH_SCRIPT = `
	function placeText(text) {
		return String(text)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	// The credit line for whoever answered. Only addresses that start
	// with https:// become links.
	function placeCredit(credit) {
		if (!credit) return "";

		function link(text, url) {
			return /^https:\\/\\//.test(url || "")
				? '<a href="' + placeText(url) + '" target="_blank" rel="noopener noreferrer">' + placeText(text) + "</a>"
				: placeText(text);
		}

		var own = link(credit.text, credit.url);

		var osm = credit.osm ? " · " + link(credit.osm.text, credit.osm.url) : "";

		return '<p class="place-credit">' + own + osm + "</p>";
	}

	// Open the floating list under the search row, or close it. The box it
	// sits in is lifted above the boxes after it while it's open, or they'd
	// be drawn over the list.
	function placeFloat(results, open) {
		var box = results.closest(".segment");
		results.parentElement.classList.add("place-anchor");

		if (open) {
			var row = results.previousElementSibling;
			results.style.top = row ? row.offsetTop + row.offsetHeight + 6 + "px" : "";
			results.classList.add("place-float");
			if (box) box.classList.add("float-open");
		} else {
			results.classList.remove("place-float");
			results.style.top = "";
			if (box) box.classList.remove("float-open");
		}
	}

	function closePlaces(results) {
		if (!results.classList.contains("place-float")) return;
		placeFloat(results, false);
		results.innerHTML = "";
	}

	async function findPlaces(query, results, onPick) {
		placeFloat(results, true);
		results.innerHTML = '<div class="empty place-empty">Searching…</div>';

		var answer;

		try {
			var response = await fetch("/geocode?q=" + encodeURIComponent(query));
			answer = await response.json();
		} catch (error) {
			results.innerHTML = '<div class="empty place-empty">Search failed.</div>';
			return;
		}

		var places = (answer && Array.isArray(answer.places)) ? answer.places : [];
		var html = places.length
			? places.map(function (place, index) {
				return '<button type="button" class="result" data-place-pick="' + index + '">' +
					placeText(place.label) + "</button>";
			}).join("")
			: '<div class="empty place-empty">Nothing found.</div>';

		if (answer && answer.note) {
			html += '<p class="place-note">' + placeText(answer.note) + "</p>";
		}

		var credit = placeCredit(answer && answer.credit);
		results.innerHTML = html + credit;

		results.querySelectorAll("[data-place-pick]").forEach(function (button) {
			button.addEventListener("click", function (event) {
				event.preventDefault();
				onPick(places[Number(button.dataset.placePick)]);
				// The matches go; the credit stays, in the page, since the
				// name came from that service
				placeFloat(results, false);
				results.innerHTML = credit;
			});
		});
	}

	// Closing: a click anywhere outside the list and its search row, or
	// Escape. Set up once, whichever page this script is on.
	if (!window.placeSearchWired) {
		window.placeSearchWired = true;

		document.addEventListener("pointerdown", function (event) {
			document.querySelectorAll(".place-float").forEach(function (results) {
				if (!results.parentElement.contains(event.target)) closePlaces(results);
			});
		});

		document.addEventListener("keydown", function (event) {
			if (event.key !== "Escape") return;
			document.querySelectorAll(".place-float").forEach(function (results) {
				var input = results.parentElement.querySelector("input");
				closePlaces(results);
				if (input) input.focus();
			});
		});
	}
`;

// The floating list, and the two small lines under the matches
const PLACE_SEARCH_CSS = `
	.place-anchor { position: relative; }

	/* While open: over the page, under its search row (top is set by the
	   script). The box it's in is lifted above the boxes after it. Its own
	   fill is mostly solid: it sits over other boxes' text, and a box's
	   blur only reaches what's inside that box. */
	.place-float {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 30;
		max-height: 19em;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border-radius: 0.75em;
		border: 1px solid var(--segment-border);
		background-color: color-mix(in srgb, var(--bg) 94%, transparent);
		background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
		box-shadow: inset 0 1px 0 var(--segment-edge), 0 12px 36px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		scrollbar-width: thin;
		scrollbar-color: var(--scroll-thumb) transparent;
	}

	.place-float .result { margin: 0; flex-shrink: 0; }
	.place-float .place-note, .place-float .place-credit { margin: 4px 6px; }
	.place-empty { margin: 6px; }
	.segment.float-open { position: relative; z-index: 20; }

	.place-note, .place-credit {
		margin: 8px 0 0;
		font-size: 0.78em;
		line-height: 1.5;
		color: var(--fg-muted);
	}

	.place-credit a { color: inherit; }
	.place-credit a:hover { color: var(--fg); }
`;

module.exports = { PLACE_SEARCH_SCRIPT, PLACE_SEARCH_CSS };
