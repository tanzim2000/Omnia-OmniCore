# Backlog

What is left to do, and what was deliberately put off. Last cleaned up
after the Weather rework (Oct 2026). Anything already built has been
removed from here; the CHANGELOG is the record of what shipped.

If you are picking this back up after a break, this file plus
`docs/Architecture.md` should be enough to re-orient.

## Now: making the Essentials modules work properly

One module at a time, each with a user-friendly description, a "what it
needs from you" paragraph, and the right `minOmniCore` in the Registry.

1. **World Clock**: done (single, dual and multi clock).
2. **Weather**: done. Six sources (Open-Meteo, Environment Canada, MET
   Norway, US National Weather Service, OpenWeatherMap, Google Weather),
   alerts as notifications, an Info order per source, temperature and wind
   units, the source's credit. Left to check is under **Weather: left to
   check** below.
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

## Weather: left to check

- **OpenWeatherMap live.** Built from its documentation; the key used
  while building answered 401. Test with a key that works.
- **Google Weather live.** Tested with saved answers only (the demo key's
  answers from Oct 11). Check a real key, and that 400 really means a
  wrong key rather than a place Google doesn't cover.
- **Environment Canada's list of places** (`data/ec-places.json`, 844
  places, Oct 2026) is kept in the module. If Environment Canada adds or
  renames places, the list needs refreshing.
- **Essentials has tests now** (`node --test` in the repo root, the
  Weather module against saved samples), but nothing runs them on a push.

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

## Next: found while testing Weather (Oct 2026)

Not coded yet. The release version for these is not decided; they may ship
as one release.

Fixes:

- **Widget page heading.** `/faces/<id>/modules/<module>` shows the widget's
  suggested label (the place, for Weather) as its heading, and "Weather"
  only when the location is set by hand. The heading should always be the
  module's own name. The Label box and the tile title keep following the
  suggestion, or the person's own label. Applies to every module. The
  heading is built from `shownName` in `core/admin-face.js`.
- **Save does not go back.** After a successful save on a widget's page,
  show "Saved" for about a second, then return to `/faces/<id>/modules`.
  On an error, stay on the page.
- **Delete face glows white.** `.glass:hover` adds a white glow and
  `.glass-danger` does not override it. Give `.glass.glass-danger:hover`
  and `:focus-visible` a glow in the danger colour, like
  `.dock button.danger`. (`core/ui-theme.js`)
- **The Save | Remove capsule is not docked on a widget's page.** It sits
  after the segments, so a long settings list pushes it off the screen. Pin
  it under the segments like the wizard does, and make the Settings segment
  scroll inside itself so the page stops scrolling.

Features:

- **Info order as a button.** The `priority` setting is drawn in both
  `core/admin-face.js` and `core/wizard-face.js`. With 4 items or fewer it
  stays an inline segment with drag and drop. With more, it becomes a
  button showing the order in short form (for example "Temperature,
  Condition, Alert and 8 more") that opens a dialogue with the full list,
  drag and drop, Done and Cancel. Keep the up and down arrows for the
  keyboard and for touch. Every module with an order setting gets it,
  including Weather's six.
- **Place search source, an OmniCore setting.** City search
  (`searchCities` in `core/location-service.js`) uses only Open-Meteo, which
  has no record of small places (nothing for Bekkestua; Bærum only as the
  village Bærums verk). Add a **Primary** and a **Secondary** source (Secondary can be
  None, and cannot equal the Primary); the Secondary is asked when the
  Primary finds nothing or cannot be reached. Default: Open-Meteo, then
  Nominatim, both without a key. One function serves the widget page, the
  wizard and OmniCore settings, so one change covers them. Sources:
  - No key: Open-Meteo, Nominatim (OpenStreetMap; at most 1 request a
    second, an identifying User-Agent, no search as you type, so only on
    pressing Search), Photon (Komoot; finds Bekkestua, terms page could not
    be read, check them first).
  - Key needed, asked for the way Weather asks (a `password` setting, the
    key kept secret, never shown or logged): GeoNames (a free account
    name, limits not verified), LocationIQ (5,000 a day, needs a "Search by
    LocationIQ.com" link), Geoapify (3,000 a day, needs "Powered by
    Geoapify"), Geocode.maps.co (25,000 requests then 1 a second), Google
    (billing must be enabled on the project, 10,000 free a month).
  - Left out: OpenCage (its free plan is for testing only).
  - A keyed Primary with no key saved falls back to the Secondary, and the
    settings page says so.
  - Show a small credit under the results naming the source that answered
    (and "(c) OpenStreetMap contributors" for Nominatim and Photon). The
    setting's text says what leaves the machine and to whom.
  - Needs tests with saved answers; nothing is checked live in the
    sandbox for the keyed ones.

## v2.0: settings rework and a new look

A heavy rework of the settings pages, and of how OmniCore itself looks.

- A dedicated Marketplace segment on the settings home.
- A clear way from there to Resource Management (Installed Resources).
- Probably the moment to give the Marketplace a real visual pass too.
- **Expand the settings home.** More is going onto it (place search, and
  more to come), so the page needs to grow into a real home screen.
- **A modern system UI theme, and a choice of them.** Redesign OmniCore's
  own interface (settings, wizard, admin pages) to look modern, and let
  people pick from several system themes. The face themes (Windows 8 and
  others) are a separate thing and stay as they are.

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
clocks yet (it falls back to plain text). It draws `data-source` (Wide and
Large at the foot, Medium as a page of its own, Small not at all).
The credit line does not fit well yet: a long one, such as "Based on
Environment and Climate Change Canada data" from the Weather module, wraps
onto two lines and crowds the tile's name on a Wide tile. The module sends
its full source credit, so the theme has to cope with a long one (shorten,
wrap properly or scroll). Look at it when the theme is rebuilt.

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
