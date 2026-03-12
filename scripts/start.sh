#!/bin/bash
# ============================================================
# Sovereign Stack — Startup Script
# ============================================================
# Starts infrastructure (Docker) and the native API.
#
# Usage:
#   ./scripts/start.sh          # Start everything
#   ./scripts/start.sh infra    # Start infrastructure only
#   ./scripts/start.sh api      # Start API only
#   ./scripts/start.sh app      # Start Tauri app only
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() { echo -e "${CYAN}[sovereign]${NC} $1"; }
success() { echo -e "${GREEN}[sovereign]${NC} $1"; }
warn() { echo -e "${YELLOW}[sovereign]${NC} $1"; }
error() { echo -e "${RED}[sovereign]${NC} $1"; }

# ── Check .env file ─────────────────────────────────────
if [ ! -f "$ROOT_DIR/.env" ]; then
  warn ".env file not found. Copying from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  warn "Edit .env and add your ANTHROPIC_API_KEY before starting."
  exit 1
fi

MODE="${1:-all}"

# ── Start Infrastructure ────────────────────────────────
start_infra() {
  log "Starting infrastructure services (Docker)..."
  cd "$ROOT_DIR/infra"
  docker compose --env-file "$ROOT_DIR/.env" up -d

  log "Waiting for PostgreSQL to be ready..."
  local retries=30
  while ! docker compose exec -T postgresql pg_isready -U sovereign -q 2>/dev/null; do
    retries=$((retries - 1))
    if [ $retries -le 0 ]; then
      error "PostgreSQL failed to start"
      exit 1
    fi
    sleep 1
  done
  success "PostgreSQL ready"

  log "Waiting for Redis..."
  local retries=15
  while ! docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
    retries=$((retries - 1))
    if [ $retries -le 0 ]; then
      error "Redis failed to start"
      exit 1
    fi
    sleep 1
  done
  success "Redis ready"

  # Pull embedding model for Ollama if not present
  log "Ensuring Ollama embedding model is available..."
  docker compose exec -T ollama ollama pull nomic-embed-text:latest 2>/dev/null || warn "Ollama model pull skipped (may already exist)"

  success "Infrastructure services running"
}

# ── Start Native API ────────────────────────────────────
start_api() {
  log "Starting native API on port 3100..."
  cd "$ROOT_DIR/api"

  # Install deps if needed
  if [ ! -d "node_modules" ]; then
    log "Installing API dependencies..."
    npm ci
  fi

  # Build
  log "Building API..."
  npm run build

  # Run Overmind migration
  log "Running Overmind database migration..."
  PGPASSWORD=sovereign psql -h localhost -U sovereign -d sovereign -f "$ROOT_DIR/infra/config/overmind-init.sql" 2>/dev/null || warn "Migration may have already been applied"

  # Start in background
  log "Starting API server..."
  node dist/index.js &
  API_PID=$!
  echo "$API_PID" > "$ROOT_DIR/.api.pid"

  # Wait for health
  local retries=20
  while ! curl -sf http://localhost:3100/health >/dev/null 2>&1; do
    retries=$((retries - 1))
    if [ $retries -le 0 ]; then
      error "API failed to start"
      exit 1
    fi
    sleep 1
  done
  success "API running (PID $API_PID)"
}

# ── Start Tauri App ─────────────────────────────────────
start_app() {
  log "Starting Tauri desktop app..."
  cd "$ROOT_DIR"
  npm run tauri dev &
  success "Tauri app starting..."
}

# ── Main ────────────────────────────────────────────────
case "$MODE" in
  infra)
    start_infra
    ;;
  api)
    start_api
    ;;
  app)
    start_app
    ;;
  all)
    start_infra
    start_api
    log ""
    success "Sovereign Stack is running!"
    log ""
    log "  API:       http://localhost:3100"
    log "  WebSocket: ws://localhost:3100/ws/overmind"
    log "  LiteLLM:   http://localhost:4000"
    log "  memU:      http://localhost:8090"
    log "  Ollama:    http://localhost:11434"
    log ""
    log "To start the desktop app: npm run tauri dev"
    log "To stop: ./scripts/stop.sh"
    ;;
  *)
    error "Unknown mode: $MODE"
    echo "Usage: $0 [all|infra|api|app]"
    exit 1
    ;;
esac
