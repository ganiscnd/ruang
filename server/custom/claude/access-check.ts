// custom: read-only check of the Claude section's setup: can the service account read every
// configured board, do the column headers match, and can this process read the iCloud folders?
// It prints counts, header results and the *shape* of a few values (digits shown as 9), never
// cell text, so its output is safe to paste into a report.
//
//   npx tsx server/custom/claude/access-check.ts        (from the terminal)
//   node build/server/custom/claude/access-check.js     (the built copy, as the service runs it)
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { boardRange, checkHeaders, headerMessage } from './board.js'
import { allBoards, claudeConfigPath, loadClaudeConfig, type BoardConfig, type ClaudeConfig } from './config.js'
import { loadServiceAccount, redactSecrets, SheetsClient, type CellValue, type SheetsApi } from './sheets.js'

/** "2026-11-09 10:00" → "9999-99-99 99:99": the format without the content. */
const shape = (value: CellValue | undefined) => (value === undefined || value === '' ? '(empty)' : String(value).replace(/\p{L}/gu, 'a').replace(/\d/g, '9').slice(0, 40))
const AGENT_CODE = /^[A-Z]{1,4}\.\d{1,2}\.[A-Z0-9]{1,3}$/

function tally(values: Iterable<string>): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => `${value} ×${count}`).join(', ') || '(none)'
}

async function checkBoard(board: BoardConfig, sheets: SheetsApi, lines: string[]): Promise<boolean> {
  lines.push(`Board ${board.id} (${board.kind}${board.testCopyOf ? `, test copy of ${board.testCopyOf}` : ''})`)
  let formatted: CellValue[][]
  let raw: CellValue[][]
  try {
    [formatted, raw] = await Promise.all([sheets.batchGet(board.spreadsheetId, [boardRange(board)]).then(([rows]) => rows), sheets.batchGet(board.spreadsheetId, [boardRange(board)], 'UNFORMATTED_VALUE').then(([rows]) => rows)])
  } catch (error) {
    lines.push(`  READ FAILED: ${redactSecrets(error instanceof Error ? error.message : String(error))}`)
    return false
  }
  const [header = [], ...rows] = formatted
  const problems = checkHeaders(board, header)
  lines.push(problems.length ? `  HEADERS: ${headerMessage(problems)}` : `  headers: all ${board.columns.length} configured columns match`)
  const filledAt = rows.map((row, index) => (row.some((cell) => String(cell).trim() !== '') ? index : -1)).filter((index) => index >= 0)
  const filled = filledAt.map((index) => rows[index])
  lines.push(`  rows with data: ${filled.length}`)
  const column = (key: string) => board.columns.find((item) => item.key === key)
  const role = (name: string) => board.columns.find((item) => item.role === name)
  const status = role('status')
  if (status) {
    const values = filled.map((row) => String(row[status.index] ?? '').trim().toLowerCase())
    const unknown = board.statuses.length ? values.filter((value) => !board.statuses.includes(value)) : []
    lines.push(`  status values: ${tally(values.map((value) => value || '(empty)'))}${unknown.length ? ` — not in the config's status list: ${unknown.length}` : ''}`)
  }
  const owner = role('owner')
  if (owner) lines.push(`  owner values: ${tally(filled.map((row) => { const value = String(row[owner.index] ?? '').trim(); return AGENT_CODE.test(value) ? value : value ? '(not an agent code)' : '(empty)' }))}`)
  const dated = [role('updated'), board.dateColumn ? column(board.dateColumn) : undefined].filter((item) => item !== undefined)
  for (const item of dated) {
    const rawRows = filledAt.map((index) => raw[index + 1] ?? [])
    lines.push(`  ${item.key} (${item.col}) format: ${tally(filled.map((row) => shape(row[item.index])))}; stored as: ${tally(rawRows.map((row) => (row[item.index] === undefined || row[item.index] === '' ? 'empty' : typeof row[item.index] === 'number' ? 'number (real date)' : 'text')))}`)
  }
  return problems.length === 0
}

async function checkFolder(config: ClaudeConfig, board: BoardConfig, lines: string[]): Promise<void> {
  if (!board.files || !config.icloudRoot || board.testCopyOf) return
  const folder = path.join(config.icloudRoot, board.files.root)
  try {
    const info = await stat(folder)
    if (!info.isDirectory()) { lines.push(`  files root: not a folder`); return }
    const entries = await readdir(folder, { withFileTypes: true })
    lines.push(`  files root: readable, ${entries.filter((entry) => !entry.name.startsWith('.')).length} entries`)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    lines.push(`  files root: ${code === 'EPERM' || code === 'EACCES' ? `PERMISSION DENIED (${code}): macOS blocks this process from the iCloud folder` : code === 'ENOENT' ? 'NOT FOUND' : `cannot read (${code ?? 'unknown'})`}`)
  }
}

export async function runAccessCheck(config: ClaudeConfig, sheets: SheetsApi): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [`Process: node ${process.version}, pid ${process.pid}, timezone ${config.timezone}`]
  let ok = true
  try {
    const account = await loadServiceAccount(config.keyFile)
    lines.push(`Key file: valid service account key${account.looseMode ? ` — WARNING: mode ${account.looseMode}, run chmod 600` : ', mode 600'}`)
  } catch (error) {
    lines.push(`Key file: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, lines }
  }
  for (const board of allBoards(config)) {
    if (!(await checkBoard(board, sheets, lines))) ok = false
    await checkFolder(config, board, lines)
  }
  return { ok, lines }
}

async function main(): Promise<void> {
  const config = await loadClaudeConfig(claudeConfigPath())
  const { ok, lines } = await runAccessCheck(config, new SheetsClient({ keyFile: config.keyFile }))
  console.log(lines.join('\n'))
  console.log(ok ? '\nAll boards readable, all headers match.' : '\nSome checks failed (see above).')
  process.exitCode = ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(redactSecrets(error instanceof Error ? error.message : String(error))); process.exitCode = 1 })
}
