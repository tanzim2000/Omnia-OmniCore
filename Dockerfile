# OmniCore, packaged so nobody running it needs Node, npm, or a terminal
# beyond one docker compose command.
#
# Built in two stages, so that nothing ever has to RUN under emulation:
#
#   dependencies   installs the libraries, on the machine doing the build
#                  (GitHub's x86 runners), whatever image is being built
#   final          the image itself: a Node base for the target machine
#                  (x86 or ARM) with those libraries and OmniCore's own
#                  files copied in. Only COPY steps, no RUN.
#
# Why that matters: the ARM image is built on an x86 machine. Any RUN step
# for it runs through QEMU, an emulator, and Node under QEMU can simply
# crash ("Illegal instruction"), which is exactly what failed the v1.19.1
# build. Copying files needs no emulation, so there's nothing to crash.
#
# Keep it that way: a RUN step added to the final stage brings emulation
# back, and the ARM build then needs QEMU set up in the publish workflow
# again.

# ---------------------------------------------------------------------
# Stage 1: the libraries
#
# $BUILDPLATFORM is the machine doing the build, so this stage always runs
# natively, never emulated.
FROM --platform=$BUILDPLATFORM node:24-alpine AS dependencies

WORKDIR /app

# `npm ci` rather than `npm install`: it installs exactly what
# package-lock.json says, and fails if the lock file and package.json
# disagree, instead of quietly settling on something else. The lock file
# is where security fixes to libraries live, so the image has to be built
# from it, not merely near it.
#
# --ignore-scripts: no library gets to run its own install step. Here that
# means nothing gets compiled: the only ones that try are optional speed-ups
# for SSH (which OmniCore doesn't use -- it talks to Docker over a local
# socket), and anything compiled here would be compiled for the build
# machine, wrong for an ARM image anyway. Every library OmniCore uses is
# plain JavaScript and works the same on any machine.
#
# The second line loads every dependency once. npm has a known fault
# where a dropped download ends the install early while still reporting
# success ("Exit handler never called"), which would publish an image that
# can't start. This makes that fail the build instead.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
	&& node -e "for (const name of Object.keys(require('./package.json').dependencies)) require(name)"

# modules/, themes/ and data/ ship empty and are filled once OmniCore is
# running -- but the folders have to exist before anything can write into
# them. Made here and copied across empty, since the final stage can't RUN.
RUN mkdir -p /folders/modules /folders/themes /folders/data

# ---------------------------------------------------------------------
# Stage 2: the network tools (since 2.0.0)
#
# Network Management (core/network-helper.js) reads and changes the HOST's
# Wi-Fi, using the standard Linux tools for it: wpa_supplicant's wpa_cli,
# NetworkManager's nmcli, iw, and later hostapd and dnsmasq for the setup
# hotspot. They have to be in the image itself, because they're needed
# exactly when the server has no internet to download anything.
#
# They live in a small Alpine of their own, /opt/omnicore-net, apart from
# OmniCore's own files: the helper container runs them with `chroot` into
# that folder. Installed here, on the build machine, for the TARGET
# machine's architecture: apk can unpack another architecture's packages
# without running anything from them (--no-scripts), so this needs no
# emulation either, and the final stage only copies the folder.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS network-tools

# Docker's name for the machine the image is for (amd64, arm64), turned
# into Alpine's (x86_64, aarch64)
ARG TARGETARCH

RUN set -e; \
	case "$TARGETARCH" in \
	amd64) arch=x86_64 ;; \
	arm64) arch=aarch64 ;; \
	*) echo "No network tools for $TARGETARCH"; exit 1 ;; \
	esac; \
	apk add --quiet --no-cache --root /net --arch "$arch" --initdb --no-scripts \
	--keys-dir "/usr/share/apk/keys/$arch" \
	--repositories-file /etc/apk/repositories \
	alpine-baselayout busybox wpa_supplicant iw networkmanager-cli; \
	# --no-scripts skipped busybox making its commands; the tools' own
	# scripts only need a shell
	ln -sf /bin/busybox /net/bin/sh; \
	# The package manager's own records aren't needed inside the image
	rm -rf /net/lib/apk /net/var/cache/apk /net/etc/apk; \
	# Where the helper mounts the host's own files, read-only
	mkdir -p /net/host

# ---------------------------------------------------------------------
# Stage 3: the image itself, for whichever machine it's built for
FROM node:24-alpine

# Which version this image is. The publish workflow passes the git tag in
# (e.g. "v1.1.0"); a plain local "docker build" gets "dev" instead, which is
# honest — a local build genuinely isn't a published release.
#
# OmniCore reads this at runtime to answer "am I out of date?" without
# guessing from package.json, which only says what the source claims.
ARG OMNICORE_VERSION=dev
ENV OMNICORE_VERSION=$OMNICORE_VERSION

# Standard OCI labels. These are what GitHub reads to link the published
# package back to this repo, and what tools like Watchtower read to
# identify an image.
LABEL org.opencontainers.image.title="Omnia OmniCore"
LABEL org.opencontainers.image.description="Modular, config-driven backend for the Omnia home dashboard ecosystem."
LABEL org.opencontainers.image.source="https://github.com/tanzim2000/Omnia-OmniCore"
LABEL org.opencontainers.image.version=$OMNICORE_VERSION

WORKDIR /app

# Libraries first, so a rebuild after only changing core/ reuses them
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /folders/ ./
COPY package.json package-lock.json ./

COPY core/ ./core/
COPY start.OmniCore ./

# The network tools, in their own folder (see Stage 2). Outside /app, so
# nothing of OmniCore's mixes with them.
COPY --from=network-tools /net /opt/omnicore-net

# What's in this build, for its Updates page. A release reads its notes
# from GitHub; a development build (a hand-run ":dev" image) reads them
# from here, along with what isn't released yet.
COPY CHANGELOG.md ./

# The licence and what goes with it: the AGPL asks that it travels with
# every copy, and the About page points to it
COPY LICENSE LICENSING.md TRADEMARKS.md ./

# 3000 admin, 3999 setup wizard, 4000 welcome face. Dashboard faces
# (4001+) and input faces (5001+) are published by docker-compose.yml,
# since how many exist depends on what's been configured.
EXPOSE 3000 3999 4000

# Docker's restart policy only fires when a process genuinely dies -- a
# hung-but-alive one never triggers it. This asks OmniCore whether it
# can still do its job, not just whether it's running.
#
# start-period is generous because a cold start brings up every
# configured face before this can pass, and a machine rebooting with a
# dozen faces is slower than a laptop with one.
#
# It's also the signal self-update watches to decide whether a new
# version came up correctly or needs rolling back -- see
# core/core-updater.js.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "start.OmniCore"]