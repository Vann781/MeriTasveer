-- Event Photo Finder — SQLite schema.
-- The database stores metadata and face embeddings only.
-- Event photos always stay in Google Drive; selfies are never stored.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  google_user_id  TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  name            TEXT,
  profile_picture TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_folder_id TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  -- pending | indexing | ready | failed
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_at      TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, drive_file_id)
);

CREATE INDEX IF NOT EXISTS idx_photos_event_id ON photos(event_id);

-- A photo may contain several people, so one photo can have many embeddings.
CREATE TABLE IF NOT EXISTS face_embeddings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id   INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  -- 512 little-endian float32 values. Packed rather than JSON: 2 KB instead
  -- of 5 KB per face, and it maps onto a Postgres bytea column later.
  embedding  BLOB NOT NULL,
  face_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_photo_id ON face_embeddings(photo_id);

-- A completed search. The token is what lets the participant fetch the photos
-- it found, and nothing else. user_id stays NULL until Google login exists.
CREATE TABLE IF NOT EXISTS search_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Exactly which photos a search returned. Access is checked against this list,
-- so a participant cannot reach a photo their own search did not find.
CREATE TABLE IF NOT EXISTS search_session_photos (
  search_session_id INTEGER NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  photo_id          INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  PRIMARY KEY (search_session_id, photo_id)
);
