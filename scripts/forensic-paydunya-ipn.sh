#!/usr/bin/env bash
#
# Forensic — forge a wire-format PayDunya IPN and POST it to a target API.
#
# Usage:
#   PAYDUNYA_MASTER_KEY="<staging-master-key>" \
#   API_URL="https://teranga-api-staging-784468934140.europe-west1.run.app" \
#     ./scripts/forensic-paydunya-ipn.sh [INVOICE_TOKEN] [PAYMENT_ID] [STATUS] [AMOUNT]
#
# What it does:
#   1. Computes hash = SHA-512(MASTER_KEY)
#   2. Builds the JSON body PayDunya posts to /v1/payments/webhook/paydunya
#   3. URL-encodes it as `data=<json>`
#   4. POSTs application/x-www-form-urlencoded
#   5. Prints HTTP status, headers, body, and timing
#
# Diagnostic matrix:
#
#   200 success          → our pipeline ACCEPTS a well-formed PayDunya IPN.
#                          If staging payments stay in `processing`, it
#                          means PayDunya sandbox is NOT firing the IPN.
#                          Fix: implement verify-on-return.
#
#   403 invalid sig      → MASTER_KEY mismatch between this script and
#                          the staging service. Verify Secret Manager
#                          binding + revision env.
#
#   400 validation       → wire format mismatch. Likely a code drift
#                          between the local repo and the deployed
#                          revision.
#
#   404 unknown tx       → IPN reached us, signature OK, but no
#                          matching Payment row. Either the IPN beat the
#                          two-phase initiate tx2 (unlikely under
#                          normal flow) OR the providerTransactionId
#                          captured in initiate is different from
#                          PayDunya's invoice.token. Check audit log.
#
#   5xx                  → handler crashed. Check Cloud Run logs.
#
#   timeout / no route   → ingress / DNS / Cloud Run cold-start issue.
#                          Check `--allow-unauthenticated` is set + IAM
#                          allUsers binding is intact.

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
MASTER_KEY="${PAYDUNYA_MASTER_KEY:-}"
INVOICE_TOKEN="${1:-FORENSIC_TKN_$(date +%s)}"
PAYMENT_ID="${2:-pay_forensic_$(date +%s)}"
STATUS="${3:-completed}"
AMOUNT="${4:-5000}"

if [[ -z "$MASTER_KEY" ]]; then
  echo "❌ PAYDUNYA_MASTER_KEY env var is required" >&2
  exit 1
fi

# SHA-512(MasterKey), hex-encoded — what PayDunya signs.
HASH=$(printf '%s' "$MASTER_KEY" | openssl dgst -sha512 -hex | awk '{print $2}')

PAYLOAD=$(cat <<EOF
{
  "response_code": "00",
  "response_text": "Transaction Found",
  "hash": "${HASH}",
  "invoice": {
    "token": "${INVOICE_TOKEN}",
    "items": {},
    "total_amount": ${AMOUNT},
    "description": "Inscription événement Teranga (forensic)",
    "taxes": []
  },
  "custom_data": {
    "payment_id": "${PAYMENT_ID}"
  },
  "actions": {
    "cancel_url": "https://example.com/cancel",
    "callback_url": "${API_URL}/v1/payments/webhook/paydunya",
    "return_url": "https://example.com/return"
  },
  "mode": "test",
  "status": "${STATUS}",
  "fail_reason": "",
  "customer": {
    "name": "Forensic Test",
    "phone": "+221770000000",
    "email": "forensic@example.com",
    "payment_method": "wave-senegal",
    "country": "SN"
  },
  "receipt_identifier": "RCP-FORENSIC-1",
  "receipt_url": "https://paydunya.com/receipt/forensic"
}
EOF
)

# URL-encode the JSON for the `data=` form field.
URL_ENCODED=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$PAYLOAD")
BODY="data=${URL_ENCODED}"

echo "▶ POST ${API_URL}/v1/payments/webhook/paydunya"
echo "  invoice.token   = ${INVOICE_TOKEN}"
echo "  custom.payment  = ${PAYMENT_ID}"
echo "  status          = ${STATUS}"
echo "  amount          = ${AMOUNT}"
echo "  hash[0..16]     = ${HASH:0:16}…"
echo "  body bytes      = ${#BODY}"
echo

# -i shows status + headers; -w shows timing; -o pipes body to stdout via tee
START=$(date +%s%N)
RESPONSE=$(curl -sS -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: PayDunyaForensic/1.0 (+teranga-staging-test)" \
  --data-binary "$BODY" \
  -w "\n\n--- TIMING ---\nhttp_code=%{http_code}\nresponse_ms=%{time_total}\n" \
  "${API_URL}/v1/payments/webhook/paydunya")
END=$(date +%s%N)

echo "$RESPONSE"
echo
echo "▶ wall_clock_ms=$(( (END - START) / 1000000 ))"
