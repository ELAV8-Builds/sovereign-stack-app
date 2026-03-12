#!/usr/bin/env bash
# ============================================================
# Overmind — Worker Supervisor
# ============================================================
# Manages a native Claude Code worker session on the host machine.
#
# What it does:
# 1. Registers the worker with the Overmind fleet registry
# 2. Starts a Claude Code session with the specified project
# 3. Polls the command queue every 15 seconds for commands
# 4. Sends heartbeats with context usage to the Overmind API
# 5. Handles checkpoint/stop/restart commands
# 6. Auto-restarts the worker on crash or context reset
#
# Usage:
#   ./worker-supervisor.sh [options]
#
# Options:
#   --name NAME           Worker name (default: worker-1)
#   --project PATH        Project directory to open
#   --api-url URL         Overmind API URL (default: http://localhost:3100)
#   --capabilities CAPS   Comma-separated capabilities (default: code,build,test)
#   --max-load N          Max parallel tasks (default: 1)
#   --auto-restart        Auto-restart on exit (default: true)
#   --no-auto-restart     Disable auto-restart
#
# Environment:
#   OVERMIND_API_URL      Overmind API base URL
#   WORKER_NAME           Worker name
#   WORKER_PROJECT        Project directory
#   WORKER_CAPABILITIES   Comma-separated capabilities
#   WORKER_MAX_LOAD       Max parallel tasks
# ============================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────
WORKER_NAME="${WORKER_NAME:-worker-1}"
API_URL="${OVERMIND_API_URL:-http://localhost:3100}"
PROJECT_PATH="${WORKER_PROJECT:-}"
CAPABILITIES="${WORKER_CAPABILITIES:-code,build,test}"
MAX_LOAD="${WORKER_MAX_LOAD:-1}"
AUTO_RESTART=true
POLL_INTERVAL=15  # seconds
HEARTBEAT_INTERVAL=30  # seconds
WORKER_ID=""       # Set after registration
LOG_FILE="/tmp/overmind-worker-${WORKER_NAME}.log"

# ── Parse CLI args ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) WORKER_NAME="$2"; shift 2 ;;
    --project) PROJECT_PATH="$2"; shift 2 ;;
    --api-url) API_URL="$2"; shift 2 ;;
    --capabilities) CAPABILITIES="$2"; shift 2 ;;
    --max-load) MAX_LOAD="$2"; shift 2 ;;
    --auto-restart) AUTO_RESTART=true; shift ;;
    --no-auto-restart) AUTO_RESTART=false; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Logging ──────────────────────────────────────────────────
log() {
  local level="$1"; shift
  local msg="$*"
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts] [$level] $msg" | tee -a "$LOG_FILE"
}

info()  { log "INFO"  "$@"; }
warn()  { log "WARN"  "$@"; }
error() { log "ERROR" "$@"; }

# ── API Helpers ──────────────────────────────────────────────
api_post() {
  local path="$1"; shift
  local data="$1"; shift
  curl -sf -X POST "${API_URL}/api/overmind${path}" \
    -H 'Content-Type: application/json' \
    -d "$data" 2>/dev/null || echo '{"error":"request_failed"}'
}

api_get() {
  local path="$1"
  curl -sf "${API_URL}/api/overmind${path}" 2>/dev/null || echo '{"error":"request_failed"}'
}

# ── Registration ─────────────────────────────────────────────
register_worker() {
  info "Registering worker '${WORKER_NAME}' with Overmind..."

  # Convert capabilities string to JSON array
  local caps_json
  caps_json=$(echo "$CAPABILITIES" | tr ',' '\n' | jq -R . | jq -s .)

  local result
  result=$(api_post "/fleet/register" "$(jq -n \
    --arg name "$WORKER_NAME" \
    --arg url "local://${WORKER_NAME}" \
    --argjson capabilities "$caps_json" \
    --argjson max_load "$MAX_LOAD" \
    '{name: $name, url: $url, capabilities: $capabilities, max_load: $max_load}'
  )")

  WORKER_ID=$(echo "$result" | jq -r '.id // empty')

  if [[ -z "$WORKER_ID" ]]; then
    error "Failed to register worker: $result"
    return 1
  fi

  info "Registered as worker ID: $WORKER_ID"
}

# ── Heartbeat ────────────────────────────────────────────────
send_heartbeat() {
  local context_usage="${1:-0}"
  local current_load="${2:-0}"

  api_post "/fleet/${WORKER_ID}/heartbeat" "$(jq -n \
    --argjson context_usage "$context_usage" \
    --argjson current_load "$current_load" \
    '{context_usage: $context_usage, current_load: $current_load}'
  )" > /dev/null
}

# ── Context Usage Detection ──────────────────────────────────
# Estimate context usage from the Claude Code session.
# The session writes usage hints to a status file.
get_context_usage() {
  local status_file="/tmp/overmind-worker-${WORKER_NAME}-context.txt"

  if [[ -f "$status_file" ]]; then
    cat "$status_file" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

# ── Command Polling ──────────────────────────────────────────
poll_commands() {
  local result
  result=$(api_get "/fleet/${WORKER_ID}/commands")

  local count
  count=$(echo "$result" | jq -r '.count // 0')

  if [[ "$count" -gt 0 ]]; then
    echo "$result" | jq -c '.commands[]'
  fi
}

handle_command() {
  local cmd_json="$1"
  local cmd_id cmd_type payload

  cmd_id=$(echo "$cmd_json" | jq -r '.id')
  cmd_type=$(echo "$cmd_json" | jq -r '.command')
  payload=$(echo "$cmd_json" | jq -r '.payload')

  info "Received command: $cmd_type (ID: $cmd_id)"

  # ACK the command
  api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/ack" '{}' > /dev/null

  case "$cmd_type" in
    checkpoint)
      handle_checkpoint "$cmd_id"
      ;;
    stop)
      handle_stop "$cmd_id"
      ;;
    restart)
      handle_restart "$cmd_id"
      ;;
    ping)
      # Simple ping — just complete it
      api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
        '{"result":{"status":"alive"}}' > /dev/null
      info "Ping acknowledged"
      ;;
    run_task)
      info "Task execution not yet implemented via supervisor"
      api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
        '{"result":{"status":"not_implemented"}}' > /dev/null
      ;;
    update_config)
      info "Config update not yet implemented"
      api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
        '{"result":{"status":"not_implemented"}}' > /dev/null
      ;;
    *)
      warn "Unknown command type: $cmd_type"
      api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/fail" \
        "{\"error\":\"Unknown command: $cmd_type\"}" > /dev/null
      ;;
  esac
}

# ── Checkpoint Handler ───────────────────────────────────────
handle_checkpoint() {
  local cmd_id="$1"
  info "Starting checkpoint..."

  local context_usage
  context_usage=$(get_context_usage)

  # Find CONTINUE.md if it exists in the project
  local continue_file=""
  if [[ -n "$PROJECT_PATH" && -f "${PROJECT_PATH}/CONTINUE.md" ]]; then
    continue_file=$(cat "${PROJECT_PATH}/CONTINUE.md" 2>/dev/null || echo "")
  fi

  # Find SPEC_TRACKER.md if it exists
  local spec_tracker=""
  if [[ -n "$PROJECT_PATH" && -f "${PROJECT_PATH}/SPEC_TRACKER.md" ]]; then
    spec_tracker=$(cat "${PROJECT_PATH}/SPEC_TRACKER.md" 2>/dev/null || echo "")
  fi

  # Record checkpoint with Overmind
  local checkpoint_data
  checkpoint_data=$(jq -n \
    --arg reason "context_high" \
    --argjson context_usage "$context_usage" \
    --arg continue_file "$continue_file" \
    --arg spec_tracker "$spec_tracker" \
    --arg summary "Checkpoint at ${context_usage}% context usage" \
    '{reason: $reason, context_usage: $context_usage, continue_file: $continue_file, spec_tracker: $spec_tracker, summary: $summary}'
  )

  api_post "/fleet/${WORKER_ID}/checkpoints" "$checkpoint_data" > /dev/null

  # Complete the command
  api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
    "{\"result\":{\"context_usage\":$context_usage}}" > /dev/null

  info "Checkpoint complete (context: ${context_usage}%)"
}

# ── Stop Handler ─────────────────────────────────────────────
handle_stop() {
  local cmd_id="$1"
  info "Stop requested — checkpointing first..."

  # Run checkpoint before stopping
  handle_checkpoint "$cmd_id"

  # Signal the Claude Code session to stop
  # (The session monitors a sentinel file)
  touch "/tmp/overmind-worker-${WORKER_NAME}-stop"

  # Complete the command
  api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
    '{"result":{"status":"stopped"}}' > /dev/null

  info "Worker stopping..."
  SHOULD_STOP=true
}

# ── Restart Handler ──────────────────────────────────────────
handle_restart() {
  local cmd_id="$1"
  info "Restart requested — checkpointing and restarting..."

  # Checkpoint first
  handle_checkpoint "$cmd_id"

  # Signal the Claude Code session to stop
  touch "/tmp/overmind-worker-${WORKER_NAME}-stop"

  # Complete the command
  api_post "/fleet/${WORKER_ID}/commands/${cmd_id}/complete" \
    '{"result":{"status":"restarting"}}' > /dev/null

  info "Worker restarting..."
  SHOULD_RESTART=true
}

# ── Main Loop ────────────────────────────────────────────────
SHOULD_STOP=false
SHOULD_RESTART=false
HEARTBEAT_COUNTER=0

main_loop() {
  info "Starting supervisor loop (poll every ${POLL_INTERVAL}s)..."

  while true; do
    # Check for stop/restart signals
    if [[ "$SHOULD_STOP" == true ]]; then
      info "Stop signal received. Exiting."
      exit 0
    fi

    if [[ "$SHOULD_RESTART" == true ]]; then
      info "Restart signal received. Restarting worker..."
      # Clean up and re-exec
      rm -f "/tmp/overmind-worker-${WORKER_NAME}-stop"
      exec "$0" --name "$WORKER_NAME" --project "$PROJECT_PATH" --api-url "$API_URL" \
        --capabilities "$CAPABILITIES" --max-load "$MAX_LOAD" \
        $([ "$AUTO_RESTART" = true ] && echo "--auto-restart" || echo "--no-auto-restart")
    fi

    # Poll for commands
    while IFS= read -r cmd; do
      [[ -n "$cmd" ]] && handle_command "$cmd"
    done < <(poll_commands)

    # Send heartbeat every HEARTBEAT_INTERVAL seconds
    HEARTBEAT_COUNTER=$((HEARTBEAT_COUNTER + POLL_INTERVAL))
    if [[ $HEARTBEAT_COUNTER -ge $HEARTBEAT_INTERVAL ]]; then
      local ctx
      ctx=$(get_context_usage)
      send_heartbeat "$ctx" "0"
      HEARTBEAT_COUNTER=0
    fi

    sleep "$POLL_INTERVAL"
  done
}

# ── Entrypoint ───────────────────────────────────────────────
info "============================================"
info "Overmind Worker Supervisor"
info "  Name:         $WORKER_NAME"
info "  API URL:      $API_URL"
info "  Project:      ${PROJECT_PATH:-<none>}"
info "  Capabilities: $CAPABILITIES"
info "  Max Load:     $MAX_LOAD"
info "  Auto-Restart: $AUTO_RESTART"
info "  Log File:     $LOG_FILE"
info "============================================"

# Check dependencies
for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    error "Required command not found: $cmd"
    exit 1
  fi
done

# Check API is reachable
if ! curl -sf "${API_URL}/health" > /dev/null 2>&1; then
  warn "Overmind API not reachable at ${API_URL}. Will retry..."
  sleep 5
  if ! curl -sf "${API_URL}/health" > /dev/null 2>&1; then
    error "Overmind API still not reachable. Exiting."
    exit 1
  fi
fi

# Register
register_worker || exit 1

# Clean up sentinel file
rm -f "/tmp/overmind-worker-${WORKER_NAME}-stop"

# Trap signals for graceful shutdown
trap 'info "Caught signal, stopping..."; SHOULD_STOP=true' SIGTERM SIGINT

# Start the main loop
main_loop
