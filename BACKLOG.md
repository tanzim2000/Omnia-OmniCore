# Backlog

Where OmniCore stands at v1, and what's genuinely left. Written as a
resting point — everything here was deliberately deferred, not forgotten
or missed under time pressure. If you're picking this back up after a
break, this document plus `docs/Architecture.md` should be enough to
re-orient without reconstructing anything from memory.

## What v1 actually is

Verified end to end, for real, not simulated: a completely fresh clone —
`npm install`, no modules, no themes — boots cleanly, the Marketplace shows
real content from the live registry, installing a module and a theme
through it actually works, and a face built from those installs serves a
real dashboard tile.

- The three-way split (modules / themes / faces) and the settings system,
  including `priority` fields for user-orderable content
- All 8 built-in modules and the `windows8` theme, published through the
  Marketplace rather than bundled
- The Marketplace itself: browse, tabbed search, one-click install,
  multiple registry sources with a deliberately alarming warning before
  adding a third-party one, detail pages, author pages
- The module API split (`omni.fetch`/`visible`/`share`) — modules never
  `require()` into `core/`, which is what makes future sandboxing possible
  without a rewrite
- Two real security bugs found by attacking the installer during
  development rather than after: a symlink that could escape the install
  sandbox despite a safe-looking path, and images displaying without a
  proxy (fixed — see `docs/Architecture.md` §13 for both)
- Docs (`Architecture.md`, `Building modules.md`, `Building theme.md`) are
  current with the code as of this release
- Docker packaging — `docker compose up` is now a real install path for
  someone with zero programming knowledge, not just source + npm

## Deliberately deferred, with why

**Sandboxing modules.** Modules are reviewed before listing, then trusted
like any dependency you'd install — full Node access, nothing stops a
module reading `data/admin.json` if it wanted to. The `omni` API split
exists specifically so this can be added later by handing a restricted
module a smaller `omni` object, without changing how any well-behaved
module works. Not started.

**A real native installer** — a `.exe` with an install wizard on
Windows, a signed `.app` on Mac. Docker Compose (v1's actual answer to
"zero programming knowledge") still needs one command typed into one
terminal window. A true installer removes even that, but needs code
signing, per-OS packaging, and a way to show the person it's running (a
system tray icon, at minimum) — a separate, real project, not an
extension of the Docker work.

**Sideloading** — installing a module from a local folder or a URL outside
the registry flow entirely. Mentioned early as a paid/future feature,
never designed.

**`system-patch`** — a third resource kind beyond modules and themes, for
things that change OmniCore's own behavior rather than adding a tile (the
example floated: a voice-assistant character). Explicitly "long way to
future" — no schema, no design, nothing built. Don't infer anything about
its shape from what exists today.

**Richer author profiles.** The author page is a live filter over
`registry.json`'s `author` field — exact string match, nothing more. No
bio, no avatar, no verified identity. Good enough to answer "what else has
this person published," not good enough to answer "is this really them."

**Screenshots.** The field exists end to end — `module.json`/`theme.json`
schema, fetched at the pinned commit, proxied through OmniCore so a
display never talks to a third party directly, escaped and tested against
deliberately malicious input. Every screenshots array is empty. The
mechanism is done; no actual screenshots have been taken or written.

**Update flow has no UI.** `installFromEntry`/`installEntry` already
accept an `update` flag that replaces an existing install — the backend
work is done — but nothing in the admin face sends it. Right now, updating
an installed module means deleting its folder and reinstalling, or calling
the API directly. Worth an "Update" button next to "Installed" on a
detail page whenever this gets picked back up.

**No uninstall UI at all.** Not update-only — there is currently no way to
remove an installed module or theme from the admin face. `rm -rf
modules/<id>` works, but that's a terminal operation, not a feature.

**GitHub API rate limiting.** Currently sidestepped by using
`codeload.github.com`/`raw.githubusercontent.com` rather than
`api.github.com`, which aren't subject to the same 60/hour anonymous
limit. If that ever changes or a heavier registry workflow needs the real
API, a personal access token in settings is a five-minute fix — discussed,
not built, because nothing needs it yet.

**Multi-source collision behavior is untested.** If two registry sources
both list an entry with the same `id`, the built-in registry's copy wins
(it's concatenated first, and lookups use the first match) — but this was
never deliberately tested, only reasoned about. Worth a real test before
it matters.

## Known rough edges

- **No automated test suite.** Everything in this codebase was verified by
  hand during development — real network calls, real servers started and
  torn down, deliberately malicious input tried against real code. None
  of that is captured as a repeatable test anyone can just run.
  `package.json`'s `test` script is still the default placeholder.
- **No CI.** Nothing runs those manual checks automatically on a change.
- Tiles don't remember their size between reloads
- No password reset flow — delete `data/admin.json` to start over
- Runs on plain HTTP; needs a VPN or reverse proxy on anything but a
  trusted network
- Marketplace UI is tidier than it was, not fully designed — cards and
  tabs over the original stacked rows, but no deep visual pass
- `OmniView` (the display client) and `OmniSync` are both still just
  named, not built

## If you only do one thing next

Probably the Update UI — it's the smallest gap between "the mechanism
exists" and "a person can actually use it," and it's the one most likely
to bite you personally the next time one of your own modules changes.
