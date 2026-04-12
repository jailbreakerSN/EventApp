# ─── Dependencies ───────────────────────────────────────────────────────────
# Install only the workspaces needed to build the backoffice app.
FROM node:22-alpine AS deps
WORKDIR /app

# Copy workspace manifests (better layer caching — reinstalls only on lock changes)
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY apps/web-backoffice/package.json ./apps/web-backoffice/

# Strip husky prepare script (git hooks are for local dev only)
RUN npm pkg delete scripts.prepare

RUN npm ci \
  --workspace=packages/shared-types \
  --workspace=packages/shared-ui \
  --workspace=apps/web-backoffice

# ─── Builder ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Firebase Web SDK config is baked in at build time (NEXT_PUBLIC_*).
# All values are public — visible in every client bundle on inspect.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
ARG NEXT_PUBLIC_API_URL

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=$NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json turbo.json ./
COPY packages ./packages
COPY apps/web-backoffice ./apps/web-backoffice

# shared-ui is source-only (consumed via Next.js transpilePackages) — no build step
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/web-backoffice

# ─── Runner ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Next.js standalone produces a self-contained server bundle.
# Monorepo: apps/web-backoffice/.next/standalone contains server.js + minimal deps.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-backoffice/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-backoffice/.next/static ./apps/web-backoffice/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-backoffice/public ./apps/web-backoffice/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web-backoffice/server.js"]
