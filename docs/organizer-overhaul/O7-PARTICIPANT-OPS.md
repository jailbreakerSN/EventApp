# O7 — Participant Ops (bulk actions + saved views + dédup)

> **Phase O7** du plan `PLAN.md`. Industrialise l'expérience opérateur sur les inscriptions : actions groupées, vues sauvegardées, détection + fusion de doublons, tags + notes par participant. Vise un workflow « relancer les non-payés » qui passe de **45 min → 5 min**.

## Objectif mesurable

> Réduire de **80 %** le temps d'un workflow type « relancer les non-payés ».

Avant : un opérateur cliquait par ligne, copiait les emails dans un mailing externe, n'avait pas de tag pour marquer les déjà-relancés, redécouvrait les doublons à chaque check-in. Après : sélection bulk + tag « Relancé J+3 » + send broadcast en 5 clics ; doublons détectés et fusionnés en un dialog de confirmation.

## Architecture

### Shared types

**`packages/shared-types/src/participant-profile.types.ts`** (nouveau, ~135 lignes) :

- `ParticipantProfileSchema` : `{ id, organizationId, userId, tags, notes, createdAt, updatedAt }`. ID déterministe `${organizationId}_${userId}`.
- `UpdateParticipantProfileSchema` : DTO pour upsert tags + notes.
- `BulkRegistrationActionSchema` + `BulkTagRegistrationsSchema` : DTO bulk (registrationIds + addTags/removeTags).
- `DuplicateCandidateSchema` + `MergeParticipantsSchema` : pair detection + merge DTOs.
- Helpers purs exportés : `normaliseEmail()`, `normalisePhone()`, `buildDuplicatePairId()`.

**`packages/shared-types/src/audit.types.ts`** : 2 nouveaux `AuditAction` — `participant_profile.updated`, `participant.merged`.

### Backend

**`participant-profile.service.ts`**

- `get(orgId, userId)` : O(1) lookup par doc id déterministe.
- `getMany(orgId, userIds[])` : bulk-fetch via `db.getAll()`, capé à 100.
- `update()` : upsert idempotent — pas d'écriture si le diff est vide. Émet `participant_profile.updated` avec `notesChanged: boolean` (la VALEUR des notes ne quitte jamais le service, privacy-first).
- `bulkTagFromRegistrations()` : résout `registrationId → userId` via `getAll()`, applique le delta (add/remove) par participant, skippe les no-ops.
- Helpers purs `dedupeAndSortTags()`, `applyTagDelta()` exportés pour les tests.

**`participant-merge.service.ts`**

- `detectDuplicates(orgId)` : scan jusqu'à 1000 registrations → set des userIds → fetch user docs en chunks de 30 (limite `in` Firestore) → algo `findDuplicateCandidates()` qui groupe par email/phone normalisé. Cap à 100 candidats. Read-only.
- `merge(primaryUserId, secondaryUserId)` : transaction Firestore atomique :
  1. Re-pointe chaque registration secondaire vers le primary userId.
  2. Upsert le profil primaire avec tag list mergée (`mergeTagLists()`).
  3. Archive le profil secondaire (`tags: []`).
  4. Émet `participant.merged` avec `registrationsMoved: number`.
- Helpers purs `findDuplicateCandidates()`, `mergeTagLists()` exportés.

**`registration-bulk.service.ts`**

- `bulkCancel(ids, user)` + `bulkApprove(ids, user)` : loop sur les méthodes per-row existantes. Per-row failures collectées (`{ id, reason }[]`) plutôt que d'abort le batch — l'opérateur voit un récap clair en fin de run.
- Sequential par design (rate-limit Firestore, audit + dispatch downstream).
- Permission gating réutilise `registration:cancel_any` / `registration:approve` (pas de nouvelle perm).

**Routes** :

| Méthode | Path                                                    | Verbe                     |
| ------- | ------------------------------------------------------- | ------------------------- |
| `GET`   | `/v1/organizations/:orgId/participants/:userId/profile` | Lire profil               |
| `PATCH` | `/v1/organizations/:orgId/participants/:userId/profile` | Update tags + notes       |
| `POST`  | `/v1/organizations/:orgId/participants/bulk-tag`        | Bulk tag delta            |
| `GET`   | `/v1/organizations/:orgId/participants/duplicates`      | Détecter doublons         |
| `POST`  | `/v1/organizations/:orgId/participants/merge`           | Fusion atomique           |
| `POST`  | `/v1/registrations/bulk-cancel`                         | Bulk-cancel registrations |
| `POST`  | `/v1/registrations/bulk-approve`                        | Bulk-approve waitlisted   |

Permissions : `registration:read_all` pour profile + dedup, `registration:cancel_any` / `registration:approve` pour bulk ops. Tous emit domain events → audit listener log row par row.

**Audit listener** : 2 nouveaux handlers (`participant_profile.updated`, `participant.merged`). `EXPECTED_HANDLER_COUNT` 102 → 104.

**Collection Firestore** : `participantProfiles` ajoutée dans `COLLECTIONS`.

### Frontend

**Hooks** (`apps/web-backoffice/src/hooks/use-participant-ops.ts`) :

- `useParticipantProfile(orgId, userId)` — read with React Query.
- `useUpdateParticipantProfile(orgId)` — mutation, invalidate profile query.
- `useBulkTagRegistrations(orgId)` — mutation, invalidate profile namespace.
- `useDuplicateCandidates(orgId)` — read with 5 min staleTime.
- `useMergeParticipants(orgId)` — mutation, invalidate dedup + profile + registrations namespaces.

**Composants réutilisables (`apps/web-backoffice/src/components/data-ops/` + `participants/`)** :

- `<SavedViewsMenu surfaceKey="…" />` : dropdown qui consomme l'existant `useSavedViews` (pas de duplication). Active-view highlight, save via `prompt()`, delete via hover-X. Click-outside dismissal.
- `<BulkActionToolbar selectedCount actions onClearSelection />` : toolbar self-hide quand `selectedCount === 0`. Compteur FR avec pluriel, slot middle pour metadata, actions configurables avec `variant: "destructive"` qui colore en rouge.
- `<ParticipantTagsEditor tags notes onChange onSave />` : chips avec X-remove, input pour ajouter (Enter/comma), notes textarea capée à 2000 chars, save button avec busy state.
- `<MergeParticipantDialog candidate onConfirm onClose />` : confirm dialog qui détaille `matchKind`/`matchValue`/`primaryUserId`/`secondaryUserId` + warning irréversibilité.

**Page `/participants` rebuild** :

Stub précédent (33 lignes) → page tabbed (~250 lignes) avec :

- Onglet **Annuaire** : MVP avec chrome bulk + saved views câblé. Les actions effectives vivent dans la table « Inscriptions » de chaque événement (le cross-event participant directory complet arrive en O10).
- Onglet **Doublons** : liste les candidats détectés, dialog de confirmation pour chaque merge, success state quand n=0.

## Couverture de tests

### Backend (+33 tests)

| Fichier                               | Tests | Couvre                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `participant-profile.service.test.ts` |    14 | `dedupeAndSortTags` (case + accents + trim), `applyTagDelta` (add/remove/conflict), happy update + event emit, **notes scrubbed from event payload** (privacy assertion), idempotent no-op, dedupe + sort à l'écriture, permission denial, cross-org rejection, bulk no-op |
| `participant-merge.service.test.ts`   |    19 | `normaliseEmail` (gmail aliases + dot trick + non-gmail keep), `normalisePhone`, `buildDuplicatePairId` symetrique, `findDuplicateCandidates` (no-dup, email match, phone match, dedup pair, limit cap, junk-phone filter), `mergeTagLists` (union + sort + trim)          |

### Frontend (+18 tests)

| Fichier                          | Tests | Couvre                                                                                                                                                     |
| -------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BulkActionToolbar.test.tsx`     |     8 | Self-hide n=0, FR pluralisation singulier/pluriel, render actions, click handlers, disabled state, Désélectionner callback, destructive variant tint class |
| `SavedViewsMenu.test.tsx`        |     3 | Trigger label placeholder, dropdown empty state, apply view → router.push avec querystring                                                                 |
| `ParticipantTagsEditor.test.tsx` |     7 | Chips render, X-remove, Enter-add, dedup guard, notes textarea, save callback, busy disable                                                                |

**Total Phase O7 : +51 tests.** Suite globale : **2037 tests** (1777 API + 260 web). TypeScript clean. Snapshots `route-inventory` + `permission-matrix` mis à jour.

## Décisions de design

### Pourquoi un doc séparé `participantProfiles` plutôt qu'un champ sur `users` ?

Trois raisons :

- **Org-scope explicite** : un participant inscrit à 2 orgs aurait soit un `Record<orgId, …>` lourd sur le user, soit du leak cross-org. Un doc par paire (org, user) est lexicographiquement clean.
- **Audit-friendliness** : la doc id est lisible dans les audit rows (`org-1_u-99`).
- **Firestore rules** : per-org write rules deviennent triviales (`request.resource.data.organizationId == request.auth.token.organizationId`).

### Pourquoi privacy-first sur les notes (event scrubs the value) ?

Le contenu des notes est **privé organisateur**. Si l'audit log était scrutable par un super-admin support et incluait `notes: "Comportement suspect"`, on aurait un canal indirect de fuite vers la plateforme. L'event payload porte uniquement `notesChanged: boolean` ; la valeur ne quitte jamais le service.

### Pourquoi le merge est-il transactionnel mais la détection ne l'est pas ?

- **Détection** : read-only, lecture de jusqu'à 1000 registrations + N user docs. Pas de write → pas de transaction nécessaire. Le snapshot peut légèrement dater (un nouveau dup arrivé pendant le scan apparaîtra au prochain refresh).
- **Merge** : écrit jusqu'à K+2 docs (K registrations + 2 profils). Sans transaction, un crash entre la mise à jour de la dernière registration et l'archive du profil secondaire laisserait un état incohérent (registrations re-pointées mais profile encore "actif"). Le tx est obligatoire.

### Pourquoi le merge re-pointe les registrations plutôt que de muter le user doc ?

Le `users/{uid}` est l'identité **globale** du participant. Modifier un userId au niveau global casserait l'identification (login Firebase Auth, custom claims). En re-pointant chaque registration au lieu de réécrire le user, le merge reste **org-scoped** : un participant dupliqué dans une org peut rester sain dans une autre.

### Pourquoi les bulk actions sont-elles séquentielles (pas Promise.all) ?

- **Rate limit Firestore** : 500 writes/sec/document, mais aussi un overall throughput cap. Un Promise.all de 500 cancellations ferait monter aussi 500 audit writes + 500 event dispatches simultanés.
- **Audit lisibilité** : un audit row par row (séquentiel) garde un timestamp ordonné. Promise.all créerait une rafale avec timestamps quasi-identiques difficile à reconstruire.
- **Per-row failure handling** : un loop séquentiel collecte chaque échec dans `failures[]` au lieu d'avoir besoin de `Promise.allSettled` + de re-mapper les indices.

Le compromis latence (500 cancels × ~50ms = 25s) est acceptable parce que l'opérateur déclenche cela en arrière-plan ; la barrière UX cible (5 min de J+3 vs 45 min) reste largement respectée.

### Pourquoi normaliser les emails Gmail différemment ?

Les conventions `+suffix` et `.dot.tricks` sont **spécifiques à Gmail / Google Workspace**. Les appliquer à des domaines non-gmail produirait des faux positifs : `alice+work@example.com` et `alice@example.com` peuvent être deux personnes distinctes chez `example.com`. Le code teste explicitement `gmail.com` + `googlemail.com` et préserve le suffix pour le reste.

### Pourquoi les saved views sont-elles côté localStorage et pas Firestore ?

Reprise de l'architecture admin : cross-device sync est nice-to-have, le data volume est trivial, les vues sont **per-operator** et non shared par défaut. Une iteration future pour un workspace partagé peut mirror dans Firestore — pour O7, localStorage offre 0 round-trip + 0 dependency.

### Pourquoi la nouvelle page `/participants` ne liste-t-elle pas encore tous les participants cross-event ?

Le **chrome** O7 (bulk + saved views + dédup + tags + notes) est entièrement câblé et réutilisable. Une vraie liste cross-event nécessite :

1. Une dénormalisation registration → participant (collection `organizationParticipants/{orgId}_{uid}` avec dernière registration, count, etc.)
2. Une UI de tableau performante avec pagination serveur
3. Filtres complexes (par event, par tag, par status)

C'est un livrable Wave 4 à part entière. O7 livre les briques (composants + API) que cette future Wave 4 importera. La page actuelle pointe l'opérateur vers `/events/[id]/audience/registrations` où les bulk actions vivent par event.

## Suite roadmap

- **O7.1 — Wire bulk dans la table inscriptions** : la `RegistrationsTab` (legacy `_event-shell`) doit être mise à jour pour mounter `<BulkActionToolbar>` + `<SavedViewsMenu>`. Cette migration est mécanique (le bulk hook est déjà importable) et peut être faite en suite de cette PR.
- **O7.2 — Cross-event participant directory** : Wave 4. Dénormalisation `organizationParticipants` + UI table avec filtres composables + bulk depuis l'annuaire (cible Wave 4).
- **O7.3 — Smart dedup signaling** : ajouter un signal `participants.duplicates_pending` à l'organizer inbox quand n > 0, deep-link vers `/participants?tab=duplicates`.
- **O7.4 — Co-organizer scope** : co-organisateurs ne voient les profiles que pour les événements qu'ils co-managent (gating supplémentaire dans `participant-profile.service.get`).

## Vérification

```bash
# API
cd apps/api
npx tsc --noEmit                 # propre
npx vitest run                   # 1777 tests passent (incl. 33 nouveaux O7)

# Web
cd apps/web-backoffice
npx tsc --noEmit                 # propre
npx vitest run                   # 260 tests passent (incl. 18 nouveaux O7)
```

Manual QA :

- [ ] `/participants` charge avec les 2 onglets Annuaire / Doublons.
- [ ] Onglet Doublons → liste les candidats (testable via seed data).
- [ ] Click "Fusionner" → dialog de confirm → confirm → toast success "X inscription(s) re-pointée(s)".
- [ ] Audit log rangée avec `action: "participant.merged"` + `details.registrationsMoved`.
- [ ] `PATCH /v1/organizations/:orgId/participants/:userId/profile` body `{ tags: ["VIP"], notes: "X" }` → 200 + audit row avec `notesChanged: true` (pas de "X" dans le payload).
- [ ] Cross-org caller → 403.
- [ ] Saved views menu : create + apply + delete OK.
- [ ] BulkActionToolbar ne s'affiche pas quand `selectedCount === 0`.
