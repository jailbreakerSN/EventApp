#!/usr/bin/env bash
# upsert-alert-policy.sh — create-or-update a Cloud Monitoring alert
# policy by displayName. Invoked by
# .github/workflows/notification-ops-prereqs.yml.
#
# Usage: upsert-alert-policy.sh <project_id> <display_name> <policy_file>
#
#   project_id   — GCP project (e.g. teranga-app-990a8)
#   display_name — human-readable policy name; used as the dedup key.
#   policy_file  — path to a YAML policy spec (see
#                  infrastructure/monitoring/*.yaml).
#
# Idempotency contract:
#   - No existing policy with that displayName → create new.
#   - Existing policy → update it in place (preserves id + any
#     notification channels an operator attached manually).
#
# Exits non-zero on any gcloud or jq failure.

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <project_id> <display_name> <policy_file>" >&2
  exit 2
fi

PROJECT_ID="$1"
DISPLAY_NAME="$2"
POLICY_FILE="$3"

if [ ! -f "$POLICY_FILE" ]; then
  echo "::error::policy file not found: $POLICY_FILE"
  exit 1
fi

# Look up existing policy by displayName. gcloud returns name in the
# form `projects/$PROJECT_ID/alertPolicies/$ID`.
EXISTING=$(gcloud alpha monitoring policies list \
  --project="$PROJECT_ID" \
  --filter="displayName=\"$DISPLAY_NAME\"" \
  --format='value(name)' \
  --limit=1 2>/dev/null || echo "")

if [ -z "$EXISTING" ]; then
  echo "::notice::Creating alert policy '$DISPLAY_NAME' from $POLICY_FILE"
  gcloud alpha monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE" \
    --quiet
else
  echo "::notice::Updating existing alert policy '$DISPLAY_NAME' ($EXISTING)"
  # `policies update --policy-from-file` requires the policy id argument;
  # `--policy` takes the full resource name.
  gcloud alpha monitoring policies update "$EXISTING" \
    --project="$PROJECT_ID" \
    --policy-from-file="$POLICY_FILE" \
    --quiet
fi
