// custom: reading one Claude board from its Google Sheet. Every read checks the header text of
// each configured column in row 1: when someone inserts or renames a column, the letters in the
// config no longer point at the right data, so the board says which column is wrong and refuses
// every write until the config is fixed.
import type { BoardConfig, ColumnSpec } from './config.js'
import { a1, type CellValue } from './sheets.js'

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
