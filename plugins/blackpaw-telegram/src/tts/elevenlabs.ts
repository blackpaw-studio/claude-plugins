/**
 * ElevenLabs TTS for the voice_reply tool.
 *
 * Converts text to speech with ElevenLabs, writes the resulting mp3 to
 * STATE_DIR/inbox, and returns the local path. The server then uploads
 * it via grammy sendAudio (Telegram renders a play-button bubble with
 * scrubbing).
 *
 * True voice-note bubbles require OGG/Opus which needs ffmpeg; we avoid
 * that dep and settle for the audio bubble — close enough UX. The
 * feature silently disables when ELEVENLABS_API_KEY is absent.
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM' // ElevenLabs built-in "Rachel"
const DEFAULT_MODEL = 'eleven_multilingual_v2'

export type TtsInput = {
  text: string
  outDir: string
}

export type TtsResult = {
  path: string
  bytes: number
  voice_id: string
  model_id: string
}

export function isTtsAvailable(): boolean {
  return !!process.env.ELEVENLABS_API_KEY
}

export async function synthesize(input: TtsInput): Promise<TtsResult> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY unset')

  const voice_id = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE
  const model_id = process.env.ELEVENLABS_MODEL ?? DEFAULT_MODEL

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text: input.text, model_id }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`elevenlabs http ${res.status}: ${detail.slice(0, 200)}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(input.outDir, { recursive: true })
  const path = join(input.outDir, `tts-${Date.now()}.mp3`)
  writeFileSync(path, buf)
  return { path, bytes: buf.byteLength, voice_id, model_id }
}
