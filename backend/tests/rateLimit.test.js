import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rateLimit } from '../src/middleware/rateLimit.js';

/** Runs the middleware and reports what it did. */
function run(limiter, user) {
  const req = { user: user ? { id: user } : undefined, ip: '1.2.3.4' };
  const res = { headers: {}, set(name, value) { this.headers[name] = value; } };

  try {
    let passed = false;
    limiter(req, res, () => {
      passed = true;
    });
    return { passed, res };
  } catch (err) {
    return { passed: false, error: err, res };
  }
}

describe('search rate limiting', () => {
  const options = { windowMs: 60_000, max: 3, message: 'Too many searches.' };

  it('allows requests up to the limit and blocks the next one', () => {
    const limiter = rateLimit(options);

    for (let i = 0; i < 3; i += 1) {
      assert.equal(run(limiter, 1).passed, true, `request ${i + 1} should pass`);
    }

    const blocked = run(limiter, 1);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.error.status, 429);
    assert.equal(blocked.error.message, 'Too many searches.');
  });

  it('tells the caller when to come back', () => {
    const limiter = rateLimit({ ...options, max: 1 });
    run(limiter, 1);

    const blocked = run(limiter, 1);
    const retryAfter = Number(blocked.res.headers['Retry-After']);

    assert.ok(retryAfter > 0 && retryAfter <= 60, `expected a sane Retry-After, got ${retryAfter}`);
  });

  it('counts each participant separately', () => {
    const limiter = rateLimit({ ...options, max: 2 });

    run(limiter, 1);
    run(limiter, 1);
    assert.equal(run(limiter, 1).passed, false, 'first user is now limited');
    assert.equal(run(limiter, 2).passed, true, 'a different user is unaffected');
  });

  it('forgets requests once the window has passed', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const limiter = rateLimit({ ...options, max: 1 });

    assert.equal(run(limiter, 1).passed, true);
    assert.equal(run(limiter, 1).passed, false);

    t.mock.timers.tick(61_000);
    assert.equal(run(limiter, 1).passed, true, 'allowed again in a new window');
  });

  it('falls back to the IP address when nobody is signed in', () => {
    const limiter = rateLimit({ ...options, max: 1 });

    assert.equal(run(limiter, null).passed, true);
    assert.equal(run(limiter, null).passed, false, 'anonymous callers are limited too');
  });
});
