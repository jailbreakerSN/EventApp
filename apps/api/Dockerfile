# Base images are pinned to their manifest-list digests (not just tags) so
# builds are reproducible and protected against upstream tag reassignments.
# To refresh: `docker manifest inspect node:20-alpine | jq -r '.manifests[0].digest'`
# or check https://hub.docker.com/_/node and update the digest below.

# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS builder

ARG BUILD_DATE
ARG GIT_SHA

LABEL org.opencontainers.image.title="Teranga API"
LABEL org.opencontainers.image.description="Teranga Event Platform REST API"
LABEL org.opencontainers.image.source="https://github.com/jailbreakersn/eventapp"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"

# Skip husky install (git hooks are only for local dev, not containers)
ENV HUSKY=0

WORKDIR /app

# Copy workspace root manifests
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/

# Remove the 'prepare' script which invokes husky (dev-only git hooks tool)
RUN npm pkg delete scripts.prepare

RUN npm ci --workspace=packages/shared-types --workspace=apps/api

# Copy source
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api

# Build shared types first, then API
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/api

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HUSKY=0

# Only production dependencies
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/

# Remove the 'prepare' script which invokes husky
RUN npm pkg delete scripts.prepare

RUN npm ci --workspace=packages/shared-types --workspace=apps/api --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3000

# Health check for Cloud Run and container orchestrators
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

# Use non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S teranga -u 1001
USER teranga

CMD ["node", "apps/api/dist/index.js"]
