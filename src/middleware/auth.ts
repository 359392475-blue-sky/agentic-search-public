/**
 * API Authentication + Rate Limiting middleware.
 *
 * Authentication:
 *  - If API_TOKEN env var is set, all /api/* requests require
 *    Bearer token in Authorization header
 *  - If API_TOKEN is not set, API is open (backward compatible)
 *
 * Rate Limiting:
 *  - Sliding window per IP
 *  - Configurable via RATE_LIMIT_RPM env var (default: 30 req/min)
 *  - Returns 429 when exceeded
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Config ─────────────────────────────────────────

const API_TOKEN = process.env.API_TOKEN || '';
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM ?? '30', 10);
const RATE_WINDOW_MS = 60_000;

// ── Rate Limiter ───────────────────────────────────

interface RateEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateEntry>();

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) rateLimitStore.delete(key);
  }
}, 60_000);

function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  let entry = rateLimitStore.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(ip, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= RATE_LIMIT_RPM) {
    const oldestInWindow = entry.timestamps[0];
    const resetMs = oldestInWindow + RATE_WINDOW_MS - now;
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: RATE_LIMIT_RPM - entry.timestamps.length, resetMs: 0 };
}

// ── Middleware ──────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  status?: number;
  message?: string;
}

/**
 * Check authentication and rate limiting for API requests.
 * Returns { ok: true } if the request should proceed.
 * Returns { ok: false, status, message } if the request should be rejected.
 */
export function checkAuth(req: IncomingMessage, res: ServerResponse): AuthResult {
  // Only protect /api/* routes
  const url = req.url || '';
  if (!url.startsWith('/api/')) return { ok: true };

  // Authentication check
  if (API_TOKEN) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (token !== API_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Provide valid Bearer token in Authorization header.' }));
      return { ok: false, status: 401, message: 'Unauthorized' };
    }
  }

  // Rate limiting check
  const ip = getClientIP(req);
  const rateCheck = checkRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_RPM.toString());
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());

  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil(rateCheck.resetMs / 1000).toString());
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Rate limit exceeded',
      limit: RATE_LIMIT_RPM,
      retryAfterMs: rateCheck.resetMs,
    }));
    return { ok: false, status: 429, message: 'Rate limited' };
  }

  return { ok: true };
}

/**
 * Get auth/rate-limit configuration for startup logging.
 */
export function getAuthConfig(): { authEnabled: boolean; rateLimit: number } {
  return { authEnabled: !!API_TOKEN, rateLimit: RATE_LIMIT_RPM };
}
