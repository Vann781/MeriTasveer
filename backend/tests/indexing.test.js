import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, it } from 'node:test';
import * as queries from '../src/db/queries.js';
import { IndexingService } from '../src/services/indexing.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/db/schema.sql'), 'utf8');

/**
 * Stand-in for Google Drive — no network, no credentials.
 * The "file contents" are just the file name, which is how the fake face
 * detector below knows how many faces to report.
 */
function fakeDrive({ folders, photos, failOn = [] }) {
  const nameOf = (fileId) =>
    Object.values(photos)
      .flat()
      .find((p) => p.id === fileId)?.name ?? fileId;

  return {
    listEvents: async () => folders,
    listPhotos: async (folderId) => photos[folderId] ?? [],
    downloadFileToBuffer: async (fileId) => {
      if (failOn.includes(fileId)) throw new Error('connection reset');
      return Buffer.from(nameOf(fileId));
    },
  };
}

/** Stand-in for the models: face count is encoded in the file name. */
function fakeFaceRecognition() {
  return {
    load: async () => {},
    detectAndEmbed: async (buffer) => {
      const name = buffer.toString();
      if (name.includes('broken')) throw new Error('could not decode image');
      const count = Number(name.match(/faces(\d+)/)?.[1] ?? 0);

      return Array.from({ length: count }, (_, faceIndex) => ({
        faceIndex,
        score: 0.9,
        box: [0, 0, 50, 50],
        embedding: Float32Array.from({ length: 512 }, () => faceIndex + 1),
      }));
    },
  };
}

const photo = (id, name, mimeType = 'image/jpeg') => ({ id, name, mimeType });

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
});

describe('event sync', () => {
  it('creates a row per Drive folder and is safe to run twice', async () => {
    const drive = fakeDrive({
      folders: [
        { id: 'folder-aaaaaaaaaa', name: 'XYZ Fun Activity ' },
        { id: 'folder-bbbbbbbbbb', name: 'Robotics Workshop' },
      ],
      photos: {},
    });
    const indexing = new IndexingService({ db, drive, faceRecognition: fakeFaceRecognition() });

    const first = await indexing.syncEvents();
    assert.equal(first.total, 2);
    assert.equal(first.added, 2);

    const second = await indexing.syncEvents();
    assert.equal(second.total, 2, 'running twice must not duplicate events');
    assert.equal(second.added, 0);

    const names = queries.listEvents(db).map((e) => e.name);
    assert.deepEqual(names, ['Robotics Workshop', 'XYZ Fun Activity'], 'sorted, and trimmed');
    assert.equal(queries.listEvents(db)[0].status, 'pending');
  });

  it('follows a folder rename without losing the event', async () => {
    const folders = [{ id: 'folder-aaaaaaaaaa', name: 'Old Name' }];
    const indexing = new IndexingService({
      db,
      drive: fakeDrive({ folders, photos: {} }),
      faceRecognition: fakeFaceRecognition(),
    });

    await indexing.syncEvents();
    const before = queries.listEvents(db)[0];

    folders[0].name = 'New Name';
    await indexing.syncEvents();
    const after = queries.listEvents(db)[0];

    assert.equal(after.id, before.id, 'same row');
    assert.equal(after.name, 'New Name');
  });
});

describe('indexing an event', () => {
  const folders = [{ id: 'folder-aaaaaaaaaa', name: 'XYZ Fun Activity' }];

  const build = (photos, options = {}) =>
    new IndexingService({
      db,
      drive: fakeDrive({ folders, photos: { 'folder-aaaaaaaaaa': photos }, ...options }),
      faceRecognition: fakeFaceRecognition(),
    });

  it('stores photos and one embedding per face', async () => {
    const indexing = build([
      photo('file-aaaaaaaaaa', 'faces2-group.jpg'),
      photo('file-bbbbbbbbbb', 'faces0-scenery.jpg'),
      photo('file-cccccccccc', 'faces3-crowd.jpg'),
    ]);
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);

    const result = await indexing.indexEvent(event.id);

    assert.equal(result.processed, 3);
    assert.equal(result.faces, 5, 'two plus zero plus three faces');
    assert.equal(result.photosWithFaces, 2);
    assert.equal(queries.countPhotos(db, event.id), 3);
    assert.equal(queries.countEmbeddings(db, event.id), 5);

    const after = queries.getEvent(db, event.id);
    assert.equal(after.status, 'ready');
    assert.ok(after.indexed_at, 'indexed_at is stamped');
  });

  it('round-trips embeddings through the database unchanged', async () => {
    const indexing = build([photo('file-aaaaaaaaaa', 'faces1-portrait.jpg')]);
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);
    await indexing.indexEvent(event.id);

    const [stored] = queries.loadEventEmbeddings(db, event.id);
    assert.equal(stored.embedding.length, 512);
    assert.equal(stored.embedding[0], 1);
    assert.equal(stored.faceIndex, 0);
  });

  it('skips videos and other non-images', async () => {
    const indexing = build([
      photo('file-aaaaaaaaaa', 'faces1-a.jpg'),
      photo('file-bbbbbbbbbb', 'clip.mp4', 'video/mp4'),
      photo('file-cccccccccc', 'clip2.mov', 'video/quicktime'),
    ]);
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);

    const result = await indexing.indexEvent(event.id);
    assert.equal(result.total, 1);
    assert.equal(result.skippedUnsupported, 2);
  });

  it('keeps going when one photo fails and counts it', async () => {
    const indexing = build(
      [
        photo('file-aaaaaaaaaa', 'faces1-good.jpg'),
        photo('file-bbbbbbbbbb', 'faces1-dropped.jpg'),
        photo('file-cccccccccc', 'broken.jpg'),
        photo('file-dddddddddd', 'faces2-good.jpg'),
      ],
      { failOn: ['file-bbbbbbbbbb'] },
    );
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);

    const result = await indexing.indexEvent(event.id);

    assert.equal(result.processed, 2, 'the two good photos still land');
    assert.equal(result.failed, 2, 'one download failure, one decode failure');
    assert.equal(queries.getEvent(db, event.id).status, 'ready');
  });

  it('replaces the previous index when run again', async () => {
    const photos = [photo('file-aaaaaaaaaa', 'faces2-a.jpg'), photo('file-bbbbbbbbbb', 'faces1-b.jpg')];
    const indexing = build(photos);
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);

    await indexing.indexEvent(event.id);
    assert.equal(queries.countPhotos(db, event.id), 2);
    assert.equal(queries.countEmbeddings(db, event.id), 3);

    // The organizer deletes one photo and adds another, then re-indexes.
    photos.splice(0, photos.length, photo('file-cccccccccc', 'faces1-c.jpg'));
    await indexing.indexEvent(event.id);

    assert.equal(queries.countPhotos(db, event.id), 1, 'stale photos are gone');
    assert.equal(queries.countEmbeddings(db, event.id), 1, 'their embeddings went too');
  });

  it('marks the event failed when Drive cannot be listed', async () => {
    const indexing = new IndexingService({
      db,
      drive: {
        listEvents: async () => folders,
        listPhotos: async () => {
          throw new Error('drive unavailable');
        },
      },
      faceRecognition: fakeFaceRecognition(),
    });
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);

    await assert.rejects(() => indexing.indexEvent(event.id), /drive unavailable/);
    assert.equal(queries.getEvent(db, event.id).status, 'failed');
  });

  it('keeps the old index when the new listing cannot be fetched', async () => {
    let failing = false;
    const indexing = new IndexingService({
      db,
      drive: {
        listEvents: async () => folders,
        listPhotos: async () => {
          if (failing) throw new Error('drive unavailable');
          return [photo('file-aaaaaaaaaa', 'faces2-a.jpg')];
        },
        downloadFileToBuffer: async (id) => Buffer.from(`bytes-for-${id}`),
      },
      faceRecognition: fakeFaceRecognition(),
    });
    await indexing.syncEvents();
    const [event] = queries.listEvents(db);
    await indexing.indexEvent(event.id);

    failing = true;
    await assert.rejects(() => indexing.indexEvent(event.id));

    assert.equal(queries.countPhotos(db, event.id), 1, 'previous photos survive a failed re-index');
  });

  it('rejects an unknown event', async () => {
    const indexing = build([]);
    await assert.rejects(() => indexing.indexEvent(999), /Event not found/);
  });
});
