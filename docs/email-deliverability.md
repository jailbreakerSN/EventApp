# Email deliverability runbook

Addresses the three findings Resend's deliverability analyzer surfaces for `terangaevent.com`:

1. Link URLs must match the sending domain
2. DMARC record must be published
3. Don't use `no-reply@` as the From address

Item 3 is fixed in code (see `apps/api/src/services/email/sender.registry.ts`). Items 1 and 2 need DNS / infra work — this doc is the step-by-step.

Same runbook applies to staging (`teranga-app-990a8`) and production (`teranga-events-prod`). Run staging first, verify, then promote.

---

## 1. Match link URLs to the sending domain

**Why**: Mail coming from `@terangaevent.com` with click-through URLs on `*.run.app` looks like phishing to spam filters. Gmail and Outlook will start binning these in the promotions tab once volume grows.

**Target state**:

| Service     | Current Cloud Run URL                                               | Custom domain            |
| ----------- | ------------------------------------------------------------------- | ------------------------ |
| API         | `teranga-api-staging-<project-number>.europe-west1.run.app`         | `api.terangaevent.com`   |
| Participant | `teranga-participant-staging-<project-number>.europe-west1.run.app` | `app.terangaevent.com`   |
| Backoffice  | `teranga-backoffice-staging-<project-number>.europe-west1.run.app`  | `admin.terangaevent.com` |

### 1.1 Map custom domains in Cloud Run

For each of the three services, run once per environment:

```bash
PROJECT=teranga-app-990a8       # or teranga-events-prod
REGION=europe-west1

gcloud beta run domain-mappings create \
  --service=teranga-api-staging \
  --domain=api.terangaevent.com \
  --region=$REGION --project=$PROJECT

gcloud beta run domain-mappings create \
  --service=teranga-participant-staging \
  --domain=app.terangaevent.com \
  --region=$REGION --project=$PROJECT

gcloud beta run domain-mappings create \
  --service=teranga-backoffice-staging \
  --domain=admin.terangaevent.com \
  --region=$REGION --project=$PROJECT
```

Each call returns the DNS records to publish (CNAME for subdomains, A/AAAA for an apex).

> **Prereq**: the domain must be verified against the GCP project. `gcloud domains verify terangaevent.com` or the Search Console flow — one-time per project.

### 1.2 Publish the DNS records

For each subdomain, publish the CNAME Cloud Run returned. For `terangaevent.com` DNS managed by your registrar, add:

```
api      3600  CNAME  ghs.googlehosted.com.
app      3600  CNAME  ghs.googlehosted.com.
admin    3600  CNAME  ghs.googlehosted.com.
```

Propagation takes 5–60 minutes. Google issues a managed TLS cert automatically once the CNAME resolves — check with:

```bash
gcloud beta run domain-mappings describe \
  --domain=api.terangaevent.com \
  --region=$REGION --project=$PROJECT
```

`status.conditions[0].status = True` means the cert is provisioned and HTTPS works.

### 1.3 Switch the deploy to use the custom URLs

The deploy workflow reads three optional GitHub **Variables** (not Secrets). When set, they override the computed `*.run.app` URLs:

```bash
gh variable set API_PUBLIC_URL         --body https://api.terangaevent.com    --env staging
gh variable set PARTICIPANT_PUBLIC_URL --body https://app.terangaevent.com    --env staging
gh variable set BACKOFFICE_PUBLIC_URL  --body https://admin.terangaevent.com  --env staging
```

Repeat with `--env production` for prod. Next deploy picks them up automatically; links in emails now start with `https://api.terangaevent.com/...`, matching the sending domain.

---

## 2. Publish a DMARC record

**Why**: Gmail, Yahoo, and Microsoft require DMARC for any sender pushing >5 000 messages/day as of Feb 2024. Even at our current volumes, missing DMARC knocks us into the spam folder for the majority of recipients.

### 2.1 Start in monitor mode (`p=none`)

Publish one TXT record at `_dmarc.terangaevent.com`:

```
_dmarc.terangaevent.com  3600  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@terangaevent.com; ruf=mailto:dmarc-reports@terangaevent.com; fo=1; adkim=r; aspf=r; pct=100"
```

What the tags mean:

| Tag     | Value                                   | Effect                                                                       |
| ------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `v`     | `DMARC1`                                | Protocol version. Required.                                                  |
| `p`     | `none`                                  | Policy applied to failing mail. `none` = report only, no effect on delivery. |
| `rua`   | `mailto:dmarc-reports@terangaevent.com` | Aggregate-reports destination. Receivers send daily XML.                     |
| `ruf`   | `mailto:dmarc-reports@terangaevent.com` | Forensic reports (per-failure). Low volume. Optional.                        |
| `fo`    | `1`                                     | Generate forensic reports on any SPF or DKIM failure.                        |
| `adkim` | `r`                                     | Relaxed DKIM alignment — subdomains of terangaevent.com pass.                |
| `aspf`  | `r`                                     | Relaxed SPF alignment — same.                                                |
| `pct`   | `100`                                   | Apply the policy to 100% of mail.                                            |

Create the `dmarc-reports@terangaevent.com` mailbox first (or point `rua`/`ruf` at an existing monitored inbox). A free tier at Postmark's DMARC Digests or Google Postmaster Tools works too.

### 2.2 Watch aggregate reports for 2 weeks

Confirm that **100% of mail from terangaevent.com passes SPF and DKIM**. If your Resend domain is already verified, it does — SPF + DKIM are part of Resend's domain setup. Aggregate reports will show:

- Source IPs (Resend's mail servers)
- SPF/DKIM alignment pass/fail counts
- Any unauthorized senders impersonating your domain

### 2.3 Tighten to `quarantine`, then `reject`

Once reports show clean pass rates (>99%):

```
"v=DMARC1; p=quarantine; pct=25; ..."   # week 3: quarantine 25% of failures
"v=DMARC1; p=quarantine; pct=100; ..."  # week 4
"v=DMARC1; p=reject; pct=100; ..."      # week 5+ — final state
```

`reject` is the strongest signal to mailbox providers. Most large senders sit here. Never skip the staged rollout — a misconfigured DKIM on a secondary service (transactional bank, payment provider) would start getting rejected the moment you publish `p=reject`, and you won't notice for days.

---

## 3. Stop using `no-reply@`

**Why**: Covered above — deliverability analyzers flag it, and users who hit reply hit a wall.

**Code**: fixed in this PR. The sender registry now routes `auth` + `transactional` through `events@terangaevent.com`, with `Reply-To: support@terangaevent.com`.

**Action on your side**: create two real mailboxes in Google Workspace (or your provider):

- `events@terangaevent.com` — monitored. Most auto-replies to transactional mail land here ("thanks for the receipt, keep it for my records"). Can route to a shared inbox or auto-archive.
- `support@terangaevent.com` — already in the env defaults; real human monitors it.

Both mailboxes' SPF + DKIM are already handled by the domain-wide Resend setup. No extra DNS.

---

## Verification checklist

After landing all three:

- [ ] `curl -I https://api.terangaevent.com/health` returns 200
- [ ] `dig _dmarc.terangaevent.com TXT +short` returns the expected string
- [ ] Re-open the Resend deliverability analyzer — all three flags clear
- [ ] Subscribe a test address to the newsletter; verify the confirmation email link starts with `https://api.terangaevent.com/...`
- [ ] Verify the email's From header shows `Teranga Events <events@terangaevent.com>`
- [ ] Reply to one of our emails from a real mailbox — confirm the response lands in `support@terangaevent.com`

After 4 weeks of clean DMARC reports, flip to `p=reject` and document the date in this file.
