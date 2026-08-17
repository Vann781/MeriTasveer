import { AppError } from './errorHandler.js';

/**
 * Per-user rate limit for searching.
 *
 * The camera-only UI discourages searching for someone else, but the frontend
 * is not a security boundary — anyone can call this API directly. This is the
 * enforceable half: a single account cannot run search after search against a
 * pile of faces. Combined with search_sessions, which records who searched
 * which event and when, misuse is both slowed down and attributable.
 *
 * In-memory on purpose: one server process, and a limit that resets on restart
 * is a fair trade for having no dependency to run.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  return function limiter(req, res, next) {
    const key = req.user?.id ?? req.ip;
    const now = Date.now();

    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

    if (recent.length >= max) {
      const retryInSeconds = Math.ceil((windowMs - (now - recent[0])) / 1000);
      res.set('Retry-After', String(retryInSeconds));
      throw new AppError(message, 429);
    }

    recent.push(now);
    hits.set(key, recent);

    // Occasional sweep so idle keys do not accumulate forever.
    if (hits.size > 1000) {
      for (const [existingKey, times] of hits) {
        if (times.every((time) => now - time >= windowMs)) hits.delete(existingKey);
      }
    }

    next();
  };
}
