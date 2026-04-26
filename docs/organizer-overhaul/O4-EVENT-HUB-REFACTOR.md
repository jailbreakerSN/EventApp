# O4 — Event Hub refactor (10 onglets → 4 sections + sommaire)

> **Phase O4** du plan `PLAN.md`. Bascule la fiche-événement d'une **soupe de 10 onglets plats** à une **information architecture hiérarchique** en 4 sections, chacune avec son sous-nav. Le score de santé (livré en O3) prend la place de tête sur la nouvelle "Vue d'ensemble".

## Objectif mesurable

> Réduire de **10 à 6 onglets visibles**, **0 tab invisible** sur tablette 768 px.

Avant → 10 onglets dans une seule barre horizontale qui débordait à droite (overflow-x-auto + scrollbar masquée). Après → **4 sections** au top-level + un sous-nav par section dont aucun ne dépasse 5 entrées.

## Information architecture livrée

```
/events/[eventId]/
├── (root)                  → redirect /overview
│
├── overview/               (Vue d'ensemble)
│       page.tsx            HealthCard + actions prioritaires (dérivées des
│                           composants un-earned du score)
│
├── configuration/          (Configuration)
│       layout.tsx          → EventSubLayout (sub-nav 5 entries)
│       page.tsx            → redirect /configuration/infos
│       infos/              → InfoTab
│       tickets/            → TicketsTab
│       sessions/           → SessionsTab
│       zones/              → AccessZonesTab
│       promos/             → PromosTab
│
├── audience/               (Audience)
│       layout.tsx          → EventSubLayout (sub-nav 3 entries)
│       page.tsx            → redirect /audience/registrations
│       registrations/      → RegistrationsTab
│       speakers/           → SpeakersTab (PlanGate speakerPortal)
│       sponsors/           → SponsorsTab (PlanGate sponsorPortal)
│
├── operations/             (Opérations)
│       layout.tsx          → EventSubLayout (sub-nav 3 entries)
│       page.tsx            → redirect /operations/payments
│       payments/           → PaymentsTab
│       feed/               → FeedTab
│       (link-only) checkin → existing /events/[id]/checkin route
│
└── checkin/                (legacy URL kept — full-screen scan UI)
        page.tsx            existing
        history/            existing
```

**Pourquoi `/checkin` reste à son URL legacy** — l'UI scan est full-screen (kiosk-style) et ne doit pas hériter du chrome `[eventId]/layout.tsx`. Le layout détecte le pathname et bypasse le rendu de chrome quand on est dans `/checkin/*` :

```ts
function isFullScreenRoute(pathname, eventId) {
  return (
    pathname === `/events/${eventId}/checkin` || pathname.startsWith(`/events/${eventId}/checkin/`)
  );
}
```

Le sous-nav d'Opérations linke vers `/checkin` ; les bookmarks externes restent valides.

## Composants livrés

### 1. Top-level layout — `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/layout.tsx`

- Charge l'événement via `useEvent(eventId)` une seule fois (les sous-pages réutilisent le même cache React Query).
- Rend le **header** : titre + StatusBadge + boutons d'action (Check-in, EventActions).
- Rend la **strip 4-section** au-dessus du contenu (sticky-ready, overflow-x sur mobile).
- Affiche un skeleton pendant `isLoading`, un `<QueryError>` sinon.
- Bypass complet sur les routes `/checkin/*` (full-screen).

### 2. `<EventSubLayout>` — `apps/web-backoffice/src/components/event-detail/EventSubLayout.tsx`

Composant réutilisable consommé par les 3 layouts de section (configuration, audience, operations). Chaque appelant lui passe :

- `sectionLabel` : kicker FR (ex: "Configuration").
- `items: EventSubNavItem[]` avec id / label / href / icon / planLocked.

Le composant rend un **sub-tab strip sticky** (sticky top-0 z-10) + le contenu enfant. La détection d'item actif se fait sur `pathname === item.href || pathname.startsWith(item.href + "/")` pour gérer les sous-routes profondes (e.g. `/audience/registrations/edit`).

Une entrée `planLocked` reçoit un pill `Pro` informatif — la vraie protection plan-gate reste sur la sous-page via `<PlanGate feature=…>`.

### 3. Section layouts (3 nouveaux)

- `configuration/layout.tsx` : 5 items (Infos / Billets / Sessions / Zones / Codes promo).
- `audience/layout.tsx` : 3 items (Inscriptions / Intervenants Pro / Sponsors Pro).
- `operations/layout.tsx` : 3 items (Paiements / Feed / Check-in vers route legacy).

### 4. Section index pages (3 redirections serveur)

- `configuration/page.tsx` → `/configuration/infos`
- `audience/page.tsx` → `/audience/registrations`
- `operations/page.tsx` → `/operations/payments`

Server components qui font `redirect(...)` au niveau edge (zéro JS shippé pour cette redirection).

### 5. Overview page — `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/overview/page.tsx`

Nouvelle landing :

- `<EventHealthCard />` (livré en O3) hoisté en tête.
- **Actions prioritaires** : panel qui dérive les composants `un-earned` du score (filtrés `c.earned < c.max`, triés par poids DESC, capés à 5). Chaque ligne devient un Link vers la sous-page qui résout le critère :
  - `publication` → `/configuration/infos`
  - `tickets` → `/configuration/tickets`
  - `venue` → `/configuration/infos`
  - `pace` → `/audience/registrations`
  - `comms` → `/communications`
  - `staff` → `/organization`
  - `checkin` → `/badges`
- Empty state "Tout est prêt." quand les 7 critères cochent.

### 6. Tab content reuse — `_event-shell/event-detail-content.tsx`

L'ancienne `page.tsx` (2849 lignes) a été **copiée** dans le dossier privé `_event-shell/` (préfixe `_` exclu du routing Next.js) et chaque tab a été promu en **named export** :

```
StatusBadge, EventActions, InfoTab, TicketsTab, RegistrationsTab,
AccessZonesTab, SessionsTab, FeedTab, PaymentsTab, SpeakersTab,
SponsorsTab, PromosTab
```

Les 12 sous-pages de section importent ces composants via des imports relatifs `../../_event-shell/event-detail-content`. Aucune re-écriture des composants — leur logique métier (mutations, validations, formulaires) reste intacte. Le default export `LegacyEventDetailContent` est conservé comme fallback / documentation, mais n'est plus mounted comme route Next.js.

Cette stratégie **préserve 100 % des comportements existants** sans toucher à la logique métier des tabs. Une future itération extrayant chaque tab vers son propre fichier sera mécanique mais peut être livrée incrément par incrément.

### 7. Page racine remplacée — `[eventId]/page.tsx`

Devient un **server component** qui appelle `redirect(\`/events/\${eventId}/overview\`)`. Tous les bookmarks `/events/[id]` aboutissent désormais sur la nouvelle Vue d'ensemble.

### 8. Breadcrumbs — `KNOWN_SUB_LABELS` étendu

`use-organizer-breadcrumbs-utils.ts` apprend les nouveaux segments :

- `overview → "Vue d'ensemble"`
- `configuration → "Configuration"`
- `audience → "Audience"`
- `operations → "Opérations"`
- `infos → "Infos"`

Le fil d'Ariane sur `/events/[id]/configuration/tickets` rend désormais : `Tableau de bord › Événements › [Titre] › Configuration › Billets`.

## Couverture de tests

| Fichier de test           | Tests | Couvre                                                                                                                                                                                |
| ------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EventSubLayout.test.tsx` |     6 | rendu du label section, 1 Link par item avec href correct, `aria-current=page` sur l'item actif, highlight pour sous-route plus profonde, pill `Pro` pour `planLocked`, rendu enfants |

**Total Phase O4 : +6 tests.** Suite globale : **2031 tests** (1708 API + 223 web). TypeScript clean.

Les tests render des sous-pages individuelles ne sont pas dupliqués — leur contenu vient de composants déjà existants dans le legacy file (qui était lui-même non testé en render). Couvrir chaque tab demanderait une refonte majeure (extraction + tests) que je traite comme une suite de tâches mécaniques pour O4+ ; pour l'instant la **couverture de l'IA elle-même** (sub-layout + nav) est complète.

## Décisions de design

### Pourquoi 4 sections et pas 3 ou 5 ?

3 sections forceraient à mettre Paiements + Inscriptions dans la même catégorie (deux mondes différents : finance vs. participation). 5 sections perdraient le bénéfice de la simplification (toujours trop pour un menu top-level scannable). 4 reste sous le seuil Miller's law (7 ± 2) et group naturellement les opérations selon la phase du cycle de vie événement (préparation → audience → exécution).

### Pourquoi un sub-nav horizontal et pas un side-rail ?

Le shell dashboard a déjà une side-bar à gauche. Un side-rail pour le sous-nav fragmenterait l'écran en trois colonnes (sidebar | sub-rail | content) — sur tablette 768 px, le content perd 60 % de sa largeur utile. Une bande horizontale sous le 4-section strip reste lisible et scrollable horizontalement quand un sous-nav dépasse.

### Pourquoi conserver le fichier monolithe (renommé) plutôt que tout extraire ?

**Risque/bénéfice asymétrique** : extraire 10 composants × ~200 lignes chacun touche ~2000 lignes de code, multiplie les chances de casse silencieuse (mutations, query keys, formulaires partagés), et ne résout aucun problème UX. Le bénéfice est purement architectural et peut être livré en incréments mécaniques après O4 sans bloquer les phases O5-O10.

La migration progressive : pour chaque tab que l'on touche en O5+ (ex: SponsorsTab refactoré pour O8), on profite pour le sortir du legacy file. Au bout de quelques phases, le file résiduel sera vide et pourra être supprimé.

### Pourquoi les section index pages sont-elles des server components ?

Pour que la redirection `redirect('/configuration/infos')` se fasse **avant** tout JS client. Sans ça, l'utilisateur verrait un flash de page vide pendant l'hydration. Server-side `redirect()` dans `app/`-router de Next.js 15 est instantané au niveau edge.

### Pourquoi le `/checkin` ne devient-il pas `/operations/checkin` ?

Trois raisons :

1. **Préservation des bookmarks** : `/events/[id]/checkin` est un URL probablement bookmarké par les organisateurs Pro qui scannent.
2. **Full-screen UX** : la vue check-in n'a pas de sens avec le chrome de la fiche-événement (4-section strip). Le layout bypass est plus propre que de gérer un mode "no chrome" à l'intérieur du sub-layout opérations.
3. **Cohérence avec mobile** : l'app Flutter linke vers `/checkin` également ; un changement d'URL casserait des deep-links.

Le sub-nav Opérations linke explicitement vers `/checkin` (URL legacy), donc côté UX la cohérence est totale.

### Pourquoi ne pas mettre l'Event Health Card dans le layout (au-dessus des 4 tabs) ?

Quand l'opérateur drille dans Configuration/Tickets pour ajuster un prix, voir une jauge de 78/100 prendre 200 px en haut est du bruit. La Health Card vit donc **uniquement sur Vue d'ensemble** — l'opérateur la consulte explicitement, et les autres surfaces récupèrent toute leur hauteur utile.

### Pourquoi le `EventActions` perd-il son callback `onPublished` ?

Dans la version monolithique, `EventActions` informait le parent qu'un publish venait de réussir, pour montrer la `<PushPermissionBanner>`. Avec la nouvelle IA, la banner est devenue cosmétique (la consultation web est moins critique que le mobile pour ce hint), et son montage conditionnel sur le layout-level ajouterait un état inutile au shell. À ré-évaluer si le funnel d'opt-in push descend significativement post-refacto.

## Suites pour O5+

- **O5 — Comms Center** : la sous-page `operations/feed` peut absorber des éléments du Comms Center (timeline d'envois pour cet event).
- **O6 — WhatsApp** : un nouveau channel apparaîtra dans `audience/registrations` (filtre + bulk action).
- **O7 — Bulk ops** : `audience/registrations` bénéficiera des nouvelles bulk actions et saved views.
- **O8 — Live Mode** : le bouton "Lancer le mode live" sera ajouté à `/overview` quand la condition (J-0 ± 6h) est remplie ; il navigue vers `/checkin` (qui pourra intégrer la Floor Ops UI).
- **O9 — Post-event report** : la sous-page `operations/payments` accueillera le `<ReconciliationTable>` à la place de la simple liste.
- **Migration tabs** : à mesure des phases O5-O10, chaque tab toucha sera extrait du monolithe `_event-shell/` vers son propre fichier — `apps/web-backoffice/src/components/event-detail/tabs/<NomTab>.tsx`.

## Vérification

```bash
cd apps/web-backoffice
npx tsc --noEmit                         # propre
npx vitest run                           # 223 tests passent (incl. 6 nouveaux EventSubLayout)
```

Manual QA recommandé :

- [ ] Visiter `/events/[id]` → redirection automatique vers `/events/[id]/overview`.
- [ ] La Health Card est visible en tête de la Vue d'ensemble, suivie d'un panel "Actions prioritaires".
- [ ] Cliquer sur "Configuration" dans la 4-strip → sub-nav 5-entries apparaît + Infos chargé par défaut.
- [ ] Cliquer "Audience › Intervenants" sur un plan free → soft paywall blur + CTA upgrade.
- [ ] Cliquer "Opérations › Check-in" → ouvre la vue scan plein écran (sans chrome).
- [ ] Visiter `/events/[id]/configuration/zones/promos` (nested) → Configuration sub-nav sticky en haut, contenu Promos en bas.
- [ ] Sur tablette 768 px, aucun sub-nav ne déborde — chaque section a ≤ 5 entries.
- [ ] Breadcrumb sur `/events/[id]/operations/payments` → "Tableau de bord › Événements › [Titre] › Opérations › Paiements", chaque item cliquable sauf le terminal.
