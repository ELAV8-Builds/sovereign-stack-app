/**
 * Safe Tauri invoke wrapper.
 *
 * Handles TWO failure modes:
 * 1. Browser mode (no Tauri shell) — rejects immediately, no console noise
 * 2. Tauri mode but command not registered — catches "Command X not found"
 *    from the Rust backend and throws a normalized NotImplemented error
 *
 * Also provides a localStorage-backed persistence layer so
 * settings survive page reloads even without the Rust backend.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// ─── Tauri detection ────────────────────────────────────────────────────

let _isTauri: boolean | null = null;

function detectTauri(): boolean {
  if (_isTauri !== null) return _isTauri;
  try {
    // Tauri 2.x injects __TAURI_INTERNALS__ on the window object
    _isTauri = !!(window as any).__TAURI_INTERNALS__;
  } catch {
    _isTauri = false;
  }
  return _isTauri;
}

export function isTauri(): boolean {
  return detectTauri();
}

// ─── Error helpers ──────────────────────────────────────────────────────

/**
 * Check if an error is a "command not implemented" error.
 * Useful for components to show "coming soon" instead of raw errors.
 */
export function isNotImplemented(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('not found') || msg.includes('not available') || msg.includes('[tauri:');
}

/**
 * Get a user-friendly error message from a Tauri error.
 * Strips internal "Command X not found" noise.
 */
export function friendlyError(err: unknown, fallback = 'This feature is not available yet.'): string {
  if (isNotImplemented(err)) return fallback;
  const msg = String(err);
  // Strip "Error: " prefix if present
  return msg.replace(/^Error:\s*/i, '') || fallback;
}

// ─── Safe invoke ────────────────────────────────────────────────────────

/**
 * Call a Tauri command if Tauri is available.
 * If not, rejects with a lightweight error (no console noise).
 * If command is not registered in Rust backend, normalizes the error.
 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!detectTauri()) {
    throw new Error(`[tauri:browser] ${cmd} — not available outside Tauri`);
  }
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (err) {
    const msg = String(err);
    // Normalize "Command X not found" errors from Tauri
    if (msg.includes('not found')) {
      throw new Error(`[tauri:not-impl] ${cmd} — backend command not yet implemented`);
    }
    throw err;
  }
}

// ─── localStorage persistence ───────────────────────────────────────────

const STORE_PREFIX = 'sovereign_';

export function localGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function localSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — ignore
  }
}
