# Omnia-OmniCore

The engine behind **Omnia**, a privacy-first smart home dashboard that runs
entirely on hardware you own.

OmniCore serves one or more dashboards, each on its own port, and assembles
the data they display. Nothing leaves your network except the calls you
explicitly configure.

> **Status: early development.** The architecture is settled but nothing is
> stable yet. Data formats have changed without migration paths and may do
> so again.

## What it does

OmniCore keeps three things apart so none of them has to know about the
others:

- **Modules** fetch data. They have no opinion about how it looks.
- **Themes** decide how it looks. They never run on your server.
- **Faces** are the dashboards themselves — a port, a theme, and the
  modules on it.

Because they're genuinely separate, any theme can display any module
without knowing what that module does. Both are installed by dropping a
folder in place; OmniCore finds them on its own.

Modules and themes are distributed separately from this repository, and how
to write one is covered in its own document. This repository is OmniCore.

## Faces

A face is a dashboard served on its own port. That port _is_ its ID. Each
face has four attributes: its `id`, a `name`, the `theme` rendering it, and
the module `instances` on it.

An instance is one use of a module. The same module can appear several
times with different settings — two weather tiles for two cities — so
settings belong to the instance rather than the module.

Port numbers carry meaning:

| Range   | Purpose                                                               |
| ------- | --------------------------------------------------------------------- |
| `3xxx`  | Admin faces. OmniCore's own interface. No third-party code runs here. |
| `4000`  | The control face. Where faces are created and discovered.             |
| `4001+` | Dashboard faces, assigned automatically.                              |

Faces update live. Changing a face's name, theme, or modules takes effect
without restarting anything, and any display showing that face reloads
itself — so a screen with nobody in front of it stays current.

## Running it

Requires Node 20 or newer.

```bash
git clone https://github.com/tanzim2000/Omnia-OmniCore
cd Omnia-OmniCore
npm install
node index.js
```

Then:

1. Open **port 4000** and follow the setup wizard to create your first
   face — name it, pick a theme, add modules, configure each one, finish.
2. Open **port 3000** to create your admin account. From there you can edit
   faces and their modules directly.

The wizard is for setting a face up. The admin face is for changing one
thing afterwards.

A container image is planned as the primary way to run this, with a
dedicated OS image later on.

## Layout

```
core/       OmniCore itself — faces, routing, admin, settings
modules/    installed modules
themes/     installed themes
data/       your faces, settings and admin account
index.js    entry point
```

Everything under `data/` is specific to your install and is deliberately
not tracked by git.

## The wider project

OmniCore is one of three parts:

- **OmniCore** — this repository. Serves faces and their data.
- **OmniView** — the display client, for putting a face on a screen.
- **OmniSync** — planned.

OmniView uses the control face on port 4000 to discover which faces exist
and choose between them.

## Not yet built

- Tiles don't remember their size between reloads
- No password reset — delete `data/admin.json` to start over
- Everything is HTTP; run it behind a VPN or reverse proxy, not on an
  untrusted network
- No container image yet

## Licence

MIT.
