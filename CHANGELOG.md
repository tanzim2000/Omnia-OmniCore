# Changelog

## v1.2.0

Installed modules and themes can now update themselves.

### Added

- **`minOmniCore`.** A registry entry can now declare the oldest
  OmniCore it actually works on. Nothing gets a version number of its
  own — the commit already pinned in `ref` is the version, and pointing
  `ref` at a new commit is how an update ships. `minOmniCore` only
  answers the narrower question of what a given commit needs to run.
  Declaring too low a floor is the one way this can go wrong: it means
  an update that assumes a newer OmniCore reaches an install that
  can't actually support it.
- **OmniCore remembers what it installed.** Until now, whether
  something was "installed" was decided purely by a folder existing —
  there was no record of which commit was actually inside it. A new
  local record fixes that, which is what makes "has the registry moved
  past what I have?" answerable for the first time.
- **Silent updates.** Every six hours (and once, thirty seconds after
  startup), OmniCore compares what's installed against the registry
  and quietly installs anything newer that its `minOmniCore` allows.
  Anything the running OmniCore doesn't meet the floor for is left
  alone rather than forced on — that's what `minOmniCore` is actually
  for.

### Changed

- Installing or updating a module or theme now checks `minOmniCore`
  first and refuses outright if this OmniCore is too old, rather than
  installing something that might not work.

## v1.1.0

Installing OmniCore no longer means building it yourself.

> **Still no auto-update.** This release lays the groundwork for it —
> published images, a version each install can actually report — but
> OmniCore does not yet update itself or check whether it is out of
> date. That lands next. What changes today is that a future update
> will have somewhere to arrive from.

### Added

- **Published images.** Every tagged release is now built and pushed to
  GitHub's container registry automatically, for both 64-bit PCs and
  ARM boards like the Raspberry Pi. Installing is now a download rather
  than a build, which takes the slowest and most failure-prone step out
  of a first-time setup entirely.
- **A version each install knows about itself.** The release tag is
  baked into the image at build time and readable at runtime. Until
  now a running OmniCore had no idea which version it was — it could
  only read what the source _claimed_, which says nothing about what
  was actually built. Answering "am I out of date?" is impossible
  without this, so it comes first.
- **A separate development setup.** `docker-compose.dev.yml` builds
  from local source with its own storage, so working on OmniCore can't
  disturb a real install running on the same machine. Local builds
  report their version as `dev` rather than impersonating a release.

### Changed

- **The default install pulls instead of builds.** `docker-compose.yml`
  now fetches a published image, pinned to the major version line: bug
  fixes and new features arrive on their own, but a version 2 — which
  by definition may break existing dashboards — never arrives without
  someone deciding it should. Pin an exact version instead if you would
  rather nothing move at all.
- **The default install can update itself.** The compose file grants
  OmniCore access to Docker's control socket, which is what allows a
  container to replace its own image. Removing that single line leaves
  OmniCore fully working; it simply reports available updates instead
  of applying them, and you update by hand.

### Security

- Granting Docker socket access is effectively granting root on the
  host machine. That is a real cost, taken deliberately: OmniCore is
  heading toward shipping as its own system image, where this level of
  control is the norm rather than an exception. Anyone uncomfortable
  with that tradeoff can delete one line and lose nothing but the
  automatic part of updating.

## v1.0.0

First release meant for actual use, not just active development.

> **Early software.** The architecture is settled enough to build on, not
> enough to promise it won't change. There is no auto-update path yet —
> a future breaking change means reinstalling by hand, not a silent
> upgrade. If that's a dealbreaker for your use case, wait for a later
> release; if you're fine with that tradeoff, this is genuinely usable
> today.

### Added

- **User-orderable content.** A new `priority` settings field type lets
  someone reorder what a module shows, instead of the module author
  deciding once for everyone. Modules with distinct fields (weather,
  disk space, system stats) use it directly; modules that emit a list of
  like rows (calendar, Docker, notifications) scale row count with
  richness instead, since there's nothing to reorder.
- **The Marketplace.** Browse, search, and install modules and themes
  from a reviewed registry, right from the admin face. Installs download
  one pinned commit — never a branch — so reviewed-safe code can't
  change under anyone after the fact. Multiple registry sources are
  supported, with a deliberately serious warning before adding a
  third-party one.
- **Detail pages and author pages.** Each module and theme gets its own
  page — full description, what it emits, source, screenshots (schema
  built, empty for now) — fetched from the module's own manifest at the
  exact pinned commit, escaped throughout. Author pages group everything
  one person has published.
- **The `omni` module API.** Modules no longer `require()` into `core/`.
  Everything they may use — network fetching, the richness helpers —
  arrives as one object handed to them. This is what makes future
  sandboxing possible without rewriting every module.
- OmniCore now ships bare. The 8 original modules and the `windows8`
  theme moved to their own repo, installed like anything else through
  the Marketplace.
- **Docker packaging.** `docker compose up` is now a real install path
  for someone with no programming background — Docker Desktop, one
  command, done. The README leads with this instead of source-build
  instructions.

### Fixed

- A block that paired a name with a value (`{ type: "pair", label,
value }`) could have its label silently folded into the value string
  by a module trying to match one theme's look. Labels and values are
  now always sent separately; a theme decides what to do with each.
- A downloaded archive's extraction only checked that an entry's _path_
  stayed inside the install folder — missing that a symlink can have a
  perfectly safe path while pointing somewhere else on the machine
  entirely. Found by deliberately building a malicious archive and
  attacking the installer with it. Fixed: only plain files and
  directories survive extraction.
- Moving a staged download into its final folder with `fs.rename()`
  failed with `EXDEV` whenever the OS temp directory and the project
  lived on different filesystems — true in some real environments, not
  in the one this was built in. Falls back to copy-then-delete.
- The image proxy's `remember`/`lookup` functions silently took two
  positional arguments where the code calling them assumed one opaque
  key — caught by testing the marketplace screenshot proxy end to end
  rather than trusting the function's own comment.

### Security

- Every field fetched from an unreviewed `module.json`/`theme.json` is
  escaped before it can reach HTML, verified by rendering a real page
  with a deliberately malicious payload (a live `<script>` tag) and
  confirming it never executes.
- Screenshot images are proxied through OmniCore's own server rather
  than loaded directly, so viewing the Marketplace never leaks a
  visitor's IP to a third party the way a bare `<img src>` would.
- A screenshot's "shown in this theme" field is a bare theme id, built
  into a link server-side — never a URL an unreviewed author controls.
