---
title: Documentation, Schemas & Seed Data — Comprehensive Audit
date: 2026-04-25
status: shipped
audience: maintainers, architects, demo operators
sprint: A (Sprint 1 of the 5-sprint platform overhaul)
branch: claude/docs-seed-overhaul
---

# Audit 2026-04-25 — Documentation, Schemas, Seed Data

> **Mission.** Cartographer l'état réel du repo (docs, schemas, fixtures), identifier les écarts entre code source et documentation, et arrêter le périmètre exact des Sprints B → E.

> **Méthode.** Cinq agents `Explore` en parallèle (1 par axe), recoupement avec lecture ciblée. Aucune source primaire n'a été modifiée pendant l'audit.

---

## 0 · Résumé exécutif

| Axe | Note | Verdict |
| --- | ---- | ------- |
| Documentation `docs-v2/` (canonique, Diátaxis) | A− | 65 fichiers, 93 % exacts, 13 sans `status:` |
| Documentation `docs/` (legacy) | C+ | 54 fichiers, 6 à archiver, 28 toujours actifs (runbooks, design-system, audits récents, delivery-plan) |
| ADRs (`docs-v2/20-architecture/decisions/`) | A | 7 ADRs solides + template ADR-0000 ajouté ce sprint, 8 ADRs rétroactifs à backfill |
| Schemas Firestore (53 collections) | B− | 0 schéma orphelin, mais 6 collections sans seed writer et 8 sans `match` block explicite |
| Seed data (qualité narrative) | A | Noms wolof/français authentiques, 4 paliers de plan, dates cohérentes — gros trou : 0 traduction wolof, EN minimal |
| Seed data (couverture) | B | 6 collections orphelines, `seed-reset.ts` ne touche **pas** le Storage |
| OpenAPI exposé | F | Spec compilée mais **non publiée** dans le repo ni servie par le CDN |
| Storybook `shared-ui` | F | Aucune story, 0 % de couverture visuelle |

**Quatre constats prioritaires** :

1. **`docs-v2/` est canonique mais cohabite avec `docs/`.** Risque de double-vérité. Sprint B archive 6 fichiers legacy clairement remplacés et conserve les 48 autres (runbooks vivants, audits historiques datés, plan delivery).
2. **Le seed est solide narrativement mais incomplet techniquement.** 6 collections sans writer (badges, check-ins, codes promo, coupons, redemptions, balance txns) → casse les démos check-in et facturation.
3. **`seed-reset.ts` laisse des artefacts Storage orphelins.** Reset incomplet → risque de pollution staging à chaque relance. Sprint E intègre Storage (+ Auth) dans `staging-reset.ts`.
4. **Storybook est absent.** Le design-system est documenté en markdown (`docs/design-system/`) mais sans rendu interactif. Sprint E pose les fondations + 1 story par composant `shared-ui`.

---

## 1 · Documentation

### 1.1 `docs-v2/` (canonique, Diátaxis)

- **65 fichiers**, structure numérotée 00 → 99 (getting-started, product, architecture, api, clients, operations, contributing, future, reference).
- 7 ADRs valides (0001 Cloud Run, 0002 Zod, 0003 QR v4 HKDF, 0004 ECDH X25519, 0005 deny-all rules, 0006 plan limits, 0007 Fastify layered).
- Précision de l'audit ciblé : **93 %**, aucune dérive majeure.

**Trouvailles**

| # | Fichier | Action |
|---|---------|--------|
| D1 | 13 fichiers sans frontmatter `status:` | **Sprint B** — backfill `status: shipped/partial/stub/planned` |
| D2 | 0 ADR pour 8 décisions critiques pourtant appliquées | **Sprint B** — créer ADRs 0008-0015 (cf. §2) |
| D3 | OpenAPI spec compilée mais non publiée | **Sprint B** — exporter `openapi.json` + `openapi.yaml` dans `docs-v2/30-api/openapi/` + CI build step |
| D4 | Pas de README par package (api, web-backoffice, web-participant, mobile, shared-types, shared-ui, shared-config, functions) | **Sprint B** — README minimal par package (link vers docs-v2 + scripts) |
| D5 | Pas de glossaire | **Sprint B** — `docs-v2/99-reference/glossary.md` (Teranga, organizer, co-organizer, plan, registration, badge, scan, etc.) |
| D6 | Pas de diagrammes Mermaid macro | **Sprint B** — diagramme architecture global + flow check-in + flow registration → badge |

### 1.2 `docs/` (legacy)

54 fichiers. Triage :

| Catégorie | Nb | Décision |
|-----------|----|----------|
| **KEEP** (runbooks vivants, audits historiques datés, delivery-plan, design-system, agenda-publish-design, badge-journey-review, notification suite) | 48 | Garder en place, **PAS DE MIGRATION** vers docs-v2 (audits = traces historiques, runbooks = doc op) |
| **ARCHIVE** | 6 | Déplacer vers `docs/archive/2026-04/` |
| **STALE** | 0 | — |

**Liste ARCHIVE (Sprint B)** :

1. `docs/ux-ui-audit-2026-04-07.md` — superseded par `docs/design-system/audit-2026-04-13.md`
2. `docs/delivery-plan/future-roadmap.md` — superseded par `docs/delivery-plan/wave-{1..10}-*.md` actuels
3. `docs/delivery-plan/entitlement-model-design.md` — implémenté, plan-revenue-levers-design.md le supersede
4. `docs/admin-overhaul/PLAN.md` — implémenté (admin shipped Sprint 4), garder uniquement FIDELITY-AUDIT
5. `docs/system-audit-2026-04-17.md` — superseded par audit en cours (REPORT.md, présent doc)
6. `docs/delivery-plan/plan-management-phase-7-plus.md` — fusionné dans wave-6-payments + wave-10

**Notes**

- `docs/runbooks/*.md` reste **canonique** pour les opérations (production-launch, backup-restore, scheduled-ops). Sprint B y ajoutera `staging-reset.md` (livrable Sprint E).
- `docs/api-keys.md` est référencé depuis CLAUDE.md, il est **canonique** pour les intégrateurs.

---

## 2 · ADRs (Architectural Decision Records)

### 2.1 État actuel

Sept ADRs existants, tous exacts et alignés avec le code :

| ADR | Sujet | Status |
|-----|-------|--------|
| 0001 | Cloud Run vs Cloud Functions HTTPS | accepted |
| 0002 | Zod single source of truth | accepted |
| 0003 | QR v4 HKDF design | accepted |
| 0004 | Offline sync ECDH X25519 encryption | accepted |
| 0005 | Deny-all default Firestore rules | accepted |
| 0006 | Denormalized plan limits | accepted |
| 0007 | Fastify layered architecture | accepted |

Template ADR-0000 ajouté en début de sprint (`f4274a0`).

### 2.2 ADRs rétroactifs à backfill (Sprint B)

8 décisions architecturales fortes appliquées dans le code mais non tracées :

| Nouveau # | Sujet | Justification |
|-----------|-------|---------------|
| **0008** | Soft-delete only (`status: archived/cancelled`) | Toutes les services suppriment via flag, jamais hard-delete. Décision critique pour audit + RGPD. |
| **0009** | Timestamps en ISO 8601 strings (pas Firestore `Timestamp`) | Sérialisation cohérente cross-client (web/mobile/API). |
| **0010** | Domain Event Bus pour les side effects | Pattern présent dans `apps/api/src/events/` ; toutes les mutations émettent. |
| **0011** | RBAC `resource:action` granulaire | Modèle de permissions documenté dans `permissions.types.ts`, ADR formalise le choix vs simple roles. |
| **0012** | Multi-tenancy via `organizationId` en custom claims | Décision structurante (tout le SaaS repose dessus). |
| **0013** | API Keys `terk_*` avec checksum + SHA-256 hashed storage | Implémenté T2.3, mérite son ADR (compromis ergonomie vs sécurité). |
| **0014** | Process-level error handling (graceful shutdown) | `unhandledRejection` log only, `uncaughtException` shutdown ; choix Cloud Run / SIGTERM. |
| **0015** | Trust proxy + auth-aware rate limiting | `trustProxy: true` + clé de rate-limit dérivée de `request.user`. |

**SKIP confirmé** : « francophone-first defaults » (fr / `Africa/Dakar` / `XOF`) — décision **produit**, pas architecture. Cité dans CLAUDE.md, suffisant.

---

## 3 · Schémas / Collections / Rules / Indexes

### 3.1 Drift matrix (53 collections)

| Catégorie | Nb | Détail |
|-----------|----|--------|
| Collections avec schéma + rules + seed | 39 | Sain |
| Collections sans seed writer (orphelines fixtures) | 6 | `badgeTemplates`, `checkins`, `promoCodes`, `planCoupons`, `couponRedemptions`, `balanceTransactions` |
| Collections sans `match` block (deny-all par défaut, OK mais non explicite) | 8 | `payouts`, `sessionBookmarks`, `featureFlags`, `receipts`, `subscriptions`, `notificationPreferences`, `counters`, `refundLocks` |
| Collections runtime/operator-only (couvertes par `SEED_COVERAGE_WAIVER`) | 0 nouvelle | OK |
| Schemas orphelins (Zod sans collection / collection sans Zod) | 0 | Sain |

### 3.2 Indexes (114 composites)

- **Notification dispatch log** — index sur champs nested (`metadata.audience.role`) à valider en prod : Sprint C lance `firebase firestore:indexes` + diff vs `firestore.indexes.json`.
- 0 index manifestement inutilisé d'après l'usage code.
- 0 query connue qui requiert un index manquant (vérifié par lecture des services).

### 3.3 Rules

- Deny-all top-level OK.
- 8 collections sans `match` explicite : pas un bug (deny-all par défaut), mais opacité. Sprint C ajoute des `match` documentés (`allow read, write: if false;` explicite) pour `payouts`, `featureFlags`, `counters`, `refundLocks` (vraiment Admin-only) ; les 4 autres exposent une lecture user-scopée.

---

## 4 · Seed data

### 4.1 Qualité narrative — Note A

- **Noms wolof/français authentiques** : Moussa Diop, Fatou Sall, Aminata Fall, Ousmane Ndiaye, etc.
- **4 paliers de plans** seedés : free / starter / pro / enterprise (Teranga Events SRL pro, Dakar Digital Hub starter, Startup Dakar free, Groupe Sonatel Events enterprise).
- **Dates bien réparties** : événements passés (audits historiques), présents (démo check-in live), futurs (démo registration).
- **Statuts diversifiés** : draft / published / cancelled / archived couverts.
- **Cross-references propres** via `IDS.ts` (référentiellement intact, 0 dangling).

### 4.2 Trous de couverture — Sprint C / D

| # | Trouvaille | Sprint |
|---|-----------|--------|
| S1 | 6 collections sans seed writer (cf. §3.1) | **C** |
| S2 | 0 traduction wolof côté seed (events.title.wo, etc.) | **D** |
| S3 | EN minimal (events.title.en parfois copie de fr) | **D** |
| S4 | `seed-reset.ts` ne touche PAS le Storage (artefacts orphelins persistent) | **E** |
| S5 | `seed-reset.ts` ne purge PAS les utilisateurs Auth (collisions email) | **E** |
| S6 | Coverage doc 1 commit stale | **C** (regen automatique) |
| S7 | Volume actuel : ~10 events / ~80 regs. Cible Sprint D : **~100 events / ~2000 regs** | **D** |

### 4.3 Démo readiness

Walk-through testé en lecture (sans exécuter le seed) : organizer login → 5 registrations → check-in scan → audit log → messaging. **Faisable en < 5 min en pre-seed actuel** — note A.

Manque pour la démo enterprise :

- Pas de scénario « QR scan offline → sync en différé » prêt à l'emploi.
- Pas de jeu de coupons / promo codes pré-créés.
- Pas de messages de notification dispatch (logs vides → page « Notifications » vide en démo).

Sprint D corrige tout ça en construisant 5–7 personae de démo + un walkthrough scripté `docs-v2/00-getting-started/demo-walkthrough.md`.

---

## 5 · Plan d'exécution Sprints B → E

> **Décidé avec l'utilisateur** : exécution en série, sans pause de validation. Wipe Firestore + Auth + Storage. Pas de baseline snapshot. Dataset riche. Storybook in-scope (1 story par composant).

### Sprint B — Documentation (livrables)

1. **ADRs 0008-0015** dans `docs-v2/20-architecture/decisions/` (8 fichiers, format MADR, en suivant ADR-0000).
2. **Frontmatter `status:`** ajouté aux 13 fichiers `docs-v2/` qui en manquent.
3. **OpenAPI publication** :
   - Build step `npm run docs:openapi` (export depuis Fastify Swagger).
   - Output : `docs-v2/30-api/openapi/openapi.yaml` + `openapi.json`.
   - CI guard : fail si la spec dérive de la source.
4. **Per-package READMEs** : 8 fichiers (api, web-backoffice, web-participant, mobile, functions, shared-types, shared-ui, shared-config).
5. **Diagrammes Mermaid** : architecture macro + flow registration→badge + flow check-in offline (dans `docs-v2/20-architecture/concepts/`).
6. **Glossary** : `docs-v2/99-reference/glossary.md`.
7. **Archive** : `docs/archive/2026-04/` reçoit les 6 fichiers identifiés en §1.2.
8. **Audit registry update** : ce REPORT.md + index dans `docs-v2/99-reference/audits.md`.

### Sprint C — Schémas & couverture

1. **6 seed writers** (`scripts/seed/08-badge-templates.ts`, `scripts/seed/09-checkins.ts`, `scripts/seed/10-promo-codes.ts`, `scripts/seed/11-plan-coupons.ts`, `scripts/seed/12-coupon-redemptions.ts`, `scripts/seed/13-balance-transactions.ts`).
2. **CI guard `schema-coverage.test.ts`** : check chaque collection Firestore référencée dans `COLLECTIONS` a soit un schéma + writer, soit un waiver explicite.
3. **Indexes audit script** : `scripts/audit-indexes.ts` qui compare `firestore.indexes.json` aux usages réels (regex sur les `.where(...).orderBy(...)`).
4. **Rules `match` blocks explicites** pour les 8 collections silencieuses (au moins commentaire + `allow read, write: if false;` si Admin-only).

### Sprint D — Seed v2 (rich dataset)

1. **Volume cible** :
   - 100 events (mix passé / présent / futur, 4 plans, 4 organisations).
   - 2000 registrations (réparties pour atteindre les limites starter/pro et exposer la grace period).
   - 50 sessions, 20 speakers, 10 sponsors.
   - 200 check-ins (dont 30 offline-then-synced).
   - 50 promo codes, 20 coupon redemptions.
2. **i18n** : 100 % wolof + 100 % EN sur events.title / events.description / sessions.title.
3. **5–7 personae démo** :
   - `admin@teranga.dev` (super_admin)
   - `pro@teranga.dev` (organizer pro plan)
   - `starter@teranga.dev` (organizer starter plan)
   - `free@teranga.dev` (organizer free plan, near-limit)
   - `enterprise@teranga.dev` (organizer enterprise plan)
   - `staff@teranga.dev` (scanner)
   - `participant@teranga.dev` (participant cross-events)
4. **Demo walkthrough** : `docs-v2/00-getting-started/demo-walkthrough.md` (scenarios sales + dev).

### Sprint E — Reset toolkit + Storybook

1. **`scripts/staging-reset.ts`** :
   - Couvre Firestore + Auth + Storage.
   - **3-gate confirmation** (mot-clé environnement, projet ID, phrase typed-out).
   - Mode `--dry-run` qui rapporte le volume sans écrire.
2. **Runbook** : `docs-v2/50-operations/staging-reset.md`.
3. **Storybook** :
   - Bootstrap dans `packages/shared-ui/.storybook/`.
   - **1 story par composant** (couverture complète, pas 3-5 canoniques).
   - Tokens Teranga branchés via theme provider.
   - CI build de Storybook (publication différée — Sprint E ne déploie pas).

---

## 6 · Out-of-scope explicite

- Migration de la documentation vers une plateforme externe (Mintlify, Docusaurus). Le repo reste source de vérité.
- Refonte complète du delivery-plan. Les fichiers `wave-{1..10}-*.md` restent canoniques.
- Réécriture des audits historiques. Ils sont datés et représentent un état figé.
- Internationalisation runtime web. Sprint D ajoute des traductions **dans les seeds**, pas dans l'UI Next.js.
- Migration Firestore → BigQuery / Spanner. Hors mandat.

---

## 7 · Risques & garde-fous

| Risque | Mitigation |
|--------|-----------|
| Casser la prod en testant `staging-reset.ts` | Trois gates + détection projet `teranga-events-prod` qui short-circuit. Cf. ADR-0005 (rules deny-all) qui protège déjà côté serveur. |
| Régression visuelle pendant ajout Storybook | 1 story par composant ne touche pas les composants eux-mêmes. Type-check + build doivent passer. |
| Drift CI/CD avec OpenAPI auto-généré | CI guard fail-on-diff explicite ; doc d'opération dans le runbook. |
| Volume seed × emulator timeout | Seed v2 chunké (par batches de 100 docs Firestore + commit de transactions séparées). |

---

## 8 · Annexes

- **Branche** : `claude/docs-seed-overhaul` (forkée de `origin/develop` à `1ec1b82`).
- **Commits Sprint A** :
  - `f4274a0` — `docs(adrs): add ADR-0000 template + index pointer`
  - (ce fichier) — synthèse de l'audit
- **Sources** : 5 agents `Explore` + lecture ciblée. Aucune mutation primaire pendant Sprint A.

— Fin de l'audit Sprint A. Sprint B démarre immédiatement.
