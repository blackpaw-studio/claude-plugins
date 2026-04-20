/**
 * Local whisper.cpp fallback via `whisper-cli`.
 *
 * Offline, private, slow on CPU (8-15s for a 30s clip). Runs only if
 *  - TELEGRAM_WHISPER_CLI_PATH binary exists (default: "whisper-cli")
 *  - TELEGRAM_WHISPER_MODEL points at a .bin model (e.g. ggml-small.en.bin)
 *
 * Telegram voice notes are opus/ogg — whisper-cli needs ffmpeg in PATH to
 * decode them. When ffmpeg is missing, the call fails and chain.ts moves on.
 */

import { spawn } from 'child_process'
import type { TranscribeInput } from './chain.ts'

const CLI = process.env.TELEGRAM_WHISPER_CLI_PATH ?? 'whisper-cli'
const MODEL = process.env.TELEGRAM_WHISPER_MODEL
const LANG = process.env.TELEGRAM_WHISPER_LANG ?? 'auto'

export async function transcribeWhisperCli(input: TranscribeInput): Promise<string> {
  if (!MODEL) throw new Error('TELEGRAM_WHISPER_MODEL unset')

  return await new Promise<string>((resolve, reject) => {
    const args = ['-m', MODEL, '-f', input.path, '-l', LANG, '-nt', '--no-prints']
    const child = spawn(CLI, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })

    child.on('error', err => reject(new Error(`whisper-cli spawn: ${err.message}`)))
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exit ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      // whisper-cli prints [timestamp] TEXT lines by default; `--no-prints` strips
      // progress noise but transcript still prints to stdout.
      const cleaned = stdout
        .split('\n')
        .map(l => l.replace(/^\[[^\]]+\]\s*/, ''))
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
      resolve(cleaned)
    })
  })
}
