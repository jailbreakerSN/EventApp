# O5 — Comms Center unifié

> **Phase O5** du plan `PLAN.md`. Bascule `/communications` d'un **single-purpose composer** à un **Comms Center à 3 onglets** (Frise / Composer / Bibliothèque), avec une **bibliothèque de 12 templates FR pré-écrits** et une **frise gantt** qui montre tout ce qui part par canal.

## Objectif mesurable

> L'organisateur voit en **une vue** _tout_ ce qui part (broadcasts + scheduled + lifecycle auto + reminders).

Avant → un composer unique sans visibilité sur ce qui était déjà programmé. Après → 3 surfaces complémentaires sur la même page : **Frise** (vue globale temporelle), **Composer** (rédaction multi-canal avec preview live), **Bibliothèque** (12 templates FR prêts à l'emploi).

## Architecture

### Backend

**Templates statiques — `packages/shared-types/src/comms-template.types.ts`**

12 templates FR shipped avec le produit, déclarés en `SEED_COMMS_TEMPLATES`. Chaque template porte :

- `id` stable, `category` (reminder / confirmation / lifecycle / reengagement)
- `label` + `description` (FR, opérateur-facing)
- `title` + `body` avec syntaxe `{{event}}` / `{{date}}` / `{{participant}}`
- `defaultChannels` — pré-sélection des canaux dans le composer
- `timing` — hint éditorial ("À envoyer J-7")

Helper pur `renderCommsTemplate(text, vars)` pour résoudre les placeholders au render-time. Exporté → testable indépendamment.

**Service templates — `apps/api/src/services/comms-template.service.ts`**

Read-only. Gate `requirePermission(broadcast:read)`. Pas de `requireOrganizationAccess` car les templates sont du **product content**, pas des données utilisateur. Méthodes : `list({ category? })` + `getById(id)`. Retourne directement `SEED_COMMS_TEMPLATES`.

**Service timeline — `apps/api/src/services/comms-timeline.service.ts`**

Aggrège les broadcasts d'un event (sent + scheduled + draft) et les **explose par canal** (un broadcast 3-canaux → 3 entrées). Trie chronologiquement, calcule `rangeStart` / `rangeEnd`. Helper pur `broadcastToEntries(broadcast)` exporté.

Truncation du `preview` à 240 chars (slice 237 + ellipse "…" → 238 chars total) pour la lisibilité du chart.

**Routes** :

| Méthode | Path                                 | Handler                                 |
| ------- | ------------------------------------ | --------------------------------------- |
| `GET`   | `/v1/events/:eventId/comms/timeline` | `commsTimelineService.getEventTimeline` |
| `GET`   | `/v1/comms/templates?category=…`     | `commsTemplateService.list`             |

Le `/templates` est sous un nouveau prefix `/v1/comms` (et non `/v1/events`) — les templates ne sont pas event-scoped.

### Frontend

**Hooks** :

- `useCommsTemplates(category?)` — React Query, `staleTime: 30 min` (data quasi-statique).
- `useEventCommsTimeline(eventId)` — React Query, `staleTime: 60 s` (mêmes 60 s que l'inbox + health card).

**Composants** (tous SVG / pure CSS, zéro lib externe) :

1. **`<CommsTimeline />`** — `apps/web-backoffice/src/components/comms/CommsTimeline.tsx`
   - Frise gantt horizontale : 4 rows par canal (email / push / sms / in_app), un cercle par entrée positionné par `at`.
   - X-axis : range de la data, **minimum 7 jours** pour qu'un broadcast unique ne dégénère pas l'axe à un point.
   - Marqueur vertical "Aujourd'hui" en teranga-gold pointillé.
   - Status drives le rendu : `sent` = cercle plein, `scheduled` = contour pointillé, `failed` = bordure rouge.
   - Empty state + loading state.
   - Helper pur `buildTimelineGeometry()` exporté.

2. **`<CommsTemplateLibrary />`** — `apps/web-backoffice/src/components/comms/CommsTemplateLibrary.tsx`
   - Strip de tabs catégories (Tous / Rappels / Confirmations / Cycle de vie / Réengagement).
   - Grid de cards (3 colonnes sur lg, 1 sur mobile) avec preview titre + body, channel icons, timing hint.
   - CTA "Utiliser ce modèle" → callback `onPick(template)` consommé par la page.

3. **`<CommsComposer />`** — `apps/web-backoffice/src/components/comms/CommsComposer.tsx`
   - Form contrôlé : titre + body + channels + recipient filter + schedule mode.
   - **Live preview** côté droit : résout `{{event}}` / `{{date}}` / `{{participant}}` via `renderCommsTemplate()`.
   - Hydratation auto via la prop `template` — quand l'utilisateur pick un template dans la library, le composer se remplit automatiquement.
   - Plan-gate sur SMS via `<PlanGate feature="smsNotifications">`.
   - Disabled state explicite (canSubmit boolean) avec libellé du bouton qui change selon `scheduleMode` + `busy`.

### Page refactor

`apps/web-backoffice/src/app/(dashboard)/communications/page.tsx` devient un orchestrateur léger :

- Event selector au top (scope les onglets Frise + Composer ; Templates est org-scoped).
- 3 tabs : `timeline` (par défaut) / `composer` / `library`.
- Picking un template dans Library → switch automatique vers Composer + form pré-rempli.
- Recent broadcasts (5 derniers) sous la frise pour un quick-glance des envois récents.

## Couverture de tests

### Backend (+18 nouveaux)

`apps/api/src/services/__tests__/comms-template.service.test.ts` — **7 tests** :

| Test                              | Couvre                                   |
| --------------------------------- | ---------------------------------------- |
| List all 12                       | Organizer reçoit les 12 templates        |
| Filter by category                | `?category=reminder` filtre côté service |
| Filter by category (réengagement) | Idem pour réengagement                   |
| Permission denial                 | Participant → ForbiddenError             |
| Super_admin bypass                | Listing accessible sans org context      |
| getById hit                       | `reminder-j7` retourné                   |
| getById miss                      | id inconnu → null                        |
| getById permission                | Participant rejeté                       |

`apps/api/src/services/__tests__/comms-timeline.service.test.ts` — **11 tests** :

| Test                               | Couvre                                            |
| ---------------------------------- | ------------------------------------------------- |
| Per-channel explosion              | 3 canaux → 3 entrées                              |
| `at` priority sentAt > scheduledAt | sent broadcast utilise sentAt                     |
| `at` fallback scheduledAt          | scheduled broadcast utilise scheduledAt           |
| `at` fallback createdAt            | draft broadcast utilise createdAt                 |
| Truncation 240 chars               | Body > 240 → 238 chars + "…"                      |
| Body court préservé                | Body court inchangé                               |
| Counters propagation               | recipient/sent/failed dupliqués sur chaque entrée |
| Service intégration                | Sort chronologique, range correct                 |
| Empty timeline                     | range null, computedAt présent                    |
| Permission denial                  | Participant rejeté                                |
| Cross-org rejection                | Organizer d'une autre org rejeté                  |

### Frontend (+19 nouveaux)

| Fichier de test                 | Tests | Couvre                                                                                                                                                                              |
| ------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommsTimeline.test.tsx`        |     8 | `buildTimelineGeometry` (empty, position, min-window, today marker, historical view) + render (loading, empty state, SVG circles + today label)                                     |
| `CommsTemplateLibrary.test.tsx` |     4 | Cards render, onPick callback, category tab switch refire avec `?category=`, empty state                                                                                            |
| `CommsComposer.test.tsx`        |     7 | Hydratation par template, preview placeholders résolus, submit disabled si vide, submit payload correct, channel toggle aria-pressed flip, busy state, schedule mode datetime input |

**Total Phase O5 : +37 tests.** Suite globale : **2068 tests passants** (1726 API + 242 web). TypeScript clean.

## Décisions de design

### Pourquoi des templates statiques en TypeScript et pas Firestore ?

Les 12 templates sont du **product content** — éditorial Teranga, pas des données utilisateur. Trois bénéfices :

1. **Pas de seed Firestore** à maintenir / re-deployer pour onboard une nouvelle org.
2. **Versionnement git natif** : modifier un template = PR review.
3. **Coût zéro** au niveau Firestore reads.

Une future itération layerera des templates **organisation-scoped customs** au-dessus de cette seed, dans une collection Firestore. Le contrat `commsTemplateService.list()` est le bon endroit pour l'union.

### Pourquoi `/v1/comms` séparé de `/v1/events` ?

Le templates endpoint n'est pas event-scoped. Mettre `/v1/events/templates` créerait une ambiguïté avec `/v1/events/:eventId/...` et conflit sémantique. Un nouveau prefix `/v1/comms` accueille les opérations org-scoped (templates aujourd'hui, custom templates demain).

### Pourquoi exploser un broadcast multi-canal en N entrées timeline ?

Le contrat de la frise est **"qu'est-ce qui va atterrir dans le téléphone du participant"**. Un broadcast 3-canaux atterrit dans 3 endroits différents — push, email, SMS — et a 3 trajectoires de delivery distinctes. Une ligne par canal × broadcast est le seul moyen de représenter cela honnêtement, et c'est aussi ce qui permet le **gantt par row de canal** (visuellement plus parlant qu'un flat).

### Pourquoi le minimum de 7 jours sur la fenêtre du gantt ?

Avec un seul broadcast, `rangeStart === rangeEnd` → l'axe X dégénère à un point, le rendu est inutilisable. Pad symétrique à 7 jours = la durée typique d'une semaine de prep événement, donc l'axe reste lisible même en early-cycle.

### Pourquoi un live preview côté droit du composer plutôt qu'un modal ?

Le placeholder substitution est subtile (les `{{event}}` n'apparaissent pas tels quels dans le rendu final). Un preview side-by-side rend l'effet immédiat à chaque keystroke — l'opérateur voit en temps réel comment son message sera lu. Un modal aurait imposé un "Aperçu" → "Fermer" → "Modifier" → "Aperçu" cycle frustrant.

### Pourquoi 30 minutes de staleTime sur les templates ?

Les templates sont quasi-statiques (un changement = un deploy). 30 minutes laissent le temps à un deploy de propager sans cache aggressif côté client. À comparer aux 60 secondes de l'inbox / health / timeline qui sont du data dynamique.

### Pourquoi le composer extrait en composant et pas inline ?

Trois consommateurs futurs :

1. **`/communications`** (cette page) — déjà connecté.
2. **Sur la fiche-événement** — `operations/feed/page.tsx` pourrait monter le composer pour permettre un envoi rapide depuis le contexte event.
3. **Speaker portal (O8)** — pour annoncer une session.

Avoir le composer comme composant pur + `onSubmit` callback rend ces trois cas triviaux sans dupliquer la logique.

### Pourquoi 5 templates dans la catégorie "Reminders" et pas plus ?

Les rappels sont **les plus utilisés** mais aussi ceux où l'over-saturation est la plus risquée. 3 (J-7, J-1, ouverture des portes) couvre la trame canonique d'une org pro. Au-delà → spam perçu. Future : surfacing analytique des "templates les moins efficaces" pour guider l'éditorial.

### Pourquoi pas un préviewer email/SMS séparé ?

Le rendu HTML email est une discipline à part entière (variables, tracking pixels, dark mode CSS). Pour O5, le preview est volontairement **textuel** — il montre le contenu, pas le wrapper visuel. Une future itération O5+ peut ajouter un preview HTML rendu dans une iframe sandbox.

## Suite pour les phases suivantes

- **O6 — WhatsApp** : 4ᵉ canal `whatsapp` à ajouter à `CommunicationChannelSchema`. Le composer + la frise reçoivent un nouveau row + nouveau toggle naturellement. Templates Meta-approved nécessaires.
- **O7 — Bulk ops** : `audience/registrations` aura un bulk action "Envoyer un broadcast à la sélection" qui mountera le `<CommsComposer>` pré-filtré.
- **O8 — Live Mode** : "Emergency broadcast" sur la fiche-event live = `<CommsComposer>` auto-monté avec template "Évacuation" / "Annonce urgente" depuis la library.

## Vérification

```bash
# API
cd apps/api
npx tsc --noEmit                         # propre
npx vitest run                           # 1726 tests passent (incl. 18 nouveaux O5)

# Web
cd apps/web-backoffice
npx tsc --noEmit                         # propre
npx vitest run                           # 242 tests passent (incl. 19 nouveaux O5)
```

Manual QA :

- [ ] `/communications` charge sur l'onglet Frise par défaut.
- [ ] Sélection d'un event → frise affiche les broadcasts existants + marqueur "Aujourd'hui".
- [ ] Onglet Bibliothèque → 12 cards visibles, filtrable par tab catégorie.
- [ ] Click "Utiliser ce modèle" → switch auto vers Composer + form pré-rempli.
- [ ] Composer : taper dans titre/body → preview se met à jour en live, `{{event}}` résolu si event sélectionné.
- [ ] SMS désactivé sur plan free, activable sur Pro.
- [ ] Schedule mode → datetime input apparaît, future-only.
- [ ] Submit envoie le broadcast → recent broadcasts list se met à jour sous la frise.
