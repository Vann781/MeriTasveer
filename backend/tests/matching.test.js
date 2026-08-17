import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, it } from 'node:test';
import * as queries from '../src/db/queries.js';
import { MatchingService } from '../src/services/matching.js';
import { normalize } from '../src/services/faceRecognition.js';

const schema = fs.readFileSync(path.join(import.meta.dirname, '../src/db/schema.sql'), 'utf8');

/**
 * Builds a unit-length embedding pointing mostly along one axis. Two vectors
 * built from the same axis are similar; different axes are near-orthogonal,
 * which mirrors how real embeddings behave.
 */
function personEmbedding(axis, wobble = 0) {
  const vector = new Float32Array(512);
  vector[axis] = 1;
  if (wobble) vector[(axis + 1) % 512] = wobble;
  return normalize(vector);
}

const ALICE = 0;
const BOB = 1;
const CAROL = 2;

let db;
let matching;

/** Creates an event with photos, each holding the listed people's faces. */
function seedEvent(name, photosWithPeople, status = 'ready') {
  const event = queries.upsertEvent(db, { driveFolderId: `folder-${name}-aaaaaaaa`, name });
  queries.setEventStatus(db, event.id, status, { indexedAt: '2026-01-01T00:00:00Z' });

  photosWithPeople.forEach((people, index) => {
    const photo = queries.insertPhoto(db, {
      eventId: event.id,
      driveFileId: `file-${name}-${index}-aaaaaaaa`,
      fileName: `IMG_${index}.jpg`,
      mimeType: 'image/jpeg',
    });

    people.forEach((axis, faceIndex) => {
      queries.insertEmbedding(db, {
        photoId: photo.id,
        embedding: personEmbedding(axis),
        faceIndex,
      });
    });
  });

  return event;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  matching = new MatchingService({ db, threshold: 0.4 });
});

describe('finding matches', () => {
  it('returns only the photos containing that person', () => {
    const event = seedEvent('Fun Activity', [
      [ALICE, BOB],
      [BOB, CAROL],
      [ALICE],
      [CAROL],
    ]);

    const selfies = [0, 0.05, 0.1].map((w) => personEmbedding(ALICE, w));
    const result = matching.findMatches(selfies, event.id);

    const photos = queries.listPhotos(db, event.id);
    const matchedNames = result.matches.map(
      (m) => photos.find((p) => p.id === m.photoId).file_name,
    );

    assert.deepEqual(matchedNames.sort(), ['IMG_0.jpg', 'IMG_2.jpg']);
  });

  it('lists a photo once even when several selfies and faces match it', () => {
    const event = seedEvent('Fun Activity', [[ALICE, ALICE, ALICE]]);
    const selfies = [0, 0.05, 0.1].map((w) => personEmbedding(ALICE, w));

    const result = matching.findMatches(selfies, event.id);

    assert.equal(result.matches.length, 1, 'duplicates are collapsed');
    assert.equal(result.matches[0].agreement, 3, 'all three selfies agreed');
  });

  it('ranks photos all three selfies agree on above single-selfie matches', () => {
    const event = seedEvent('Fun Activity', [[BOB], [ALICE]]);
    const photos = queries.listPhotos(db, event.id);

    // Two selfies of Alice and one of Bob: Alice's photo should win on
    // agreement even though both photos match something.
    const selfies = [personEmbedding(ALICE), personEmbedding(ALICE, 0.05), personEmbedding(BOB)];
    const result = matching.findMatches(selfies, event.id);

    assert.equal(result.matches.length, 2);
    const first = photos.find((p) => p.id === result.matches[0].photoId);
    assert.equal(first.file_name, 'IMG_1.jpg', "Alice's photo ranks first");
    assert.equal(result.matches[0].agreement, 2);
    assert.equal(result.matches[1].agreement, 1);
  });

  it('returns nothing when the person is not in the event', () => {
    const event = seedEvent('Fun Activity', [[BOB], [CAROL], [BOB, CAROL]]);
    const result = matching.findMatches([personEmbedding(ALICE)], event.id);

    assert.deepEqual(result.matches, []);
  });

  it('never looks at another event, even for the same person', () => {
    const chosen = seedEvent('Chosen Event', [[BOB]]);
    const other = seedEvent('Other Event', [[ALICE], [ALICE, BOB]]);

    const result = matching.findMatches([personEmbedding(ALICE)], chosen.id);

    assert.deepEqual(result.matches, [], 'Alice is in the other event only');
    assert.equal(result.searched.faces, 1, 'only the chosen event was loaded');
    assert.equal(result.event.id, chosen.id);

    // Sanity: the same selfie does find her in the event she attended.
    assert.equal(matching.findMatches([personEmbedding(ALICE)], other.id).matches.length, 2);
  });

  it('respects the threshold', () => {
    const event = seedEvent('Fun Activity', [[ALICE]]);

    // A wobble of 1 puts the selfie at cos = 1/sqrt(2) ~ 0.707 from the
    // stored face, so it sits between the two thresholds below.
    const borderline = [personEmbedding(ALICE, 1)];
    const score = new MatchingService({ db, threshold: 0 }).findMatches(borderline, event.id)
      .matches[0].score;
    assert.ok(Math.abs(score - 0.707) < 0.01, `expected ~0.707, got ${score}`);

    assert.equal(
      new MatchingService({ db, threshold: 0.6 }).findMatches(borderline, event.id).matches.length,
      1,
      'above the threshold, so it matches',
    );
    assert.equal(
      new MatchingService({ db, threshold: 0.8 }).findMatches(borderline, event.id).matches.length,
      0,
      'below the threshold, so it does not',
    );
  });

  it('refuses to search an event that is not indexed yet', () => {
    const pending = seedEvent('Not Ready', [[ALICE]], 'pending');
    assert.throws(
      () => matching.findMatches([personEmbedding(ALICE)], pending.id),
      /still being prepared/,
    );
  });

  it('rejects an unknown event and an empty selfie list', () => {
    const event = seedEvent('Fun Activity', [[ALICE]]);
    assert.throws(() => matching.findMatches([personEmbedding(ALICE)], 9999), /Event not found/);
    assert.throws(() => matching.findMatches([], event.id), /No selfies/);
  });

  it('copes with an indexed event that has no faces at all', () => {
    const event = seedEvent('All Videos', [[], []]);
    const result = matching.findMatches([personEmbedding(ALICE)], event.id);

    assert.deepEqual(result.matches, []);
    assert.equal(result.searched.photos, 2);
    assert.equal(result.searched.faces, 0);
  });
});
