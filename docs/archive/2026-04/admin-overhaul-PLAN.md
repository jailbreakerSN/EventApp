# Admin Back-Office Overhaul — Plan d'implémentation détaillé

> **Contexte** : refonte UX/UI du back-office super-admin pour atteindre un niveau "admin-grade SaaS" comparable à Stripe Dashboard / Linear Admin / Intercom. Objectif : servir les 4 personas opérateurs (Customer Success, Ops/Platform, Finance, Product/Growth) sur une même surface, de manière discoverable, performante, et sécurisée.
>
> **Total estimé** : 40-53 JP. Découpage en 7 phases atomiques, chacune livrable indépendamment.

## Principes directeurs

1. **Task-oriented avant object-oriented** — la landing répond à "qu'est-ce qui a besoin de moi ?", pas à "voici les users".
2. **Chaque objet = liste + détail + relations** — pas de dead-end, toujours possible de drill-down.
3. **Moindre privilège** — `super_admin` unique remplacé par 5 rôles admin distincts.
4. **Audit trail complet** — chaque action admin (y compris impersonation) trace l'acteur, le rôle effectif, et la ressource.
5. **Performance** — <200ms Cmd+K, <1s inbox, pagination serveur partout.
6. **A11y WCAG 2.1 AA** — keyboard-first, ARIA partout, contraste, screen reader.
7. **Francophone-first** — strings FR par défaut, dates `Africa/Dakar`, XOF.

---

## Phase 1 — Fondations IA & navigation _(5-7 JP)_

### Périmètre

| Livrable                             | Fichiers impactés                           |
| ------------------------------------ | ------------------------------------------- |
| Sidebar admin persistante 5 sections | `components/admin/AdminSidebar.tsx` (new)   |
| Layout admin refactoré               | `app/(dashboard)/admin/layout.tsx`          |
| Cmd+K command palette scaffolding    | `components/admin/CommandPalette.tsx` (new) |
| Hook rôles admin                     | `hooks/use-admin-role.ts` (new)             |
| Routes redirigées sous nouvelle IA   | redirections 301 server-side                |

### Structure de la sidebar

```
┌──────────────────────────┐
│ Teranga Admin            │
├──────────────────────────┤
│ 📥  Ma boîte             │  /admin/inbox
│ 📊  Vue d'ensemble       │  /admin/overview
├── CLIENT ───────────────-│
│ 👥  Utilisateurs         │  /admin/users
│ 🏢  Organisations        │  /admin/organizations
│ 🎪  Événements           │  /admin/events
│ 📍  Lieux                │  /admin/venues
├── BILLING ──────────────-│
│ 💳  Plans                │  /admin/plans
│ 🧾  Abonnements          │  /admin/subscriptions
│ 💰  Revenus              │  /admin/revenue
├── PLATFORM ─────────────-│
│ 🔔  Notifications        │  /admin/notifications
│ 🪝  Webhooks             │  /admin/webhooks
│ ⚙️   Jobs                │  /admin/jobs
│ 🚩  Feature flags        │  /admin/feature-flags
│ 🔑  Clés API             │  /admin/api-keys
│ 📜  Audit                │  /admin/audit
├── SETTINGS ──────────────│
│ 👤  Équipe admin         │  /admin/settings/team
│ 📢  Annonces             │  /admin/settings/announcements
└──────────────────────────┘
```

### DoD Phase 1

- [ ] Sidebar rendue sur toutes les routes `/admin/*`
- [ ] État collapsed/expanded persisté en localStorage
- [ ] Cmd+K ouvre un modal qui cherche cross-object (stub OK, vraie recherche en Phase 5)
- [ ] Breadcrumbs standardisés via shared-ui `<Breadcrumb>` sur chaque page
- [ ] Header admin affiche l'identité + rôle effectif actuel
- [ ] Tests : 1342 API + web-backoffice lint clean

---

## Phase 2 — Inbox admin _(4-5 JP)_

### Périmètre

Nouvelle route `/admin/inbox` (remplace l'ancien `/admin` qui devient `/admin/overview`).

### Sections

| Section         | Signal                                         | Source API                                                                               |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Modération**  | Venues pending, orgs en KYB                    | `/v1/admin/venues?status=pending`, `/v1/admin/organizations?isVerified=false`            |
| **Comptes**     | Users drift JWT, invites expirés à nettoyer    | `/v1/admin/users` (filtre clientSide sur `claimsMatch`), `/v1/invites?status=expired`    |
| **Billing**     | Paiements pending >24h, subscriptions past_due | `/v1/admin/payments?status=pending`, `/v1/admin/subscriptions?status=past_due` (nouveau) |
| **Ops**         | Webhooks failed, bounce rate email anormal     | `/v1/admin/webhooks/failed` (nouveau), `/v1/admin/notifications/stats`                   |
| **Events live** | Events en cours avec anomalies                 | `/v1/admin/events?status=published&startDate<now<endDate`                                |

### UI pattern

```tsx
<InboxCard
  severity="warning"
  icon={<AlertTriangle />}
  title="3 venues en attente de modération"
  description="Soumis il y a 2-5 jours"
  cta={{ label: "Modérer", href: "/admin/venues?status=pending" }}
  count={3}
/>
```

Section "✓ Tout va bien" visible quand 0 alerte (évite l'angoisse de la page vide).

### DoD Phase 2

- [ ] Inbox charge en < 1s (queries parallélisées, React Query)
- [ ] Chaque CTA navigue avec les filtres pré-appliqués dans l'URL
- [ ] Auto-refresh toutes les 60s
- [ ] Section de succès quand tout est vert

---

## Phase 3 — Pages détail objet + relations _(7-9 JP)_

### Pages à créer

| Route                         | Onglets                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `/admin/organizations/[id]`   | Overview, Membres, Événements, Abonnement, Factures, Webhooks, Audit |
| `/admin/users/[id]`           | Overview, Organisations, Inscriptions, Sessions bookmarkées, Audit   |
| `/admin/events/[id]`          | Overview (read-only + actions admin), Participants, Paiements, Audit |
| `/admin/venues/[id]`          | Overview, Événements hébergés, Audit lifecycle                       |
| `/admin/plans/[id]/overrides` | **Nouvel onglet** : orgs qui utilisent ce plan + overrides actifs    |

### Composant partagé

`<EntityDetailLayout>` qui normalise header (nom + status pill + quick actions) + breadcrumb + tabs + URL state.

### DoD Phase 3

- [ ] Breadcrumbs complets (`Admin > Organizations > Teranga Events > Members`)
- [ ] Tabs URL-driven (`?tab=members` survive reload)
- [ ] Quick actions dans header (Suspend, Verify, Impersonate owner…)
- [ ] Chaque onglet paginé 20/page, empty state custom

---

## Phase 4 — Impersonation + rôles admin granulaires _(6-8 JP)_

### Backend

#### Rôles admin

Extension de `SystemRoleSchema` dans `permissions.types.ts` :

```ts
"platform:super_admin" |
  "platform:support" |
  "platform:finance" |
  "platform:ops" |
  "platform:security";
```

Mapping permissions (exhaustif, ~50 lignes) :

```ts
"platform:support": ["user:read", "user:impersonate", "org:read", "audit:read"],
"platform:finance": ["org:read", "subscription:*", "payment:*", "invoice:*"],
"platform:ops":     ["job:run", "webhook:replay", "feature_flag:*", "audit:read"],
...
```

#### Impersonation

- Route `POST /v1/admin/users/:uid/impersonate` (require `user:impersonate`)
- Mint custom token Firebase avec `customClaims: { impersonatedBy: <adminUid>, expiresAt: now+30min }`
- Audit log `user.impersonated` avec `resource: uid cible`, `actor: admin`, `duration: 30min`
- Route `POST /v1/admin/impersonation/end` pour révoquer la session
- Chaque page du site checks le claim `impersonatedBy` et affiche le banner

#### Frontend

- **Banner persistante** sur TOUT le site (dans `(dashboard)/layout.tsx`) :
  ```
  ⚠️  Vous êtes connecté en tant que Alice Dupont (alice@teranga.dev)  [Quitter →]
  ```
- Bouton "Se connecter en tant que" sur `/admin/users/[id]` (gated par `user:impersonate`)
- Hook `useImpersonation()` pour savoir si on est dans une session

#### Page admin team

`/admin/settings/team` — liste des admins, leurs rôles, last-seen. Pour super_admin : changer les rôles.

### DoD Phase 4

- [ ] Un `platform:support` peut impersonate et voir, mais ne peut pas modifier un plan (403 testé)
- [ ] Chaque action admin audit-log inclut `actorRole` en plus d'`actorId`
- [ ] Banner d'impersonation visible sur web-backoffice ET web-participant
- [ ] Session d'impersonation expire en 30 min et réinvite à se reconnecter normalement

---

## Phase 5 — Enrichissement des listes (bulk, export, saved views) _(5-7 JP)_

### Bulk selection

- `<BulkSelectTable>` HOC qui wrap `<DataTable>` avec checkbox col + sélection range (shift+click)
- Menu "Actions" contextualisé (Suspend, Delete, Notify, Export sélection)
- Toutes les bulk ops = modal confirm avec compteur + audit log dédié

### Export

- Format pivot server-side : `GET /v1/admin/<resource>?format=csv` streaming
- Endpoints CSV : users, organizations, events, venues, audit logs, subscriptions, invites
- Filtres de la querystring respectés (export respecte la vue filtrée)

### Saved views

- Serializer URL state → localStorage item `admin:savedViews:<resource>:<name>`
- Sidebar "Mes vues" par ressource
- Partage : URL absolue avec tous les filtres encodés

### Keyboard nav

- `useKeyboardNav()` hook sur les tables : j/k (ligne suivante/précédente), Enter (ouvre détail), Esc (ferme modal), / (focus search)

### DoD Phase 5

- [ ] Bulk suspend de 50 users = 1 modal + 1 click
- [ ] Export CSV 1000 orgs streaming sans timeout
- [ ] Saved view partageable via URL entre 2 admins
- [ ] j/k/Enter/Esc fonctionnent sur toutes les tables

---

## Phase 6 — Capacités opérationnelles manquantes _(8-10 JP)_

### Surfaces

#### `/admin/webhooks`

- Liste des webhooks outbound (Resend, mobile payment providers, FCM)
- Status (healthy/degraded/failing), last success, last failure
- Drill-down `/admin/webhooks/[id]` : liste des dispatches, retry button, payload inspector

#### `/admin/jobs`

- Triggers one-shot : seed staging, backfill ledger, reindex, dry-run
- Historique des runs (succès/échec, durée, actor)
- Gated par `job:run` permission

#### `/admin/feature-flags`

- Liste des flags déclarés (schéma Zod dans shared-types)
- On/off global + % rollout + scope (global/org/user)
- Drill-down `/admin/feature-flags/[key]` : audit log des changements, cohorts affectés
- Runtime : hook `useFeatureFlag(key)` qui lit Firestore avec cache 30s

#### `/admin/api-keys`

- Pour orgs enterprise (feature `apiAccess`)
- Create/rotate/revoke, scope (read-only / read-write / admin), last-used timestamp
- Prefix visible (sk_live_xxxx...) + full key montré UNE SEULE fois à la création

#### `/admin/settings/announcements`

- CRUD banner platform-wide (titre, body, severity, audience, schedule)
- Target : all | organizers | participants | per-plan
- Dismissible par user (stocké localStorage côté client)

### DoD Phase 6

- [ ] Webhook Wave échoué rejouable depuis UI sans SSH
- [ ] Flag "new-feature-X" activable à 10% des orgs sans deploy
- [ ] Clé API enterprise crée → copy-once token, rotate visible, last-used live
- [ ] Banner announcement visible en 1 deploy (pas de code push)

---

## Phase 7 — Polish, observabilité, business dashboards _(5-7 JP)_

### Revenue dashboard

`/admin/revenue` — MRR, ARR, NRR, churn, breakdown par plan, cohort retention (12 derniers mois).

Charts : ligne (MRR évolution), bar (revenu par plan), funnel (trial → paid), tableau (top orgs par revenu).

### Audit log v2

- Full-text search sur `details` JSON
- Timeline view chronologique avec groupement par jour
- Filtres chainables (actor, resourceType, action, date range, org)
- Export CSV avec toutes les colonnes
- Drill-down vers la ressource : click sur `resourceId` → navigation

### Anomaly widgets (inbox)

- Signups anormaux (même IP, patterns bot, email jetables)
- Checkins anormaux (double-scan excessif, scanner device neuf)
- Paiements suspects (montant atypique, même carte)

### Empty / loading / error states

Audit systématique + refonte de chaque page pour standardiser via shared-ui components.

### A11y pass

- Tab order vérifié au clavier
- ARIA labels sur tous les interactive elements
- Contraste WCAG AA (teranga-gold sur fond clair notamment)
- Screen reader test avec VoiceOver/NVDA

### Performance

- Code-splitting du chunk admin (dynamic imports)
- Prefetch des détail pages sur hover
- React Query cache 30s par défaut
- Lighthouse target : Performance 90+, A11y 95+

### DoD Phase 7

- [ ] MRR visible en 1 clic sur `/admin/revenue`, exportable
- [ ] Audit recherche "paiement > 50k XOF" → 12 events en <500ms
- [ ] Inbox montre anomalies quand détectées, zero noise sinon
- [ ] Lighthouse admin ≥90 Performance, ≥95 A11y

---

## Séquencement & parallélisation

```
Phase 1 (fondations)
   │
   ├──► Phase 2 (inbox) ───┐
   │                       │
   └──► Phase 3 (détail) ──┤
                           │
                   ┌───────┴────────┐
                   │                │
                   ▼                ▼
              Phase 4 (RBAC)  Phase 5 (bulk/export)
                   │
                   ▼
              Phase 6 (ops surfaces)
                   │
                   ▼
              Phase 7 (polish)
```

Sur 2 développeurs :

- Dev A : P1 → P2 → P4 → P6
- Dev B : P3 → P5 → P7

Délai : 4-5 semaines au lieu de 8-11.

---

## Mesures de succès

| KPI                                                            | Cible                         |
| -------------------------------------------------------------- | ----------------------------- |
| Temps pour trouver un user par email                           | <3s (aujourd'hui ~15s)        |
| Temps pour onboarder un nouveau client                         | <2min (aujourd'hui ~10min)    |
| Nombre d'actions admin par jour                                | +30% (signal de productivité) |
| Incidents support liés à "je ne comprends pas ce qui se passe" | -50%                          |
| Satisfaction équipe ops (sondage qualitatif)                   | 4/5+                          |
| Lighthouse A11y admin                                          | ≥95                           |

---

## Risques & mitigations (rappel)

| Risque                             | Mitigation                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| Impersonation mal-sécurisée        | Custom token 30min + banner + audit + révocation                |
| Feature flags complexité           | Boolean platform-wide d'abord, targeting avancé Phase 2         |
| Bulk actions = risque opérationnel | Modal confirm obligatoire, soft-delete, undo 30j                |
| Export massif = pression Firestore | Streaming + quotas + background job >10k                        |
| RBAC = migration auth              | Dual-check transitoire, super_admin → platform:super_admin auto |
| Cmd+K = cost queries               | Cache 30s + debounce 200ms + top-N                              |
