# Backlog

What is left to do, and what was deliberately put off. Last cleaned up
after v1.19.8. Anything already built has been removed from here; the
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
   - Credit for the source, in `data-source` (OmniCore 1.19.8).
   - Notifications for severe weather alerts where the source has them:
     Environment Canada (red, orange, yellow), MET Norway's MetAlerts
     (red, orange, yellow, by coordinates). OpenWeatherMap's alerts are
     only on its paid One Call 4.0, so none on the free key. Open-Meteo has
     none. Google Weather left for later.
   - A US source too: the National Weather Service, US only.
   - Built against the saved samples (see **Weather: tasks and samples**
     below). Needs OmniCore 1.19.8.
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

### Samples

Gathered on Oct 11, 2026 (kept in the session, not in the repo):

| Source             | What we have                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Open-Meteo         | Current conditions and today's high and low.                                                                   |
| Environment Canada | Regina's city page (current, forecast periods, a special weather statement) and all 844 cities (a yellow snowfall warning). Every value comes in English and French. |
| MET Norway         | The Oslo forecast (`complete`, with `apparent_air_temperature` for feels like; wind in m/s), English MetAlerts (22 marine alerts) and the empty case. |
| US (NWS)           | Point, forecast (Fahrenheit), latest station observation (metric), and real alerts: the Denver point (none) and 73 severe ones. `limit` isn't accepted on `alerts/active`; `point=` works. |
| Google Weather     | Current conditions, 3-day forecast, and four real alerts (US floods, from NOAA). Alerts carry an id, title, event type, severity, urgency, times, instructions and the publisher. |
| OpenWeatherMap     | None: the key answered 401. Built from the documented shape; test live with a working key.                     |

### The US source

The **National Weather Service** at `api.weather.gov`: free, no key (one
may be required in future), and it needs a User-Agent. A place goes
through `/points/{lat},{lon}` to find its forecast and nearby stations;
current readings come from the nearest station's latest observation (up
to about 20 minutes old). Alerts come from `/alerts/active?point=lat,lon`.
Alert levels follow CAP (severity Minor, Moderate, Severe, Extreme), not
colours, and an alert says whether it's new, an update or a cancellation.

### Tasks (Weather module, Essentials)

1. `module.exports.label`: the location's name.
2. Source setting, default Open-Meteo, with `ask` for OpenWeatherMap and
   Google Weather (each into its own `password` key setting). One small
   adapter per source that turns its answer into the same named pieces
   (Temperature, Condition, Feels like, High / low, Humidity, Wind, and
   whatever else a source has), so the tile code doesn't care where the
   data came from.
3. Region rules: Environment Canada only for places in Canada, MET Norway
   only for Norway, the US source only for the US. Outside its region the
   tile says what that source covers instead of showing wrong data.
4. Units: temperature (Celsius, Fahrenheit) and wind speed (km/h, mph),
   separate choices, applied to every source.
5. The Info order per source: one `priority` setting per source, each with
   a `showWhen` on the source, with its own default order.
6. `data-source` for every source, and "last known" kept for stale data.
   Use `status` from `omni.fetch` to say "Invalid API key" on a 401 or 403.
7. Alerts as notifications, for Environment Canada, MET Norway, the US
   source and Google: one notification per new alert, never repeated on
   every refresh, priority from the alert's level, link when the alert
   has one. Tested with the saved samples, including the quiet case and a
   cancelled alert.
8. Rewritten description with a "What it needs from you" section per
   source, no long dashes. Registry entry: new ref, `minOmniCore` 1.19.8,
   `background` and `notifies` set.
9. Windows 8 draws `data-source`, small, on a tile that has room.
10. Tests with the saved samples; check each source's attribution wording
    against its licence.

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
  - Version is the module's publish date as `YYYY.M.D.H.M` in UTC, with
    no zero at the front of any part (a lone `0` at midnight is fine). The
    Compatible with segment turns yellow when the running OmniCore is older
    than the module needs.
  - Themes' pages should probably match. To settle: whether Installed
    Resources shows the same version.
- **A manual Update button.** Today updates only happen in the background
  after a check. Nothing lets a person press Update on one module.
- **No uninstall in the UI.** Removing a module or theme still means
  deleting its folder.
- **Test CI.** `npm test` has 25 test files, but nothing runs them on a
  push. The workflows only publish the image and the docs site.
- **Tag workflow concurrency.** Two `v*` tags pushed together can run the
  image publish at once. Push tags one at a time, or add `concurrency`.
- **Updates are only noticed for tagged releases.** An untagged version
  bump is invisible to the updater. Always tag.

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
