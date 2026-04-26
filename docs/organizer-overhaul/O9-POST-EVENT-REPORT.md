# O9 — Post-event Report + Financial Reconciliation

> **Phase O9** du plan `PLAN.md`. Couvre le « lendemain de l'événement » : un rapport unifié (présence, comms, finance), une matrice de rapprochement par moyen × statut, un export CSV cohorté pour les campagnes de fidélisation, et un bouton « Demander le versement » qui passe par le service payout existant. Le tout avec un PDF téléchargeable en 1 clic.

## Objectif mesurable

> **Rapport PDF livrable aux sponsors en 1 clic, J+1.** Cohorte CSV exportable en 3 segments. Demande de virement traitée en un click depuis la même surface.

Avant : l'organisateur compilait à la main (tableur Excel + extraction manuelle d'analytics + ajout des chiffres financiers depuis la page paiements). Après : tout en une page, exportable en PDF (`pdf-lib`), avec un audit forensique de chaque téléchargement (segment + row count, jamais le contenu PII).

## Architecture

### Shared types

**`packages/shared-types/src/post-event-report.types.ts`** (nouveau, ~200 lignes) :

- `PostEventReportSchema` : agrégation finale — eventId + attendance + demographics + comms + financial + computedAt + isFinal.
- `AttendanceBreakdownSchema` : registered / checkedIn / cancelled / noShow / checkinRatePercent.
- `DemographicBreakdownSchema` : `byTicketType`, `byAccessZone`, `byLanguage` (3 dimensions disponibles dans la donnée).
- `CommsPerformanceSchema` : broadcastsSent + totalRecipients + totalDispatched + totalFailed + perChannel.
- `FinancialSummarySchema` : grossAmount, refundedAmount, netRevenue, platformFee, payoutAmount, paidRegistrations, currency: "XOF".
- `ReconciliationSummarySchema` : matrice `(method, status)` + totals + lastPaymentAt.
- `CohortRowSchema` + `CohortSegmentSchema` (`attended` / `no_show` / `cancelled` / `all`).

**`packages/shared-types/src/audit.types.ts`** : 3 nouveaux `AuditAction` — `post_event_report.generated`, `cohort_export.downloaded`, `payout.requested`.

### Backend

**`reconciliation.service.ts`** (~120 lignes)

- `getSummary(eventId, user)` : permission `payout:read`. Read-only. 7 colonnes (méthode, statut, count, brut, remboursé, net) + totals.
- Helper pur `computeReconciliation()` exporté — partagé avec le post-event-report.service pour les `FinancialSummary` totaux. Single source of truth.
- Tests : 8 cas (grouping, refunds, failed-exclusion, distinct-paidRegistrations, platformFee math, ordre stable, lastPaymentAt).

**`post-event-report.service.ts`** (~250 lignes)

- `getReport(eventId, user)` : permission `event:read`. 4 reads parallèles (registrations, payments, broadcasts, user-languages chunké en lots de 30) → agrégation en mémoire → émet `post_event_report.generated` avec headline numbers (registered, checkedIn, gross, payout — pas de PII).
- `requestPayout(eventId, user)` : permission `payout:create`. Compute period from succeeded payments → délègue à `payoutService.createPayout` (transaction atomique déjà couverte) → émet `payout.requested` distinct de `payout.created` pour distinguer le path organizer-initié.
- Helpers purs exportés : `isEventFinal`, `computeAttendance`, `computeDemographics`, `computeCommsPerformance`.
- Tests : 14 cas (gate temporel, attendance edge cases, demographics filtrage cancelled, comms attribution multi-canaux).

**`cohort-export.service.ts`** (~200 lignes)

- `exportCsv(eventId, segment, user)` : permission `registration:export`. Filtre par segment + merge des paiements par registrationId → CSV RFC-4180 + UTF-8 BOM (Excel-FR friendly). Émet `cohort_export.downloaded` avec rowCount + segment (pas de PII dans l'audit).
- Helpers purs exportés : `buildCohortRows`, `formatCsv`.
- Tests : 13 cas (segment filtering, payment merging, BOM + CRLF, quoting + escaping).

**`post-event-pdf.service.ts`** (~280 lignes)

- `generatePdf(eventId, user)` : délègue à `getReport()` (qui couvre permission + audit), rend via `pdf-lib` (déjà utilisé par receipts/badges), upload sur Cloud Storage à `reports/${eventId}/post-event.pdf`, retourne signed URL V4 valide 1 h.
- Helper pur exporté : `renderReportPdf(report)` → `Uint8Array` testable sans toucher Cloud Storage.
- Sanitization des espaces insécables (U+202F / U+00A0 / U+2009) que `pdf-lib`'s WinAnsi encoder rejette — point de douleur subtil documenté inline.
- Tests : 3 cas (header magic + byte size, edge case zero-attendance, edge case endDate null).

### Routes

**`apps/api/src/routes/post-event.routes.ts`** — 5 endpoints sous `/v1/events/:eventId/post-event/*` :

| Méthode | Path              | Permission            | Réponse                            |
| ------- | ----------------- | --------------------- | ---------------------------------- |
| GET     | `/report`         | `event:read`          | `{ data: PostEventReport }`        |
| GET     | `/reconciliation` | `payout:read`         | `{ data: ReconciliationSummary }`  |
| GET     | `/report.pdf`     | `event:read`          | `{ data: { pdfURL, report } }`     |
| GET     | `/cohort.csv`     | `registration:export` | `text/csv` + `content-disposition` |
| POST    | `/payout-request` | `payout:create`       | `{ data: Payout }`                 |

Snapshots `route-inventory.test.ts.snap` + `permission-matrix.test.ts.snap` mis à jour (5 lignes ajoutées).

### Domain events + audit

**`apps/api/src/events/listeners/audit.listener.ts`** : 3 nouveaux handlers — `post_event_report.generated` (registered + checkedIn + gross + payout, pas de PII), `cohort_export.downloaded` (segment + rowCount, pas de PII), `payout.requested` (netAmount). `EXPECTED_HANDLER_COUNT` passé à 112.

**Privacy-first** :

- Aucune donnée participant n'entre dans l'audit log (cohérent avec O7 / O8).
- L'audit `cohort_export.downloaded` capture le segment + le nombre de lignes — assez pour investiguer une fuite, pas assez pour reconstituer la liste.
- L'audit `post_event_report.generated` ne porte que les headline numbers (entiers agrégés).

### Frontend

#### Hooks

**`apps/web-backoffice/src/hooks/use-post-event.ts`** :

- `usePostEventReport(eventId)` — read-model JSON, staleTime 30 s.
- `useReconciliation(eventId)` — matrice financière, staleTime 30 s.
- `useGeneratePostEventPdf(eventId)` — mutation, retourne `{ pdfURL, report }`. Le frontend ouvre le signed URL dans un nouvel onglet (le navigateur gère le téléchargement).
- `useDownloadCohortCsv(eventId)` — mutation, fetch direct avec bearer token + Blob download triggered via `<a download>`.
- `useRequestPayout(eventId)` — mutation, invalidation `payouts` + `reconciliation` + `post-event-report`.

#### Composants

| Composant                 | Rôle                                              | Fichier                                          |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `<PostEventReportCards/>` | 4 cards (Présence, Comms, Finances, Démographies) | `components/post-event/PostEventReportCards.tsx` |
| `<ReconciliationTable/>`  | Matrice méthode × statut + totals row             | `components/post-event/ReconciliationTable.tsx`  |
| `<CohortExportButton/>`   | Bouton + segment selector (4 options)             | `components/post-event/CohortExportButton.tsx`   |
| Helpers purs              | `formatXof`, `formatPaymentMethod/Status`         | `components/post-event/helpers.ts`               |

**Décisions de design** :

- **Pas de re-déclaration de la fenêtre J-0** — la page reste accessible à n'importe quel moment, mais l'entrée sur `/overview` n'est _active_ qu'une fois `liveWindowState === "after"` (réutilise les helpers O8). Avant, le bouton est désactivé avec un tooltip explicite.
- **Bandeau « En cours »** quand l'événement n'est pas encore terminé — les chiffres existent mais sont marqués comme provisoires (no-show = 0, payout = 0 par convention).
- **Bouton « Demander le versement »** désactivé tant que `payoutAmount === 0` — pas de friction inutile sur un événement gratuit.
- **CSV download via Blob** plutôt que signed URL — l'export contient de la PII (noms + emails participants) ; on évite de créer un objet Cloud Storage public-signé même 1 h. Le navigateur récupère les bytes avec son bearer token et les écrit directement.
- **PDF via signed URL** — pas de PII, pas de besoin réseau immédiat ; même pattern que les reçus existants.

#### Page `/events/[eventId]/post-event`

`apps/web-backoffice/src/app/(dashboard)/events/[eventId]/post-event/page.tsx` :

```
┌─────────────────────────────────────────────────────────┐
│ Header :  title · isFinal pill · toolbar (PDF / CSV /   │
│           Demander le versement)                         │
├─────────────────────────────────────────────────────────┤
│ <PostEventReportCards/>  (4 cartes)                      │
├─────────────────────────────────────────────────────────┤
│ <ReconciliationTable/>                                  │
└─────────────────────────────────────────────────────────┘
```

- **Pas de bypass du chrome événement** — contrairement à `/live`, la page reste dans la nav 4-section O4. Le contexte event-detail (titre, statut, breadcrumb) est utile au lendemain.
- **Entry point sur `/overview`** : carte « Rapport post-événement » au-dessus des actions prioritaires, activée quand `liveWindowState === "after"`.

## Tests

| Fichier                                                             | Cas | Couvre                                                                           |
| ------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------- |
| `reconciliation.service.test.ts`                                    | 8   | Grouping, refunds, failed-exclusion, distinct, platform fee, sort, lastPaymentAt |
| `post-event-report.service.test.ts`                                 | 14  | isEventFinal, attendance edge cases, demographics, comms                         |
| `cohort-export.service.test.ts`                                     | 13  | Segments, payment merging, CSV format (BOM + CRLF + quoting)                     |
| `post-event-pdf.service.test.ts`                                    | 3   | Render smoke (PDF magic, byte size, edge cases)                                  |
| `web-backoffice/components/post-event/helpers.test.ts`              | 8   | XOF formatting, FR labels                                                        |
| `web-backoffice/components/post-event/ReconciliationTable.test.tsx` | 6   | Empty / loading / populated / pills / lastPaymentAt                              |

**Counts globaux après O9** :

- Backend : 1838 tests passants (+ 38 nouveaux).
- Frontend : 299 tests passants (+ 14 nouveaux).
- Typecheck : `tsc --noEmit` clean sur `apps/api` et `apps/web-backoffice`.
- Snapshots refresh : `route-inventory` (5 lignes), `permission-matrix` (3 perms × 5 endpoints), audit-listener handler count.

## Décisions

1. **Single read-model `PostEventReport`** plutôt que N endpoints séparés. Le PDF + l'UI partagent l'agrégation pour éviter qu'ils dérivent. Coût Firestore identique (4 reads parallèles, peu importe qu'ils servent UI ou PDF).

2. **Délégation au `payout.service` existant** plutôt que dupliquer la logique de ledger sweep. La méthode `requestPayout()` calcule juste la période [first → last succeeded] et appelle `createPayout`. Audit distinct (`payout.requested` vs `payout.created`) pour qu'on puisse distinguer organizer-initié vs admin/scheduled.

3. **Pas de NPS, pas d'open/click** — la collecte n'existe pas encore. Le `CohortRow` ship un placeholder `npsBucket: null` pour la compatibilité forward. Dette explicite documentée dans les types.

4. **Démographies basées sur la donnée existante** (ticket type, zone d'accès, langue préférée) plutôt que d'ajouter des champs `gender`/`age`/`country` que personne ne remplit. Si la collecte avance, un add-only de breakdowns supplémentaires reste rétro-compatible (`DemographicBreakdownSchema` est un objet, pas une union).

5. **PDF via `pdf-lib`** (déjà installé pour receipts + badges) plutôt que puppeteer. Pas de dépendance native, déterministe, ~80 KB par PDF. Le coût en code est ~280 lignes vs un browser stack.

6. **CSV via download direct** plutôt que via signed URL Cloud Storage. La PII (noms + emails) ne mérite pas un objet stockage même 1 h ; le navigateur récupère les bytes avec son bearer token et les écrit directement.

7. **Sanitization U+202F** dans le PDF — `Number.toLocaleString("fr-FR")` émet un narrow-no-break-space en Node récent, que pdf-lib WinAnsi encoder rejette. Helper `sanitizeForWinAnsi()` documenté inline avec la liste exhaustive des caractères remplacés.

## Dette i18n connue

Les composants O9 portent toutes leurs chaînes utilisateur en français en dur, **délibérément aligné** sur les phases O1-O8 (la migration `next-intl` du back-office reste un effort cross-cutting séparé du périmètre Organizer Overhaul).

## Ce qui ne fait PAS partie d'O9

- **Email open/click rates** — la couche de tracking webhook n'est pas branchée. À ajouter quand le provider email pousse les events.
- **NPS / sondage post-event** — pas de mécanisme de collecte. À traiter dans une wave dédiée.
- **Démographies par genre / âge / pays** — pas collecté à l'inscription. Out of scope sans changement de produit.
- **Génération PDF planifiée J+24h automatique** — la spec mentionne « auto-généré J+24h » ; on livre la génération à la demande (1 clic). Le job planifié peut s'ajouter en O10 ou plus tard sans refactor.
- **Payment provider Wave/OM réel** — l'`requestPayout` crée la ligne ledger via le service existant qui reste en mode mock. Le wiring vers Wave/OM est P10 par design.

## Suite

- O10 — Event Templates, Co-organizer Shell, Speaker/Sponsor Magic-Links (5 JP).
