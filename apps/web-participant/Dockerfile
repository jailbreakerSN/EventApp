# ─── Dependencies ───────────────────────────────────────────────────────────
# Install only the workspaces needed to build the participant app.
FROM node:22-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3 AS deps
WORKDIR /app

# Copy workspace manifests (better layer caching — reinstalls only on lock changes)
COPY package.json package-lock.json turbo.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY apps/web-participant/package.json ./apps/web-participant/

# Strip husky prepare script (git hooks are for local dev only)
RUN npm pkg delete scripts.prepare

RUN npm ci \
  --workspace=packages/shared-types \
  --workspace=packages/shared-ui \
  --workspace=apps/web-participant

# ─── Builder ────────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3 AS builder
WORKDIR /app

# Firebase Web SDK config is baked in at build time (NEXT_PUBLIC_*).
# All values are public — visible in every client bundle on inspect.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
# Public VAPID key for Web Push. Generated once per environment in the
# Firebase Console (Project Settings → Cloud Messaging → Web Push
# certificates → Generate key pair), then provisioned via the
# `notification-ops-prereqs.yml` workflow and passed here at build time.
# Safe to embed in the client bundle — the *private* VAPID key never
# leaves Firebase's infrastructure; only the public half signs JS-side
# push subscriptions. When this ARG is unset, the Web Push registration
# hook degrades to `permission: "unsupported"` at runtime — the app
# still works, just without background push.
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BACKOFFICE_URL

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_VAPID_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_BACKOFFICE_URL=$NEXT_PUBLIC_BACKOFFICE_URL
ENV NEXT_PUBLIC_USE_EMULATORS=false
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json turbo.json ./
COPY packages ./packages
COPY apps/web-participant ./apps/web-participant

# shared-ui is source-only (consumed via Next.js transpilePackages) — no build step
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/web-participant

# ─── Runner ─────────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Next.js standalone produces a self-contained server bundle.
# Monorepo: apps/web-participant/.next/standalone contains server.js + minimal deps.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-participant/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-participant/.next/static ./apps/web-participant/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web-participant/public ./apps/web-participant/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web-participant/server.js"]
