import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Tudo que o sistema grava fica em server/data (ou em DATA_DIR): banco + imagens.
// Para fazer backup basta copiar essa pasta.
export const DATA_DIR = process.env.DATA_DIR || path.resolve(here, '../data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'factory.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrações versionadas via PRAGMA user_version. Para evoluir o banco
// (importação de Excel, métricas...) basta acrescentar novos itens ao final.
const migrations = [
  `
  CREATE TABLE maps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    image       TEXT    NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    is_root     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE areas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id        INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL DEFAULT '',
    code          TEXT    NOT NULL DEFAULT '',   -- chave para ligar a área a dados externos (Excel)
    description   TEXT    NOT NULL DEFAULT '',
    points        TEXT    NOT NULL,              -- JSON [[x,y],...] normalizado de 0 a 1
    color         TEXT    NOT NULL DEFAULT '#2B5C8F',
    opacity       REAL    NOT NULL DEFAULT 0.25,
    show_label    INTEGER NOT NULL DEFAULT 1,
    target_map_id INTEGER REFERENCES maps(id) ON DELETE SET NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_areas_map ON areas(map_id);
  `,
];

const current = db.pragma('user_version', { simple: true });
for (let i = current; i < migrations.length; i++) {
  db.transaction(() => {
    db.exec(migrations[i]);
    db.pragma(`user_version = ${i + 1}`);
  })();
}
