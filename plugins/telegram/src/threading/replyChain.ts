/**
 * Reply-chain walker.
 *
 * When an inbound message replies to another message, walk up the chain
 * using the history store and return a list of prior messages (oldest
 * first) up to TELEGRAM_THREAD_DEPTH (default 3). This gives Claude
 * enough surrounding context to answer threaded questions without
 * requiring an external memory.
 *
 * Telegram's inbound payload carries exactly one level (reply_to_message);
 * levels 2+ have to come from history. If the original message pre-dates
 * the plugin install, we stop silently at the first missing link.
 */

import { findByMessageId } from '../history/store.ts'
import type { HistoryEntry } from '../history/store.ts'

const DEFAULT_DEPTH = 3

function depth(): number {
  const raw = process.env.TELEGRAM_THREAD_DEPTH
  if (!raw) return DEFAULT_DEPTH
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : DEFAULT_DEPTH
}

export type ChainLink = {
  message_id: string
  direction: HistoryEntry['direction']
  sender_name: string | null
  text: string
  ts: number
}

export function walkReplyChain(
  chat_id: string,
  seedMessageId: string | null,
): ChainLink[] {
  if (!seedMessageId) return []
  const out: ChainLink[] = []
  const limit = depth()
  let current: string | null = seedMessageId

  while (current && out.length < limit) {
    const row = findByMessageId(chat_id, current)
    if (!row) break
    out.push({
      message_id: row.message_id ?? current,
      direction: row.direction,
      sender_name: row.sender_name,
      text: row.text,
      ts: row.ts,
    })
    // Telegram only includes one level of reply_to — deeper walks would
    // need a self-reference, which we don't store. Stop here.
    current = null
  }

  return out.reverse() // oldest first
}

export function renderChain(links: ChainLink[]): string {
  if (links.length === 0) return ''
  const parts = links.map(link => {
    const who = link.direction === 'out' ? 'assistant' : (link.sender_name ?? 'user')
    return `[${who}] ${link.text}`
  })
  return `[reply chain]\n${parts.join('\n')}`
}
