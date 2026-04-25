# ADR-0015: Trust proxy + token-hashed rate limiting

**Status:** Accepted (current implementation); auth-aware composite keying is a tracked follow-up
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

The Fastify API runs behind Cloud Run's load balancer (which is itself behind GCP's edge proxies). Two independent decisions have to be made:

1. **Whose IP do we record?** With default Fastify settings, `request.ip` returns the immediate caller — the Cloud Run load balancer's internal IP, identical for every request. Useless for rate limiting, abuse tracking, and audit logs.
2. **How do we key rate limits?** Per-IP rate limiting alone breaks: (a) participants behind a corporate NAT all share an IP, (b) authenticated users with 5G data switch IPs constantly. We need at least token-aware keying so authenticated users keep their own bucket when their IP rotates.

Standard rate-limit failure modes:

- Per-IP only → office NAT triggers limits for innocent users.
- Same limit for everyone (no token awareness) → integrators with API keys can't distinguish their throttled bucket from an anonymous abuser sharing their NAT.

---

## Decision

**The API runs with `trustProxy: true` so `request.ip` returns the real client IP from `X-Forwarded-For`. Rate limits use a single global Fastify rate-limit instance keyed on the SHA-256 hash of the `Authorization` header when one is present, falling back to `request.ip` for unauthenticated requests.**

### Trust proxy

```typescript
const fastify = Fastify({
  // X-Forwarded-For header is honored. Without this, a caller could
  // inject a forged X-Forwarded-For to cycle rate-limit buckets.
  // Cloud Run's LB overwrites the header so spoofing is not a concern.
  trustProxy: true,
});
```

### Rate-limit keying (current)

```typescript
// apps/api/src/app.ts — single global rate-limit registration
await app.register(rateLimit, {
  max: config.RATE_LIMIT_MAX,           // default 100 req
  timeWindow: config.RATE_LIMIT_WINDOW_MS, // default 60_000 ms
  keyGenerator: (req) => {
    const token = req.headers.authorization;
    if (token?.startsWith("Bearer ")) {
      // Hash the token so JWT / API key plaintext never reaches logs
      // or the rate-limit bucket store.
      return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
    }
    return req.ip;
  },
});
```

This gives every distinct token its own bucket, and every distinct unauthenticated IP its own bucket — sufficient to keep authenticated users insulated from each other and from anonymous traffic, with a single uniform `RATE_LIMIT_MAX` per minute today.

### Planned composite keying (NOT yet shipped)

The richer key-space split below is a follow-up that this ADR will be amended for once shipped. It is captured here so future work has a documented target rather than designing in a vacuum:

| Key space (planned) | Limit (per minute, planned) | Rationale |
|---|---|---|
| `apikey:*` | 600 | Integrators need throughput; per-org tightening via plan tier. |
| `user:*` | 120 | Authenticated humans use the web/mobile app; absorbs SSR + client side. |
| `ip:*` | 30 | Unauthenticated routes (login, signup, public listing). Tight to slow brute-force. |

Per-route stricter overrides on auth + scan endpoints (`POST /v1/auth/login`, `signup`, `password-reset`, `checkin/scan`) are also planned. Today they share the global limit.

---

## Reasons

- **`trustProxy: true` recovers the real IP.** Without it, every `request.ip` is the LB's internal IP — rate limiting is broken, audit logs are useless, abuse detection cannot work.
- **No spoofing risk** because Cloud Run's load balancer overwrites `X-Forwarded-For`. The proxy chain is fixed and trusted.
- **Token-hashed keying gives authenticated users their own bucket.** A logged-in participant on shared corporate WiFi keeps their own quota — they're not sharing the IP bucket with everyone behind that NAT.
- **Hashing protects logs / metrics.** The full `Authorization` header (Firebase ID token or `terk_*` API key) never lands in the bucket store or in any observability surface — only the first 32 chars of its SHA-256.
- **Single instance, simple operation.** One rate-limit middleware to monitor, one bucket store, one set of failure modes. The composite-keying split adds value but also operational surface; we ship the simpler version first and revisit when traffic warrants it.

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Default Fastify (`trustProxy: false`) | All requests appear to come from the same IP; rate limiting is moot. |
| `trustProxy: true` with no token awareness | Office NATs trigger limits for innocent users on shared IPs. |
| Three-tier composite key with per-route overrides (the "planned" table above) | Worth shipping; deferred so the first cut is observable in production before we add tier-specific knobs. |
| External rate limiter (Cloudflare, GCP Armor) | Useful at the edge layer; doesn't replace per-route logic in the API. Re-evaluate when traffic justifies edge-layer ACLs. |
| Dynamic per-org limits on API keys | Planned (will cite this ADR), not yet shipped. Today, per-key limit is uniform. |

---

## Conventions

- **`trustProxy: true` is set at app construction**, not via env var. Cloud Run is the only deploy target — no risk of accidentally trusting a hostile proxy.
- **Rate-limit responses return 429** with the standard `@fastify/rate-limit` `x-ratelimit-*` and `retry-after` headers.
- **Rate-limit keys never include PII.** Hashed tokens / IP addresses only — no email or names in the bucket store. (Current store: in-memory; planned: Memorystore Redis for multi-instance correctness.)
- **Limits are tunable via env** — `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` (see `apps/api/src/config/index.ts`).

---

## Consequences

**Positive**

- Real IPs in audit logs and abuse detection.
- Office NAT users are not collectively throttled (each authenticated session has its own bucket).
- Token plaintext never leaks into bucket store / observability surfaces.
- Operationally simple: one rate-limit registration, one config knob.

**Negative**

- In-memory rate-limit buckets do not coordinate across Cloud Run instances. A user spinning across instances effectively gets `N × limit`. Acceptable for now (Cloud Run scales modestly during normal traffic). Mitigation planned: Memorystore Redis backend.
- Single global limit means integrators (`terk_*` API keys) and human users share the same quota today. The composite-keying split above is the planned mitigation.
- Auth routes (login, signup, password-reset) have no stricter override yet. Brute-force resistance relies on the global limit + Firebase Auth's own throttling. Per-route overrides are tracked as a follow-up.
- Trust-proxy assumes the deploy target is always behind exactly one trusted proxy. A future move off Cloud Run to a different topology requires re-evaluating this setting.

**Follow-ups**

- Composite key spaces (`apikey:` / `user:` / `ip:`) with distinct limits.
- Per-route stricter overrides on `/auth/*` + `/checkin/scan`, in a dedicated `apps/api/src/middlewares/rate-limit.middleware.ts`.
- Memorystore Redis backend for cross-instance bucket coordination (planned, Wave 9-10).
- Plan-tier-aware API key limits (planned, Wave 8).
- GCP Armor / Cloudflare edge rate limiting for DDoS resilience (post-launch).

---

## References

- `apps/api/src/app.ts` — `trustProxy: true` + global `rateLimit` registration with the token-hashed key generator.
- `apps/api/src/config/index.ts` — `RATE_LIMIT_MAX` + `RATE_LIMIT_WINDOW_MS` env knobs.
- `apps/api/src/middlewares/auth.middleware.ts` — populates `request.user` consumed by future composite keying.
- CLAUDE.md → "Security Hardening Checklist" → "Trust proxy" + "Auth middleware safety".
