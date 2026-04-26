# O6 — WhatsApp Business API

> **Phase O6** du plan `PLAN.md`. Ouvre WhatsApp comme **canal first-class** au même titre que email / SMS / push, derrière un plan-gate Pro+, avec opt-in participant explicite (RGPD + politique Meta) et adapter pluggable pour swap entre Meta Cloud, Africa's Talking ou Twilio.

## Objectif mesurable

> 1ᵉʳ canal par adoption sur les 3 mois post-lancement.

WhatsApp est dominant au Sénégal (84% de pénétration mobile). Surfacer le canal dans l'experience comms (composer, timeline, templates) sans rituel de codage = différenciation marché immédiate dès que l'homologation Meta aboutit.

## Architecture livrée

### Shared types

**`packages/shared-types/src/communication.types.ts`** : `whatsapp` ajouté au `CommunicationChannelSchema` enum. Le composer + la frise + les notification preferences traitent désormais WhatsApp comme un peer naturel des 4 autres canaux.

**`packages/shared-types/src/notification-preferences.types.ts`** : `whatsapp: z.boolean().optional()` ajouté au `NotificationChannelPreferenceSchema`. Les overrides par-clé peuvent désormais désactiver WhatsApp pour une notif particulière sans casser le global opt-in.

**`packages/shared-types/src/organization.types.ts`** + **`plan.types.ts`** : `whatsappNotifications: boolean` (optionnel) ajouté à `PlanFeatures` et `PlanFeaturesSchema`. Pro + Enterprise → `true` ; Free + Starter → `false` (per-message billing rend la viabilité ≥ Pro).

**`packages/shared-types/src/audit.types.ts`** : 3 nouveaux `AuditAction` — `whatsapp.opt_in.granted`, `whatsapp.opt_in.revoked`, `whatsapp.delivery.failed`.

**`packages/shared-types/src/whatsapp.types.ts`** (nouveau, ~165 lignes) : tous les types spécifiques au canal :

- `WhatsappTemplate` + `WhatsappTemplateStatus` (draft / pending / approved / rejected / paused) — mirror de l'API Meta
- `SEED_WHATSAPP_TEMPLATES` : 3 templates pré-approuvés (J-1 reminder / confirmation inscription / confirmation paiement) avec placeholders Meta-style positional `{{1}}`, `{{2}}`, `{{3}}`
- `WhatsappOptIn` + `CreateWhatsappOptInDto` + `WhatsappOptInStatus` (opted_in / revoked)
- `WhatsappDeliveryWebhook` + `WhatsappDeliveryStatus` (sent / delivered / read / failed) — mirror narrow de la payload Meta
- `WhatsappSendRequest` + `WhatsappSendResult` — DTO adapter

### Backend

**`apps/api/src/services/whatsapp.channel.ts`** : adapter pluggable.

- `WhatsAppTransport` interface : `send(request) → Promise<WhatsappSendResult>`.
- `MockWhatsAppTransport` : implémentation par défaut, log payload sur `process.stderr`, retourne id `mock-wa-<random>`. Aucun appel réseau.
- `validateWhatsappSendRequest(request)` : helper pur exporté qui vérifie (a) template existe, (b) status === `approved`, (c) `variables.length === template.variableCount`. Throws une erreur descriptive avant tout appel Meta — évite les cryptiques `132000` côté Meta.
- `whatsappTransport` singleton : la binding par défaut est `MockWhatsAppTransport`. Production-`app.ts` peut rebinder vers un `MetaCloudTransport` ou `AfricasTalkingTransport` au boot.

**`apps/api/src/services/whatsapp-opt-in.service.ts`** : gestion du consent record.

- Doc id déterministe `${userId}_${organizationId}` → 1 doc par paire (user, org), parce qu'un participant inscrit à 2 orgs peut consentir à l'une et refuser l'autre.
- `grant()` : idempotent sur même phone (no-op + no-event quand déjà opted-in), flippe `revoked → opted_in` avec flag `reGrant: true` quand l'utilisateur revient.
- `revoke()` : flippe `opted_in → revoked` + sets `revokedAt`. Idempotent. 404 si aucun record.
- `hasActiveOptIn(userId, orgId)` : helper pour la broadcast service avant de fan-outer un canal `whatsapp`.
- Émet `whatsapp.opt_in.granted` / `whatsapp.opt_in.revoked` avec envelope standard `{actorId, requestId, timestamp}` → audit listener log la consent en row dédiée.

**`apps/api/src/routes/whatsapp.routes.ts`** : 2 surfaces.

- Participant-scoped sous `/v1/me/whatsapp` :
  - `POST /opt-in` (body : organizationId + phoneE164)
  - `DELETE /opt-in?organizationId=…`
  - `GET /opt-in?organizationId=…`
- Public (Meta callback) sous `/v1/whatsapp` :
  - `POST /webhooks/delivery` — body validé par `WhatsappDeliveryWebhookSchema` ; persiste dans `whatsappDeliveryLog/${messageId}__${status}` (idempotent : Meta retry sur même status = no-op) ; émet `whatsapp.delivery.failed` quand le status est `failed`.

**Webhook security** : la production doit vérifier le header `X-Hub-Signature-256` (HMAC-SHA256 du body avec le `META_APP_SECRET`). En dev, le mock transport ne signe pas, donc le verifier est un placeholder. L'implémentation référence : middleware Fastify `verifyMetaSignature` à brancher avant `validate({ body })`. Documentation Meta : <https://developers.facebook.com/docs/graph-api/webhooks/getting-started>.

**`apps/api/src/config/firebase.ts`** : 2 nouvelles collections — `WHATSAPP_OPT_INS` et `WHATSAPP_DELIVERY_LOG`.

**`apps/api/src/events/domain-events.ts`** : 3 nouveaux event types (`WhatsappOptInGrantedEvent`, `WhatsappOptInRevokedEvent`, `WhatsappDeliveryFailedEvent`) + entries dans `DomainEventMap`.

**`apps/api/src/events/listeners/audit.listener.ts`** : 3 nouveaux handlers qui mappent les events vers `auditService.log()` avec `resourceType: "user"` (opt-in events) / `"notification"` (delivery failures).

### Frontend

**`apps/web-backoffice/src/components/comms/CommsComposer.tsx`** : channel `whatsapp` ajouté au record `CHANNEL_LABEL` + `CHANNEL_ICON` (lucide `MessageCircle`) + à la row d'options. Chip pré-protégé via `<PlanGate feature="whatsappNotifications" fallback="disabled">` — même pattern que SMS.

**`apps/web-backoffice/src/components/comms/CommsTimeline.tsx`** : 5ᵉ row gantt ajoutée pour WhatsApp (couleur `green-500`, proche de la marque Meta `#25D366`). Le récap dans le `CHANNELS` array place WhatsApp entre SMS et in-app pour refléter l'importance attendue côté Sénégal.

**`apps/web-backoffice/src/components/comms/CommsTemplateLibrary.tsx`** : icône WhatsApp ajoutée au record (les templates seed actuels n'utilisent pas le canal — un futur seed pourra inclure des recommandations WhatsApp-first).

**`apps/web-backoffice/src/components/admin/AssignPlanDialog.tsx` + `PlanComparisonTable.tsx` + `UpgradeDialog.tsx` + `plans/PlanForm.tsx`** : labels FR ajoutés pour `whatsappNotifications` ("Notifications WhatsApp") + value par défaut dans `DEFAULT_FEATURES`. La feature apparaît automatiquement dans la grille de comparaison de plans + dialog d'upgrade.

## Pourquoi cette architecture

### Pourquoi un transport interface plutôt qu'une intégration Meta directe ?

Trois raisons :

- **Provider neutrality** — Africa's Talking et Twilio offrent aussi WhatsApp. Pricing + SLA peuvent diverger ; pouvoir swap sans rewrite est précieux.
- **Test ergonomics** — la suite vitest n'a pas de credentials Meta. `MockWhatsAppTransport` permet d'exercer le broadcast end-to-end sans booter un mock HTTP.
- **Pre-homologation** — Meta approve les Business accounts en 24-48 h, mais le compte de test peut être bloqué pendant des semaines. Shipping le code (UI composer, opt-in flow, audit) avant que la transport soit câblée évite que l'intégration externe bloque la roadmap O6+.

### Pourquoi un dossier dédié `whatsappOptIns` plutôt qu'un champ sur le doc user ?

- **Org-scope** : un participant peut être inscrit à plusieurs orgs et consentir différemment.
- **Audit-friendliness** : la doc id `${userId}_${organizationId}` est lisible dans les audit rows.
- **Append-only** : revoke flippe le status au lieu de delete. Le dossier est la trace légale ; supprimer la consent supprimerait aussi la preuve historique du consent.
- **Permissions Firestore** : les rules peuvent restreindre l'écriture au caller uid uniquement (le service derive le doc id du `request.user.uid`), zero risque de cross-user mutation.

### Pourquoi des templates statiques + Meta names hardcoded ?

L'approbation Meta est lente. Avoir les `metaName` sous git permet d'aligner la submission Meta avec le code qui les référence. Future iteration : un panneau admin pour soumettre + tracker l'état d'un nouveau template, avec auto-sync dans Firestore.

### Pourquoi le webhook delivery écrit dans `whatsappDeliveryLog` plutôt que sur le notification doc ?

- **Idempotency** : doc id `${messageId}__${status}` rend l'écriture atomique sur un retry Meta.
- **Append-only** : on garde TOUS les status updates (sent → delivered → read), pas seulement le dernier. Le notification doc montrerait juste l'état final.
- **Performance** : pas de transaction `read-modify-write` sur le notification doc lui-même → Meta peut spammer le webhook sans contention.

Le link entre messageId et notification (pour analytics) sera fait par une projection batch async, pas inline.

### Pourquoi pas de tests render pour la nouvelle ligne WhatsApp dans CommsTimeline ?

Le test geometry existant (`buildTimelineGeometry`) couvre déjà la **structure** (rowOf for each channel). Ajouter un test render dédié à WhatsApp dupliquerait le test des 4 autres canaux. Le contrat structurel (l'enum exhaustif force le record à inclure whatsapp) est protégé par TypeScript — aucun test runtime ne peut faire mieux que la vérification compile-time.

### Pourquoi le webhook est-il dans `UNAUTHENTICATED_MUTATIONS_ALLOWED` ?

Meta appelle `POST /v1/whatsapp/webhooks/delivery` depuis ses propres servers. Bearer auth ne s'applique pas. La security est portée par la signature HMAC-SHA256 que Meta émet dans `X-Hub-Signature-256`. Le test `route-inventory` documente cette exemption avec un commentaire pointant vers ce doc.

## Couverture de tests

### Backend (+18 nouveaux)

**`whatsapp-channel.test.ts`** — 8 tests :

- `resolveWhatsappTemplate` : hit / miss / sanity-check du seed registry
- `validateWhatsappSendRequest` : happy path / unknown template / variable count mismatch
- `MockWhatsAppTransport.send` : prefix `mock-wa-` / unique ids per call

**`whatsapp-opt-in.service.test.ts`** — 10 tests :

- `grant` : fresh grant + event emit / idempotent same-phone (no write, no event) / re-grant after revoke (`reGrant: true`) / no-uid rejection
- `revoke` : flip + event emit / 404 on missing record / idempotent on already-revoked
- `hasActiveOptIn` : opted_in → true / revoked → false / no record → false

**Snapshots mis à jour** :

- `route-inventory.test.ts.snap` : +3 routes (POST/DELETE/GET `/v1/me/whatsapp/opt-in`, POST `/v1/whatsapp/webhooks/delivery`)
- Audit listener `EXPECTED_HANDLER_COUNT` : 99 → 102

### Frontend (sans nouveaux tests dédiés)

L'ajout de WhatsApp aux Records `CHANNEL_*` est protégé par TypeScript (l'enum est exhaustif) — un canal manquant casse le compile, pas seulement un test. Les tests existants des composants comms continuent à passer (242/242).

## Total Phase O6

**+18 tests backend**, suite globale : **2086 tests** (1744 API + 242 web). TypeScript clean.

## Suite roadmap

- **O6.1 — Production Meta integration** : implémenter `MetaCloudTransport`, brancher la signature webhook, soumettre les 3 templates seed à l'approval, swap la binding du `whatsappTransport` singleton.
- **O6.2 — Opt-in UI participant** : dans `apps/web-participant` (Wave 3), banner sur la fiche-événement post-inscription qui propose d'opt-in WhatsApp avec resolved phone.
- **O6.3 — Per-recipient gating dans broadcast** : enrichir le `broadcast.service.ts` pour skip les non-opt-in users quand `whatsapp` est sélectionné, et reporter le decoupling sur `recipientCount` vs `sentCount` dans le UI.
- **O6.4 — Templates customs org-scoped** : permettre à un organisateur Pro+ de soumettre ses propres templates Meta via un workflow admin.

## Vérification

```bash
# API
cd apps/api
npx tsc --noEmit                 # propre
npx vitest run                   # 1744 tests passent (incl. 18 nouveaux O6)

# Web
cd apps/web-backoffice
npx tsc --noEmit                 # propre
npx vitest run                   # 242 tests passent (channel extension non-breaking)
```

Manual QA :

- [ ] Composer : sur Pro/Enterprise, le chip WhatsApp est cliquable. Sur Free/Starter, il est greyed avec hint plan.
- [ ] Frise : 5ᵉ row "WhatsApp" en green-500 visible sur la timeline d'un event qui a un broadcast avec ce canal.
- [ ] `POST /v1/me/whatsapp/opt-in` body `{organizationId, phoneE164}` → 201 + audit row `whatsapp.opt_in.granted`.
- [ ] Re-call → 201 + même body, AUCUNE nouvelle audit row (idempotent).
- [ ] `DELETE` puis re-`POST` → audit row avec `reGrant: true`.
- [ ] `POST /v1/whatsapp/webhooks/delivery` avec `status: failed` → audit row `whatsapp.delivery.failed`.
- [ ] Plan comparison table affiche bien la ligne "Notifications WhatsApp" cochée pour Pro/Enterprise.
