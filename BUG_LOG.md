# Bug Log — Sovereign Stack App

## Bug #1 — 2026-03-05
- **Reported by:** Beau
- **Symptom:** Console flooded with errors: "Command get_agent_name not found", "Command get_model_config not found", "Command get_compound_stats not found" — each appearing 4+ times
- **Root Cause:** All 17 components use Tauri `invoke()` IPC to call Rust backend commands. When running in browser (without Tauri shell), every invoke call throws and logs to console. Components with polling (AgentActivityLog every 1.5s, UnifiedDashboard every 5s, ChatInterface every 30s) produce repeated errors indefinitely.
- **Fix:** Created `safeInvoke()` wrapper in `src/lib/tauri.ts` that detects Tauri environment via `__TAURI_INTERNALS__`. In browser mode, rejects immediately without console noise. All 17 files migrated. Settings persist to localStorage as fallback.
- **Skill Gap:** preflight-app Step 6 (Runtime Launch Test) should have checked browser console for errors. I launched the app and took screenshots but never inspected the console output.
- **Skill Updated:** Yes — preflight-app v1.7: Added Step 6d (Console Error Check) and Step 6e (Hybrid App Check for Tauri/Electron)

## Bug #2 — 2026-03-05
- **Reported by:** Beau
- **Symptom:** "Connection test failed: Command test_slack_connection not found" error shown in the Slack Wizard when running inside the Tauri desktop shell.
- **Root Cause:** Bug #1's fix (safeInvoke) only handled browser mode (no `__TAURI_INTERNALS__`). In actual Tauri desktop mode, `safeInvoke` passed calls straight to the real `invoke()`, which threw because the Rust backend doesn't register `test_slack_connection`, `save_slack_config`, or most other frontend commands. The Rust backend only has ~15 commands (setup, services, system). All "settings" commands are stubs.
- **Fix:** Enhanced `safeInvoke()` in `src/lib/tauri.ts` to catch "Command not found" errors from the Tauri backend and normalize them to `[tauri:not-impl]` errors. Added `isNotImplemented()` and `friendlyError()` helpers. Updated `SlackWizard.tsx` to fall back to preview mode (mock channels) when backend commands aren't ready. Updated `BackupExport.tsx` to use `friendlyError()`.
- **Skill Gap:** Bug #1's fix was incomplete — it only addressed one of two failure modes (browser vs Tauri-with-missing-commands). The preflight-app v1.7 Step 6e (Hybrid App Check) should catch this going forward, as it now requires testing both browser-only AND desktop modes.
- **Skill Updated:** Not needed — v1.7 already covers this via Step 6e (added after Bug #1 self-analysis)

## Bug #3 — 2026-03-05
- **Reported by:** Beau
- **Symptom:** Chat returns fake/mocked data. User sends any message → gets hardcoded responses like "Got it! I'm working on that now..." regardless of input. Chat transcript shows "Sovereign Agent" instead of the custom agent name.
- **Root Cause:** `ChatInterface.tsx` called `safeInvoke('chat_with_agent')` which is not registered in the Rust backend. The catch block silently fell back to `getMockResponse()` — a keyword-matching function with hardcoded fake replies (lines 317-371). No AI was ever called.
- **Fix:** Created `src/lib/ai.ts` — an AI chat service that routes through Vite proxy → LiteLLM (OpenAI-compatible API). Added proxy config to `vite.config.ts` (`/api/llm` → `http://127.0.0.1:4000`). ChatInterface now tries: (1) LiteLLM via proxy, (2) Tauri backend, (3) mock fallback with visible "Preview Mode" warning and toast. Conversation history (last 20 messages) is sent for context.
- **Skill Gap:** The preflight-app runtime test (Step 6) should have verified the chat actually returns non-canned responses. A simple test like "what is 2+2?" would have revealed the mock.
- **Skill Updated:** Noted for future preflight improvement — Step 6 should include "send a unique test message and verify the response is contextual."

## Bug #4 — 2026-03-05
- **Reported by:** Beau
- **Symptom:** Agent name set in Settings (via AgentNaming component) is not reflected in the chat. Chat always shows "Sovereign Agent" and the welcome message says "I'm your Sovereign agent."
- **Root Cause:** `AgentNaming.tsx` correctly saves the name to `localStorage` via `localSet('agent_name', ...)`, but `ChatInterface.tsx` had "Sovereign Agent" hardcoded in two places: (1) the welcome message at line 23, (2) the message header label at line 224. It never read from localStorage.
- **Fix:** ChatInterface now reads `localGet('agent_name', 'Sovereign Agent')` and uses it in the welcome message and all message headers. The system prompt in `ai.ts` also reads the agent name so the AI responds in character.
- **Skill Gap:** Disconnected state — settings component writes, display component doesn't read. Preflight should verify that changing a setting actually affects the relevant UI.
- **Skill Updated:** Not needed — this is a general integration testing concern.

## Bug #5 — 2026-03-05
- **Reported by:** Beau ("models not connecting correctly")
- **Symptom:** HealthCheck, ModelConfiguration, CostTracker all show mock/fake data. No real connection to LiteLLM, Ollama, or other services.
- **Root Cause:** All service-facing components used `safeInvoke()` to call Rust backend commands that don't exist, then silently fell back to hardcoded mock data. No Vite proxy existed to reach LiteLLM or other local services from the browser.
- **Fix:** Added Vite proxy (`/api/llm` → `http://127.0.0.1:4000`). Updated `HealthCheck.tsx` to perform real browser-based health probes (LiteLLM via proxy, Ollama, memU, AnythingLLM via direct fetch) when Tauri backend is unavailable. Created `src/lib/ai.ts` with `checkLLMHealth()` and `getAvailableModels()` helpers.
- **Skill Gap:** Same as Bug #3 — mock data made everything look "working" during development.
- **Skill Updated:** Not needed — covered by existing preflight steps once real probes are in place.
