/**
 * Schedule runner — arms timers for pending reminders, fires them, and
 * re-arms recurring ones. On startup, any reminder whose fire_at is in
 * the past fires immediately with status `fired_late` so the caller
 * knows it was missed. Stays in process (no daemon).
 */

import {
  insertSchedule,
  listPending,
  markStatus,
  type ScheduleRow,
} from './store.ts'

export type FireCallback = (row: ScheduleRow, late: boolean) => void

const timers = new Map<number, Timer>()
let fireCb: FireCallback | null = null

function armTimer(row: ScheduleRow): void {
  if (!fireCb) return
  const delay = Math.max(0, row.fire_at - Date.now())

  // Cap timer at ~24 days to stay within setTimeout's 32-bit bounds.
  // A daily re-arm loop handles longer horizons.
  const MAX_DELAY = 2_000_000_000
  if (delay > MAX_DELAY) {
    const timer = setTimeout(() => armTimer(row), MAX_DELAY)
    timer.unref()
    timers.set(row.id, timer)
    return
  }

  const timer = setTimeout(() => {
    timers.delete(row.id)
    fire(row, false)
  }, delay)
  timer.unref()
  timers.set(row.id, timer)
}

function fire(row: ScheduleRow, late: boolean): void {
  if (!fireCb) return
  try {
    fireCb(row, late)
  } catch (err) {
    process.stderr.write(`telegram channel: schedule fire hook threw: ${err}\n`)
  }
  markStatus(row.id, late ? 'fired_late' : 'fired')
  if (row.kind === 'recurring' && row.interval_s && row.interval_s > 0) {
    const nextId = insertSchedule({
      chat_id: row.chat_id,
      message_thread_id: row.message_thread_id,
      text: row.text,
      fire_at: Date.now() + row.interval_s * 1000,
      kind: 'recurring',
      interval_s: row.interval_s,
    })
    const next = { ...row, id: nextId, fire_at: Date.now() + row.interval_s * 1000, status: 'pending' as const }
    armTimer(next)
  }
}

export function startScheduler(cb: FireCallback): void {
  fireCb = cb
  for (const row of listPending()) {
    if (row.fire_at <= Date.now()) {
      fire(row, true)
    } else {
      armTimer(row)
    }
  }
}

export function armNewSchedule(row: ScheduleRow): void {
  armTimer(row)
}

export function stopScheduler(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  fireCb = null
}
