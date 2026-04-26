# O10 — Event Templates, Co-organizer Shell, Speaker/Sponsor Magic-Links

> **Phase O10** du plan `PLAN.md`. Trois améliorations ciblées qui ferment les derniers gaps persona-specific : 8 starter templates pour réduire le time-to-first-event, un shell co-organizer scopé à un événement, et des magic-links HMAC-signés pour intervenants + sponsors.

## Objectif mesurable

> **Time-to-first-event** : un nouvel organisateur passe de la page d'accueil à un événement configuré en moins de **3 minutes** via un template. **Co-organizer scoping** : un co-organisateur ne voit que son événement assigné. **Speaker / Sponsor onboarding** : édition de profil sans création de compte (lien magic 48 h).

## Architecture

### Shared types

**`packages/shared-types/src/event-template.types.ts`** (nouveau, ~100 lignes) :

- `EventTemplateSchema` : id (kebab-case URL-safe) + category + label + tagline + description + icon (allowlist) + defaultDurationHours + ticketTypes (relatifs) + sessions (offsetMinutes) + commsBlueprint (offsetDays).
- `TemplateTicketTypeSchema` : prix XOF, capacité, `saleOpensOffsetDays` relatif.
- `TemplateSessionSchema` : `offsetMinutes` + `durationMinutes` (résolus à clone-time).
- `TemplateCommsBlueprintSchema` : channel + offsetDays + FR title/body.
- `CloneFromTemplateSchema` : DTO opérateur (templateId, title, startDate, organizationId, optional endDate + venueName).
- Helper pur `resolveTemplateEndDate()` : `endDate` ou `startDate + defaultDurationHours`.

**`packages/shared-types/src/event-template-catalog.ts`** (nouveau, ~360 lignes) :

- 8 templates calibrés pour le marché sénégalais : `workshop`, `conference`, `gala`, `hackathon`, `kickoff-interne`, `cours-en-ligne`, `evenement-religieux`, `mariage-bapteme`.
- Helper `findTemplate(id)` : O(1) lookup, retourne `null` (no-throw).

**`packages/shared-types/src/magic-link.types.ts`** (nouveau, ~70 lignes) :

- `MagicLinkSchema` : id = SHA-256 hash du token plaintext, role (speaker / sponsor), resourceId, eventId, organizationId, recipientEmail, expiresAt, firstUsedAt, revokedAt.
- `IssueMagicLinkSchema` : DTO d'émission avec TTL configurable (défaut 48 h, cap 168 h).
- `MagicLinkVerifyResponseSchema` : payload retourné par `/verify` (sans le hash, sans le token).

**`packages/shared-types/src/audit.types.ts`** : 4 nouveaux `AuditAction` — `event.cloned_from_template`, `magic_link.issued`, `magic_link.revoked`, `magic_link.used`.

### Backend

**`event-template.service.ts`** (~200 lignes)

- `list(user)` : permission `event:create`. Catalogue statique (no Firestore).
- `cloneFromTemplate(dto, user)` : permission `event:create`. Délègue à `eventService.create` (donc plan-limit + slug + qrKid + audit `event.created` centralisés) puis crée les sessions via `sessionService.create` (failures per-row tolérées avec `process.stderr.write`). Émet `event.cloned_from_template` après.
- Helpers purs exportés et testés isolément : `materialiseTicketTypes()`, `materialiseSessions()`, `materialiseCommsBlueprint()` (offset → ISO).
- Tests : 15 cas (catalogue: structure, ids uniques, blueprints; helpers: round-trip + edge cases).

**`magic-link.service.ts`** (~220 lignes)

- Format token : `v1.<role>.<resourceId>.<eventId>.<expiresBase36>.<sig16>` — 6 parts, dot-delimited, signature HMAC-SHA256 tronquée à 16 hex chars (64 bits).
- `issue(dto, user)` : permission `event:update`. Génère un token, persiste `magicLinks/<sha256(token)>` avec metadata. Émet `magic_link.issued` (recipient email pour audit forensique, jamais le plaintext token).
- `verify(token)` : **UNAUTHENTICATED** (le token EST la credential). `parseToken` HMAC-vérifie en constant-time + lookup hash + checks expiry + revoked. Stamp `firstUsedAt` + émet `magic_link.used` la première fois.
- `revoke(tokenHash, user)` : permission `event:update`. Idempotent.
- Helpers purs `signToken`, `parseToken`, `hashToken` exportés.
- Tests : 12 cas (round-trip, tampered sig, tampered resourceId, wrong version, unknown role, malformed input, expired-but-parseable, secret rotation).

### Routes

**`apps/api/src/routes/event-templates.routes.ts`** :

| Méthode | Path                        | Permission     | Notes                              |
| ------- | --------------------------- | -------------- | ---------------------------------- |
| GET     | `/v1/event-templates`       | `event:create` | Liste les 8 templates du catalogue |
| POST    | `/v1/event-templates/clone` | `event:create` | Crée un événement depuis template  |

**`apps/api/src/routes/magic-links.routes.ts`** :

| Méthode | Path                                | Permission     | Notes                                     |
| ------- | ----------------------------------- | -------------- | ----------------------------------------- |
| POST    | `/v1/magic-links`                   | `event:update` | Émet (token plaintext retourné une fois)  |
| GET     | `/v1/magic-links/verify`            | aucune         | Le token EST la credential (rate-limited) |
| POST    | `/v1/magic-links/:tokenHash/revoke` | `event:update` | Idempotent                                |

`tokenHash` param contraint à `^[a-f0-9]+$/i` (SHA-256 hex) côté Zod — defense in depth contre l'injection chemin Firestore.

### Domain events + audit listener

**`apps/api/src/events/listeners/audit.listener.ts`** : 4 nouveaux handlers — `event.cloned_from_template`, `magic_link.issued`, `magic_link.revoked`, `magic_link.used`. `EXPECTED_HANDLER_COUNT` passé à 116.

**Privacy-first** :

- `magic_link.issued` enregistre `recipientEmail` (forensique : qui a reçu) + `tokenHash` (jamais le plaintext).
- `magic_link.used` : actor = `magic-link:<hash>` (pas de uid utilisateur — la session est anonyme).
- `event.cloned_from_template` : juste `templateId` + counts (sessionsAdded, commsBlueprintsAdded).

**Collection** : `MAGIC_LINKS = "magicLinks"` ajoutée à `apps/api/src/config/firebase.ts`.

### Frontend

#### Hooks

- `apps/web-backoffice/src/hooks/use-event-templates.ts` : `useEventTemplates()` (staleTime 1 h), `useCloneFromTemplate()`.
- `apps/web-backoffice/src/hooks/use-magic-links.ts` : `useIssueMagicLink()`, `useRevokeMagicLink()`, `useVerifyMagicLink(token)` — verify utilise `fetch` direct (pas le bearer token), staleTime 5 min, retry: false.
- `apps/web-backoffice/src/hooks/use-co-organizer-scope.ts` : `useCoOrganizerScope()` — détection `co_organizer` (sans `organizer`) + auto-scope si UN seul événement assigné + `canAccess(section)` runtime guard pour les pages exclues du shell co-organizer.
- `apps/web-backoffice/src/hooks/co-organizer-scope.helpers.ts` (pure helpers) — `deriveCoOrganizerScope()` testable sans Firebase.

#### Composants

| Composant                 | Rôle                                                  | Fichier                                           |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `<TemplateCard/>`         | Card cliquable par template (icon + tagline + stats)  | `components/templates/TemplateCard.tsx`           |
| `<IssueMagicLinkDialog/>` | Dialog 2 étapes (form → token affiché une seule fois) | `components/magic-links/IssueMagicLinkDialog.tsx` |

#### Pages

| Route                           | Layout             | Auth      | Rôle                                    |
| ------------------------------- | ------------------ | --------- | --------------------------------------- |
| `/events/templates`             | dashboard          | organizer | Picker + form de clone                  |
| `/portal/speaker?token=<token>` | aucune (auth-less) | aucun     | Landing page intervenant via magic-link |
| `/portal/sponsor?token=<token>` | aucune (auth-less) | aucun     | Landing page sponsor via magic-link     |

**Décisions de design** :

- **`/portal/*` hors du `(dashboard)` group** — pas de sidebar, pas de redirect d'auth, le token EST la credential. `useVerifyMagicLink` utilise `fetch` direct sans bearer token.
- **Token affiché une seule fois** (mêmes ergonomics que les API keys T2.3) — re-ouvrir le dialog après fermeture force une réémission. La copy "Ne sera pas réaffiché" prévient les opérateurs.
- **Bouton "Envoyer par email"** ouvre un `mailto:` pré-rempli — pas de SMTP propriétaire pour cet artefact, l'opérateur garde la main sur sa messagerie habituelle (mariages / cérémonies religieuses où WhatsApp domine et l'email est secondaire).
- **Sidebar co-organizer trim** déjà acquis depuis O1 (le taxonomy `useOrganizerNav` filtre Finance / Analytics / Organization / Billing / Participants par les `roles`). O10 ajoute `useCoOrganizerScope` pour le runtime guard sur les pages atteignables par URL directe + l'auto-scope dashboard.

## Tests

| Fichier                                                     | Cas | Couvre                                               |
| ----------------------------------------------------------- | --- | ---------------------------------------------------- |
| `event-template.service.test.ts`                            | 15  | Catalogue (structure, ids, blueprints) + helpers     |
| `magic-link.service.test.ts`                                | 12  | HMAC sign/parse + tamper detection + secret rotation |
| `web-backoffice/.../use-co-organizer-scope.test.tsx`        | 5   | Détection role + auto-scope single-event             |
| `web-backoffice/components/templates/TemplateCard.test.tsx` | 4   | Render + plural FR labels + onSelect + aria-pressed  |

**Counts globaux après O10** :

- Backend : 1865 tests passants (+ 27 nouveaux).
- Frontend : 308 tests passants (+ 9 nouveaux).
- Typecheck : `tsc --noEmit` clean sur `apps/api` et `apps/web-backoffice`.
- Snapshots refresh : `route-inventory` (5 lignes), `permission-matrix` (4 perms × 5 endpoints), audit-listener handler count.

## Décisions

1. **HMAC-SHA256 tronqué à 16 hex chars** — 64 bits de signature, défend contre les attaques par devinette aléatoire (1 / 2^64) sans bloater l'URL. Mêmes ergonomics que la signature QR (qui utilise 64 hex pour l'épaisseur scan-context).

2. **Token format `v1.<role>.<resourceId>.<eventId>.<expBase36>.<sig>`** — chaque champ est self-describing (pas besoin de décoder pour comprendre le scope), versioning explicite pour migration future. Comparaison avec JWT : on évite la dépendance lib + l'overhead alg/typ headers ; on perd les claims standard (iat, sub) qu'on n'utilise pas.

3. **Reuse de `QR_SECRET`** — un seul secret HMAC pour QR + magic-links. Rotation = invalidation simultanée des deux (acceptable, organizers peuvent réémettre). Coût d'un second secret = réplication ops, peu de bénéfice.

4. **Pas de single-use** — le lien reste valide pour la TTL window. Un single-use casserait l'UX "fix typo et revenir" qui est typique des sponsors / intervenants. Compensation : revoke explicite + audit `magic_link.used` pour détecter les abus.

5. **8 templates couvrent 95 % des cas** — workshop / conférence / gala / hackathon / kickoff / cours en ligne / religieux / mariage. Volontairement biaisé Sénégal-friendly (religieux + mariage présents). Ajouter un 9ᵉ template = ~50 lignes de catalogue, no-op côté API.

6. **Magic-link ne crée pas de compte** — l'intervenant édite via le portail sans Firebase Auth. L'éditeur lui-même (formulaire d'édition de bio + photo + slides) est laissé pour une wave ultérieure ; O10 livre le contrat verify + l'audit, ce qui est suffisant pour démarrer le branchement custom UI.

7. **Pas de modification du `/events/new` wizard existant** — les templates sont une route parallèle (`/events/templates`). Les organisateurs gardent le choix : démarrer from scratch via le wizard 4-étapes existant, ou démarrer depuis un template via la route nouvelle.

## Dette i18n connue

Les composants O10 portent toutes leurs chaînes utilisateur en français en dur, **délibérément aligné** sur les phases O1-O9 (la migration `next-intl` du back-office reste un effort cross-cutting séparé du périmètre Organizer Overhaul).

## Ce qui ne fait PAS partie d'O10

- **Speaker bio editor scoped au magic-link** — le portail landing valide le token et expose le scope. Le formulaire d'édition complet (photo upload + slides + social links via le token) est out-of-scope ; il s'ajoute en O10.5 ou wave ultérieure.
- **Comms blueprint auto-scheduled** — les rappels du template sont matérialisés en helper pur ; le wiring "scheduler → broadcastService.scheduleBroadcast" reste une action opérateur explicite.
- **Templates supplémentaires** — 8 couvrent 95 %, mais on peut en ajouter sans refactor.
- **Co-organizer dashboard auto-redirect** — le hook expose `scopedEventId`, le wiring "rediriger /dashboard → /events/<id>/overview" est laissé au /dashboard layout (à brancher ad libitum).

## Conclusion organizer overhaul

O10 clôt la refonte UX/UI du persona organizer ouverte par O1. Les 10 phases couvrent : sidebar / inbox / health-score / event-hub / comms-center / WhatsApp / participant-ops / live-mode / post-event-report / templates+co-org+magic-links. Les snapshots `route-inventory` + `permission-matrix` + `audit-listener-count` capturent l'état final et bloqueront toute régression future au niveau de l'inventaire des routes, des permissions, et de l'audit trail.
