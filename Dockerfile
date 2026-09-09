# OmniCore, packaged so nobody running it needs Node, npm, or a terminal
# beyond one docker compose command.
FROM node:20-alpine

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

# Dependencies first, so a rebuild after only changing core/ doesn't
# reinstall express and tar every time
COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY core/ ./core/
COPY start.OmniCore ./

# modules/ and themes/ ship empty and are filled by the Marketplace once
# running — but the folders themselves have to exist before an install can
# write into them, so they're created here rather than left to chance
RUN mkdir -p modules themes data

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