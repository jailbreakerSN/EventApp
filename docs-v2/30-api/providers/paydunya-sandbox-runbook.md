---
title: PayDunya Sandbox — Runbook E2E
status: shipped
last_updated: 2026-04-26
---

# PayDunya Sandbox — Runbook E2E

> Runbook opérateur pour tester l'intégration PayDunya **bout en bout** en sandbox avant le go-live production. Couvre la mise en place des credentials, le test d'un paiement complet, et les checks attendus côté logs / Firestore / audit trail.

Cf. [`paydunya.md`](./paydunya.md) pour la spec complète et les threat models.

---

## 1. Pré-requis

| | |
|---|---|
| Compte PayDunya sandbox | https://app.paydunya.com/account/register |
| Application créée dans le dashboard | Onglet **Applications** |
| Compte client fictif créé | Onglet **Clients fictifs** (avec solde > 0 FCFA) |
| Emulators Firebase démarrés | `firebase emulators:start` |
| API en mode dev | `npm run api:dev` |

### Credentials PayDunya livrés par le dashboard

PayDunya vous fournit **4 clés**. Notre intégration server-side n'en utilise que **3** :

| Clé dashboard | Variable d'env Teranga | Usage |
|---|---|---|
| **Clé Principale** | `PAYDUNYA_MASTER_KEY` | Public — identifie le compte marchand. Utilisée pour la signature SHA-512 du webhook. |
| **Clé Privée** | `PAYDUNYA_PRIVATE_KEY` | **Secret** — auth des appels server-to-server. |
| **Token** | `PAYDUNYA_TOKEN` | **Secret** — header additionnel pour les ops sensibles (refund, disburse). |
| ~~Clé Publique~~ | ❌ NON UTILISÉE | C'est la clé des SDK client-side (mobile / browser). Notre paiement est 100% server-driven, on ne l'utilise jamais. **Ne PAS la coller dans `.env`.** |

---

## 2. Configuration locale (`apps/api/.env`)

```bash
# Mode sandbox — hits https://app.paydunya.com/sandbox-api/v1
PAYDUNYA_MODE=sandbox

# Les 3 clés du dashboard (Account → API → Keys)
PAYDUNYA_MASTER_KEY=test_master_xxxxx
PAYDUNYA_PRIVATE_KEY=test_private_xxxxx
PAYDUNYA_TOKEN=xxxxx

# Optionnel — branding affiché sur la page hosted-checkout PayDunya
PAYDUNYA_STORE_NAME=Teranga Events (sandbox)

# IP allowlist — laissez VIDE en sandbox (PayDunya teste depuis des IPs
# variables). En production, configurer avec les CIDRs documentés par
# PayDunya après onboarding.
# PAYDUNYA_WEBHOOK_IPS=
```

> ⚠️ **Pas de `LEGACY_PROVIDER=true`** : ce flag force le fallback vers Wave/OM directs. En sandbox, on veut tester PayDunya, donc on le laisse unset (= `false`).

### Vérification de la config au démarrage

L'API exécute `assertProviderSecrets()` au boot. Avec une config valide, vous voyez :

```
[INFO] Teranga API listening on 0.0.0.0:3000
```

Avec une config partielle (ex. : MasterKey set, Token absent) :

```
Boot aborted — payment provider secrets misconfigured (P1-18):
  - Provider « paydunya » is half-configured: PAYDUNYA_MASTER_KEY is set
    but missing `PAYDUNYA_PRIVATE_KEY`, `PAYDUNYA_TOKEN`. PayDunya needs
    all three keys (MASTER + PRIVATE + TOKEN) to authenticate every API
    call. The MasterKey alone only verifies webhooks; initiate fails 401.
```

C'est la garantie que la mauvaise config ne passe jamais en prod.

---

## 3. Test E2E : un paiement de bout en bout

### 3.1 Préparer un événement payant côté Teranga

```bash
# Démarrer les emulators (un terminal)
firebase emulators:start

# Démarrer l'API + web-participant (autres terminaux)
npm run api:dev
npm run web:dev          # backoffice :3001
cd apps/web-participant && npm run dev   # participant :3002

# Seeder les données de démo
npx tsx scripts/seed-emulators.ts
```

Le seed crée plusieurs événements payants. Identifier un avec :

```bash
# (depuis l'emulator UI — http://localhost:4000/firestore/data — ou via la CLI)
# Cherchez un event avec `status: "published"` ET au moins un `ticketTypes[i].price > 0`.
```

### 3.2 Initier un paiement depuis le participant web

1. Ouvrir http://localhost:3002 et se connecter avec un compte participant (ex. `participant@teranga.dev` / mot de passe seed).
2. Naviguer vers l'événement payant.
3. Cliquer **S'inscrire** → choisir le ticket payant → **Payer avec Wave** (ou OM, free_money, card).
4. La requête `POST /v1/payments/initiate` part vers l'API.

**Flow attendu côté API :**

```
[INFO] POST /v1/payments/initiate (registered → handler)
[INFO] paymentService.initiatePayment(eventId, ticketTypeId, "wave", ...)
       ├─ permission check ✓
       ├─ requirePlanFeature(org, "paidTickets") ✓
       ├─ tx1 — placeholder Payment + Registration + idempotency claim
       ├─ paydunyaPaymentProvider.initiate(...)
       │   ├─ POST /sandbox-api/v1/checkout-invoice/create
       │   └─ ← 200 { response_code: "00", token: "xxx", response_text: "https://paydunya.com/checkout/invoice/xxx" }
       └─ tx2 — update Payment status='processing', providerTransactionId, redirectUrl
[INFO] payment.initiated event emitted
[INFO] 201 Created { paymentId, redirectUrl }
```

Le navigateur est redirigé vers `https://paydunya.com/checkout/invoice/<token>` (la page hosted PayDunya).

### 3.3 Compléter le paiement sur PayDunya

Sur la page PayDunya sandbox :

1. Sélectionner **Wave** (ou autre wallet correspondant à votre `method`).
2. Saisir les credentials du **client fictif** créé dans le dashboard :
   - Numéro : `+221 77 171 0757` (par ex.)
   - Mot de passe : `password123`
   - Email : `dameleprince@gmail.com`
3. Confirmer le paiement.

PayDunya simule le paiement et **POST l'IPN** vers votre `callback_url` :

```
POST /v1/payments/webhook/paydunya
Content-Type: application/x-www-form-urlencoded

data=%7B%22response_code%22%3A%2200%22%2C%22hash%22%3A%22...%22%2C%22invoice%22%3A%7B%22token%22%3A%22xxx%22%2C%22total_amount%22%3A5000%7D%2C%22custom_data%22%3A%7B%22payment_id%22%3A%22pay_xyz%22%7D%2C%22status%22%3A%22completed%22%7D
```

**Flow attendu côté API :**

```
[INFO] POST /v1/payments/webhook/paydunya
       ├─ webhookIpAllowlist (PAYDUNYA_WEBHOOK_IPS unset → fail-OPEN dev)
       ├─ form-encoded body parser → projette { providerTransactionId, status: "succeeded", metadata: { providerName: "paydunya", expectedAmount, expectedPaymentId, ... } }
       ├─ paydunyaPaymentProvider.verifyWebhook(rawBody, headers)
       │   ├─ extractDataField(rawBody) ✓
       │   ├─ JSON.parse + extract `hash` ✓
       │   ├─ SHA-512(MasterKey) === payload.hash ✓ (timingSafeEqual)
       │   └─ return true
       ├─ webhookEventsService.record(...) — replayable row in /admin/webhooks
       ├─ paymentService.handleWebhook(token, "succeeded", metadata)
       │   ├─ findByProviderTransactionId ✓
       │   ├─ anti-tampering: expectedPaymentId === payment.id ✓
       │   ├─ anti-tampering: expectedAmount === payment.amount ✓
       │   ├─ tx { update Payment.status='succeeded', Registration.status='confirmed',
       │   │       Event.registeredCount++, ticketTypes[].soldCount++,
       │   │       balanceTransactions += [payment, platform_fee] }
       │   └─ payment.succeeded event emitted
       └─ 200 OK
```

### 3.4 Vérifications

**Côté Firestore (emulator UI : http://localhost:4000/firestore/data) :**

| Collection | Doc | Champs attendus |
|---|---|---|
| `payments/<id>` | Le payment ciblé | `status: "succeeded"`, `completedAt: <ISO>`, `providerMetadata: { providerName: "paydunya", providerCode: "00", providerStatus: "completed", expectedAmount, expectedPaymentId }` |
| `registrations/<id>` | La registration liée | `status: "confirmed"` |
| `events/<id>` | L'événement | `registeredCount` incrémenté, `ticketTypes[i].soldCount` incrémenté |
| `balanceTransactions` | 2 nouvelles entrées | `kind: "payment"` (montant brut) + `kind: "platform_fee"` (négatif) |
| `webhookEvents/paydunya__<token>__succeeded` | 1 ligne | `processingStatus: "processed"`, `attempts: 1`, `provider: "paydunya"` |
| `auditLogs` | 2 nouvelles lignes | `payment.initiated` (à l'init) + `payment.succeeded` (à l'IPN) |

**Côté UI :**

- **Backoffice → /admin/webhooks** : la ligne PayDunya `processed`, payload visible.
- **Backoffice → événement → Inscriptions** : le participant apparaît `confirmed`.
- **Web-participant → Mon compte → Mes inscriptions** : le badge est généré, scannable.

---

## 4. Tests d'erreur (à reproduire avant prod)

### 4.1 Signature invalide

Modifier la `Clé Principale` côté API (faux key) ; PayDunya envoie un IPN ; l'API doit répondre **403** sans toucher Firestore. Vérifier `webhookEvents` ligne `processingStatus: "failed"`.

### 4.2 Payload tampering (manuel, via curl)

```bash
# Récupérer un IPN valide depuis /admin/webhooks (rawBody)
# Modifier `invoice.total_amount` dans le `data=` field
# Re-poster :
curl -X POST http://localhost:3000/v1/payments/webhook/paydunya \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "data=...payload-tampered..."
```

L'API doit :
- Vérifier la signature → ✅ (la signature reste valide car non modifiée)
- Détecter `metadata.expectedAmount !== payment.amount` → throw `ValidationError(reason: "payload_tampering")`
- Émettre `payment.tampering_attempted` event
- Auditlog row : `action: "payment.tampering_attempted"`, `details.field: "amount"`

### 4.3 Replay (idempotency)

Re-poster le MÊME IPN deux fois. La deuxième doit :
- Passer la signature ✓
- Hit `webhookEvents/<id>` existant → `attempts++`, retourne 200 sans re-traiter
- Aucun double `payment.succeeded` event
- Aucun double balanceTransaction entry

### 4.4 Annulation côté utilisateur

Sur la page hosted PayDunya, cliquer **Annuler**. PayDunya envoie un IPN avec `status: "cancelled"`. L'API doit :
- Mapper `cancelled` → `failed`
- Update Payment.status = `failed`
- Update Registration.status = `cancelled`
- Émettre `payment.failed`

---

## 5. Rollback d'urgence

Si PayDunya a un incident en production :

```bash
# Cloud Run console → modifier la révision → ajouter env var
LEGACY_PROVIDER=true

# Redéployer
```

Effets immédiats (sans code change) :
- Le registry rebascule sur Wave / OM directs (Phase 1) — keys restent configurées
- Les nouveaux payments empruntent le flow direct
- Les payments PayDunya en cours continuent à recevoir leurs IPNs (`paydunya` reste enregistré dans le webhook router)
- `/admin/webhooks` continue à afficher les replays historiques

Pour ré-activer PayDunya après résolution : retirer `LEGACY_PROVIDER` (ou le passer à `false`) et redéployer.

---

## 6. Déploiement staging (Cloud Run)

Pour tester l'E2E sur l'URL staging publique (au lieu de localhost), suivez ce flow.

### 6.1 GitHub Secrets (one-time, par environnement)

Aller dans : **Settings → Environments → staging → Environment secrets**.

Si l'environment `staging` n'existe pas encore, le créer (**New environment** → nom : `staging` → save).

Ajouter les 3 secrets PayDunya :

| Secret name | Source | Type |
|---|---|---|
| `PAYDUNYA_MASTER_KEY` | Dashboard PayDunya → API → Clé Principale | public-ish (signature webhook) |
| `PAYDUNYA_PRIVATE_KEY` | Dashboard PayDunya → API → Clé Privée | **secret** (auth API) |
| `PAYDUNYA_TOKEN` | Dashboard PayDunya → API → Token | **secret** (header ops sensibles) |

> ⚠️ **Ne PAS ajouter `PAYDUNYA_PUBLIC_KEY`** — c'est pour les SDK client-side, jamais utilisé côté server. La coller par erreur dans `PAYDUNYA_PRIVATE_KEY` casse silencieusement les `initiate()` (401).

### 6.2 Workflow déclencheur

Le workflow `.github/workflows/deploy-staging.yml` injecte automatiquement ces secrets dans Cloud Run au moment du `gcloud run deploy` (job `deploy-api`). `PAYDUNYA_MODE=sandbox` est hardcodé dans le workflow (vs prod qui sera `live` quand le workflow `deploy-production.yml` sera créé).

Trigger options :

```bash
# Option A — automatique : un push sur develop déclenche staging
git push origin develop

# Option B — manuelle : workflow_dispatch depuis GitHub Actions UI
# https://github.com/jailbreakerSN/EventApp/actions/workflows/deploy-staging.yml
# → Run workflow → branche develop → Run
```

### 6.3 Vérification post-deploy

Une fois le job `deploy-api` `success`, vérifier que l'instance Cloud Run a bien démarré (l'assertion P1-18 fail-CLOSE si la config PayDunya est partielle) :

```bash
# Récupérer l'URL Cloud Run
gcloud run services describe teranga-api-staging \
  --region europe-west1 \
  --format='value(status.url)'

# Health check
curl https://teranga-api-staging-<hash>-ew.a.run.app/v1/health

# Inspect Cloud Run logs (boot stage)
gcloud run services logs read teranga-api-staging --region europe-west1 --limit 50
```

Au boot vous devez voir :
```
[INFO] Teranga API listening on 0.0.0.0:8080
```

Si la config PayDunya est partielle (ex: `PAYDUNYA_TOKEN` manquant en GH Secrets), l'API refuse de démarrer :
```
Boot aborted — payment provider secrets misconfigured (P1-18):
  - Provider « paydunya » is half-configured: PAYDUNYA_MASTER_KEY is set
    but missing `PAYDUNYA_TOKEN`. PayDunya needs all three keys (MASTER
    + PRIVATE + TOKEN) to authenticate every API call.
```
→ Cloud Run restart-loop. Aller corriger le secret manquant dans GH → redeploy.

### 6.4 Configuration callback PayDunya

Le `callback_url` envoyé à PayDunya à chaque `initiate()` est construit côté server à partir de `API_BASE_URL` (cf. `apps/api/src/config/public-urls.ts → paymentWebhookUrl`). Pour le staging :

```
API_BASE_URL=https://teranga-api-staging-<hash>-ew.a.run.app
callback_url envoyé à PayDunya = https://teranga-api-staging-<hash>-ew.a.run.app/v1/payments/webhook/paydunya
```

PayDunya **n'a PAS besoin** d'un setup côté dashboard pour le callback URL — il est fourni dynamiquement à chaque création d'invoice. Pas d'action manuelle requise.

### 6.5 Test E2E sur staging

1. Ouvrir `https://app-participant-staging-<hash>-ew.a.run.app`
2. Login avec le compte test seed (`participant@teranga.dev`)
3. Choisir un événement payant → s'inscrire → **Payer avec Wave** (ou OM, free_money, card)
4. Le navigateur redirige vers `https://paydunya.com/checkout/invoice/<token>`
5. Sur la page PayDunya, utiliser le client fictif :
   - Numéro : `+221 77 171 0757`
   - Mot de passe : `password123`
   - Email : `dameleprince@gmail.com`
6. Cliquer **Payer**
7. Vérifier dans le backoffice staging :
   - **`/admin/webhooks`** : ligne `paydunya` `processed`
   - **`/admin/audit`** : rows `payment.initiated` + `payment.succeeded`
   - **`/admin/payments`** : le payment `succeeded`
   - **Event organizer view** : `registeredCount` + `soldCount` incrémentés
   - **Email reçu** par `dameleprince@gmail.com` (reçu de paiement)

### 6.6 Rollback d'urgence

Pendant un incident PayDunya en staging :

```bash
# Cloud Run console → service teranga-api-staging → "Edit & Deploy New Revision"
# Variables → ajouter LEGACY_PROVIDER=true → Deploy
```

OU via `gcloud` :

```bash
gcloud run services update teranga-api-staging \
  --region europe-west1 \
  --update-env-vars LEGACY_PROVIDER=true
```

⚠️ **En staging actuel** : aucun secret `WAVE_API_KEY` / `ORANGE_MONEY_*` n'est configuré, donc `LEGACY_PROVIDER=true` rebascule sur **mock provider** (qui est bloqué par `IS_PROD && method === "mock"` côté service → 400). Pour avoir un vrai fallback, il faut d'abord configurer Wave/OM directs en GH Secrets staging.

Pour la production, l'ordre des opérations est inverse : configurer Wave/OM directs **avant** PayDunya pour avoir le rollback opérationnel jour 1.

---

## 7. Pour aller plus loin

| | |
|---|---|
| Spec complète | [`paydunya.md`](./paydunya.md) |
| API webhook flow détaillé | spec §6 |
| Threat model | spec §13 |
| PR Phase 2 | https://github.com/jailbreakerSN/EventApp/pull/195 |
| Workflow deploy-staging | [`.github/workflows/deploy-staging.yml`](../../../.github/workflows/deploy-staging.yml) |
| PayDunya doc officielle | https://developers.paydunya.com/doc/FR/http_json |
| Test sandbox numbers | spec §12.1 |
