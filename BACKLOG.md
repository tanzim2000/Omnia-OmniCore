# Backlog

What is left to do, and what was deliberately put off. Last cleaned up
when v2 was finished on its branch (Oct 2026). Anything already built has
been removed from here; the CHANGELOG is the record of what shipped (v2's
under Unreleased until it has a version).

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
- **A manual Update button for a module or theme.** Today they only update
  in the background after a check. Nothing lets a person press Update on
  one module. (OmniCore itself has Update now, on Settings' About tab.)
- **No uninstall in the UI.** Removing a module or theme still means
  deleting its folder.
- **Test CI.** `npm test` has 29 test files, but nothing runs them on a
  push. The workflows only publish the image and the docs site.
- **Tag workflow concurrency.** Two `v*` tags pushed together can run the
  image publish at once. Push tags one at a time, or add `concurrency`.
- **Updates are only noticed for tagged releases.** An untagged version
  bump is invisible to the updater. Always tag.

## v2: releasing it

v2 is built on the branch **`v2`**: the settings home in tabs, the
background and glass, page fades, place search and Info order (see the
CHANGELOG's Unreleased entry). `main` still holds v1.19.9.

- Nothing publishes from `v2`: the image workflow runs only on `v*` tags,
  the docs site only on pushes to `main`. To try it on the server, run the
  image workflow by hand from the Actions tab and pick `v2`; that `:dev`
  image is a development build.
- A fix that has to reach people first goes on `main`, is released and
  tagged there, then `main` is merged into `v2`.
- When v2 is judged ready: merge `v2` into `main`, pick the version (in
  `package.json` and `package-lock.json`), turn `## Unreleased` into
  `## v<version>`, push, then tag. More problems are expected once it's
  used; fix them as they come, one small commit at a time.

## v2: left to check

- **Place search's keyed services.** GeoNames, LocationIQ, Geoapify,
  Geocode.maps.co and Google are tested only against answers written from
  their documentation (`test/fixtures/place-search/README.md`). Try each
  with a real key, and replace those files with real answers. GeoNames did
  answer live, refusing a made-up username, and that was handled.
- **Google's terms** ask that Geocoding results be shown on a Google Map
  and limit how long they're kept. OmniCore credits Google under the
  matches, but a picked place's coordinates are saved for as long as the
  setting stands. Decide whether to keep Google as a choice.
- **Nominatim's policy** asks that an application can stop using it if the
  OpenStreetMap Foundation asks, without an update. Today that means each
  install picks another service on the General tab.
- **An MP4 background in a real browser.** The browser used while building
  has no H.264, so MP4 was tested on the server side only; try one in
  Chrome, Edge or Safari. Video plays only in formats the browser plays
  (H.264 MP4, VP9 WebM); anything else is refused when it's picked.
- **Update now through a real restart.** The About tab's Update now is the
  Updates page's own code, moved; it has only been run against tests and a
  fake Docker. The first real release after v2 will show it working.

## v2: ideas left from the design

From the conversation and the mockup (Oct 2026,
https://claude.ai/artifact/LveFSPbVeF9ScADgdPWFhP). Not needed for v2:

- A background per browser rather than one for the whole install.
- A faint grain over the glass.
- A few ready-made pictures to pick from beside Choose a file (the
  mockup's were stand-ins; none ship).

Settled, so not to be reopened by accident:

- The neumorphism look was considered for OmniCore's own interface and
  judged too much work for a system UI (it changes how every surface is
  drawn, not only its colours). It is kept for a face theme instead (see
  **Neumorphic bento face theme** below). OmniCore's own pages stay glass,
  and the old ideas of a modern system UI theme and a choice of system
  themes are dropped in favour of the background and tint.

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
clocks yet (it falls back to plain text). Its tiles flying in should start
on `omnicore:revealed` (v2), so they don't play behind the fade. It draws `data-source` (Wide and
Large at the foot, Medium as a page of its own, Small not at all).
The credit line does not fit well yet: a long one, such as "Based on
Environment and Climate Change Canada data" from the Weather module, wraps
onto two lines and crowds the tile's name on a Wide tile. The module sends
its full source credit, so the theme has to cope with a long one (shorten,
wrap properly or scroll). Look at it when the theme is rebuilt.

**Neumorphic bento face theme** (Omnia-Essentials). A new dashboard theme in
soft UI: surfaces the same colour as the page, pushed out of it or pressed
into it by one light and one dark shadow, in a bento layout, based on the
smart-home dashboard picture shared in Oct 2026. Notes: a dial or a toggle
is drawn from a value, not from text, and modules only send `pair`, `text`
and `time` blocks today, so a dial needs a new block type in the Content
Contract (a separate decision; the first version would draw the existing
blocks in soft tiles). A dashboard is read from across a room, so it needs
large dark text and a strong accent colour for the key value, not the low
contrast soft UI tends to have. Cope with a long source credit from the
start. Give it an appearing animation (tiles rising out of the surface)
once themes can own one. Not started; mockup first.

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
