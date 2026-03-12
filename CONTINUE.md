# CONTINUE — Multi-Fleet Overmind Build

**Created:** 2026-03-12T16:35:00Z
**Project:** Sovereign Stack App (`/workspace/group/sovereign-stack-app`)
**Branch:** `v3-chat-first`
**Status:** Plan approved by Beau, ready to build
**Mode:** SUPERVISED — ask Beau before deviating

---

## WHAT WAS COMPLETED (All Previous Sessions)

### Sessions 1-6: Core Sovereign Stack
- Full Express API backend (`api/`) with Overmind routes on port 3100
- Overmind: fleet management (5-worker hard limit, circuit breaker, smart routing)
- Overmind: job orchestration, context warden, rules engine, worker commands
- Frontend: 6 tabs (Chat, Overmind, Canvas, Dashboard, Skills, Settings)
- Overmind: 5 sub-tabs (Fleet, Jobs, Rules, Deploys, System)
- Rules CRUD, presets, seed defaults, decision banner in chat
- All committed + pushed to `v3-chat-first`

### Session 7: Self-Evolving System (commit bc373e7)
- Ghost code cleanup (4 dead files deleted, 2 unused deps removed)
- Rule versioning: per-category auto-snapshots, rollback, diff comparison
- Two-Track change system (Track A: config, Track B: code evolution)
- Change classifier (keyword-based, returns track + confidence + risk)
- Code writer (safe file write with git backup + auto-revert)
- Builder (tsc + vite build pipeline)
- Deployer (rate-limited self-evolution with health checks + auto-rollback)
- Context DNA (compressed worker state for transfer on recycle)
- RuleHistory, DeployHistory, HealthFeed UI components
- 3 new DB tables, 7 new API endpoints
- CURSOR-HANDOFF.md for Cursor IDE knowledge transfer
- All 3 builds pass clean, committed + pushed

### Session 8 (Current): Multi-Fleet Proposal
- Explored full fleet architecture (fleet.ts, types.ts, orchestrator.ts, etc.)
- Wrote PROPOSAL-MULTI-FLEET.md — Hub-and-Spoke distributed architecture
- Beau approved all 5 decisions (see below)

---

## BEAU'S DECISIONS (Locked In)

| # | Decision | Choice |
|---|----------|--------|
| 1 | DB access from remote fleets | API-only (no direct PostgreSQL) |
| 2 | Task dispatch model | Push (Overmind → Fleet Agent) |
| 3 | Architecture | One brain (Mac Studio), N compute nodes |
| 4 | Fleet Agent port | 3300 (Beau's lucky number) |
| 5 | Security priority | Top-of-the-line (HMAC, audit logs, rate limiting, IP allow-list) |

---

## WHAT TO BUILD NOW — 5 Phases

### Phase 1: Security Layer + Fleet Registry Backend (~2.5 hours)

**DB Migrations (add to `infra/config/overmind-init.sql`):**

```sql
-- New table: fleet registry (machines)
CREATE TABLE IF NOT EXISTS overmind_fleets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_name    TEXT NOT NULL UNIQUE,
  machine_name  TEXT NOT NULL,
  endpoint      TEXT NOT NULL UNIQUE,
  api_key_hash  TEXT NOT NULL DEFAULT '',
  hmac_secret_hash TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'healthy',
  capabilities  JSONB NOT NULL DEFAULT '[]',
  max_workers   INT NOT NULL DEFAULT 3,
  region        TEXT NOT NULL DEFAULT 'local',
  allowed_ips   TEXT[] DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- New table: fleet audit log
CREATE TABLE IF NOT EXISTS overmind_fleet_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id    UUID NOT NULL REFERENCES overmind_fleets(id),
  direction   TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status_code INT,
  request_id  TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_fleet ON overmind_fleet_audit(fleet_id, created_at DESC);

-- Add fleet_id to existing workers table
ALTER TABLE overmind_fleet ADD COLUMN IF NOT EXISTS fleet_id UUID REFERENCES overmind_fleets(id);
```

**New Files:**
1. `api/src/middleware/fleet-auth.ts` — HMAC verification, timestamp validation, rate limiting, IP allow-list
2. `api/src/services/overmind/fleets.ts` — Fleet registry CRUD (register, list, get, heartbeat, remove, rotate-key, suspend)
3. `api/src/routes/overmind/fleets.ts` — Fleet API endpoints

**Modified Files:**
4. `api/src/services/overmind/fleet.ts` — Update `findBestWorker()` to be fleet-aware
5. `api/src/routes/overmind/index.ts` — Mount fleets router
6. `infra/config/overmind-init.sql` — Add tables above

### Phase 2: Fleet Agent Service (~3 hours)

Create `fleet-agent/` as a separate package in the repo root:

```
fleet-agent/
├── package.json
├── tsconfig.json
├── .env.example
├── Dockerfile
└── src/
    ├── index.ts              — Express server on port 3300, TLS-ready
    ├── config.ts             — Env var validation + defaults
    ├── security.ts           — HMAC signing, request verification, key management
    ├── registration.ts       — Register with central Overmind on startup
    ├── heartbeat.ts          — Periodic health reports (every 30s, signed)
    ├── task-runner.ts        — Accept signed task payloads, execute in Docker
    └── docker-manager.ts     — Spawn/manage/kill local Docker containers
```

**Key behaviors:**
- On startup: validate config → register with Overmind → start heartbeat loop
- On task push: verify HMAC + timestamp → execute in Docker → report result back (signed)
- On shutdown: deregister from Overmind gracefully
- All requests signed with HMAC-SHA256
- TLS-ready (optional cert/key via env vars)

### Phase 3: Orchestrator Integration (~1.5 hours)

**New Files:**
7. `api/src/services/overmind/fleet-dispatcher.ts` — Push signed task payloads to fleet endpoints

**Modified Files:**
8. `api/src/services/overmind/orchestrator.ts` — Add fleet selection step in tick loop
9. `api/src/services/overmind/fleet.ts` — Add `findBestFleet()` function

**Logic:**
- Orchestrator tick: queued task → `findBestFleet()` → `dispatchToFleet()` → signed POST to fleet endpoint
- Cross-fleet reassignment: if fleet goes offline, reassign queued tasks to healthy fleets
- Circuit breaker: >5 auth failures in 60s → auto-suspend fleet

### Phase 4: UI Updates (~1 hour)

**New Files:**
10. `src/components/Overmind/FleetView.tsx` — Fleet overview with per-machine cards (status, workers, load, heartbeat, capabilities)

**Modified Files:**
11. `src/components/Overmind/index.tsx` — Add Fleets sub-tab (Fleet → Fleets, Workers)
12. `src/lib/overmind.ts` — Add fleet API client functions (listFleets, getFleet, removeFleet)

### Phase 5: Build Verification + Security Audit (~1 hour)

13. Run full build chain: frontend tsc + API tsc + vite build
14. Security audit checklist:
    - No secrets in logs, git, or API responses
    - API keys stored hashed only
    - HMAC signatures verified on every cross-fleet request
    - Timestamps reject >30s drift
    - Rate limits enforced per fleet
    - Audit log captures all cross-fleet traffic
15. Commit + push to `v3-chat-first`

---

## KEY FILES TO READ BEFORE BUILDING

| File | Why |
|------|-----|
| `api/src/services/overmind/fleet.ts` | Current fleet registry — extending with fleet-awareness |
| `api/src/services/overmind/types.ts` | All Overmind type definitions |
| `api/src/services/overmind/orchestrator.ts` | Tick loop — adding fleet dispatch |
| `api/src/services/overmind/agent-contract.ts` | Task dispatch pattern (model for fleet dispatch) |
| `api/src/services/overmind/commands.ts` | Worker command queue — communication pattern |
| `api/src/services/overmind/db.ts` | DB patterns — parameterized queries, row mappers |
| `api/src/routes/overmind/fleet.ts` | Existing fleet routes — adding fleet-level endpoints |
| `api/src/routes/overmind/index.ts` | Router mount point |
| `infra/config/overmind-init.sql` | DB schema — add new tables |
| `infra/docker-compose.yml` | Infrastructure services reference |
| `PROPOSAL-MULTI-FLEET.md` | Full proposal with security architecture |

---

## KEY PATTERNS TO FOLLOW

- **DB access**: All via `query()` from `api/src/services/database.ts` — parameterized queries only
- **Row mappers**: Each entity has a `rowToX()` function
- **Route ordering**: Specific paths before `:id` params
- **Error handling**: Try/catch on all async, proper HTTP status codes
- **Safety limits**: Hard caps (MAX_FLEET_WORKERS=5), circuit breakers, rate limits
- **API client pattern**: Frontend uses `apiGet()` / `apiPost()` from `src/lib/overmind.ts`
- **Security**: NEVER store plaintext secrets. Hash with SHA-256. HMAC-sign all cross-fleet requests.

---

## BUILD COMMANDS

```bash
# TypeScript check (frontend)
cd /workspace/group/sovereign-stack-app && npx tsc --noEmit

# TypeScript check (API)
cd /workspace/group/sovereign-stack-app/api && npx tsc --noEmit

# Vite build
cd /workspace/group/sovereign-stack-app && npx vite build

# Full validation
cd /workspace/group/sovereign-stack-app && npx tsc --noEmit && npx vite build && cd api && npx tsc --noEmit
```

---

## GIT STATE

- Branch: `v3-chat-first`
- Last commit: `bc373e7` (self-evolving system — 28 files changed, 1686+, 2105-)
- Remote: pushed + clean
- Repo: ELAV8-Builds/sovereign-stack-app

---

## FULL PROPOSALS

- `PROPOSAL-CONVERSATIONAL-RULES.md` — Track A config + Track B self-evolution (built in session 7)
- `PROPOSAL-MULTI-FLEET.md` — Hub-and-Spoke distributed fleet architecture (this session)
