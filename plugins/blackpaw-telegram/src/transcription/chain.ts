/**
 * Voice transcription provider chain.
 *
 * Tries providers in order (env TELEGRAM_TRANSCRIBE_ORDER). First success
 * wins. A provider is "available" when its API key / binary is present;
 * unavailable providers are silently skipped. Returns undefined if every
 * provider fails or none are available.
 *
 * Order defaults to hosted-first for latency (Groq → Deepgram → OpenAI →
 * local whisper-cli). Local is last because CPU whisper on a 30s clip
 * takes 8-15s vs. ~1s for hosted providers.
 */

import { transcribeGroq } from './groq.ts'
import { transcribeDeepgram } from './deepgram.ts'
import { transcribeOpenAI } from './openai.ts'
import { transcribeWhisperCli } from './whisper-cli.ts'

export type TranscribeInput = {
  path: string
  mime?: string
}

export type TranscribeResult = {
  text: string
  provider: 'groq' | 'deepgram' | 'openai' | 'local'
  latencyMs: number
}

type Provider = TranscribeResult['provider']
type ProviderFn = (input: TranscribeInput) => Promise<string>

const PROVIDERS: Record<Provider, { available: () => boolean; run: ProviderFn }> = {
  groq: {
    available: () => !!process.env.GROQ_API_KEY,
    run: transcribeGroq,
  },
  deepgram: {
    available: () => !!process.env.DEEPGRAM_API_KEY,
    run: transcribeDeepgram,
  },
  openai: {
    available: () => !!process.env.OPENAI_API_KEY,
    run: transcribeOpenAI,
  },
  local: {
    available: () => true, // whisper-cli spawn will fail gracefully if absent
    run: transcribeWhisperCli,
  },
}

function parseOrder(raw: string | undefined): Provider[] {
  const defaults: Provider[] = ['groq', 'deepgram', 'openai', 'local']
  if (!raw) return defaults
  const out: Provider[] = []
  for (const token of raw.split(',').map(s => s.trim().toLowerCase())) {
    if (token === 'groq' || token === 'deepgram' || token === 'openai' || token === 'local') {
      if (!out.includes(token)) out.push(token)
    }
  }
  return out.length > 0 ? out : defaults
}

export function isTranscriptionAvailable(): boolean {
  const order = parseOrder(process.env.TELEGRAM_TRANSCRIBE_ORDER)
  return order.some(p => PROVIDERS[p].available())
}

export async function transcribe(input: TranscribeInput): Promise<TranscribeResult | undefined> {
  const order = parseOrder(process.env.TELEGRAM_TRANSCRIBE_ORDER)
  const errors: string[] = []

  for (const name of order) {
    const provider = PROVIDERS[name]
    if (!provider.available()) continue

    const started = Date.now()
    try {
      const text = await provider.run(input)
      const trimmed = text.trim()
      if (!trimmed) {
        errors.push(`${name}: empty transcription`)
        continue
      }
      return { text: trimmed, provider: name, latencyMs: Date.now() - started }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${name}: ${msg}`)
      // fall through to next provider
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`telegram channel: transcription failed: ${errors.join('; ')}\n`)
  }
  return undefined
}
