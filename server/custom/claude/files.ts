// custom: read-only viewer of a Claude board's output files under its folder in iCloud Drive.
// Same rules as server/folders.ts (real path must stay inside the root, no hidden files, size
// caps), but every file-system call runs in a short-lived child process with a time limit (see
// probe.ts: macOS can hold iCloud reads indefinitely). The child gets the root and the relative
// path as argv entries, never as script text, and prints one JSON answer.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { redactLogLine } from '../../mission-control.js'

export const TEXT_LIMIT = 256 * 1024
export const BINARY_LIMIT = 20 * 1024 * 1024
export const LIST_LIMIT = 300
const INFO_TIMEOUT_MS = 5_000
const READ_TIMEOUT_MS = 15_000

export const TEXT_TYPES: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', json: 'application/json', py: 'text/x-python', csv: 'text/csv' }
/** Shown in the page. Never HTML or SVG (they could run code in Ruang's origin). */
export const INLINE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' }
export const DOWNLOAD_TYPES: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }

export class FileViewError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 413 | 503) { super(message) }
}

export interface DirEntry { name: string; path: string; type: 'dir' | 'file'; size: number }
export type FileView =
  | { path: string; kind: 'dir'; entries: DirEntry[]; truncated: boolean }
  | { path: string; kind: 'text'; ext: string; size: number; content: string; truncated: boolean; redactions: number }
  | { path: string; kind: 'inline' | 'download'; ext: string; size: number; mime: string }
  | { path: string; kind: 'other'; ext: string; size: number }
export interface PathState { path: string; state: 'file' | 'dir' | 'missing' | 'not-downloaded' | 'refused' | 'error' }

/** Normalises a browser path: relative, no `..`, no hidden part, no control characters. */
export function safeOutputPath(input: unknown): string {
  if (input === undefined || input === '' || input === '/') return ''
  if (typeof input !== 'string' || input.length > 1024 || /\p{Cc}/u.test(input)) throw new FileViewError('Invalid path.', 400)
  const normalized = path.posix.normalize(input.replace(/\\/g, '/')).replace(/^\/+/, '').replace(/\/+$/, '')
  if (normalized === '.') return ''
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..')) throw new FileViewError('Path escapes the output folder.', 403)
  if (parts.some((part) => part.startsWith('.'))) throw new FileViewError('Hidden files are not shown.', 403)
  return normalized
}

export const extensionOf = (file: string) => (/\.([A-Za-z0-9]{1,6})$/.exec(file)?.[1] ?? '').toLowerCase()

// The child: resolves the root and the target with realpath, refuses anything outside the root or
// hidden, and answers one of: stat (many paths), list (one folder), read (one file, base64).
const SCRIPT = String.raw`
const fs = require('node:fs'); const path = require('node:path')
const [op, root, arg, limitText] = process.argv.slice(1); const limit = Number(limitText)
const out = (value) => process.stdout.write(JSON.stringify(value))
const realRoot = fs.realpathSync(root)
const inside = (target) => { const rel = path.relative(realRoot, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).some((part) => part.startsWith('.'))) }
const notDownloaded = (full, info) => info.isFile() && info.size > 0 && info.blocks === 0
const placeholder = (full) => fs.existsSync(path.join(path.dirname(full), '.' + path.basename(full) + '.icloud'))
function locate(rel) {
  const full = path.join(realRoot, rel)
  let real
  try { real = fs.realpathSync(full) } catch (error) { return { state: error.code === 'ENOENT' && placeholder(full) ? 'not-downloaded' : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'missing' : 'error', code: error.code } }
  if (!inside(real)) return { state: 'refused' }
  const info = fs.statSync(real)
  return { state: info.isDirectory() ? 'dir' : notDownloaded(real, info) ? 'not-downloaded' : info.isFile() ? 'file' : 'refused', real, info }
}
try {
  if (op === 'stat') { out(JSON.parse(arg).map((rel) => ({ path: rel, state: locate(rel).state }))); return }
  const found = locate(arg)
  if (op === 'list') {
    if (found.state !== 'dir') { out({ state: found.state }); return }
    const entries = fs.readdirSync(found.real, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).map((entry) => {
      let type = entry.isDirectory() ? 'dir' : 'file'; let size = 0
      try { const info = fs.statSync(path.join(found.real, entry.name)); type = info.isDirectory() ? 'dir' : 'file'; size = info.isFile() ? info.size : 0 } catch {}
      return { name: entry.name, type, size }
    })
    out({ state: 'dir', entries }); return
  }
  if (found.state !== 'file') { out({ state: found.state }); return }
  if (found.info.size > limit && op === 'read-all') { out({ state: 'too-large', size: found.info.size }); return }
  const length = Math.min(found.info.size, limit)
  const buffer = Buffer.alloc(length); const handle = fs.openSync(found.real, 'r')
  try { fs.readSync(handle, buffer, 0, length, 0) } finally { fs.closeSync(handle) }
  out({ state: 'file', size: found.info.size, data: buffer.toString('base64') })
} catch (error) { out({ state: 'error', code: error && error.code || 'ERROR' }) }
`

type ChildAnswer = { state: string; code?: string; entries?: { name: string; type: 'dir' | 'file'; size: number }[]; size?: number; data?: string }
export type FileRunner = (args: string[], timeoutMs: number, maxBuffer: number) => Promise<unknown>

const runChild: FileRunner = (args, timeoutMs, maxBuffer) => new Promise((resolve) => {
  execFile(process.execPath, ['-e', `(() => {${SCRIPT}})()`, ...args], { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, windowsHide: true }, (error, stdout) => {
    if (error && (error as { killed?: boolean }).killed) { resolve({ state: 'timeout' }); return }
    try { resolve(JSON.parse(stdout)) } catch { resolve({ state: 'error', code: error ? 'CHILD_FAILED' : 'BAD_OUTPUT' }) }
  })
})

function failure(answer: ChildAnswer, shown: string): FileViewError {
  switch (answer.state) {
    case 'missing': return new FileViewError(`Not found (${shown}).`, 404)
    case 'not-downloaded': return new FileViewError(`File not downloaded on the Mac yet (${shown}). Open it once in Finder, or set the folder to "Keep Downloaded".`, 409)
    case 'refused': return new FileViewError('This path is outside the output folder or not a regular file.', 403)
    case 'too-large': return new FileViewError(`This file is too large to show here (${Math.round((answer.size ?? 0) / 1024 / 1024)} MB).`, 413)
    case 'timeout': return new FileViewError('Not Available: macOS or iCloud did not answer in time (the file may still be downloading). Try again in a moment.', 503)
    case 'error': return new FileViewError(answer.code === 'EPERM' || answer.code === 'EACCES' ? 'Not Available: macOS does not let Ruang read the iCloud folder.' : `Not Available: the file cannot be read (${answer.code ?? 'error'}).`, 503)
    default: return new FileViewError('Not Available: unexpected answer from the file reader.', 503)
  }
}

export class OutputFiles {
  constructor(private readonly run: FileRunner = runChild) {}

  /** Which output paths exist, in one child process. */
  async states(root: string, paths: string[]): Promise<PathState[]> {
    if (!paths.length) return []
    const safe = paths.map((item) => { try { return safeOutputPath(item) } catch { return undefined } })
    const answer = await this.run(['stat', root, JSON.stringify(safe.filter((item) => item !== undefined)), '0'], INFO_TIMEOUT_MS, 256 * 1024) as ChildAnswer | PathState[]
    const found = Array.isArray(answer) ? new Map(answer.map((item) => [item.path, item.state])) : undefined
    return paths.map((item, index) => ({ path: item, state: safe[index] === undefined ? 'refused' : found ? found.get(safe[index]!) ?? 'error' : 'error' }))
  }

  async view(root: string, input: unknown): Promise<FileView> {
    const rel = safeOutputPath(input)
    const shown = rel || 'output folder'
    const ext = extensionOf(rel)
    const listing = !rel || !ext
    if (listing) {
      const answer = await this.run(['list', root, rel, '0'], INFO_TIMEOUT_MS, 1024 * 1024) as ChildAnswer
      if (answer.state === 'dir') {
        const entries = (answer.entries ?? []).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
        return { path: rel, kind: 'dir', entries: entries.slice(0, LIST_LIMIT).map((entry) => ({ ...entry, path: rel ? `${rel}/${entry.name}` : entry.name })), truncated: entries.length > LIST_LIMIT }
      }
      if (answer.state !== 'file') throw failure(answer, shown)
    }
    if (TEXT_TYPES[ext]) {
      const answer = await this.run(['read', root, rel, String(TEXT_LIMIT)], READ_TIMEOUT_MS, TEXT_LIMIT * 2) as ChildAnswer
      if (answer.state === 'dir') return this.view(root, `${rel}/`)
      if (answer.state !== 'file') throw failure(answer, shown)
      let redactions = 0
      const content = Buffer.from(answer.data ?? '', 'base64').toString('utf8').split('\n').map((line) => {
        const redacted = redactLogLine(line, Number.POSITIVE_INFINITY)
        if (redacted !== line) redactions += 1
        return redacted
      }).join('\n')
      return { path: rel, kind: 'text', ext, size: answer.size ?? 0, content, truncated: (answer.size ?? 0) > TEXT_LIMIT, redactions }
    }
    // Reading 0 bytes reports whether the file is there (and downloaded) and its size.
    const answer = await this.run(['read', root, rel, '0'], INFO_TIMEOUT_MS, 64 * 1024) as ChildAnswer
    if (answer.state === 'dir') return this.view(root, `${rel}/`)
    if (answer.state !== 'file') throw failure(answer, shown)
    const size = answer.size ?? 0
    if (INLINE_TYPES[ext]) return { path: rel, kind: 'inline', ext, size, mime: INLINE_TYPES[ext] }
    if (DOWNLOAD_TYPES[ext]) return { path: rel, kind: 'download', ext, size, mime: DOWNLOAD_TYPES[ext] }
    return { path: rel, kind: 'other', ext, size }
  }

  /** The whole file, for inline images/PDFs and downloads only. */
  async raw(root: string, input: unknown): Promise<{ data: Buffer; mime: string; name: string; inline: boolean }> {
    const rel = safeOutputPath(input)
    const ext = extensionOf(rel)
    const mime = INLINE_TYPES[ext] ?? DOWNLOAD_TYPES[ext]
    if (!rel || !mime) throw new FileViewError('This file type is not served.', 403)
    const answer = await this.run(['read-all', root, rel, String(BINARY_LIMIT)], READ_TIMEOUT_MS, Math.ceil(BINARY_LIMIT * 1.4)) as ChildAnswer
    if (answer.state !== 'file') throw failure(answer, rel)
    return { data: Buffer.from(answer.data ?? '', 'base64'), mime, name: path.posix.basename(rel), inline: Boolean(INLINE_TYPES[ext]) }
  }
}
