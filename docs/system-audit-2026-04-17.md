# Teranga — System Audit & Remediation Plan

**Audit date:** 2026-04-17
**Branch:** `claude/system-audit-remediation-YtEhM`
**Scope:** Full monorepo (API, web-backoffice, web-participant, shared-ui, mobile, rules)
**Method:** Six parallel read-only auditors — security, Firestore transactions, domain events, freemium plan limits, localization, architecture/docs-drift.

Severity legend: **P0** ship-blocker (revenue, data-integrity, audit-critical) · **P1** must-fix this quarter · **P2** hardening / consistency · **P3** nice-to-have.
Effort legend: **XS** <1h · **S** 1-4h · **M** half-day · **L** 1-2d · **XL** ≥3d.

---

## 1. Executive Summary

| Domain | P0 | P1 | P2 | P3 | Overall |
| --- | --- | --- | --- | --- | --- |
| Security | 0 | 5 | 3 | 2 | Strong baseline, two TOCTOU windows + QR replay gap |
| Firestore transactions | 1 | 8 | 0 | 0 | Core flows atomic; secondary services leak races |
| Domain events (audit) | 9 | 2 | 15 | 0 | Large audit-trail gap on badges/feed/speaker/sponsor |
| Freemium enforcement | 9 | 2 | 2 | 0 | **Revenue leakage on 9 of 11 paid features** |
| Localization | many | many | many | — | Mobile at 0%, web-backoffice at 15%, wo stubbed |
| Architecture / docs | 0 | 1 | 3 | 1 | Structure sound, one layer violation + test-count drift |

**Top 3 risks to fix first (all P0):**

1. **Freemium backend enforcement is mostly absent** — 9 of 11 paid features (paidTickets update, smsNotifications, advancedAnalytics, speakerPortal, sponsorPortal, promoCodes, customBadges, qrScanning, csvExport) have only frontend `PlanGate` guards. Any free-plan org can hit the API directly. Direct revenue loss.
2. **`subscription.downgrade` rollback is non-atomic** — `subscription.service.ts:427-433` commits the plan change, then checks event count outside the transaction and attempts a plain-write rollback. Race window between commit and rollback can strand orgs on the wrong plan.
3. **Nine mutating service methods emit no domain events** — badges (bulk + templates), feed comments, speaker/sponsor profile updates, messaging read-receipts. Audit trail is silently incomplete; compliance and customer-support debugging are blind to these mutations.

**Posture assessment:** The security baseline is good (deny-all rules, `requireOrganizationAccess` on hot paths, HMAC QR signing, no SVG upload). The platform's real weaknesses are (a) freemium enforcement was built UI-first and the backend never caught up, (b) transactional discipline was applied to the big write paths but skipped on the secondary ones, and (c) localization is stubbed across the mobile app and the largest backoffice pages. None of this is a ship-stopper for closed beta; all of it is a ship-stopper for paid GA.

---

## 2. P0 — Must-fix before the next release

### 2.1 Freemium revenue leakage (backend gates missing)

| # | Feature | Location | Fix | Effort |
| --- | --- | --- | --- | --- |
| P0-F1 | `paidTickets` update-path | `apps/api/src/services/event.service.ts:358` (`updateTicketType`) | Call `this.requirePlanFeature(org, "paidTickets")` when incoming `price > 0`. Mirror the guard already in `addTicketType` at line 335. | XS |
| P0-F2 | `smsNotifications` | `apps/api/src/services/broadcast.service.ts:100` | Gate the SMS branch with `requirePlanFeature(org, "smsNotifications")` before dispatching. | XS |
| P0-F3 | `advancedAnalytics` | `apps/api/src/services/analytics.service.ts:41` (`getOrgAnalytics`) | Add `requirePlanFeature(org, "advancedAnalytics")` at method entry. | XS |
| P0-F4 | `speakerPortal` | `apps/api/src/services/speaker.service.ts` (all mutations + reads) | Gate `createSpeaker`, `updateSpeaker`, `deleteSpeaker`, and the speaker-list endpoint. | S |
| P0-F5 | `sponsorPortal` | `apps/api/src/services/sponsor.service.ts` (esp. `scanLead`, `exportLeads`) | Gate all sponsor mutations + lead reads. | S |
| P0-F6 | `promoCodes` | `apps/api/src/services/promo-code.service.ts:23` | Gate `createPromoCode` (and probably `deactivate`). | XS |
| P0-F7 | `customBadges` | `apps/api/src/services/badge-template.service.ts:13,45` | Gate `create` and `update`. | XS |
| P0-F8 | `qrScanning` | `apps/api/src/services/checkin.service.ts` + `apps/api/src/routes/checkin.routes.ts` | Gate `getOfflineSyncData`, `bulkSync`, `scan`, and the manual-check-in path. | S |
| P0-F9 | `csvExport` | No server endpoint exists; export is client-side from already-fetched JSON | Build a server-side `/v1/events/:id/registrations/export.csv` endpoint gated by `csvExport`, or move heavy exports server-side. Remove the client-only CSV to prevent bypass. | M |

**Regression test:** for each feature, add a service-level test that calls the method with a `free` plan org and asserts `PlanLimitError`.

### 2.2 Data integrity — transactional gap

| # | Location | Risk | Fix | Effort |
| --- | --- | --- | --- | --- |
| P0-T1 | `apps/api/src/services/subscription.service.ts:427-434` (`downgrade` immediate path) | Plan change commits, then event-count check happens outside the tx, then rollback is a plain write. Org can be stranded on wrong plan; concurrent upgrade silently overwritten. | Move the `countActiveByOrganization` guard **into** the transaction (like the member-count check at 401-408 already does). Delete the post-tx compensating write. | S |

### 2.3 Audit-trail gaps (missing `eventBus.emit`)

| # | Service.method | Suggested event name | Effort |
| --- | --- | --- | --- |
| P0-E1 | `badge-template.service.ts` `create` | `badge_template.created` | XS |
| P0-E2 | `badge-template.service.ts` `update` | `badge_template.updated` | XS |
| P0-E3 | `badge-template.service.ts` `remove` | `badge_template.deleted` | XS |
| P0-E4 | `badge.service.ts` `bulkGenerate` (line 105) | One `badge.bulk_generated` per batch + per-badge or per-batch emits | S |
| P0-E5 | `messaging.service.ts` `markAsRead` (line 139) | `conversation.read` | XS |
| P0-E6 | `feed.service.ts` `addComment` (line 227) | `feed_comment.created` | XS |
| P0-E7 | `feed.service.ts` `deleteComment` (line 298) | `feed_comment.deleted` | XS |
| P0-E8 | `speaker.service.ts` `updateSpeaker` (line 78) | `speaker.updated` | XS |
| P0-E9 | `sponsor.service.ts` `updateSponsor` (line 74) | `sponsor.updated` | XS |

For each, also wire the matching audit listener in `apps/api/src/events/listeners/audit.listener.ts`.

**Phase 1 total effort: ~2-3 days.**

---

## 3. P1 — Next sprint

### 3.1 Security hardening

| # | Location | Issue | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-S1 | `apps/api/src/services/qr-signing.ts:46-66` | v2 QR includes a base36 timestamp but `verifyQrPayload` never validates age. Stolen badges = permanent replay. | Reject when `parseInt(ts, 36) < now - MAX_AGE_MS` (suggested 24h post-event). Add test. | S |
| P1-S2 | `apps/api/src/services/venue.service.ts:74-169` | `update`, `approve`, `suspend`, `reactivate` do read-then-write without a transaction. | Wrap each in `db.runTransaction()`. | S |
| P1-S3 | `apps/api/src/services/admin.service.ts:152-213` | `updateUserRoles` and `updateUserStatus` read-then-write outside tx; compensating rollback race. | Wrap Firestore read+write in `db.runTransaction()`; keep Auth mutation after commit. | S |
| P1-S4 | `apps/api/src/services/newsletter.service.ts` | `subscribe()` / `sendNewsletter()` emit no domain events. | Emit `newsletter.subscribed`, `newsletter.sent`; subscribe audit listener. | XS |
| P1-S5 | `apps/api/src/services/notification.service.ts` | `markAsRead` / `markAllAsRead` emit no domain events. | Emit `notification.read`, `notification.all_read`. | XS |

### 3.2 Transactional gaps (data integrity)

| # | Location | Risk | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-T1 | `event.service.ts:52-106` `create` | TOCTOU on `maxEvents` plan limit. | Move `countActiveByOrganization` + `eventRepository.create` + `venueRepository.increment` into a single transaction. | M |
| P1-T2 | `event.service.ts:557-633` `clone` | Same TOCTOU as create. | Same fix. | S |
| P1-T3 | `event.service.ts:161-213` `update` | Venue swap does two sequential increments; crash between them = permanent counter drift. | Wrap both venue increments + event update in one tx. | S |
| P1-T4 | `badge.service.ts:38-98` `generate` | Concurrent callers can both produce a badge for the same registration. | Use deterministic doc ID `badges/{registrationId}` + transactional create. | S |
| P1-T5 | `badge.service.ts:372-380` `download` | `downloadCount` lost-update race. | Replace with `FieldValue.increment(1)`. | XS |
| P1-T6 | `feed.service.ts:298-321` `deleteComment` | Soft-delete + counter decrement non-atomic. | Wrap in tx with `FieldValue.increment(-1)`. | XS |
| P1-T7 | `invite.service.ts:21-85` `createInvite` | TOCTOU on `maxMembers` (pending-invite count). | Move count query + check + create into a single tx. | S |
| P1-T8 | `organization.service.ts:223-289` `removeMember` | `memberIds` update + user-mirror `set` non-atomic. | Mirror the tx already used in `addMember`. | S |

### 3.3 Freemium — secondary gaps

| # | Location | Issue | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-P1 | `subscription.service.ts:427-433` | Downgrade event-count check race. | Same fix as P0-T1 (moved inside tx). | — (bundled) |
| P1-P2 | `organization.service.ts:113` | `logoURL`, `coverURL` writable by every plan — will become a revenue gap once white-label branding ships. | Either segregate branding fields behind `requirePlanFeature("whiteLabel")` or split into a dedicated `updateBranding` method. | S |

### 3.4 Architecture

| # | Location | Issue | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-A1 | `apps/api/src/routes/notifications.routes.ts:7,71-76` | Route imports `db`/`COLLECTIONS` and runs Firestore queries directly — layer violation. | Extract to `notification.service.ts` (e.g. `getUnreadCount(userId)`). Remove `db` import from routes. | S |

### 3.5 Domain-event payload bugs

| # | Location | Issue | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-E1 | `venue.service.ts:94` + `audit.listener.ts:434` | `venue.updated` emit omits `organizationId`; listener hardcodes `null`. | Include `organizationId` on the emit and read it in the listener. | XS |
| P1-E2 | `checkin.service.ts:262` + `audit.listener.ts:72` | `checkin.completed` emits with `accessZoneId` but audit listener writes `organizationId: null`. | Include `organizationId` on the emit payload; thread through audit log. | XS |

**Phase 2 total effort: ~5-7 days.**

---

## 4. P2 — Hardening / consistency backlog

### 4.1 Orphan domain events (emitted, no listener)

Add matching audit-listener subscriptions for (all in `apps/api/src/events/listeners/audit.listener.ts`):

- `access_zone.added`, `access_zone.updated`, `access_zone.removed` (event.service.ts:466, 508, 544)
- `checkin.bulk_synced` (checkin.service.ts:124)
- `payment.initiated`, `payment.succeeded`, `payment.failed`, `payment.refunded` (payment.service.ts)
- `promo_code.created`, `promo_code.used`, `promo_code.deactivated` (promo-code.service.ts)
- `subscription.upgraded`, `subscription.downgraded` (subscription.service.ts)
- `member.role_updated` (organization.service.ts:370)
- `feed_post.updated` (feed.service.ts:187)

**Effort: S** (one listener file, 15 subscriptions following the existing pattern).

### 4.2 Other P2 items

| # | Location | Issue | Fix | Effort |
| --- | --- | --- | --- | --- |
| P2-S1 | `apps/api/src/config/index.ts:33` | `WEBHOOK_SECRET` has `.default("dev-webhook-secret-change-in-prod")` — silent use in misconfigured environments. | Remove default in non-dev; mirror the `QR_SECRET` production guard. | XS |
| P2-S2 | `apps/api/src/services/venue.service.ts:197-208` | `listHostVenues` has no `venue:read` permission — relies only on `organizationId` presence. | Add a `venue:read_own` permission and enforce. | S |
| P2-S3 | `infrastructure/firebase/firestore.rules:420-431` | `venues` create rule doesn't bind `hostOrganizationId` to the creator's org (defense-in-depth). | Add `&& belongsToOrg(request.resource.data.hostOrganizationId)`. | XS |
| P2-A1 | CLAUDE.md | Claims "401 tests across 29 test files"; repo has **66** test files. | Refresh the paragraph after the next `vitest run`. | XS |
| P2-A2 | CLAUDE.md subscriptions table | Missing `POST /subscription/revert-scheduled`. | Add the row. | XS |
| P2-A3 | CLAUDE.md + `infrastructure/` | `infrastructure/terraform/` documented but absent. | Either create a stub with a README, or mark "Post-Wave-10" in the monorepo layout. | XS |
| P2-FR1 | `scripts/seed-emulators.ts:444` | Org display names drift from CLAUDE.md ("Teranga Events" vs "Teranga Events SRL"). | Align seed strings with the documented names. | XS |

---

## 5. Localization remediation (cross-cutting)

Because l10n coverage is so uneven, treat it as a dedicated track instead of a per-file P-ranking.

### 5.1 P0 — core flows in every app

- **Mobile (`apps/mobile`)** — `AppLocalizations.delegate` is **not registered** in `apps/mobile/lib/app.dart:30`. Effective i18n coverage is 0%. Fix order:
  1. Register the generated delegate in `MaterialApp.localizationsDelegates`.
  2. Migrate the auth pages (`login_page.dart`, `register_page.dart`), the event detail page (`event_detail_page.dart`), the events list, the badge page, and the scanner to `AppLocalizations.of(context)`.
  3. Replace raw `'${price} XOF'` concatenations with `NumberFormat.currency(locale: 'fr_SN', symbol: 'XOF')` (`event_detail_page.dart:316`, `events_list_page.dart:222`).
  4. Switch `DateFormat(…, 'fr_FR')` to `'fr_SN'` (`event_detail_page.dart:99`, `events_list_page.dart:164`).
  5. Add missing ARB keys referenced in code: `createAccount`, `registrationError`, `networking`, `profileTitle`, `confirmations`, `checkIns`, `myRegistrations`, `lightTheme`, `darkTheme`, `systemTheme`.
  - Effort: **L**.

- **Web-backoffice (`apps/web-backoffice`)** — `next-intl` is wired but `useTranslations` is used in ~12 files out of ~60. Fix order:
  1. Expand `messages/fr.json`, `en.json`, `wo.json` from the current ~11 top-level keys.
  2. Convert `events/[eventId]/page.tsx` (70+ hardcoded toasts and labels) — highest ROI, single file.
  3. Convert `events/new/page.tsx` (wizard), `events/[eventId]/checkin/page.tsx`, and `admin/plans/page.tsx`.
  4. Replace 28+ `toLocaleString("fr-FR")` call-sites with the shared `formatDate()` utility from `apps/web-backoffice/src/lib/utils.ts` (already uses `fr-SN` + `Africa/Dakar`).
  - Effort: **XL** (≥3 days; can parallelize per-page).

- **Web-participant (`apps/web-participant`)** — auth is well-covered; speaker/sponsor portals and public pricing/faq pages are hardcoded. Fix order:
  1. `speaker/[eventId]/page.tsx` and `sponsor/[eventId]/page.tsx` (toasts + labels).
  2. `(public)/pricing/page.tsx`, `(public)/faq/page.tsx`, `(public)/error.tsx`.
  3. `use-auth.tsx:109,113` — replace literal toasts with existing keys.
  4. Replace `fr-FR` locale in `schedule/page.tsx`, `speaker`, `sponsor`, `events/[slug]/page.tsx`, `FeedPostCard`, `InlineComment` — use `fr-SN`.
  - Effort: **L**.

- **Shared-ui (`packages/shared-ui`)** — mostly good. Three residual leaks:
  - `query-error.tsx:33` renders literal "Réessayer" instead of `labels.retry`.
  - `file-upload.tsx:83` builds `"Le fichier dépasse ${mb} Mo"` outside the `labels` bundle — add `labels.fileTooLarge(mb)`.
  - `search-input.tsx:18` default placeholder `"Rechercher..."` — route through `labels`.
  - Effort: **S**.

### 5.2 P1 — Wolof coverage

`wo.arb` is a stub with `"coverage": "partial"` and 136 missing keys. Decide:
- (A) Commission translation pass (preferred for the francophone→Wolof bilingual market).
- (B) Temporarily hide `wo` from the language switcher until coverage ≥ 90%.
- Effort: **M** for option B; translation cost for option A is out of engineering scope.

---

## 6. Sequencing & recommended delivery

### Week 1 — revenue + integrity (Phase 1, ~2-3d work)
Day 1-2: P0-F1…F9 (backend plan gates) + regression tests.
Day 2: P0-T1 (subscription downgrade tx).
Day 3: P0-E1…E9 (add 9 emits + matching audit listeners). Run `@security-reviewer`, `@firestore-transaction-auditor`, `@domain-event-auditor`, `@plan-limit-auditor` locally before PR.

### Week 2 — hardening + transactions (Phase 2, ~5-7d)
Day 1: P1-S1 (QR replay window) + P1-S4/S5 (newsletter, notification emits).
Day 2-3: P1-S2 + P1-S3 (venue and admin service transactional wrapping).
Day 3-4: P1-T1…T8 (remaining transactional gaps — batch by service).
Day 5: P1-A1 (notifications route layer violation), P1-E1/E2 (audit payload fixes), P1-P2 (white-label segregation).

### Week 3 — localization sprint (split tracks)
Track A (mobile, 1 dev): wire `AppLocalizations.delegate`, migrate auth + event pages, fix currency/date formatting.
Track B (web-backoffice, 1 dev): expand `fr.json`/`en.json`, migrate `events/[eventId]/page.tsx` + `events/new/page.tsx`, replace `fr-FR` formatters with shared utility.
Track C (web-participant + shared-ui, 1 dev): speaker/sponsor portals + shared-ui residuals.
Run `@l10n-auditor` at end of the week; aim for ≥70% coverage on each app before Wave 10 launch prep.

### Week 4 — P2 cleanup & docs refresh
- Wire the 15 orphan audit listeners (one PR, ~half a day).
- Apply the 4 P2 security/rules items.
- Refresh CLAUDE.md: test counts, subscriptions table, terraform status.
- Decide Wolof strategy (hide switcher or commission translation).

---

## 7. Verification checklist per PR

For every remediation PR on this branch:

- [ ] Added regression test for the specific behavior (unit or route-level).
- [ ] Ran `cd apps/api && npx vitest run` — all tests green.
- [ ] For service changes: invoked `@security-reviewer`, `@firestore-transaction-auditor`, `@domain-event-auditor` locally and resolved findings.
- [ ] For freemium-touching changes: invoked `@plan-limit-auditor`.
- [ ] For UI changes: invoked `@l10n-auditor`.
- [ ] Updated the branch PR description to reflect cumulative scope (per CLAUDE.md rule 7).
- [ ] Commit message follows conventional-commits with a body explaining the "why" and ending in "All N tests pass."

---

## 8. Out-of-scope / deferred

- Full Wolof translation (business decision).
- Mobile offline-first check-in flow (deferred to Wave 9).
- `apiAccess` enterprise feature (endpoint does not yet exist — no revenue leakage today; implement with the gate in place when the feature ships).
- Terraform IaC (explicitly aspirational — keep `infrastructure/firebase` as the operational source of truth).
