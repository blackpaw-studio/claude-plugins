/**
 * Deepgram Nova transcription. Solid quality, ~1s latency.
 * Uses prerecorded API with smart formatting on.
 */

import { readFileSync } from 'fs'
import type { TranscribeInput } from './chain.ts'

const ENDPOINT = 'https://api.deepgram.com/v1/listen'
const MODEL = process.env.DEEPGRAM_TRANSCRIBE_MODEL ?? 'nova-3'

export async function transcribeDeepgram(input: TranscribeInput): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error('DEEPGRAM_API_KEY unset')

  const buf = readFileSync(input.path)
  const qs = new URLSearchParams({ model: MODEL, smart_format: 'true', punctuate: 'true' })

  const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': input.mime ?? 'audio/ogg',
    },
    body: buf,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`deepgram http ${res.status}: ${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript
  if (typeof text !== 'string') throw new Error('deepgram: no transcript in response')
  return text
}
