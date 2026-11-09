// custom: the ONLY writes Ruang makes to a Claude board's Google Sheet: the owner's comment
// (appended to the owner-notes cell, never overwritten) and, optionally, a new status from the
// config's allowed list (plus Updated = today on task-flow boards). Same flow as the Hermes
// actions (../actions.ts): preview (validate against a fresh read, build the exact cells, hand out
// a single-use token) → the owner confirms → execute (re-read, refuse if anything changed, write
// exactly those cells, read them back). Never rows: no insert, delete, sort or move.
import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { accessConfigDir } from '../../access.js'
import { recordCommand } from '../../mission-control.js'
import { MAX_PER_DAY, MAX_PER_MINUTE, TOKEN_TTL_MS } from '../actions.js'
import { cleanText, LIMITS, params, ValidationError } from '../validate.js'
import { cellOf, columnOf, knownStatuses, rowKeyText, statusKey, type BoardRead, type BoardRow } from './board.js'
import type { BoardConfig, ColumnSpec } from './config.js'
import { a1, SheetsError, type SheetsApi } from './sheets.js'

export const CLAUDE_ACTIONS = ['claude.note', 'claude.status'] as const
export type ClaudeAction = typeof CLAUDE_ACTIONS[number]
/** A Google Sheets cell holds at most 50,000 characters. */
export const CELL_LIMIT = 50_000
export const CELL_WARN = 40_000
export const CHANGED = 'This task changed since you opened it. Reload.'

export class ClaudeActionError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export interface Cell { key: string; header: string; cell: string; range: string; from: string; to: string }
export interface ClaudePlan { action: ClaudeAction; board: BoardConfig; row: number; key: string; summary: string[]; cells: Cell[]; status?: { from: string; to: string }; commentLength: number }
export interface WriteContext { read: BoardRead; ownerName: string; today: string; liveWrites: boolean }

export const notesHash = (value: string) => createHash('sha256').update(value).digest('hex')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

/** The statuses the owner may set from the current one (config `ganiCanSetStatus`), as the config spells them. */
export function allowedStatuses(board: BoardConfig, current: string): string[] {
  const key = statusKey(current, knownStatuses(board))
  if (board.neverTouchStatus.some((status) => status.toLowerCase() === key)) return []
  const rule = board.ganiCanSetStatus
  const options = Array.isArray(rule) ? rule : Object.entries(rule).find(([from]) => from.toLowerCase() === key)?.[1] ?? []
  return options.filter((status) => status.toLowerCase() !== key)
}

const writable = (board: BoardConfig, column: ColumnSpec | undefined) => Boolean(column && column.role !== 'readonly' && board.writableColumns.includes(column.key))

/** Whether the owner can write this row at all, and why not. Used for the detail panel too. */
export function rowWriteState(board: BoardConfig, read: Pick<BoardRead, 'availability' | 'readOnly'>, row: BoardRow | undefined, liveWrites: boolean): { allowed: boolean; reason?: string; statuses: string[]; comments: boolean } {
  const notes = columnOf(board, 'ganiNotes')
  const status = columnOf(board, 'status')
  const statuses = row && writable(board, status) ? allowedStatuses(board, cellOf(board, row, 'status')) : []
  const comments = writable(board, notes)
  const refuse = (reason: string) => ({ allowed: false, reason, statuses: [], comments: false })
  if (!board.testCopyOf && !liveWrites) return refuse('Writes to live boards are off for now: only the test copy can be changed. The owner turns them on in the private config ("liveWrites": true).')
  if (read.availability !== 'available') return refuse('The board cannot be read right now, so nothing can be written.')
  if (read.readOnly) return refuse(read.readOnly)
  if (!row) return refuse(CHANGED)
  const current = statusKey(cellOf(board, row, 'status'), knownStatuses(board))
  if (board.neverTouchStatus.some((item) => item.toLowerCase() === current)) return refuse(`This row is "${cellOf(board, row, 'status')}": Ruang never changes it.`)
  if (!comments && !statuses.length) return refuse('The config allows no writes on this row (no writable notes column and no status the owner may set).')
  return { allowed: true, statuses, comments }
}

interface Answer { n: number; text: string }

function answersInput(value: unknown): Answer[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 30) throw new ValidationError('Answers must be a list of at most 30 items.')
  return value.flatMap((item, index) => {
    const raw = params(item, ['n', 'text'])
    if (!Number.isInteger(raw.n) || (raw.n as number) < 1 || (raw.n as number) > 99) throw new ValidationError(`Answer ${index + 1}: invalid question number.`)
    const text = cleanText(raw.text, `Answer to Q${String(raw.n)}`, { max: LIMITS.comment, multiline: true, optional: true })
    return text ? [{ n: raw.n as number, text }] : []
  })
}

/**
 * The block appended to the owner-notes cell:
 *   <Owner> (YYYY-MM-DD):
 *   - Q1: <answer>
 *   - <comment line>
 * Empty answers are left out; every comment line becomes a bullet; continuation lines of a
 * multi-line answer are indented.
 */
export function noteBlock(ownerName: string, today: string, answers: readonly Answer[], comment: string | undefined): string | undefined {
  const bullet = (text: string) => text.replace(/^\s*(?:[-*•]\s+)/, '')
  const lines = [
    ...answers.map((answer) => { const [first, ...rest] = answer.text.split('\n').map((line) => line.trim()).filter(Boolean); return [`- Q${answer.n}: ${first}`, ...rest.map((line) => `  ${line}`)].join('\n') }),
    ...(comment ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => `- ${bullet(line)}`),
  ]
  return lines.length ? [`${ownerName} (${today}):`, ...lines].join('\n') : undefined
}

/** Appends with one blank line between the earlier text and the new block. */
export const appendNotes = (existing: string, block: string) => (existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${block}` : block)

const cellOfColumn = (board: BoardConfig, column: ColumnSpec, row: number, from: string, to: string): Cell => ({ key: column.key, header: column.header, cell: `${column.col}${row}`, range: a1(board.tab, `${column.col}${row}`), from, to })

/** Validates one request against the board as read now and builds the exact cells. Throws ValidationError / ClaudeActionError. */
export function planClaude(action: unknown, raw: unknown, context: WriteContext): ClaudePlan {
  if (!CLAUDE_ACTIONS.includes(action as ClaudeAction)) throw new ValidationError('Unknown action.')
  const input = params(raw, ['board', 'row', 'key', 'seen', 'answers', 'comment', 'status'])
  const { read } = context
  const { board } = read
  if (input.board !== board.id) throw new ValidationError('Unknown board.')
  if (!Number.isInteger(input.row) || (input.row as number) < 2 || (input.row as number) > 99_999) throw new ValidationError('Invalid row.')
  const rowNumber = input.row as number
  const seen = params(input.seen, ['status', 'notes'])
  if (typeof input.key !== 'string' || typeof seen.status !== 'string' || typeof seen.notes !== 'string' || !/^[0-9a-f]{64}$/.test(seen.notes)) throw new ValidationError('Missing what you saw (row key, status, notes). Reload.')
  const row = read.rows.find((item) => item.row === rowNumber)
  const state = rowWriteState(board, read, row, context.liveWrites)
  if (!state.allowed) throw new ClaudeActionError(state.reason!, state.reason === CHANGED ? 409 : 403)
  // The row must still be the one the owner opened, unchanged where it matters.
  const notesColumn = columnOf(board, 'ganiNotes')
  const currentNotes = notesColumn ? row!.cells[notesColumn.key] ?? '' : ''
  const currentStatus = cellOf(board, row!, 'status')
  if (rowKeyText(board, row!) !== input.key || currentStatus !== seen.status || notesHash(currentNotes) !== seen.notes) throw new ClaudeActionError(CHANGED, 409)

  const answers = answersInput(input.answers)
  const comment = cleanText(input.comment, 'Comment', { max: LIMITS.comment, multiline: true, optional: true })
  const block = noteBlock(context.ownerName, context.today, answers, comment)
  if (block && block.length > LIMITS.comment + 200) throw new ValidationError(`Your comment and answers are ${block.length.toLocaleString('en-US')} characters; at most ${LIMITS.comment.toLocaleString('en-US')}. Nothing is cut off: shorten them.`)
  const cells: Cell[] = []
  const summary: string[] = []
  if (block) {
    if (!state.comments || !notesColumn) throw new ClaudeActionError(`The config does not allow writing ${notesColumn?.header ?? 'notes'} on this board.`, 403)
    const next = appendNotes(currentNotes, block)
    if (next.length > CELL_LIMIT) throw new ClaudeActionError(`The ${notesColumn.header} cell would reach ${next.length.toLocaleString('en-US')} characters; Google Sheets holds at most ${CELL_LIMIT.toLocaleString('en-US')} per cell. Nothing was written.`, 409)
    cells.push(cellOfColumn(board, notesColumn, rowNumber, currentNotes, next))
    summary.push(`Append your note (${block.split('\n').length - 1} line${block.split('\n').length === 2 ? '' : 's'}) to ${notesColumn.header}${currentNotes.trim() ? ', after the earlier text' : ''}.`)
    if (next.length > CELL_WARN) summary.push(`Warning: ${notesColumn.header} will hold ${next.length.toLocaleString('en-US')} characters; a cell holds at most ${CELL_LIMIT.toLocaleString('en-US')}.`)
  }
  let status: ClaudePlan['status']
  if (action === 'claude.status') {
    const wanted = typeof input.status === 'string' ? state.statuses.find((item) => item.toLowerCase() === (input.status as string).trim().toLowerCase()) : undefined
    if (!wanted) throw new ClaudeActionError(`"${String(input.status ?? '')}" is not a status you can set from "${currentStatus}"${state.statuses.length ? ` (allowed: ${state.statuses.join(', ')})` : ''}.`, 403)
    const statusColumn = columnOf(board, 'status')!
    cells.push(cellOfColumn(board, statusColumn, rowNumber, currentStatus, wanted))
    status = { from: currentStatus, to: wanted }
    summary.push(`Set ${statusColumn.header} from "${currentStatus}" to "${wanted}".`)
    const updated = columnOf(board, 'updated')
    if (board.kind === 'taskflow' && updated) {
      if (writable(board, updated)) { cells.push(cellOfColumn(board, updated, rowNumber, row!.cells[updated.key] ?? '', context.today)); summary.push(`Set ${updated.header} to ${context.today}.`) }
      else summary.push(`${updated.header} is not writable in the config, so it is left as is.`)
    }
  } else if (input.status !== undefined) throw new ValidationError('A comment-only save cannot change the status.')
  if (!cells.length) throw new ValidationError('Write a comment or an answer first.')
  // Last line of defence: only configured writable columns, never a read-only one.
  for (const cell of cells) {
    const column = board.columns.find((item) => item.key === cell.key)
    if (!writable(board, column)) throw new ClaudeActionError(`Column ${column?.col ?? cell.key} is not writable.`, 403)
  }
  return { action: action as ClaudeAction, board, row: rowNumber, key: rowKeyText(board, row!), summary, cells, ...(status ? { status } : {}), commentLength: block?.length ?? 0 }
}

/** What the confirmation dialog shows: each cell, its column and exactly what goes in. */
export function shownCells(plan: ClaudePlan) {
  return plan.cells.map((cell) => {
    const appended = cell.to.startsWith(cell.from.replace(/\s+$/, '')) && cell.from.trim() && cell.key === columnOf(plan.board, 'ganiNotes')?.key
    return { cell: cell.cell, header: cell.header, ...(appended ? { append: cell.to.slice(cell.from.replace(/\s+$/, '').length).replace(/^\n+/, ''), keeps: cell.from.trim().length } : { from: cell.from, to: cell.to }) }
  })
}

export interface ClaudeResult { ok: boolean; action: ClaudeAction; board: string; row: number; cells: string[]; verified?: boolean; error?: string; uncertain?: boolean }
interface Pending { action: ClaudeAction; raw: unknown; board: string; session: string; expires: number; cells: string }

export class ClaudeWrites {
  private tokens = new Map<string, Pending>()
  private recent: number[] = []
  private busy = false

  constructor(private readonly options: { auditPath?: string; now?: () => number } = {}) {}

  get auditPath(): string { return this.options.auditPath ?? join(accessConfigDir(), 'write-audit.jsonl') }
  private now(): number { return this.options.now?.() ?? Date.now() }

  preview(action: unknown, raw: unknown, context: WriteContext, session: string) {
    const built = planClaude(action, raw, context)
    const now = this.now()
    for (const [key, item] of this.tokens) if (item.expires <= now) this.tokens.delete(key)
    if (this.tokens.size > 200) this.tokens.clear()
    const token = randomBytes(16).toString('hex')
    const expires = now + TOKEN_TTL_MS
    this.tokens.set(token, { action: built.action, raw, board: built.board.id, session: sha(session), expires, cells: JSON.stringify(built.cells.map((cell) => [cell.range, cell.to])) })
    return { token, action: built.action, board: built.board.id, testCopy: Boolean(built.board.testCopyOf), boardTitle: built.board.title, tab: built.board.tab, row: built.row, key: built.key, summary: built.summary, cells: shownCells(built), expiresAt: new Date(expires).toISOString() }
  }

  /** The board a token is for, so the route can read exactly that board fresh. */
  boardOf(token: unknown): string | undefined {
    return typeof token === 'string' ? this.tokens.get(token)?.board : undefined
  }

  async execute(token: unknown, session: string, fresh: () => Promise<{ context: WriteContext; sheets: SheetsApi }>): Promise<ClaudeResult> {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) throw new ValidationError('Missing confirmation token.')
    const pending = this.tokens.get(token)
    this.tokens.delete(token)
    const now = this.now()
    if (!pending || pending.session !== sha(session)) throw new ClaudeActionError('This confirmation is not valid (already used, or from another session). Start again.', 409)
    if (pending.expires <= now) throw new ClaudeActionError('This confirmation expired. Start again.', 409)
    this.recent = this.recent.filter((time) => now - time < 86_400_000)
    if (this.recent.filter((time) => now - time < 60_000).length >= MAX_PER_MINUTE) throw new ClaudeActionError(`At most ${MAX_PER_MINUTE} write actions per minute. Wait a moment.`, 429)
    if (this.recent.length >= MAX_PER_DAY) throw new ClaudeActionError(`At most ${MAX_PER_DAY} write actions per day.`, 429)
    if (this.busy) throw new ClaudeActionError('Another write is still running. Wait for it to finish.', 429)
    this.busy = true
    this.recent.push(now)
    const started = Date.now()
    try {
      // Re-read the row now: if an agent wrote in the meantime, the plan (or its cells) differs.
      let built: ClaudePlan
      let sheets: SheetsApi
      try {
        const target = await fresh()
        sheets = target.sheets
        built = planClaude(pending.action, pending.raw, target.context)
      } catch (error) {
        if (error instanceof ClaudeActionError && error.status === 409) throw new ClaudeActionError(CHANGED, 409)
        throw error
      }
      if (JSON.stringify(built.cells.map((cell) => [cell.range, cell.to])) !== pending.cells) throw new ClaudeActionError(CHANGED, 409)
      const base = { action: built.action, board: built.board.id, row: built.row, cells: built.cells.map((cell) => cell.cell) }
      let result: ClaudeResult
      try {
        if (!sheets.batchUpdate) throw new ClaudeActionError('This Sheets client cannot write.', 500)
        await sheets.batchUpdate(built.board.spreadsheetId, built.cells.map((cell) => ({ range: cell.range, value: cell.to })))
        // Read the cells back: what the sheet holds now is what the owner is told.
        const back = await sheets.batchGet(built.board.spreadsheetId, built.cells.map((cell) => cell.range)).catch(() => undefined)
        const verified = back ? built.cells.every((cell, index) => String(back[index]?.[0]?.[0] ?? '').trim() === cell.to.trim()) : undefined
        result = { ...base, ok: true, ...(verified === undefined ? {} : { verified }) }
      } catch (error) {
        const uncertain = error instanceof SheetsError && error.kind === 'network'
        result = { ...base, ok: false, error: uncertain ? 'Google did not answer in time. Unknown whether the cells were written: reload and check before trying again.' : `Google refused the write${error instanceof SheetsError ? ` (${error.message})` : ''}. Nothing was changed.`, ...(uncertain ? { uncertain } : {}) }
      }
      recordCommand({ command: `sheets update ${built.board.id} row ${built.row} [${built.cells.map((cell) => cell.cell.replace(/\d+$/, '')).join(',')}]`, ok: result.ok, durationMs: Date.now() - started, at: new Date(started).toISOString(), write: true, ...(result.ok ? {} : { error: result.uncertain ? 'uncertain' : 'refused' }) })
      await this.audit(built, result)
      return result
    } finally {
      this.busy = false
    }
  }

  /** Append-only record in Ruang's config folder: what changed, never the comment's text. */
  private async audit(plan: ClaudePlan, result: ClaudeResult): Promise<void> {
    const entry = { at: new Date(this.now()).toISOString(), kind: 'sheets', action: plan.action, board: plan.board.id, testCopy: Boolean(plan.board.testCopyOf), row: plan.row, rowKey: plan.key, cells: result.cells, ...(plan.status ? { status: plan.status } : {}), commentLength: plan.commentLength, ok: result.ok, ...(result.verified !== undefined ? { verified: result.verified } : {}), ...(result.uncertain ? { uncertain: true } : {}), ...(result.ok ? {} : { error: result.error }) }
    try {
      await mkdir(dirname(this.auditPath), { recursive: true, mode: 0o700 })
      await appendFile(this.auditPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch (error) {
      console.error('Ruang write audit could not be saved:', error instanceof Error ? error.message : error)
    }
  }
}
