# Bug Log — Sovereign Stack App

## Bug #1 — 2026-03-05
- **Reported by:** Beau
- **Symptom:** Console flooded with errors: "Command get_agent_name not found", "Command get_model_config not found", "Command get_compound_stats not found" — each appearing 4+ times
- **Root Cause:** All 17 components use Tauri `invoke()` IPC to call Rust backend commands. When running in browser (without Tauri shell), every invoke call throws and logs to console. Components with polling (AgentActivityLog every 1.5s, UnifiedDashboard every 5s, ChatInterface every 30s) produce repeated errors indefinitely.
- **Fix:** Created `safeInvoke()` wrapper in `src/lib/tauri.ts` that detects Tauri environment via `__TAURI_INTERNALS__`. In browser mode, rejects immediately without console noise. All 17 files migrated. Settings persist to localStorage as fallback.
- **Skill Gap:** preflight-app Step 6 (Runtime Launch Test) should have checked browser console for errors. I launched the app and took screenshots but never inspected the console output.
- **Skill Updated:** Yes — preflight-app v1.7: Added Step 6d (Console Error Check) and Step 6e (Hybrid App Check for Tauri/Electron)
