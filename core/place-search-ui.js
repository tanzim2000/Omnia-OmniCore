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
//   results   the element the matches are drawn in
//   onPick    called with { label, latitude, longitude } when one is picked
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

		// Google's name is written exactly so, and never translated
		var own = credit.google
			? '<span translate="no">' + placeText(credit.text) + "</span>"
			: link(credit.text, credit.url);

		var osm = credit.osm ? " · " + link(credit.osm.text, credit.osm.url) : "";

		return '<p class="place-credit">' + own + osm + "</p>";
	}

	async function findPlaces(query, results, onPick) {
		results.innerHTML = '<div class="empty" style="margin-top:8px">Searching…</div>';

		var answer;

		try {
			var response = await fetch("/geocode?q=" + encodeURIComponent(query));
			answer = await response.json();
		} catch (error) {
			results.innerHTML = '<div class="empty" style="margin-top:8px">Search failed.</div>';
			return;
		}

		var places = (answer && Array.isArray(answer.places)) ? answer.places : [];
		var html = places.length
			? places.map(function (place, index) {
				return '<button type="button" class="result" data-place-pick="' + index + '">' +
					placeText(place.label) + "</button>";
			}).join("")
			: '<div class="empty" style="margin-top:8px">Nothing found.</div>';

		if (answer && answer.note) {
			html += '<p class="place-note">' + placeText(answer.note) + "</p>";
		}

		var credit = placeCredit(answer && answer.credit);
		results.innerHTML = html + credit;

		results.querySelectorAll("[data-place-pick]").forEach(function (button) {
			button.addEventListener("click", function (event) {
				event.preventDefault();
				onPick(places[Number(button.dataset.placePick)]);
				// The matches go; the credit stays, since the name came
				// from that service
				results.innerHTML = credit;
			});
		});
	}
`;

// The two small lines under the matches
const PLACE_SEARCH_CSS = `
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
