# ADR-0015: Trust proxy + auth-aware rate limiting

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

The Fastify API runs behind Cloud Run's load balancer (which is itself behind GCP's edge proxies). Two independent decisions have to be made:

1. **Whose IP do we record?** With default Fastify settings, `request.ip` returns the immediate caller — the Cloud Run load balancer's internal IP, identical for every request. Useless for rate limiting, abuse tracking, and audit logs.
2. **How do we key rate limits?** Per-IP rate limiting alone breaks: (a) participants behind a corporate NAT all share an IP, (b) authenticated users with 5G data switch IPs constantly. We need a smarter key.

Standard rate-limit failure modes:

- Per-IP only → office NAT triggers limits for innocent users.
- Per-user only → unauthenticated traffic (login, signup) has no key.
- Same limit for everyone → integrators with API keys get throttled into uselessness.

---

## Decision

**The API runs with `trustProxy: true` so `request.ip` returns the real client IP from `X-Forwarded-For`. Rate limits are keyed by an auth-aware composite that adapts to the request's authentication state.**

### Trust proxy

```typescript
const fastify = Fastify({
  trustProxy: true,  // X-Forwarded-For header is honored
  ...
});
```

This is safe because Cloud Run is the only proxy in front of us — no risk of header spoofing from arbitrary clients (the header is overwritten by Cloud Run's load balancer).

### Auth-aware rate limit key

```typescript
function rateLimitKeyFor(request: FastifyRequest): string {
  if (request.user?.isApiKey) return `apikey:${request.user.uid}`;
  if (request.user?.uid)     return `user:${request.user.uid}`;
  return `ip:${request.ip}`;
}
```

Three key spaces, three limits:

| Key space | Limit (per minute) | Rationale |
|---|---|---|
| `apikey:*` | 600 | Integrators need throughput; tighter limits per-org via plan tier (planned, ADR-follow-up). |
| `user:*` | 120 | Authenticated humans use the web/mobile app; this absorbs SSR + client side. |
| `ip:*` | 30 | Unauthenticated routes (login, signup, public event listing). Tight to slow brute-force. |

### Sensitive-route overrides

Endpoints with abuse potential (login, signup, password reset, QR scan) get **stricter per-IP limits in addition to the global key**, applied with a separate Fastify rate-limit instance:

| Route | Per-IP limit (5 min) |
|---|---|
| `POST /v1/auth/login` | 10 |
| `POST /v1/auth/signup` | 5 |
| `POST /v1/auth/password-reset` | 3 |
| `POST /v1/checkin/scan` | 200 (staff scanners legitimately scan fast) |

---

## Reasons

- **`trustProxy: true` recovers the real IP.** Without it, every `request.ip` is the LB's internal IP — rate limiting is broken, audit logs are useless, abuse detection cannot work.
- **No spoofing risk** because Cloud Run's load balancer overwrites `X-Forwarded-For`. The proxy chain is fixed and trusted.
- **Composite key fairness.** A logged-in participant on shared corporate WiFi keeps their own quota. An anonymous abuser still hits the IP limit.
- **API-key throughput.** Integrators legitimately make hundreds of calls/min. They get a separate key space with appropriate headroom.
- **Brute-force resistance.** Per-IP overrides on auth routes survive even if the global key would let someone through (e.g., they have a stale session token).

---

## Alternatives considered

| Option | Why rejected |
|---|---|
| Default Fastify (`trustProxy: false`) | All requests appear to come from the same IP; rate limiting is moot. |
| `trustProxy: true` with no auth-aware key | Office NATs trigger limits for innocent users. |
| Per-user only (no IP fallback) | Unauthenticated routes have nothing to key on. |
| External rate limiter (Cloudflare, GCP Armor) | Useful at the edge layer; doesn't replace per-route logic in the API. Re-evaluate when traffic justifies edge-layer ACLs. |
| Dynamic per-org limits on API keys | Planned (will cite this ADR), not yet shipped. Today, per-key limit is uniform within the `apikey:*` key space. |

---

## Conventions

- **`trustProxy: true` is set at app construction**, not via env var. Cloud Run is the only deploy target — no risk of accidentally trusting a hostile proxy.
- **Rate-limit responses return 429** with a `Retry-After` header (seconds) computed from the bucket reset time.
- **Rate-limit keys never include PII.** Hashed UIDs/keys, never email or names, in the bucket store. (Current store: in-memory; planned: Memorystore Redis for multi-instance correctness.)
- **Rate-limit metrics are exported to Cloud Monitoring** with the key space (not the key) as a label.
- **Override routes are explicit** — defined in `apps/api/src/middlewares/rate-limit.middleware.ts`, not scattered across handlers.

---

## Consequences

**Positive**

- Real IPs in audit logs and abuse detection.
- Office NAT users are not collectively throttled.
- Integrators get the throughput they paid for.
- Auth routes survive distributed brute-force on multiple IPs (per-route override is per-IP, but the key space is also limited).

**Negative**

- In-memory rate-limit buckets do not coordinate across Cloud Run instances. A user spinning across instances effectively gets `N × limit`. Acceptable for now (Cloud Run scales modestly during normal traffic). Mitigation planned: Memorystore Redis backend.
- Per-key API limits are uniform across paid plans today. Plan-tier-aware limits are planned (will reference this ADR when shipped).
- Trust-proxy assumes the deploy target is always behind exactly one trusted proxy. A future move off Cloud Run to a different topology requires re-evaluating this setting.

**Follow-ups**

- Memorystore Redis backend for cross-instance bucket coordination (planned, Wave 9-10).
- Plan-tier-aware API key limits (planned, Wave 8).
- GCP Armor / Cloudflare edge rate limiting for DDoS resilience (post-launch).

---

## References

- `apps/api/src/app.ts` — `trustProxy: true` setting.
- `apps/api/src/middlewares/rate-limit.middleware.ts` — composite key + per-route overrides.
- `apps/api/src/middlewares/auth.middleware.ts` — provides `request.user` consumed by the key function.
- CLAUDE.md → "Security Hardening Checklist" → "Trust proxy" + "Auth middleware safety".
