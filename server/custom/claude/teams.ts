// custom: what the Claude pages show, built from the config and one read of every board. Nothing
// here is guessed: a board that cannot be read makes its counts and agent states Unknown, and the
// agents' states come only from what the rows say (see agentLine).
import path from 'node:path'
import { cellOf, knownStatuses, TASKFLOW, readBoard, rowKeyText, rowTitle, statusKey, type BoardRead, type BoardRow } from './board.js'
import { loadClaudeConfig, type AgentConfig, type BoardConfig, type ClaudeConfig, type TeamConfig } from './config.js'
import { cachedProbe, PROBE_TIMEOUT_MS, type Probe } from './probe.js'
import { localDate, nextRun, type NextRun } from './schedule.js'
import { computeFlow, type NeedsItem, type Queue, type Relations } from './taskflow.js'
import type { SheetsApi } from './sheets.js'

export type AgentState = 'Working' | 'Waiting for you' | 'Queued' | 'Idle' | 'Ran today' | 'Not run yet today' | 'Paused' | 'Notifier' | 'Unknown'
export interface AgentLine { code: string; name: string; state: AgentState; detail: string; nextRun: NextRun; runsOnMac: boolean; notifierOnly: boolean; provenance: string }

export interface CardSummary { row: number; key: string; id?: string; title: string; status: string; statusKey: string; owner?: string; date?: string; score?: string; updated?: string; /** Task-flow boards only. */ relations?: Relations }
export interface FilesHealth { status: 'readable' | 'denied' | 'blocked' | 'missing' | 'error'; message: string }
export interface BoardView {
  id: string
  title: string
  kind: 'taskflow' | 'table'
  testCopy: boolean
  fetchedAt: string
  availability: 'available' | 'unavailable'
  reason?: string
  readOnly?: string
  files?: FilesHealth
  cards: CardSummary[]
  /** Rows that need the owner, in the order to handle them. */
  needsYou: number[]
  /** Whether the config says which statuses need the owner. */
  needsYouRule: boolean
  needsYouReason?: string
  /** Rows in a status the owner may never change (do-not-contact). */
  neverTouch: number[]
  /** Task-flow boards: the ranked Needs-you list with reasons, agent queues, the open chain. */
  flow?: { needs: NeedsItem[]; queues: Queue[]; chain: string[]; warnings: string[] }
}
export interface TeamSummary {
  slug: string
  code: string
  name: string
  status: 'active' | 'paused'
  /** Null when no board with a Needs-you rule could be read. */
  needsYou: number | null
  /** True when some boards could not be read, so the count may be low. */
  incomplete: boolean
  /** From task-flow boards only; null when the team has none (or it cannot be read). */
  working: number | null
  waiting: number | null
  nextRun: { agent: string; run: NextRun } | null
  boards: { id: string; title: string; availability: 'available' | 'unavailable'; reason?: string; readOnly?: string; testCopy: boolean }[]
  agents: AgentLine[]
}
export interface ClaudeData {
  availability: 'available' | 'unavailable'
  reason?: string
  ownerName: string
  timezone: string
  fetchedAt: string
  teams: TeamSummary[]
  boards: Record<string, BoardView>
  /** Server only (never sent): the rows behind each board and its output folder's absolute path. */
  reads: Record<string, BoardRead>
  fileRoots: Record<string, string>
  liveWrites: boolean
}

const readTime = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(Date.parse(iso))

function cardOf(board: BoardConfig, row: BoardRow, known: ReadonlySet<string>): CardSummary {
  const status = cellOf(board, row, 'status')
  const optional = (key: string | undefined, value: string) => (key && value ? { [key]: value } : {})
  return {
    row: row.row,
    key: rowKeyText(board, row),
    title: rowTitle(board, row),
    status,
    statusKey: statusKey(status, known),
    ...optional('id', cellOf(board, row, 'id')),
    ...optional('owner', cellOf(board, row, 'owner')),
    ...optional('score', cellOf(board, row, 'score')),
    ...optional('updated', cellOf(board, row, 'updated')),
    ...optional('date', board.dateColumn ? row.cells[board.dateColumn] ?? '' : ''),
  }
}

/** Numbers sort as numbers ("9" before "10"); empty values go last. */
function compareValues(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0
  const [x, y] = [Number(a), Number(b)]
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b, 'en', { numeric: true })
}

/** Needs-you rows of a table board, in `sortBy` order (task-flow boards are ranked in taskflow.ts). */
function needsYouRows(board: BoardConfig, read: BoardRead, cards: CardSummary[]): number[] {
  if (!board.needsYou || read.availability !== 'available') return []
  const wanted = new Set(board.needsYou.status.map((status) => status.toLowerCase()))
  const sort = board.needsYou.sortBy
  const value = (card: CardSummary) => (sort ? read.rows.find((row) => row.row === card.row)?.cells[sort.column] : card.id)
  return cards.filter((card) => wanted.has(card.statusKey))
    .sort((a, b) => (sort?.direction === 'desc' ? -1 : 1) * compareValues(value(a), value(b)) || a.row - b.row)
    .map((card) => card.row)
}

export function boardView(read: BoardRead, files?: FilesHealth, context: { today?: string; runs?: ReadonlyMap<string, NextRun> } = {}): BoardView {
  const { board } = read
  const known = knownStatuses(board)
  const flow = board.kind === 'taskflow' && read.availability === 'available' ? computeFlow(read, { today: context.today ?? '', ...(context.runs ? { runs: context.runs } : {}) }) : undefined
  const cards = read.rows.map((row) => ({ ...cardOf(board, row, known), ...(flow?.relations[row.row] ? { relations: flow.relations[row.row] } : {}) }))
  const never = new Set(board.neverTouchStatus.map((status) => status.toLowerCase()))
  return {
    id: board.id,
    title: board.title,
    kind: board.kind,
    testCopy: Boolean(board.testCopyOf),
    fetchedAt: read.fetchedAt,
    availability: read.availability,
    ...(read.reason ? { reason: read.reason } : {}),
    ...(read.readOnly ? { readOnly: read.readOnly } : {}),
    ...(files ? { files } : {}),
    cards,
    needsYou: flow ? flow.needs.map((item) => item.row) : needsYouRows(board, read, cards),
    needsYouRule: Boolean(board.needsYou),
    ...(board.needsYou?.reason ? { needsYouReason: board.needsYou.reason } : {}),
    neverTouch: cards.filter((card) => never.has(card.statusKey)).map((card) => card.row),
    ...(flow ? { flow: { needs: flow.needs, queues: flow.queues, chain: flow.chain, warnings: flow.warnings } } : {}),
  }
}

/**
 * An agent's state, only from what its board proves:
 * - paused team → Paused; notifier → Notifier (it posts to Slack, it owns no rows);
 * - agents tied to table boards (ZZ.1, ZZ.2) → "Ran today" when a board has rows dated today,
 *   otherwise "Not run yet today" (never Working: those boards have no in-progress rows);
 * - task-flow agents by their own rows: in progress → Working, review → Waiting for you,
 *   ready / changes requested → Queued, otherwise Idle;
 * - a board that cannot be read → Unknown.
 */
export function agentLine(agent: AgentConfig, team: TeamConfig, reads: ReadonlyMap<string, BoardRead>, config: Pick<ClaudeConfig, 'timezone'>, now: number): AgentLine {
  const paused = team.status === 'paused'
  const base = { code: agent.code, name: agent.name, nextRun: nextRun(agent, paused, now, config.timezone), runsOnMac: agent.runsOnMac, notifierOnly: agent.notifierOnly }
  if (paused) return { ...base, state: 'Paused', detail: 'Its scheduled task is switched off.', provenance: 'from the team config' }
  if (agent.notifierOnly) return { ...base, state: 'Notifier', detail: 'Posts board changes to Slack; owns no tasks.', provenance: 'from the team config' }
  const boards = agent.boards.length ? agent.boards : team.boards.filter((board) => board.kind === 'taskflow').map((board) => board.id)
  const read = boards.map((id) => reads.get(id)).filter((item): item is BoardRead => item !== undefined)
  const missing = read.filter((item) => item.availability !== 'available')
  const titles = read.map((item) => item.board.title).join(', ')
  const at = read.length ? readTime(read[0].fetchedAt, config.timezone) : ''
  if (!read.length || missing.length) return { ...base, state: 'Unknown', detail: missing.length ? `Not Available: ${missing[0].reason}` : 'No board is linked to this agent.', provenance: titles ? `from ${titles}` : 'no board' }
  const provenance = `from ${titles}, read ${at}`
  if (agent.boards.length) {
    const today = localDate(now, config.timezone)
    const dated = read.map((item) => ({ item, count: item.board.dateColumn ? item.rows.filter((row) => row.cells[item.board.dateColumn!] === today).length : 0 }))
    if (read.every((item) => !item.board.dateColumn)) return { ...base, state: 'Unknown', detail: 'Its board has no date column.', provenance }
    const total = dated.reduce((sum, entry) => sum + entry.count, 0)
    return total > 0
      ? { ...base, state: 'Ran today', detail: `${total} row${total === 1 ? '' : 's'} dated today (${dated.filter((entry) => entry.count).map((entry) => entry.item.board.title).join(', ')}).`, provenance }
      : { ...base, state: 'Not run yet today', detail: 'No rows dated today yet.', provenance }
  }
  const mine = read.flatMap((item) => { const known = knownStatuses(item.board); return item.rows.filter((row) => cellOf(item.board, row, 'owner') === agent.code).map((row) => ({ id: cellOf(item.board, row, 'id') || `row ${row.row}`, status: statusKey(cellOf(item.board, row, 'status'), known) })) })
  const list = (statuses: readonly string[]) => mine.filter((task) => statuses.includes(task.status)).map((task) => task.id)
  const working = list([TASKFLOW.working])
  if (working.length) return { ...base, state: 'Working', detail: `In progress: ${working.join(', ')}`, provenance }
  const review = list([TASKFLOW.review])
  if (review.length) return { ...base, state: 'Waiting for you', detail: `In review: ${review.join(', ')}`, provenance }
  const queued = list(TASKFLOW.queued)
  if (queued.length) return { ...base, state: 'Queued', detail: `${queued.length} task${queued.length === 1 ? '' : 's'} queued`, provenance }
  return { ...base, state: 'Idle', detail: 'No open tasks.', provenance }
}

function teamSummary(team: TeamConfig, views: Record<string, BoardView>, reads: ReadonlyMap<string, BoardRead>, config: ClaudeConfig, now: number, testBoards: BoardConfig[]): TeamSummary {
  const live = team.boards.map((board) => views[board.id])
  const ruled = team.boards.filter((board) => board.needsYou).map((board) => views[board.id])
  const readable = ruled.filter((view) => view.availability === 'available')
  const flows = live.filter((view) => view.kind === 'taskflow')
  const count = (status: string) => (flows.length && flows.every((view) => view.availability === 'available') ? flows.reduce((sum, view) => sum + view.cards.filter((card) => card.statusKey === status).length, 0) : null)
  const agents = team.agents.map((agent) => agentLine(agent, team, reads, config, now))
  const upcoming = agents.filter((agent) => !agent.notifierOnly && agent.nextRun.at).sort((a, b) => Date.parse(a.nextRun.at!) - Date.parse(b.nextRun.at!))[0]
  const all = [...team.boards, ...testBoards.filter((board) => board.team === team.code)].map((board) => views[board.id])
  return {
    slug: team.slug,
    code: team.code,
    name: team.name,
    status: team.status,
    needsYou: readable.length ? readable.reduce((sum, view) => sum + view.needsYou.length, 0) : null,
    incomplete: readable.length < ruled.length,
    working: count(TASKFLOW.working),
    waiting: count(TASKFLOW.waiting),
    nextRun: team.status === 'paused' ? { agent: '', run: { label: 'Paused' } } : upcoming ? { agent: upcoming.code, run: upcoming.nextRun } : null,
    boards: all.map((view) => ({ id: view.id, title: view.title, availability: view.availability, ...(view.reason ? { reason: view.reason } : {}), ...(view.readOnly ? { readOnly: view.readOnly } : {}), testCopy: view.testCopy })),
    agents,
  }
}

const ACCESS_HINT = 'Give node access in System Settings → Privacy & Security → Files and Folders (iCloud Drive) or Full Disk Access, then restart Ruang (scripts/deploy.sh).'

/** Can Ruang read the board's output folder? Checked in a child process (probe.ts): macOS may block or hold the iCloud folder for the service. */
export async function filesHealth(config: Pick<ClaudeConfig, 'icloudRoot'>, board: BoardConfig, probe: Probe): Promise<FilesHealth | undefined> {
  if (!board.files || board.testCopyOf) return undefined
  if (!config.icloudRoot) return { status: 'missing', message: 'No iCloud root is configured.' }
  const result = await probe(path.join(config.icloudRoot, board.files.root))
  if (result.ok) return { status: 'readable', message: `Output folder readable (${result.entries} entries).` }
  if (result.code === 'TIMEOUT') return { status: 'blocked', message: `Not Available: macOS held Ruang's access to the iCloud folder for more than ${PROBE_TIMEOUT_MS / 1000} seconds (a privacy prompt may be waiting on the Mac's screen). ${ACCESS_HINT}` }
  if (result.code === 'EPERM' || result.code === 'EACCES') return { status: 'denied', message: `Not Available: macOS does not let Ruang read the iCloud folder. ${ACCESS_HINT}` }
  if (result.code === 'ENOENT') return { status: 'missing', message: 'Not Available: the output folder was not found.' }
  if (result.code === 'ENOTDIR') return { status: 'error', message: 'Not Available: the output folder is not a folder.' }
  return { status: 'error', message: `Not Available: the output folder cannot be read (${result.code}).` }
}

const sharedProbe = cachedProbe()

export async function collectClaude(options: { sheets: (config: ClaudeConfig) => SheetsApi; configFile?: string; now?: () => number; probe?: Probe }): Promise<ClaudeData> {
  const now = options.now?.() ?? Date.now()
  const fetchedAt = new Date(now).toISOString()
  let config: ClaudeConfig
  try {
    config = await loadClaudeConfig(options.configFile)
  } catch (error) {
    return { availability: 'unavailable', reason: error instanceof Error ? error.message : 'The Claude teams config cannot be read.', ownerName: 'Owner', timezone: 'Asia/Jakarta', fetchedAt, teams: [], boards: {}, reads: {}, fileRoots: {}, liveWrites: false }
  }
  const sheets = options.sheets(config)
  const boards = [...config.teams.flatMap((team) => team.boards), ...config.testBoards]
  const probe = options.probe ?? sharedProbe
  // Sheets reads and folder checks run side by side; both are time-limited, so this always finishes.
  const reads = await Promise.all(boards.map((board) => Promise.all([readBoard(board, sheets, now), filesHealth(config, board, probe)])))
  const readMap = new Map(reads.map(([read]) => [read.board.id, read]))
  const today = localDate(now, config.timezone)
  const runs = new Map(config.teams.map((team) => [team.code, new Map(team.agents.map((agent) => [agent.code, nextRun(agent, team.status === 'paused', now, config.timezone)]))]))
  const views = Object.fromEntries(reads.map(([read, files]) => [read.board.id, boardView(read, files, { today, ...(runs.get(read.board.team) ? { runs: runs.get(read.board.team)! } : {}) })]))
  const fileRoots = Object.fromEntries(boards.flatMap((board) => (board.files && config.icloudRoot ? [[board.id, path.join(config.icloudRoot, board.files.root)]] : [])))
  return { availability: 'available', ownerName: config.ownerName, timezone: config.timezone, fetchedAt, teams: config.teams.map((team) => teamSummary(team, views, readMap, config, now, config.testBoards)), boards: views, reads: Object.fromEntries(readMap), fileRoots, liveWrites: config.liveWrites }
}
