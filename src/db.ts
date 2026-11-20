import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DB_PATH = process.env.LOGO_MCP_DB ?? join(ROOT, "data", "logos.db");

export type Logo = {
  rowid: number;
  id: string;
  source: string;
  title: string;
  designer: string | null;
  company: string | null;
  year: number | null;
  era: string | null;
  mark_type: string | null;
  style: string; // JSON array
  industry: string; // JSON array
  subject: string; // JSON array
  color: string | null;
  keywords: string; // JSON array
  description: string | null;
  thumbnail_url: string;
  source_url: string;
  attribution: string;
  license: string;
};

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS logos (
      rowid INTEGER PRIMARY KEY,
      id TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      designer TEXT, company TEXT, year INTEGER, era TEXT,
      mark_type TEXT,
      style TEXT NOT NULL DEFAULT '[]',
      industry TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '[]',
      color TEXT,
      keywords TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      thumbnail_url TEXT NOT NULL,
      source_url TEXT NOT NULL,
      attribution TEXT NOT NULL,
      license TEXT NOT NULL,
      embedding BLOB,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS logos_fts USING fts5(
      title, designer, company, description, tags, tokenize = 'porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_items (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      logo_id TEXT NOT NULL REFERENCES logos(id),
      note TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, logo_id)
    );
    CREATE TABLE IF NOT EXISTS http_cache (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export type Db = ReturnType<typeof openDb>;

/** Insert or update a logo's metadata (never its embedding) and keep FTS in sync. */
export function upsertLogo(db: Db, l: Omit<Logo, "rowid">) {
  const row = db
    .prepare(
      `INSERT INTO logos (id, source, title, designer, company, year, era, mark_type, style, industry, subject, color, keywords, description, thumbnail_url, source_url, attribution, license)
       VALUES (@id, @source, @title, @designer, @company, @year, @era, @mark_type, @style, @industry, @subject, @color, @keywords, @description, @thumbnail_url, @source_url, @attribution, @license)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, designer=excluded.designer, company=excluded.company, year=excluded.year, era=excluded.era,
         mark_type=COALESCE(excluded.mark_type, logos.mark_type),
         style=CASE WHEN excluded.style = '[]' THEN logos.style ELSE excluded.style END,
         industry=excluded.industry, subject=excluded.subject, color=excluded.color, keywords=excluded.keywords,
         description=excluded.description, thumbnail_url=excluded.thumbnail_url, source_url=excluded.source_url,
         attribution=excluded.attribution, license=excluded.license, updated_at=datetime('now')
       RETURNING rowid`
    )
    .get(l) as { rowid: number };
  indexText(db, row.rowid);
  return row.rowid;
}

export function indexText(db: Db, rowid: number) {
  const l = db.prepare("SELECT * FROM logos WHERE rowid = ?").get(rowid) as Logo;
  const tags = [l.mark_type, l.era, l.color, ...JSON.parse(l.style), ...JSON.parse(l.industry), ...JSON.parse(l.subject), ...JSON.parse(l.keywords)]
    .filter(Boolean)
    .join(" ")
    .replaceAll("_", " ");
  db.prepare("DELETE FROM logos_fts WHERE rowid = ?").run(rowid);
  db.prepare("INSERT INTO logos_fts (rowid, title, designer, company, description, tags) VALUES (?, ?, ?, ?, ?, ?)").run(
    rowid, l.title, l.designer ?? "", l.company ?? "", l.description ?? "", tags
  );
}

export const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
