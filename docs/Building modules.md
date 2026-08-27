# Building a module for OmniCore

This is a practical guide to writing a module. If you want the reasoning
behind the design rather than instructions for using it, read
`docs/ARCHITECTURE.md` first — this guide assumes you've either read that or
don't need to.

By the end of this you'll have a working module, understand richness well
enough to use it properly, and know the handful of rules that keep a module
playing fairly with themes it's never seen.

---

## 1. The shape of a module

A module is a folder under `modules/`. At minimum:

```
modules/my-module/
└── index.js
```

`index.js` exports exactly one function:

```js
module.exports = async function (config, richness) {
	return {
		title: "My Module",
		content: [ /* blocks — see §3 */ ],
		updated: new Date().toISOString()
	};
};
```

That's it. No routes, no HTML, no imports of Express. OmniCore finds your
folder, calls your function, and does everything else — routing, caching
your response's images, handing your output to whichever theme is
displaying it.

**`config`** is your module's settings for this particular instance,
already resolved against your schema's defaults (§4). If you declared no
settings, this is `{}`.

**`richness`** is a number from 1 to 100, always present, telling you how
much room there is to fill. This is the part most guides for tile-based
systems skip, and it's the part that matters most here — §2 is entirely
about it.

You return a `title` (shown as the tile's heading unless the instance has
its own label, which wins), a `content` array of blocks, and an `updated`
timestamp.

---

## 2. Richness — the one thing to actually understand

### The problem it solves

A dashboard has tiles of different sizes. A naive design would let each
theme trim your content to fit — cut rows until it stops overflowing. That
sort of worked for the first few modules built here, and it produces bad
results: information gets sliced off arbitrarily, "wide" and "large" tiles
end up looking the same because trimming can't tell the difference between
"a little too much" and "a lot too much," and every theme has to reimplement
the same guesswork.

### The actual design

**You decide what your module shows at any given size. Not the theme.**

Every time OmniCore calls your function, it also tells you a number from 1
to 100 — how much room the tile asking has. **What that number means is
entirely up to you.** You define your own scale, with as many steps as
actually make sense for your content. Two is fine. Twenty is fine, if you
genuinely have that much to say. More steps is not automatically better —
pick steps around what's actually useful to see, not evenly-spaced filler.

Here's `modules/prayer-times`, in full, as the reference example — it has
exactly four steps:

| Richness | Returns |
| --- | --- |
| 1–24 | The next prayer's time. Nothing else. |
| 25–49 | That time, plus which prayer it is. |
| 50–79 | The above, plus the two prayers after it. |
| 80–100 | The above, plus the entire day. |

```js
const content = [
	{ type: "text", emphasis: "primary", value: formatTime(next) }
];

if (richness >= 25) {
	content.push({ type: "text", emphasis: "secondary", value: nextName });
}

if (richness >= 80) {
	for (const prayer of ALL_FIVE) {
		content.push({ type: "pair", label: prayer, value: formatTime(prayer) });
	}
} else if (richness >= 50) {
	for (const prayer of NEXT_TWO) {
		content.push({ type: "pair", label: prayer, value: formatTime(prayer) });
	}
}
```

### Why this split works across themes with nothing in common

The theme side of this is symmetrical to yours. A theme has its own
vocabulary for sizes — named steps, a number, or no concept of size at all —
and *it* decides which richness number to ask for, based on how much room
a given size actually has. `windows8`, for example, hardcodes:

| Its size | Asks your module for |
| --- | --- |
| Small | 10 |
| Medium | 35 |
| Wide | 65 |
| Large | 95 |

**Neither side ever learns the other's vocabulary.** You never find out
whether "65" came from a tile called "Wide," a slider at 65%, or a theme
that just always asks for 65. The theme never finds out what your numbers
mean, only that a higher one gets more content. That's what lets one module
work correctly in a theme with four named sizes and another theme with a
0–100 slider and a third theme with no size concept at all — they can't
break each other because there's no shared vocabulary to disagree about.

### What if you ignore it?

Nothing stops you — a module that always returns everything regardless of
`richness` still runs. But it will overflow small tiles (themes trim as a
safety net, so nothing actually breaks the layout, but the trimming is
blind and will cut your content wherever it happens to run out of room,
which usually isn't where you'd choose). Honoring richness is the module
contract, not something OmniCore enforces at the code level — same as
nothing stops a module from returning malformed data. It's the standard
your module will be judged against.

---

## 3. Content blocks

You describe *what you have*, never *how it should look*. No colors, no
sizes, no HTML. That decision belongs entirely to the theme, and it's what
lets any theme render any module without knowing what the module does.

The current block types:

```js
{ type: "text",       value, emphasis: "primary" | "secondary" | "body" }
{ type: "quote",      value }
{ type: "pair",       label, value }
{ type: "image",      url, alt, fit: "cover" | "contain" }
{ type: "background", url }
{ type: "progress",   value: 0..1, label }
```

**`image` vs `background`** — both carry a picture, but they mean different
things. An `image` is content that belongs inside your tile. A `background`
is a picture meant to sit behind *everything on the dashboard*, not just
your tile — a theme may offer to use it as wallpaper. Use whichever matches
what you're actually providing; a wallpaper-style module (Bing's picture of
the day, say) should emit both, since it's simultaneously a tile's content
and a candidate for the page background.

**Image URLs are handled for you.** Just put a real, reachable URL in
`block.url`. OmniCore proxies it — fetching and caching it server-side —
so the display never talks to wherever your image actually came from. You
don't do anything differently; this happens automatically to every `image`
and `background` block.

**A block's `text` field is optional and you can usually skip it.**
OmniCore derives a plain-text fallback for any block that doesn't supply
one — that's what lets a theme render a block type it's never heard of
(new types get added over time) without breaking. You only need to set
`text` yourself if the derived version wouldn't make sense.

### If you don't want to think in blocks yet

You can return the older flat shape instead, and OmniCore converts it for
you:

```js
return {
	title: "My Module",
	primary: "72°F",
	secondary: "Partly cloudy",
	details: [
		{ label: "Humidity", value: "58%" },
		{ label: "Wind", value: "12 mph" }
	],
	updated: new Date().toISOString()
};
```

This is a fine way to get started, but it has no way to express richness,
images, or anything beyond one number and a list of pairs. Move to `content`
blocks once you want more than that.

---

## 4. Settings

If your module needs configuration — an API region, a city, a refresh
interval — declare it. Don't build your own settings UI; OmniCore renders
one from your declaration, which is what keeps every module's settings page
looking the same.

`modules/my-module/settings.json`:

```json
{
	"settings": [
		{
			"key": "refreshMinutes",
			"label": "Refresh every",
			"type": "number",
			"default": 15,
			"help": "Minutes between calls. Lower means more calls."
		},
		{
			"key": "units",
			"label": "Units",
			"type": "select",
			"options": ["Celsius", "Fahrenheit"],
			"default": "Celsius"
		}
	]
}
```

Available `type`s: `text`, `url`, `number`, `password`, `boolean`, `select`
(needs `options`), `color`, `location`, `instance`.

Every field can carry `default`, `help` (a one-line explanation shown under
the field), and `showWhen: { key, equals }` to hide it unless another field
has a matching value — useful for "only show this when that mode is on."

Your function receives the resolved values as `config[key]`, with defaults
already filled in for anything unset.

### The `location` type

If your module needs coordinates, declare a field of type `location` rather
than asking the user to type in latitude/longitude yourself:

```json
{ "key": "location", "label": "Location", "type": "location" }
```

You'll receive `config.location` as either `{ latitude, longitude, label }`
or `null`. You never find out whether that came from OmniCore's own IP-based
detection, a city the user searched for, or coordinates typed in by hand —
and you shouldn't try to. **Always handle the `null` case** — it means
location services are off, or nothing could be determined. Return a normal
envelope explaining that; don't throw.

```js
if (!config.location) {
	return {
		title: "My Module",
		content: [
			{ type: "text", emphasis: "primary", value: "—" },
			{ type: "text", emphasis: "secondary", value: "No location" }
		],
		updated: new Date().toISOString()
	};
}
```

---

## 5. `module.json`

Optional, but worth having:

```json
{
	"name": "Bing Wallpaper",
	"description": "Bing's picture of the day",
	"provides": ["background", "image"],
	"tile": false
}
```

| Field | Meaning |
| --- | --- |
| `name` | Readable name, shown wherever your module appears in settings. Falls back to the folder name if you skip this. |
| `description` | One line. |
| `provides` | Which block types you can emit. This is what lets OmniCore correctly offer your module wherever something needs a `background` — a theme's wallpaper picker uses this to *not* offer, say, a Docker status module. Only list what you actually emit. |
| `tile` | Set to `false` if your module is meant to work invisibly — feeding a background, say, with nothing worth putting on screen itself. Instances of it start hidden by default; the user can still turn a tile on for it if they want to. |

---

## 6. Calling the network

**Use `core/module-fetch.js` instead of calling `fetch()` yourself.**

```js
const { fetchCached } = require("../../core/module-fetch");

const { data, stale } = await fetchCached(url, {
	cacheSeconds: 300,   // default 300 — how long a cached answer stays fresh
	timeoutSeconds: 10,  // default 10 — give up after this long
	as: "json",          // default "json"; use "text" for non-JSON responses
	key: "custom-key"    // optional — defaults to the URL itself
});
```

This one call gets you three things you would otherwise have to build
yourself, and every module gets them for free:

- **Caching.** A dashboard polls every few seconds. Without this, that's
  hundreds of calls an hour to whatever API you're using — a fast way to
  get your users rate-limited, or banned, by a free service. Set
  `cacheSeconds` to something sane for how often your data actually
  changes: weather every 10 minutes, prayer times every few hours.
- **Timeouts.** Plain `fetch()` waits forever if a service hangs. This one
  gives up after `timeoutSeconds` so a dead API doesn't leave a tile
  hanging indefinitely.
- **Stale-beats-nothing.** If the service is briefly unreachable,
  `fetchCached` hands back the last good answer instead of nothing, and
  sets `stale: true` so you know. On a wall display, a twenty-minute-old
  temperature reads better than a blank tile — use `stale` to append
  something like "(last known)" if you want to be transparent about it.

`data` is `null` if nothing has ever succeeded. Always check for that:

```js
if (!data) {
	return {
		title: "My Module",
		content: [
			{ type: "text", emphasis: "primary", value: "—" },
			{ type: "text", emphasis: "secondary", value: "Not reachable" }
		],
		updated: new Date().toISOString()
	};
}
```

---

## 7. Failure is a return value, not an exception

If your function throws, OmniCore catches it, and the user sees one dead
tile rather than the whole face breaking — but that's a safety net, not a
design pattern to lean on. **Prefer returning a real envelope that explains
what's wrong**, the way the examples above do. It's more informative and
it's what a well-behaved module does.

Things worth explicitly handling rather than letting throw:

- The API you depend on being unreachable
- A `location` field that came back `null`
- Settings that don't add up to something usable (a blank required field,
  say)

---

## 8. Two ground rules

**Never render.** No HTML, no inline styles, no assumptions about color or
layout. The moment a module bakes in appearance, no theme can restyle it,
and "any theme renders any module" — the entire point of the split — stops
being true for yours.

**Never touch the server.** No `require("express")`, no defining routes, no
reading files outside your own settings. OmniCore owns all of that. Modules
are trusted backend code — nothing stops you technically, the same way
nothing stops any Node script from doing whatever it wants — but doing so
breaks the architecture and won't be accepted anywhere modules get
distributed from.

---

## 9. A complete example

A module reporting a countdown to some event, showing progressively more
detail at higher richness, with a configurable target date:

```js
// modules/countdown/index.js

module.exports = async function countdown(config, richness) {
	if (!config.targetDate) {
		return {
			title: "Countdown",
			content: [
				{ type: "text", emphasis: "primary", value: "—" },
				{ type: "text", emphasis: "secondary", value: "No date set" }
			],
			updated: new Date().toISOString()
		};
	}

	const target = new Date(config.targetDate);
	const now = new Date();
	const msRemaining = target - now;

	if (msRemaining <= 0) {
		return {
			title: config.label || "Countdown",
			content: [{ type: "text", emphasis: "primary", value: "Today" }],
			updated: new Date().toISOString()
		};
	}

	const days = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

	const content = [
		{ type: "text", emphasis: "primary", value: days + "d" }
	];

	// 25+: say what it's counting down to
	if (richness >= 25) {
		content.push({
			type: "text",
			emphasis: "secondary",
			value: config.label || "days to go"
		});
	}

	// 60+: break it down further
	if (richness >= 60) {
		const hours = Math.floor((msRemaining / (1000 * 60 * 60)) % 24);
		content.push({ type: "pair", label: "Hours", value: String(hours) });
	}

	// 85+: the exact target date
	if (richness >= 85) {
		content.push({
			type: "pair",
			label: "Target",
			value: target.toLocaleDateString()
		});
	}

	return {
		title: config.label || "Countdown",
		content: content,
		updated: new Date().toISOString()
	};
};
```

```json
// modules/countdown/settings.json
{
	"settings": [
		{
			"key": "targetDate",
			"label": "Target date",
			"type": "text",
			"default": "",
			"help": "YYYY-MM-DD"
		},
		{
			"key": "label",
			"label": "What's it counting down to?",
			"type": "text",
			"default": ""
		}
	]
}
```

```json
// modules/countdown/module.json
{
	"name": "Countdown",
	"description": "Days remaining until a date you set"
}
```

Three richness tiers, no network calls, no location, nothing exotic — just
the pattern applied.

---

## 10. Checklist before you call it done

- [ ] Function signature is `(config, richness)`
- [ ] `richness` actually changes what you return, at more than one point
- [ ] Every path returns a valid envelope, including failure cases —
      nothing relies on throwing
- [ ] Outbound HTTP goes through `fetchCached`, with a `cacheSeconds` that
      matches how often your data actually changes
- [ ] No HTML, no styling, no layout decisions anywhere in your output
- [ ] `module.json` exists with an honest `provides` list if you emit
      `image` or `background`
- [ ] Settings are declared in `settings.json`, not asked for any other way
- [ ] A `location` field's `null` case is handled, if you use one