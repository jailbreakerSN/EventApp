# O1 — Fondations IA (sidebar sectionnée + event switcher + breadcrumbs unifiés)

> **Phase O1** du plan `PLAN.md`. Pose les fondations d'information architecture sur lesquelles toutes les phases suivantes (O2+) s'appuient. Aucun comportement métier modifié — pure refonte de structure de navigation.

## Objectif mesurable

Réduire la distance moyenne entre deux tâches fréquentes de **3 clics → 1 clic** :

- avant : sidebar plate à 11 entrées sans regroupement, pas de switcher inter-events, breadcrumbs hand-rolled par page → cognitive load élevé.
- après : sidebar 5 sections labellisées, event switcher global accessible depuis n'importe quelle page, breadcrumbs auto-dérivés et uniformes.

## Inventaire des livrables

### 1. Source unique de vérité — `useOrganizerNav()`

**Fichier** : `apps/web-backoffice/src/hooks/use-organizer-nav.ts` (~280 lignes)

Hook exportant la **taxonomie complète** des 5 sections + `Lieux` (venue managers). Chaque entrée porte :

| Champ                   | Rôle                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `id`                    | identifiant stable (clé React + token analytics)                     |
| `href`                  | route absolue                                                        |
| `icon`                  | composant `lucide-react`                                             |
| `label` / `description` | français                                                             |
| `roles`                 | rôles autorisés (ORed)                                               |
| `shortcut`              | hint clavier pour la palette (ex: `g i`)                             |
| `inPalette`             | défaut `true`, à `false` pour les entrées non-navigables             |
| `comingSoon`            | défaut `false`, à `true` pour les surfaces annoncées avant livraison |

La fonction pure `buildOrganizerNav(roles)` est exportée pour tests unitaires. Le hook React `useOrganizerNav()` mémoïse sur `user.roles` — appel zéro-coût au-delà du premier render post-login.

### 2. Sidebar refactorisée

**Fichier** : `apps/web-backoffice/src/components/layouts/sidebar.tsx`

Refactor complet :

- consomme `useOrganizerNav()` au lieu d'un tableau statique local ;
- rend chaque section avec son **header en majuscules** (`Mon espace`, `Événements`, `Audience`, `Business`, `Lieux`, `Paramètres`) — repère visuel pour la scanabilité ;
- état **collapsed/expanded** persisté en `localStorage` clé `teranga:organizer:sidebar:collapsed` (parité admin) ;
- toggle desktop via chevron dans le header ; mobile drawer ignore le state collapsed (toujours full-width, court-lived) ;
- entrées `comingSoon` rendues désactivées (text-white/30 + pill `Bientôt`) — pas de 404 silencieux entre O1 et O2.

### 3. Event Switcher global

**Fichiers** :

- `apps/web-backoffice/src/components/layouts/event-switcher.tsx` (composant React)
- `apps/web-backoffice/src/components/layouts/event-switcher-utils.ts` (logique pure : `groupEvents`, `normaliseSearchTerm`)

Dropdown mounted dans la topbar à droite du hamburger. Visible uniquement pour les rôles avec `event:read` (organizer, co_organizer, super_admin) — venue managers ne le voient pas.

Comportement :

- **Trigger** : affiche le titre de l'event courant si on est sur `/events/[id]/...`, sinon "Choisir un événement".
- **Contenu** : trois groupes — `En cours` (live, cercle vert), `À venir` (upcoming), `Brouillons` (drafts) — ordonnés respectivement par startDate ascendant, startDate ascendant, updatedAt descendant.
- **Search** : input top, filtrage live insensible à la casse + diacritiques (`normaliseSearchTerm`).
- **Clavier** :
  - `⌘⇧E` (Mac) / `Ctrl+Shift+E` (Win/Linux) : toggle global.
  - `↑` / `↓` : navigation dans la liste.
  - `↵` : ouvrir l'event sélectionné.
  - `Échap` : fermer.
- **Données** : `useEvents({ limit: 50, orderBy: "startDate", orderDir: "asc" })`, fetch déclenché uniquement quand le popover est ouvert OU quand on est sur une route event-scoped (pour rendre le titre du trigger).
- **Filtrage de pertinence** : exclut `cancelled`, `completed`, `archived`, et `published` passés — le switcher ne surface que des destinations actionnables. L'historique vit sur `/events`.

### 4. Breadcrumbs unifiés

**Fichiers** :

- `apps/web-backoffice/src/hooks/use-organizer-breadcrumbs.ts` (hook React)
- `apps/web-backoffice/src/hooks/use-organizer-breadcrumbs-utils.ts` (`deriveBreadcrumbs` pur)
- `apps/web-backoffice/src/components/layouts/organizer-breadcrumbs.tsx` (composant render)

Mounted dans `(dashboard)/layout.tsx` au-dessus de `<main>`, sous la TopBar et la bannière d'annonce. Auto-dérive la chaîne breadcrumb à partir de :

1. le `pathname` courant ;
2. la taxonomie role-filtered (`useOrganizerNav`) ;
3. le titre de l'événement courant (via `useEvent(eventId)` — cache hit la plupart du temps puisque la fiche event utilise la même query).

Algorithme `deriveBreadcrumbs` :

- Routes de landing (`/dashboard`, `/inbox`, `/`) → `shouldRender: false` (panneau invisible).
- Routes `/events/...` → branche dédiée (`Événements`, titre d'event résolu, sous-sections humanisées).
- Routes nav-mappées → match sur la **plus longue href** préfixe — `/organization/billing` matche directement Facturation (terminal) plutôt que `Organisation › Facturation`.
- Segments inconnus → fallback humanisé (`multi-word-page` → `Multi word page`).

**Migration** : 5 pages qui hand-rollaient leur propre breadcrumb (`communications`, `badges`, `notifications`, `venues`, `settings`) ont été mises à jour pour s'appuyer exclusivement sur le panneau global. Les imports `Breadcrumb*` de `@teranga/shared-ui` ont été retirés de ces pages, ainsi que les imports `Link` orphelins.

### 5. Command palette consomme la taxonomie

**Fichier** : `apps/web-backoffice/src/components/command-palette.tsx`

Les commandes "Pages" sont désormais dérivées de `useOrganizerNav().allItems` (déjà role-filtered, exclut `comingSoon`). La constante statique `PAGE_COMMANDS` a été remplacée par `PALETTE_EXTRA_PAGES` qui ne contient que les entrées **palette-only** (ex: "Nouvel événement"). Les commandes "Actions" (logout, créer un événement) restent inchangées.

Conséquence : l'ajout d'une route dans la nav taxonomy propage automatiquement vers la sidebar **et** la palette **et** les breadcrumbs — drift impossible.

## Couverture de tests

37 nouveaux tests, tous passants avec la suite existante (166/166) :

| Fichier de test                                            | Tests | Cible                                                                                                               |
| ---------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/__tests__/use-organizer-nav.test.tsx`           |    11 | role-filter (organizer / co-organizer / venue / super_admin / combinés / vide), structure invariants                |
| `src/components/layouts/__tests__/event-switcher.test.tsx` |    12 | bucketing live/upcoming/drafts, exclusions cancelled/completed/archived/passé, ordering, normalisation diacritiques |
| `src/hooks/__tests__/use-organizer-breadcrumbs.test.tsx`   |    14 | landings hidden, nav routes, events branche, fallback humanisé, plus-long-préfixe                                   |

**Pattern** : la logique pure vit dans des fichiers `*-utils.ts` séparés des React hooks/composants pour permettre l'exécution test sans booter Firebase. Les hooks React sont des wrappers minces (8-15 lignes) autour des helpers.

## Décisions de design

### Pourquoi un hook plutôt qu'un export statique pour la nav ?

La taxonomie elle-même est statique, mais chaque consommateur (sidebar, palette, breadcrumbs, switcher) a besoin du **même** view-model role-filtered. Centraliser le filtrage dans un hook garantit qu'un co-organizer ne voit jamais `Finance` dans la sidebar **et** ne reçoit jamais de suggestion `/finance` dans la palette — la drift entre ces surfaces est exactement la friction `F1` du `PLAN.md`.

### Pourquoi le state `collapsed` est-il persisté ?

Mirror du choix admin (`teranga:admin:sidebar:collapsed`) : un opérateur qui préfère une rail compacte la garde entre sessions. La clé est **séparée** par shell (`teranga:organizer:sidebar:collapsed`) parce qu'un super-admin qui bascule entre admin et organizer peut vouloir des préférences différentes — la sidebar admin est plus dense (4 niveaux Client/Billing/Platform/Settings + ~20 entrées), la sidebar organizer plus aérée.

### Pourquoi l'event switcher est-il limité à 50 events ?

C'est le **working set réaliste** d'un organisateur Pro (5–15 events/an, dont ~3 actifs en parallèle). Au-delà, le switcher devient une mauvaise UX (même avec search) et l'opérateur se reportera de toute façon sur `/events`. Cette limite évite par ailleurs un `useEvents({ limit: 1000 })` qui ferait 1 read Firestore × 1000 sur chaque ouverture du dropdown.

### Pourquoi le switcher exclut-il les events `published` passés ?

Le contrat est "destinations actionnables". Un event publié dont la fenêtre est terminée (mais oublié de marquer `completed`) n'est pas un switch target — l'opérateur ira sur `/events` pour faire le ménage. Le switcher reste léger et orienté "où je travaille **maintenant**".

### Pourquoi la branche `/events/[id]/...` est-elle spéciale dans `deriveBreadcrumbs` ?

Trois raisons :

1. Le segment `[id]` est un identifiant opaque, pas un libellé — il faut le résoudre vers le titre via `useEvent(id)`.
2. La hiérarchie sémantique est `Événements › [Nom] › Sous-section` et non `Événements › id › sous-section` ; un walk naïf produirait la seconde forme.
3. Les sous-sections (`checkin`, `history`, `registrations`, …) ont des libellés idiomatiques en français (`Check-in`, `Historique`, `Inscriptions`) plutôt que la version humanisée brute.

### Pourquoi `comingSoon` plutôt que de retirer l'entrée Inbox ?

Trois bénéfices :

1. La section `Mon espace` reste non-vide pendant la fenêtre O1 → O2 (sinon elle apparaît seulement en O2 et l'IA a un trou visible).
2. Le pattern signale aux opérateurs l'arrivée de la surface — un teaser visuel, conforme à la doctrine Teranga "defer to plan gating, never to hiding" appliquée aux phases.
3. Mirror du pattern `admin-sidebar.tsx` qui utilise déjà `comingSoon` — convention transversale.

## Suites pour O2

- `/inbox/page.tsx` à créer — la nav taxonomy est déjà en place, il suffira de retirer `comingSoon: true` de l'entrée et d'implémenter la page.
- Quand O2 livre, `HIDDEN_PATHS` dans `use-organizer-breadcrumbs-utils.ts` continuera à masquer le panneau breadcrumbs sur `/inbox` (le path est déjà dans la liste).
- L'auto-refresh du panneau inbox suivra le pattern admin (60s + exponential backoff).

## Vérification

```bash
cd apps/web-backoffice
npx tsc --noEmit         # TypeScript clean
npx vitest run           # 166 tests passent (dont 37 nouveaux)
npm run lint             # à exécuter avant push
```

Manual QA recommandé :

- [ ] Sidebar collapse / expand persiste après refresh.
- [ ] Co-organizer ne voit ni `Finance` ni `Organisation` ni `Lieux`.
- [ ] Venue manager voit uniquement la section `Lieux`.
- [ ] `⌘⇧E` ouvre le switcher depuis n'importe quelle page event-scoped.
- [ ] Breadcrumb sur `/events/[id]/checkin/history` lit `Tableau de bord › Événements › [Titre] › Check-in › Historique` avec `Check-in` cliquable.
- [ ] L'entrée Inbox apparaît grisée avec pill `Bientôt` jusqu'à O2.
