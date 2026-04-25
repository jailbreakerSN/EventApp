---
title: OpenAPI artefact
status: shipped
last_updated: 2026-04-25
---

# OpenAPI artefact

The Teranga API publishes its full route surface as a versioned OpenAPI 3.0.3 specification, generated directly from the Fastify Swagger registry.

## Files

| File | Purpose |
|---|---|
| [`openapi.json`](./openapi.json) | Canonical machine-readable spec — import into Postman, Bruno, Insomnia, Stoplight, etc. |
| [`openapi.yaml`](./openapi.yaml) | Human-friendly mirror of the same spec. |

## Regeneration

The artefact is generated from `apps/api/src/app.ts` (Fastify Swagger registration). Whenever a route is added, removed, or its schema changes, regenerate:

```bash
npm run docs:openapi
```

Output is written to this directory. **Commit the regenerated files in the same PR that changed the routes.**

## CI freshness guard

```bash
npm run docs:openapi:check
```

Exits with code `2` if the committed artefact drifts from the live Fastify spec. Wired into CI to prevent stale OpenAPI from shipping silently.

## Live endpoints

| Environment | Spec endpoint | Interactive UI |
|---|---|---|
| Local dev | `http://localhost:3000/v1/admin/openapi.json` | `http://localhost:3000/docs` |
| Staging | `https://api-staging.teranga.events/v1/admin/openapi.json` | `https://api-staging.teranga.events/docs` |
| Production | `https://api.teranga.events/v1/admin/openapi.json` | _disabled — admin must import the JSON_ |

The interactive `/docs` UI is **not exposed in production** to prevent unauthenticated enumeration of the API surface. Operators who need it import the JSON into their own client.

## Notable details

- Spec format: **OpenAPI 3.0.3**.
- Auth schemes: `BearerAuth` (Firebase ID token) and `ApiKeyAuth` (`terk_*` org API key — see [ADR-0013](../../20-architecture/decisions/0013-api-key-format-checksum-hashed.md)).
- Number of paths: ~200 across `/v1/events`, `/v1/registrations`, `/v1/badges`, `/v1/checkins`, `/v1/admin`, `/v1/organizations`, plus a few unversioned health routes.
- Tags: `Events`, `Registrations`, `Badges`, `Users`, `Organizations`, `Admin`, `Coupons`, `Notifications`.

## Related references

- [API overview](../README.md)
- [ADR-0013 — API keys](../../20-architecture/decisions/0013-api-key-format-checksum-hashed.md)
- [`docs/api-keys.md`](../../../docs/api-keys.md) — operator + integrator guide
