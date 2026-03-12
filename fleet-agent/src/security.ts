/**
 * Fleet Agent — Request Signing & Verification
 *
 * All outbound requests to Overmind are signed with HMAC-SHA256.
 * All inbound requests from Overmind are verified.
 */

import crypto from 'crypto';

/**
 * Sign a request body with HMAC-SHA256.
 */
export function signRequest(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify an HMAC signature using timing-safe comparison.
 */
export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = signRequest(body, secret);
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Create signed headers for outbound requests to Overmind.
 */
export function createSignedHeaders(
  body: string,
  apiKey: string,
  hmacSecret: string
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-Fleet-Signature': signRequest(body, hmacSecret),
    'X-Request-ID': crypto.randomUUID(),
    'X-Timestamp': new Date().toISOString(),
  };
}

/**
 * Verify an inbound request from Overmind.
 * Checks HMAC signature and timestamp freshness.
 */
export function verifyInboundRequest(
  body: string,
  headers: Record<string, string | undefined>,
  hmacSecret: string
): { valid: boolean; error?: string } {
  // Check timestamp
  const timestamp = headers['x-timestamp'];
  if (!timestamp) {
    return { valid: false, error: 'Missing X-Timestamp header' };
  }

  const ts = new Date(timestamp).getTime();
  if (isNaN(ts) || Math.abs(Date.now() - ts) > 30_000) {
    return { valid: false, error: 'Timestamp expired or invalid (max 30s drift)' };
  }

  // Check HMAC signature
  const signature = headers['x-overmind-signature'];
  if (!signature) {
    return { valid: false, error: 'Missing X-Overmind-Signature header' };
  }

  if (!verifySignature(body, signature, hmacSecret)) {
    return { valid: false, error: 'HMAC signature verification failed' };
  }

  return { valid: true };
}
