/**
 * Document text extraction.
 *
 * Given a local file path + mime/name, dispatch to the right extractor and
 * return plain text. Caps at TELEGRAM_DOC_MAX_BYTES (default 10MB) — larger
 * files return undefined so the caller falls back to attachment-only
 * delivery (user can still download_attachment manually).
 *
 * Extractor deps (pdf-parse, mammoth) are loaded lazily so a missing dep
 * only breaks that format, not the whole plugin.
 */

import { readFileSync, statSync } from 'fs'
import { extname } from 'path'

export type ExtractInput = {
  path: string
  name?: string
  mime?: string
}

export type ExtractResult = {
  text: string
  format: 'pdf' | 'docx' | 'csv' | 'txt' | 'json'
  bytes: number
}

const DEFAULT_LIMIT = 10 * 1024 * 1024 // 10MB

function limitBytes(): number {
  const raw = process.env.TELEGRAM_DOC_MAX_BYTES
  if (!raw) return DEFAULT_LIMIT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT
}

function classify(input: ExtractInput): ExtractResult['format'] | undefined {
  const ext = extname(input.name ?? input.path).toLowerCase().replace(/^\./, '')
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'csv') return 'csv'
  if (ext === 'txt' || ext === 'md' || ext === 'log') return 'txt'
  if (ext === 'json') return 'json'

  const m = (input.mime ?? '').toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (m === 'text/csv') return 'csv'
  if (m === 'application/json') return 'json'
  if (m.startsWith('text/')) return 'txt'
  return undefined
}

export async function extractDocument(input: ExtractInput): Promise<ExtractResult | undefined> {
  const fmt = classify(input)
  if (!fmt) return undefined

  const st = statSync(input.path)
  if (st.size > limitBytes()) return undefined

  try {
    switch (fmt) {
      case 'pdf': {
        const mod = (await import('pdf-parse')) as unknown as {
          default?: (buf: Buffer) => Promise<{ text: string }>
        }
        const pdfParse = typeof mod === 'function'
          ? (mod as unknown as (buf: Buffer) => Promise<{ text: string }>)
          : mod.default
        if (!pdfParse) throw new Error('pdf-parse export shape unexpected')
        const buf = readFileSync(input.path)
        const parsed = await pdfParse(buf)
        return { text: parsed.text, format: fmt, bytes: st.size }
      }
      case 'docx': {
        const mammoth = await import('mammoth')
        const parsed = await mammoth.extractRawText({ path: input.path })
        return { text: parsed.value, format: fmt, bytes: st.size }
      }
      case 'csv':
      case 'txt':
      case 'json': {
        return { text: readFileSync(input.path, 'utf8'), format: fmt, bytes: st.size }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`telegram channel: document extract failed (${fmt}): ${msg}\n`)
    return undefined
  }
}

/**
 * Truncate extracted text to a sane limit before injecting into the channel
 * notification. The <channel> tag body has no hard cap but tokens are real —
 * default to 20 000 chars and note the truncation inline.
 */
export function clampExtracted(text: string, max = 20_000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[... truncated: showed ${max} of ${text.length} characters ...]`
}
