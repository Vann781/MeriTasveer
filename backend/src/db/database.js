import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

/**
 * Minimal SQLite access layer. Everything else in the app goes through
 * getDb(), so swapping SQLite for PostgreSQL later stays a local change.
 */
let db = null;

export function initDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  return db;
}

export function getDb() {
  return db ?? initDb();
}

/** Points the app at a different database. Used by tests. */
export function useDatabase(instance) {
  db = instance;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
