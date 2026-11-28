FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS manifests
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY apps/ apps/

FROM build AS web-build
ENV CIBO_STATIC_EXPORT=true NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @cibo/web

FROM build AS api-build
RUN npm run build -w @cibo/api

FROM manifests AS api
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY apps/api/extraction/requirements.txt apps/api/extraction/extract.py apps/api/extraction/ebook.py apps/api/extraction/thumbnail.py apps/api/extraction/
RUN python3 -m venv apps/api/extraction/.venv && apps/api/extraction/.venv/bin/pip install --no-cache-dir -r apps/api/extraction/requirements.txt
ENV NODE_ENV=production
RUN npm ci --workspace @cibo/api --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
USER node
CMD ["node","apps/api/dist/index.js"]

FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 AS web
COPY --from=web-build /app/apps/web/out /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
