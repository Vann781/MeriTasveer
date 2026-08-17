import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { useDatabase } from '../src/db/database.js';
import * as queries from '../src/db/queries.js';
import { SESSION_COOKIE, createSessionToken } from '../src/utils/session.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/db/schema.sql'), 'utf8');

const PIXELS = Buffer.from('pretend-jpeg-bytes');
const DRIVE_FILE_ID = 'drive-file-id-that-must-never-leak';

/** Fake Drive: records what was asked for, returns fixed bytes. */
const drive = {
  requested: [],
  async downloadFile(fileId) {
    this.requested.push(fileId);
    return Readable.from([PIXELS]);
  },
  async downloadFileToBuffer(fileId) {
    this.requested.push(fileId);
    return PIXELS;
  },
};

let db;
let server;
let baseUrl;
let me;
let someoneElse;

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

/** Requests as a signed-in participant. */
const as = (user) => ({
  headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(user.id)}` },
});

before(async () => {
  server = createApp({ drive }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

/** An event with photos, and a search that found only some of them. */
function seed() {
  const event = queries.upsertEvent(db, { driveFolderId: 'folder-aaaaaaaaaa', name: 'Fun Activity' });
  queries.setEventStatus(db, event.id, 'ready', { indexedAt: inMinutes(-60) });

  const photos = ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg'].map((fileName, index) =>
    queries.insertPhoto(db, {
      eventId: event.id,
      driveFileId: index === 0 ? DRIVE_FILE_ID : `drive-other-${index}`,
      fileName,
      mimeType: 'image/jpeg',
    }),
  );

  const other = queries.upsertEvent(db, { driveFolderId: 'folder-bbbbbbbbbb', name: 'Other Event' });
  queries.setEventStatus(db, other.id, 'ready');
  const otherPhoto = queries.insertPhoto(db, {
    eventId: other.id,
    driveFileId: 'drive-other-event',
    fileName: 'SECRET.jpg',
    mimeType: 'image/jpeg',
  });

  // The search found photos 1 and 2, but not 3.
  const session = queries.createSearchSession(db, {
    token: 'valid-token',
    eventId: event.id,
    userId: me.id,
    expiresAt: inMinutes(60),
    photoIds: [photos[0].id, photos[1].id],
  });

  return { event, photos, otherPhoto, session };
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  useDatabase(db);
  drive.requested = [];

  me = queries.upsertUser(db, {
    googleUserId: 'google-me',
    email: 'me@example.com',
    name: 'Me',
    profilePicture: null,
  });
  someoneElse = queries.upsertUser(db, {
    googleUserId: 'google-them',
    email: 'them@example.com',
    name: 'Them',
    profilePicture: null,
  });
});

describe('viewing a matched photo', () => {
  it('serves the image bytes through the backend', async () => {
    const { photos } = seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token/photos/${photos[0].id}`, as(me));

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), PIXELS.toString());
    assert.deepEqual(drive.requested, [DRIVE_FILE_ID], 'fetched from Drive server-side');
  });

  it('never reveals the Drive file ID to the caller', async () => {
    const { photos } = seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token/photos/${photos[0].id}`, as(me));

    const headers = JSON.stringify([...res.headers]);
    const body = Buffer.from(await res.arrayBuffer()).toString();

    assert.ok(!headers.includes(DRIVE_FILE_ID), 'not in headers');
    assert.ok(!body.includes(DRIVE_FILE_ID), 'not in body');
    assert.ok(!headers.includes('drive.google'), 'no Drive URL');
  });

  it('offers a download with a filename', async () => {
    const { photos } = seed();
    const res = await fetch(
      `${baseUrl}/api/searches/valid-token/photos/${photos[0].id}/download`,
      as(me),
    );

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="IMG_1.jpg"/);
  });

  it('lists the photos a search found', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token`, as(me));
    const body = await res.json();

    assert.equal(body.event.name, 'Fun Activity');
    assert.deepEqual(
      body.photos.map((p) => p.name),
      ['IMG_1.jpg', 'IMG_2.jpg'],
      'only the matched photos',
    );
    assert.ok(!JSON.stringify(body).includes('drive-'), 'no Drive IDs');
  });
});

describe('photo access control', () => {
  it('refuses a photo from the same event that the search did not return', async () => {
    const { photos } = seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token/photos/${photos[2].id}`, as(me));

    assert.equal(res.status, 404);
    assert.deepEqual(drive.requested, [], 'Drive is never contacted');
  });

  it('refuses a photo belonging to another event', async () => {
    const { otherPhoto } = seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token/photos/${otherPhoto.id}`, as(me));

    assert.equal(res.status, 404);
    assert.deepEqual(drive.requested, []);
  });

  it('refuses an unknown token', async () => {
    const { photos } = seed();
    const res = await fetch(`${baseUrl}/api/searches/not-a-real-token/photos/${photos[0].id}`, as(me));

    assert.equal(res.status, 404);
    assert.deepEqual(drive.requested, []);
  });

  it('refuses an expired search', async () => {
    const { event, photos } = seed();
    queries.createSearchSession(db, {
      token: 'expired-token',
      eventId: event.id,
      expiresAt: inMinutes(-1),
      photoIds: [photos[0].id],
    });

    const res = await fetch(`${baseUrl}/api/searches/expired-token/photos/${photos[0].id}`, as(me));

    assert.equal(res.status, 404);
    assert.match((await res.json()).error.message, /expired/);
    assert.deepEqual(drive.requested, []);
  });

  it('does not let one participant reach another participant results', async () => {
    const { event, photos } = seed();
    // A second participant searches the same event and matches only photo 3.
    queries.createSearchSession(db, {
      token: 'other-participant',
      eventId: event.id,
      userId: someoneElse.id,
      expiresAt: inMinutes(60),
      photoIds: [photos[2].id],
    });

    const mineOnTheirPhoto = await fetch(
      `${baseUrl}/api/searches/valid-token/photos/${photos[2].id}`,
      as(me),
    );
    // Even holding their token, it is not my search.
    const stolenToken = await fetch(
      `${baseUrl}/api/searches/other-participant/photos/${photos[2].id}`,
      as(me),
    );
    const theirOwn = await fetch(
      `${baseUrl}/api/searches/other-participant/photos/${photos[2].id}`,
      as(someoneElse),
    );

    assert.equal(mineOnTheirPhoto.status, 404, 'a photo my search did not find');
    assert.equal(stolenToken.status, 404, 'someone else token is useless to me');
    assert.equal(theirOwn.status, 200, 'but works for its owner');
  });

  it('turns away anyone who is not signed in', async () => {
    const { photos } = seed();

    const anonymous = await fetch(`${baseUrl}/api/searches/valid-token/photos/${photos[0].id}`);
    assert.equal(anonymous.status, 401);
    assert.match((await anonymous.json()).error.message, /sign in/i);

    const forged = await fetch(`${baseUrl}/api/searches/valid-token/photos/${photos[0].id}`, {
      headers: { cookie: `${SESSION_COOKIE}=made.up` },
    });
    assert.equal(forged.status, 401, 'an unsigned cookie is not a session');

    assert.deepEqual(drive.requested, [], 'Drive is never contacted');
  });

  it('rejects a non-numeric photo id without touching the database', async () => {
    seed();
    const res = await fetch(`${baseUrl}/api/searches/valid-token/photos/not-a-number`, as(me));
    assert.equal(res.status, 404);
  });

  it('drops expired sessions when asked to clean up', () => {
    const { event, photos } = seed();
    queries.createSearchSession(db, {
      token: 'stale',
      eventId: event.id,
      expiresAt: inMinutes(-5),
      photoIds: [photos[0].id],
    });

    assert.equal(queries.deleteExpiredSearchSessions(db), 1);
    assert.ok(queries.getActiveSearchSession(db, 'valid-token'), 'live sessions are kept');
  });
});
