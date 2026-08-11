# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

FROM ${NODE_IMAGE} AS dependencies

ENV CI=true \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/tmp/wrangler.log

WORKDIR /app
RUN chown node:node /app

USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node dashboard/package.json ./dashboard/package.json
RUN npm ci

FROM dependencies AS verification

COPY --chown=node:node . .

# A publishable image cannot be produced unless the source type-checks, all
# mocked tests pass, and Wrangler can create a valid Worker bundle.
RUN npm run check \
    && npm test \
    && npm run build \
    && rm -f wrangler.log /tmp/wrangler.log

FROM verification AS runtime

LABEL org.opencontainers.image.source="https://github.com/verseexplainer-dotcom/Meta-automation-suite" \
      org.opencontainers.image.title="MobDeals Meta Automation Suite" \
      org.opencontainers.image.description="Local and CI runtime for the MobDeals Cloudflare Worker"

ENV NODE_ENV=development

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["./node_modules/.bin/wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787"]
