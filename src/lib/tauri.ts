/**
 * Safe Tauri invoke wrapper.
 *
 * Detects whether the app is running inside a Tauri shell.
 * If not, rejects immediately with a descriptive error — no
 * console spam, no network attempts. All existing try/catch
 * fallbacks in components continue to work as-is.
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

// ─── Safe invoke ────────────────────────────────────────────────────────

/**
 * Call a Tauri command if Tauri is available.
 * If not, rejects with a lightweight error (no console noise).
 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!detectTauri()) {
    throw new Error(`[tauri:browser] ${cmd} — not available outside Tauri`);
  }
  return tauriInvoke<T>(cmd, args);
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
