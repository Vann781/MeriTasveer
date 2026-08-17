import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { useDatabase } from '../src/db/database.js';
import * as queries from '../src/db/queries.js';
import { IndexQueue } from '../src/services/indexQueue.js';
import { SESSION_COOKIE, createSessionToken } from '../src/utils/session.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/db/schema.sql'), 'utf8');

let db;
let server;
let baseUrl;
let participant;

const as = (user) => ({ headers: { cookie: `${SESSION_COOKIE}=${createSessionToken(user.id)}` } });

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

  participant = queries.upsertUser(db, {
    googleUserId: 'google-participant',
    email: 'participant@example.com',
    name: 'Participant',
    profilePicture: null,
  });
});

describe('admin routes are closed', () => {
  it('turns away anonymous callers', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events`);
    assert.equal(res.status, 401);
  });

  it('turns away a signed-in participant who is not an organizer', async () => {
    // ADMIN_EMAILS is empty in tests, so no one is an admin.
    const res = await fetch(`${baseUrl}/api/admin/events`, as(participant));

    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.message, 'Not authorized');
  });

  it('blocks indexing too, not just the listing', async () => {
    const res = await fetch(`${baseUrl}/api/admin/events/1/index`, {
      method: 'POST',
      ...as(participant),
    });
    assert.equal(res.status, 403);
  });
});

describe('the index queue', () => {
  /** Indexing service that finishes when the test says so. */
  function controllable() {
    let release;
    const finished = new Promise((resolve) => {
      release = resolve;
    });

    return {
      calls: [],
      finish: (result) => release(result),
      async indexEvent(eventId, { onProgress } = {}) {
        this.calls.push(eventId);
        onProgress?.({ processed: 3, failed: 1, total: 10, faces: 7 });
        return finished;
      },
    };
  }

  it('reports progress while the run is in flight', async () => {
    const indexing = controllable();
    const queue = new IndexQueue({ indexing });

    assert.deepEqual(queue.start(42), { accepted: true });
    assert.equal(queue.busyWith, 42);
    assert.deepEqual(queue.progressFor(42), {
      state: 'indexing',
      processed: 4, // three done plus one failed
      total: 10,
      faces: 7,
    });

    indexing.finish({ processed: 9, failed: 1, total: 10, faces: 20, durationMs: 1234 });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(queue.busyWith, null, 'the queue frees up');
    assert.equal(queue.progressFor(42).state, 'ready');
    assert.equal(queue.progressFor(42).faces, 20);
  });

  it('runs one event at a time', async () => {
    const indexing = controllable();
    const queue = new IndexQueue({ indexing });

    queue.start(1);
    const second = queue.start(2);

    assert.equal(second.accepted, false);
    assert.match(second.reason, /already being indexed|Another event/);
    assert.deepEqual(indexing.calls, [1], 'the second event never started');

    indexing.finish({ processed: 1, failed: 0, total: 1, faces: 0, durationMs: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(queue.start(2).accepted, true, 'and is accepted once free');
  });

  it('records a failure instead of hanging on to the slot', async () => {
    const queue = new IndexQueue({
      indexing: {
        async indexEvent() {
          throw new Error('Drive unavailable');
        },
      },
    });

    queue.start(7);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(queue.busyWith, null, 'the slot is released');
    assert.deepEqual(queue.progressFor(7), { state: 'failed', error: 'Drive unavailable' });
  });
});

describe('recovering from a restart', () => {
  it('marks interrupted runs as failed', () => {
    const stuck = queries.upsertEvent(db, { driveFolderId: 'folder-aaaaaaaaaa', name: 'Stuck' });
    const fine = queries.upsertEvent(db, { driveFolderId: 'folder-bbbbbbbbbb', name: 'Fine' });
    queries.setEventStatus(db, stuck.id, 'indexing');
    queries.setEventStatus(db, fine.id, 'ready');

    assert.equal(queries.resetInterruptedIndexing(db), 1);
    assert.equal(queries.getEvent(db, stuck.id).status, 'failed');
    assert.equal(queries.getEvent(db, fine.id).status, 'ready', 'untouched');
  });
});

describe('the dashboard listing', () => {
  it('counts photos and faces per event', () => {
    const event = queries.upsertEvent(db, { driveFolderId: 'folder-aaaaaaaaaa', name: 'Fun' });
    const empty = queries.upsertEvent(db, { driveFolderId: 'folder-bbbbbbbbbb', name: 'Empty' });

    for (const [index, faces] of [2, 0, 3].entries()) {
      const photo = queries.insertPhoto(db, {
        eventId: event.id,
        driveFileId: `file-${index}-aaaaaaaa`,
        fileName: `IMG_${index}.jpg`,
        mimeType: 'image/jpeg',
      });
      for (let faceIndex = 0; faceIndex < faces; faceIndex += 1) {
        queries.insertEmbedding(db, {
          photoId: photo.id,
          embedding: new Float32Array(512),
          faceIndex,
        });
      }
    }

    const rows = queries.listEventsForAdmin(db);
    const fun = rows.find((row) => row.id === event.id);
    const none = rows.find((row) => row.id === empty.id);

    assert.equal(fun.photo_count, 3);
    assert.equal(fun.face_count, 5, 'faces are not multiplied by the photo join');
    assert.equal(none.photo_count, 0);
    assert.equal(none.face_count, 0);
  });
});
