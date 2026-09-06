# Building a theme for OmniCore

This is a practical guide to writing a theme. If you want the reasoning
behind the design rather than instructions for using it, read
`docs/ARCHITECTURE.md` first — this guide assumes you've either read that or
don't need to. If you're also writing modules, `docs/BUILDING_MODULES.md`
covers the other half of the split this guide keeps referring to.

By the end of this you'll understand the two things that actually matter —
blocks and richness — well enough to build a real theme, plus the handful
of rules that exist to protect the person looking at your theme on their
wall, not to make your life harder.

---

## 1. What a theme actually is

**A theme is a folder of static files. Nothing runs on the server.**

```
themes/my-theme/
├── theme.json               name and description         (optional)
├── settings.json            face-wide settings            (optional)
├── instance-settings.json   per-tile settings              (optional)
└── index.html                the page itself                (required)
```

OmniCore serves `index.html` as-is — no build step, no server-side
templating, nothing evaluated on your behalf. Whatever you write is exactly
what gets sent to the browser (with one small addition — see §6). This
means a theme downloaded from anywhere is safe by construction: it can only
ever render data a face already hands it, because it has no way to reach
anything else.

Your entire job is: fetch what the face gives you, decide how it looks.
That's it. You never touch a database, never write anything back except
through the one narrow path in §8, and never need to know what any
particular module does.

---

## 2. The three calls that give you everything

### `GET /identity`

Call this once, on load. It tells you what you're displaying:

```json
{
  "id": 4001,
  "name": "Living Room",
  "title": "Home",
  "theme": "my-theme",
  "themeConfig": { "accent": "Blue" },
  "instances": [
    {
      "id": "weather-3f2a91bc",
      "module": "weather",
      "label": "Regina",
      "config": { "units": "Celsius" },
      "themeConfig": { "size": "Wide" }
    }
  ]
}
```

A few things worth knowing about this shape:

- **`title` is cosmetic and may be blank.** It's what a human named the
  dashboard for display purposes — not the same as `name`, which is the
  admin's own label and isn't meant for the screen at all. If `title` is
  empty, show no heading. Don't fall back to `name`.
- **`themeConfig` is already resolved for you** — your settings, merged
  with your own declared defaults for anything the user hasn't touched.
  You never see another theme's settings, and you never see the raw
  stored values, only the resolved ones.
- **Each instance's `themeConfig` is separately resolved**, against
  whatever you declared in `instance-settings.json` (§5). This is where a
  tile's size lives, if your theme has a size concept at all.
- **`config` on an instance is the module's own settings** — not yours.
  You'll never need to read it; it's shown here only so the shape is
  complete. Leave it alone.

### `GET /api/<instanceId>?richness=N`

Call this once per instance, every time you refresh. This is where the
actual content comes from.

```json
{
  "title": "Weather",
  "content": [
    { "type": "text", "emphasis": "primary", "value": "17°C" },
    { "type": "text", "emphasis": "secondary", "value": "Cloudy" },
    { "type": "pair", "label": "Humidity", "value": "62%" }
  ],
  "updated": "2026-08-26T18:30:00.000Z"
}
```

`richness` is the one parameter you control, and it's the most important
decision your theme makes — the whole of §4 is about it. `title` here is
already the resolved one (the instance's label if it has one, otherwise
whatever the module called itself) — you don't need to reconcile it with
anything from `/identity`.

### `GET /time`

Not tied to any instance — call it whenever your theme wants to show the
current time itself, with no module involved at all (a corner clock baked
into your own layout, say):

```json
{ "timestamp": "2026-09-06T18:30:00.000Z", "timezone": "America/Regina" }
```

This is the same snapshot a Clock-style module receives through
`omni.time()` on the server side — you're just reaching it directly,
since it's read-only data with nothing to configure and nothing for a
module to usefully sit in front of. See §3's note on `time` blocks for
how to actually tick this forward between calls.

---

## 3. Rendering blocks

A module hands you a list of typed blocks describing _what it has_. You
decide _how it looks_ — colors, layout, animation, everything. That split
is the whole reason any theme can render any module.

The block types you'll see:

```js
{ type: "text",       value, emphasis: "primary" | "secondary" | "body" }
{ type: "quote",      value }
{ type: "pair",       label, value, emphasis: "primary" | "secondary" }
{ type: "image",      url, alt, fit: "cover" | "contain" }
{ type: "background", url }
{ type: "progress",   value: 0..1, label }
{ type: "time",       kind: "clock", timestamp, timezone }
{ type: "graphdata",  points: [ { x, y } ], unit }
```

**You are not required to render every type differently.** A minimal theme
could treat every block the same way and just print its `text` field —
that would work, just plainly.

**You must have a fallback for types you don't recognise.** New block
types get added to OmniCore over time. A module using one you've never
heard of should still show _something_ rather than nothing — every block
carries a `text` field precisely for this:

```js
function renderBlock(block) {
  if (block.type === "text") {
    /* ... */
  }
  if (block.type === "pair") {
    /* ... */
  }
  // ... your known types ...

  // Anything else — including types that don't exist yet
  return block.text ? escapeHtml(block.text) : "";
}
```

Skip this and your theme silently breaks the moment OmniCore ships a new
block type. This is the single most common way a theme goes stale.

**`image` vs `background` mean different things.** An `image` is content
that belongs inside that specific tile. A `background` is a picture meant
for the whole dashboard, offered up as a candidate — nominated by the user
in your `instance` setting (§5), not decided by you or by the module. A
`background` block should never render inside a tile.

**Image URLs are already safe to use directly.** OmniCore has proxied them
before you ever see them — `block.url` points back at OmniCore itself, not
wherever the module actually got the picture from. Just put it in an `<img
src>` or a CSS `background-image`; there's nothing else to do.

**`time` blocks are the one type you're expected to keep ticking
yourself.** Nothing on the server keeps a clock running between your
polls — a module (or `GET /time`) only runs when asked, so the browser
tab you're rendering in is the only thing actually alive continuously.
The pattern:

```js
// On each poll, anchor rather than render directly
let anchor = {
  timestamp: block.timestamp,
  timezone: block.timezone,
  at: Date.now(),
};

setInterval(() => {
  const elapsedMs = Date.now() - anchor.at;
  const now = new Date(new Date(anchor.timestamp).getTime() + elapsedMs);
  render(
    new Intl.DateTimeFormat("en-US", {
      timeZone: anchor.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(now),
  );
}, 1000);
```

Re-anchor quietly on every subsequent poll rather than jumping the
displayed time — that's what keeps small clock drift invisible instead
of visibly correcting itself once a minute. Polling every second instead
of ticking locally still works, it's just wasteful — nothing enforces
this the way nothing enforces honouring richness.

**`graphdata` hands you raw points; how they become a chart is entirely
your call** — bars, a line, dots, whatever fits your theme. There's no
`kind` to branch on the way `time` has one.

---

## 4. Richness — the sizing mechanism

### What it is

Every tile has some amount of space. A module can produce more content
than fits, less content than a large tile could show, or anything in
between — and it has no idea, on its own, which is true for any given
tile. **Richness is the number your theme sends to close that gap.**

It's a plain integer, 1 to 100, that you attach to your fetch:

```
GET /api/weather-3f2a91bc?richness=65
```

**The scale belongs to the module, not to you.** You never learn what a
particular number means to a particular module — only that a higher
number asks for more. A module might have two steps or twenty; that's
entirely its call. Your job is just to decide, for each size your theme
offers, how much you're willing to ask for.

### Deciding your own numbers

This is a design decision you make once per size, hardcoded in your theme
— not something the user configures. Here's the actual mapping from
`windows8`, as a starting point:

```js
const SIZES = {
  small: { richness: 10 },
  medium: { richness: 35 },
  wide: { richness: 65 },
  large: { richness: 95 },
};
```

There's no formula for picking these — they came from looking at what
modules actually returned at each level and adjusting until it looked
right. Expect to do the same. A tile with barely any room shouldn't ask
for much; your largest tile should ask for close to 100, since that's
your best chance of getting the full picture a module has to offer.

### If your theme has no size concept at all

Perfectly valid — some layouts don't have this notion. Just pick one
richness number and always send it. Don't ship `instance-settings.json`
at all in that case (§5); OmniCore will simply not offer a size field for
your theme, and modules will get one consistent number regardless of
anything else.

---

## 5. Settings — face-wide and per-instance

**You never build a settings UI.** You declare what you need, and OmniCore
renders a form from the declaration — in the admin face and in the setup
wizard, using the exact same renderer every other theme and module use.
This is what keeps every settings page looking consistent no matter who
wrote it.

### `settings.json` — one set, for the whole face

```json
{
  "settings": [
    {
      "key": "accent",
      "label": "Accent colour",
      "type": "select",
      "options": ["Blue", "Red", "Green"],
      "default": "Blue"
    },
    {
      "key": "background",
      "label": "Background",
      "type": "select",
      "options": ["Solid colour", "Wallpaper"],
      "default": "Solid colour"
    },
    {
      "key": "wallpaperColor",
      "label": "Colour",
      "type": "color",
      "default": "#1d1d1d",
      "showWhen": { "key": "background", "equals": "Solid colour" }
    },
    {
      "key": "wallpaper",
      "label": "Wallpaper from",
      "type": "instance",
      "provides": "background",
      "showWhen": { "key": "background", "equals": "Wallpaper" }
    }
  ]
}
```

Available `type`s: `text`, `url`, `number`, `password`, `boolean`,
`select` (needs `options`), `color`, `location`, `instance`, `priority`
(a reorderable list — stores an array, in the user's order).

**`showWhen: { key, equals }`** hides a field unless another field on the
same form currently has a matching value (`equals` can be a string or an
array of strings). It's how you avoid showing a gradient's second colour
picker when the background isn't set to a gradient — the field simply
doesn't render until it's relevant, and updates live as the user changes
the controlling field.

**The `instance` type** is how you get a reference to one of the face's
own modules — most commonly for wallpaper. `provides: "background"`
restricts the list to modules that actually declared they can supply one
(see the module guide), so a user picking a wallpaper source never sees
something like a Docker status module offered as an option.

The values you get back arrive in `themeConfig` from `/identity`, already
resolved against your `default`s.

### `instance-settings.json` — one set, per module instance

This is entirely optional, and it's how sizing (§4) actually reaches the
user without your theme ever writing anything:

```json
{
  "settings": [
    {
      "key": "size",
      "label": "Tile size",
      "type": "select",
      "options": ["Hidden", "Small", "Medium", "Wide", "Large"],
      "default": "Wide",
      "hiddenValue": "Hidden"
    }
  ]
}
```

If you declare this, OmniCore adds these fields to _every module
instance's_ settings form — under a heading naming your theme, so it's
clear where the field came from. Each instance gets its own value, which
arrives as `instance.themeConfig.size` in `/identity`, per instance.

**`hiddenValue`** marks which of your own values means "don't show a tile
for this." When a module declares it doesn't want a tile by default (a
wallpaper source, say), OmniCore starts new instances of it at whatever
value you named here — your vocabulary, not a hardcoded concept OmniCore
understands on its own. If your theme has no notion of hiding a tile,
just don't include this key.

**None of this is theme-wide.** A face using two instances of the same
module — two weather tiles, say — can have completely different sizes for
each, because the values live per instance, not per theme.

---

## 6. The reload script — don't write your own

OmniCore automatically injects a small script into every HTML page you
serve, right before `</body>`. **You don't add it, and you can't remove
it.** It listens for a `face-changed` push and reloads the page when
something about the face changes — a setting saved in the admin face, a
theme switch, anything.

This is deliberate: if themes had to remember to add this themselves, a
theme author forgetting it would leave a display permanently stuck, with
no way for the user to recover except walking up to it. Making it
automatic means every theme gets this behaviour whether the author thought
about it or not.

**Practically, this means:** don't build your own polling-and-reload logic
for settings changes — it already happens. Your job is just to read
`/identity` and `/api/*` fresh each time your own page loads or refreshes
on its own schedule (§7); you don't need to detect settings changes
yourself.

---

## 7. Refreshing content

Nothing pushes new module data to you automatically — only _face changes_
(settings, theme switches) trigger the automatic reload in §6. Actual data
— a temperature ticking up, a new notification — is on you to poll.

A simple approach:

```js
async function refresh() {
  const results = await Promise.all(
    identity.instances.map(async (instance) => {
      const richness = sizeToRichness(instance);
      const response = await fetch(`/api/${instance.id}?richness=${richness}`);
      return { instance, data: await response.json() };
    }),
  );
  // render results
}

refresh();
setInterval(refresh, 5000);
```

Fetch every instance in parallel, not one after another — a slow module
shouldn't hold up tiles that have nothing to do with it. Five seconds is a
reasonable interval; there's no requirement to match it exactly.

**Handle a fetch failing.** A module can be down, or an instance can have
been removed from the face entirely. Show something — the `windows8`
theme renders a plain "Not responding" tile rather than leaving a gap.

---

## 8. What a theme must never do

**Never write anything, with one narrow exception you don't need to touch
yourself.** There is exactly one write endpoint reachable from a dashboard
face — `POST /select-theme` — and it exists solely for OmniCore's own
built-in fallback screen (shown automatically when a face has no valid
theme set). You will never call this from your own theme's code; it isn't
part of the theme contract, and it stops working the moment a real theme
is active. If you're curious why it exists at all rather than requiring a
login, `docs/ARCHITECTURE.md` §9 covers the reasoning.

**Never assume a module exists.** A face can have any combination of
instances, including none. Render an empty state gracefully rather than
assuming at least one tile will always be there.

**Never assume a block type will be present**, and always have the
plain-text fallback from §3.

**Never hardcode colors or sizing that ignore the user's own settings.**
If you declare an accent colour setting, use it — don't ship a theme where
half the UI respects settings and half is hardcoded regardless.

---

## 9. A minimal complete theme

Enough to actually run — one size, no settings, renders every block type
with a plain fallback:

```html
<!-- themes/minimal/index.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        background: #111;
        color: #fff;
        font-family: sans-serif;
        padding: 24px;
      }
      .tiles {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .tile {
        background: #0078d7;
        padding: 16px;
        width: 200px;
        min-height: 120px;
      }
      .tile h3 {
        margin: 0 0 8px 0;
        font-size: 14px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <h1 id="title"></h1>
    <div class="tiles" id="tiles"></div>

    <script>
      function escapeHtml(text) {
        return String(text).replace(
          /[&<>"]/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
        );
      }

      function renderBlock(block) {
        if (block.type === "text") {
          return `<div>${escapeHtml(block.value)}</div>`;
        }
        if (block.type === "pair") {
          return `<div>${escapeHtml(block.label)}: ${escapeHtml(block.value)}</div>`;
        }
        if (block.type === "image") {
          return `<img src="${block.url}" style="max-width:100%">`;
        }
        // background blocks belong on the page, not in a tile — skip
        if (block.type === "background") return "";

        // Unknown type: fall back to plain text
        return block.text ? `<div>${escapeHtml(block.text)}</div>` : "";
      }

      async function refresh(identity) {
        const results = await Promise.all(
          identity.instances.map(async (instance) => {
            const response = await fetch(`/api/${instance.id}?richness=50`);
            return { instance, data: await response.json() };
          }),
        );

        document.getElementById("tiles").innerHTML = results
          .map(
            ({ instance, data }) => `
				<div class="tile">
					<h3>${escapeHtml(data.title || instance.module)}</h3>
					${(data.content || []).map(renderBlock).join("")}
				</div>
			`,
          )
          .join("");
      }

      async function start() {
        const identity = await (await fetch("/identity")).json();
        document.getElementById("title").textContent = identity.title || "";

        await refresh(identity);
        setInterval(() => refresh(identity), 5000);
      }

      start();
    </script>
  </body>
</html>
```

One richness value, no settings, no size vocabulary — but it satisfies the
full theme contract: it fetches `/identity`, fetches every instance, falls
back gracefully on unknown block types, and never writes anything.
Everything in §4 and §5 is additive on top of this.

---

## 10. Checklist before you call it done

- [ ] Fetches `/identity` once, and reads `title` (not `name`) for any
      on-screen heading
- [ ] Fetches every instance's data with an explicit `richness` value
- [ ] Has a real fallback for block types it doesn't specifically handle
- [ ] Never renders a `background` block inside a tile
- [ ] Settings are declared in `settings.json` / `instance-settings.json`,
      never built as custom UI
- [ ] If it has a size concept, `instance-settings.json` declares it and
      `hiddenValue` is set if hiding a tile is possible
- [ ] Handles a failed instance fetch without breaking the rest of the page
- [ ] Handles zero instances without breaking
- [ ] Doesn't attempt to write anything, and doesn't try to reimplement the
      reload behaviour §6 already gives it for free

---

## 11. Getting it in front of anyone

A theme on your own machine only helps you. Getting it into the
Marketplace means:

1. Push it to a public repo — its own, or a subfolder of one with several
   themes or modules in it.
2. Open a pull request against the registry repo, adding one entry that
   names your repo, the commit to pin, and a `path` if it's not at the
   repo's root.

Full details — the entry's exact shape, why it pins a commit rather than a
branch, how one repo can hold several themes — are in
`docs/ARCHITECTURE.md` §5b, and in the registry repo's own README.
