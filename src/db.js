import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// One SQLite file holds everything. node:sqlite ships with Node, so there is
// no native build step to break inside a container.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      api_token_hash TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      mime TEXT NOT NULL,
      file TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_feed ON media (visibility, created_at);

    CREATE TABLE IF NOT EXISTS media_tags (
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (media_id, tag)
    );
    CREATE INDEX IF NOT EXISTS media_tags_by_tag ON media_tags (tag);

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS boards_by_owner ON boards (owner_id);

    CREATE TABLE IF NOT EXISTS board_items (
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, media_id)
    );
  `);
  return db;
}
