# O2 — Organizer Inbox (landing task-oriented)

> **Phase O2** du plan `PLAN.md`. Pivot fondamental d'IA : remplace `/dashboard` (panel de métriques vanity) par `/inbox` (todo-list intelligente répondant à _« qu'est-ce que je dois faire aujourd'hui ? »_) comme landing par défaut post-login pour les organisateurs.

## Objectif mesurable

> L'organisateur qui se connecte voit en **< 2 s** les 3 actions prioritaires du jour, sans cliquer.

## Architecture (mirror du pattern admin)

### Backend

**Service** : `apps/api/src/services/organizer-inbox.service.ts`

```
OrganizerInboxService.getInboxSignals(user) → { signals, computedAt }
                  │
                  ├── requirePermission(user, "event:read")
                  ├── requireOrganizationAccess(user, orgId)
                  └── 9 reads parallélisés (Promise.all + safeCount wrapper)
```

Les 9 reads couvrent les 6 catégories :

| Catégorie      | Signal(s)                                                | Source Firestore                                                                  | Agrégation      |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- | --------- |
| **urgent**     | `payments.failed_7d`                                     | `payments where (org=X, status=failed, createdAt>=now-7d)`                        | `count()`       |
| **urgent**     | `events.published_no_venue_j7`                           | `events where (org=X, status=published, venueId=null, startDate ∈ [now, now+7d])` | `count()`       |
| **today**      | `events.live_now`                                        | `events where (org=X, status=published, startDate <= now, endDate >= now)`        | `count()`       |
| **week**       | `events.publish_due_7d`                                  | `events where (org=X, status=draft, startDate ∈ [now, now+7d])`                   | `count()`       |
| **week**       | `payments.pending`                                       | `payments where (org=X, status=pending, createdAt <= now+24h)`                    | `count()`       |
| **growth**     | `growth.events_near_limit` / `growth.members_near_limit` | org doc + `events where (org=X, status in [draft, published])`                    | doc.get + count |
| **moderation** | `speakers.unconfirmed`                                   | `speakers where (org=X, isConfirmed=false)`                                       | `count()`       |
| **team**       | `invites.pending` / `invites.expired`                    | `invites where (org=X, status=pending                                             | expired)`       | `count()` |

**Pattern `safeCount`** : chaque count est wrappé dans une fonction qui swallow les erreurs et retourne `0` (loggant via `process.stderr.write`). Une collection cassée ne tank jamais l'inbox entier.

**Pattern `nullable orgDoc`** : la fetch du document organisation est isolée dans une IIFE `try/catch` qui retourne `null` en cas d'échec — la section "growth" disparaît silencieusement plutôt que de propager l'erreur.

**Sévérité** : `critical` (paiements échoués, limite atteinte 100 %) > `warning` (limites approche, lieu manquant J-7) > `info` (en cours, pending, validations à faire).

**Route** : `GET /v1/me/inbox` (montée dans `me.routes.ts` sous le préfixe `/v1/me`). Pas de validation supplémentaire — la permission `event:read` est appliquée dans le service.

### Frontend

**Hook** : `apps/web-backoffice/src/hooks/use-organizer-inbox.ts`

Auto-refresh contract identique à l'admin inbox :

- **Initial fetch** sur mount.
- **Polling visibility-aware** au `ORGANIZER_INBOX_REFRESH_MS` (60 000 ms). Skipper quand `document.visibilityState !== "visible"` pour ne pas brûler du Cloud Run sur un onglet en arrière-plan.
- **Exponential backoff** sur erreur réseau : multiplicateur × 2 plafonné à × 10 (10 minutes max entre deux polls). Reset à × 1 sur le premier succès.
- Expose : `{ signals, error, lastUpdate, refreshing, refetch }`.

**Page** : `apps/web-backoffice/src/app/(dashboard)/inbox/page.tsx`

- Hero `<SectionHeader>` avec bouton "Rafraîchir" + dernier timestamp.
- Loading state : 6 skeleton cards.
- Empty state : carte `<CheckCircle2>` "Tout va bien" avec hint `⌘K`.
- Error state : carte rouge avec bouton Réessayer.
- Sections par catégorie dans l'ordre `urgent → today → week → growth → moderation → team` avec **suppression des sections vides** — la page ne garde aucun header sans contenu.
- Cartes triées dans chaque section par sévérité (`critical → warning → info`).
- `<InboxCard>` : Link Next vers le `href` du signal, couleurs par sévérité (rouge / ambre / sky), icône, label de catégorie en kicker, count + texte + flèche hover.

**Wiring landing route** : `apps/web-backoffice/src/lib/access.ts`

```diff
- if (isOrganizerRole(userRoles)) return "/dashboard";
+ if (isOrganizerRole(userRoles)) return "/inbox";
```

`/dashboard` reste accessible (la nav le pointe toujours en deuxième entrée de "Mon espace"), mais ce n'est plus la landing par défaut. Le test `access.test.ts` est mis à jour en conséquence (assertion sur `/inbox`).

**Removal du `comingSoon` flag** : l'entrée `inbox` dans `use-organizer-nav.ts` perd son flag — la sidebar la rend désormais comme un Link normal vers `/inbox`. Le test `sidebar.test.tsx` qui exerçait spécifiquement le rendu `comingSoon` est conservé mais utilise un mock injecté de `useOrganizerNav` plutôt que la production taxonomy (pour ne pas dépendre d'un flag transient).

## Couverture de tests

### Backend (11 tests, all green)

`apps/api/src/services/__tests__/organizer-inbox.service.test.ts` :

| Test                   | Couvre                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Empty signal list      | Tous counts = 0 → `signals: []`, `computedAt` ISO                                      |
| Critical urgent signal | `payments.failed_7d > 0` → catégorie `urgent`, sévérité `critical`, href `/finance`    |
| Pluralisation          | count === 1 → "1 invitation en attente" (singulier)                                    |
| Growth warning         | 8/10 events sur plan starter → 80 % → sévérité `warning`, href `/organization/billing` |
| Growth critical        | 10/10 events → 100 % → sévérité `critical`, titre "Limite atteinte"                    |
| Growth absent          | 5/10 events → 50 % → pas de signal growth                                              |
| Enterprise = Infinity  | maxEvents = Infinity → jamais de signal growth quelle que soit l'usage                 |
| Permission denial      | `participant` → `ForbiddenError`                                                       |
| Org-less user          | `organizationId: undefined` → empty inbox + computedAt présent                         |
| Super_admin bypass     | `super_admin` exempt du `requireOrganizationAccess`                                    |
| Graceful degradation   | orgDoc null → growth section vide, autres signaux survivent                            |

### Frontend (5 tests, all green)

`apps/web-backoffice/src/hooks/__tests__/use-organizer-inbox.test.tsx` :

| Test                   | Couvre                                                     |
| ---------------------- | ---------------------------------------------------------- |
| Initial fetch          | Hydrate `signals` + `lastUpdate`, appel sur `/v1/me/inbox` |
| Transport error        | Erreur capturée dans `error`, `signals` reste null         |
| Refreshing toggle      | `refreshing: true` pendant fetch, `false` après resolve    |
| Manual refetch         | Appeler `refetch()` re-fire la query                       |
| Error reset on success | `error` repassé à null après succès post-erreur            |

### Intégrations affectées

- **Snapshot `route-inventory.test.ts.snap`** : ajout d'une ligne `GET /v1/me/inbox auth` (mise à jour minimale, vérifiée ligne par ligne).
- **`access.test.ts`** : assertion mise à jour pour `/inbox` (était `/dashboard`).
- **`sidebar.test.tsx`** : refactor d'un test pour utiliser un mock injecté plutôt que la production `comingSoon` flag.

**Total** : +16 tests, 1864 tests passants au total (1676 API + 188 web-backoffice).

## Décisions de design

### Pourquoi `/v1/me/inbox` et non `/v1/organizer/inbox` ?

L'inbox est intrinsèquement scopée au caller (pas à un objet organisation passé en paramètre). Le préfixe `/v1/me` exprime exactement cette sémantique "ressource du caller actuel" et évite de polluer `/v1/admin/inbox` (déjà utilisé pour la version admin). Convention : tout endpoint persona-scoped (FCM tokens, whoami, et désormais inbox) vit sous `/v1/me`.

### Pourquoi 9 reads et pas 6 ?

Le plan parlait de "6 catégories de signaux" — mais une catégorie peut produire plusieurs signaux (ex : `urgent` regroupe paiements échoués + lieu manquant). Les 9 reads parallélisés génèrent 8+ signaux distincts répartis dans 6 catégories. La parallélisation tient toujours dans le budget < 1 s (Firestore aggregation queries sont rapides — typiquement 50-200 ms chacune).

### Pourquoi `count()` plutôt que `select(...).limit(...).get()` ?

`count()` aggregation queries sont **moins chères** (1 read par 1 000 docs) et **plus rapides** (pas de hydratation). On veut juste le nombre, pas les docs eux-mêmes — la deep-link CTA fera la fetch des détails côté navigation. Le seul read non-`count()` est l'org doc (pour récupérer plan + memberIds.length), nécessaire au calcul des seuils growth.

### Pourquoi un re-routing landing pour `/inbox` plutôt qu'une redirection serveur ?

`resolveLandingRoute` est utilisé par le login form **et** par le gate `(dashboard)/layout.tsx` (TODO future). Centraliser le choix dans cette fonction garantit qu'un changement de landing (ex: `/inbox` → `/inbox?focus=urgent`) propage à tous les call-sites en un seul commit. Une redirection serveur (`redirect("/inbox")`) côté `/dashboard/page.tsx` masquerait cette source unique.

### Pourquoi pas de domain event quand l'inbox est consultée ?

L'inbox est **read-only**. Les domain events sont réservés aux mutations (cf. CLAUDE.md §2 "Architecture Alignment"). Émettre un event sur consultation polluerait le ledger et n'apporte aucune valeur d'audit (le request log de Fastify suffit pour la traçabilité d'accès).

### Pourquoi le backoff plafonné à × 10 et pas × 60 ?

10 minutes est le seuil au-delà duquel l'opérateur va de toute façon refresh manuellement. Aller à 60 (= 1 heure) maximiserait l'économie côté backend mais créerait des fenêtres de stale data trop longues pour un "task-oriented inbox" qui se vend sur la fraîcheur des signaux.

### Pourquoi pas d'auto-refresh sur le mount initial du `setTimeout` ?

Le pattern admin met le premier `setTimeout` après le `await fetchSignals()` initial. Reproduire exactement ce pattern. Conséquence : le premier poll n'arrive **qu'après** `ORGANIZER_INBOX_REFRESH_MS`, pas immédiatement après le mount fetch. C'est volontaire — l'opérateur vient de voir les signaux en arrivant, pas besoin de re-fetcher 0 secondes plus tard.

## Suite pour les phases O3+

- **O3 — Event Health Score** : pourra ajouter un nouveau signal `events.health_below_60` à l'inbox (catégorie `today` ou `urgent` selon score).
- **O4 — Event Hub refactor** : la Vue d'ensemble event-scoped peut afficher le subset de signaux qui concernent CET event uniquement (filtre côté frontend).
- **O5 — Comms Center** : ajout d'un signal `broadcasts.scheduled_today` (campagnes planifiées dans la journée).
- **O6 — WhatsApp** : ajout d'un signal `whatsapp.delivery_failed` quand la livraison Meta retourne un échec.

## Vérification

```bash
# API
cd apps/api
npx tsc --noEmit                         # propre
npx vitest run                           # 1676 tests passent (incl. 11 nouveaux)

# Web
cd apps/web-backoffice
npx tsc --noEmit                         # propre
npx vitest run                           # 188 tests passent (incl. 5 nouveaux)
```

Manual QA recommandé :

- [ ] Login en tant qu'organizer → atterrit sur `/inbox` (et non `/dashboard`).
- [ ] L'entrée "Boîte de tâches" dans la sidebar est navigable (pas de pill `Bientôt`).
- [ ] Empty state s'affiche quand l'org n'a aucun signal (org neuf en seed).
- [ ] Auto-refresh discret sans flicker à chaque tick (le `refreshing: true` n'efface pas les signaux pendant le fetch).
- [ ] Background tab ne consomme pas de poll (vérifier via DevTools Network).
- [ ] Erreur 500 simulée → carte rouge + bouton "Réessayer" qui fonctionne.
- [ ] Co-organizer voit l'inbox de son organisation (les signaux orga concernent l'orga, pas le scope event-only — c'est un compromis acceptable pour O2 ; O10 raffinera avec un co-organizer scoped shell).
