---
title: PayDunya — Intégration Provider
status: planned
last_updated: 2026-04-26
---

# PayDunya — Intégration Provider

> **Statut : planifié (Phase 2)** — Cette documentation formalise l'intégration PayDunya en tant que **provider agrégateur unique** pour les paiements Wave, Orange Money, Free Money et carte bancaire dans la zone WAEMU. Le provider PayDunya n'est pas encore implémenté ; il remplacera les clients directs Wave et Orange Money à l'issue de la Phase 2 du plan de durcissement paiements.
>
> **Décisions verrouillées (Phase 0 audit) :**
> - **D1** : PayDunya est notre seul intégrateur paiement à terme (modèle agrégateur).
> - **D3** : Modèle **merchant-of-record plateforme** — un unique compte marchand PayDunya Teranga collecte tous les paiements, le ledger interne distribue aux organisations.
> - **D5** : XOF uniquement en v1 (zone BCEAO).
> - **D6** : Push-payment mobile-money en priorité (hosted checkout d'abord, SOFTPAY direct en Phase 3).
>
> **Références croisées :**
> - [`docs/audit-2026-04-26/PAYMENT-READINESS-REPORT.md`](../../../docs/audit-2026-04-26/PAYMENT-READINESS-REPORT.md) — décisions D1/D3, threat model §3.1 / §3.9, backlog Phase 1 §6
> - [`docs-v2/20-architecture/decisions/0015-trust-proxy-auth-aware-rate-limit.md`](../../20-architecture/decisions/0015-trust-proxy-auth-aware-rate-limit.md) — rate limit composite-key
> - [`apps/api/src/providers/payment-provider.interface.ts`](../../../apps/api/src/providers/payment-provider.interface.ts) — contrat à respecter
> - [`docs-v2/30-api/payments.md`](../payments.md) — endpoints de paiement consommés par les clients

---

## 1. Vue d'ensemble

PayDunya est un agrégateur de paiements ouest-africain (Sénégal, Côte d'Ivoire, Bénin, Burkina Faso, Togo, Mali). Il expose une API HTTP/JSON unique qui abstrait :

- les wallets mobile money (Wave, Orange Money, Free Money, MTN, Moov, Wizall, Expresso, T-Money) ;
- la carte bancaire (Visa / Mastercard via passerelle bancaire interbancaire) ;
- les **disbursements** (paiements sortants vers les wallets des organisateurs).

### 1.1 Pourquoi un agrégateur unique ?

| Approche | Pour | Contre |
|---|---|---|
| **Direct** (Wave + OM API séparées) | Frais provider plus bas, contrôle fin du flow | Maintenance N intégrations × N webhooks × N OAuth, KYC × N, signatures × N |
| **Agrégateur PayDunya** ✅ | Un seul KYC, un seul webhook, un seul format, ajout d'un nouveau wallet = changer 1 paramètre | Frais agrégateur (~1.5–2.5% + frais wallet), dépendance à un tiers |

**Décision D1** : la maintenance et le time-to-market sont prioritaires sur l'optimisation des frais. Voir audit §2.1.

### 1.2 Place dans l'architecture

```
┌───────────────────┐    ┌──────────────────┐    ┌───────────────────────┐
│   PaymentService  │───▶│ PaymentProvider  │───▶│ PayDunyaProvider      │
│  (services/)      │    │ (interface)      │    │ (providers/)          │
└───────────────────┘    └──────────────────┘    └────────────┬──────────┘
         ▲                                                    │
         │                                                    ▼
┌────────┴──────────┐                              ┌──────────────────────┐
│  Routes /v1/payments │                           │  PayDunya HTTP API   │
│  + webhook /payments/webhook                     │  (sandbox ou live)   │
└───────────────────┘                              └──────────────────────┘
```

Le `PaymentService` ne dépend que de l'interface `PaymentProvider`. Le swap Wave → PayDunya consiste à :

1. Implémenter `PayDunyaPaymentProvider implements PaymentProvider`.
2. Modifier le **registry** dans `payment.service.ts` :
   ```ts
   const providers = {
     mock: mockPaymentProvider,
     wave: paydunyaPaymentProvider,         // ⬅️ change here
     orange_money: paydunyaPaymentProvider, // ⬅️ change here
     free_money: paydunyaPaymentProvider,
     card: paydunyaPaymentProvider,
   };
   ```
3. Garder Wave / OM directs sous `LEGACY_PROVIDER=true` flag pour rollback contrôlé pendant 30 jours.

---

## 2. Authentification & environnements

### 2.1 Comptes & clés

PayDunya distingue **trois clés** par compte marchand :

| Clé | Rôle | Header HTTP | Stockage Teranga |
|---|---|---|---|
| **MasterKey** | Identifiant public du compte marchand | `PAYDUNYA-MASTER-KEY` | GCP Secret Manager — `paydunya-master-key` |
| **PrivateKey** | Authentifie les requêtes serveur-à-serveur | `PAYDUNYA-PRIVATE-KEY` | GCP Secret Manager — `paydunya-private-key` |
| **Token** | Token additionnel pour les opérations critiques (disbursement, refund) | `PAYDUNYA-TOKEN` | GCP Secret Manager — `paydunya-token` |

> ⚠️ **PublicKey** existe pour les SDK client-side. **Nous ne l'utilisons jamais** — Teranga ne déclenche jamais un paiement depuis le navigateur. L'audit §3.1 (T-PD-01) traite la fuite PublicKey comme un faux positif.

**Convention secrets :**

```bash
# .env (local, sandbox)
PAYDUNYA_MODE=sandbox
PAYDUNYA_MASTER_KEY=<sandbox-master-key>
PAYDUNYA_PRIVATE_KEY=<sandbox-private-key>
PAYDUNYA_TOKEN=<sandbox-token>

# Cloud Run (production)
PAYDUNYA_MODE=live
PAYDUNYA_MASTER_KEY=projects/teranga-events-prod/secrets/paydunya-master-key/versions/latest
# (mêmes refs Secret Manager pour PRIVATE_KEY et TOKEN)
```

### 2.2 Bases URL

| Environnement | Base URL | Usage |
|---|---|---|
| **Sandbox** | `https://app.paydunya.com/sandbox-api/v1` | Local + staging — paiements simulés, aucun débit réel |
| **Live** | `https://app.paydunya.com/api/v1` | Production uniquement |

Le code provider lit `PAYDUNYA_MODE` et choisit la base URL au démarrage. **Aucune URL en dur.** L'assertion startup `assertRequiredSecrets()` (cf. P1-18 du backlog) refuse de booter en production si `PAYDUNYA_MODE !== 'live'` ou si une clé sandbox est détectée.

### 2.3 Headers obligatoires

Toute requête sortante (sauf webhook entrant) doit porter :

```http
PAYDUNYA-MASTER-KEY: <master-key>
PAYDUNYA-PRIVATE-KEY: <private-key>
PAYDUNYA-TOKEN: <token>
Content-Type: application/json
Accept: application/json
```

> 🔒 **Invariant de redaction (P1-12)** : ces 3 en-têtes doivent figurer dans la liste des champs masqués par le logger Pino (`redact: ['req.headers.PAYDUNYA-*', ...]`). Toute trace contenant une de ces clés en clair est un incident sécurité.

---

## 3. Modèle de données PayDunya

### 3.1 Invoice (facture / panier)

L'entité centrale de PayDunya est l'**invoice**. Chaque tentative de paiement = une invoice :

```jsonc
{
  "invoice": {
    "total_amount": 5000,            // XOF, entier (pas de décimales)
    "description": "Inscription : Conférence Dakar Tech 2026"
  },
  "store": {
    "name": "Teranga Events"         // libellé affiché à l'utilisateur
  },
  "actions": {
    "callback_url": "https://api.teranga.app/v1/payments/webhook",
    "return_url":   "https://app.teranga.app/registrations/{id}/success",
    "cancel_url":   "https://app.teranga.app/registrations/{id}/cancel"
  },
  "custom_data": {
    "payment_id": "pay_abc123",      // notre Payment.id — clé de réconciliation
    "registration_id": "reg_xyz789",
    "event_id": "evt_456"
  }
}
```

> ✅ **Règle d'or réconciliation** : `custom_data.payment_id` est la **seule** source d'identification fiable côté Teranga. PayDunya renvoie cette valeur dans le webhook IPN ; on ne se fie **jamais** au token PayDunya seul (cf. §6.3).

### 3.2 Token PayDunya

À la création d'une invoice, PayDunya retourne un **token** alphanumérique :

- format : `[a-zA-Z0-9]{16,32}` ;
- usage : composer l'URL de checkout hosted (`https://paydunya.com/checkout/invoice/<token>`) ;
- usage : interroger le statut via `GET /checkout-invoice/confirm/<token>` ;
- TTL : ~24 h côté PayDunya (l'invoice expire si non payée).

Côté Teranga, le token est stocké dans `Payment.providerTransactionId`.

### 3.3 Mapping `Payment` ↔ `Invoice`

| Champ Teranga (`Payment`) | Champ PayDunya | Notes |
|---|---|---|
| `id` | `invoice.custom_data.payment_id` | Clé idempotence + réconciliation |
| `amount` | `invoice.total_amount` | Entier XOF ; **jamais** de cents |
| `currency` | (implicite XOF) | PayDunya XOF par défaut zone WAEMU |
| `description` | `invoice.description` | Préfixé `"Inscription : <event.title>"` |
| `providerTransactionId` | `token` | Renvoyé par `POST /checkout-invoice/create` |
| `redirectUrl` | `response_text` (URL hosted) | Renvoyé dans la même réponse |
| `status` | `status` (mappé — voir §6.4) | `pending → processing → succeeded` |
| `metadata.providerStatus` | `status` brut PayDunya | Audit + debugging |

---

## 4. Flow Hosted Checkout (priorité v1)

C'est le flow par défaut : PayDunya héberge la page de paiement, l'utilisateur choisit son wallet sur leur écran. **Aucune carte bleue ni numéro mobile money ne touche notre infra.**

### 4.1 Séquence

```
Client            API Teranga          PayDunya             Wallet (Wave/OM/...)
  │                    │                    │                     │
  │ POST /v1/payments/initiate              │                     │
  │ { registrationId, method, returnUrl }   │                     │
  ├───────────────────▶│                    │                     │
  │                    │ 1. preflight reg + plan + amount         │
  │                    │ 2. create Payment(status=pending)        │
  │                    │ 3. POST /checkout-invoice/create         │
  │                    ├───────────────────▶│                     │
  │                    │                    │ 4. allocate token   │
  │                    │◀───────────────────┤                     │
  │                    │ 5. update Payment(.providerTransactionId, status=processing)
  │                    │                                          │
  │◀───────────────────┤ { paymentId, redirectUrl, status: "pending" }
  │                                                               │
  │ window.location.href = redirectUrl                            │
  │                                                               │
  │ ───────────── PayDunya hosted page ──────────▶                │
  │                                          │ user picks Wave   │
  │                                          ├──────────────────▶│
  │                                          │                   │ 6. user pays in Wave app
  │                                          │◀──────────────────┤
  │                                          │                                          │
  │                    │◀──── 7. POST /v1/payments/webhook (IPN, x-www-form-urlencoded) │
  │                    │ 8. verify signature + idempotency                              │
  │                    │ 9. tx { Payment.status=succeeded + balanceTx }                 │
  │                    │ 10. emit payment.succeeded (badge gen, notif, audit)           │
  │                                                                                    │
  │ ◀──── 11. browser redirect → returnUrl?paymentId=...                                │
```

### 4.2 Création de l'invoice

**Endpoint :** `POST {{base}}/checkout-invoice/create`

**Body :**

```jsonc
{
  "invoice": {
    "total_amount": 5000,
    "description": "Inscription : Conférence Dakar Tech 2026"
  },
  "store": { "name": "Teranga Events" },
  "actions": {
    "callback_url": "https://api.teranga.app/v1/payments/webhook",
    "return_url":   "https://app.teranga.app/registrations/reg_xyz789/success",
    "cancel_url":   "https://app.teranga.app/registrations/reg_xyz789/cancel"
  },
  "custom_data": {
    "payment_id": "pay_abc123",
    "registration_id": "reg_xyz789",
    "event_id": "evt_456",
    "organization_id": "org_789"
  }
}
```

**Réponse succès :**

```jsonc
{
  "response_code": "00",
  "response_text": "https://paydunya.com/checkout/invoice/<token>",
  "description": "Invoice créée avec succès",
  "token": "<token>"
}
```

**Réponse erreur :**

```jsonc
{
  "response_code": "<code>",     // ex: "08" champ manquant
  "response_text": "Le champ total_amount est obligatoire"
}
```

> 🛡 **Mapping vers `InitiateResult`** :
> ```ts
> return {
>   providerTransactionId: body.token,
>   redirectUrl: body.response_text, // URL hosted
> };
> ```
> Si `response_code !== "00"` → throw `ProviderError({ providerCode: response_code, providerMessage: response_text })`. Voir §10.

### 4.3 Vérification du statut

**Endpoint :** `GET {{base}}/checkout-invoice/confirm/<token>`

**Réponse :**

```jsonc
{
  "response_code": "00",
  "response_text": "Facture trouvée",
  "hash": "<sha512>",          // intégrité du payload
  "invoice": {
    "token": "<token>",
    "total_amount": 5000,
    "description": "...",
    "items": [],
    "taxes": []
  },
  "custom_data": {
    "payment_id": "pay_abc123",
    "registration_id": "reg_xyz789"
  },
  "status": "completed",       // ← clé pour le mapping
  "customer": {
    "name": "Aïssatou Diop",
    "phone": "+221 77 123 45 67",
    "email": "aissatou@example.sn"
  },
  "receipt_url": "https://paydunya.com/receipt/<token>.pdf",
  "mode": "test",              // "test" en sandbox, absent en live
  "fail_reason": null
}
```

> 📍 **Usage côté Teranga** :
> 1. **Réconciliation manuelle** : appelée par le job de réconciliation Phase 3 toutes les 5 min sur les paiements `processing` depuis > 10 min.
> 2. **Webhook recovery** : si l'IPN est manqué, `verify()` rattrape l'état.
> 3. **Jamais** appelée sur le chemin chaud d'une mutation côté API publique.

---

## 5. SOFTPAY — Flow direct par wallet (Phase 3, opt-in)

SOFTPAY contourne la page hosted et déclenche directement le push-payment sur le wallet utilisateur. **L'utilisateur saisit son numéro mobile money dans notre UI** ; PayDunya envoie l'OTP / la notification au wallet.

> ⚠️ **Pas en v1.** SOFTPAY exige : (1) une UI custom par wallet, (2) un test E2E par canal, (3) une revue PCI light (numéro = donnée semi-sensible). Phase 3 ouvrira ce flow uniquement après validation du hosted checkout en production.

### 5.1 Pré-requis

1. Avoir d'abord créé l'invoice via `POST /checkout-invoice/create` (§4.2) — SOFTPAY consomme un token existant.
2. L'invoice doit être en statut `pending` (non payée, non expirée).

### 5.2 Endpoints par canal (Sénégal)

| Canal | Endpoint | Body minimum |
|---|---|---|
| Wave Sénégal | `POST {{base}}/softpay/wave-senegal` | `{ wave_senegal_fullName, wave_senegal_email, wave_senegal_phone, wave_senegal_payment_token }` |
| Orange Money Sénégal | `POST {{base}}/softpay/orange-money-senegal` | `{ customer_name, customer_email, phone_number, otp_code, invoice_token }` |
| Free Money Sénégal | `POST {{base}}/softpay/free-money-senegal` | `{ customer_name, customer_email, phone_number, payment_token }` |

> 🔑 **Spécificité OM Sénégal** : OTP obligatoire (`#144#391*<code>#`). L'utilisateur doit le générer côté Orange avant la requête. Notre UI doit l'expliquer en français + wolof.

### 5.3 Réponse SOFTPAY

```jsonc
{
  "success": true,
  "message": "Paiement initié avec succès. L'utilisateur va recevoir une notification.",
  "fees": 50,
  "currency": "XOF"
}
```

À ce stade, **le paiement est juste initié** — il faut attendre l'IPN (§6) pour la confirmation. Notre `Payment.status` reste `processing`.

### 5.4 Quand préférer SOFTPAY au hosted checkout ?

| Critère | Hosted | SOFTPAY |
|---|---|---|
| Time-to-market | ✅ semaines | ❌ mois (1 UI par wallet) |
| UX mobile native | ⚠ redirect | ✅ in-app |
| Conversion | baseline | +5-10% (industry) |
| Maintenance | 1 page PayDunya | N pages × N wallets |
| **Verdict v1** | ✅ par défaut | ❌ Phase 3 |

---

## 6. Webhook IPN (Instant Payment Notification)

C'est **le seul mécanisme officiel de confirmation** d'un paiement. Le `verify()` HTTP existe mais n'est qu'un filet de sécurité (réconciliation tardive).

### 6.1 Format de la requête entrante

PayDunya **POST** vers `actions.callback_url` (notre `POST /v1/payments/webhook`) :

```http
POST /v1/payments/webhook HTTP/1.1
Host: api.teranga.app
Content-Type: application/x-www-form-urlencoded
Content-Length: 1234
User-Agent: PayDunya-IPN/1.0

data=%7B%22response_code%22%3A%2200%22%2C%22status%22%3A%22completed%22%2C...%7D
```

> ⚠️ **Pas de JSON.** Le payload est un seul champ form-encoded `data` qui contient un **objet JSON sérialisé**. Notre handler doit :
> 1. Parser `application/x-www-form-urlencoded` (`@fastify/formbody` enregistré).
> 2. Extraire `request.body.data` (string).
> 3. `JSON.parse(data)` pour obtenir le payload.
> 4. **Garder le rawBody original** (avant parse) pour la signature — voir §6.2.

### 6.2 Vérification de signature

PayDunya signe la notification avec un **SHA-512 de la MasterKey** :

```ts
import { createHash, timingSafeEqual } from "node:crypto";

verifyWebhook({ rawBody, headers }: VerifyWebhookParams): boolean {
  // 1. Extract data field
  const params = new URLSearchParams(rawBody);
  const dataStr = params.get("data");
  if (!dataStr) return false;

  // 2. Parse payload
  let payload: { hash?: string };
  try { payload = JSON.parse(dataStr); } catch { return false; }
  if (!payload.hash) return false;

  // 3. Recompute SHA-512(masterKey)
  const expected = createHash("sha512")
    .update(env.PAYDUNYA_MASTER_KEY)
    .digest("hex");

  // 4. Constant-time compare
  const a = Buffer.from(payload.hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

> 🚨 **Anti-pattern à interdire** : `if (payload.hash === expected)` — vulnérable aux timing attacks (cf. CLAUDE.md "QR Badge Security"). Toujours `timingSafeEqual`.

### 6.3 Anti-replay & idempotence

PayDunya **ne fournit pas de nonce/timestamp signé**. La défense anti-replay repose sur **nous** :

1. **Idempotency key** = `payload.invoice.token` (le token PayDunya).
2. À chaque IPN reçu, le handler tente `tx.create(webhookEvents/<token>, { receivedAt, sourceIp, ... })` — `ALREADY_EXISTS` ⇒ replay, on répond 200 sans re-traiter.
3. **Toujours** vérifier que `payload.custom_data.payment_id` correspond à un `Payment` existant et que l'amount matche `Payment.amount` (anti-tampering, cf. P1-04 du backlog).
4. **Toujours** vérifier que `Payment.providerTransactionId === payload.invoice.token` (anti-cross-payment).

> 📐 **Schéma d'invariant** : `Payment.amount === payload.invoice.total_amount && Payment.id === payload.custom_data.payment_id && Payment.providerTransactionId === payload.invoice.token`. Une seule de ces égalités fausse ⇒ rejet 422 + alerte Sentry.

### 6.4 Mapping de statut

| `payload.status` PayDunya | `Payment.status` Teranga | Action |
|---|---|---|
| `completed` | `succeeded` | tx { update Payment + balanceTx + emit `payment.succeeded` } |
| `pending` | `processing` | no-op (on attend l'IPN final) |
| `cancelled` | `failed` | tx { update Payment + emit `payment.failed` } |
| `failed` | `failed` | tx { update Payment + emit `payment.failed` } |
| `expired` | `expired` | tx { update Payment + emit `payment.expired` } |

> 🔁 **Idempotence du state** : un IPN `completed` reçu sur un Payment déjà `succeeded` est traité comme replay (200 OK, log info). Un IPN `completed` sur un Payment `failed` est un **incident** (200 OK pour PayDunya mais alerte Sentry — désynchronisation).

### 6.5 Réponse attendue par PayDunya

PayDunya considère l'IPN livré si **HTTP 200**. Toute autre réponse (4xx, 5xx) déclenche **3 retries avec backoff exponentiel** (5s, 25s, 125s). Au-delà, l'IPN est marqué échoué côté PayDunya — il faut alors passer par le job de réconciliation (`GET /checkout-invoice/confirm`).

> ✅ **Règle** : on répond 200 dès que la signature et l'idempotence sont validées, **avant** d'avoir traité le payload. Le traitement métier (badge gen, notif) part en domain-event asynchrone.

---

## 7. Disbursements — Payouts vers les organisations

PayDunya expose une API **disbursement** pour pousser de l'argent **du compte plateforme Teranga vers le wallet d'un organisateur** (modèle D3 platform-collected merchant-of-record).

> ⚠️ **Phase 4 uniquement.** Le ledger interne est déjà event-sourced (`balanceTransactions`), mais les payouts sortants ne sont pas encore branchés à PayDunya. La doc ci-dessous est la cible.

### 7.1 Pré-requis comptables

Avant tout disbursement :

1. **Hold de 7 jours** appliqué (cf. ledger `available` vs `pending`).
2. **Solde disponible >= montant demandé** (lecture `balanceTransactions` agrégé).
3. **PayoutLock acquis** (collection `payoutLocks/<orgId>`) — empêche un double déclenchement concurrent.
4. **KYC organisation valide** (champ `Organization.kyc.status === "verified"`).

### 7.2 Création du disbursement invoice

**Endpoint :** `POST {{base-v2}}/disburse/get-invoice`

> Note : la disbursement API utilise **`/api/v2/`**, pas `/api/v1/`. Différent de la collection ! Le provider Teranga doit exposer deux clients HTTP distincts.

**Body :**

```jsonc
{
  "account_alias": "+221771234567",       // numéro wallet de l'organisateur
  "amount": 250000,                       // XOF
  "withdraw_mode": "wave-senegal",         // ou "orange-money-senegal", etc.
  "callback_url": "https://api.teranga.app/v1/payouts/webhook"
}
```

**Réponse :**

```jsonc
{
  "response_code": "00",
  "response_text": "Disbursement initiated",
  "disburse_token": "<token>",
  "disburse_id": "DSB-2026-04-26-1234"
}
```

### 7.3 Confirmation du disbursement

**Endpoint :** `POST {{base-v2}}/disburse/submit-invoice/<disburse_token>`

> Le double appel (get-invoice → submit-invoice) est volontaire côté PayDunya : il permet de **prévisualiser les frais** entre les deux étapes et de **bloquer** si l'utilisateur change d'avis. Côté Teranga, on enchaîne les deux appels dans la même transaction logique sauf en cas de variation de frais > seuil (alerte ops).

### 7.4 Webhook IPN payout

Format identique au webhook paiement (§6.1) mais sur `payouts/webhook`. Le statut final est :

| `status` PayDunya | `Payout.status` Teranga |
|---|---|
| `completed` | `succeeded` |
| `pending` | `processing` |
| `failed` | `failed` |

En cas de `failed`, le ledger ré-incrémente le solde `available` (compensating transaction), un audit log `payout.reversed` est émis, et l'organisateur reçoit une notif fr/en.

### 7.5 Modes de retrait disponibles

Le champ `withdraw_mode` accepte les mêmes canaux que le paiement entrant (cf. §8) ; le provider doit valider qu'un canal est compatible avec le pays d'origine de l'organisation (`Organization.country`).

---

## 8. Matrice canaux × pays

| Canal (`channel` PayDunya) | SN | CI | BJ | BF | TG | ML | Notes |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `wave-senegal` | ✅ | — | — | — | — | — | Sénégal uniquement |
| `wave-ci` | — | ✅ | — | — | — | — | Côte d'Ivoire |
| `orange-money-senegal` | ✅ | — | — | — | — | — | OTP `#144#391*<code>#` requis |
| `orange-money-ci` | — | ✅ | — | — | — | — | |
| `orange-money-burkina` | — | — | — | ✅ | — | — | |
| `orange-money-mali` | — | — | — | — | — | ✅ | |
| `free-money-senegal` | ✅ | — | — | — | — | — | |
| `expresso-sn` | ✅ | — | — | — | — | — | |
| `wizall-senegal` | ✅ | — | — | — | — | — | |
| `mtn-ci` / `mtn-benin` | — | ✅ | ✅ | — | — | — | |
| `moov-ci` / `moov-benin` / `moov-burkina-faso` / `moov-togo` / `moov-ml` | — | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `t-money-togo` | — | — | — | — | ✅ | — | |
| `card` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Visa / Mastercard via passerelle interbancaire |

> 🌍 **v1 release scope** : Sénégal uniquement (Wave + OM + Free Money + Card). Les autres canaux sont activés en Phase 5+ après validation du modèle multi-pays.

### 8.1 Mapping `Payment.method` Teranga → canal PayDunya

```ts
const CHANNEL_MAP: Record<PaymentMethod, string | null> = {
  wave:         "wave-senegal",
  orange_money: "orange-money-senegal",
  free_money:   "free-money-senegal",
  card:         "card",
  mock:         null, // pas de PayDunya en mock — provider mock direct
};
```

Pour le hosted checkout, le canal est **suggéré** mais l'utilisateur peut en changer sur la page PayDunya. Pour SOFTPAY, le canal est **imposé** (1 endpoint = 1 canal).

---

## 9. Codes de réponse PayDunya

PayDunya utilise des `response_code` numériques sur 2-4 chiffres. Tableau exhaustif observé en intégration :

| Code | Signification | Domaine Teranga | Action |
|---|---|---|---|
| `"00"` | Succès | succès logique | continuer |
| `"08"` | Champ obligatoire manquant | `VALIDATION_ERROR` (notre côté) | logger + alerte (bug provider) |
| `"24"` | Solde marchand insuffisant (disbursement) | `INSUFFICIENT_FUNDS` | alerte ops, retry après recharge |
| `"42"` | Token invalide / expiré | `NOT_FOUND` ou `EXPIRED` | re-créer une invoice |
| `"50"` | Erreur réseau / wallet upstream | `PROVIDER_ERROR` | retry exponentiel (3×) |
| `"99"` | Erreur serveur PayDunya | `PROVIDER_ERROR` | retry + alerte si > 1% requêtes |
| `"4004"` | Invoice introuvable | `NOT_FOUND` | reconciliation retry |

### 9.1 Mapping `ProviderError` (P1-11)

```ts
export class ProviderError extends Error {
  constructor(
    public readonly providerCode: string,
    public readonly providerMessage: string,
    public readonly retriable: boolean,
  ) {
    super(`[paydunya] ${providerCode}: ${providerMessage}`);
  }
}

const RETRIABLE_CODES = new Set(["50", "99"]);
const NOT_FOUND_CODES = new Set(["42", "4004"]);
const FUND_CODES = new Set(["24"]);

function fromPayDunyaResponse(r: { response_code: string; response_text: string }): ProviderError {
  return new ProviderError(
    r.response_code,
    r.response_text,
    RETRIABLE_CODES.has(r.response_code),
  );
}
```

> 🎯 **Politique retry** : `retriable === true` ⇒ 3 essais avec backoff `[500ms, 2s, 8s]`. Au-delà ⇒ on remonte le `ProviderError` au service, qui passe le `Payment.status` en `failed` et émet `payment.failed`.

---

## 10. Implémentation `PayDunyaPaymentProvider`

Squelette cible (à livrer en Phase 2). Respecte strictement [`payment-provider.interface.ts`](../../../apps/api/src/providers/payment-provider.interface.ts).

```ts
// apps/api/src/providers/paydunya-payment.provider.ts
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { ProviderError } from "@/errors/provider.error";
import type {
  PaymentProvider,
  InitiateParams, InitiateResult,
  VerifyResult, RefundResult,
  VerifyWebhookParams,
} from "./payment-provider.interface";

const BASE = env.PAYDUNYA_MODE === "live"
  ? "https://app.paydunya.com/api/v1"
  : "https://app.paydunya.com/sandbox-api/v1";

const HEADERS = () => ({
  "PAYDUNYA-MASTER-KEY":  env.PAYDUNYA_MASTER_KEY,
  "PAYDUNYA-PRIVATE-KEY": env.PAYDUNYA_PRIVATE_KEY,
  "PAYDUNYA-TOKEN":       env.PAYDUNYA_TOKEN,
  "Content-Type":         "application/json",
  "Accept":               "application/json",
});

class PayDunyaProvider implements PaymentProvider {
  readonly name = "paydunya";

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const body = {
      invoice: { total_amount: params.amount, description: params.description },
      store:   { name: "Teranga Events" },
      actions: {
        callback_url: params.callbackUrl,
        return_url:   params.returnUrl,
        cancel_url:   params.returnUrl, // même URL, le client distingue via query string
      },
      custom_data: { payment_id: params.paymentId },
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${BASE}/checkout-invoice/create`, {
        method: "POST",
        headers: HEADERS(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = await res.json() as {
        response_code: string;
        response_text: string;
        token?: string;
      };
      if (json.response_code !== "00" || !json.token) {
        throw fromPayDunyaResponse(json);
      }
      return {
        providerTransactionId: json.token,
        redirectUrl: json.response_text,
      };
    } finally {
      clearTimeout(t);
    }
  }

  async verify(providerTxId: string): Promise<VerifyResult> {
    const res = await fetch(`${BASE}/checkout-invoice/confirm/${providerTxId}`, {
      headers: HEADERS(),
    });
    const json = await res.json() as { response_code: string; status?: string };
    if (json.response_code === "4004") return { status: "failed", metadata: json };
    if (json.response_code !== "00")  throw fromPayDunyaResponse(json);
    return {
      status: mapStatus(json.status),
      metadata: json,
    };
  }

  async refund(providerTxId: string, amount: number): Promise<RefundResult> {
    // PayDunya n'a pas de refund API publique programmatique en v1.
    // Cf. §11 — refunds en mode "manual_refund_required".
    return { success: false, reason: "manual_refund_required" };
  }

  verifyWebhook(p: VerifyWebhookParams): boolean {
    const params = new URLSearchParams(p.rawBody);
    const dataStr = params.get("data");
    if (!dataStr) return false;
    let payload: { hash?: string };
    try { payload = JSON.parse(dataStr); } catch { return false; }
    if (!payload.hash) return false;

    const expected = createHash("sha512")
      .update(env.PAYDUNYA_MASTER_KEY)
      .digest("hex");
    const a = Buffer.from(payload.hash, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

export const paydunyaPaymentProvider = new PayDunyaProvider();
```

### 10.1 Tests requis (cf. teranga-testing skill)

| Cas | Description | Reference |
|---|---|---|
| Happy initiate | `response_code === "00"` → `InitiateResult` valide | `paydunya.provider.test.ts` |
| Initiate erreur | `"08"` → `ProviderError` non-retriable | idem |
| Initiate retry | `"50"` × 2 puis `"00"` → succès après retries | idem |
| Verify completed | `status: "completed"` → `succeeded` | idem |
| Verify 4004 | `response_code: "4004"` → `failed` (pas de throw) | idem |
| Webhook signature OK | hash valide → `true` | idem |
| Webhook signature KO | hash mismatch → `false` (pas de throw) | idem |
| Webhook rawBody manquant | `data` absent → `false` | idem |
| Refund | toujours `{ success: false, reason: "manual_refund_required" }` | idem |

---

## 11. Refunds & avoirs

### 11.1 Limitation PayDunya v1

À ce jour, PayDunya **n'expose pas d'API publique programmatique** pour rembourser une invoice payée. Les refunds passent par :

1. Backoffice PayDunya — opération manuelle d'un opérateur Teranga.
2. Compensating disbursement — créer un payout vers l'organisateur **fictivement annulé**, puis déduire de son solde dispo.

> 📌 **Décision (audit D4 + §3.6)** : tant que PayDunya n'expose pas d'API refund, `refund()` retourne **toujours** `{ success: false, reason: "manual_refund_required" }`. Le service layer reçoit cette réponse, marque le `Payment.status = "refund_pending"`, émet `payment.refund_requested`, et **n'essaie pas** de jouer un fallback automatique (anti-double-refund).

### 11.2 Fenêtre de remboursement (D4)

Refund autorisé uniquement si :

- `Payment.status === "succeeded"` ;
- `now < event.startDate + 24h` (grâce post-event 24h) ;
- `Refund.amount <= Payment.amount - sum(previousRefunds)` (anti-over-refund).

Hors fenêtre ⇒ erreur `422 UNPROCESSABLE_ENTITY` avec `details.reason = "refund_window_expired"`.

### 11.3 Refund-lock

Toute opération de refund acquiert un lock `refundLocks/<paymentId>` via `tx.create()` — `ALREADY_EXISTS` ⇒ refund déjà en cours, on rejette. Lock auto-expiré après 5 min via TTL Firestore.

---

## 12. Sandbox — Spécificités & quirks

### 12.1 Numéros de test PayDunya

Le sandbox accepte n'importe quel numéro mobile au format `+221XXXXXXXX`. **Les paiements sandbox ne déclenchent jamais l'app wallet réel** ; ils sont simulés par PayDunya et un IPN est envoyé après 5–15s.

| Scénario | Numéro | Résultat |
|---|---|---|
| Succès | `+221770000001` | IPN `completed` après ~5s |
| Échec | `+221770000002` | IPN `failed` après ~5s |
| Pending → succès | `+221770000003` | IPN `pending` puis `completed` à T+30s |

> 📚 **Source** : la doc PayDunya publique liste seulement le succès — les autres codes sont dérivés de l'expérience d'autres intégrateurs SAAS WAEMU. À valider en Phase 2 sur compte sandbox réel.

### 12.2 `mode: "test"` sur les réponses

Toutes les invoices créées en sandbox portent `"mode": "test"`. Notre provider doit :

- **rejeter au démarrage** un boot production avec `mode: "test"` retourné par un ping (cf. P1-18) ;
- **logger un warning** chaque fois qu'un IPN production arrive avec `"mode": "test"` (configuration mismatch).

### 12.3 IP allowlist (P1-15)

PayDunya émet ses webhooks depuis une plage d'IPs documentée. À récupérer auprès du support PayDunya en Phase 2 et à ajouter dans le middleware `ipAllowlist` du webhook (cf. backlog P1-15). Tant que l'allowlist n'est pas en place, le rate-limit composite-key (cf. ADR-0015) limite à 30 req/min par IP non authentifiée — barrière minimale.

### 12.4 Différences Sandbox vs Live

| Comportement | Sandbox | Live |
|---|---|---|
| URL base | `/sandbox-api/v1` | `/api/v1` |
| `mode` dans réponses | `"test"` | absent |
| Délai IPN | 5–15s | dépend wallet (5s à 5min) |
| Frais | retournés mais pas prélevés | réellement prélevés |
| Disbursement réel | non | oui |
| OTP OM | n'importe quelle valeur acceptée | OTP réel `#144#391*X#` |

---

## 13. Threat model — résumé spécifique PayDunya

Référence détaillée : audit §3.1 (T-PD-01..T-PD-07).

| ID | Menace | Mitigation Teranga |
|---|---|---|
| T-PD-01 | Fuite des 3 clés en log | Pino `redact` invariant (P1-12), Secret Manager, jamais en `.env` committé |
| T-PD-02 | Replay du webhook IPN | `webhookEvents/<token>` idempotency sentinel + `tx.create()` |
| T-PD-03 | Tampering du payload IPN | SHA-512 signature `timingSafeEqual` + amount cross-check (P1-04) |
| T-PD-04 | Cross-payment via token réutilisé | `Payment.providerTransactionId === payload.invoice.token` invariant |
| T-PD-05 | Server-side request forgery via `callback_url` | URL hard-codée côté server, jamais lue d'un input client |
| T-PD-06 | Double-refund (manuel backoffice + auto) | `refundLocks/<paymentId>` + `refund()` toujours `manual_refund_required` |
| T-PD-07 | DDoS du webhook | Rate-limit composite-key 30/min/IP + IP allowlist Phase 2 (P1-15) |

---

## 14. Rate limits & SLA observés

PayDunya ne publie pas de SLA officiel. Observations communauté + intégrateurs :

| Métrique | Valeur observée |
|---|---|
| Latence p50 `POST /checkout-invoice/create` | ~400ms |
| Latence p99 | ~2.5s |
| Délai IPN succès (Wave) | 3-15s post-paiement utilisateur |
| Délai IPN succès (OM) | 10-60s post-saisie OTP |
| Disponibilité observée | ~99.5% |
| Rate limit entrant (estimé) | 100 req/min/clé |

> 🛡 **Côté Teranga** : timeout HTTP **30s** (`AbortController`), 3 retries sur codes `50`/`99`, circuit breaker (Phase 3) après 5 échecs consécutifs sur 1 min. **Aucun appel `verify()` en synchrone sur le chemin chaud** — toujours via job de réconciliation ou IPN.

---

## 15. Checklist d'intégration (Phase 2)

À cocher avant merge de la PR Phase 2 :

- [ ] `PayDunyaPaymentProvider` implémente les 4 méthodes de l'interface
- [ ] Secrets dans GCP Secret Manager (3 clés × 2 envs)
- [ ] `assertRequiredSecrets()` au boot refuse `PAYDUNYA_MODE === "live"` sans clés
- [ ] Pino `redact` couvre `req.headers.PAYDUNYA-*` + `req.body.data`
- [ ] `@fastify/formbody` enregistré pour le webhook
- [ ] rawBody capturé **avant** le parse formbody (custom plugin Fastify)
- [ ] `verifyWebhook()` implémente le SHA-512 + `timingSafeEqual`
- [ ] `webhookEvents/<token>` idempotency via `tx.create()`
- [ ] Anti-tampering : amount + payment_id + token cross-check
- [ ] `ProviderError` typé + retry policy retriable codes seulement
- [ ] Mapping de statut complet (`completed`/`pending`/`cancelled`/`failed`/`expired`)
- [ ] `refund()` retourne `{ success: false, reason: "manual_refund_required" }`
- [ ] Tests des 9 cas du tableau §10.1
- [ ] Snapshot route-inventory + permission-matrix refresh si nouvelles routes
- [ ] Audit log via `eventBus.emit('payment.*', ...)` sur chaque mutation
- [ ] `paydunya.md` (ce fichier) cross-référencé depuis `docs-v2/30-api/payments.md`
- [ ] Test sandbox E2E : initiate → redirect → IPN → succeeded → badge généré
- [ ] Tests `@security-reviewer` + `@firestore-transaction-auditor` + `@domain-event-auditor` ✅
- [ ] Plan rollback documenté : `LEGACY_PROVIDER=true` rebascule sur Wave/OM directs

---

## 16. Pour aller plus loin

| Document | Pertinence |
|---|---|
| [`docs/audit-2026-04-26/PAYMENT-READINESS-REPORT.md`](../../../docs/audit-2026-04-26/PAYMENT-READINESS-REPORT.md) | Audit Phase 0 — décisions D1-D6, threat model, backlog Phase 1-6 |
| [`docs-v2/20-architecture/decisions/0015-trust-proxy-auth-aware-rate-limit.md`](../../20-architecture/decisions/0015-trust-proxy-auth-aware-rate-limit.md) | Composite-key rate limit (clé `apikey:* / user:* / ip:*`) |
| [`apps/api/src/providers/payment-provider.interface.ts`](../../../apps/api/src/providers/payment-provider.interface.ts) | Contrat à respecter |
| [`apps/api/src/providers/wave-payment.provider.ts`](../../../apps/api/src/providers/wave-payment.provider.ts) | Pattern de référence (timeout, headers, parsing) |
| [`apps/api/src/services/payment.service.ts`](../../../apps/api/src/services/payment.service.ts) | Registry à modifier |
| [`docs-v2/30-api/payments.md`](../payments.md) | Endpoints publics consommés par les clients |
| [Documentation officielle PayDunya HTTP/JSON](https://developers.paydunya.com/doc/FR/http_json) | Référence externe (FR) |
| [Documentation officielle PayDunya Node.js SDK](https://developers.paydunya.com/doc/FR/NodeJS) | SDK officiel — non utilisé (préférence fetch natif) |
| [Documentation officielle PayDunya Disbursement](https://developers.paydunya.com/doc/FR/api_deboursement) | API v2 disbursement (Phase 4) |

---

> 📝 **Note maintenance** : ce document est la source de vérité pour l'intégration PayDunya. Toute évolution du provider (nouveau canal, nouveau code de réponse, changement de contrat) doit être reflétée ici **avant** la PR de code. Le frontmatter `last_updated` doit être mis à jour à chaque modification.
