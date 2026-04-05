# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace root manifests
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=packages/shared-types --workspace=apps/api

# Copy source
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api

# Build shared types first, then API
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/api

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only production dependencies
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=packages/shared-types --workspace=apps/api --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3000

# Use non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S teranga -u 1001
USER teranga

CMD ["node", "apps/api/dist/index.js"]
