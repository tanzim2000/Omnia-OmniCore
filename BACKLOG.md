# Backlog

What is left to do, and what was deliberately put off. Last cleaned up
when v2 was finished on its branch (Oct 2026). Anything already built has
been removed from here; the CHANGELOG is the record of what shipped (v2's
under Unreleased until it has a version).

If you are picking this back up after a break, this file plus
`docs/Architecture.md` should be enough to re-orient.

## Now: Network Management, for 2.0.0

Decided to ship in 2.0.0 (Nov 2026). Built in steps, one zip each:

1. **The network helper** (done): reads the host's Wi-Fi through a
   short-lived copy of OmniCore on the host's network. Read-only.
2. **The watcher, the takeover and the status drawer** (done).
3. **Manual Setup** (done): nearby networks, a password typed on a
   physical keyboard, back to the old network if the new one doesn't
   work. Not yet: hidden networks (typing a name), WEP and 802.1X
   networks, and putting the old file back if OmniCore stops in the
   middle of a try (the copy stays beside it, `.omnicore-before`).
4. **The hotspot and the OmniSync QR** (done): OmniSync first, with "Set
   up manually" under the QR code; only OmniSync reads it
   (`docs/OmniSync-setup.md`); ten-minute rounds so the old network can
   come back by itself. Not yet: back to OmniSync after choosing manual
   (it comes back with the next outage, or a restart); and a server that
   already runs a DHCP server can keep dnsmasq from starting (the hotspot
   then says it failed, and Manual Setup shows).
5. **The Network page** (done), from the Network box on the Resources tab:
   the Wi-Fi now, known networks with Forget, and joining another network
   the safe way. Not yet: live speeds on the page, and a cable's details.
6. **Kept passwords and the Guest Wi-Fi widget** (done): every network
   joined through OmniCore keeps its password, sealed with AES-256-GCM
   (`core/network-passwords.js`). Known networks have Edit (password and
   security, Join automatically, Forget) and Show password (after the admin
   password: the password and a QR code). OmniCore sets the priorities:
   every network that joins automatically alike, so the strongest wins. Guest
   Wi-Fi is the first widget built into OmniCore (`core/built-in/`), with
   "Add a network around you", which checks a password and comes back.
   Not yet: a guest network the router turns on and off on a schedule.
7. **Docs** (done): the CHANGELOG's v2.0.0, `docs/upgrades/2.0.0.md`,
   Architecture (Network Management in §8, built-in widgets in §5e), and
   the `qr` block's `fallback` in the module and theme guides.

Then on your server, before tagging (none of it has run against real
Wi-Fi hardware yet, only stand-ins and BusyBox):

- What `/network/probe?raw=1` says: the manager, the card, its radio.
- The takeover when the Wi-Fi goes, and Manual Setup on the server's
  screen: joining, a wrong password (put back within the minute), a
  network with no internet (put back).
- The no-internet drawer, and the reconnect drawer with its speeds.
- The OmniSync hotspot: it comes up, its QR code shows, ten-minute rounds,
  "Set up manually" turns it off.
- The Network page: joining from Networks around; the priorities in
  `wpa_supplicant.conf` afterwards (every network that joins
  automatically at 50, the one being tried at 99 only while it's tried).
- Edit: Join automatically off and on (`disabled=1`), a new password for a
  network the server isn't on, a new password for the one it's on (tried,
  and put back when wrong), Forget from the bottom of Edit.
- Show password: the admin password asked first, the QR code scanned with
  a real phone, the five-wrong-tries stop.
- The Guest Wi-Fi widget on a dashboard, scanned with a real phone; "Add a
  network around you": the server leaves for the check, comes back to its
  own network, and the network is kept with Join automatically off.

## Done: one central theme

Decided (Nov 2026): every page OmniCore draws is built only from the
central theme's elements (`core/ui-theme.js`), with no looks of its own.
An element a page needs is made there, described in `docs/ui-elements.js`,
and reused wherever something looks the same. Things that have to carry
their own look onto dashboards (the status drawer, the takeover,
notifications, the page fade) are central elements too, handed out by
`ui-theme.js` as a separate bundle, since a theme's page doesn't load the
whole Default UI. Page scripts only switch classes, `hidden` and CSS
variables (`--x`), never a colour, size or spacing. The one exception is
Face:1303 (the About face, `about-face.js` and `about-face.css`), which
never uses the central theme: Core adds only its own elements there (the
Back button, the page fade, the status drawer and the takeover), and its
look is its own, following Dark and Light only.

`test/central-theme.test.js` checks every file in `core/` for style blocks,
CSS rules, `style=""` attributes and scripts setting looks. While the
pages were moved, what was left was listed in it (`STILL_TO_MOVE`) and
only warned about; the list is empty now, so any look of its own fails. Each step is compared with screenshots of every page,
desktop and phone, taken before it, pixel by pixel.

1. **The test, and the Network page** (done): the page's 42 rules became
   central elements (`.item` rows, `.headline`, `.signal`, `.spinner`,
   `.form-stack`, `.switch-row`, `.inline-buttons`, `.qr-box`, `.secret`,
   small and wide glass buttons, tight and short lists, a wider second
   box), and `[hidden]` hides whatever an element's own display rule says.
2. **The overlays and Manual Setup** (done): the status drawer, the
   takeover, notifications and the page fade are one overlay bundle in
   `ui-theme.js` (`STATUS_CSS`, `notificationStyles()`, `CURTAIN_CSS`,
   `curtainStyles()`), sent with a theme's page through `styleTag()`, the
   one way any page gets a `<style>`; their scripts only set classes,
   `hidden` and `--omni-net-at` / `--remaining`. They're in the catalogue
   under Overlays. Manual Setup is built from the Default UI (dark, on a
   see-through page): the Network page's rows, a box heading with Look
   again, the password box, glass buttons, and a centred stack for the
   OmniSync code. Also: variants are a base plus a modifier that only adds
   (`base` in the catalogue, shown as "Builds on"); one `.buttons` row with
   `.dialog-buttons` for a pop-up's; one row padding for every list row;
   the box heading (`.segment h2`, `.box-head`) moved out of
   `admin-face.js`.
3. **The Settings home** (done): the page of tabs, the notch and the
   capsule, the tab grid, link tiles (with pictures, and leading
   nowhere) and fact rows are central elements, in a new Page layouts
   section of the catalogue. Its script sets `--pill-x`, `--pill-w` and
   `--rows` instead of looks. The two `.fact` definitions (the Settings
   home's and `admin-face.js`'s) are one, which puts a face's hints back
   under its facts. "Lending room" (`.lends-room`, `.borrows-room`)
   replaces the Appearance tab's own mode and type box rules. The notch's
   padding is in em, so it grows with the text size like everything
   else.
4. **The Settings pages** (done, `admin-face.js` has no looks of its own),
   in two:
   - **4a**: the Settings page itself (`body.settings-page`, the
     bento, its rows and columns), the docked page, inset strips, the
     mode previews (their little screens drawn by classes, not
     `style=""`), a face's page, rows, the update boxes and release
     notes, the About box, Location, Place search's warning, Saved keys,
     the major version box and pop-up, Installed Resources' facts, the
     font search, and full-width, medium and "not yet" glass buttons.
     One `.hint` for every page (the Settings pages' had its own, which
     won there). A style attribute that only sets CSS variables
     (`style="--hue: 210"`) no longer counts as a look.
   - **4b**: the Background preview and pop-up, the colour wheel and its
     knob, tint chips, glass fields, Dim's Auto, and the Marketplace (its
     pages, listings, tags, a listing's page, Sources, the registry error
     and the third-party warning). Colours only the page knows (a
     swatch's, the wheel's knob, the preview's) come in as CSS
     variables. The picture pane's buttons are the central `.buttons`
     row. `admin-face.js` still includes `PRIORITY_CSS` and
     `PLACE_SEARCH_CSS`, which are `priority-ui.js`'s and
     `place-search-ui.js`'s and move in step 5.
5. **The rest** (done): the wizard (`body.wizard-page`), the welcome face
   (`body.welcome-page`), the centred pages (a face with no theme yet,
   `.fallback-page`, and an Inport's page and its picker, `.inport-page`),
   Info order lists (`PRIORITY_CSS`) and place search's matches
   (`PLACE_SEARCH_CSS`), and the background's fade from the last page
   (its colours as `--was-*` variables). The About face stopped loading
   the central stylesheet: `about-face.css` has its own colours, dark and
   light (`data-mode` on `<html>`, or the device's own), its own
   background and its own buttons; Core sends its Back button
   (`backButtonStyles()`, with the room the button keeps free at the top
   or bottom of a page), the page fade, the drawer and the takeover.
   `STILL_TO_MOVE` is empty. An Inport's page joined its picker in
   selecting no words on a tap (what's typed into its number box still
   can be).

Also in step 5: no long dash in anything Core says
(`test/long-dashes.test.js` checks `core/`, comments aside; a widget's
long dash for no value is allowed), and `npm test` prints one line per file
(`test/reporter.js`), with `npm run test:full` for every test.

## Next: appearance, for 2.0.0

Decided (Nov 2026), built in this order, one zip each, after the central
theme. Each built from central elements from the start.

### A. Matching the background: done

Built as below (`solveGlass` in `core/backdrop.js`; the Appearance tab is
sent its source, so what it shows is what's saved). What it settled that
the plan didn't say:

- **Glass stays glass** (after the first build): over a picture or a
  colour, everything made of glass (boxes, buttons, tabs, input boxes,
  the Back button) is the dark set's glass, whatever the mode and the
  font colour: a whisper of white, the tint and the Dim. Only the text
  colours follow the font colour (`overPicturePalette` in ui-theme.js).
  With the Default background there's no Auto, Picture brightness or
  Dim, Font colour says it needs a picture or a colour, and Blur and Tint
  strength are as set by hand.
- **Font colour is White or Black, no Auto** (decided after the first
  build). White to start with; the Appearance Mode doesn't decide it over
  a picture. Core switches it, saying nothing, only when the glass or the
  background changes and it can't be read even with every free slider
  as far as it goes (`fontToKeep`). Picking it never sets that off, so a
  person can switch back until the next change. Picked from two "Aa",
  each on a piece of the background through the real glass.
- **Text with no glass under it** (a page's title, and the line under the
  welcome face's and the wizard's) is white or black by the background
  itself, never the font colour; flat, no shadow (after the third build:
  the glow looked bad). Page titles are Metro style: large, thin, lower
  case, set close. A glass button outside any box (Create a
  new face) and the floating Back button get the tint and Dim like a box.
- **A slider moved by hand is pinned at once, and says so** ("Pinned",
  which can be pressed to let Auto have it back).
- **Save and Cancel for the whole Appearance tab** (after the third
  build): the glass, Font colour, Text size and the Back button show at
  once and are kept only with Save; Cancel, or leaving the page, puts
  them back. In an untitled box where Appearance Mode was, there only
  while something isn't saved, with the warning, so no box changes
  height. No "Saved." line.
- **A page's title on the background** is white or black by the
  background itself, never the font colour (after the third build).
- **Tabs end level** (after the third build): the second row's boxes
  reach the bottom; General gets an empty box on a third row for what's
  coming.
- **Over a colour** (after the second build): no Dominant or Vibrant (they
  would only tint the glass with the colour behind it), and Colour
  brightness mixes white in to brighten, so black can get lighter.
- **How Auto sees a picture:** the worst part under the text (its
  brightest tenth under white, its darkest under black), drawn towards
  the picture's overall brightness by Blur, up to halfway at 40 px. Each
  layer laid over the one below on each colour value, as the browser
  does. Auto takes Dim up to 85%, Blur and Tint strength as far as their
  sliders go. Tint strength goes to 100%, a solid colour (35% in the first
  build).
- **Nothing released needs converting:** pictures behind the pages are
  new in 2.0.0. A picture picked by an earlier v2 build gets its vibrant
  colour and overall brightness the first time the Appearance tab opens,
  and "Match the background" reads as Dominant. Its old brightness and
  hand-set Dim aren't carried over: Original and Auto.

The plan, as decided:

- **The tint's choices:** None, **Dominant** (today's "Match the
  background": the colour that covers most of the picture) and **Vibrant**
  (its most saturated, eye-catching colour), then the fixed colours. Both
  are worked out once, when the picture is picked, so nothing changes
  colour while a video plays. Only with a picture (a colour background
  doesn't offer them, decided after the second build).
- **Picture brightness:** a plain slider from **50% darker (-50%) to 50%
  brighter (+50%)**, with **Original (0%)**, the picture as it is, the
  default. Never automatic. Core may start a bright picture darker when
  it's picked; the slider then shows that value.
- **Dim** darkens the **glass** (darkness added to the tint), not the
  picture. It no longer has anything to do with Picture brightness.
- **One Auto for Blur, Tint strength and Dim**, keeping the page's text
  readable (a contrast of at least 4.5 against what's behind the glass).
  Moving one of the three by hand **pins** it: Auto leaves a pinned slider
  alone. Picture brightness can never be pinned or automatic. Turning Auto
  back on frees all three.
- **Which free slider Auto moves:** Dim, then Blur, then Tint strength,
  each up to its limit before the next. With nothing pinned, only Dim
  moves; Blur and Tint stay at their defaults.

  | Pinned | Auto moves, in order | Left as they are |
  |---|---|---|
  | Nothing | Dim (then Blur, then Tint, if Dim reaches its limit) | |
  | Dim | Blur, then Tint | Dim |
  | Blur | Dim, then Tint | Blur |
  | Tint | Dim, then Blur | Tint |
  | Dim and Blur | Tint | Dim, Blur |
  | Dim and Tint | Blur | Dim, Tint |
  | Blur and Tint | Dim | Blur, Tint |
  | All three | Nothing | All three |

  Then, in every row: with the font colour not pinned, if the text still
  can't be read, Auto switches the font colour (white to black, or black
  to white); with it pinned, the page warns that the text may be hard to
  read.
- **How far each moves:** a free Dim goes only as high as needed, and back
  down when the picture is darker. A free Blur or Tint never goes below its
  default, only above it when needed.
- **When one can't help:** Blur only helps against bright spots and busy
  detail; on an evenly bright picture it counts as at its limit and Auto
  moves on. A tint only helps white text if its colour is darker than the
  picture; a light tint on a bright picture counts as at its limit.
- **Font colour:** white or black, Auto's **last resort** (only when nothing
  else can make the text readable), and it can be pinned. When it switches
  to black, darkening works against it, so Auto lowers whatever free
  sliders it raised. It has a picker of its own in the Typography box
  (Text Size & Typography until then), beside the font: **"Aa" in white**,
  **Auto** and **"Aa" in black**, three buttons side by side. Picking White
  or Black pins it.

### B. Appearance profiles

- **Light and Dark mode go away for good** (done): the font colour picks
  the everyday colours, for the whole install, until profiles let each
  browser pick its own. On the Default background White is black and
  Black is Beige Cream, picked on the Appearance tab. The switch is gone
  from the welcome face and the sign-in page, and a browser's earlier
  pick (its cookie) no longer counts.
- **The welcome face** (done, with the step above): its title in a box
  of glass like a widget's page, so it reads over any background; the
  faces in a pane of the same width; only the Settings button in the
  corner. Its Light / Dark / Device switch went with the modes.
- **Save over a warm picture** (done): solid green with white words over
  a picture or a colour.
- **A profile is one `.ocap` file** (done): a signed tar file holding its
  settings, its picture and its font. It can't be made without a picture
  or a colour. Kept on the server, so every device sees the same list.
  Each browser remembers its own pick, one profile per device. The first
  one is made from the look an install already had, or black with white
  text on a fresh one. Signed by the OmniCore that made it; a changed file
  is refused. Every device using a profile sees its changes.
- **Selling profiles** (later, with paid Resources in the Registry): the
  signature already says who made a profile and that it's untouched.
  Stopping an exact copy being passed on needs licences on top of it.
- **OmniView** will remember up to two profiles, to switch by time (one
  while the sun is up, another after it goes down).
- **The profile's font colour decides its everyday colours** (done in
  step 1): white text, the dark set; black text, the light set.

### C. The wizards on Face:3999

Face:3999 holds the wizards, each at its own address:

- `3999/getting-started`: **Getting Started**, the first-time wizard.
- `3999/create-dashboard`: **Create Dashboard**, the face wizard that's on
  3999 today, moved here. Face:4000's "Create a new face" and everything
  else that sends people to it point here.
- `3999/` on its own is not an address. Anything in Core that sends
  someone there is a bug.

Face:1303 is only the About face again (`1303/about-core`), the easter
egg, with its own look; it never uses `ui-theme.js`. The wizards use the
central theme like every other page.

**Before Getting Started.** Whenever Getting Started has a step to show,
every screen first shows only "Please connect to your OmniCore with a
browser or via OmniSync to get started" and **Okay**: no background,
nothing else. Okay makes that browser the one doing the setup (a token in
a cookie), and Core refuses every other connection until it's finished.
Every other screen shows "OmniCore is being set up on another device" with
**Use this screen instead**, which moves the setup there. Once the admin
password exists, Use this screen instead asks for it. If the browser
doing the setup goes quiet (closed, asleep) the setup is let go after a
while, so it can never lock OmniCore for good; nothing is lost, the
datasheet says where it was.

**The look.** The central theme with the Default background, following
the device's own dark or light setting (the browser, or OmniView, says
which): white text on black, or black text on Beige Cream. No picture
until the user picks one. Welcome fades in. Each Next slides the next
page in, pushing the one before off the screen like a sheet of paper (a
fade with reduced motion).

**The steps, in order:**

1. **Welcome to Omnia**: fades in, with room for the Omnia logo (an SVG,
   not made yet) and Next.
2. **Admin password**: a password only, no username. There are no admin
   accounts any more: when OmniCore comes as an OS (Alpine), the OS's own
   users will decide who can do what, and several admins come then. An
   install from before keeps its password (its hash is of the password
   alone); sign-in stops asking for a username.
3. **Wi-Fi**: before anything that needs the internet.
4. **Location**.
5. **Check for updates**: "Checking for updates…" while it looks. A minor
   update is installed there and then (OmniCore restarts, and the wizard
   carries on from the datasheet). A major upgrade is offered, to take or
   turn down.
6. **Terms**: after the updates, so they're the terms of the version that
   will actually run. The step records which terms were accepted: a later
   version with new terms shows it again. (What the terms are is still to
   be written: `LICENSE`, `LICENSING.md`, `TRADEMARKS.md` and `CLA.md` are
   licences, not terms of use.)
7. **Background, Frosted glass and Font**: one page, since Core keeps the
   font colour readable against the glass. This makes the first `.ocap`.
8. **Modules**: the only step that can be skipped ("Skip for now"), and
   skipping counts as done.
9. **First dashboard**.
10. **Done! Enjoy!**: an animation, then the Settings page.

**Built** (Phase C, steps 1 to 4): the addresses on 3999, the admin
password, the datasheet, the screen before Getting Started with the one
device doing it, and every step but the terms (still to be written).
Wi-Fi shows how OmniCore is connected; changing the network stays in
Settings, Network, since joining another one can cut off the device doing
the setup. Your look is the Appearance tab itself; from it on, the page
is drawn in the appearance profile rather than the device's dark or
light. The Omnia logo's room on Welcome is empty until the SVG exists.

**The datasheet.** Each step leaves its own record, by id with a version
(`appearance-1`). Core goes through it every time it starts: a step with
no record, or an older version's, is shown. A version bumped later shows
the step again, filled in with what's already set, to confirm or change;
nothing is ever wiped. A step about something Core can check is checked
for real (the admin password exists) rather than trusted to the record.
Having an `.ocap` doesn't count as having done the appearance step: only
the record does.

### Later, after 2.0.0

- **Seasonal themes for `1303/about-core`** only (Lunar New Year, Christmas,
  Halloween, Easter, ...), from an open-source **theme distributor**: the
  core sends it its location, it sends back the theme, from a stash the
  developer manages, and stores nothing. Themes are **signed**, not
  encrypted, and Core refuses one without the developer's signature.
- **A seasonal theme for every page, for good** (switching the central
  theme itself): a big promise, so not now. Every new element Core adds
  would break every such theme until its maker caught up. A smaller step
  first, if wanted: a seasonal theme changing the central theme's colours,
  fonts and background without drawing anything of its own.

## Then: releasing 2.0.0

1.20.0 and 1.20.1 are out: every 1.x install updates itself to them, and
from then on a new major version is offered in Settings and installed in
one press. `main` has been merged into `v2`, which is now 2.0.0
(`docs/upgrades/2.0.0.md` is what installs read before upgrading; no
data steps; `docker-compose.yml` on `:2`).

1. **Check 1.20.0 can update itself:** your server, on 1.20.0, takes 1.20.1
   (Update now, or within six hours). If it can't, that's fixed in 1.x
   before anything else, or no later fix can reach anyone.
2. **What's left to check on v2** (below) on a real screen, if wanted
   first: run the image workflow by hand on `v2` for a `:dev` image.
3. **Merge `v2` into `main`** (`git merge --ff-only v2` on `main`: `v2`
   already has everything `main` has), push, then **tag `v2.0.0`**.
4. **Upgrade your own server first**, from the box on its Settings home,
   before telling anyone. Nothing could try the real upgrade earlier: it
   needs 2.0.0's `:2` image, and a test release (`v2.0.0-rc.1`) neither
   publishes `:2` nor is ever offered. The helper's script was run in
   tests (GNU tools and BusyBox, what `docker:cli` has), never against a
   real Docker. If the upgrade fails, the old version comes back with its
   data, so the risk is a failed upgrade, not a broken install; and a
   major version waits for somebody to press Upgrade, so there's time to
   fix things.
5. **After that, a fix for 1.x** goes on a branch from `v1.20.1` and is
   released as 1.20.2: `main` is 2.x from then on.

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
- **Auto on real pictures.** It aims at the brightest tenth of the picture
  under white text (the darkest under black), so a mostly bright picture
  may get darker glass than it needs, and how far Blur helps is a model.
  Tune it after real use, with real photos and videos, in both modes.
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

## Essentials: left to do

- **Replace the saved Google weather answers** (`test/weather-samples/google-*.json`)
  with made-up data in the same shape. Google's Maps Platform terms
  restrict storing its content, so real answers in a public repo are
  probably not allowed. The weather tests read them.
- **Rename the "Windows 8" theme.** The name is Microsoft's trademark,
  the same thing TRADEMARKS.md stops others doing with Omnia's names. Its
  id `windows8` is also the folder it installs to, so a new id needs a
  way to carry existing installs over.

## Notch and capsule: left to check

On a real phone: tap and swipe between tabs (the glass and the name should
arrive together), long-press an icon, and look at the capsule over a
picture, a bright colour and in light mode. The update dot's green and the
radar rings can only be seen with an update waiting.

## Marketplace pictures: left to do

Built in 2.0.0: `icon` on registry entries, `banner` on the registry, the
Marketplace tile crossfading the banners. Left:

1. **Make the pictures:** a banner for Omnia-Registry (16:9, about
   1600 by 900, under 500 KB) and an icon for each Essentials module and
   theme (square, 512 by 512, under 200 KB). Put them in the Registry repo
   (an `images/` folder) and fill in `banner` and each `icon` in
   registry.json with their raw.githubusercontent.com addresses.
2. **Look at them on a real screen:** the tile on the Resources tab
   crops a 16:9 banner to its own shape (tall on a wide screen, wide on a
   phone), so keep what matters in the middle.
3. **Installed Resources** could show the same icons. Not built.

## v2: ideas left from the design

From the conversation and the mockup (Oct 2026,
https://claude.ai/artifact/LveFSPbVeF9ScADgdPWFhP). Not needed for v2:

- A background per browser rather than one for the whole install.
- A faint grain over the glass.
- A few ready-made pictures to pick from beside Choose a file (the
  mockup's were stand-ins; none ship).
- Default wallpapers, one for dark and one for light, as the Default
  background (Oct 2026). Until then Default is a colour: black
  (#000000) in dark mode, Beige Cream (#EEDEC5) in light.
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

- **Real liquid glass on the notch's selected tab** (the background bending
  behind it). It needs an SVG distortion filter that only Chromium draws
  and that is heavy on a phone, so the notch has clear glass (no blur)
  instead.

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
