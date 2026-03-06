# Fleet Mode — Layer 1 Spec

**Version**: 1.0
**Status**: Approved for development
**Date**: 2026-03-06

---

## Overview

Fleet Mode turns the Sovereign Stack from a single-instance tool into a multi-agent command center. One Overlord manages a fleet of specialized worker bots — some local, some in the cloud — all accessible from a unified chat interface with smart auto-routing.

**Layer 1 scope**: Fleet dashboard UI, bot registration, chat bot selector, auto-routing foundation. Single-user, local fleet management. Cloud workers and invite links come in Layer 2.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                 OVERLORD                     │
│  (Your Machine — Full Sovereign Stack)      │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Fleet Hub │  │ Smart    │  │ Chat UI   │ │
│  │ API       │  │ Router   │  │ + Selector│ │
│  └──────────┘  └──────────┘  └───────────┘ │
│       │              │                       │
│  ┌────┴──────────────┴──────────────────┐   │
│  │         Bot Registry (PostgreSQL)     │   │
│  └───────────────────────────────────────┘   │
│       │              │              │        │
│  ┌────┴────┐   ┌────┴────┐   ┌────┴────┐  │
│  │ Bot 1   │   │ Bot 2   │   │ Bot 3   │  │
│  │ General │   │ Market. │   │ Dev     │  │
│  │ (local) │   │ (local) │   │ (local) │  │
│  └─────────┘   └─────────┘   └─────────┘  │
└─────────────────────────────────────────────┘
```

Layer 1 starts with local-only bots (profiles within the same instance). Layer 2 adds remote workers on Railway/Fly.io.

---

## Data Model

### Bot Registry Table

```sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,                    -- "Marketing Maven"
  slug TEXT NOT NULL UNIQUE,             -- "marketing-maven"
  specialty TEXT NOT NULL,               -- "marketing"
  description TEXT NOT NULL DEFAULT '',  -- "Specializes in copy, campaigns, social media"
  status TEXT NOT NULL DEFAULT 'idle',   -- idle | busy | offline | error
  current_task TEXT,                     -- what it's working on right now

  -- Profile: controls which skills are loaded
  profile JSONB NOT NULL DEFAULT '{}',
  -- { skills: ["creative-engine", "iterate"], model_tier: "medium", personality: "..." }

  -- Connection info (Layer 2: remote bots)
  endpoint_url TEXT,                     -- null = local, URL = remote
  auth_token TEXT,                       -- for remote bots

  -- Stats
  tasks_completed INT NOT NULL DEFAULT 0,
  total_messages INT NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Flags
  is_overlord BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true
);
```

### Bot Skill Assignments Table

```sql
CREATE TABLE bot_skills (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,  -- higher = more relevant to this bot
  PRIMARY KEY (bot_id, skill_name)
);
```

### Routing Log Table (for analytics)

```sql
CREATE TABLE routing_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_preview TEXT NOT NULL,         -- first 100 chars
  classified_intent TEXT NOT NULL,       -- "marketing", "dev", "research", "general"
  selected_bot_id TEXT REFERENCES bots(id),
  routing_mode TEXT NOT NULL,            -- "auto" | "manual"
  response_time_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## API Endpoints

### Fleet Hub API (`/api/fleet`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fleet/bots` | List all bots with status |
| POST | `/api/fleet/bots` | Register a new bot |
| GET | `/api/fleet/bots/:id` | Get bot details + stats |
| PATCH | `/api/fleet/bots/:id` | Update bot (name, profile, skills) |
| DELETE | `/api/fleet/bots/:id` | Remove a bot |
| POST | `/api/fleet/bots/:id/activate` | Bring bot online |
| POST | `/api/fleet/bots/:id/deactivate` | Take bot offline |
| GET | `/api/fleet/stats` | Fleet-wide stats (total tasks, uptime, etc.) |

### Smart Router API (`/api/fleet/route`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/fleet/route` | Classify a message and pick best bot |

**Request:**
```json
{
  "message": "Write 3 Instagram captions for our new product launch",
  "preferred_bot": null  // null = auto, or bot slug for manual
}
```

**Response:**
```json
{
  "selected_bot": {
    "id": "abc-123",
    "name": "Marketing Maven",
    "slug": "marketing-maven",
    "specialty": "marketing",
    "status": "idle"
  },
  "classified_intent": "marketing",
  "confidence": 0.92,
  "reasoning": "Request involves social media copywriting — matches Marketing Maven's specialty"
}
```

**Routing Logic:**
1. If `preferred_bot` is set → use that bot (manual mode)
2. Classify intent using a lightweight LLM call (Haiku tier — fast + cheap)
3. Find bots whose specialty matches the intent
4. Among matches, prefer idle bots over busy ones
5. If no specialist matches → fall back to any idle bot
6. If all bots busy → queue to the bot with shortest queue

---

## Frontend Components

### 1. Fleet Dashboard (`/fleet` tab in App.tsx)

The Dashboard tab gets upgraded to show the fleet. If no fleet bots are registered, it shows the current service dashboard. Once bots exist, it shows:

**Bot Cards Grid:**
```
┌──────────────────────┐  ┌──────────────────────┐
│ 🟢 Marketing Maven   │  │ 🟡 Dev Bot           │
│ marketing specialist │  │ development          │
│                      │  │                      │
│ Skills: 6 loaded     │  │ Skills: 4 loaded     │
│ Tasks: 142 completed │  │ Tasks: 89 completed  │
│ Status: Idle         │  │ Status: Working on   │
│                      │  │ "API endpoint for..."│
│ [Chat] [Configure]   │  │ [Chat] [Configure]   │
└──────────────────────┘  └──────────────────────┘
```

Each card shows:
- Bot name + colored status dot (green=idle, yellow=busy, red=error, gray=offline)
- Specialty label
- Number of loaded skills
- Total tasks completed
- Current task (if busy)
- "Chat" button → switches to Chat tab with this bot selected
- "Configure" button → opens bot settings modal

**Fleet Stats Bar** (above the cards):
- Total bots / active bots
- Tasks completed today
- Average response time
- Fleet uptime percentage

### 2. Chat Bot Selector (in ChatInterface)

At the top of the chat area, between the channel status bar and the messages:

```
┌─────────────────────────────────────────────────┐
│ Talking to: [🔄 Auto] ▾  │  🟢 Marketing Maven  │
│                           │  🟢 Dev Bot           │
│                           │  🟡 Research Bot       │
│                           │  ─────────────────    │
│                           │  🔄 Auto (recommended)│
└─────────────────────────────────────────────────┘
```

- Dropdown showing all bots with status indicators
- "Auto" option at the bottom (default, recommended)
- When Auto is selected, after routing, show which bot was chosen:
  `"Routed to Marketing Maven — marketing request detected"`
- When a specific bot is selected, all messages go directly to it

### 3. Bot Configuration Modal

Opened from the fleet dashboard card or from Settings:

- Bot name (editable)
- Specialty dropdown: Marketing, Development, Research, Personal, Support, Creative, General
- Personality prompt (textarea) — defines how this bot responds
- Skill assignments — checkboxes for available skills, drag to reorder priority
- Model tier preference — which LiteLLM tier this bot defaults to
- Active/Inactive toggle

### 4. Create Bot Flow

Button on Fleet Dashboard: "+ New Bot"

Step 1: Choose a template or start blank
- Templates: Marketing, Development, Research, Personal, Support
- Each template pre-loads relevant skills and personality

Step 2: Customize name, description, personality

Step 3: Assign skills (pre-selected from template, editable)

Step 4: Bot appears in fleet, status "idle", ready to receive messages

---

## Smart Router — Intent Classification

The router uses a single Haiku-tier LLM call to classify incoming messages:

**System prompt:**
```
You classify user messages into intent categories. Respond with ONLY a JSON object.

Categories:
- marketing: copywriting, campaigns, social media, branding, SEO, ads
- development: code, bugs, features, APIs, databases, deployment
- research: analysis, competitors, market data, reports, summaries
- creative: design, visuals, UX, storytelling, motion graphics
- support: troubleshooting, how-to, documentation, onboarding
- personal: reminders, calendar, emails, personal tasks
- general: anything that doesn't fit the above

Available bots and their specialties:
{bot_list}

Respond: {"intent": "category", "confidence": 0.0-1.0}
```

**Cost per classification**: ~0.001¢ (Haiku, ~50 tokens in + ~20 tokens out)

---

## Implementation Plan

### Phase A: Database + API (Docker repo)

1. Create `api/src/routes/fleet.ts` with all endpoints
2. Auto-migrate bot tables on first request (same pattern as conversations)
3. Smart router endpoint with LLM classification
4. Routing log for analytics

### Phase B: Frontend Components (App repo)

1. Create `src/lib/fleet.ts` — API client
2. Create `src/components/FleetDashboard.tsx` — bot cards grid
3. Create `src/components/BotCard.tsx` — individual bot card
4. Create `src/components/BotConfigModal.tsx` — create/edit bot
5. Create `src/components/BotSelector.tsx` — chat dropdown selector
6. Update `ChatInterface.tsx` — integrate BotSelector, route through fleet API
7. Update `App.tsx` — replace Dashboard tab content when fleet bots exist

### Phase C: Default Bots + Polish

1. On first run, auto-create the Overlord bot (represents the local instance)
2. Seed 2-3 template bots (Marketing, Dev, Research) as suggestions
3. Bot status updates via WebSocket (real-time idle/busy indicators)
4. Fleet stats aggregation

---

## What Layer 1 Does NOT Include

- Remote/cloud workers (Layer 2)
- Invite links and multi-user (Layer 2)
- Permission tiers / Overlord enforcement (Layer 4)
- File brokering between bots (Layer 4)
- Parallel code work on same codebase (deferred — not worth the complexity)
- Cross-bot conversation handoff (Layer 3)

---

## Success Criteria

Layer 1 is done when:
1. Fleet dashboard shows bot cards with real-time status
2. User can create/edit/delete bots with specialty profiles
3. Chat has a bot selector dropdown (Auto + manual)
4. Auto mode classifies intent and routes to the right bot
5. Routing decision is visible to the user ("Routed to X")
6. Each bot loads only its assigned skills for context efficiency
7. All actions have loading states, success/error feedback (Rule 6)
8. Build passes on both repos (Rule 10)
