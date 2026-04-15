/**
 * Scheduled reminders — SQLite-backed queue + in-process timers.
 *
 * Reminders survive MCP restarts (rows persist) but timers don't, so on
 * startup the runner re-arms future reminders and immediately fires any
 * that are overdue (marked fired_late so the caller can tell). Because
 * Claude Code spawns the MCP per session, "missed" reminders fire on
 * next launch rather than in the background — which is exactly the
 * non-daemon behavior the plan calls for.
 *
 * Schema is deliberately small — (id, chat_id, text, fire_at, kind,
 * interval_s, status) — with one status update on fire. Recurring
 * reminders reinsert the next instance at interval_s seconds.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export type ScheduleKind = 'once' | 'recurring'
export type ScheduleStatus = 'pending' | 'fired' | 'fired_late' | 'cancelled'

export type ScheduleRow = {
  id: number
  chat_id: string
  message_thread_id: string | null
  text: string
  fire_at: number
  kind: ScheduleKind
  interval_s: number | null
  status: ScheduleStatus
  created_at: number
}

let db: Database | null = null

export function openSchedule(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id           TEXT    NOT NULL,
      message_thread_id TEXT,
      text              TEXT    NOT NULL,
      fire_at           INTEGER NOT NULL,
      kind              TEXT    NOT NULL CHECK(kind IN ('once', 'recurring')),
      interval_s        INTEGER,
      status            TEXT    NOT NULL DEFAULT 'pending',
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_status_fire ON schedules(status, fire_at);
  `)
}

export function closeSchedule(): void {
  db?.close()
  db = null
}

export type CreateSchedule = {
  chat_id: string
  message_thread_id: string | null
  text: string
  fire_at: number
  kind: ScheduleKind
  interval_s: number | null
}

export function insertSchedule(row: CreateSchedule): number {
  if (!db) throw new Error('schedule store not open')
  const res = db
    .prepare(
      `INSERT INTO schedules (chat_id, message_thread_id, text, fire_at, kind, interval_s, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
       RETURNING id`,
    )
    .get(
      row.chat_id,
      row.message_thread_id,
      row.text,
      row.fire_at,
      row.kind,
      row.interval_s,
      Date.now(),
    ) as { id: number }
  return res.id
}

export function listPending(): ScheduleRow[] {
  if (!db) return []
  return db
    .prepare(
      `SELECT id, chat_id, message_thread_id, text, fire_at, kind, interval_s, status, created_at
       FROM schedules WHERE status = 'pending' ORDER BY fire_at ASC`,
    )
    .all() as ScheduleRow[]
}

export function listAll(chat_id?: string): ScheduleRow[] {
  if (!db) return []
  const q = chat_id
    ? db.prepare(
        `SELECT id, chat_id, message_thread_id, text, fire_at, kind, interval_s, status, created_at
         FROM schedules WHERE chat_id = ? ORDER BY fire_at ASC`,
      )
    : db.prepare(
        `SELECT id, chat_id, message_thread_id, text, fire_at, kind, interval_s, status, created_at
         FROM schedules ORDER BY fire_at ASC`,
      )
  return (chat_id ? q.all(chat_id) : q.all()) as ScheduleRow[]
}

export function markStatus(id: number, status: ScheduleStatus): void {
  if (!db) return
  db.prepare(`UPDATE schedules SET status = ? WHERE id = ?`).run(status, id)
}

export function cancelSchedule(id: number): boolean {
  if (!db) return false
  const res = db.prepare(`UPDATE schedules SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id)
  return res.changes > 0
}
