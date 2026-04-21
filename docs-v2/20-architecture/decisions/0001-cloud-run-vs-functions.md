# ADR-0001: API on Cloud Run instead of Cloud Functions for HTTP

**Status:** Accepted  
**Date:** 2026-01  
**Deciders:** Platform team

---

## Context

The Teranga REST API needs a hosting target. Two Firebase-native options are available:

- **Firebase Cloud Functions** (v1 or v2) — serverless, scales to zero, pay-per-invocation
- **Cloud Run** — managed containers, configurable CPU/memory/concurrency, can scale to zero or maintain minimum instances

The API has ~39 routes with complex business logic (plan limit checks, cryptographic QR operations, Firestore transactions). It will receive sustained traffic during event check-in windows.

---

## Decision

**Use Cloud Run for the Fastify REST API.**

Cloud Functions are used exclusively for event-triggered side effects (Firestore document triggers, Auth triggers, Cloud Scheduler, Pub/Sub).

---

## Reasons

| Concern | Cloud Functions | Cloud Run |
|---|---|---|
| Cold start | 2–5s on v2 (always-warm costs extra) | <1s with minimum 1 instance |
| Request timeout | 60s default (540s max on v2) | Configurable, up to 3600s |
| Concurrency | 1 per instance (v1), 1000 (v2) | Configurable (default 80) |
| Memory | Up to 32 GB | Up to 32 GB |
| CPU | Always throttled when idle | Can always allocate |
| Framework compatibility | Custom frameworks work but add overhead | Any HTTP framework, Dockerfile |
| Cost model | Per invocation (good for spiky/rare traffic) | Per CPU-second (better for sustained) |
| Deployment | Firebase deploy | Docker build + gcloud run deploy |

For the Teranga API, Cloud Run wins because:
1. **Event check-in is bursty but sustained** — 100 staff scanning simultaneously for 2 hours. Functions would cold-start mid-event and fail the SLA.
2. **Fastify features** (plugins, hooks, Swagger) map cleanly to a long-lived process.
3. **Graceful shutdown** — Cloud Run sends `SIGTERM` with a 10s grace period. Fastify drains in-flight requests. Cloud Functions cannot do this.
4. **Request context** — `AsyncLocalStorage` works correctly in a long-lived process. It can misbehave in the serverless invocation model.

---

## Consequences

- Requires a `Dockerfile` and a build/push step in CI.
- Minimum 1 instance to eliminate cold starts adds ~$5–15/month at Cloud Run pricing.
- Cloud Functions are still used for triggers — this is the right tool for event-driven side effects where cold starts are acceptable (badge generation, waitlist promotion, etc.).
