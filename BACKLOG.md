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
Designed in conversation (Oct 2026), nothing built yet. A mockup comes
first, so the look can be judged before any real code. OmniCore v2 is aimed
at capable machines, so it does not need to be designed around slow ones.
Everything below is opt-in: anyone who changes nothing sees no change.

Settings home:

- **Four tabs in a notch.** A black notch drops from the top centre with
  four icons: General (Location Service, Place search), Appearance
  (Appearance Mode, Back Button Position, Text Size and Typography),
  Resources (Manage Faces, the Marketplace, Installed Resources) and
  About (version and updates, system info). The selected icon shows its
  name beside it; the others show theirs on hover, keyboard focus and long
  press, and all have accessible labels. The icons are hand-drawn inline
  SVG (no icon font, no CDN). The notch needs a thin lighter edge so it
  shows on a black page. The heading moves below it on a phone held upright,
  and the version pill and update dot stay on the right on every tab.
- All four tabs are on one page, switched by a small script, so the
  notch and the movement are not interrupted by a reload. The address
  follows the tab (`/#appearance`), the last tab is remembered per browser,
  and opening or reloading starts on the right tab without any movement.
  Without the script, the four tabs are stacked so nothing is unreachable.
- The Resources tab is the clear way to Resource Management, and replaces
  the old idea of a Marketplace segment on the home page.

Background and glass:

- **Background.** Black stays the default. People can upload a picture, a
  GIF, an animated WebP or a looping muted video (MP4 or WebM), kept in
  OmniCore's data folder and served by Core, never sent anywhere. Video is
  the better choice for HD; a GIF cannot look HD. Check the real file type
  rather than the name, set a size limit, and refuse SVG. The picture is
  drawn on a fixed layer behind the page, because `background-attachment:
fixed` is unreliable on iPhones. Starts as a global setting; per browser
  could follow. Applies to OmniCore's own pages, not to a face, which keeps
  its theme's own background.
- **Pure frosted glass segments.** Every bento segment becomes a
  translucent fill, a blur and a thin light edge, from one set of values.
  The comment in `ui-theme.js` about the ambient blobs (blur does nothing
  over a flat colour) goes away once a real picture is behind the glass.
  The blur, tint and dimming ranges can be generous, and a faint grain and a
  small saturation boost behind the glass are possible.
- **Tint.** A colour and a strength, kept to "a little", with presets and a
  picker. **Match the picture** takes the colour from the background
  automatically: sampled once when the picture is set (an average of its
  main colours, or one frame of a video), not live, so the interface does
  not change colour while a video plays. A hand-picked colour overrides it.
- **Readability.** An automatic dimming layer under the glass, checked for
  contrast, plus a brightness slider, so text stays readable over a bright
  or busy picture.
- Reduced motion shows a still frame. A hidden tab pauses the video.
  Nothing here is about slow machines.

Motion:

- **Tab-linked movement.** The four tabs sit side by side on one wide
  canvas and the screen is a window over it. Switching a tab pans the window,
  in the direction of the switch: the old tab's glass panes slide out, the
  new ones slide in, and the wallpaper moves the same way but about a
  quarter as far, so the glass crosses different parts of the picture and
  the blur shows. The notch stays fixed. Each tab scrolls up and down on
  its own, tabs that are off screen are hidden from the keyboard and screen
  readers, and the picture never moves by itself. Reduced motion switches
  tabs instantly. The plain black background still slides the panes.
- **Page fades.** Leaving a page slides the notch up (Settings home only),
  then fades the whole screen to the page's base colour: black in dark
  mode, white in light mode, following Appearance Mode first and the device
  setting when it is left on automatic. The next page fades in from that
  colour, and the notch drops in again. About a quarter of a second out, a
  little longer in. Applies to every page, faces included. Handle: the back
  and forward buttons restoring a page from memory (reset on `pageshow`, or
  it stays black), Ctrl or Cmd-click, new-tab links, downloads and
  same-page `#` links (no fade), a slow or failed load (the old page
  returns after a few seconds), form posts and the redirect after Save, and
  reduced motion (instant). Reloads and automatic refreshes do not replay
  it, so a wall display does not flash. The colours and animation live in
  `uiStyles` in `core/ui-theme.js`; the click handling is a small shared
  script added to each page template.
- **Face themes own their appearing animation.** Core only draws the
  fade-from-black curtain. The theme runs its own entrance after it (Windows
  8 tiles flying in and flipping into place, say). Core needs to give
  themes a signal at the moment the curtain has lifted, so the intro does not
  play hidden behind the black, and a theme can opt out of the Core fade in
  `theme.json` to do the whole entrance itself. A theme that says nothing
  gets the Core fade, so existing themes keep working. To be written into
  the theme docs.

Settled, so not to be reopened by accident:

- The neumorphism look was considered for OmniCore's own interface and
  judged too much work for a system UI (it changes how every surface is
  drawn, not only its colours). It is kept for a face theme instead (see
  **Neumorphic bento face theme** below). OmniCore's own pages stay glass,
  and the old ideas of a modern system UI theme and a choice of system themes
  are dropped in favour of the background and tint above.

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
