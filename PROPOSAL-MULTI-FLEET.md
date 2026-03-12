# Proposal: Multi-Fleet Overmind — Distributed Architecture

## The Problem

Today, the Sovereign Stack runs on a single Mac Mini. Everything — the API, the
fleet workers, PostgreSQL, Redis, memU, LiteLLM — all on one machine. The new
Overmind on the Mac Studio needs to either:

1. Execute work locally using its own Docker/fleet infrastructure, OR
2. Delegate work to the Mac Mini (or any future machine)

Both machines should share visibility, rules, and job history. This needs to
scale to N machines later.

---

## Architecture: Hub-and-Spoke

```
                     ┌─────────────────────────┐
                     │     OVERMIND BRAIN       │
                     │     (Mac Studio)         │
                     │                          │
                     │  • Central API + UI      │
                     │  • PostgreSQL (primary)   │
                     │  • Redis (primary)        │
                     │  • LiteLLM / memU         │
                     │  • Orchestrator loop      │
                     │  • Rules engine           │
                     │  • Job planner            │
                     └──────────┬───────────────┘
                        │               │
                ┌───────┴────┐   ┌──────┴──────┐
                │ FLEET: LOCAL│   │ FLEET: MINI │     (future: FLEET: CLOUD, etc.)
                │ (Mac Studio)│   │ (Mac Mini)  │
                │             │   │             │
                │ Fleet Agent │   │ Fleet Agent │
                │ Docker pool │   │ Docker pool │
                │ Local disk  │   │ Local disk  │
                └─────────────┘   └─────────────┘
```

### Key Concept: *Fleet Agent*

Each machine runs a lightweight *Fleet Agent* — a small Express service that:

- Registers itself with the central Overmind
- Accepts task assignments via push (Overmind POSTs signed payloads)
- Reports heartbeats (load, context, health)
- Manages its own local Docker containers
- Executes commands in its local filesystem
- Reports results back to the central Overmind

The Fleet Agent is the *only new component*. Everything else reuses the existing
Overmind APIs.

---

## What Changes vs What Stays

### Stays the Same (Zero Changes)
- Orchestrator loop (already checks fleet for best worker)
- Rules engine (already global)
- Job planning (already creates tasks with capabilities)
- Context warden (already monitors by worker ID)
- Worker command queue (already per-worker)
- Frontend UI (already shows fleet status)
- All existing API endpoints

### Needs Changes (Minimal)

| Component | Change | Why |
|-----------|--------|-----|
| `overmind_fleet` table | Add `fleet_id`, `machine_name`, `region` columns | Distinguish which machine a worker belongs to |
| `fleet.ts` | Add fleet grouping + cross-fleet routing | Route tasks to the right machine |
| `findBestWorker()` | Add fleet affinity + network-aware scoring | Prefer local when possible, remote when needed |
| Docker Compose | Split into `core` (DB/Redis) + `local-fleet` | Each machine runs its own fleet containers |

### New Components

| Component | What It Does |
|-----------|-------------|
| `fleet-agent/` | Lightweight Express service (~300 lines) that runs on each machine |
| `fleet-agent/docker-manager.ts` | Spawns/manages local Docker containers for that machine |
| `fleet-agent/task-runner.ts` | Executes assigned tasks in local containers |
| `fleet-agent/heartbeat.ts` | Reports status back to the central Overmind |

---

## Fleet Agent Design

### Registration Flow

```
1. Fleet Agent starts on Mac Mini
2. Calls POST /api/overmind/fleet/register-fleet
   {
     "fleet_name": "mac-mini",
     "machine_name": "Beau-Mac-Mini",
     "endpoint": "http://192.168.1.50:3300",  ← LAN IP
     "api_key": "fleet-secret-xyz",
     "capabilities": ["docker", "node", "python", "git"],
     "max_workers": 3,
     "region": "home-lan"
   }
3. Overmind stores in new `overmind_fleets` table
4. Fleet Agent begins heartbeat loop (every 30s)
```

### Task Execution Flow

```
1. User submits job to Overmind (Mac Studio)
2. Orchestrator plans tasks → creates task queue
3. For each queued task:
   a. findBestFleet() — which machine?
      • Check required capabilities
      • Check fleet health / load
      • Prefer local fleet (Mac Studio) for low-latency
      • Delegate to remote fleet (Mac Mini) when local is full or lacks capability
   b. Send task to selected fleet's endpoint
      POST http://192.168.1.50:3300/tasks/execute
      {
        "task_id": "abc-123",
        "type": "implementation",
        "prompt": "...",
        "config": { ... }
      }
   c. Fleet Agent spawns/assigns a local Docker worker
   d. Worker executes task
   e. Fleet Agent reports result back:
      POST http://mac-studio:3100/api/overmind/tasks/abc-123/complete
      {
        "status": "completed",
        "result": { ... },
        "files_changed": [...]
      }
```

### Heartbeat Loop

```
Every 30 seconds, Fleet Agent → Overmind:

POST /api/overmind/fleet/{fleet-id}/heartbeat
{
  "workers_active": 2,
  "workers_max": 3,
  "avg_context_usage": 45,
  "disk_free_gb": 120,
  "memory_free_gb": 8,
  "docker_containers": 4,
  "capabilities": ["docker", "node", "python", "git"]
}
```

---

## Database Changes

### New Table: `overmind_fleets`

```sql
CREATE TABLE overmind_fleets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_name    TEXT NOT NULL UNIQUE,         -- "mac-studio", "mac-mini"
  machine_name  TEXT NOT NULL,                -- Human name
  endpoint      TEXT NOT NULL UNIQUE,         -- http://ip:port
  api_key       TEXT NOT NULL DEFAULT '',     -- Shared secret
  status        TEXT NOT NULL DEFAULT 'healthy',  -- healthy | unhealthy | offline
  capabilities  JSONB NOT NULL DEFAULT '[]',
  max_workers   INT NOT NULL DEFAULT 3,
  region        TEXT NOT NULL DEFAULT 'local', -- "home-lan", "cloud-us-east"
  metadata      JSONB NOT NULL DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Modified Table: `overmind_fleet` (workers)

```sql
ALTER TABLE overmind_fleet
  ADD COLUMN fleet_id UUID REFERENCES overmind_fleets(id),
  ADD COLUMN machine_name TEXT;
```

Now every worker belongs to a fleet, and every fleet belongs to a machine.

---

## Network Topology

### Option A: Direct LAN (Recommended for Now)

```
Mac Studio (192.168.1.60)          Mac Mini (192.168.1.50)
├── Overmind API :3100              ├── Fleet Agent :3300
├── PostgreSQL :5432                ├── Local Docker workers
├── Redis :6379                     └── (connects to Studio's Postgres/Redis)
├── LiteLLM :4000
├── memU :8090
└── Local Docker workers
```

- Fleet Agent on Mac Mini connects directly to Mac Studio's PostgreSQL and Redis
- Simple, fast, no extra infrastructure
- Secured by API keys + LAN isolation

### Option B: Tunnel (For Remote/Cloud Fleets Later)

```
Mac Studio                          Cloud VM / Remote Mac
├── Overmind API :3100  ←──WG──→   ├── Fleet Agent :3300
├── Tailscale/WireGuard            └── Local workers
```

- Same protocol, just over a VPN tunnel
- Fleet Agent uses the tunnel IP instead of LAN IP
- No changes to the codebase — just different endpoint URLs

---

## Routing Strategy

### `findBestFleet()` Logic

```typescript
async function findBestFleet(
  requiredCapabilities?: string[],
  preferLocal?: boolean
): Promise<Fleet | null> {
  const fleets = await listHealthyFleets();

  return fleets
    .filter(f => {
      if (!requiredCapabilities) return true;
      return requiredCapabilities.every(cap =>
        f.capabilities.includes(cap)
      );
    })
    .sort((a, b) => {
      // 1. Prefer local fleet (same machine as Overmind)
      if (preferLocal !== false) {
        const aLocal = a.region === 'local' ? 0 : 1;
        const bLocal = b.region === 'local' ? 0 : 1;
        if (aLocal !== bLocal) return aLocal - bLocal;
      }

      // 2. Prefer fleet with more capacity
      const aUtil = a.workers_active / a.max_workers;
      const bUtil = b.workers_active / b.max_workers;
      return aUtil - bUtil;

      // 3. Prefer lower avg context usage
      // 4. Prefer lower network latency (measured from heartbeat RTT)
    });
}
```

### Task Affinity Rules

Some tasks have natural affinity to specific fleets:

| Scenario | Routing Rule |
|----------|-------------|
| Task needs GPU | Route to fleet with `gpu` capability |
| Task modifies Mac Studio files | Route to `mac-studio` fleet |
| Task modifies Mac Mini files | Route to `mac-mini` fleet |
| General compute task | Route to least-loaded fleet |
| Track B code rewrite | Route to fleet that owns the codebase |
| Latency-sensitive (chat) | Route to local fleet |

---

## Security

### API Key Authentication

Every Fleet Agent has a unique API key:

```
Fleet Agent → Overmind:  Authorization: Bearer fleet-key-abc123
Overmind → Fleet Agent:  Authorization: Bearer fleet-key-abc123
```

Bidirectional — both sides verify the key on every request.

### Network Isolation

- Fleet Agents only expose port 3300 (or configurable)
- Docker workers never exposed externally
- DB access from remote fleets goes through the API, not direct Postgres

---

## Implementation Plan

### Phase 1: Fleet Registry (Backend Only) — ~2 hours
1. Create `overmind_fleets` table
2. Add `fleet_id` column to `overmind_fleet` (workers)
3. New fleet CRUD endpoints: register, list, heartbeat, remove
4. Update `findBestWorker()` to be fleet-aware

### Phase 2: Fleet Agent Service — ~3 hours
5. Create `fleet-agent/` directory with:
   - `index.ts` — Express server on port 3300
   - `registration.ts` — Register with central Overmind on startup
   - `heartbeat.ts` — Periodic health reports
   - `task-runner.ts` — Accept and execute tasks
   - `docker-manager.ts` — Spawn/manage local Docker containers
6. Config via env vars (OVERMIND_URL, FLEET_NAME, API_KEY, etc.)

### Phase 3: Orchestrator Integration — ~1 hour
7. Update orchestrator tick to route tasks via fleet selection
8. Add fleet health to dashboard
9. Cross-fleet task reassignment (if fleet goes down)

### Phase 4: UI Updates — ~1 hour
10. Fleet selector in Overmind dashboard
11. Per-fleet worker view
12. Fleet health indicators

### Phase 5: Mac Mini Deployment — ~1 hour
13. Deploy Fleet Agent on Mac Mini
14. Register with Mac Studio Overmind
15. End-to-end test: submit job → routed to Mac Mini → result back

---

## What This Enables

*Immediately:*
- Two-machine fleet (Mac Studio + Mac Mini)
- Load balancing across machines
- Machine-specific capabilities (GPU on one, large disk on another)
- Fault tolerance (one machine down → tasks route to the other)

*Later (no architecture changes):*
- Cloud fleet agents (AWS, GCP VMs)
- Mobile fleet (laptop joins temporarily)
- Specialized fleets (GPU cluster, ARM devices)
- Auto-scaling (spin up cloud fleet when local is full)

---

## Decisions (Approved by Beau — 2026-03-12)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DB access | *API-only* | Scales to cloud, no DB credentials on remote machines |
| Task dispatch | *Push* (Overmind → Fleet Agent) | Lower latency |
| Architecture | *One brain, N compute nodes* | Mac Studio is Overmind, everything else is Fleet Agent |
| Fleet Agent port | *3300* | Beau's lucky number |
| Security | *Top-of-the-line* | Full audit, mTLS-ready, zero-trust design |

---

## Security Architecture (Top Priority)

### 1. Fleet API Key — Per-Fleet, Rotating

Each Fleet Agent gets a unique 256-bit API key:

```
FLEET_API_KEY=flk_a7f3b9c1e4d2...  (64-char hex, generated by Overmind)
```

- Generated by Overmind during fleet registration
- Stored hashed (SHA-256) in `overmind_fleets.api_key_hash` — *never* stored in plaintext
- Fleet Agent stores it in local `.env` (never committed to git)
- Rotation: Overmind can issue a new key; old key valid for 5min grace period

### 2. Mutual Authentication (Both Directions)

```
Overmind → Fleet Agent:
  POST https://fleet-ip:3300/tasks/execute
  Headers:
    Authorization: Bearer flk_a7f3b9c1e4d2...
    X-Overmind-Signature: HMAC-SHA256(body, shared_secret)
    X-Request-ID: uuid
    X-Timestamp: ISO-8601 (reject if >30s drift)

Fleet Agent → Overmind:
  POST https://overmind-ip:3100/api/overmind/fleet/{id}/result
  Headers:
    Authorization: Bearer flk_a7f3b9c1e4d2...
    X-Fleet-Signature: HMAC-SHA256(body, shared_secret)
    X-Request-ID: uuid
    X-Timestamp: ISO-8601 (reject if >30s drift)
```

Both sides verify: API key + HMAC signature + timestamp freshness.

### 3. Request Signing (HMAC-SHA256)

Every request body is signed with a shared HMAC secret (separate from the API key):

```typescript
function signRequest(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

function verifyRequest(body: string, signature: string, secret: string): boolean {
  const expected = signRequest(body, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
```

Prevents: replay attacks, body tampering, man-in-the-middle.

### 4. Timestamp Validation

Reject any request with a timestamp older than 30 seconds:

```typescript
function isTimestampValid(timestamp: string, maxDriftMs = 30_000): boolean {
  const diff = Math.abs(Date.now() - new Date(timestamp).getTime());
  return diff < maxDriftMs;
}
```

Prevents: replay attacks with captured requests.

### 5. Rate Limiting Per Fleet

Each fleet has per-endpoint rate limits:

| Endpoint | Limit | Window |
|----------|-------|--------|
| Heartbeat | 4/min | Rolling |
| Task execute | 10/min | Rolling |
| Task result | 20/min | Rolling |
| Registration | 1/hour | Fixed |

Exceeding limits → 429 response + alert to Overmind dashboard.

### 6. IP Allow-List (Optional, Recommended)

```sql
ALTER TABLE overmind_fleets ADD COLUMN allowed_ips TEXT[] DEFAULT '{}';
```

If `allowed_ips` is non-empty, reject requests from other IPs. For LAN:
`["192.168.1.50"]`. For cloud: set to the VM's public IP.

### 7. TLS Ready

For LAN: HTTP is acceptable (encrypted by network isolation).
For cloud/remote: Enforce HTTPS. Fleet Agent runs with a TLS cert:

```bash
# Self-signed for LAN (upgrade to Let's Encrypt for cloud)
FLEET_TLS_CERT=/path/to/cert.pem
FLEET_TLS_KEY=/path/to/key.pem
```

### 8. Audit Log

Every cross-fleet request is logged to `overmind_fleet_audit`:

```sql
CREATE TABLE overmind_fleet_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id    UUID NOT NULL REFERENCES overmind_fleets(id),
  direction   TEXT NOT NULL,  -- 'inbound' | 'outbound'
  method      TEXT NOT NULL,  -- 'POST', 'GET', etc.
  path        TEXT NOT NULL,
  status_code INT,
  request_id  TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fleet_audit_fleet ON overmind_fleet_audit(fleet_id, created_at DESC);
CREATE INDEX idx_fleet_audit_time ON overmind_fleet_audit(created_at DESC);
```

### 9. Secret Management

| Secret | Storage | Never In |
|--------|---------|----------|
| Fleet API key | `.env` on Fleet Agent, hashed in DB | Git, logs, error messages |
| HMAC shared secret | `.env` on both sides, hashed in DB | Git, logs, API responses |
| TLS private key | File on disk, 600 permissions | Git, DB, API responses |
| DB credentials | Only on Overmind (Mac Studio) | Fleet Agents, logs, git |

### 10. Circuit Breaker for Compromised Fleets

If a fleet sends >5 failed auth requests in 60 seconds:
1. Auto-disable fleet (`status = 'suspended'`)
2. Reject all future requests from that fleet
3. Alert on Overmind dashboard
4. Require manual re-enable + key rotation

---

## Updated Implementation Plan

### Phase 1: Security Layer + Fleet Registry — ~2.5 hours
1. Create `overmind_fleets` table + `overmind_fleet_audit` table
2. Add `fleet_id` column to `overmind_fleet` (workers)
3. Implement HMAC signing + verification middleware
4. Implement timestamp validation middleware
5. Implement rate limiting per fleet
6. Fleet CRUD endpoints: register, list, heartbeat, remove, rotate-key
7. IP allow-list validation
8. Update `findBestWorker()` to be fleet-aware

### Phase 2: Fleet Agent Service — ~3 hours
9. Create `fleet-agent/` directory with:
   - `index.ts` — Express server on port 3300, TLS-ready
   - `security.ts` — HMAC signing, key management, audit logging
   - `registration.ts` — Register with central Overmind on startup
   - `heartbeat.ts` — Periodic health reports (signed)
   - `task-runner.ts` — Accept and execute tasks (verified)
   - `docker-manager.ts` — Spawn/manage local Docker containers
10. Config via env vars (OVERMIND_URL, FLEET_NAME, API_KEY, HMAC_SECRET, etc.)

### Phase 3: Orchestrator Integration — ~1.5 hours
11. Update orchestrator tick to route tasks via fleet selection
12. Push dispatcher — sends signed task payloads to fleet endpoints
13. Cross-fleet task reassignment on fleet failure
14. Fleet suspension on auth failures

### Phase 4: UI Updates — ~1 hour
15. Fleet selector in Overmind dashboard
16. Per-fleet worker view
17. Fleet health + security indicators
18. Audit log viewer

### Phase 5: Testing + Security Audit — ~1 hour
19. End-to-end: register fleet → push task → get result
20. Security audit: replay attack test, signature tamper test, rate limit test
21. Verify no secrets in logs, git, or API responses
