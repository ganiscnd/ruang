// custom: HTTP routes of the Claude section (read-only so far), installed by server/custom/routes.ts.
// The browser only ever talks to these routes; Google is called from the server alone.
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { AccessOfRequest } from '../../access.js'
import { sameOrigin, writeStatus } from '../guard.js'
import { ValidationError } from '../validate.js'
import { ClaudeActionError, ClaudeWrites, notesHash, rowWriteState, type WriteContext } from './actions.js'
import { cachedSource } from '../../mission-control.js'
import { findBoard, loadClaudeConfig, type ClaudeConfig } from './config.js'
import { cellOf, columnOf, readBoard, rowKeyText } from './board.js'
import { FileViewError, OutputFiles } from './files.js'
import { parseAgentNotes, parseOutput, parseOwnerNotes, relativeToRoot } from './notes.js'
import { withTimeout } from './probe.js'
import { localDate } from './schedule.js'
import { SheetsClient, type SheetsApi } from './sheets.js'
import { collectClaude, type ClaudeData } from './teams.js'

/** Boards are read at most every 30 s (5 boards → about 10 Sheets reads a minute at most). */
export const CLAUDE_CACHE_MS = 30_000
const FRESH_WINDOW_MS = 25_000
const TEAM_SLUG = /^[a-z]{1,4}-\d{1,2}$/
/** Every part of a read is time-limited already; this is the last guard so a page never waits forever. */
export const CLAUDE_ROUTE_TIMEOUT_MS = 30_000

class RouteTimeout extends Error {}

/** One client per key file, so the access token is reused across reads and writes. */
function clientFor(): (config: ClaudeConfig) => SheetsApi {
  let client: { keyFile: string; api: SheetsClient } | undefined
  return (config) => {
    if (client?.keyFile !== config.keyFile) client = { keyFile: config.keyFile, api: new SheetsClient({ keyFile: config.keyFile }) }
    return client.api
  }
}
const sharedSheets = clientFor()

export const claudeSource = cachedSource(() => collectClaude({ sheets: sharedSheets }), CLAUDE_CACHE_MS)

const BOARD_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Columns shown in their own section of the detail panel, not in the field list. */
const OWN_SECTION = new Set(['description', 'agentNotes', 'ganiNotes', 'output', 'title', 'id', 'status', 'owner', 'dependsOn', 'updated'])

/** Everything the detail panel shows for one row. Long cells are parsed for display only. */
export async function rowDetail(data: ClaudeData, boardId: string, rowNumber: number, files: OutputFiles, writesEnabled: { enabled: boolean; reason?: string } = { enabled: false }) {
  const view = data.boards[boardId]
  const read = data.reads[boardId]
  if (!view || !read) return undefined
  const row = read.rows.find((item) => item.row === rowNumber)
  const card = view.cards.find((item) => item.row === rowNumber)
  if (!row || !card) return undefined
  const { board } = read
  const root = data.fileRoots[boardId]
  const outputs = parseOutput(cellOf(board, row, 'output')).map((line) => ({ ...line, paths: line.paths.map((item) => relativeToRoot(item, board.files?.root ?? '')) }))
  const states = root ? await files.states(root, outputs.flatMap((line) => line.paths)) : []
  const stateOf = new Map(states.map((item) => [item.path, item.state]))
  const notes = columnOf(board, 'ganiNotes')
  const state = rowWriteState(board, read, row, data.liveWrites)
  return {
    // What the owner sees now; a write is refused if the sheet differs when it runs.
    key: rowKeyText(board, row),
    seen: { status: cellOf(board, row, 'status'), notes: notesHash(notes ? row.cells[notes.key] ?? '' : '') },
    write: writesEnabled.enabled ? state : { ...state, allowed: false, reason: writesEnabled.reason },
    notesLength: notes ? (row.cells[notes.key] ?? '').length : 0,
    board: { id: view.id, title: view.title, kind: view.kind, testCopy: view.testCopy, fetchedAt: view.fetchedAt, ...(view.readOnly ? { readOnly: view.readOnly } : {}), hasFiles: Boolean(root) },
    card,
    fields: board.columns.filter((column) => !OWN_SECTION.has(column.role ?? column.key) && !OWN_SECTION.has(column.key)).map((column) => ({ key: column.key, header: column.header, value: row.cells[column.key] ?? '' })),
    task: cellOf(board, row, 'description'),
    agentNotes: parseAgentNotes(columnOf(board, 'agentNotes') ? cellOf(board, row, 'agentNotes') : ''),
    ownerNotes: parseOwnerNotes(cellOf(board, row, 'ganiNotes')),
    outputs: outputs.map((line) => ({ text: line.text, links: line.paths.map((item) => ({ path: item, state: root ? stateOf.get(item) ?? 'error' : 'unknown' })) })),
    ownerName: data.ownerName,
  }
}

export interface ClaudeOptions {
  source?: (now: number) => Promise<ClaudeData>
  timeoutMs?: number
  files?: OutputFiles
  /** The access-code state of a request; writes need it on and unlocked. Without it, writes are off. */
  accessOf?: (request: Request) => Promise<AccessOfRequest>
  writes?: ClaudeWrites
  /** A fresh read of one board for a write, and the client that writes (tests pass fakes). */
  writeContext?: (board: string) => Promise<{ context: WriteContext; sheets: SheetsApi }>
  afterWrite?: () => void
}

/** Reads one board straight from the sheet (no cache) for a write. */
async function liveWriteContext(boardId: string): Promise<{ context: WriteContext; sheets: SheetsApi }> {
  const config = await loadClaudeConfig()
  const board = findBoard(config, boardId)
  if (!board) throw new ValidationError('Unknown board.')
  const sheets = sharedSheets(config)
  const read = await readBoard(board, sheets)
  return { context: { read, ownerName: config.ownerName, today: localDate(Date.now(), config.timezone), liveWrites: config.liveWrites }, sheets }
}

const NO_ACCESS: AccessOfRequest = { enabled: false, unlocked: false }

export function installClaude(app: Express, options: ClaudeOptions = {}): void {
  const files = options.files ?? new OutputFiles()
  const accessOf = options.accessOf ?? (async () => NO_ACCESS)
  const writes = options.writes ?? new ClaudeWrites()
  const writeContext = options.writeContext ?? liveWriteContext
  const afterWrite = options.afterWrite ?? (() => claudeSource.clear())
  const timeoutMs = options.timeoutMs ?? CLAUDE_ROUTE_TIMEOUT_MS
  const read = options.source ?? claudeSource
  const source = (time: number) => withTimeout(read(time), timeoutMs, () => new RouteTimeout(`Not Available: the Claude boards did not load within ${Math.round(timeoutMs / 1000)} seconds.`))
  const now = (fresh: unknown) => Date.now() + (fresh === '1' ? FRESH_WINDOW_MS : 0)
  /** A read that hits the last-resort deadline answers 503 with the reason instead of hanging. */
  const timed = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
    try {
      await handler(request, response)
    } catch (error) {
      if (error instanceof RouteTimeout) { response.status(503).json({ error: error.message }); return }
      throw error
    }
  }

  app.get('/api/custom/claude/teams', timed(async (request, response) => {
    const { boards: _boards, reads: _reads, fileRoots: _roots, ...data } = await source(now(request.query.fresh))
    void _boards; void _reads; void _roots
    response.json(data)
  }))
  app.get('/api/custom/claude/teams/:team', timed(async (request, response) => {
    const slug = String(request.params.team)
    if (!TEAM_SLUG.test(slug)) { response.status(400).json({ error: 'Invalid team.' }); return }
    const data = await source(now(request.query.fresh))
    if (data.availability !== 'available') { response.status(503).json({ error: `Not Available: ${data.reason}` }); return }
    const team = data.teams.find((item) => item.slug === slug)
    if (!team) { response.status(404).json({ error: 'Unknown team.' }); return }
    response.json({ team, boards: team.boards.map((board) => data.boards[board.id]), ownerName: data.ownerName, timezone: data.timezone, fetchedAt: data.fetchedAt, writes: writeStatus(await accessOf(request)) })
  }))

  const boardRoute = async (request: Request, response: Response): Promise<{ data: ClaudeData; board: string } | undefined> => {
    const board = String(request.params.board)
    if (!BOARD_ID.test(board)) { response.status(400).json({ error: 'Invalid board.' }); return undefined }
    const data = await source(now(request.query.fresh))
    if (data.availability !== 'available') { response.status(503).json({ error: `Not Available: ${data.reason}` }); return undefined }
    if (!data.boards[board]) { response.status(404).json({ error: 'Unknown board.' }); return undefined }
    return { data, board }
  }
  app.get('/api/custom/claude/boards/:board/rows/:row', timed(async (request, response) => {
    const found = await boardRoute(request, response)
    if (!found) return
    const row = String(request.params.row)
    if (!/^\d{1,5}$/.test(row)) { response.status(400).json({ error: 'Invalid row.' }); return }
    const detail = await rowDetail(found.data, found.board, Number(row), files, writeStatus(await accessOf(request)))
    if (!detail) { response.status(404).json({ error: 'This row is no longer on the board. Reload.' }); return }
    response.json(detail)
  }))
  const fileError = (response: Response, error: unknown) => {
    if (error instanceof FileViewError) { response.status(error.status).json({ error: error.message }); return }
    throw error
  }
  app.get('/api/custom/claude/boards/:board/files', timed(async (request, response) => {
    const found = await boardRoute(request, response)
    if (!found) return
    const root = found.data.fileRoots[found.board]
    if (!root) { response.status(404).json({ error: 'This board has no output folder.' }); return }
    try { response.json(await files.view(root, request.query.path)) } catch (error) { fileError(response, error) }
  }))
  app.get('/api/custom/claude/boards/:board/raw', timed(async (request, response) => {
    const found = await boardRoute(request, response)
    if (!found) return
    const root = found.data.fileRoots[found.board]
    if (!root) { response.status(404).json({ error: 'This board has no output folder.' }); return }
    try {
      const file = await files.raw(root, request.query.path)
      response.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}` })
      response.send(file.data)
    } catch (error) { fileError(response, error) }
  }))

  // Writes: same guards as the Hermes actions (server/custom/routes.ts).
  const guard = async (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST') { response.status(405).json({ error: 'Method not allowed.' }); return }
    const problem = sameOrigin(request)
    if (problem) { response.status(403).json({ error: `Forbidden: ${problem}` }); return }
    const status = writeStatus(await accessOf(request))
    if (!status.enabled) { response.status(403).json({ error: status.reason, writes: status }); return }
    next()
  }
  const handle = (handler: (request: Request, body: Record<string, unknown>) => Promise<unknown>) => async (request: Request, response: Response) => {
    try {
      response.json(await handler(request, request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}))
    } catch (error) {
      if (error instanceof ValidationError) { response.status(400).json({ error: error.message }); return }
      if (error instanceof ClaudeActionError) { response.status(error.status).json({ error: error.message }); return }
      throw error
    }
  }
  const boardParam = (value: unknown) => { if (typeof value !== 'string' || !BOARD_ID.test(value)) throw new ValidationError('Unknown board.'); return value }
  app.use('/api/custom/claude/actions', express.json({ limit: '256kb' }), guard)
  app.post('/api/custom/claude/actions/preview', handle(async (request, body) => {
    const params = body.params && typeof body.params === 'object' ? body.params as Record<string, unknown> : {}
    const { context } = await writeContext(boardParam(params.board))
    return writes.preview(body.action, params, context, (await accessOf(request)).session!)
  }))
  app.post('/api/custom/claude/actions/execute', handle(async (request, body) => {
    const board = writes.boardOf(body.token)
    try {
      return await writes.execute(body.token, (await accessOf(request)).session!, () => writeContext(boardParam(board)))
    } finally {
      afterWrite()
    }
  }))
  app.use('/api/custom/claude/actions', (error: { type?: string }, _request: Request, response: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') { response.status(413).json({ error: 'This request is too large. Shorten the text and try again.' }); return }
    if (error?.type === 'entity.parse.failed') { response.status(400).json({ error: 'The request could not be read.' }); return }
    next(error)
  })
}
