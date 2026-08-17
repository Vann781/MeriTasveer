import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Login sessions as signed cookies. The cookie holds the user ID and an expiry,
 * signed with SESSION_SECRET, so no session table is needed and a tampered
 * cookie is rejected outright.
 *
 * The cookie is httpOnly: JavaScript in the page cannot read it, so a script
 * injected into the frontend cannot steal a login.
 */

export const SESSION_COOKIE = 'eps_session';
const SESSION_DAYS = 30;

/** Falls back to a random secret so development works, with a warning. */
function secret() {
  if (config.sessionSecret) return config.sessionSecret;

  if (!secret.warned) {
    console.warn(
      'Warning: SESSION_SECRET is not set. Using a temporary secret — ' +
        'everyone will be logged out when the server restarts.',
    );
    secret.warned = true;
    secret.fallback = randomBytes(32).toString('hex');
  }
  return secret.fallback;
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Builds a signed token for a user. */
export function createSessionToken(userId, { days = SESSION_DAYS } = {}) {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + days * 24 * 60 * 60 * 1000 }),
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

/** Returns the user ID from a valid token, or null. Never throws. */
export function readSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);

  // Constant-time comparison so the signature cannot be guessed byte by byte.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const { userId, expiresAt } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!userId || !expiresAt || Date.now() > expiresAt) return null;
    return userId;
  } catch {
    return null;
  }
}

/** Reads one cookie from the request without pulling in a parser dependency. */
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function cookieOptions({ days = SESSION_DAYS } = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
  };
}
