#!/usr/bin/env pwsh
# ============================================================================
# Teranga Events — GitHub Secrets Setup Script
# ============================================================================
# Minimal secrets setup. The CI/CD pipeline derives Firebase config, GCP
# project ID, and URLs automatically from the service account key at deploy
# time via the Firebase Management REST API.
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: https://cli.github.com/
#   - A Firebase/GCP service account JSON key file (firebase_adminsdk.json)
#
# Usage:
#   ./scripts/setup-github-secrets.ps1
#
# Secrets set (staging environment):
#   GCP_SA_KEY       — Service account JSON key (derives everything)
#   RESEND_API_KEY   — Resend email API key
#   QR_SECRET        — Auto-generated HMAC-SHA256 key for QR badge signing
#   WEBHOOK_SECRET   — Auto-generated webhook signature key
#
# Optional variable (non-secret):
#   API_URL_STAGING  — Cloud Run URL (auto-detected after first deploy)
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
    Write-Host "  -> $text" -ForegroundColor Yellow
}

function Read-Input($prompt, $default = "") {
    if ($default) {
        $input = Read-Host "  $prompt [$default]"
        if ([string]::IsNullOrWhiteSpace($input)) { return $default }
        return $input
    }
    else {
        return Read-Host "  $prompt"
    }
}

function Set-EnvSecret($name, $value, $env) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  -- Skipping $name (empty)" -ForegroundColor DarkGray
        return
    }
    Write-Step "Setting [$env] secret: $name"
    $value | gh secret set $name --repo $REPO --env $env
}

function Set-EnvVariable($name, $value, $env) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  -- Skipping $name (empty)" -ForegroundColor DarkGray
        return
    }
    Write-Step "Setting [$env] variable: $name"
    gh variable set $name --repo $REPO --env $env --body $value
}

function New-RandomSecret($length = 64) {
    $bytes = [byte[]]::new($length / 2)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# ─── Preflight ──────────────────────────────────────────────────────────────

Write-Header "Preflight Check"

try {
    gh auth status 2>&1 | Out-Null
    Write-Host "  OK  GitHub CLI authenticated" -ForegroundColor Green
}
catch {
    Write-Host "  ERR GitHub CLI not authenticated. Run 'gh auth login' first." -ForegroundColor Red
    exit 1
}

Write-Host "  OK  Target repo: $REPO" -ForegroundColor Green

# ─── Auto-Generate Crypto Secrets ───────────────────────────────────────────

Write-Header "Auto-Generating Cryptographic Secrets"

$QR_SECRET = New-RandomSecret 64
Write-Host "  OK  QR_SECRET generated (64-char hex)" -ForegroundColor Green

$WEBHOOK_SECRET = New-RandomSecret 32
Write-Host "  OK  WEBHOOK_SECRET generated (32-char hex)" -ForegroundColor Green

# ─── GCP Service Account Key ───────────────────────────────────────────────

Write-Header "GCP / Firebase Service Account Key"
Write-Host "  This single JSON key is used for ALL deploys (Cloud Run, Hosting, Functions)" -ForegroundColor DarkGray
Write-Host "  and to auto-discover Firebase config at deploy time." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Required IAM roles:" -ForegroundColor DarkGray
Write-Host "    - Cloud Run Admin           - Firebase Hosting Admin" -ForegroundColor DarkGray
Write-Host "    - Cloud Build Editor        - Cloud Functions Admin" -ForegroundColor DarkGray
Write-Host "    - Service Account User      - Firebase Viewer (for SDK config discovery)" -ForegroundColor DarkGray
Write-Host ""

$SA_KEY_PATH = Read-Input "Path to service account JSON key (e.g. C:\Users\you\firebase_adminsdk.json)"
$GCP_SA_KEY = ""
$PROJECT_ID = "(unknown)"

if (-not [string]::IsNullOrWhiteSpace($SA_KEY_PATH)) {
    if (Test-Path $SA_KEY_PATH) {
        $GCP_SA_KEY = Get-Content $SA_KEY_PATH -Raw
        $keyJson = $GCP_SA_KEY | ConvertFrom-Json
        $PROJECT_ID = $keyJson.project_id
        Write-Host "  OK  Loaded key for project: $PROJECT_ID" -ForegroundColor Green
        Write-Host "  OK  Service account: $($keyJson.client_email)" -ForegroundColor Green
    }
    else {
        Write-Host "  ERR File not found: $SA_KEY_PATH" -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "  ERR Service account key is required." -ForegroundColor Red
    exit 1
}

# ─── Resend API Key ────────────────────────────────────────────────────────

Write-Header "Email Service (Resend)"
Write-Host "  The sender email/name default to noreply@teranga.events / Teranga Events" -ForegroundColor DarkGray
Write-Host "  (configured in the API code). Only the API key is needed here." -ForegroundColor DarkGray
Write-Host ""

$RESEND_API_KEY = Read-Input "Resend API Key (starts with re_, or Enter to skip)"

# ─── Optional: Cloud Run URL ───────────────────────────────────────────────

Write-Header "Optional: Staging API URL"
Write-Host "  The Cloud Run URL is auto-detected at deploy time if the service exists." -ForegroundColor DarkGray
Write-Host "  For the FIRST deploy, you can set it manually after deployment, or skip now." -ForegroundColor DarkGray
Write-Host ""

$API_URL = Read-Input "Staging API URL (e.g. https://teranga-api-staging-xxx.europe-west1.run.app, or Enter to skip)"

# ─── Review & Confirm ──────────────────────────────────────────────────────

Write-Header "Review"

Write-Host "  Project:        $PROJECT_ID" -ForegroundColor White
Write-Host "  Environment:    staging" -ForegroundColor White
Write-Host ""
Write-Host "  SECRETS (staging environment):" -ForegroundColor White
Write-Host "    GCP_SA_KEY      = (JSON key for $($keyJson.client_email))" -ForegroundColor Gray
Write-Host "    QR_SECRET       = (auto-generated, 64 chars)" -ForegroundColor Gray
Write-Host "    WEBHOOK_SECRET  = (auto-generated, 32 chars)" -ForegroundColor Gray
$resendDisplay = if ($RESEND_API_KEY) { "re_****" } else { "(skipped)" }
Write-Host "    RESEND_API_KEY  = $resendDisplay" -ForegroundColor Gray
Write-Host ""
$urlDisplay = if ($API_URL) { $API_URL } else { "(will auto-detect after first deploy)" }
Write-Host "  VARIABLES (staging environment):" -ForegroundColor White
Write-Host "    API_URL_STAGING = $urlDisplay" -ForegroundColor Gray
Write-Host ""
Write-Host "  Everything else (Firebase SDK config, project ID, URLs) is derived" -ForegroundColor DarkGray
Write-Host "  automatically from GCP_SA_KEY at deploy time." -ForegroundColor DarkGray
Write-Host ""

$confirm = Read-Host "  Proceed? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "  Aborted." -ForegroundColor Red
    exit 0
}

# ─── Apply ──────────────────────────────────────────────────────────────────

Write-Header "Applying Secrets"

Set-EnvSecret "GCP_SA_KEY"      $GCP_SA_KEY      "staging"
Set-EnvSecret "QR_SECRET"       $QR_SECRET       "staging"
Set-EnvSecret "WEBHOOK_SECRET"  $WEBHOOK_SECRET  "staging"
Set-EnvSecret "RESEND_API_KEY"  $RESEND_API_KEY  "staging"

if (-not [string]::IsNullOrWhiteSpace($API_URL)) {
    Set-EnvVariable "API_URL_STAGING" $API_URL "staging"
}

# ─── Done ───────────────────────────────────────────────────────────────────

Write-Header "Done!"
Write-Host "  OK  All secrets configured for staging environment." -ForegroundColor Green
Write-Host ""
Write-Host "  SAVE THESE (you'll need them for Cloud Run manual config):" -ForegroundColor Yellow
Write-Host "    QR_SECRET:      $QR_SECRET" -ForegroundColor Yellow
Write-Host "    WEBHOOK_SECRET: $WEBHOOK_SECRET" -ForegroundColor Yellow
Write-Host ""
Write-Host "  What happens at deploy time:" -ForegroundColor White
Write-Host "    1. Setup job reads GCP_SA_KEY, extracts project_id" -ForegroundColor DarkGray
Write-Host "    2. Calls Firebase Management API to discover web SDK config" -ForegroundColor DarkGray
Write-Host "    3. Detects Cloud Run URL from existing service" -ForegroundColor DarkGray
Write-Host "    4. Passes all derived values to deploy-api, deploy-web, deploy-functions" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  After first deploy, verify at:" -ForegroundColor White
Write-Host "    GitHub: Settings -> Secrets and variables -> Actions -> staging environment" -ForegroundColor DarkGray
Write-Host ""
