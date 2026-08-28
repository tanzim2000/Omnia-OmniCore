# Omnia-OmniCore

A privacy-first smart home dashboard you run yourself, on your own
hardware. Nothing about it talks to the internet except the things you
choose to install.

## Setting it up (no coding needed)

**1. Install Docker Desktop.**

This is a free program that runs OmniCore for you in its own safe little
box, so you don't have to install anything else on your computer.
Download it from [docker.com](https://www.docker.com/products/docker-desktop/)
and install it the way you'd install any other program.

**2. Download OmniCore.**

Go to the
[v1.0.0 release page](https://github.com/tanzim2000/Omnia-OmniCore/releases/tag/v1.0.0)
and download **Source code (zip)** near the bottom. Unzip it somewhere
you'll remember, like your Desktop.

(Not the green **Code** button near the top of this page — that always
gives you whatever's newest, which may not match these instructions.
The release page is the version this guide was written for.)

**3. Open a command window inside that folder.**

- **Windows:** open the unzipped folder, hold **Shift**, right-click
  inside it, and choose **Open PowerShell window here**.
- **Mac:** open the unzipped folder in Finder, right-click it, and choose
  **New Terminal at Folder**. (If you don't see that option, open the
  Terminal app and type `cd ` followed by dragging the folder in, then
  press Enter.)

**4. Type this one line and press Enter:**

```
docker compose up -d
```

The first time, this takes a few minutes — it's downloading and setting
everything up. You'll see a lot of text scroll by; that's normal.

**5. Open your web browser and go to:**

```
http://localhost:3000
```

Create your account, then click **Marketplace** to install a theme and
some modules — weather, a calendar, whatever you want on your dashboard.

**6. Go to:**

```
http://localhost:4000
```

This is where you build your actual dashboard: give it a name, pick the
theme and modules you just installed, and finish. That's it — your
dashboard is live.

### Turning it off, or starting it again

From that same command window (or open a new one the same way and
navigate back to the folder):

```
docker compose down
```

turns it off. To start it again later:

```
docker compose up -d
```

Everything you've set up is saved — your account, your dashboards,
whatever you installed — even when it's off.

### A limit worth knowing

Ten dashboards can run at once out of the box. If you ever need an
eleventh, that needs one small edit to a file by someone comfortable
opening `docker-compose.yml` in a text editor — not something you'll run
into unless you're building something unusually large.

---

## What it actually does

OmniCore keeps three things apart so none of them has to know about the
others:

- **Modules** fetch data — weather, a calendar, whatever. They have no
  opinion about how it looks.
- **Themes** decide how it looks. They never run on your server.
- **Faces** are the dashboards themselves.

Because they're genuinely separate, any theme can display any module.
Everything beyond the basics — new modules, new themes — comes from the
**Marketplace**, built into the account page you created in step 5. Each
one is reviewed before it's listed, so you're not installing random code
off the internet.

## For anyone comfortable with code

If you'd rather run this from source instead of Docker — to modify it, to
build your own modules or themes, or just because you prefer it —
`docs/Architecture.md` is the real reference, and `docs/Building
modules.md` / `docs/Building theme.md` cover writing your own.

```bash
git clone <this repo>
cd Omnia-OmniCore
npm install
node start.OmniCore
```

Requires Node 20 or newer. Same two pages afterward: port 3000 for the
account and Marketplace, port 4000 for the setup wizard.

## Known limitations

- Ten dashboards at once via the Docker setup above; unlimited from source
- No password reset — delete your account data to start over
- Runs on plain HTTP; if you ever expose this beyond your own network, put
  it behind a VPN or reverse proxy first
- Modules are reviewed before listing but not sandboxed — see
  `docs/Architecture.md` §9

See `BACKLOG.md` for the fuller picture, including what a proper
double-click installer would take beyond this.

## The wider project

OmniCore is one of three parts:

- **OmniCore** — this repository. Serves faces and their data.
- **OmniView** — the display client, for putting a face on a screen.
- **OmniSync** — planned.

## Licence

MIT.
