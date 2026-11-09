# Zorofin companion. No npm dependencies; the image carries only the source.
# Multi-arch (linux/amd64, linux/arm64): see tools/publish-image.sh and
# .github/workflows/companion-image.yml.
FROM node:22-alpine

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Zorofin companion" \
      org.opencontainers.image.description="Optional companion service for Zorofin servers (talks to the Zorofin Jellyfin plugin)." \
      org.opencontainers.image.source="https://github.com/Zoraz01/zorofin-companion" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app
COPY package.json ./
COPY src ./src
# Zorofin web files served by the webUi module (Zorofin web player, ...).
COPY web-ui ./web-ui
# --max-semi-space-size=2 keeps V8's young generation small. It cuts the
# companion's resident memory by ~40 MB while a large TV guide refreshes, for
# ~15% more CPU during that refresh. Override NODE_OPTIONS to change it.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-semi-space-size=2 \
    ZOROFIN_COMPANION_BIND=0.0.0.0 \
    ZOROFIN_COMPANION_PORT=9310 \
    ZOROFIN_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 9310
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:9310/health >/dev/null || exit 1
CMD ["node", "src/main.js"]
