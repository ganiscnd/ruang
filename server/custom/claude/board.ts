// custom: reading one Claude board from its Google Sheet. Every read checks the header text of
// each configured column in row 1: when someone inserts or renames a column, the letters in the
// config no longer point at the right data, so the board says which column is wrong and refuses
// every write until the config is fixed.
import type { BoardConfig, ColumnSpec, Role } from './config.js'
import { withTimeout } from './probe.js'
import { a1, SheetsError, type CellValue, type SheetsApi } from './sheets.js'

/** Upper bound for one board read, login included (each Google request has its own 10 s limit). */
export const BOARD_READ_TIMEOUT_MS = 20_000

/** Headers compare after trimming and collapsing spaces; case and wording must match. */
const normalizeHeader = (value: CellValue | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim()

export interface HeaderProblem { column: string; key: string; expected: string; found: string }

export function checkHeaders(board: Pick<BoardConfig, 'columns'>, headerRow: readonly CellValue[]): HeaderProblem[] {
  return board.columns
    .filter((column) => normalizeHeader(headerRow[column.index]) !== normalizeHeader(column.header))
    .map((column) => ({ column: column.col, key: column.key, expected: column.header, found: normalizeHeader(headerRow[column.index]) }))
}

export function headerMessage(problems: readonly HeaderProblem[]): string {
  return `Column header mismatch, so this board is read-only: ${problems.map((problem) => `${problem.column} should be "${problem.expected}" but is ${problem.found ? `"${problem.found}"` : 'empty'}`).join('; ')}. Fix the sheet or the config.`
}

/** The last configured column, so one range covers every configured cell. */
export function lastColumn(board: Pick<BoardConfig, 'columns'>): ColumnSpec {
  return board.columns.reduce((last, column) => (column.index > last.index ? column : last))
}

/** The whole board in one range: header row plus every row, up to the last configured column. */
export const boardRange = (board: Pick<BoardConfig, 'tab' | 'columns'>) => a1(board.tab, `A1:${lastColumn(board).col}`)

export interface BoardRow { /** Sheet row number (row 1 is the header). */ row: number; cells: Record<string, string> }
export interface BoardRead {
  board: BoardConfig
  fetchedAt: string
  availability: 'available' | 'unavailable'
  /** Why the board cannot be read (Not Available: <reason>). */
  reason?: string
  /** Set when the board can be read but must not be written (header mismatch). */
  readOnly?: string
  rows: BoardRow[]
}

/** Reads every configured column of every non-empty row. Never throws and never hangs: a failure or a slow read is an unavailable board. */
export async function readBoard(board: BoardConfig, sheets: SheetsApi, now = Date.now(), timeoutMs = BOARD_READ_TIMEOUT_MS): Promise<BoardRead> {
  const fetchedAt = new Date(now).toISOString()
  let values: CellValue[][]
  try {
    [values] = await withTimeout(sheets.batchGet(board.spreadsheetId, [boardRange(board)]), timeoutMs, () => new SheetsError(`Google Sheets did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'network'))
  } catch (error) {
    return { board, fetchedAt, availability: 'unavailable', reason: error instanceof SheetsError ? error.message : 'The sheet could not be read.', rows: [] }
  }
  const [header = [], ...data] = values
  const problems = checkHeaders(board, header)
  // A column whose header does not match may hold other data: its cells are not shown as real.
  const wrong = new Set(problems.map((problem) => problem.key))
  const rows = data.flatMap((cells, index): BoardRow[] => {
    const record = Object.fromEntries(board.columns.map((column) => [column.key, wrong.has(column.key) ? '' : String(cells[column.index] ?? '').trim()]))
    return Object.values(record).some(Boolean) ? [{ row: index + 2, cells: record }] : []
  })
  return { board, fetchedAt, availability: 'available', ...(problems.length ? { readOnly: headerMessage(problems) } : {}), rows }
}

export const columnOf = (board: Pick<BoardConfig, 'columns'>, role: Role) => board.columns.find((column) => column.role === role)
export const cellOf = (board: Pick<BoardConfig, 'columns'>, row: BoardRow, role: Role) => { const column = columnOf(board, role); return column ? row.cells[column.key] ?? '' : '' }

/** Task-flow statuses with a fixed meaning (the agents' own protocol). */
export const TASKFLOW = { working: 'in progress', waiting: 'waiting', review: 'review', queued: ['changes requested', 'ready'] } as const

/** Every status the config names for this board (and the task-flow protocol's), lower case. */
export function knownStatuses(board: BoardConfig): Set<string> {
  const rule = board.ganiCanSetStatus
  const protocol = board.kind === 'taskflow' ? [TASKFLOW.working, TASKFLOW.waiting, TASKFLOW.review, ...TASKFLOW.queued] : []
  const named = [...protocol, ...board.statuses, ...board.unlockStatuses, ...(board.needsYou?.status ?? []), ...board.neverTouchStatus, ...(Array.isArray(rule) ? rule : Object.entries(rule).flat(2))]
  return new Set(named.map((status) => status.toLowerCase()))
}

/**
 * The status a row is grouped by, case-insensitive. A status the config knows counts whole
 * ("changes requested"); free text counts by its first word ("used 2026-11-01 (c)" → "used").
 * The full text is always shown as well.
 */
export function statusKey(value: string, known: ReadonlySet<string>): string {
  const status = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!status || known.has(status)) return status
  return status.split(/[\s(:]/)[0] || status
}

/** The card title: the title column, else the first 8 words of the description. */
export function rowTitle(board: Pick<BoardConfig, 'columns'>, row: BoardRow): string {
  const title = cellOf(board, row, 'title')
  if (title) return title
  const words = cellOf(board, row, 'description').split(/\s+/).filter(Boolean)
  return words.length ? `${words.slice(0, 8).join(' ')}${words.length > 8 ? '…' : ''}` : '(no title)'
}

export const rowKeyText = (board: Pick<BoardConfig, 'rowKey'>, row: BoardRow) => board.rowKey.map((key) => row.cells[key] ?? '').join(' · ')
