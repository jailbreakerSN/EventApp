# Organizer UX Overhaul — Réflexion stratégique, analyse et plan multi-phases

> **Contexte** : refonte UX/UI du back-office organisateur (et co-organisateur) Teranga pour atteindre un niveau "SaaS événementiel complet" comparable à Eventbrite / Bizzabo / Splash, adapté au marché sénégalais et francophone d'Afrique de l'Ouest. L'audit overhaul du super-admin étant finalisé (cf. `docs/archive/2026-04/admin-overhaul-PLAN.md`), ce document applique la même rigueur au persona organisateur.
>
> **Total estimé** : 44 JP. Découpage en 10 phases atomiques (O1 → O10), chacune indépendamment livrable et mergeable.
>
> **Date** : 2026-04-26.

> *« Un SaaS d'événementiel ne vend pas une interface, il vend du temps rendu à l'organisateur : chaque clic économisé le jour J, chaque email envoyé automatiquement la veille, chaque décision éclairée par un chiffre vérifié. »*

---

## 1. Reformulation de la question

La demande initiale était formulée comme *« comment améliorer l'UX/UI organisateur »*. En réalité elle porte **trois questions imbriquées** qui se ressemblent mais n'ont pas la même réponse — et il faut trancher ces questions pour que le plan qui suit soit autre chose qu'une liste de courses.

1. **Question de posture (IA — Information Architecture)** : quelle est la *bonne métaphore mentale* pour l'organisateur ? On a aujourd'hui une IA **orientée-objet** (Événements / Participants / Badges / Finance). La littérature SaaS événementielle (Eventbrite, Bizzabo, Splash, Hopin, Sessionize) a basculé il y a ~5 ans vers une IA **orientée-cycle-de-vie** (Concevoir / Lancer / Remplir / Délivrer / Débriefer). L'organisateur ne se demande pas « où est mon objet événement ? » — il se demande « qu'est-ce que je dois faire aujourd'hui, pour cet événement précis, à J-12 ? ».

2. **Question de densité** : sur chaque écran, **quel est le ratio signal/bruit** ? La fiche-événement a aujourd'hui 10 onglets (Infos / Billets / Inscriptions / Paiements / Sessions / Feed / Zones / Intervenants / Sponsors / Promos). À partir de 7, le cerveau traite les onglets comme une barre d'outils, plus comme des espaces. C'est une odeur classique de sur-capacité sous-structurée.

3. **Question de capacité** : **qu'est-ce qu'on n'a pas** qu'un SaaS d'événementiel complet *doit* avoir en 2026 — pas pour « avoir tout », mais pour tenir la promesse implicite faite à l'organisateur sénégalais : **« tu gères ton événement, on gère la logistique invisible »** (WhatsApp pour les rappels, Wave/OM pour les paiements, mode hors-ligne pour le check-in, rapport post-event généré tout seul).

Le plan qui suit sépare ces trois questions et les traite dans cet ordre — IA d'abord (parce que c'est structurant), densité ensuite (parce qu'elle préside à l'expérience quotidienne), capacités enfin (parce qu'elles se branchent sur une IA saine, pas l'inverse).

---

## 2. Cadre d'analyse — 4 personas × 5 moments du cycle

Avant de décider quoi livrer, il faut décider **pour qui** et **quand**. L'erreur classique serait de concevoir pour « l'organisateur » générique. Sur Teranga on a en réalité **4 personas** bien distincts :

| Persona | Plan type | Volume | Attentes structurantes |
|---|---|---|---|
| **Solo orga** (pasteur, prof, entrepreneur) | Free / Starter | 1–3 events/an | Guidance, templates, zéro courbe d'apprentissage, WhatsApp natif |
| **Ops-first orga** (agence, entreprise) | Pro | 5–15 events/an | Productivité, réutilisation, analytics, dédup participants |
| **Corporate orga** (Sonatel, ministère) | Enterprise | 20+ events/an | Compliance, branding, multi-équipe, workflows d'approbation |
| **Co-organisateur** (scopé événement) | — | 1 event à la fois | Vision tunnel, pas de bruit org, handoff simple depuis l'orga principal |

Et **5 moments** du cycle de vie événement, qui déterminent chacun un pic d'usage différent :

| Moment | T- | Actions dominantes | Métrique organisateur |
|---|---|---|---|
| **Design** | J-90 → J-30 | Créer, configurer billets, trouver lieu, définir programme | *Event health score* ≥ 60 |
| **Launch** | J-30 → J-7 | Publier, promouvoir, encaisser, répondre FAQ | Pace d'inscription vs objectif |
| **Fill** | J-14 → J-1 | Relancer, gérer liste d'attente, anticiper logistique | Taux de remplissage vs capacité |
| **Deliver** | J-0 | Check-in, gestion incidents, animation, staff | Latence scan, inscrits présents |
| **Debrief** | J+1 → J+30 | Payout, remerciements, analytics, cohorte | NPS, revenu réconcilié, taux rétention |

Chaque feature proposée ci-dessous est **tag**ée avec le(s) moment(s) du cycle qu'elle sert. C'est ce qui permet d'arbitrer sans biais « plus de features = mieux ».

---

## 3. État des lieux — ce qui existe (audit factuel)

L'inventaire ci-dessous vient de l'exploration directe du code.

### 3.1 Surfaces déjà en place (le compliment sincère)

- **Sidebar organisateur** (`sidebar.tsx`) — 11 entrées, filtrage par rôle (`organizer` / `co_organizer` / `venue_manager` / `super_admin`), widget de plan avec jauges d'usage.
- **Command palette ⌘K** — montée dans le layout, ~20 commandes de navigation + logout.
- **Notification center** — cloche topbar avec badge unread, pagination, flux temps-réel via `useNotificationLiveStream`.
- **Keyboard shortcuts dialog** — déclenché par `?`, grouping Navigation/Actions.
- **Breadcrumbs** — pattern appliqué sur fiche-événement et settings.
- **Plan gating cohérent** — `PlanGate` avec trois modes (blur soft-paywall / disabled / hidden), toutes les CTAs vont vers `/organization/billing`.
- **Couverture fonctionnelle event-scoped** — 10 onglets couvrant billets, inscriptions, paiements, sessions, feed, zones, intervenants, sponsors, promos. C'est **déjà très fourni**.
- **Check-in live + historique** — `/events/[id]/checkin` et `/events/[id]/checkin/history`, avec mode hors-ligne côté mobile.
- **Équipe & invitations** — `/organization` avec CRUD membres + invites en attente, attribution de rôles (owner/admin/member/viewer).
- **Export CSV + refund flow + waitlist** — tous présents et gated correctement.

**Verdict factuel** : la couverture fonctionnelle est d'un SaaS de milieu-de-gamme honnête. Ce n'est pas un MVP. C'est une surface en attente d'être *structurée*.

### 3.2 Frictions identifiées (diagnostic sans complaisance)

| # | Friction | Impact | Sévérité |
|---|---|---|---|
| **F1** | Sidebar plate à 11 entrées sans sections — devient illisible dès qu'on ajoute 3 items | ↘ Scanabilité, recherche visuelle | P1 |
| **F2** | Fiche-événement = 10 onglets sans regroupement thématique | Tab fatigue, onglets cachés sur tablette | P1 |
| **F3** | IA orientée-objet vs. mental model cycle-de-vie | Aucune landing « qu'est-ce que je dois faire aujourd'hui ? » | P0 |
| **F4** | Pas de switcher événement global (pour naviguer vite entre events actifs) | Clics en trop pour les ops-first organisateurs | P1 |
| **F5** | Bulk actions limitées à « promote waitlist » | Tâches répétitives : tag, email, check-in manuel, export subset | P1 |
| **F6** | Pas de saved views / filtres persistés | Le même filtre ré-appliqué à chaque event | P2 |
| **F7** | Pas d'inbox / tâches pour l'organisateur | Les alertes (waitlist saturée, paiement en échec, venue non confirmé) passent sous le radar | P0 |
| **F8** | Pas de recherche globale cross-events (participants, sessions, billets) | Sur 10 events actifs, retrouver « Fatou Diop » = navigation séquentielle | P1 |
| **F9** | Pas de timeline de communications (planifié + envoyé + auto) | Aucune vue « qu'est-ce que reçoit le participant cette semaine ? » | P1 |
| **F10** | Pas de templates d'événements (starter kits) | Chaque création part de zéro, clone existe mais n'est pas guidé | P2 |
| **F11** | Pas d'*Event Health Score* — organisateur navigue à l'aveugle avant J-0 | Détection tardive d'un événement qui ne va pas remplir | P0 |
| **F12** | Speaker/Sponsor portals gated mais *dead routes* en free tier (accessible via URL) | Surface incohérente, feature discovery cassée | P2 |
| **F13** | Pas de rapport post-event exportable (PDF) | L'organisateur doit composer le bilan à la main pour ses sponsors | P1 |
| **F14** | Comms : SMS gated, WhatsApp absent (alors que c'est LE canal au Sénégal) | Écart marché → organisateur fait le rappel WhatsApp *à la main* | P0 |
| **F15** | Check-in floor-ops limité : pas de vue staff-radio, pas d'emergency broadcast, pas de file d'attente scan | Le jour-J se joue sur cette UX, aujourd'hui pauvre | P1 |
| **F16** | Pas de detection de doublons participants (email/téléphone normalisés) | Double inscription sur same person crée un biais de données | P2 |
| **F17** | Co-organizer experience = organizer moins quelques items — pas une vue pensée pour lui | Le co-org voit trop de chrome org, risque de confusion | P1 |

### 3.3 Manques par rapport à un SaaS complet (gap vs. benchmark)

Benchmarks référents : **Eventbrite** (volumes / simplicité), **Bizzabo** (corporate / branding), **Splash** (marketing-led), **Hopin** (hybride / live), **Sessionize** (speakers-centric). Adapté au contexte sénégalais + `CLAUDE.md`.

#### 3.3.1 MUST-HAVE (écart bloquant vs positionnement « SaaS complet »)

| # | Manque | Cycle | Justification |
|---|---|---|---|
| M1 | **Event Health Score** + dashboard par event | Design / Launch / Fill | C'est le signal n°1 qu'un orga Pro achète |
| M2 | **Organizer Inbox** task-oriented (J-0 today page) | Tous | Pivot IA — ne peut pas attendre |
| M3 | **Comms center unifié** (broadcasts + scheduled + lifecycle nudges) | Launch / Fill / Debrief | L'organisateur doit voir *tout* ce qui part |
| M4 | **Templates d'événements** (workshop / conférence / gala / culte) | Design | Réduit time-to-first-event de 20min → 3min |
| M5 | **Post-event report PDF** auto-généré | Debrief | Livrable attendu par les sponsors et la direction |
| M6 | **WhatsApp Business API** (canal primaire au Sénégal) | Fill | Écart marché — différenciation Teranga |
| M7 | **Global search ⌘K étendu** (participants, sessions, billets) | Tous | Aujourd'hui limité à la navigation |
| M8 | **Lifecycle-aware sidebar** (sections : Mon espace / Événements / Audience / Finance / Paramètres) | Tous | Refonte IA — base de tout |
| M9 | **Participant 360°** (toutes les registrations + paiements + feedbacks cross-events) | Tous | Brique de fidélisation |
| M10 | **Bulk actions participants** (tag, email ciblé, check-in manuel, exporter sous-ensemble) | Fill / Deliver | Productivité ops-first |
| M11 | **Event switcher global** (dropdown accessible depuis toute page event-scoped) | Tous | Organisateurs Pro gèrent 3+ events actifs en parallèle |
| M12 | **Co-organizer scoped shell** (UI qui ne montre QUE l'event qui lui est confié) | Tous | Rôle existe mais UX non pensée |
| M13 | **Live event mode / Floor Ops** (check-in dashboard, queue, alerts staff) | Deliver | Le jour-J est le moment de vérité |
| M14 | **Event-health pacing chart** (inscriptions cumulées vs trajectoire attendue) | Launch / Fill | Alerte préventive |
| M15 | **Financial reconciliation** (revenu attendu vs encaissé vs net de remboursements) | Debrief | Blocage pour enterprise |

#### 3.3.2 NICE-TO-HAVE (enrichissent, ne débloquent pas)

| # | Nice-to-have | Valeur perçue | Effort |
|---|---|---|---|
| N1 | AI event copilot (description auto, email templates, FAQ) | Différenciateur premium | ⬤⬤⬤ |
| N2 | Abandoned registration recovery (mail auto J+1 si cart incomplet) | +3-8% conversion | ⬤⬤ |
| N3 | Speaker/Sponsor magic-link invitation (pas de login) | UX speaker ⇧ | ⬤⬤ |
| N4 | Embed widget (iframe registration) | SEO / micro-sites partenaires | ⬤⬤ |
| N5 | Custom domain (`eventname.teranga.events`) | Branding enterprise | ⬤⬤ |
| N6 | NPS + feedback survey auto J+1 | Debrief quality | ⬤ |
| N7 | Networking matchmaker 1:1 (conférences) | Hybride / corporate | ⬤⬤⬤ |
| N8 | Self-check-in kiosk mode (tablette à l'entrée) | Ops enterprise | ⬤⬤ |
| N9 | Referral / ambassador tracking | Marketing-led | ⬤⬤ |
| N10 | Sessionize-like agenda builder (multi-track) | Conférences complexes | ⬤⬤⬤ |
| N11 | Print-on-badge integration (imprimante thermique) | Ops enterprise | ⬤⬤ |
| N12 | Live-stream integration (Zoom / Restream binding) | Hybride | ⬤⬤ |

---

## 4. Doctrine de design (principes directeurs)

Avant les phases, le contrat qu'elles respectent toutes :

1. **Task > Object.** La landing organisateur est une *todo list intelligente*, pas un dashboard de métriques. (Cohérence avec ce qu'on vient de livrer côté admin avec `/admin/inbox`.)
2. **Lifecycle > Feature map.** Chaque écran répond implicitement à *« on est où dans le cycle ? »* — mini-badge `J-12` visible en permanence sur la fiche-événement.
3. **Progressive disclosure.** L'événement simple (workshop de 30 personnes) doit être créable en 3 minutes ; l'événement complexe (conférence 500 pax) doit être *possible* sans changer d'outil.
4. **Francophone-first, West-African-aware.** WhatsApp > email, XOF natif, `Africa/Dakar`, tolérance réseau (loading states généreux, queueing offline).
5. **Defer to plan gating, never to hiding.** Un speaker portal gated doit afficher un teaser de la valeur + CTA upgrade ; jamais un 404 silencieux.
6. **Co-organizer is NOT organizer-minus.** C'est une persona à part entière, pas une version dégradée ; son shell doit lui parler.
7. **Every mutating action = audit + domain event + toast + undo (when possible).** Cohérence backend, parité admin.
8. **Mobile-first on 3 surfaces : check-in, notifications, floor-ops.** Le reste peut rester tablette.

---

## 5. Plan multi-phases (10 phases, ~6–8 semaines de delivery)

**Stratégie de découpage** : chaque phase est **indépendamment livrable et mergeable**, ordre non-strict (certaines phases peuvent paralléliser). Chaque phase porte un **objectif mesurable**, pas seulement une liste d'écrans.

### Phase O1 — Fondations IA : Sidebar sectionnée + Event Switcher

**Objectif mesurable** : réduire la distance moyenne entre deux tâches fréquentes de 3 clics → 1 clic.

- Sidebar restructurée en 5 sections : **Mon espace** (Inbox, Dashboard) / **Événements** (Liste, Création) / **Audience** (Participants, Communications, Badges) / **Business** (Finance, Analytics, Organisation) / **Paramètres** (Settings, Billing).
- **Event switcher global** : dropdown dans la topbar accessible depuis n'importe quel écran event-scoped — liste des événements actifs + published + upcoming, ⌘⇧E raccourci.
- Breadcrumbs uniformisés (`Teranga › Événements › [Nom] › Inscriptions`).
- Hook `useOrganizerNav()` comme source unique de vérité navigation.
- **Livrables** : `sidebar.tsx` refactoré, `event-switcher.tsx` nouveau, hook.
- **Tests** : permission-matrix snapshot mis à jour.
- **Effort** : 2 JP.

### Phase O2 — Organizer Inbox (landing task-oriented)

**Objectif mesurable** : l'organisateur qui se connecte voit en <2s les 3 actions prioritaires du jour, sans cliquer.

- Nouvelle route `/inbox` devenant la landing par défaut post-login (remplace `/dashboard`).
- 6 catégories de signaux :
  - **Urgent** (paiement échoué, venue non confirmé J-7, check-in non configuré J-1)
  - **Aujourd'hui** (events live, publications prévues)
  - **Cette semaine** (campagnes à lancer, paiements pending)
  - **Croissance** (near-limit plan, opportunités d'upsell)
  - **Modération** (speakers à valider, messages FAQ)
  - **Équipe** (invites en attente, rôles à réviser)
- Chaque signal a un CTA pré-filtré qui deep-linke directement sur l'écran d'action.
- Auto-refresh 60s + exponential backoff (pattern admin).
- Widget « Event of the day » quand un événement se tient aujourd'hui (bascule vers Live mode).
- **Livrables** : `/inbox/page.tsx`, `inbox.service.ts` côté API (équivalent `getInboxSignals` admin), 6 Firestore `count()` parallélisés, 6 tests.
- **Effort** : 3 JP.

### Phase O3 — Event Health Score + Pacing Chart

**Objectif mesurable** : détection 7 jours plus tôt des événements à risque (remplissage < 30% à J-14).

- **Algorithme Health Score** (0–100) composite : publication (20), tickets configurés (10), venue confirmée (10), pace d'inscription (25), comms actives (15), staff assigné (10), check-in prêt (10).
- Affiché en gros sur la fiche-événement (jauge colorée) + badge dans la liste.
- **Pacing chart** (ligne) : inscriptions cumulées vs trajectoire attendue (basée sur l'historique d'events similaires, ou courbe par défaut J-30 → J-0).
- Alerte inbox dès que le score chute sous 60 ou la pacing sous 70% du prévisionnel.
- **Livrables** : `event-health.service.ts`, composant `<HealthGauge />`, `<PacingChart />` sans lib externe (SVG).
- **Effort** : 4 JP.

### Phase O4 — Event Hub refactor (onglets → sections + sommaire)

**Objectif mesurable** : réduire de 10 à 6 onglets visibles, 0 tab invisible sur tablette 768px.

- Regrouper les 10 onglets en **4 grands tabs + sommaire event-scoped** :
  1. **Vue d'ensemble** (health, pacing, actions prioritaires) — *nouveau, remplace Infos en landing*
  2. **Configuration** (Infos / Billets / Sessions / Zones / Promos) — sous-nav secondaire
  3. **Audience** (Inscriptions / Intervenants / Sponsors) — sous-nav secondaire
  4. **Opérations** (Paiements / Feed / Check-in)
- Chaque tab secondaire rend un layout commun (`<EventSubLayout>`) avec header + sous-sidebar.
- **Livrables** : refacto `/events/[id]/page.tsx` en route hiérarchique `/events/[id]/[section]/[subpage]`, `<EventSubLayout>` réutilisable.
- **Effort** : 4 JP.

### Phase O5 — Comms Center unifié

**Objectif mesurable** : l'organisateur voit en une vue *tout* ce qui part (broadcasts + scheduled + lifecycle auto + reminders).

- Nouvelle route `/communications` devenant un **Comms Center** (liste des sends + composer + templates + timeline par participant).
- **Timeline par événement** (gantt horizontal) : toutes les comms prévues / envoyées, couleur par canal (email / SMS / push / WhatsApp).
- **Composer unifié** : multi-canal avec preview, A/B testing basique, segmentation (tous / confirmés / waitlist / sessions spécifiques).
- **Template library** : 12 templates pré-écrits FR (rappel J-7, rappel J-1, confirmation paiement, liste d'attente promue, feedback J+1, etc.).
- **Livrables** : refacto `/communications`, composant `<CommsTimeline>`, `<CommsComposer>`, seed des templates dans Firestore.
- **Effort** : 5 JP.

### Phase O6 — WhatsApp Business API (différenciateur marché)

**Objectif mesurable** : 1er canal par adoption sur les 3 mois post-lancement.

- Intégration **WhatsApp Business Cloud API** (Meta) ou **Africa's Talking** WhatsApp comme alternative.
- Nouveau channel dans `notification.channel` + template library dédiée (WhatsApp impose des templates pré-approuvés).
- Opt-in explicite côté participant (RGPD + Meta policy).
- Gating : `features.whatsappNotifications` (Pro+), pricing per-message.
- **Livrables** : `whatsapp.channel.ts`, template registry, flows consentement, webhook delivery receipts, 8 tests.
- **Effort** : 5 JP.
- **Risque** : homologation Meta Business peut prendre 2–4 semaines — lancer en parallèle P1.

### Phase O7 — Participant Ops : bulk actions + saved views + dédup

**Objectif mesurable** : réduire de 80% le temps d'un workflow « relancer les non-payés » (aujourd'hui 45 min → cible 5 min).

- **Bulk selection** généralisée sur la table Inscriptions (checkbox + shift-click + select-all-filtered) avec actions : **email ciblé, tag, check-in manuel, exporter CSV du sous-ensemble, annuler inscriptions, envoyer WhatsApp**.
- **Saved views** : filtres persistés (localStorage + Firestore pour team share), raccourcis clavier `1-9`.
- **Dedup / merge UI** : détection de doublons (email/phone normalisés), proposition de merge avec conservation du premier enregistrement, audit.
- **Tags & notes** : chaque participant peut porter des tags libres + note organisateur (non-visible pour lui).
- **Livrables** : hook `useBulkSelection` généralisé, `<SavedViewsMenu>`, `merge-participant.service.ts`, Firestore `participants/{uid}/tags`.
- **Effort** : 5 JP.

### Phase O8 — Live Event Mode (Floor Ops)

**Objectif mesurable** : le jour-J, 1 clic pour basculer l'interface en mode « événement en cours », avec ops dashboard temps-réel.

- **Bouton « Lancer le mode live »** sur la fiche-événement (actif uniquement J-0 à J+6h).
- **Dashboard live** : scan rate (par staff), queue d'attente entrée, no-show estimé, incidents signalés, staff connectés.
- **Emergency broadcast** : un bouton pour pousser un message vers tous les participants sur place (WhatsApp + SMS + push simultané) — audit strict.
- **Staff radio** : chat interne staff scoped au temps de l'événement (Firestore realtime).
- **Incident log** : registre des signalements (retard, vol, médical), chacun loggé + assignable.
- **Mode kiosk self-check-in** : tablette à l'entrée, participant scanne son propre QR.
- **Livrables** : `/events/[id]/live/page.tsx`, `<ScanRateChart>`, `<StaffRadio>`, `<IncidentLog>`, `emergency-broadcast.service.ts`.
- **Effort** : 6 JP.

### Phase O9 — Post-event Report + Financial Reconciliation

**Objectif mesurable** : rapport PDF livrable aux sponsors en 1 clic, J+1.

- **Rapport PDF auto-généré** J+24h : attendance (registered / checked-in / no-show), breakdown démographique (zones, genres, canaux d'acquisition), comms performance (open / click), NPS, financial summary.
- **Financial reconciliation** : vue dédiée croisant `Paiements reçus × Remboursements × Frais plateforme × Net à verser à l'organisateur`.
- **Payout request** (stub, intégration Wave/OM en P10) : bouton « Demander le virement » avec statut.
- **Cohort export** : CSV des participants segmentés (présents vs absents vs promoteurs NPS), prêt pour campagne de fidélisation.
- **Livrables** : `post-event-report.service.ts` (génération PDF via pdfmake ou puppeteer), `<ReconciliationTable>`, `payout.service.ts`.
- **Effort** : 5 JP.

### Phase O10 — Event Templates, Co-organizer Shell, Speaker/Sponsor Magic-Links

**Objectif mesurable** : 3 améliorations ciblées qui ferment des gaps persona-specific.

- **Starter templates** : 8 templates (Workshop / Conférence / Gala / Hackathon / Kickoff interne / Cours en ligne / Événement religieux / Mariage-baptême) avec pré-config tickets, sessions, comms timeline.
- **Co-organizer scoped shell** : sidebar réduite à l'événement confié, dashboard racine = Vue d'ensemble de CE seul event, pas de Finance / Organisation / Billing.
- **Speaker/Sponsor magic-link** : invitation sans login, lien personnel, édition bio / photo / documents, validation par l'organisateur.
- **Livrables** : `event-templates.service.ts` + catalogue en shared-types, `useCoOrganizerScope()` hook, `magic-link.service.ts` (HMAC-signé, 48h TTL), 3 tests.
- **Effort** : 5 JP.

---

## 6. Vue d'ensemble du plan

### 6.1 Timeline proposée (6–8 semaines)

```
Semaine 1  │ O1 Fondations IA         ██ 2 JP
Semaine 2  │ O2 Inbox                 ███ 3 JP
           │ O3 Health Score          ████ 4 JP   (parallèle)
Semaine 3  │ O4 Event Hub refactor    ████ 4 JP
Semaine 4  │ O5 Comms Center          █████ 5 JP
           │ O6 WhatsApp (lead-time)  █████ 5 JP  (parallèle, homologation)
Semaine 5  │ O7 Participant Ops       █████ 5 JP
Semaine 6  │ O8 Live Event Mode       ██████ 6 JP
Semaine 7  │ O9 Post-event + Reconcil █████ 5 JP
Semaine 8  │ O10 Templates + co-org   █████ 5 JP
Total delivery                              44 JP
```

**Critical path** : O1 → O2 → O4 → O8 (les autres phases peuvent paralléliser).

### 6.2 Ordre d'arbitrage (si pressé)

Si on ne peut livrer que **3 phases** : **O1 + O2 + O6** (IA + Inbox + WhatsApp) — c'est le triptyque qui change la perception du produit.

Si on ne peut livrer que **5 phases** : ajouter **O3 (Health Score) + O7 (Bulk ops)** — couvre la promesse « Pro ».

Le cœur enterprise (O8 Live + O9 Report) peut attendre Wave 10 si nécessaire, mais pas au-delà.

### 6.3 Métriques de succès post-livraison

| Métrique | Baseline | Cible post-plan |
|---|---|---|
| Time-to-first-event (création → publication) | ~25 min | **< 5 min** (templates) |
| Time-to-health-60 (publication → event viable) | opaque | **J+3 max** (score visible) |
| Taux check-in J-0 | inconnu | **> 85 %** (reminders WhatsApp J-1) |
| Session médiane organisateur post-inbox | ~4 min (dashboard) | **< 90s** (inbox) |
| Clic pour basculer entre 2 events actifs | 3 | **1** (switcher) |
| NPS organisateur (enquête post-event) | non mesuré | **> 40** |

### 6.4 Principes de validation avant merge (par phase)

Chaque phase doit passer :

- [ ] `tsc --noEmit` clean
- [ ] Tests unitaires + route tests (cible : +5 à +15 tests par phase selon surface)
- [ ] `@security-reviewer` + `@firestore-transaction-auditor` + `@domain-event-auditor` + `@plan-limit-auditor` + `@l10n-auditor`
- [ ] Revue UX via `teranga-design-review` skill (contrastes, WCAG 2.1 AA, mobile 768px)
- [ ] Seed data mis à jour pour rendre la feature démontrable sans action manuelle
- [ ] Documentation : mise à jour `docs/organizer-overhaul/*` après chaque phase

---

## 7. Ce que ce plan ne couvre PAS (pour être honnête)

- **Pricing / packaging des features** (quel feature va dans quel plan) — c'est une décision business, pas design. À traiter dans un doc séparé avec le product owner.
- **L'app mobile organisateur** — elle est en Wave 9 (Flutter), out-of-scope de cet exercice web.
- **L'app participant-facing** (`apps/web-participant`) — out-of-scope, mais plusieurs phases ici impliquent des changements côté participant (magic-links speaker, WhatsApp opt-in). À coordonner.
- **Les intégrations paiement Wave / OM / Free Money** — prévues Wave 6, supposées faites avant O9 (reconciliation repose dessus).
- **L'AI copilot (N1)** — volontairement mis en nice-to-have : c'est un chantier de 3-4 semaines qui mérite sa propre réflexion (choix LLM, privacy, coût tokens).

---

## 8. Workflow de delivery

- **Branch** : `claude/audit-organizer-user-qFbg1` (toutes les phases vivent ici jusqu'à PR finale).
- **Cadence** : batches comme proposé (O1+O2 premier batch, puis O3, etc.), avec **commit + push à chaque étape** (plan, puis chaque phase).
- **Pas de PR créée tant que l'utilisateur ne le demande pas explicitement.** À chaque push, si une PR existe, elle est mise à jour via `mcp__github__update_pull_request` pour refléter le scope cumulatif.
- **Aucun resserrement de scope** : chaque phase est livrée à son périmètre nominal complet — la rapidité n'est jamais un argument pour réduire un livrable.

