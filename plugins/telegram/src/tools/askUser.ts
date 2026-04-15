/**
 * ask_user tool.
 *
 * Claude calls this when it needs a human decision. The plugin posts a
 * Telegram message with an inline keyboard; the user taps a button; the
 * tool call resolves with their choice. The bot answers the callback so
 * Telegram retires the spinner, and we edit the message to replace the
 * buttons with the chosen label.
 *
 * Correlation is a short nonce baked into the callback_data. First tap
 * wins — if the user taps twice, the second callback matches no pending
 * promise and is silently acknowledged.
 *
 * Timeouts default to 300 s (5 min). Callers can override via the `timeout_s`
 * input. Expired requests resolve with a synthetic "timeout" choice so
 * Claude's flow doesn't hang forever.
 */

import { randomBytes } from 'crypto'
import { InlineKeyboard } from 'grammy'
import type { Bot } from 'grammy'

type PendingAsk = {
  resolve: (choice: { value: string; label: string; timedOut: boolean }) => void
  labels: Record<string, string>
  expiresAt: number
  timer: Timer
  chatId: string
  messageId: number
}

const pending = new Map<string, PendingAsk>()

export function startAskUser(bot: Bot): void {
  // Callback payload: ask:<id>:<index>. Index points into labels/values.
  bot.on('callback_query:data', async ctx => {
    const data = ctx.callbackQuery.data
    const m = /^ask:([a-z0-9]{6}):(\d+)$/.exec(data)
    if (!m) return // Not our callback — grammy dispatches to other handlers.
    const [, id, idxStr] = m
    const entry = pending.get(id)
    if (!entry) {
      await ctx.answerCallbackQuery({ text: 'Choice already recorded or expired.' }).catch(() => {})
      return
    }
    const idx = Number(idxStr)
    const values = Object.keys(entry.labels)
    const value = values[idx]
    if (value == null) {
      await ctx.answerCallbackQuery({ text: 'Unknown choice.' }).catch(() => {})
      return
    }
    const label = entry.labels[value]!
    clearTimeout(entry.timer)
    pending.delete(id)
    entry.resolve({ value, label, timedOut: false })
    await ctx.answerCallbackQuery({ text: `Chose ${label}` }).catch(() => {})
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {})
  })
}

export type AskUserInput = {
  chat_id: string
  question: string
  choices: string[]
  message_thread_id?: number
  timeout_s?: number
}

export type AskUserOutput = {
  value: string
  label: string
  timed_out: boolean
  asked_message_id: number
}

export async function askUser(bot: Bot, input: AskUserInput): Promise<AskUserOutput> {
  const choices = input.choices.filter(c => typeof c === 'string' && c.trim())
  if (choices.length === 0) throw new Error('ask_user: choices must be a non-empty array of strings')
  if (choices.length > 12) throw new Error('ask_user: max 12 choices (Telegram button limit)')

  const id = randomBytes(3).toString('hex')
  const labels: Record<string, string> = Object.fromEntries(choices.map(c => [c, c]))
  const keyboard = new InlineKeyboard()
  choices.forEach((choice, idx) => {
    keyboard.text(choice, `ask:${id}:${idx}`)
    // Layout 2 per row for readability.
    if ((idx + 1) % 2 === 0 && idx + 1 < choices.length) keyboard.row()
  })

  const sent = await bot.api.sendMessage(input.chat_id, input.question, {
    reply_markup: keyboard,
    ...(input.message_thread_id != null ? { message_thread_id: input.message_thread_id } : {}),
  })

  const timeoutS = Math.min(Math.max(input.timeout_s ?? 300, 5), 3600)

  return await new Promise<AskUserOutput>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id)
      // Strip buttons so the user can't tap a stale prompt.
      void bot.api
        .editMessageReplyMarkup(input.chat_id, sent.message_id, { reply_markup: undefined })
        .catch(() => {})
      resolve({ value: '', label: '(timeout)', timed_out: true, asked_message_id: sent.message_id })
    }, timeoutS * 1000)

    pending.set(id, {
      resolve: ({ value, label, timedOut }) =>
        resolve({ value, label, timed_out: timedOut, asked_message_id: sent.message_id }),
      labels,
      expiresAt: Date.now() + timeoutS * 1000,
      timer,
      chatId: input.chat_id,
      messageId: sent.message_id,
    })
  })
}
