/**
 * Groq Whisper transcription. Fastest hosted provider (~800ms on short clips).
 * Model: whisper-large-v3. Accepts ogg/opus natively.
 */

import { readFileSync } from 'fs'
import { basename } from 'path'
import type { TranscribeInput } from './chain.ts'

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = process.env.GROQ_TRANSCRIBE_MODEL ?? 'whisper-large-v3'

export async function transcribeGroq(input: TranscribeInput): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY unset')

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
    throw new Error(`groq http ${res.status}: ${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as { text?: string }
  if (typeof json.text !== 'string') throw new Error('groq: no text in response')
  return json.text
}
