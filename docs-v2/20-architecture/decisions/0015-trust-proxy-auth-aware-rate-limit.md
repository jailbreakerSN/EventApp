# ADR-0015: Trust proxy + composite-key rate limiting

**Status:** Accepted
**Date:** 2026-04 (initial); 2026-04 (revision: composite-key budgets shipped)
**Deciders:** Platform team

---

## Context

The Fastify API runs behind Cloud Run's load balancer (which is itself behind GCP's edge proxies). Two independent decisions have to be made:

1. **Whose IP do we record?** With default Fastify settings, `request.ip` returns the immediate caller — the Cloud Run load balancer's internal IP, identical for every request. Useless for rate limiting, abuse tracking, and audit logs.
2. **How do we key rate limits?** Per-IP rate limiting alone breaks: (a) participants behind a corporate NAT all share an IP, (b) authenticated users with 5G data switch IPs constantly. We need at least token-aware keying so authenticated users keep their own bucket when their IP rotates.

Standard rate-limit failure modes:

- Per-IP only → office NAT triggers limits for innocent users.
- Same limit for everyone (no token awareness) → integrators with API keys are throttled into uselessness alongside web users.

---

## Decision

**The API runs with `trustProxy: true` so `request.ip` returns the real client IP from `X-Forwarded-For`. Rate limits use a single global Fastify rate-limit instance with a composite key generator + per-key-space budget callback that resolves to one of three buckets per request.**

### Trust proxy

```typescript
const fastify = Fastify({
  // X-Forwarded-For header is honored. Without this, a caller could
  // inject a forged X-Forwarded-For to cycle rate-limit buckets.
  // Cloud Run's LB overwrites the header so spoofing is not a concern.
  trustProxy: true,
});
```

### Composite key rate limit

```typescript
// apps/api/src/middlewares/rate-limit.middleware.ts
export function rateLimitKeyFor(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.startsWith("terk_")) {
      const parsed = parseApiKey(token);          // checksum-validates first
      if (parsed) return `apikey:${parsed.hashPrefix}`;
    } else {
      const sub = decodeJwtSubject(token);        // payload only, no signature verify
      if (sub) return `user:${sub}`;
    }
  }
  return `ip:${req.ip}`;
}

export function rateLimitMaxFor(req: FastifyRequest): number {
  const { space } = resolveRateLimitKey(req);
  switch (space) {
    case "apikey": return config.RATE_LIMIT_APIKEY_MAX;  // 600/min
    case "user":   return config.RATE_LIMIT_USER_MAX;    // 120/min
    case "ip":     return config.RATE_LIMIT_IP_MAX;      //  30/min
  }
}

// apps/api/src/app.ts
await app.register(rateLimit, {
  max: rateLimitMaxFor,
  timeWindow: config.RATE_LIMIT_WINDOW_MS,
  keyGenerator: rateLimitKeyFor,
});
```

| Key space | Limit (per minute) | Rationale |
|---|---|---|
| `apikey:*` | **600** | Integrators legitimately make hundreds of calls/min; tighter would throttle them into uselessness. Per-org tightening via plan tier is a planned follow-up. |
| `user:*` | **120** | Authenticated humans use the web/mobile app; absorbs SSR + client-side bursts. |
| `ip:*` | **30** | Unauthenticated routes (login, signup, public listings). Tight to slow distributed brute-force. |

### Sensitive-route overrides

Endpoints with abuse potential or unusual call patterns get **stricter (or looser) per-route limits via Fastify's `config.rateLimit`**, applied on top of the global key:

| Route | Limit | Rationale |
|---|---|---|
| `POST /v1/auth/send-verification-email` | 5 / 1 min | Anti-bot loop on resend-verification (would pummel Resend + the user). |
| `POST /v1/auth/send-password-reset-email` | 3 / 5 min | Aggressive anti-enumeration; password-reset abuse off the deliverability dashboard. |
| `POST /v1/registrations/checkin` | 200 / 1 min | Staff scanners legitimately burst at ~3 scans/sec at busy entrances. The QR is signed and the staff is permission-gated; this is back-pressure, not anti-abuse. |

(Sign-in and sign-up are handled client-side via Firebase Auth SDK — no first-party API endpoint to rate-limit at the server. Brute-force resistance on those flows lives in Firebase Auth's own throttling.)

### How the JWT decoding stays safe

The rate-limit key generator runs in `onRequest` — BEFORE auth verifies the token signature. To avoid paying signature-verification cost on every request, we decode the JWT payload and read `sub`:

- A forged token lands in `user:<their-forged-uid>` — i.e. the attacker's own bucket. They cannot evade rate-limiting by impersonating a different bucket.
- Real authentication still fires at preHandler time. A forged token is rejected at 401 — the bucket counter has already been decremented for that request, which is the desired behaviour (failed-auth attempts should count toward the bucket).
- `parseApiKey` does verify the format checksum (rejects typos before any Firestore read), so a malformed `terk_*` token falls back to `ip:<req.ip>` rather than synthesising a fake apikey bucket.

---

## Reasons

- **`trustProxy: true` recovers the real IP.** Without it, every `request.ip` is the LB's internal IP — rate limiting is broken, audit logs are useless, abuse detection cannot work.
- **No spoofing risk** because Cloud Run's load balancer overwrites `X-Forwarded-For`. The proxy chain is fixed and trusted.
- **Composite key fairness.** A logged-in participant on shared corporate WiFi keeps their own quota. An anonymous abuser still hits the IP limit. An integrator on `terk_*` gets 5× the throughput of a web user, matching their legitimate workload.
- **Brute-force resistance.** Per-route overrides on auth + scan routes survive even if the global key would let someone through (e.g., they have a stale session token that decodes to a `sub`).
- **Plain-text bucket keys are fine** because `@fastify/rate-limit` keeps them in-process; they don't reach external observability surfaces. API-key `hashPrefix` is already non-secret (it IS the doc id). The `hashRateLimitKey` helper is exported so a future Redis backend can hash transparently.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Default Fastify (`trustProxy: false`) | All requests appear to come from the same IP; rate limiting is moot. |
| `trustProxy: true` with no auth-aware key | Office NATs trigger limits for innocent users. |
| Single uniform `max` for every key space | Throttles integrators (`terk_*`) into uselessness OR over-grants budget to the unauthenticated public surface. The 3-tier split is the right shape. |
| Verify the JWT signature in the key generator | Doubles the per-request cost (RSA verify on every request, not just the ones reaching protected routes). The "forged-uid lands in own bucket" argument makes verification unnecessary for bucketing. |
| Three separate `@fastify/rate-limit` registrations | Possible but operationally noisy (3 plugins, 3 configs, 3 stores). The `max` callback achieves the same 3-tier split with one registration. |
| External rate limiter (Cloudflare, GCP Armor) | Useful at the edge layer; doesn't replace per-route logic in the API. Re-evaluate when traffic justifies edge-layer ACLs. |

---

## Conventions

- **`trustProxy: true` is set at app construction**, not via env var. Cloud Run is the only deploy target — no risk of accidentally trusting a hostile proxy.
- **Rate-limit responses return 429** with the standard `@fastify/rate-limit` `x-ratelimit-*` and `retry-after` headers.
- **Bucket keys use a `<space>:<id>` namespace** (e.g. `user:alice-001`, `ip:198.51.100.7`). Prefix isolation guarantees a user uid that happens to look like an IP doesn't collide with the IP bucket.
- **Limits are tunable via env**: `RATE_LIMIT_APIKEY_MAX`, `RATE_LIMIT_USER_MAX`, `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_WINDOW_MS`. Legacy `RATE_LIMIT_MAX` is retained for back-compat with existing deploy scripts but is no longer the canonical knob.
- **Per-route stricter overrides** are explicit on each route via `config.rateLimit`. Centralising them in a registry was considered but rejected — the per-route literal is greppable from the route file, and readers don't have to chase a separate file to understand the cap.

---

## Consequences

**Positive**

- Real IPs in audit logs and abuse detection.
- Office NAT users are not collectively throttled (each authenticated session has its own bucket).
- Token plaintext never leaks into bucket store / observability surfaces (we use `hashPrefix` for API keys + decoded `sub` for ID tokens — neither is plaintext).
- Integrators get the throughput they paid for; web users absorb SSR bursts; unauthenticated public surfaces stay tight against brute-force.
- Tier-specific limits are a single env-var edit per environment; no code change needed to widen `apikey:*` for an enterprise integrator.

**Negative**

- In-memory rate-limit buckets do not coordinate across Cloud Run instances. A user spinning across instances effectively gets `N × limit`. Acceptable for now (Cloud Run scales modestly during normal traffic). Mitigation planned: Memorystore Redis backend.
- Per-key API limits are uniform across paid plans today (no per-org tightening). Plan-tier-aware limits are a planned follow-up.
- Trust-proxy assumes the deploy target is always behind exactly one trusted proxy. A future move off Cloud Run to a different topology requires re-evaluating this setting.
- JWT payload decode (no verify) in the key generator means a forged token still consumes a bucket slot — that's intentional (we want failed-auth attempts to count toward the bucket) but it does mean the bucket cardinality scales with attacker creativity. Mitigation: window-based eviction is automatic; Redis backend would bound memory globally.

**Follow-ups**

- Memorystore Redis backend for cross-instance bucket coordination (planned, Wave 9-10).
- Plan-tier-aware API key limits (planned, Wave 8) — would override `RATE_LIMIT_APIKEY_MAX` per-org via the plan catalog rather than the env var.
- GCP Armor / Cloudflare edge rate limiting for DDoS resilience (post-launch).

---

## References

- `apps/api/src/app.ts` — `trustProxy: true` + composite-key `rateLimit` registration.
- `apps/api/src/middlewares/rate-limit.middleware.ts` — composite key + budget resolver.
- `apps/api/src/middlewares/__tests__/rate-limit.middleware.test.ts` — 18 unit tests covering every key-space branch + the prefix-isolation invariant.
- `apps/api/src/config/index.ts` — `RATE_LIMIT_APIKEY_MAX` / `RATE_LIMIT_USER_MAX` / `RATE_LIMIT_IP_MAX` / `RATE_LIMIT_WINDOW_MS` env knobs.
- `apps/api/src/middlewares/auth.middleware.ts` — populates `request.user` (read by downstream middleware; the rate-limit generator runs earlier and decodes the token directly).
- `apps/api/src/services/api-keys.service.ts` — `parseApiKey()` checksum gate consumed by the generator.
- `apps/api/src/routes/auth-email.routes.ts`, `apps/api/src/routes/registrations.routes.ts` — per-route override examples.
- CLAUDE.md → "Security Hardening Checklist" → "Trust proxy" + "Auth middleware safety" + "Composite-key rate limit".
