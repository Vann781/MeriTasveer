/**
 * Every SQL statement in the app lives here, so the rest of the code never
 * writes SQL and swapping SQLite for PostgreSQL stays a change to one file.
 *
 * Each function takes the database handle explicitly, which also lets tests
 * run against an in-memory database.
 */

/** Float32Array -> BLOB. */
export function encodeEmbedding(embedding) {
  const floats = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

/** BLOB -> Float32Array. Copies, so the row buffer can be released. */
export function decodeEmbedding(blob) {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

// --- users ----------------------------------------------------------------

/**
 * Creates or updates a participant after Google login.
 * Keyed on the Google user ID, never the email: people change their email
 * address, and the Google ID is the stable identifier.
 */
export function upsertUser(db, { googleUserId, email, name, profilePicture }) {
  return db
    .prepare(
      `INSERT INTO users (google_user_id, email, name, profile_picture)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (google_user_id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         profile_picture = excluded.profile_picture
       RETURNING *`,
    )
    .get(googleUserId, email, name, profilePicture);
}

export function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// --- events ---------------------------------------------------------------

/** Adds an event discovered in Drive, or updates its name if it was renamed. */
export function upsertEvent(db, { driveFolderId, name }) {
  return db
    .prepare(
      `INSERT INTO events (drive_folder_id, name)
       VALUES (?, ?)
       ON CONFLICT (drive_folder_id) DO UPDATE SET name = excluded.name
       RETURNING *`,
    )
    .get(driveFolderId, name);
}

/**
 * Events with their photo and face counts, for the participant list.
 * An event with photos but no faces cannot match anyone, so the count is
 * needed to decide whether it is worth offering.
 */
export function listEvents(db) {
  return db
    .prepare(
      `SELECT e.*,
              COUNT(DISTINCT p.id) AS photo_count,
              COUNT(f.id)          AS face_count
       FROM events e
       LEFT JOIN photos p ON p.event_id = e.id
       LEFT JOIN face_embeddings f ON f.photo_id = p.id
       GROUP BY e.id
       ORDER BY e.name COLLATE NOCASE`,
    )
    .all();
}

/** Events with photo and face counts, for the organizer's dashboard. */
export function listEventsForAdmin(db) {
  return db
    .prepare(
      `SELECT e.*,
              COUNT(DISTINCT p.id) AS photo_count,
              COUNT(f.id)          AS face_count
       FROM events e
       LEFT JOIN photos p ON p.event_id = e.id
       LEFT JOIN face_embeddings f ON f.photo_id = p.id
       GROUP BY e.id
       ORDER BY e.name COLLATE NOCASE`,
    )
    .all();
}

/**
 * An index run that was interrupted by a restart leaves its event stuck on
 * "indexing" forever. Nothing is running after a restart, so mark them failed
 * and let the organizer retry.
 */
export function resetInterruptedIndexing(db) {
  return db.prepare("UPDATE events SET status = 'failed' WHERE status = 'indexing'").run().changes;
}

export function getEvent(db, id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function getEventByName(db, name) {
  return db.prepare('SELECT * FROM events WHERE name = ? COLLATE NOCASE').get(name);
}

export function setEventStatus(db, id, status, { indexedAt = null } = {}) {
  return db
    .prepare(
      `UPDATE events
       SET status = ?, indexed_at = COALESCE(?, indexed_at)
       WHERE id = ?`,
    )
    .run(status, indexedAt, id);
}

/** Drops an event's photos; embeddings go with them via ON DELETE CASCADE. */
export function clearEventIndex(db, eventId) {
  return db.prepare('DELETE FROM photos WHERE event_id = ?').run(eventId).changes;
}

// --- photos ---------------------------------------------------------------

export function insertPhoto(db, { eventId, driveFileId, fileName, mimeType }) {
  return db
    .prepare(
      `INSERT INTO photos (event_id, drive_file_id, file_name, mime_type)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .get(eventId, driveFileId, fileName, mimeType);
}

export function listPhotos(db, eventId) {
  return db
    .prepare('SELECT * FROM photos WHERE event_id = ? ORDER BY file_name COLLATE NOCASE')
    .all(eventId);
}

export function getPhoto(db, id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

export function countPhotos(db, eventId) {
  return db.prepare('SELECT COUNT(*) AS count FROM photos WHERE event_id = ?').get(eventId).count;
}

// --- face embeddings ------------------------------------------------------

export function insertEmbedding(db, { photoId, embedding, faceIndex }) {
  return db
    .prepare('INSERT INTO face_embeddings (photo_id, embedding, face_index) VALUES (?, ?, ?)')
    .run(photoId, encodeEmbedding(embedding), faceIndex);
}

export function countEmbeddings(db, eventId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM face_embeddings f
       JOIN photos p ON p.id = f.photo_id
       WHERE p.event_id = ?`,
    )
    .get(eventId).count;
}

// --- search sessions ------------------------------------------------------

/** Records a completed search and the photos it is allowed to serve. */
export function createSearchSession(db, { token, eventId, userId = null, expiresAt, photoIds }) {
  const insert = db.transaction(() => {
    const session = db
      .prepare(
        `INSERT INTO search_sessions (token, user_id, event_id, expires_at)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
      )
      .get(token, userId, eventId, expiresAt);

    const link = db.prepare(
      'INSERT INTO search_session_photos (search_session_id, photo_id) VALUES (?, ?)',
    );
    for (const photoId of photoIds) link.run(session.id, photoId);

    return session;
  });

  return insert();
}

/**
 * Looks up a search session by token. Expired sessions are not returned.
 *
 * Both sides go through datetime(): expires_at is stored as ISO 8601
 * ("2026-08-17T00:30:00.000Z") while datetime('now') yields
 * "2026-08-17 00:30:00". Comparing those as plain strings puts every ISO
 * timestamp above every SQLite one — "T" sorts after " " — so expired
 * sessions would look valid forever.
 */
export function getActiveSearchSession(db, token) {
  return db
    .prepare(
      "SELECT * FROM search_sessions WHERE token = ? AND datetime(expires_at) > datetime('now')",
    )
    .get(token);
}

/**
 * The same lookup, restricted to the participant who ran the search. Holding
 * someone else's token is not enough — it must be your own search.
 */
export function getActiveSearchSessionForUser(db, token, userId) {
  return db
    .prepare(
      `SELECT * FROM search_sessions
       WHERE token = ? AND user_id = ? AND datetime(expires_at) > datetime('now')`,
    )
    .get(token, userId);
}

/** True when this search actually returned that photo. */
export function searchSessionHasPhoto(db, sessionId, photoId) {
  const row = db
    .prepare(
      'SELECT 1 AS found FROM search_session_photos WHERE search_session_id = ? AND photo_id = ?',
    )
    .get(sessionId, photoId);

  return Boolean(row);
}

export function listSearchSessionPhotos(db, sessionId) {
  return db
    .prepare(
      `SELECT p.*
       FROM search_session_photos sp
       JOIN photos p ON p.id = sp.photo_id
       WHERE sp.search_session_id = ?
       ORDER BY p.file_name COLLATE NOCASE`,
    )
    .all(sessionId);
}

/** Housekeeping: search results are temporary by design. */
export function deleteExpiredSearchSessions(db) {
  return db
    .prepare("DELETE FROM search_sessions WHERE datetime(expires_at) <= datetime('now')")
    .run().changes;
}

/**
 * Every face in one event, for matching against a participant's selfies.
 * Scoped to a single event by design — searches must never cross events.
 */
export function loadEventEmbeddings(db, eventId) {
  const rows = db
    .prepare(
      `SELECT f.photo_id, f.face_index, f.embedding
       FROM face_embeddings f
       JOIN photos p ON p.id = f.photo_id
       WHERE p.event_id = ?`,
    )
    .all(eventId);

  return rows.map((row) => ({
    photoId: row.photo_id,
    faceIndex: row.face_index,
    embedding: decodeEmbedding(row.embedding),
  }));
}
