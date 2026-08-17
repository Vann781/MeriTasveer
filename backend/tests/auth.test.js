import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { useDatabase } from '../src/db/database.js';
import * as queries from '../src/db/queries.js';
import { isAdminEmail } from '../src/middleware/auth.js';
import { SESSION_COOKIE, createSessionToken, readSessionToken } from '../src/utils/session.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/db/schema.sql'), 'utf8');

let db;
let server;
let baseUrl;
let user;

const as = (u) => ({ headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(u.id)}` } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  useDatabase(db);

  user = queries.upsertUser(db, {
    googleUserId: 'google-123',
    email: 'participant@example.com',
    name: 'Participant',
    profilePicture: 'https://example.com/avatar.jpg',
  });
});

describe('session tokens', () => {
  it('round-trips a user id', () => {
    assert.equal(readSessionToken(createSessionToken(42)), 42);
  });

  it('rejects tampering, junk and expiry', () => {
    const token = createSessionToken(42);
    const [payload, signature] = token.split('.');

    // Re-encode a payload claiming to be a different user, keeping the old
    // signature: this is the attack the signature exists to stop.
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: 999, expiresAt: Date.now() + 10_000 }),
    ).toString('base64url');

    assert.equal(readSessionToken(`${forgedPayload}.${signature}`), null);
    assert.equal(readSessionToken(`${payload}.${signature}x`), null);
    assert.equal(readSessionToken('not-a-token'), null);
    assert.equal(readSessionToken(''), null);
    assert.equal(readSessionToken(undefined), null);
    assert.equal(readSessionToken(createSessionToken(42, { days: -1 })), null, 'expired');
  });
});

describe('users', () => {
  it('keys on the Google ID so a changed email updates the same person', () => {
    const updated = queries.upsertUser(db, {
      googleUserId: 'google-123',
      email: 'new-address@example.com',
      name: 'Participant Renamed',
      profilePicture: null,
    });

    assert.equal(updated.id, user.id, 'same row');
    assert.equal(updated.email, 'new-address@example.com');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  });
});

describe('admin allowlist', () => {
  it('matches ADMIN_EMAILS case-insensitively', () => {
    const admins = ['organizer@example.com'];

    assert.equal(isAdminEmail('ORGANIZER@example.com', admins), true, 'case does not matter');
    assert.equal(isAdminEmail('organizer@example.com', admins), true);
    assert.equal(isAdminEmail('someone@example.com', admins), false);
    assert.equal(isAdminEmail(null, admins), false);
    assert.equal(isAdminEmail('', admins), false);
    assert.equal(isAdminEmail('organizer@example.com', []), false, 'nobody is admin by default');
  });
});

describe('protected routes', () => {
  it('turns away anonymous callers', async () => {
    for (const route of ['/api/events', '/api/events/1', '/api/searches/anything']) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 401, route);
    }
  });

  it('lets a signed-in participant through', async () => {
    const res = await fetch(`${baseUrl}/api/events`, as(user));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it('leaves the health check open', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
  });
});

describe('/api/auth/me', () => {
  it('reports who is signed in, without leaking the Google ID', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, as(user));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.email, 'participant@example.com');
    assert.equal(body.name, 'Participant');
    assert.equal(body.isAdmin, false);
    assert.ok(!('google_user_id' in body), 'internal identifiers stay internal');
  });

  it('answers 401 when signed out', async () => {
    assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
  });

  it('ignores a session whose user no longer exists', async () => {
    const ghost = createSessionToken(9999);
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${ghost}` },
    });
    assert.equal(res.status, 401);
  });
});

describe('the Google login flow', () => {
  it('refuses a callback without the state it issued', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback?code=abc&state=forged`, {
      redirect: 'manual',
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /could not be verified/);
  });

  it('refuses a callback with no code at all', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback`, { redirect: 'manual' });
    assert.equal(res.status, 400);
  });

  it('clears the cookie on logout', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', ...as(user) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), new RegExp(`${SESSION_COOKIE}=;`));
  });
});
