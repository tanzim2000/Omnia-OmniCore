# OmniCore — Architecture & Contracts

This is the reference for how OmniCore works and the rules anything plugging
into it must follow. It assumes no prior knowledge of the project.

If you are picking this up after a long gap, read _The three-way split_ and
_The module agreement_ first. Almost every design decision in the codebase
follows from those two.

---

## 1. What OmniCore is

OmniCore is the engine behind **Omnia**, a smart home dashboard that runs
entirely on hardware you own. It serves one or more dashboards — each on its
own port — assembles the data they display, and hands it to whichever theme
is rendering them.

Nothing leaves your network except calls a module makes to a service you
explicitly configured.

OmniCore is one of three planned parts:

| Part         | What it does                                  | Status         |
| ------------ | --------------------------------------------- | -------------- |
| **OmniCore** | Serves faces and their data. This repository. | In development |
| **OmniView** | Display client — puts a face on a screen.     | Not started    |
| **OmniSync** | Planned.                                      | Not started    |

---

## 2. The three-way split

Everything in OmniCore follows from separating three concerns that most
dashboard software tangles together:

- **Modules** fetch or measure data. They have **no opinion about how it
  looks** and produce no markup.
- **Themes** decide how everything looks. They **never run on the server**.
- **Faces** are the dashboards themselves — a port, a theme, and the module
  instances on it.

The payoff: **any theme can display any module without knowing what that
module does**, and installing either is dropping a folder in place.

The rule that keeps it honest, and which the whole codebase defends:

> If an element looks crooked, that is the theme's fault, never the
> module's. A module says _what it has_; a theme decides _how it appears_.

---

## 3. Core concepts

### Face

A dashboard served on its own port. **The port number is its ID.**

| Attribute      | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `id`           | Its port. Fixed at creation, never editable.                        |
| `name`         | How the admin recognises it. Blank falls back to `Face <port>`.     |
| `title`        | Cosmetic — what a theme displays, if it displays one. May be blank. |
| `theme`        | Which theme renders it.                                             |
| `instances`    | The module instances on it.                                         |
| `themeConfigs` | Theme settings, keyed by theme id.                                  |

`name` and `title` are deliberately different things. `name` is an
administrative label; `title` is decoration on the screen itself.

**Port ranges carry meaning:**

| Range   | Purpose                                                               |
| ------- | --------------------------------------------------------------------- |
| `3xxx`  | Admin faces. OmniCore's own UI. No third-party code ever runs here.   |
| `4000`  | The control face. Face creation, and the registry OmniView will read. |
| `4001+` | Dashboard faces, assigned automatically in order.                     |

### Instance

**One use of a module on one face.** The same module can appear many times
with different settings — two weather tiles for two cities.

```json
{
  "id": "weather-3f2a91bc",
  "module": "weather",
  "label": "Regina",
  "config": { "units": "Celsius" },
  "themeConfigs": { "windows8": { "size": "Wide" } }
}
```

- `config` belongs to the **module**. Theme-agnostic. Never touched by a theme.
- `themeConfigs` belongs to **themes**, keyed by theme id, so two themes
  never collide and switching themes never damages the other's settings.

### Module

A folder in `modules/` whose `index.js` exports **one function**. It is given
settings and how much room there is, and returns data. It does not register
routes, does not touch Express, and renders nothing.

### Theme

A folder in `themes/` of **static files**. OmniCore serves it and never
executes it, so a theme downloaded from anywhere can only render data the
face already exposes.

---

## 4. Repository layout

```
core/           OmniCore itself
modules/        installed modules
themes/         installed themes
data/           per-install data (gitignored)
index.js        entry point
```

### `core/` file by file

| File                  | Responsibility                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `face-store.js`       | Reads/writes `data/faces.json`. Creating faces, instances, port assignment. The only thing that touches face data on disk.    |
| `face-loader.js`      | Starts a face as an Express server on its port. Owns `/identity`, `/api/:instanceId`, theme serving, client-script injection. |
| `face-events.js`      | Server-Sent Events. Pushes `face-changed` to displays. Holds the client script that gets injected into theme pages.           |
| `fallback-page.js`    | The built-in "pick a theme" screen shown when a face has no usable theme. Not part of any theme.                              |
| `control-face.js`     | Port 4000. Face registry API, and the face setup wizard.                                                                      |
| `admin-face.js`       | Port 3000. All settings UI. Renders every settings form from declared schemas.                                                |
| `admin-auth.js`       | Admin account and sessions. scrypt hashing, constant-time comparison, in-memory sessions.                                     |
| `module-loader.js`    | Finds modules, loads their function. **The module contract is documented here.**                                              |
| `module-config.js`    | Reads a module's `module.json` and `settings.json`. Applies defaults, cleans submitted values.                                |
| `module-fetch.js`     | Shared HTTP helper for modules: caching, timeouts, stale fallback, in-flight deduplication.                                   |
| `theme-loader.js`     | Finds themes, reads their manifest and both settings schemas.                                                                 |
| `envelope.js`         | Normalises whatever a module returned into content blocks. Swaps image URLs for proxy paths.                                  |
| `image-proxy.js`      | Fetches images on the display's behalf so a display only ever talks to your server.                                           |
| `location-service.js` | One place that knows where OmniCore is. Resolves `location` settings before a module sees them. City search.                  |
| `settings-store.js`   | OmniCore's own install-wide settings (`data/settings.json`).                                                                  |

### `data/` — never committed

| File            | Contents                                           |
| --------------- | -------------------------------------------------- |
| `faces.json`    | Every face, its instances, and all their settings. |
| `admin.json`    | Admin username, salt, password hash.               |
| `settings.json` | OmniCore's own settings (location service).        |

---

## 5. The module agreement

**Every module must follow this. It is the contract the marketplace will
hold modules to.**

### The function

```js
module.exports = async function (config, richness) {
  return {
    title: "Weather",
    content: [
      /* blocks */
    ],
    updated: new Date().toISOString(),
  };
};
```

- `config` — this instance's settings, already resolved against the
  defaults declared in `settings.json`. Location fields arrive as real
  coordinates.
- `richness` — a number **1–100**. See below. **Mandatory to honour.**
- Returns an envelope. `title` may be overridden by the instance's label.

### Richness

**The scale belongs to the module.** A module decides for itself what 10
means versus 90, and how many steps it has between them.

- A clock might have two steps: the time, or the time and date.
- A calendar might have twenty: one per extra event shown.
- `prayer-times` has four: bare time → time and name → plus next two →
  the whole day.

**The theme decides which number to ask for**, based on how much room it
has. So a module never learns what theme is asking or what that theme calls
its sizes, and a theme never learns what any module's content means. Both
sides only ever deal in one number.

More steps means more flexibility for a theme, not a better module — two
well-chosen steps beat twenty arbitrary ones.

OmniCore clamps whatever arrives to 1–100 and defaults to 50 if absent or
unparseable. A module can trust the number.

### Content blocks

A module describes **what it has**, never how it should look:

| Block        | Shape                                                              |
| ------------ | ------------------------------------------------------------------ |
| `text`       | `{ type, value, emphasis: "primary"｜"secondary"｜"body" }`        |
| `quote`      | `{ type, value }`                                                  |
| `pair`       | `{ type, label, value }`                                           |
| `image`      | `{ type, url, alt, fit: "cover"｜"contain" }` — content for a tile |
| `background` | `{ type, url }` — a surface to go behind everything                |
| `progress`   | `{ type, value: 0..1, label }`                                     |

**`image` and `background` both carry a picture but mean different things.**
An image is content; a background is the surface behind everything. The
module says which; the theme decides whether to honour it.

**Every block may carry a `text` string** — its plain-text rendering. A
theme that has never heard of a block type falls back to that and still
looks reasonable. **This is what lets the block list grow without breaking
themes people already installed.** OmniCore fills it in automatically if a
module omits it.

### Failing gracefully

**Always return a valid envelope, even on failure.** A tile that says
"Not reachable" is more useful than one that vanishes.

```js
return {
  title: "Weather",
  content: [
    { type: "text", emphasis: "primary", value: "—" },
    { type: "text", emphasis: "secondary", value: "Not reachable" },
  ],
  updated: new Date().toISOString(),
};
```

OmniCore catches a module that throws and shows one dead tile rather than
breaking the face — but relying on that is worse than handling it.

### `module.json`

```json
{
  "name": "Bing Wallpaper",
  "description": "Bing's picture of the day",
  "provides": ["background", "image"],
  "tile": false
}
```

| Field         | Meaning                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Readable name. Falls back to the folder name.                                                                                      |
| `description` | One line, shown in pickers.                                                                                                        |
| `provides`    | Block types this module can emit. Lets OmniCore offer only modules that could do a job — a wallpaper picker shouldn't list Docker. |
| `tile`        | `false` means it works behind the scenes and shouldn't get a tile by default.                                                      |

### Using the network

Modules that call an outside service **should** go through the shared
helper:

```js
const { fetchCached } = require("../../core/module-fetch");

const { data, stale } = await fetchCached(url, {
  cacheSeconds: 600,
  timeoutSeconds: 10,
  as: "json", // or "text"
});
```

It gives you caching, timeouts, stale-fallback when a service is briefly
down, and deduplication when several faces ask at once. A dashboard polling
every few seconds would otherwise become hundreds of calls an hour against
somebody else's free API.

When `stale` is true, **say so** — append "(last known)" or similar rather
than presenting old data as current.

---

## 6. The theme agreement

**Every theme must follow this.**

### A theme is static files only

OmniCore serves a theme's folder; it never executes it. This is structural,
not a rule of etiquette — a theme has no server side, so the only data it
can reach is what a face hands it.

### Files

| File                     | Required | Purpose                                                      |
| ------------------------ | -------- | ------------------------------------------------------------ |
| `index.html`             | yes      | The page itself.                                             |
| `theme.json`             | no       | `{ name, description }`. Falls back to folder name.          |
| `settings.json`          | no       | Settings for the whole face.                                 |
| `instance-settings.json` | no       | Settings the theme needs **per instance** — sizing, usually. |

### What a theme fetches

| Endpoint                           | Gives you                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /identity`                    | The face: `id`, `name`, `title`, `theme`, `themeConfig`, and `instances[]` each with their own `themeConfig`. |
| `GET /api/<instanceId>?richness=N` | That instance's envelope: `{ title, content, updated }`.                                                      |
| `GET /events`                      | Server-Sent Events. OmniCore pushes `face-changed` when anything about the face changes.                      |

A theme **only ever sees blocks.** OmniCore converts anything a module
returned into the block format before it reaches you, so there is one code
path regardless of how a module chose to express itself.

### Rendering blocks

Handle the types you know; **fall back to `block.text` for anything you
don't**. That fallback is not optional — it is what keeps your theme working
when a newer block type appears.

```js
function renderBlock(block) {
  if (block.type === "text") {
    /* ... */
  }
  if (block.type === "pair") {
    /* ... */
  }
  // ...
  return block.text ? "<div>" + escape(block.text) + "</div>" : "";
}
```

`background` blocks are **page-level** and should never be drawn inside a
tile.

### Sizing, and asking for richness

A theme declares its own size vocabulary in `instance-settings.json`:

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

OmniCore adds these fields to every instance's settings form, in the wizard
and the admin face. The chosen value comes back through `/identity` as that
instance's `themeConfig`.

**The mapping from your sizes to a richness number is yours to hardcode.**
It is a design decision by the theme author, not something users configure:

```js
const SIZES = {
  small: { richness: 10 },
  medium: { richness: 35 },
  wide: { richness: 65 },
  large: { richness: 95 },
};
```

Three shapes of theme all work:

- **Named steps** — like `windows8` above.
- **A number** — one `number` field, e.g. 0–100, mapped to richness however
  you like.
- **Nothing** — ship no `instance-settings.json`, no size field appears,
  and you size everything yourself.

`hiddenValue` marks which of your values means "don't show this". A module
declaring `tile: false` starts new instances at that value, so a module's
hint survives without OmniCore or the module knowing your vocabulary.

### Themes must not write

**No theme has a write endpoint available to it.** Anything a theme needs
remembered is a setting, configured in the admin face, and arrives through
`/identity`.

This was a deliberate reversal. An earlier version let a theme POST its tile
sizes back, which put an unauthenticated write endpoint on a port where
untrusted marketplace code runs. Sizing moved into settings instead, and
`/tile-state` was removed entirely.

**One write endpoint does remain on dashboard faces: `POST /select-theme`.**
The built-in fallback screen uses it when a face has no theme set yet.
It is narrow — it can only set the theme, on that one face — and is only
meaningfully reachable before a theme is configured. But it is on an
unauthenticated port, and it is not reached through any theme.

Do not describe dashboard faces as having no writes. They have exactly one,
and it should be the last one added unless they gain a trust model first.

### The injected client script

OmniCore injects a small script into every theme HTML page on the way out.
It listens on `/events` and reloads the page on `face-changed`, and reloads
after a reconnection in case a change was missed while disconnected.

**Injection is deliberate, not a convention** — a theme physically cannot
ship without it, so an unattended display can always be changed remotely and
will always recover after OmniCore restarts.

Themes should also **re-read `/identity` periodically** and re-apply their
settings if they changed. If a push is ever missed, the display corrects
itself rather than sitting stale until somebody reloads it by hand.

---

## 7. Settings schemas

Modules and themes both **declare** their settings. OmniCore renders the
form. **Neither ever ships a settings UI** — that is what keeps every
settings page consistent no matter who wrote the thing.

```json
{
  "settings": [
    {
      "key": "topic",
      "label": "Topic",
      "type": "text",
      "default": "GitHub",
      "help": "Which topic to show messages from"
    }
  ]
}
```

### Field types

| Type       | Renders as                                           | Notes                                                                                       |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `text`     | text input                                           |                                                                                             |
| `url`      | url input                                            |                                                                                             |
| `number`   | number input                                         | Converted to a real number on save.                                                         |
| `password` | password input                                       |                                                                                             |
| `boolean`  | checkbox                                             |                                                                                             |
| `select`   | dropdown                                             | Needs `options: []`.                                                                        |
| `color`    | colour picker                                        | Stores `#rrggbb`.                                                                           |
| `location` | "use OmniCore's location" / manual, with city search | Resolved to coordinates before the module runs.                                             |
| `instance` | dropdown of instances on this face                   | Filter with `provides: "background"` to only offer modules that can supply that block type. |

### Conditional fields

```json
{ "showWhen": { "key": "background", "equals": ["Solid colour", "Gradient"] } }
```

The field is shown only when another field has one of those values, updating
live as the controlling field changes.

### Where values are stored

| Kind                        | Stored in                        |
| --------------------------- | -------------------------------- |
| Module settings             | `instance.config`                |
| Theme settings for the face | `face.themeConfigs[themeId]`     |
| Theme settings per instance | `instance.themeConfigs[themeId]` |
| OmniCore's own settings     | `data/settings.json`             |

Anything not declared in a schema is discarded on save.

---

## 8. Services OmniCore provides

### Location

Weather, prayer times, sunrise — all need to know where they are. Rather
than each module working it out, OmniCore establishes it once.

- **Settings → Location service.** On by default. Automatic (IP-based, via
  `ipwho.is` over HTTPS) or manual with city search.
- A settings field of `type: "location"` is resolved to
  `{ latitude, longitude, label }` **before the module runs**, or `null`.
- Modules never implement location logic. They receive it or receive
  nothing.

**Honest scope of the guarantee:** themes are genuinely sandboxed — with no
server side, a theme has no path to a location OmniCore doesn't expose.
Modules are trusted backend code, like any Node program; a module _could_
call a geolocation service itself. This service makes the right thing the
easy path. It is not a sandbox and should not be described as one.

### Image proxying

A theme requests `/api/<instanceId>/image/<n>`. OmniCore fetches the real
URL and relays it, so a **display only ever talks to your own server** —
not to Bing or any other CDN.

**OmniCore never accepts a URL in the path.** The caller asks by instance
and block index, and OmniCore looks up what that module actually returned.
Accepting a URL would make it an open relay anything on your network could
point anywhere. Responses are checked to actually be images, cached, and
size-capped.

### Live updates

A face resolves **everything per request** — its theme, its name, its
instances and their settings. Nothing is decided at startup. That is what
lets any of it be edited while OmniCore keeps running.

Saving a change persists it, updates the running face, and pushes
`face-changed` over SSE so every display showing it reloads itself. No
restart, and nobody has to be standing in front of the screen.

---

## 9. Security posture

Worth being explicit, because several decisions only make sense in this
light.

| Surface                     | Trust                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Themes**                  | Untrusted. Static files, no server side, no write endpoints. Structurally sandboxed.                                       |
| **Modules**                 | Trusted. Arbitrary Node code — can read files, open sockets, anything. Same trust as any npm dependency.                   |
| **Admin face (3xxx)**       | Behind login. Where essentially everything is written.                                                                     |
| **Control face (4000)**     | Unauthenticated. Face creation and city lookup live here. Worth revisiting.                                                |
| **Dashboard faces (4001+)** | Unauthenticated. Serves data and static files, plus one write: `POST /select-theme`, used by the no-theme fallback screen. |

Passwords are salted scrypt hashes compared in constant time. Sessions are
random tokens in an `HttpOnly`, `SameSite=Strict` cookie, held in memory so
a restart signs everyone out.

**Everything is plain HTTP.** Run it behind a VPN or reverse proxy, never on
an untrusted network.

---

## 10. Running it

Requires Node 20 or newer.

```bash
npm install
node index.js
```

1. **Port 4000** — the setup wizard. Name and title, theme, module picker,
   per-module settings, theme settings, review, finish. Nothing is written
   until Finish, so Cancel leaves nothing behind.
2. **Port 3000** — create the admin account, then edit anything directly.

The wizard is for **setting a face up**; the admin face is for **changing
one thing afterwards**. A wizard is the wrong shape for editing.

---

## 11. The `windows8` theme, as a worked example

It is currently the only theme, and the only implementation of the theme
agreement, so it is worth knowing how it satisfies each part.

**Its size vocabulary** (`instance-settings.json`) is four named steps plus
Hidden, with `hiddenValue: "Hidden"`. **Its richness mapping** is hardcoded
in `index.html`, because it is a theme author's design judgement rather
than something to configure:

| Size   | Asks for | Blocks per face |
| ------ | -------- | --------------- |
| Small  | 10       | 1               |
| Medium | 35       | 3               |
| Wide   | 65       | 5               |
| Large  | 95       | 10              |

**Its own settings** include accent colour, tile size, background
(solid/gradient/wallpaper), and two motion controls: _Gentle motion_ (on by
default; off halves every duration) and _Simplify animation_ (off by
default; swaps the 3D motion for a flat sliding card).

### The animations

Three, chosen by _why_ a tile is changing, not by what it contains:

| Motion           | When                                   | What it is                                               |
| ---------------- | -------------------------------------- | -------------------------------------------------------- |
| **Depth Swivel** | New data arrived                       | Recess, 180° turn, return — three non-overlapping phases |
| **Prism Roll**   | Paging through content that didn't fit | One 90° turn, next face already perpendicular            |
| **Sliding card** | Whenever _Simplify animation_ is on    | Flat, from left or right at random                       |

A tile is a **box with real depth**, not a flat card. Depth equals the
tile's height, so every face around the rotation axis is the same shape as
the front — that is what makes it read as a solid block tumbling rather
than paper flipping, and why a blank side face is glimpsed mid-swivel.

Three things about this were learned the hard way and are easy to undo by
accident:

- **Durations live only in CSS**, derived from a single `--speed`
  multiplier. The script never counts to a duration of its own; it waits
  for `animationend`/`transitionend`, with a fallback that reads the
  duration the browser actually resolved. An earlier version kept the
  number in both CSS and JS, they drifted, and animations were being cut
  off halfway.
- **Never set an inline `transform` on an animating element.** Inline
  styles outrank CSS animations, so the keyframes silently do nothing.
- **Simplify mode removes the whole 3D setup together** — perspective,
  `preserve-3d`, and the faces' own transforms. Neutralising only part of
  it pushed the front face toward the viewer and made every tile render
  oversized.

---

## 12. State of things

### Working

Faces, themes, modules, instances. The full settings system. Location
service. Image proxying. Live push updates. Admin login. The setup wizard.
The `windows8` theme with three animations.

### Not built yet

- **Resource separation** — themes and modules moving to their own repos,
  with OmniCore shipping bare.
- **First-run setup** — downloading the user's chosen themes and modules.
- **Marketplace** — distribution and discovery.
- **Auto start/shutdown.**
- **OmniView** — the display client.
- **Container image** — the intended primary distribution.

### Known gaps

- Only `prayer-times` honours richness. The other six modules run but
  ignore it and need updating.
- The calendar module skips repeating events (RRULE). Expanding them
  correctly is genuinely hard, and a subtly wrong recurring event on a wall
  display is worse than an absent one.
- No password reset. Delete `data/admin.json` to start over.
- `data/faces.json` has changed format several times with no migration
  path. Expect to delete it after an upgrade during development.

---

## 13. Lessons worth not relearning

Things that cost real debugging time in this project:

- **Never duplicate a duration between CSS and JS.** A guessed timeout that
  drifted from the stylesheet cut animations off midway. Listen for
  `animationend` / `transitionend` instead.
- **Inline styles beat CSS animations.** Setting `element.style.transform`
  silently defeats a `@keyframes` animation on the same property.
- **Half-applying a 3D setup is worse than not touching it.** Neutralising
  a container's transform while leaving `perspective` and child
  `translateZ` in place magnified everything.
- **`scrollHeight` only measures overflow past the _bottom_ edge.**
  Centred flex content overflows both ends, so overflow detection
  under-measured by roughly half.
- **Syntax-checking the server file is not enough.** The JavaScript written
  _into_ a page is a separate program; extract and check it too.
- **Two ways to do one thing is one too many.** A "hide this tile"
  checkbox alongside a "Hidden" size was redundant and confusing.
