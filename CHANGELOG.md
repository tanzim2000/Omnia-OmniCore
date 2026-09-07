# Changelog

## v1.6.2

Second stage of the Default UI refactor. Still no visible change for anyone using OmniCore today, on purpose.

### Changed

- **The admin face now draws from the shared stylesheet.** Its own 405 line stylesheet had every colour hardcoded; all of them are now CSS variables, so light mode reaches the admin UI rather than stopping at the two small pages converted last time. Semantic colours (the reds for warnings, greens for success, greys for disabled buttons) became real variables too, with genuinely different values per mode: the same red that reads clearly on black is far too pale to read on a near white page.
- **A floating back button on every admin screen that has somewhere to go.** Eleven screens got one, each pointing at its actual parent rather than relying on browser history. The settings home and the sign in screen deliberately have none, since there is nothing above them. Its corner follows the `backButtonCorner` setting.

## v1.6.1

First stage of the Default UI refactor (docs/planning/default-ui-architecture.md, not in this repo). No visible change yet, on purpose, see below.

### Added

- **`core/ui-theme.js`.** One shared stylesheet for every page OmniCore renders itself, replacing four separate hand-written copies of the same black background and glass button look that had already drifted apart from each other. Dark and light palettes, both fully driven by CSS custom properties. A downloaded font gets served locally at `/ui-font.woff2` rather than fetched from Google's CDN on every page load, so the admin UI stays usable without live internet.
- **Four new settings**, defaults only for now: `uiMode`, `uiFontFamily`, `uiFontSize`, `backButtonCorner`. No settings UI exists yet to change them; that's a later stage.

### Changed

- `fallback-page.js` and `input-face-page.js` now draw from `ui-theme.js` instead of carrying their own CSS. Verified end to end afterward, not just that they still compile: dark mode glows on card hover, light mode zooms instead, and a real tap plus a real number submission on an input face both still reach storage correctly.

## v1.6.0

Input faces can now take a number! Not just a tap,

### Added

- **The `number` control type.** A module's `input.json` can now declare a number field alongside (or instead of) a button. Each number control gets its own submit rather than one shared across the page: two number controls mean two independent facts, and pairing each with its own button keeps which-value-goes-where obvious. `onInput` receives `{ key, value }` for these, still just `{ key }` for a button. An empty or non-numeric field submits nothing at all, since that's a slip rather than an event worth recording.

### Fixed

- A symlinked module (the normal setup for developing one locally against a separate repo, like Omnia-Essentials) never showed up in the "add a module" list. Node's own Dirent type reports a symlink as neither a directory nor a file, and the module list only checked for a directory. Fixed: a symlink now gets resolved and included if it actually points at a real folder, and correctly excluded if it's broken or points at a plain file instead.

## v1.5.0

OmniCore now knows what time it is, on its own! The missing piece before any Clock module can be built against it rather than reaching for `Date` directly.

### Added

- **`omni.time()`.** One place establishing what time OmniCore thinks it is: a raw instant plus this machine's own resolved IANA zone, the same reasoning `location-service.js` already follows for location. Infrastructure, not a module: no settings, no marketplace listing, nothing shows on any dashboard just because this exists.
- **`GET /time` on every dashboard face.** The same snapshot, reachable by a theme directly with no module in between, for ambient chrome a theme wants to own itself (a corner clock baked into the theme's own markup, say).
- **Every building guide covers this now.** `Architecture.md`, `Building modules.md`, and `Building theme.md` all document `omni.time()` and `GET /time`, including, in the theme guide specifically, how to actually tick a `time` block forward locally between polls, since nothing on the server keeps it running for you.

## v1.4.0

Modules can now remember things and take physical input, built in core ahead of the module itself.

### Added

- **`omni.storage`.** A module instance can now write, not just read: one JSON file per instance, whole-file-in, whole-file-out, isolated so an instance can never reach another's data. Nothing before this let a module remember anything across calls at runtime.
- **Input faces.** A module declares a physical control (a button, for now) in a new `input.json`, and gets its own port (`5001+`) rendered entirely by OmniCore itself, a plain page with no theme involved, ever. A tap reaches the module through a new `onInput` export, the same way a display call reaches its existing one.
- **The `time` and `graphdata` block types.** `time` carries one instant plus a `kind` (`clock` ships now; `countdown`, `stopwatch`, `position` are reserved shape for later). `graphdata` carries a plain series of points, with no `kind` split, since bar/line/dot is purely a theme's rendering choice over the same data.

### Fixed

- Two instances of the same module created in the same batch (the setup wizard bundling several at once) could be handed the same input-face port. Port assignment within one batch now accounts for ports already claimed earlier in that same batch, not just what's already on disk.

## v1.3.0

OmniCore can now update itself.

### Added

- **Self-update.** Every six hours, OmniCore checks whether a newer release exists on the same major version line and, if the Docker socket is available, pulls and applies it automatically, recreating its own container with the new image using the same ports, same data, and same restart policy.
- **A one-command rollback.** The container being replaced isn't deleted; it's stopped and kept under a different name. If an update ever turns out bad, `docker start omnicore-previous` (then removing the broken one) undoes it without reaching for a backup.
- **Checking for an update never requires the socket, applying one does.** Someone who removed the `docker.sock` line from `docker-compose.yml` still gets told a new version exists in the logs; OmniCore just can't act on it for them, exactly as promised when that line was introduced.

### Security

- Applying an update launches a short-lived helper container (the official `docker:cli` image) with its own socket access, because a container cannot safely stop and replace itself from the inside; it would be killed partway through its own first step. The helper exists only to run three commands and removes itself immediately after.

## v1.2.0

Installed modules and themes can now update themselves.

### Added

- **`minOmniCore`.** A registry entry can now declare the oldest OmniCore it actually works on. Nothing gets a version number of its own: the commit already pinned in `ref` is the version, and pointing `ref` at a new commit is how an update ships. `minOmniCore` only answers the narrower question of what a given commit needs to run. Declaring too low a floor is the one way this can go wrong: it means an update that assumes a newer OmniCore reaches an install that can't actually support it.
- **OmniCore remembers what it installed.** Until now, whether something was "installed" was decided purely by a folder existing, with no record of which commit was actually inside it. A new local record fixes that, which is what makes "has the registry moved past what I have?" answerable for the first time.
- **Silent updates.** Every six hours (and once, thirty seconds after startup), OmniCore compares what's installed against the registry and quietly installs anything newer that its `minOmniCore` allows. Anything the running OmniCore doesn't meet the floor for is left alone rather than forced on, which is what `minOmniCore` is actually for.

### Changed

- Installing or updating a module or theme now checks `minOmniCore` first and refuses outright if this OmniCore is too old, rather than installing something that might not work.

## v1.1.0

Installing OmniCore no longer means building it yourself.

> **Still no auto-update.** This release lays the groundwork for it (published images, a version each install can actually report), but OmniCore does not yet update itself or check whether it is out of date. That lands next. What changes today is that a future update will have somewhere to arrive from.

### Added

- **Published images.** Every tagged release is now built and pushed to GitHub's container registry automatically, for both 64-bit PCs and ARM boards like the Raspberry Pi. Installing is now a download rather than a build, which takes the slowest and most failure-prone step out of a first-time setup entirely.
- **A version each install knows about itself.** The release tag is baked into the image at build time and readable at runtime. Until now a running OmniCore had no idea which version it was; it could only read what the source _claimed_, which says nothing about what was actually built. Answering "am I out of date?" is impossible without this, so it comes first.
- **A separate development setup.** `docker-compose.dev.yml` builds from local source with its own storage, so working on OmniCore can't disturb a real install running on the same machine. Local builds report their version as `dev` rather than impersonating a release.

### Changed

- **The default install pulls instead of builds.** `docker-compose.yml` now fetches a published image, pinned to the major version line: bug fixes and new features arrive on their own, but a version 2 (which by definition may break existing dashboards) never arrives without someone deciding it should. Pin an exact version instead if you would rather nothing move at all.
- **The default install can update itself.** The compose file grants OmniCore access to Docker's control socket, which is what allows a container to replace its own image. Removing that single line leaves OmniCore fully working; it simply reports available updates instead of applying them, and you update by hand.

### Security

- Granting Docker socket access is effectively granting root on the host machine. That is a real cost, taken deliberately: OmniCore is heading toward shipping as its own system image, where this level of control is the norm rather than an exception. Anyone uncomfortable with that tradeoff can delete one line and lose nothing but the automatic part of updating.

## v1.0.0

First release meant for actual use, not just active development.

> **Early software.** The architecture is settled enough to build on, not enough to promise it won't change. There is no auto-update path yet: a future breaking change means reinstalling by hand, not a silent upgrade. If that's a dealbreaker for your use case, wait for a later release; if you're fine with that tradeoff, this is genuinely usable today.

### Added

- **User-orderable content.** A new `priority` settings field type lets someone reorder what a module shows, instead of the module author deciding once for everyone. Modules with distinct fields (weather, disk space, system stats) use it directly; modules that emit a list of like rows (calendar, Docker, notifications) scale row count with richness instead, since there's nothing to reorder.
- **The Marketplace.** Browse, search, and install modules and themes from a reviewed registry, right from the admin face. Installs download one pinned commit, never a branch, so reviewed-safe code can't change under anyone after the fact. Multiple registry sources are supported, with a deliberately serious warning before adding a third-party one.
- **Detail pages and author pages.** Each module and theme gets its own page (full description, what it emits, source, screenshots; schema built, empty for now) fetched from the module's own manifest at the exact pinned commit, escaped throughout. Author pages group everything one person has published.
- **The `omni` module API.** Modules no longer `require()` into `core/`. Everything they may use (network fetching, the richness helpers) arrives as one object handed to them. This is what makes future sandboxing possible without rewriting every module.
- OmniCore now ships bare. The 8 original modules and the `windows8` theme moved to their own repo, installed like anything else through the Marketplace.
- **Docker packaging.** `docker compose up` is now a real install path for someone with no programming background: Docker Desktop, one command, done. The README leads with this instead of source-build instructions.

### Fixed

- A block that paired a name with a value (`{ type: "pair", label, value }`) could have its label silently folded into the value string by a module trying to match one theme's look. Labels and values are now always sent separately; a theme decides what to do with each.
- A downloaded archive's extraction only checked that an entry's _path_ stayed inside the install folder, missing that a symlink can have a perfectly safe path while pointing somewhere else on the machine entirely. Found by deliberately building a malicious archive and attacking the installer with it. Fixed: only plain files and directories survive extraction.
- Moving a staged download into its final folder with `fs.rename()` failed with `EXDEV` whenever the OS temp directory and the project lived on different filesystems, true in some real environments though not the one this was built in. Falls back to copy-then-delete.
- The image proxy's `remember`/`lookup` functions silently took two positional arguments where the code calling them assumed one opaque key, caught by testing the marketplace screenshot proxy end to end rather than trusting the function's own comment.

### Security

- Every field fetched from an unreviewed `module.json`/`theme.json` is escaped before it can reach HTML, verified by rendering a real page with a deliberately malicious payload (a live `<script>` tag) and confirming it never executes.
- Screenshot images are proxied through OmniCore's own server rather than loaded directly, so viewing the Marketplace never leaks a visitor's IP to a third party the way a bare `<img src>` would.
- A screenshot's "shown in this theme" field is a bare theme id, built into a link server-side, never a URL an unreviewed author controls.
