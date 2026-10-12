# Backlog

What is left to do, and what was deliberately put off. Last cleaned up
after v1.19.7. Anything already built has been removed from here; the
CHANGELOG is the record of what shipped.

If you are picking this back up after a break, this file plus
`docs/Architecture.md` should be enough to re-orient.

## Now: making the Essentials modules work properly

One module at a time, each with a user-friendly description, a "what it
needs from you" paragraph, and the right `minOmniCore` in the Registry.

1. **World Clock**: done (single, dual and multi clock).
2. **Weather**: label follows the location; a Source setting (Open-Meteo,
   Environment Canada, MET Norway, OpenWeatherMap, Google Weather).
   - The settings and behaviour change with the source. Open-Meteo is the
     default and stays as it is. Environment Canada is for places in
     Canada, MET Norway for Norway. OpenWeatherMap and Google Weather first
     ask "Do you have an API key?"; No puts the source back, Yes asks for
     the key in a second dialogue.
   - The list of fields changes with the source, and can still be
     reordered, so the widget gives a different number of blocks per
     source.
   - Units: temperature (Celsius or Fahrenheit) and wind speed (km/h or
     mph).
   - Credit for the source, in whatever form is agreed.
   - Notifications for severe weather alerts where the source has them:
     Environment Canada (red, orange, yellow), MET Norway's MetAlerts
     (red, orange, yellow, by coordinates). OpenWeatherMap's alerts are
     only on its paid One Call 4.0, so none on the free key. Open-Meteo has
     none. Google Weather left for later.
   - A US source is wanted too, in the same way (to be chosen).
   - Built against saved sample responses, because the development sandbox
     cannot reach these services. MET Norway needs the `omni.fetch`
     headers option (v1.19.8, below).
   - Build tasks, in order, once samples are in hand and "Start coding" is
     said (see **Weather: tasks and samples** below).
3. **Prayer Times**: a list that can include forbidden times behind one
   switch, with the times following the school of thought chosen for the
   prayers; notifications at each prayer and forbidden time, priority
   setting the duration; a body with start, end and what comes next. The
   way forbidden times become clock times is still undecided (sun angles,
   mosque minutes, or adjustable minutes). Registry entry needs
   `background` and `notifies`.
4. **Calendar**: a complete rework, last.
5. **Docker Status**: very few options; give it more.
6. **Bing Wallpaper**: shows "Not reachable" in the development sandbox and
   it was never explained. Also needs its Registry ref published.

## Weather: tasks and samples

### Samples to gather first

The development sandbox cannot reach these services, so Weather is built
against real saved responses. Run each in the Codespace and send the
output (save to a file and attach it, or paste it). Use Regina
(50.4452, -104.6189) for Canada, Oslo (59.9139, 10.7522) for Norway, and
a US city such as Denver (39.7392, -104.9903). Where a place has an
active alert right now, a second sample of that is the most valuable
part, because that is the shape the notifications are built from.

| Source             | Samples                                                                                                                                                                                | Needs                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Open-Meteo         | Nothing new; already working.                                                                                                                                                          | Nothing                                               |
| Environment Canada | The `citypageweather-realtime` item for Regina, in English: current conditions, today's forecast, and the warnings block. One with an active warning if any exists anywhere in Canada. | Nothing                                               |
| MET Norway         | `locationforecast/2.0/complete` for Oslo; MetAlerts as GeoJSON for a point with an active alert and for one without.                                                                   | A User-Agent header with contact details              |
| US (NWS)           | `/points/{lat},{lon}`, then its `forecast`, its nearest station's `observations/latest`, and `alerts/active?point={lat},{lon}`. One with an active alert if possible.                  | A User-Agent header with contact details              |
| OpenWeatherMap     | `data/2.5/weather` and `data/2.5/forecast` for Regina, metric. No alerts on the free key.                                                                                              | A free API key (email sign-up)                        |
| Google Weather     | `currentConditions:lookup`, `forecast/days:lookup`, and whatever its public alerts endpoint is called (to confirm), for Regina.                                                        | An API key and a billing-enabled Google Cloud project |

Exact URLs and the `curl` lines will be written out when the samples are
asked for, and anything above marked "to confirm" is checked against the
service's own documentation first.

### The US source

The US government source is the **National Weather Service** at
`api.weather.gov`: free, no key (the docs say one may be required in the
future), and it needs a User-Agent with contact details. A location goes
through `/points/{lat},{lon}` to find the forecast grid and nearby
stations. Current readings come from a station's latest observation (up
to about 20 minutes old). Alerts are on `/alerts/active`, filtered by
state or zone; the docs do not describe a direct point lookup, so the
sample must show which filter to use. Alert levels follow CAP (severity
Minor, Moderate, Severe, Extreme), not colours.

### Tasks

OmniCore (v1.19.8):

1. `omni.fetch` takes a `headers` option. Cached answers must not be
   shared between calls that differ only in headers that matter to the
   answer (the cache key stays the URL unless a `key` is given). Tests and
   `docs/Building modules.md` updated.
2. Move `confirmDialog` from `core/admin-face.js` into `core/ui-theme.js`,
   so every page built on the shared library has it. Admin face keeps
   working exactly as before (its two uses: the confirmations at lines
   ~3561 and ~4809). Existing tests plus a new one that checks the shared
   script is on the wizard and the admin pages. Nothing changes visually.
3. Content Contract: `data-source` and `data-updated` as optional
   top-level fields next to `title`, `content` and `updated`. Pass them
   through `face-loader.js` and the envelope; include them in the change
   check so a new source name redraws a tile. Document in
   `docs/Architecture.md` and `docs/Building theme.md`. Default UI and the
   Windows 8 theme draw the credit, small, on a tile that has room.
4. Settings that change with another setting. A module's settings file
   already supports `showWhen`; the Source setting needs the field list
   itself to change with it (Info order differs per source), and the
   "Do you have an API key?" dialogue on picking OpenWeatherMap or Google
   (No puts the source back; Yes asks for the key in a second dialogue).
   Works on a widget's page and in the setup wizard. Decide how a module
   declares this in `settings.json`, and document it.
5. Update this file's v1.19.8 notes and the CHANGELOG.

Weather module (Essentials):

6. `module.exports.label`: the location's name.
7. Source setting, default Open-Meteo; one small adapter per source that
   turns its answer into the same named pieces (Temperature, Condition,
   Feels like, High / low, Humidity, Wind, and whatever else a source
   has), so the tile code does not care where the data came from.
8. Region rules: Environment Canada only for places in Canada, MET Norway
   only for Norway, the US source only for the US. Outside its region the
   tile says what that source covers instead of showing wrong data.
9. Units: temperature (Celsius, Fahrenheit) and wind speed (km/h, mph),
   separate choices, applied to every source.
10. The fields list and Info order per source, with a default order each.
11. `data-source` and `data-updated` filled in for every source (and
    "last known" kept for stale data).
12. Alerts as notifications, for Environment Canada, MET Norway and the US
    source (Google when its sample is in): one notification per new alert,
    never repeated on every refresh, priority from the alert's level,
    link when the alert has one. Test with saved samples, including the
    quiet case (no alerts) and a cancelled alert.
13. Rewritten description with a "What it needs from you" section per
    source, no long dashes. Registry entry: new ref, `minOmniCore`
    1.19.8, `background` and `notifies` set.
14. Tests with the saved samples; a check on each source's attribution
    wording against its licence.

## v1.19.8: a face's page gets Open and Delete

A new box on a face's page (the one with Name, Manage resources and
Notifications), between **Manage resources** and **Notifications**, with
two buttons:

1. **Open face**: goes to the face itself.
2. **Delete face**: removes the face. There is currently no way to delete
   a face once it's created.

Still to settle before building: what Delete asks first (a confirmation,
since it can't be undone), what happens to the face's widgets and saved
settings, its port and ID (free for reuse or kept so IDs never repeat),
and what the Welcome page and any open screens show afterward. Show a
demo before coding.

Also planned for v1.19.8:

- **`omni.fetch` can send headers.** A new `headers` option, so a module
  can send what a service asks for, such as the descriptive User-Agent
  MET Norway requires. Documented in `docs/Building modules.md`.
- **A source credit in what a widget gives.** A new top-level field next
  to `title` and `content`, `data-source` (for example "Environment
  Canada"), and a `data-updated` for when the data itself was read. Themes
  draw them however they like; a theme that leaves out the credit is the
  theme author's doing. Goes into the Content Contract in
  `docs/Architecture.md` and `docs/Building theme.md`.
- **Dialogue boxes anywhere** (task 2 under Weather: tasks and samples). `confirmDialog` lives inside
  `core/admin-face.js` (only the `.modal` styles are shared, in
  `core/ui-theme.js`). Move it into `core/ui-theme.js` so the wizard and
  other pages can use it too. Weather's "Do you have an API key?" flow
  needs it on a widget's page and in the wizard.

### Also planned for v1.19.8

- **`omni.fetch` can send headers.** A new `headers` option, so a module
  can send what a service asks for (MET Norway refuses requests without a
  descriptive User-Agent). To settle: whether the headers become part of
  the cache key, and whether a module may override OmniCore's own
  User-Agent. Document it in `docs/Building modules.md` and add tests.
- **Weather needs more from the settings system** (see the Weather entry
  above; each of these is still to be decided before building):
  a setting that asks a question in a dialog before it's accepted (the
  "do you have an API key?" flow), and a list setting whose choices change
  with another setting (the info list differs per weather source).

## Next: OmniCore

- **Marketplace never shows "Update".** `listAvailable()` already works out
  `updateAvailable` and `updateCompatible` for every entry, but the page
  only ever draws Install or a green Installed. Installed Resources does
  show it ("Update waiting: needs OmniCore 1.19.7"), so the two pages
  disagree. Show the update on the detail page and the listing, and say
  when OmniCore itself must be updated first.
- **A rearranged module page** (`/marketplace/modules/<id>`), proposed:
  - The top segment stays.
  - Left: a scrollable **Description** segment, with the Source segment
    under it.
  - Right, small segments: **Compatible with** (the OmniCore version on
    the same line), **Version**, **Emits**, then **Author**, so Author and
    Source sit side by side at the bottom.
  - Version is the module's publish date as `YYYY.M.D.H.M`, with no zero
    at the front of any part. The Compatible with segment turns yellow
    when the running OmniCore is older than the module needs.
  - Themes' pages should probably match.
- **A manual Update button.** Today updates only happen in the background
  after a check. Nothing lets a person press Update on one module.
- **No uninstall in the UI.** Removing a module or theme still means
  deleting its folder.
- **Test CI.** `npm test` has 20 test files, but nothing runs them on a
  push. The workflows only publish the image and the docs site.
- **Tag workflow concurrency.** Two `v*` tags pushed together can run the
  image publish at once. Push tags one at a time, or add `concurrency`.
- **Updates are only noticed for tagged releases.** An untagged version
  bump is invisible to the updater. Always tag.

## Proposed: a new layout for a module's Marketplace page

Agreed in principle, not yet scheduled (themes share the page).

- Top segment stays as it is.
- Left: **Description** in its own scrollable segment with a title, and
  **Source** below it.
- Right, top to bottom: **Compatible with** (a version tag on the same
  line), **Version**, **Emits**, **Author**. Author and Source end up side
  by side along the bottom.
- The version is the publish date as `YYYY.M.D.H.M` with no leading zeros,
  so it reads like a version number. The segment turns yellow when the
  running OmniCore is older than the one the module needs.
- To settle: UTC or local time for the version, which segment tints, and
  whether the Installed Resources page shows the same version.

## v2.0: settings rework

A heavy rework of the settings pages.

- A dedicated Marketplace segment on the settings home.
- A clear way from there to Resource Management (Installed Resources).
- Probably the moment to give the Marketplace a real visual pass too.

## Deferred, with why

**Sandboxing modules.** Modules are reviewed, then trusted like any
dependency: full Node access. The `omni` API split exists so a restricted
module can later get a smaller `omni` object. Not started.

**A native installer** (a Windows `.exe`, a signed Mac `.app`). Docker
Compose still needs one command in a terminal. Needs code signing,
per-OS packaging and a tray icon. A separate project.

**Container auto start and shutdown, and Docker Hub login.** Parked.

**Sideloading** from a local folder or URL. Never designed.

**`system-patch`**, a third resource kind that changes OmniCore's own
behaviour (a voice assistant character, say). No schema, no design.

**Richer author profiles.** The author page is an exact-match filter on
`author`. No bio, avatar or verified identity.

**Screenshots.** The mechanism works end to end, but every module's
`screenshots` array is empty. Screenshots for ntfy were deferred.

**Registry collisions.** If two sources list the same `id`, the built-in
registry wins. Reasoned about, never tested.

**Calendar widget types and recurring events (RRULE).** Part of the
Calendar rework.

**Windows 8 theme.** Needs a pass, and does not draw `time` blocks as
clocks yet (it falls back to plain text).

**More font subsets, and the Adamina `firstWoff2Url`.** Parked.

**`trust proxy`.** Parked until OmniCore is documented behind a reverse
proxy.

## Known rough edges

- No password reset: delete `data/admin.json` to start over.
- Plain HTTP only; use a VPN or reverse proxy off a trusted network.
- A face's tiles do not all remember their size between reloads; it is up
  to the theme.
- **OmniView** (the display client) and **OmniSync** are named but not
  built.
