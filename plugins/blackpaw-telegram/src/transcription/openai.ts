/**
 * OpenAI Whisper transcription. Reliable, ~2s latency. Model: whisper-1.
 */

import { readFileSync } from 'fs'
import { basename } from 'path'
import type { TranscribeInput } from './chain.ts'

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1'

export async function transcribeOpenAI(input: TranscribeInput): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY unset')

  const buf = readFileSync(input.path)
  const blob = new Blob([buf], { type: input.mime ?? 'audio/ogg' })

  const form = new FormData()
  form.set('file', blob, basename(input.path))
  form.set('model', MODEL)
  form.set('response_format', 'json')

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`openai http ${res.status}: ${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as { text?: string }
  if (typeof json.text !== 'string') throw new Error('openai: no text in response')
  return json.text
}
