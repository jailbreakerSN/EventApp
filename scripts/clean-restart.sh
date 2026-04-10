#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# clean-restart.sh — Kill dev servers, clear caches, restart
# Usage:
#   ./scripts/clean-restart.sh          # all apps
#   ./scripts/clean-restart.sh api      # API only
#   ./scripts/clean-restart.sh web      # both Next.js apps
#   ./scripts/clean-restart.sh participant  # participant app only
#   ./scripts/clean-restart.sh backoffice  # backoffice only
# ─────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[clean]${NC} $1"; }
warn() { echo -e "${YELLOW}[clean]${NC} $1"; }

# ── Step 1: Kill running dev servers ──────────────────────
log "Killing dev servers..."
# Next.js (ports 3001, 3002) and Fastify API (port 3000)
for port in 3000 3001 3002; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    log "  Killed process(es) on port $port"
  fi
done

# ── Step 2: Clear Next.js caches ─────────────────────────
clear_next_cache() {
  local app_dir="$1"
  local app_name="$2"
  if [ -d "$app_dir/.next" ]; then
    rm -rf "$app_dir/.next"
    log "  Cleared .next cache for $app_name"
  fi
}

if [[ "$TARGET" == "all" || "$TARGET" == "web" || "$TARGET" == "participant" ]]; then
  clear_next_cache "$ROOT_DIR/apps/web-participant" "web-participant"
fi
if [[ "$TARGET" == "all" || "$TARGET" == "web" || "$TARGET" == "backoffice" ]]; then
  clear_next_cache "$ROOT_DIR/apps/web-backoffice" "web-backoffice"
fi

# ── Step 3: Clear TypeScript build caches ─────────────────
log "Clearing TypeScript build info..."
find "$ROOT_DIR" -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete 2>/dev/null || true

# ── Step 4: Rebuild shared-types (dependency for everything) ─
if [[ "$TARGET" == "all" || "$TARGET" == "web" || "$TARGET" == "participant" || "$TARGET" == "backoffice" ]]; then
  log "Rebuilding shared-types..."
  (cd "$ROOT_DIR" && npm run types:build)
fi

# ── Step 5: Restart servers ───────────────────────────────
echo ""
log "Starting dev servers..."

if [[ "$TARGET" == "all" || "$TARGET" == "api" ]]; then
  log "  Starting API on :3000"
  (cd "$ROOT_DIR" && npm run api:dev &)
fi

if [[ "$TARGET" == "all" || "$TARGET" == "web" || "$TARGET" == "backoffice" ]]; then
  log "  Starting web-backoffice on :3001"
  (cd "$ROOT_DIR/apps/web-backoffice" && npx next dev -p 3001 --hostname 0.0.0.0 &)
fi

if [[ "$TARGET" == "all" || "$TARGET" == "web" || "$TARGET" == "participant" ]]; then
  log "  Starting web-participant on :3002"
  (cd "$ROOT_DIR/apps/web-participant" && npx next dev -p 3002 --hostname 0.0.0.0 &)
fi

echo ""
log "Done! Servers starting up."
echo ""
warn "To clear browser cache: Ctrl+Shift+Delete in your browser,"
warn "or hard-refresh with Ctrl+Shift+R (bypasses cache for current page)."
echo ""
echo "  API:          http://localhost:3000"
echo "  Backoffice:   http://localhost:3001"
echo "  Participant:  http://localhost:3002"
echo ""
