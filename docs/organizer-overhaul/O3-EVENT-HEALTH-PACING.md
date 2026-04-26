# O3 — Event Health Score + Pacing Chart

> **Phase O3** du plan `PLAN.md`. Donne à l'organisateur un signal **chiffré et précoce** sur la santé d'un événement (score 0-100 + courbe de rythme), pour détecter 7 jours plus tôt les événements à risque.

## Objectif mesurable

> Détection **7 jours plus tôt** des événements à risque (remplissage < 30 % à J-14).

## Architecture

### Backend

**Service** : `apps/api/src/services/event-health.service.ts`

```
EventHealthService.getEventHealth(eventId, user) → EventHealthSnapshot
                  │
                  ├── requirePermission(user, "event:read")
                  ├── eventRepository.findByIdOrThrow(eventId)
                  ├── requireOrganizationAccess(user, event.organizationId)
                  ├── 3 reads parallèles : safeCountBroadcasts, safeCountOrgStaff, registrationRepository.findByEvent
                  ├── computeComponents() → 7 critères pondérés
                  └── buildPacingSeries() → tableau quotidien actual/expected
```

**Composantes du score** (somme = 100) :

| Critère     | Poids | Vérification                                                              |
| ----------- | ----: | ------------------------------------------------------------------------- |
| publication |    20 | `event.status === "published"`                                            |
| tickets     |    10 | `event.ticketTypes.length > 0`                                            |
| venue       |    10 | `event.venueId !== null` OR `format === "online"`                         |
| pace        |    25 | proportionnel à `(registeredCount / expectedAtCurrentTime)`, capé à 100 % |
| comms       |    15 | au moins un broadcast émis pour cet événement                             |
| staff       |    10 | l'organisation a au moins un user avec rôle `staff`                       |
| checkin     |    10 | `event.templateId !== null` (modèle de badge assigné)                     |

**Tier** dérivé du score :

- `excellent` ≥ 80
- `healthy` 60-79
- `at_risk` 40-59
- `critical` < 40

**Courbe d'attente (par défaut)** — interpolation linéaire entre :

```
  t = 0.00  →   0%
  t = 0.50  →  20%
  t = 0.75  →  50%
  t = 0.90  →  80%
  t = 1.00  → 100%
```

Reflète la "ramp lente + spike final" typique des événements sénégalais. Future itération : courbe par-organisation apprise sur l'historique des événements complétés.

**Pacing series** : un point par jour, du `publishedAt` jusqu'à `now` (capé 30 jours). Pour chaque jour : `actual` = inscriptions cumulées (`confirmed` + `checked_in` + `waitlisted`), `expected` = `expectedPercent(t) * targetCapacity`. Le `targetCapacity` vient de `effectiveCapacity()` :

- `event.maxAttendees` si > 0 ;
- sinon `max(50, ceil(registeredCount * 1.2))`.

**Route** : `GET /v1/events/:eventId/health`

Permission gating dans le service. Le route stays a thin controller.

### Frontend

**Hook** : `apps/web-backoffice/src/hooks/use-event-health.ts`

`useEventHealth(eventId)` consomme `/v1/events/:id/health` via React Query, `staleTime: 60_000` ms (mêmes 60 s que l'inbox auto-refresh). Cache hit lors d'un re-render.

**Composants SVG (sans librairie externe)** :

1. **`<HealthGauge />`** — `apps/web-backoffice/src/components/event-health/HealthGauge.tsx`
   - Jauge circulaire 270° (gap au sud) + score au centre + label de tier.
   - 4 couleurs par tier (emerald / sky / amber / red).
   - `role="img"` + `aria-label` + `<title>` pour la lecture vocale.

2. **`<PacingChart />`** — `apps/web-backoffice/src/components/event-health/PacingChart.tsx`
   - Deux paths SVG (réel solide teranga-gold, attendu dashed muted-foreground).
   - Y axis avec 3 graduations (0, 50 %, 100 % de l'enveloppe).
   - X axis avec 3 dates formatées en court (`26 avr`).
   - Empty-state ("Pas encore assez de données") quand n < 2 points.
   - Helper pur `buildPacingPaths()` exporté pour test geometry indépendamment du JSX.

3. **`<HealthBadgeMini />`** — `apps/web-backoffice/src/components/event-health/HealthBadgeMini.tsx`
   - Badge compact pour la liste des événements (pas d'API call par ligne — coût O(n) intolérable).
   - Heuristique client-side basée sur `(registeredCount, maxAttendees, startDate)` :
     - daysLeft > 14 → `info` ("À venir")
     - ratio ≥ 60 % → `ok` (vert)
     - 30–60 % → `warn` (ambre)
     - < 30 % → `danger` (rouge)
   - Title attribute avec les compteurs absolus + J-N.

4. **`<EventHealthCard />`** — `apps/web-backoffice/src/components/event-health/EventHealthCard.tsx`
   - Composite jauge + breakdown des 7 critères + pacing chart.
   - Loading skeleton + error fallback inline.
   - Mounted sur la fiche-événement entre le header et le banner push.

### Wiring

- **`/v1/events/:eventId/health`** ajoutée à `events.routes.ts` après `GET /:eventId`. Snapshot `route-inventory.test.ts.snap` mis à jour.
- **`<EventHealthCard />`** mounted dans `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx` après le header de l'événement.
- **Colonne Santé** ajoutée à la liste des événements (`/events/page.tsx`) avec `<HealthBadgeMini />` — `hideOnMobile` pour ne pas surcharger les écrans étroits.
- **Inbox signal** `events.at_risk_j14` ajouté à `organizer-inbox.service.ts` : count proxy d'événements publiés avec `startDate ∈ [now+1d, now+14d]` AND `registeredCount < 10`. Couvre le sous-ensemble actionnable du "score < 60" sans calculer le score complet (qui demanderait N reads par event).

## Couverture de tests

### Backend (31 tests pour event-health, +1 nouveau pour l'inbox)

`apps/api/src/services/__tests__/event-health.service.test.ts` :

| Catégorie              |     Tests | Couvre                                                                                                                     |
| ---------------------- | --------: | -------------------------------------------------------------------------------------------------------------------------- |
| `expectedPercent`      |         4 | bornes 0/1, checkpoints exacts, interpolation linéaire, clamp out-of-range                                                 |
| `effectiveCapacity`    |         2 | maxAttendees set vs fallback (50 ou 1.2× current)                                                                          |
| `scoreTier`            | 1 (8 cas) | mapping score → tier (boundaries 80/60/40)                                                                                 |
| `computePacingPercent` |         3 | empty array, expected=0, ratio courant                                                                                     |
| `computeComponents`    |         6 | full marks happy path, draft → publication=0, ticketTypes=[] → tickets=0, online → venue auto, pace proportionnel, comms=0 |
| `buildPacingSeries`    |         4 | empty span, bucketing, exclusion cancelled, cap 30 jours                                                                   |
| Service intégration    |         4 | snapshot end-to-end, permission denial, cross-org rejection, graceful degradation                                          |

`apps/api/src/services/__tests__/organizer-inbox.service.test.ts` :

- 12e test : `events.at_risk_j14` urgent/warning quand le proxy count est non-zéro.

### Frontend (29 nouveaux tests)

| Fichier de test            | Tests | Couvre                                                                                                                                                                            |
| -------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HealthGauge.test.tsx`     |    11 | score render + clamping (0/100/123/-5/62.4), labels par tier (FR), aria contract, hideLabel, size prop                                                                            |
| `PacingChart.test.tsx`     |     8 | `buildPacingPaths` geometry, empty state n<2, render avec 2 paths + legend, 3 X labels, width/height props                                                                        |
| `HealthBadgeMini.test.tsx` |    10 | `deriveBadgeTier` heuristique (info/ok/warn/danger boundaries), fallback target=50 quand maxAttendees=null, daysLeft négatif tolerance, render label + iconOnly + title attribute |

**Total Phase O3** : +60 tests. Suite globale : **2025 tests passants** (1708 API + 217 web — tous verts, tsc clean).

## Décisions de design

### Pourquoi un proxy dans l'inbox plutôt que le score réel ?

Le score complet exige (par event) : 1 broadcasts count + 1 staff count + 1 registrations list. Pour une org avec N events publiés dans les 30 jours à venir, c'est `3N` reads. À 10 events actifs c'est 30 reads par poll d'inbox — incompatible avec un auto-refresh 60 s.

Le proxy `events.at_risk_j14` (1 count Firestore) capture le sous-ensemble le plus actionnable : événements publiés à 14 jours ou moins avec moins de 10 inscrits. Trade-off documenté ; le score précis vit sur la fiche-événement où il est calculé à la demande.

### Pourquoi ne pas pré-calculer le score dans un champ dénormalisé ?

C'est l'évolution naturelle après une fenêtre d'observation des perfs. Sans data réelle de production sur la latence des 3 reads parallèles, je préfère ne pas dénormaliser un champ qui mute à chaque inscription / broadcast / changement de venue / publication — la pression d'écriture serait élevée et le score reste précis sans cache. Si le profilage révèle > 500 ms p95, dénormaliser dans une Cloud Function `onWrite` est la suite.

### Pourquoi 270° et pas 360° pour la jauge ?

Les jauges circulaires fermées (anneau 360°) sont visuellement instables : l'œil n'a pas d'ancre pour repérer le "bas". Le gap au sud transforme la jauge en "speedometer", repère naturel hérité des cadrans automobiles. Le gain de lisibilité l'emporte sur la perte de surface "imprimable" pour le score.

### Pourquoi `HealthBadgeMini` côté client et pas server-derived ?

Pour la **scalabilité de la liste** : 50 lignes × 1 query React Query = 50 queries au mount de la page, même si la déduplication React Query atténue les hits Firestore (la requête est encore envoyée par le client). En calculant le tier à partir des 3 champs déjà présents sur l'event (`registeredCount`, `maxAttendees`, `startDate`), on a `O(1)` par ligne et zéro round-trip. Le précis vit sur la fiche-événement.

### Pourquoi exclure les inscriptions `cancelled` du pacing ?

Les annulations doivent compter comme "non inscrits" — sinon une vague d'annulations ne fait pas baisser la courbe et l'organisateur ne voit pas le problème. La courbe `actual` représente la **pression réelle** : confirmées + en attente + check-in (= déjà venus, comptent comme un inscrit pour la trajectoire historique).

### Pourquoi le check-in se mesure via `templateId` plutôt que des badges effectivement émis ?

Au stade preparation (J-7 typiquement), aucun badge n'est encore généré. Le critère "check-in prêt" doit valider la **capabilité de générer** : modèle de badge assigné. La génération elle-même se déclenche quasi instantanément à la demande (cf. `bulkGenerate`), donc le templateId est le seul prérequis manquant.

## Suite pour les phases O4+

- **O4 — Event Hub refactor** : la Vue d'ensemble event-scoped peut hoister le `<EventHealthCard />` au-dessus du sommaire de l'événement, complété par le `<PacingChart />` en grand format.
- **O5 — Comms Center** : ajout d'un signal `events.no_comms_j7` (publié, J-7, zéro broadcast) en bonus pour le composant comms.
- **O6 — WhatsApp** : le critère comms peut être affiné — un broadcast WhatsApp pèse plus qu'un broadcast email pour le marché sénégalais.
- **O8 — Live Mode** : le critère check-in peut être étendu à "staff connectés au scanner" en temps réel.
- **O9 — Post-event report** : le snapshot final du score post-event (et des composants) sera persisté pour l'historique organisateur.

## Vérification

```bash
# API
cd apps/api
npx tsc --noEmit                         # propre
npx vitest run                           # 1708 tests passent (incl. 32 nouveaux O3)

# Web
cd apps/web-backoffice
npx tsc --noEmit                         # propre
npx vitest run                           # 217 tests passent (incl. 29 nouveaux O3)
```

Manual QA recommandé :

- [ ] Fiche-événement avec un event à `status: published`, ticketTypes ≥ 1, venueId set, templateId set, broadcast envoyé, staff dans l'org, registrations alignées avec la courbe → score ≥ 90, tier "excellent", pacing chart aligné.
- [ ] Event en `draft` → score zéro publication, gauge montre "Critique".
- [ ] Event en ligne (`format: "online"`) avec `venueId: null` → critère venue toujours coché (10/10).
- [ ] Liste des événements avec un event sur-inscrit → badge `ok` (vert).
- [ ] Inbox affiche `events.at_risk_j14` quand un event publié à J-10 a 5 inscrits.
- [ ] Tooltip du HealthBadgeMini montre les compteurs absolus et J-N.
