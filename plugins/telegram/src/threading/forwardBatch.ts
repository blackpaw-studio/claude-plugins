/**
 * Forward-burst detector.
 *
 * Users sometimes dump a stack of forwarded messages (articles, receipts,
 * screenshots) in quick succession. Delivering each as a separate <channel>
 * event floods the session. Instead, buffer forwards per chat and emit a
 * single summary event after the burst settles.
 *
 * Thresholds (env-tunable):
 *  - TELEGRAM_FORWARD_MIN        minimum forwards to trigger batching (default 20)
 *  - TELEGRAM_FORWARD_WINDOW_MS  quiet-period before flushing (default 2000 ms)
 *
 * Callers push a (chat_id, text, meta) on every forward. The batcher
 * fires the onFlush callback when the window closes.
 */

export type BatchedForward = {
  text: string
  sender_name?: string
  ts: number
}

export type BatchFlush = (chat_id: string, entries: BatchedForward[]) => void

type Buffer = {
  entries: BatchedForward[]
  timer: Timer | null
}

const DEFAULT_MIN = 20
const DEFAULT_WINDOW = 2000

function getMin(): number {
  const raw = process.env.TELEGRAM_FORWARD_MIN
  if (!raw) return DEFAULT_MIN
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN
}

function getWindow(): number {
  const raw = process.env.TELEGRAM_FORWARD_WINDOW_MS
  if (!raw) return DEFAULT_WINDOW
  const n = Number(raw)
  return Number.isFinite(n) && n >= 200 ? n : DEFAULT_WINDOW
}

export class ForwardBatcher {
  private readonly buffers = new Map<string, Buffer>()
  constructor(private readonly onFlush: BatchFlush) {}

  /**
   * Returns true when the caller should drop the individual event (because
   * it has been buffered), false when the forward should deliver normally
   * (the buffer hasn't reached threshold yet or batching is disabled).
   *
   * Buffering always starts; once threshold is hit, subsequent forwards in
   * the same burst are also buffered (so the consumer drops them). The
   * final flush emits everything collected.
   */
  push(chat_id: string, entry: BatchedForward): boolean {
    const min = getMin()
    if (min <= 1) return false

    const buf = this.buffers.get(chat_id) ?? { entries: [], timer: null }
    buf.entries.push(entry)

    if (buf.timer) clearTimeout(buf.timer)
    buf.timer = setTimeout(() => this.flush(chat_id), getWindow())

    this.buffers.set(chat_id, buf)
    return buf.entries.length >= min
  }

  private flush(chat_id: string): void {
    const buf = this.buffers.get(chat_id)
    if (!buf) return
    this.buffers.delete(chat_id)
    if (buf.timer) clearTimeout(buf.timer)
    if (buf.entries.length >= getMin()) {
      this.onFlush(chat_id, buf.entries)
    }
    // Bursts that never hit the threshold were already delivered individually
    // (push returned false on each); no replay needed.
  }
}

export function summarizeBatch(entries: BatchedForward[]): string {
  const count = entries.length
  const preview = entries
    .slice(0, 5)
    .map((e, i) => `${i + 1}. ${e.text.slice(0, 120)}${e.text.length > 120 ? '…' : ''}`)
    .join('\n')
  return `[forward batch: ${count} messages]\n${preview}${count > 5 ? `\n… +${count - 5} more` : ''}`
}
