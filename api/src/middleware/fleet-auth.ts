/**
 * Fleet Authentication & Security Middleware
 *
 * Provides HMAC-SHA256 request verification, timestamp validation,
 * per-fleet rate limiting, and IP allow-list checking.
 *
 * Every cross-fleet request must pass through this middleware.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { query } from '../services/database';

// ---------------------------------------------------------------------------
// HMAC Signing & Verification
// ---------------------------------------------------------------------------

/** Sign a request body with HMAC-SHA256. */
export function signRequest(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Verify an HMAC signature using timing-safe comparison. */
export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = signRequest(body, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/** Hash a secret for storage (SHA-256). NEVER store plaintext. */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Generate a cryptographically secure fleet API key. */
export function generateFleetKey(): string {
  return 'flk_' + crypto.randomBytes(32).toString('hex');
}

/** Generate a cryptographically secure HMAC shared secret. */
export function generateHmacSecret(): string {
  return 'hms_' + crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Timestamp Validation
// ---------------------------------------------------------------------------

const MAX_TIMESTAMP_DRIFT_MS = 30_000; // 30 seconds

/** Check if a timestamp is within acceptable drift. */
export function isTimestampValid(timestamp: string, maxDriftMs = MAX_TIMESTAMP_DRIFT_MS): boolean {
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return false;
  return Math.abs(Date.now() - ts) < maxDriftMs;
}

// ---------------------------------------------------------------------------
// Rate Limiting (In-Memory, Per-Fleet)
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimits: Map<string, RateBucket> = new Map();

// Clean up stale buckets every 5 minutes
const _rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimits) {
    if (bucket.resetAt < now) rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// Prevent the interval from keeping the process alive
if (_rateLimitCleanup.unref) _rateLimitCleanup.unref();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  heartbeat: { maxRequests: 4, windowMs: 60_000 },
  task_execute: { maxRequests: 10, windowMs: 60_000 },
  task_result: { maxRequests: 20, windowMs: 60_000 },
  registration: { maxRequests: 1, windowMs: 3600_000 },
  default: { maxRequests: 30, windowMs: 60_000 },
};

function checkRateLimit(fleetId: string, action: string): { allowed: boolean; retryAfterMs?: number } {
  const config = RATE_LIMITS[action] || RATE_LIMITS.default;
  const key = `${fleetId}:${action}`;
  const now = Date.now();

  let bucket = rateLimits.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    rateLimits.set(key, bucket);
  }

  bucket.count++;
  if (bucket.count > config.maxRequests) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Auth Failure Tracking (Circuit Breaker)
// ---------------------------------------------------------------------------

const AUTH_FAILURE_THRESHOLD = 5;
const AUTH_FAILURE_WINDOW_MS = 60_000;

interface AuthFailureTracker {
  failures: number[];
}

const authFailures: Map<string, AuthFailureTracker> = new Map();

async function trackAuthFailure(fleetId: string): Promise<boolean> {
  const now = Date.now();
  let tracker = authFailures.get(fleetId);
  if (!tracker) {
    tracker = { failures: [] };
    authFailures.set(fleetId, tracker);
  }

  // Remove old failures outside window
  tracker.failures = tracker.failures.filter(t => now - t < AUTH_FAILURE_WINDOW_MS);
  tracker.failures.push(now);

  // If threshold exceeded, auto-suspend fleet
  if (tracker.failures.length >= AUTH_FAILURE_THRESHOLD) {
    console.error(`[fleet-auth] SUSPENDING fleet ${fleetId} — ${tracker.failures.length} auth failures in ${AUTH_FAILURE_WINDOW_MS}ms`);
    await query(
      "UPDATE overmind_fleets SET status = 'suspended', updated_at = NOW() WHERE id = $1",
      [fleetId]
    );
    tracker.failures = []; // Reset after suspension
    return true; // was suspended
  }
  return false;
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

export async function logFleetAudit(params: {
  fleet_id: string | null;
  direction: 'inbound' | 'outbound';
  method: string;
  path: string;
  status_code?: number;
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
  error?: string;
  latency_ms?: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO overmind_fleet_audit
        (fleet_id, direction, method, path, status_code, request_id, ip_address, user_agent, error, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.fleet_id, params.direction, params.method, params.path,
        params.status_code || null, params.request_id || null,
        params.ip_address || null, params.user_agent || null,
        params.error || null, params.latency_ms || null,
      ]
    );
  } catch (err) {
    // Audit logging should never break the request
    console.warn('[fleet-auth] Audit log failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Middleware: Admin Authentication for Fleet Management
// ---------------------------------------------------------------------------

/**
 * Express middleware to capture raw body for consistent HMAC verification.
 * Must be applied before json() parser, or as a verify callback.
 */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as any)._rawBody = buf.toString('utf8');
}

/**
 * Express middleware that verifies admin access for fleet management endpoints.
 * Uses the OVERMIND_ADMIN_TOKEN env var (Bearer token).
 * Admin routes: register, list, delete, rotate, unsuspend, etc.
 */
export function verifyAdminRequest() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const adminToken = process.env.OVERMIND_ADMIN_TOKEN;

    // If no admin token is configured, allow (development mode — log warning once)
    if (!adminToken) {
      if (!(global as any).__fleetAdminWarned) {
        console.warn('[fleet-auth] WARNING: OVERMIND_ADMIN_TOKEN not set — admin endpoints are UNPROTECTED. Set this env var in production!');
        (global as any).__fleetAdminWarned = true;
      }
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }

    const token = authHeader.slice(7);
    // Timing-safe comparison for admin token
    const expected = Buffer.from(adminToken, 'utf8');
    const provided = Buffer.from(token, 'utf8');

    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      res.status(403).json({ error: 'Invalid admin token' });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Middleware: Verify Inbound Fleet Requests
// ---------------------------------------------------------------------------

/**
 * Express middleware that verifies inbound requests from Fleet Agents.
 * Checks: API key -> HMAC signature -> timestamp -> rate limit -> IP allow-list.
 *
 * Extracts fleet ID from the verified API key and attaches to req.fleetId.
 */
export function verifyFleetRequest(action: string = 'default') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

    try {
      // 1. Extract API key from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        await logFleetAudit({
          fleet_id: null, direction: 'inbound', method: req.method, path: req.path,
          status_code: 401, request_id: requestId, ip_address: ipAddress,
          error: 'Missing Authorization header',
        });
        res.status(401).json({ error: 'Missing Authorization header' });
        return;
      }

      const apiKey = authHeader.slice(7);

      // 2. Look up fleet by API key hash (also check old key during rotation grace period)
      const keyHash = hashSecret(apiKey);
      let { rows } = await query(
        'SELECT * FROM overmind_fleets WHERE api_key_hash = $1',
        [keyHash]
      );

      // If primary key doesn't match, check for rotation grace period (old key in metadata)
      if (rows.length === 0) {
        const { rows: graceRows } = await query(
          `SELECT * FROM overmind_fleets WHERE metadata->>'_old_key_hash' = $1
           AND metadata->>'_key_rotated_at' IS NOT NULL`,
          [keyHash]
        );
        // Verify the old key is within the 5-minute grace period
        if (graceRows.length > 0) {
          const rotatedAt = new Date(graceRows[0].metadata?._key_rotated_at).getTime();
          if (!isNaN(rotatedAt) && Date.now() - rotatedAt < 5 * 60 * 1000) {
            rows = graceRows;
          }
        }
      }

      if (rows.length === 0) {
        await logFleetAudit({
          fleet_id: null, direction: 'inbound', method: req.method, path: req.path,
          status_code: 401, request_id: requestId, ip_address: ipAddress,
          error: 'Invalid API key',
        });
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      const fleetRow = rows[0];

      // 3. Check if fleet is suspended
      if (fleetRow.status === 'suspended') {
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 403, request_id: requestId, ip_address: ipAddress,
          error: 'Fleet is suspended',
        });
        res.status(403).json({ error: 'Fleet is suspended. Contact admin to re-enable.' });
        return;
      }

      // 4. IP allow-list check
      const allowedIps: string[] = fleetRow.allowed_ips || [];
      if (allowedIps.length > 0 && !allowedIps.includes(ipAddress)) {
        await trackAuthFailure(fleetRow.id);
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 403, request_id: requestId, ip_address: ipAddress,
          error: `IP not in allow-list: ${ipAddress}`,
        });
        res.status(403).json({ error: 'IP not in allow-list' });
        return;
      }

      // 5. Timestamp validation
      const timestamp = req.headers['x-timestamp'] as string;
      if (!timestamp || !isTimestampValid(timestamp)) {
        await trackAuthFailure(fleetRow.id);
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 401, request_id: requestId, ip_address: ipAddress,
          error: 'Invalid or expired timestamp',
        });
        res.status(401).json({ error: 'Invalid or expired timestamp. Max drift: 30s.' });
        return;
      }

      // 6. HMAC signature verification (MANDATORY — never skip)
      const signature = req.headers['x-fleet-signature'] as string;
      if (!signature) {
        await trackAuthFailure(fleetRow.id);
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 401, request_id: requestId, ip_address: ipAddress,
          error: 'Missing HMAC signature header',
        });
        res.status(401).json({ error: 'Missing X-Fleet-Signature header' });
        return;
      }

      // Per-fleet HMAC secret lookup: try fleet-specific env var, then shared fallback
      // Format: FLEET_HMAC_SECRET_<FLEET_NAME> or FLEET_HMAC_SECRET
      const fleetEnvKey = `FLEET_HMAC_SECRET_${fleetRow.fleet_name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      const hmacSecret = process.env[fleetEnvKey] || process.env.FLEET_HMAC_SECRET;
      if (!hmacSecret) {
        console.error(`[fleet-auth] No HMAC secret configured for fleet ${fleetRow.fleet_name} (checked ${fleetEnvKey} and FLEET_HMAC_SECRET)`);
        res.status(500).json({ error: 'Server HMAC configuration error' });
        return;
      }

      // Capture raw body before JSON parsing for consistent HMAC verification
      const bodyStr = (req as any)._rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
      if (!verifySignature(bodyStr, signature, hmacSecret)) {
        const suspended = await trackAuthFailure(fleetRow.id);
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 401, request_id: requestId, ip_address: ipAddress,
          error: suspended ? 'HMAC verification failed — fleet SUSPENDED' : 'HMAC verification failed',
        });
        res.status(401).json({ error: 'HMAC signature verification failed' });
        return;
      }

      // 7. Rate limiting
      const rateCheck = checkRateLimit(fleetRow.id, action);
      if (!rateCheck.allowed) {
        await logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: 429, request_id: requestId, ip_address: ipAddress,
          error: `Rate limited: retry after ${rateCheck.retryAfterMs}ms`,
        });
        res.status(429).json({
          error: 'Rate limit exceeded',
          retry_after_ms: rateCheck.retryAfterMs,
        });
        return;
      }

      // All checks passed — attach fleet info to request
      (req as any).fleetId = fleetRow.id;
      (req as any).fleetName = fleetRow.fleet_name;
      (req as any).requestId = requestId;

      // Log successful auth
      res.on('finish', () => {
        logFleetAudit({
          fleet_id: fleetRow.id, direction: 'inbound', method: req.method, path: req.path,
          status_code: res.statusCode, request_id: requestId, ip_address: ipAddress,
          latency_ms: Date.now() - startTime,
        }).catch(() => {}); // fire and forget
      });

      next();
    } catch (err) {
      console.error('[fleet-auth] Middleware error:', err);
      res.status(500).json({ error: 'Internal authentication error' });
    }
  };
}
