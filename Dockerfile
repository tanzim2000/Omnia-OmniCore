# OmniCore, packaged so nobody running it needs Node, npm, or a terminal
# beyond one docker compose command.
FROM node:20-alpine

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

EXPOSE 3000 4000

CMD ["node", "start.OmniCore"]