# Changelog

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
