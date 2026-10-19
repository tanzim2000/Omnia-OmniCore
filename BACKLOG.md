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

- **Knowing the screen a page is on** (asked in the v2 test run, Oct
  2026). One shared layer on every page OmniCore draws, faces included:
  its script labels the page with what it's on (phone, tablet, desktop or
  wall; touch or mouse; upright or sideways) and keeps that up to date as
  the window turns or resizes, so Settings, the wizard and themes all read
  one answer rather than each guessing with its own rules. Each screen
  with a face open also reports that shape, so a face's "Showing on" can
  say "2 screens: a 1920x1080 touch screen, sideways, and a phone", and the
  wizard can suggest sizes that suit it. The layout is still decided on
  each screen, never by the server: one face can be open on several
  screens of different shapes at once. Modules stay the same for every
  screen (one module run serves them all); themes and widget types are
  what adapt. The sideways settings home would be its first user. It
  doesn't replace measuring in the page: how much room is left under one
  search box at one moment is only known there.

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

- **The sideways settings home with a real mouse and trackpad.** Tried in
  a test browser only. Check that the up and down wheel never changes tab
  (over the release notes, over a box that scrolls, over empty space),
  that a trackpad's two-finger sideways swipe both ways feels right and
  snaps (let go halfway, it should finish the move without fighting the
  trackpad's own coasting), that Shift and the wheel moves it, that Left
  and Right change tab but not while typing or on a slider, and on a phone
  that a sideways swipe moves exactly one tab.
- **Change background on a phone.** The colour wheel was only tried with a
  mouse and arrow keys; try it with a finger, and check the pop-up fits a
  phone held upright (it scrolls inside itself past 92% of the screen).
- **Place search's keyed services.** GeoNames, LocationIQ, Geoapify and
  Geocode.maps.co are tested only against answers written from
  their documentation (`test/fixtures/place-search/README.md`). Try each
  with a real key, and replace those files with real answers. GeoNames did
  answer live, refusing a made-up username, and that was handled.
- **An MP4 background in a real browser.** The browser used while building
  has no H.264, so MP4 was tested on the server side only; try one in
  Chrome, Edge or Safari. Video plays only in formats the browser plays
  (H.264 MP4, VP9 WebM); anything else is refused when it's picked.
- **Update now through a real restart.** The About tab's Update now is the
  Updates page's own code, moved; it has only been run against tests and a
  fake Docker. The first real release after v2 will show it working.
- **The veil on bright pictures.** It aims at the brightest tenth of the
  picture, so a mostly bright picture may be dimmed more than it needs.
  Tune it after real use, with real pictures.
- **OmniCore's own icon.** `core/favicon.svg` is a stand-in (a charcoal
  tile with a ring). Make the real one (Quiver or Stitch), a square SVG
  that still reads at 16 x 16 on a dark tab and a light one, and replace
  that file.

## Licensing: left to do

Decided in Oct 2026 (LICENSING.md has the whole of it): OmniCore is
AGPL-3.0-only with an exception for Resources; the docs are all rights
reserved with code examples 0BSD; the names are in TRADEMARKS.md;
contributions come under the CLA.

- **The Registry and Essentials repos.** The Registry's listing gets CC BY
  4.0, with submission terms (a resource is listed only by its author, or
  as a clearly marked and credited fork; no re-listing someone else's
  work under your own name; a mirror may say it's a mirror, never the
  official registry) and a `license` field on every entry. Essentials
  gets 0BSD. The files come separately, with where each goes.
- **CLA Assistant.** Until it's installed on the repo, a contributor
  agrees by posting the sentence in CONTRIBUTING.md on their first pull
  request; nothing from outside is merged without it.
- **A lawyer's read** of CLA.md and the section 7 permission and terms in
  LICENSING.md, before the first outside contribution or the first
  commercial licence. Not needed for the v2 release.
- **A trademark clearance search** before registering any of the names
  (CIPO, in Canada). A quick look found other products called Omnia
  (an "Omnia Genius Smart Home" app, OMNIA filings in the US, OmniaONE),
  so registering could be refused or contested. Only worth paying for
  once OmniCore has real users. The names are used with ™ until then.
- **Paid resources.** The licence already allows a paid or closed
  module, face or theme; the Marketplace has no way to sell one yet.
- **Write down what OmniView REVIVE and OmniSense are**, once they're
  decided. TRADEMARKS.md names them without saying.

## v2: ideas left from the design

From the conversation and the mockup (Oct 2026,
https://claude.ai/artifact/LveFSPbVeF9ScADgdPWFhP). Not needed for v2:

- A background per browser rather than one for the whole install.
- A faint grain over the glass.
- A few ready-made pictures to pick from beside Choose a file (the
  mockup's were stand-ins; none ship).
- Default wallpapers, one for dark and one for light, as the Default
  background (Oct 2026). Until then Default is a colour: Artist's
  Charcoal (#37393E) in dark mode, Beige Cream (#EEDEC5) in light.
- An API key manager: one place for every key OmniCore holds (place
  search's, and the ones modules ask for). For now a key is asked for
  when its service is picked, and Saved keys only lists place search's.

Settled, so not to be reopened by accident:

- Place search has no box to type keys in ahead of time, and no box
  describing every service: a key is asked for when its service is
  picked, and the question says what the service is and costs (v2 test
  run, Oct 2026).
- Google is not a place search service. Its terms want Geocoding results
  shown on a Google Map and limit how long they're kept, and a picked
  place stays in the settings. Dropped before v2 was released.
- Nominatim's policy asks that an application can stop using it if the
  OpenStreetMap Foundation asks, without an update. Each install can pick
  another service on the General tab; that's enough.
- The data folder isn't shown on the About tab. In Docker it's a volume
  (`/app/data` inside the container), which says nothing useful to the
  person looking.
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
