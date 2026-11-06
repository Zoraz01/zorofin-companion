# Zorofin companion. No npm dependencies; the image carries only the source.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
# Zorofin web files served by the webUi module (Zorofin web player, ...).
COPY web-ui ./web-ui
ENV NODE_ENV=production \
    ZOROFIN_COMPANION_BIND=0.0.0.0 \
    ZOROFIN_COMPANION_PORT=9310 \
    ZOROFIN_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 9310
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:9310/health >/dev/null || exit 1
CMD ["node", "src/main.js"]
