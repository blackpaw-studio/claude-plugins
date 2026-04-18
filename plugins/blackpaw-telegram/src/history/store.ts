/**
 * SQLite-backed message history.
 *
 * Captures inbound and outbound text per chat. Drives get_history,
 * search_messages, and the reply-chain walker. Runs on bun:sqlite — zero
 * install, synchronous, single-file store at STATE_DIR/history.sqlite.
 *
 * Retention policy (configurable via env):
 *  - TELEGRAM_HISTORY_MAX_PER_CHAT  (default 500 messages/chat)
 *  - TELEGRAM_HISTORY_TTL_DAYS      (default 14 days)
 *  - TELEGRAM_HISTORY_MAX_BYTES     (default 50 MB total DB size)
 *
 * Pruner runs on startup and every 6 hours. Keeps the store bounded
 * without a daemon.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync, statSync } from 'fs'
import { dirname } from 'path'

export type Direction = 'in' | 'out'

export type HistoryRow = {
  chat_id: string
  message_id: string | null
  thread_id: string | null
  direction: Direction
  sender_id: string | null
  sender_name: string | null
  text: string
  ts: number
}

let db: Database | null = null
let dbPath = ''
let pruneTimer: Timer | null = null

const DEFAULTS = {
  perChat: 500,
  ttlMs: 14 * 24 * 60 * 60 * 1000,
  maxBytes: 50 * 1024 * 1024,
} as const

function env(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function openHistory(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  dbPath = path
  db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id      TEXT    NOT NULL,
      message_id   TEXT,
      thread_id    TEXT,
      direction    TEXT    NOT NULL CHECK(direction IN ('in', 'out')),
      sender_id    TEXT,
      sender_name  TEXT,
      text         TEXT    NOT NULL,
      ts           INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_msg ON messages(chat_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
  `)

  prune()
  pruneTimer = setInterval(prune, 6 * 60 * 60 * 1000)
  pruneTimer.unref()
}

export function closeHistory(): void {
  if (pruneTimer) clearInterval(pruneTimer)
  pruneTimer = null
  db?.close()
  db = null
}

export function recordMessage(row: HistoryRow): void {
  if (!db) return
  db.prepare(
    `INSERT INTO messages (chat_id, message_id, thread_id, direction, sender_id, sender_name, text, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.chat_id,
    row.message_id,
    row.thread_id,
    row.direction,
    row.sender_id,
    row.sender_name,
    row.text,
    row.ts,
  )
}

export type HistoryEntry = {
  chat_id: string
  message_id: string | null
  thread_id: string | null
  direction: Direction
  sender_id: string | null
  sender_name: string | null
  text: string
  ts: number
}

export function getHistory(chat_id: string, limit = 50, before?: number): HistoryEntry[] {
  if (!db) return []
  const capped = Math.min(Math.max(limit, 1), 500)
  const rows =
    before != null
      ? (db
          .prepare(
            `SELECT chat_id, message_id, thread_id, direction, sender_id, sender_name, text, ts
             FROM messages
             WHERE chat_id = ? AND ts < ?
             ORDER BY ts DESC
             LIMIT ?`,
          )
          .all(chat_id, before, capped) as HistoryEntry[])
      : (db
          .prepare(
            `SELECT chat_id, message_id, thread_id, direction, sender_id, sender_name, text, ts
             FROM messages
             WHERE chat_id = ?
             ORDER BY ts DESC
             LIMIT ?`,
          )
          .all(chat_id, capped) as HistoryEntry[])
  return rows.reverse() // ascending (oldest first) for readability
}

export function findByMessageId(chat_id: string, message_id: string): HistoryEntry | undefined {
  if (!db) return undefined
  const row = db
    .prepare(
      `SELECT chat_id, message_id, thread_id, direction, sender_id, sender_name, text, ts
       FROM messages WHERE chat_id = ? AND message_id = ? LIMIT 1`,
    )
    .get(chat_id, message_id) as HistoryEntry | undefined
  return row
}

export function searchMessages(chat_id: string, query: string, limit = 50): HistoryEntry[] {
  if (!db) return []
  const safe = query.replace(/[%_]/g, s => `\\${s}`)
  const rows = db
    .prepare(
      `SELECT chat_id, message_id, thread_id, direction, sender_id, sender_name, text, ts
       FROM messages
       WHERE chat_id = ? AND text LIKE ? ESCAPE '\\'
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(chat_id, `%${safe}%`, Math.min(Math.max(limit, 1), 200)) as HistoryEntry[]
  return rows
}

export function prune(): void {
  if (!db) return
  const perChat = env('TELEGRAM_HISTORY_MAX_PER_CHAT', DEFAULTS.perChat)
  const ttlDays = env('TELEGRAM_HISTORY_TTL_DAYS', DEFAULTS.ttlMs / (24 * 60 * 60 * 1000))
  const maxBytes = env('TELEGRAM_HISTORY_MAX_BYTES', DEFAULTS.maxBytes)

  const cutoffTs = Date.now() - ttlDays * 24 * 60 * 60 * 1000
  db.prepare(`DELETE FROM messages WHERE ts < ?`).run(cutoffTs)

  // Per-chat cap: drop anything ranked worse than perChat by ts.
  db.exec(`
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY ts DESC) AS rn
        FROM messages
      ) ranked
      WHERE ranked.rn > ${perChat}
    );
  `)

  // File-size cap: if still too large, drop oldest 10% and VACUUM.
  try {
    if (dbPath && statSync(dbPath).size > maxBytes) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number }
      const drop = Math.max(1, Math.floor(row.n * 0.1))
      db.prepare(`DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY ts ASC LIMIT ?)`).run(drop)
      db.exec('VACUUM')
    }
  } catch {
    // statSync may race with VACUUM — tolerate.
  }
}
