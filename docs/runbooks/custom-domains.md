# Runbook — Custom domain mapping

> **Wave 10 / W10-P6 / L2.** End-to-end procedure for mapping the production custom domains (`api.teranga.events`, `app.teranga.events`, `teranga.events`) onto Cloud Run + Firebase Hosting.

This runbook is referenced from `docs/runbooks/production-launch.md` § Pre-launch checklist. It covers the `.sn` registrar steps, the Cloud Run / Firebase Hosting domain mapping, SSL verification, and the `vars.*_PUBLIC_URL` GitHub Variables flip the deploy workflows consume.

---

## Domain inventory

| Surface                          | Production domain       | Redirect-to                                         | DNS strategy                                            |
| -------------------------------- | ----------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| API (Cloud Run)                  | `api.teranga.events`    | n/a                                                 | A + AAAA records pointing to Cloud Run's domain mapping |
| Backoffice (Firebase Hosting)    | `app.teranga.events`    | n/a                                                 | A + AAAA records pointing to Firebase Hosting           |
| Participant (Firebase Hosting)   | `teranga.events`        | apex → `www.teranga.events` recommended for caching | apex A + ALIAS / `www` CNAME                            |
| Status page (managed externally) | `status.teranga.events` | n/a                                                 | CNAME to status page provider                           |

Domains use the `.events` TLD (registered) NOT `.sn` — the original audit referenced the Senegalese registrar by mistake. The runbook is portable to either; the registrar UI differs but the DNS records are the same.

---

## Pre-flight

- [ ] Confirm the Cloud Run service `teranga-api` is deployed and reachable on its `*.run.app` URL (via the production deploy workflow).
- [ ] Confirm the Firebase Hosting site `teranga-events-prod` is deployed.
- [ ] Confirm the registrar account credentials are in 1Password vault `teranga-prod` → `registrar`.
- [ ] Note: Cloud Run domain mappings can take up to 24 h to issue an SSL certificate. Schedule the runbook execution during a 48 h pre-launch window.

---

## Step 1 — API custom domain (Cloud Run)

```bash
# 1. Verify domain ownership in GCP (one-time per account/domain)
gcloud domains verify teranga.events

# 2. Map the API domain to Cloud Run
gcloud beta run domain-mappings create \
  --service teranga-api \
  --domain api.teranga.events \
  --region europe-west1

# 3. Read back the DNS records gcloud expects
gcloud beta run domain-mappings describe \
  --domain api.teranga.events \
  --region europe-west1 \
  --format="value(status.resourceRecords[].name,status.resourceRecords[].rrdata)"
```

Take the returned A + AAAA records and add them to the registrar:

| Type | Name  | Value                            | TTL  |
| ---- | ----- | -------------------------------- | ---- |
| A    | `api` | `<Cloud Run IPv4 from describe>` | 3600 |
| AAAA | `api` | `<Cloud Run IPv6 from describe>` | 3600 |

Wait 5–60 min for DNS propagation, then:

```bash
# 4. Confirm SSL provisioning
gcloud beta run domain-mappings describe \
  --domain api.teranga.events --region europe-west1 \
  --format="value(status.conditions)"
# Look for: type=Ready, status=True, reason=DomainMappingReady
```

---

## Step 2 — Backoffice custom domain (Firebase Hosting)

```bash
# 1. Connect the domain in the Firebase Console
#    (Firebase Hosting → Add custom domain → app.teranga.events)
#    The console returns a TXT verification record + final A/AAAA.

# 2. Add to the registrar:
```

| Type | Name  | Value                                | TTL  |
| ---- | ----- | ------------------------------------ | ---- |
| TXT  | `app` | `<verification token from Firebase>` | 3600 |
| A    | `app` | `199.36.158.100`                     | 3600 |
| A    | `app` | `199.36.158.101`                     | 3600 |

(IPs from Firebase Hosting; confirm via the console output — Google occasionally rotates them.)

```bash
# 3. Click "Verify ownership" in the console; provisioning takes 5–60 min.
# 4. Confirm SSL is active by browsing https://app.teranga.events.
```

---

## Step 3 — Participant custom domain (apex + www)

The participant app is the public funnel. We host the apex (`teranga.events`) AND the `www.` subdomain — the `www.` form is the canonical for SEO and the apex 301-redirects to it.

```bash
# 1. Add both domains in the Firebase Console
#    teranga.events  (apex)
#    www.teranga.events
```

Apex DNS — ALIAS record where the registrar supports it (Cloudflare, Route 53), or A records to Firebase Hosting IPs:

| Type      | Name  | Value                                 |
| --------- | ----- | ------------------------------------- |
| ALIAS / A | `@`   | Firebase Hosting (per console output) |
| TXT       | `@`   | `<verification token>`                |
| CNAME     | `www` | `teranga-events-prod.web.app`         |
| TXT       | `www` | `<verification token>`                |

```bash
# 2. Configure the redirect: in apps/web-participant/firebase.json,
#    add a redirect block (or use the Hosting console)
#    apex → https://www.teranga.events/$1 (301)
```

---

## Step 4 — Flip the GitHub Variables

The deploy workflows read base URLs from non-secret GitHub Variables so domain changes are a vars edit, not a code change. After SSL is active:

```bash
gh variable set API_URL_PROD          --body "https://api.teranga.events"        --env production
gh variable set BACKOFFICE_URL_PROD   --body "https://app.teranga.events"        --env production
gh variable set PARTICIPANT_URL_PROD  --body "https://www.teranga.events"        --env production
```

The `deploy-production.yml` workflow's `setup` job reads these when discovering the URLs to bake into Cloud Run env vars + the participant SSG sitemap.

---

## Step 5 — Verify

| Check                       | Command                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API on custom domain        | `curl -I https://api.teranga.events/health` → 200                                                                          |
| Backoffice on custom domain | `curl -I https://app.teranga.events` → 200                                                                                 |
| Participant on www          | `curl -I https://www.teranga.events` → 200                                                                                 |
| Apex redirects              | `curl -I https://teranga.events` → 301 to `https://www.teranga.events`                                                     |
| HSTS preload-eligible       | `curl -I https://api.teranga.events \| grep -i strict-transport-security` → `max-age=63072000; includeSubDomains; preload` |
| CSP report-uri reachable    | `curl -X POST https://app.teranga.events/api/csp-report -d '{"csp-report":{}}'` → 204                                      |

---

## Step 6 — HSTS preload submission

After 7 days of clean SSL operation, submit the apex to https://hstspreload.org. Pre-flight check the four prerequisites:

- [ ] Apex serves on HTTPS only (no HTTP fallback).
- [ ] HTTPS responses include `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- [ ] All subdomains served on HTTPS.
- [ ] No mixed-content warnings on any first-page render.

The participant app's `next.config.ts` already ships these headers; confirm via `curl -I` post-deploy.

---

## Rollback

If a custom domain misbehaves (cert provisioning timeout, registrar misconfiguration), the rollback is to revert the GitHub Variables to the `*.run.app` / `*.web.app` URLs and redeploy. The custom-domain DNS records can stay in place; Cloud Run / Firebase Hosting tolerate them being referenced from a non-current deploy.

```bash
# Rollback example:
gh variable set API_URL_PROD          --body "https://teranga-api-<hash>.run.app"     --env production
gh variable set BACKOFFICE_URL_PROD   --body "https://teranga-events-prod.web.app"    --env production
gh variable set PARTICIPANT_URL_PROD  --body "https://teranga-events-prod.web.app"    --env production
gh workflow run deploy-production.yml
```
