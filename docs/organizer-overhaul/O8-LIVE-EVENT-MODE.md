# O8 — Live Event Mode (Floor Ops)

> **Phase O8** du plan `PLAN.md`. Donne à l'organisateur un **vrai poste de contrôle plein-écran** pour le J-0 : indicateurs temps réel (cadence des scans, file estimée, no-show, staff en ligne), registre d'incidents, radio staff temps réel, et un canal d'alerte d'urgence multi-canaux. L'objectif : **réduire le « zapping » entre 5 onglets** pendant un événement live.

## Objectif mesurable

> Pendant un événement, l'organisateur ne doit plus quitter une seule surface — **tout** ce qui est nécessaire au pilotage temps réel se trouve sur `/events/[id]/live`.

Avant : organisateur jonglait entre /overview (santé), /audience/registrations (file), /communications (alerte), /messaging (radio interne). Après : un dashboard unique avec polling 60 s + Firestore realtime + alerte d'urgence à 2 clics + log d'incidents en place.

## Architecture

### Shared types

**`packages/shared-types/src/live-ops.types.ts`** (nouveau, ~170 lignes) :

- `IncidentSchema` + `IncidentKindSchema` (medical / theft / latecomer / technical / logistics / security / other) + `IncidentSeveritySchema` (low / medium / high / critical) + `IncidentStatusSchema` (open / triaged / in_progress / resolved).
- `CreateIncidentSchema` + `UpdateIncidentSchema` : DTO pour log + triage.
- `StaffMessageSchema` + `CreateStaffMessageSchema` : radio interne, append-only par design.
- `EmergencyBroadcastSchema` : titre (≤ 120) + body (≤ 500, contraintes SMS/push) + canaux + motif (audit obligatoire).
- `LiveStatsSchema` : agrégation read-only — scanRate (30 buckets/min), queueEstimate, noShowEstimate, staffOnline, incidentsByStatus.

**`packages/shared-types/src/audit.types.ts`** : 5 nouveaux `AuditAction` — `incident.created`, `incident.updated`, `incident.resolved`, `emergency_broadcast.sent`, `staff_message.posted`.

### Backend

**`incident.service.ts`** (~170 lignes)

- `create()` : permission `checkin:scan` (le staff sur le terrain peut logger sans droits organisateur). Persiste un row, émet `incident.created`.
- `list()` : permission `checkin:view_log`. Filtre par `status`, ordre `createdAt desc`, cap 200 rows.
- `update()` : permission `event:update` (seul l'organisateur fait avancer le workflow). **Read-then-write atomique via `db.runTransaction()`** — deux organisateurs triant le même incident en même temps verraient sinon une émission `incident.resolved` dupliquée (faux SLA log). Calcule `durationMs` si transition vers `resolved`, émet `incident.updated` + `incident.resolved` (privacy-first : `resolutionNoteChanged: true` au lieu de la valeur).
- Tests : 6 cas — create/update happy paths, permission denial, cross-org rejection, NotFound, durationMs > 0, no-emit on non-resolution updates.

**`staff-message.service.ts`**

- `post()` : permission `checkin:scan`. Append-only — pas d'edit / delete (audit + simplicité cognitive). Émet `staff_message.posted` (id seul, pas le body) pour la traçabilité forensique.
- `list()` : limite 200, ordre desc.
- Privacy : `authorName` denormalisé pour éviter N+1 fetch côté UI.

**`emergency-broadcast.service.ts`**

- `send()` : permission `broadcast:send` (= organisateur). Wrappe le service `broadcast.service` existant avec :
  - **canaux verrouillés** : `push` + `sms` toujours forcés (`mergeChannels()` exporté pour les tests).
  - WhatsApp ajouté **seulement** si plan + opt-in autorisent.
  - **motif obligatoire** : champ `reason` non vide → audit forensique.
- Émet `emergency_broadcast.sent` + `broadcast.sent` (deux events, deux audits — l'urgence est tracée à part même si l'audit broadcast régulier est trimmé).
- Helpers purs : `mergeChannels()` (5 cas testés).

**`live-stats.service.ts`** (~220 lignes)

- `getStats()` : permission `checkin:view_log`. 7 agrégations en parallèle via `Promise.all`, partial-failure tolerance via `safeCount()` (mêmes ergonomics que l'inbox O2).
- Helpers purs exportés et testés isolément :
  - `bucketScanRate()` : bucketing 30 minutes en slots de 1 min, zero-fill.
  - `countDistinctAuthors()` : distinct des authorIds (proxy "staff online").
  - `computeNoShowEstimate()` : 0 avant fin d'événement, `registered - checked-in` après.
- 60 s staleTime + refetchInterval côté React Query : pas plus de lookups que nécessaire.

### Routes

**`apps/api/src/routes/live-ops.routes.ts`** — 7 endpoints sous `/v1/events/:eventId/live` :

| Méthode | Path                   | Permission       | Notes                                     |
| ------- | ---------------------- | ---------------- | ----------------------------------------- |
| GET     | `/stats`               | (service-side)   | Polling 60 s                              |
| POST    | `/incidents`           | `checkin:scan`   | Staff terrain peut logger                 |
| GET     | `/incidents`           | (service-side)   | Filtre `?status=`                         |
| PATCH   | `/incidents/:id`       | `event:update`   | Triage + résolution                       |
| POST    | `/staff-messages`      | `checkin:scan`   | Append-only                               |
| GET     | `/staff-messages`      | (service-side)   | Cold-start fallback (UI préfère realtime) |
| POST    | `/emergency-broadcast` | `broadcast:send` | Canaux verrouillés                        |

Snapshots `route-inventory.test.ts.snap` + `permission-matrix.test.ts.snap` mis à jour. Tous les routes mutateurs portent `requirePermission` au niveau route (pas seulement service) pour passer l'invariant de l'inventaire.

### Domain events + audit listener

**`apps/api/src/events/listeners/audit.listener.ts`** : 5 nouveaux handlers — `incident.created`, `incident.updated`, `incident.resolved`, `emergency_broadcast.sent`, `staff_message.posted`. `EXPECTED_HANDLER_COUNT` passé à 109.

**Privacy-first** :

- L'audit `incident.updated` ne porte que `notesChanged: true`, jamais le contenu.
- L'audit `emergency_broadcast.sent` porte le motif (obligatoire pour la traçabilité légale) mais pas le body.
- L'audit `staff_message.posted` porte uniquement `messageId` (pas le body) — la radio interne est privée par design ; l'id permet la modération forensique sans diffuser les échanges en clair dans l'audit log.

### Frontend

#### Hooks

**`apps/web-backoffice/src/hooks/use-live-ops.ts`** : 7 hooks React Query :

- `useLiveStats(eventId)` : polling 60 s + refetchInterval, staleTime 60 s.
- `useIncidents(eventId, status?)` : filtré, staleTime 15 s.
- `useCreateIncident` / `useUpdateIncident` : mutations + invalidations (`incidents` + `live-stats`).
- `useStaffMessages(eventId, limit)` : cold-start fallback REST.
- `usePostStaffMessage` : mutation + invalidation `staff-messages`.
- `useEmergencyBroadcast` : mutation + invalidation `comms-timeline` + `broadcasts` (l'urgence apparaît dans la frise O5).

**`apps/web-backoffice/src/hooks/use-staff-radio-stream.ts`** : Firestore `onSnapshot` listener temps réel pour `staffMessages` (mêmes ergonomics que `use-notification-live-stream` Wave 4). State local — la cache REST sert uniquement au cold-start (« connexion… »).

#### Composants

| Composant                    | Rôle                                         | Fichier                                            |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `<ScanRateChart>`            | Sparkline SVG 30 min (cadence scans/min)     | `components/live-ops/ScanRateChart.tsx`            |
| `<IncidentLog>`              | Liste filtrée + form de création + triage    | `components/live-ops/IncidentLog.tsx`              |
| `<StaffRadio>`               | Chat realtime, auto-scroll + jump-to-bottom  | `components/live-ops/StaffRadio.tsx`               |
| `<EmergencyBroadcastDialog>` | Dialog 2 étapes (compose → confirm DIFFUSER) | `components/live-ops/EmergencyBroadcastDialog.tsx` |
| Helpers purs                 | `formatElapsed`, `formatTime`                | `components/live-ops/helpers.ts`                   |

**Décisions de design** :

- **Pas de librairie graphique** — pure SVG. Cohérent avec O3 (`PacingChart`) et O5 (`CommsTimeline`).
- `<StaffRadio>` auto-scroll **seulement si l'utilisateur est près du bas** ; sinon affiche un pill « ↓ Nouveaux messages » non-intrusif.
- `<IncidentLog>` keyboard-friendly : ⌘/Ctrl+Enter envoie le formulaire (les opérateurs gardent les mains sur le clavier en pleine action).
- `<EmergencyBroadcastDialog>` deux étapes + saisie de la phrase `DIFFUSER` — friction intentionnelle, ce bouton ne doit jamais être tapé par accident pendant un événement live.
- Les canaux `push` + `sms` sont **verrouillés** côté UI (cases désactivées) ET côté serveur (defense in depth).

#### Page `/events/[eventId]/live`

**`apps/web-backoffice/src/app/(dashboard)/events/[eventId]/live/page.tsx`** :

```
┌────────────────────────────────────────────┐
│ Header : titre · LIVE pill · alerte         │
├────────────────────────────────────────────┤
│ Stats grid (4 tuiles) :                     │
│   Scans/min (sparkline)                     │
│   File estimée                              │
│   No-show estimé                            │
│   Staff en ligne                            │
├──────────────┬─────────────────────────────┤
│ Incidents    │ Radio staff (realtime)      │
└──────────────┴─────────────────────────────┘
```

- **Bypass du chrome événement** : la route est ajoutée à `isFullScreenRoute()` du layout O4, parallèle à `/checkin`. L'opérateur n'a qu'un seul lien : « Quitter le mode live » → `/overview`.
- **Bandeau hors-fenêtre** : si `now ∉ [start − 6h, end + 6h]`, un bandeau ambre prévient que les chiffres seront vides ou stables (mode démo / répétition reste possible).

#### Entry point sur `/overview`

Une carte « Mode live (Floor Ops) » apparaît au-dessus des actions prioritaires **quand l'événement est `published`** :

- **Activée** quand `liveWindowState === "live"` → bouton rouge pulsant.
- **Désactivée + tooltip** sinon (« Disponible J-0 ± 6 h » avant, « Événement terminé » après).

### Helpers J-0 ±6h

**`apps/web-backoffice/src/lib/live-window.ts`** :

- `isLiveWindow(start, end?, now)` → bool. Fenêtre = `[start − 6h, end + 6h]`. Fallback durée 12 h si `endDate` est nul.
- `liveWindowState(start, end?, now)` → `"before" | "live" | "after"`.

Pures, sans dépendance horloge — `now` injecté par le caller (testabilité).

## Tests

| Fichier                                                                        | Cas | Couvre                                                             |
| ------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------ |
| `apps/api/src/services/__tests__/incident.service.test.ts`                     | 6   | create/update happy + permission + cross-org + NotFound + duration |
| `apps/api/src/services/__tests__/live-stats.service.test.ts`                   | 12  | bucketing, distinct counter, no-show heuristics                    |
| `apps/api/src/services/__tests__/emergency-broadcast.service.test.ts`          | 5   | `mergeChannels()` — verrouillage push+sms, opt-in WhatsApp         |
| `apps/web-backoffice/src/components/live-ops/__tests__/ScanRateChart.test.tsx` | 9   | Géométrie SVG + render contract                                    |
| `apps/web-backoffice/src/components/live-ops/__tests__/IncidentLog.test.tsx`   | 5   | `formatElapsed` (helper) — tous les buckets temporels              |
| `apps/web-backoffice/src/components/live-ops/__tests__/StaffRadio.test.tsx`    | 2   | `formatTime` — fuseau-safe                                         |
| `apps/web-backoffice/src/lib/__tests__/live-window.test.ts`                    | 9   | J-0 ±6h gating, fallback durée nulle, dates invalides              |

**Snapshots refresh** : `route-inventory.test.ts.snap` + `permission-matrix.test.ts.snap` (7 nouveaux endpoints + 4 nouvelles permissions au handler).

**Counts globaux après O8** :

- Backend : 1800 tests passants (+ 23 nouveaux).
- Frontend : 285 tests passants (+ 25 nouveaux).
- Typecheck : `tsc --noEmit` clean sur `apps/api` et `apps/web-backoffice`.

## Décisions

1. **Pas de presence channel** pour staffOnline. Coût d'infra (Firebase RTDB pour presence) vs. valeur — un proxy via les staff messages des 5 dernières minutes est suffisant pour la version 1 et n'introduit pas une dépendance supplémentaire. À itérer si on observe des opérateurs confus par le compteur.

2. **Polling 60 s vs. realtime pour les stats**. Stats = read-model agrégé sur 7 collections — Firestore realtime ne le permet pas en une requête, et un fan-out client multi-onSnapshot multiplierait les reads. 60 s polling = bon trade-off cost/freshness.

3. **Friction 2 étapes pour l'alerte d'urgence**. Une seule erreur (un opérateur frustré qui clique sans réfléchir) coûte la confiance des participants. La friction (taper `DIFFUSER`) est délibérée.

4. **Bypass du chrome événement vs. layout dédié**. On reproduit le même pattern que O4 a établi pour `/checkin` — `isFullScreenRoute()` est l'API canonique. Cohérence > nouveau pattern.

5. **`/staffMessages` comme collection top-level** plutôt que sous-collection sous `/events`. Permet une seule règle Firestore + une seule index composite + un onSnapshot avec `where("eventId", "==", x)` simple. Le coût d'un préfixe `eventId_` au doc id n'est pas justifié pour la lecture monoévénement.

6. **Privacy-first events** systématique. `notesChanged: boolean`, `resolutionNoteChanged: boolean` — la valeur ne quitte jamais le service. C'est la même règle que O7 a posée pour `participant_profile.updated`.

## Dette i18n connue

Les composants livrés en O8 portent toutes leurs chaînes utilisateur en français en dur (pas de `useTranslations`). Cet état est **délibérément aligné** sur les phases O1-O7 (`/inbox`, `/overview`, comms, event-health, data-ops, participants) — la migration `next-intl` du back-office reste un effort cross-cutting séparé du périmètre Organizer Overhaul. À traiter dans un sweep dédié quand l'app cible plusieurs locales actives.

## Ce qui ne fait PAS partie d'O8

- **Geolocation** des incidents (carte heatmap). Nice-to-have ; pas de signal terrain qu'on en a besoin.
- **Voice/audio** dans la radio staff. Trop coûteux côté infra (Twilio Voice / WebRTC) pour la valeur — le texte est suffisant dans 95 % des cas observés sur des événements similaires.
- **Anomaly detection** sur scanRate (alerte « cadence chute brutalement »). À reporter en O9 si l'analytics post-event montre des décrochages systématiques.

## Suite

- O9 — Post-event Report + Financial Reconciliation (2 jours).
- O10 — Event Templates, Co-organizer Shell, Speaker/Sponsor Magic-Links (2 jours).
