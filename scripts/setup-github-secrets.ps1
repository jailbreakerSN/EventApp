#!/usr/bin/env pwsh
# ============================================================================
# Teranga Events — GitHub Secrets Setup Script
# ============================================================================
# This script sets all required GitHub repository secrets and environment
# secrets for the Teranga Events platform.
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: https://cli.github.com/
#   - Run: gh auth login
#
# Usage:
#   ./scripts/setup-github-secrets.ps1
#
# What it does:
#   1. Sets REPOSITORY-LEVEL secrets (available to all workflows)
#   2. Sets STAGING ENVIRONMENT secrets (scoped to the "staging" environment)
#   3. Auto-generates cryptographic secrets (QR_SECRET, WEBHOOK_SECRET)
# ============================================================================

$ErrorActionPreference = "Stop"
$REPO = "jailbreakersn/eventapp"

# ─── Helpers ────────────────────────────────────────────────────────────────

function Write-Header($text) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($text) {
    Write-Host "  → $text" -ForegroundColor Yellow
}

function Read-Secret($prompt, $default = "") {
    if ($default) {
        $input = Read-Host "  $prompt [$default]"
        if ([string]::IsNullOrWhiteSpace($input)) { return $default }
        return $input
    }
    else {
        $input = Read-Host "  $prompt"
        return $input
    }
}

function Set-RepoSecret($name, $value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  ⏭ Skipping $name (empty value)" -ForegroundColor DarkGray
        return
    }
    Write-Step "Setting repo secret: $name"
    $value | gh secret set $name --repo $REPO
}

function Set-EnvSecret($name, $value, $env) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  ⏭ Skipping $name in [$env] (empty value)" -ForegroundColor DarkGray
        return
    }
    Write-Step "Setting [$env] secret: $name"
    $value | gh secret set $name --repo $REPO --env $env
}

function New-RandomSecret($length = 64) {
    $bytes = [byte[]]::new($length / 2)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# ─── Preflight Check ───────────────────────────────────────────────────────

Write-Header "Preflight Check"

try {
    gh auth status 2>&1 | Out-Null
    Write-Host "  ✓ GitHub CLI authenticated" -ForegroundColor Green
}
catch {
    Write-Host "  ✗ GitHub CLI not authenticated. Run 'gh auth login' first." -ForegroundColor Red
    exit 1
}

# Ensure staging environment exists (gh will create it if needed)
Write-Host "  ✓ Target repo: $REPO" -ForegroundColor Green
Write-Host "  ✓ Environments: repository-level + staging" -ForegroundColor Green

# ─── Auto-Generated Secrets ────────────────────────────────────────────────

Write-Header "Auto-Generating Cryptographic Secrets"

$QR_SECRET = New-RandomSecret 64
Write-Host "  ✓ QR_SECRET generated (64-char hex)" -ForegroundColor Green

$WEBHOOK_SECRET = New-RandomSecret 32
Write-Host "  ✓ WEBHOOK_SECRET generated (32-char hex)" -ForegroundColor Green

# ============================================================================
# SECTION 1: Firebase Configuration
# ============================================================================

Write-Header "Firebase Configuration (from Firebase Console → Project Settings)"
Write-Host "  Find these at: https://console.firebase.google.com → ⚙ Project Settings → General" -ForegroundColor DarkGray
Write-Host ""

$FIREBASE_PROJECT_ID         = Read-Secret "Firebase Project ID (e.g. teranga-events-dev)"
$FIREBASE_API_KEY            = Read-Secret "Firebase Web API Key"
$FIREBASE_AUTH_DOMAIN        = Read-Secret "Firebase Auth Domain" "$FIREBASE_PROJECT_ID.firebaseapp.com"
$FIREBASE_STORAGE_BUCKET     = Read-Secret "Firebase Storage Bucket" "$FIREBASE_PROJECT_ID.firebasestorage.app"
$FIREBASE_MESSAGING_SENDER_ID = Read-Secret "Firebase Messaging Sender ID"
$FIREBASE_APP_ID             = Read-Secret "Firebase App ID (e.g. 1:xxx:web:xxx)"
$FIREBASE_MEASUREMENT_ID     = Read-Secret "Firebase Measurement ID (optional, e.g. G-XXXXXX)"

# ============================================================================
# SECTION 2: GCP Service Account Key (single key for all deploys)
# ============================================================================

Write-Header "GCP / Firebase Service Account Key"
Write-Host "  A single JSON key file is used for Cloud Run, Firebase Hosting, and Functions deploys." -ForegroundColor DarkGray
Write-Host "  This is your firebase_adminsdk.json (or any GCP service account key with the right roles)." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Required IAM roles on this service account:" -ForegroundColor DarkGray
Write-Host "    - Cloud Run Admin" -ForegroundColor DarkGray
Write-Host "    - Cloud Build Editor" -ForegroundColor DarkGray
Write-Host "    - Firebase Hosting Admin" -ForegroundColor DarkGray
Write-Host "    - Cloud Functions Admin" -ForegroundColor DarkGray
Write-Host "    - Service Account User" -ForegroundColor DarkGray
Write-Host ""

$SA_KEY_PATH = Read-Secret "Path to your service account JSON key file (e.g. C:\Users\you\firebase_adminsdk.json)"
$GCP_SA_KEY = ""
if (-not [string]::IsNullOrWhiteSpace($SA_KEY_PATH)) {
    if (Test-Path $SA_KEY_PATH) {
        $GCP_SA_KEY = Get-Content $SA_KEY_PATH -Raw
        # Extract project_id from the JSON key for convenience
        $keyJson = $GCP_SA_KEY | ConvertFrom-Json
        $GCP_PROJECT_ID = $keyJson.project_id
        Write-Host "  ✓ Loaded service account key for project: $GCP_PROJECT_ID" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ File not found: $SA_KEY_PATH" -ForegroundColor Red
        Write-Host "    You can re-run the script later with the correct path." -ForegroundColor DarkGray
    }
}
else {
    $GCP_PROJECT_ID = Read-Secret "GCP Project ID (e.g. teranga-events-staging)" $FIREBASE_PROJECT_ID
}

# ============================================================================
# SECTION 4: Email — Resend
# ============================================================================

Write-Header "Email Service (Resend)"

$RESEND_API_KEY   = Read-Secret "Resend API Key (starts with re_)"
$RESEND_FROM_EMAIL = Read-Secret "Sender email address" "noreply@teranga.events"
$RESEND_FROM_NAME  = Read-Secret "Sender display name" "Teranga Events"

# ============================================================================
# SECTION 5: URLs (staging)
# ============================================================================

Write-Header "Staging URLs"
Write-Host "  These are the public URLs for your staging environment." -ForegroundColor DarkGray
Write-Host "  If not known yet, press Enter to skip." -ForegroundColor DarkGray
Write-Host ""

$API_URL_STAGING        = Read-Secret "Staging API URL (e.g. https://teranga-api-staging-xxxxx.europe-west1.run.app)"
$BACKOFFICE_URL_STAGING = Read-Secret "Staging Backoffice URL (e.g. https://teranga-events-staging.web.app)"
$PARTICIPANT_URL_STAGING = Read-Secret "Staging Participant URL (e.g. https://teranga-participant-staging.web.app)"

# ============================================================================
# SECTION 6: Optional — SMS, Sentry, Payments
# ============================================================================

Write-Header "Optional Services (press Enter to skip any)"

$AT_API_KEY   = Read-Secret "Africa's Talking API Key (or Enter to skip)"
$AT_USERNAME  = Read-Secret "Africa's Talking Username" "sandbox"
$AT_SENDER_ID = Read-Secret "Africa's Talking Sender ID" "Teranga"

$SENTRY_DSN = Read-Secret "Sentry DSN (or Enter to skip)"

# ============================================================================
# CONFIRM & APPLY
# ============================================================================

Write-Header "Review — Secrets to be set"

$secrets = @{
    # ── Repository-level secrets ──
    "repo" = [ordered]@{
        "FIREBASE_PROJECT_ID"      = $FIREBASE_PROJECT_ID
        "FIREBASE_STORAGE_BUCKET"  = $FIREBASE_STORAGE_BUCKET
        "QR_SECRET"                = if ($QR_SECRET) { "(auto-generated)" } else { "" }
        "WEBHOOK_SECRET"           = if ($WEBHOOK_SECRET) { "(auto-generated)" } else { "" }
        "RESEND_API_KEY"           = if ($RESEND_API_KEY) { "re_****" } else { "" }
        "RESEND_FROM_EMAIL"        = $RESEND_FROM_EMAIL
        "RESEND_FROM_NAME"         = $RESEND_FROM_NAME
        "AT_API_KEY"               = if ($AT_API_KEY) { "****" } else { "(skipped)" }
        "AT_USERNAME"              = $AT_USERNAME
        "AT_SENDER_ID"             = $AT_SENDER_ID
        "SENTRY_DSN"               = if ($SENTRY_DSN) { "****" } else { "(skipped)" }
    }
    # ── Staging environment secrets ──
    "staging" = [ordered]@{
        "GCP_SA_KEY"                          = if ($GCP_SA_KEY) { "(JSON key loaded)" } else { "(skipped)" }
        "FIREBASE_API_KEY_STAGING"            = if ($FIREBASE_API_KEY) { "****" } else { "" }
        "FIREBASE_PROJECT_ID_STAGING"         = $FIREBASE_PROJECT_ID
        "FIREBASE_AUTH_DOMAIN_STAGING"        = $FIREBASE_AUTH_DOMAIN
        "FIREBASE_STORAGE_BUCKET_STAGING"     = $FIREBASE_STORAGE_BUCKET
        "FIREBASE_MESSAGING_SENDER_ID_STAGING" = if ($FIREBASE_MESSAGING_SENDER_ID) { "****" } else { "" }
        "FIREBASE_APP_ID_STAGING"             = if ($FIREBASE_APP_ID) { "****" } else { "" }
        "GCP_PROJECT_ID"                      = $GCP_PROJECT_ID
        "API_URL_STAGING"                     = $API_URL_STAGING
        "BACKOFFICE_URL_STAGING"              = $BACKOFFICE_URL_STAGING
        "PARTICIPANT_URL_STAGING"             = $PARTICIPANT_URL_STAGING
    }
}

Write-Host "  REPOSITORY-LEVEL secrets:" -ForegroundColor White
foreach ($kv in $secrets["repo"].GetEnumerator()) {
    $display = if ([string]::IsNullOrWhiteSpace($kv.Value)) { "(skipped)" } else { $kv.Value }
    Write-Host "    $($kv.Key) = $display"
}
Write-Host ""
Write-Host "  STAGING ENVIRONMENT secrets:" -ForegroundColor White
foreach ($kv in $secrets["staging"].GetEnumerator()) {
    $display = if ([string]::IsNullOrWhiteSpace($kv.Value)) { "(skipped)" } else { $kv.Value }
    Write-Host "    $($kv.Key) = $display"
}
Write-Host ""

$confirm = Read-Host "  Proceed? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "  Aborted." -ForegroundColor Red
    exit 0
}

# ─── Apply Repository-Level Secrets ────────────────────────────────────────

Write-Header "Setting Repository-Level Secrets"

Set-RepoSecret "FIREBASE_PROJECT_ID"      $FIREBASE_PROJECT_ID
Set-RepoSecret "FIREBASE_STORAGE_BUCKET"  $FIREBASE_STORAGE_BUCKET
Set-RepoSecret "QR_SECRET"                $QR_SECRET
Set-RepoSecret "WEBHOOK_SECRET"           $WEBHOOK_SECRET
Set-RepoSecret "RESEND_API_KEY"           $RESEND_API_KEY
Set-RepoSecret "RESEND_FROM_EMAIL"        $RESEND_FROM_EMAIL
Set-RepoSecret "RESEND_FROM_NAME"         $RESEND_FROM_NAME
Set-RepoSecret "AT_API_KEY"               $AT_API_KEY
Set-RepoSecret "AT_USERNAME"              $AT_USERNAME
Set-RepoSecret "AT_SENDER_ID"             $AT_SENDER_ID
Set-RepoSecret "SENTRY_DSN"               $SENTRY_DSN

# ─── Apply Staging Environment Secrets ─────────────────────────────────────

Write-Header "Setting Staging Environment Secrets"

Set-EnvSecret "GCP_SA_KEY"                          $GCP_SA_KEY                  "staging"
Set-EnvSecret "FIREBASE_API_KEY_STAGING"            $FIREBASE_API_KEY            "staging"
Set-EnvSecret "FIREBASE_PROJECT_ID_STAGING"         $FIREBASE_PROJECT_ID         "staging"
Set-EnvSecret "FIREBASE_AUTH_DOMAIN_STAGING"        $FIREBASE_AUTH_DOMAIN        "staging"
Set-EnvSecret "FIREBASE_STORAGE_BUCKET_STAGING"     $FIREBASE_STORAGE_BUCKET     "staging"
Set-EnvSecret "FIREBASE_MESSAGING_SENDER_ID_STAGING" $FIREBASE_MESSAGING_SENDER_ID "staging"
Set-EnvSecret "FIREBASE_APP_ID_STAGING"             $FIREBASE_APP_ID             "staging"
Set-EnvSecret "GCP_PROJECT_ID"                      $GCP_PROJECT_ID              "staging"
Set-EnvSecret "API_URL_STAGING"                     $API_URL_STAGING             "staging"
Set-EnvSecret "BACKOFFICE_URL_STAGING"              $BACKOFFICE_URL_STAGING      "staging"
Set-EnvSecret "PARTICIPANT_URL_STAGING"             $PARTICIPANT_URL_STAGING     "staging"

# ─── Done ──────────────────────────────────────────────────────────────────

Write-Header "Done!"
Write-Host "  ✓ All secrets have been configured." -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Verify in GitHub → Settings → Secrets and variables → Actions" -ForegroundColor DarkGray
Write-Host "    2. Make sure the 'staging' environment exists in GitHub → Settings → Environments" -ForegroundColor DarkGray
Write-Host "    3. Re-run this script anytime to update values (secrets are idempotent)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ⚠ IMPORTANT: Save your auto-generated secrets somewhere safe:" -ForegroundColor Yellow
Write-Host "    QR_SECRET:      $QR_SECRET" -ForegroundColor Yellow
Write-Host "    WEBHOOK_SECRET: $WEBHOOK_SECRET" -ForegroundColor Yellow
Write-Host "  You'll need these if you configure Cloud Run env vars manually." -ForegroundColor Yellow
Write-Host ""
