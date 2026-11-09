// custom: the private config of the Claude section (teams, agents, boards). It lives outside the
// public repo (~/freelance-private/ruang-claude/teams.json, or RUANG_CLAUDE_CONFIG) and holds the
// spreadsheet IDs, so nothing from it that identifies a sheet or a path is ever sent to the browser.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const ROLES = ['id', 'title', 'status', 'description', 'owner', 'dependsOn', 'output', 'agentNotes', 'ganiNotes', 'updated', 'score', 'readonly'] as const
export type Role = typeof ROLES[number]

export interface ColumnSpec { key: string; col: string; index: number; header: string; role?: Role }
export interface NeedsYouRule { status: string[]; reason?: string; sortBy?: { column: string; direction: 'asc' | 'desc' } }
export interface BoardConfig {
  id: string
  title: string
  team: string
  kind: 'taskflow' | 'table'
  spreadsheetId: string
  tab: string
  rowKey: string[]
  columns: ColumnSpec[]
  /** Statuses the board knows; anything else shows in a visible "Other" group. Empty: not listed. */
  statuses: string[]
  /** Statuses that count as finished for a dependency (task flow). */
  unlockStatuses: string[]
  needsYou: NeedsYouRule | null
  /** Either a flat list (allowed from any status) or per current status. */
  ganiCanSetStatus: string[] | Record<string, string[]>
  neverTouchStatus: string[]
  writableColumns: string[]
  files?: { root: string; pattern?: string }
  /** The column that dates a row (Found / Post date / Date Found), for "ran today". */
  dateColumn?: string
  /** Set on a test copy: the live board whose settings it shares. Writes are tested only here. */
  testCopyOf?: string
}
export interface AgentConfig { code: string; name: string; schedule: string; runsOnMac: boolean; notifierOnly: boolean; boards: string[] }
export interface TeamConfig { code: string; slug: string; name: string; status: 'active' | 'paused'; agents: AgentConfig[]; boards: BoardConfig[] }
export interface ClaudeConfig { timezone: string; ownerName: string; /** Writes to live boards; off until the owner turns it on (test copies are always writable). */ liveWrites: boolean; keyFile: string; icloudRoot?: string; teams: TeamConfig[]; testBoards: BoardConfig[] }

export class ClaudeConfigError extends Error {}

export function claudeConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.RUANG_CLAUDE_CONFIG ? path.resolve(env.RUANG_CLAUDE_CONFIG) : path.join(home, 'freelance-private', 'ruang-claude', 'teams.json')
}

const BOARD_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const TEAM_CODE = /^[A-Z]{1,4}\.\d{1,2}$/
const AGENT_CODE = /^[A-Z]{1,4}\.\d{1,2}\.[A-Z0-9]{1,3}$/
const COLUMN_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/
const COLUMN_LETTER = /^[A-Z]{1,2}$/
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,100}$/
/** Columns that date a row, in order of preference. */
const DATE_KEYS = ['postDate', 'found']

type Raw = Record<string, unknown>

/** `team ZZ.3` → `zz-3`, the team's address in the UI (#/claude/zz-3). */
export const teamSlug = (code: string) => code.toLowerCase().replace(/\./g, '-')

/** Column letters to a zero-based index: A → 0, Z → 25, AA → 26. */
export function columnIndex(letters: string): number {
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

function object(value: unknown, where: string): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClaudeConfigError(`${where} must be an object.`)
  return value as Raw
}
function text(value: unknown, where: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) throw new ClaudeConfigError(`${where} must be a short line of text.`)
  if (pattern && !pattern.test(value)) throw new ClaudeConfigError(`${where} has an invalid value.`)
  return value
}
function texts(value: unknown, where: string, optional = false): string[] {
  if (value === undefined && optional) return []
  if (!Array.isArray(value)) throw new ClaudeConfigError(`${where} must be a list.`)
  return value.map((item, index) => text(item, `${where}[${index}]`))
}

function parseColumns(value: unknown, where: string): ColumnSpec[] {
  const columns = Object.entries(object(value, where)).map(([key, raw]) => {
    if (!COLUMN_KEY.test(key)) throw new ClaudeConfigError(`${where}: invalid column name "${key}".`)
    const spec = object(raw, `${where}.${key}`)
    const col = text(spec.col, `${where}.${key}.col`, COLUMN_LETTER)
    const role = spec.role === undefined ? undefined : text(spec.role, `${where}.${key}.role`) as Role
    if (role && !ROLES.includes(role)) throw new ClaudeConfigError(`${where}.${key}: unknown role "${role}".`)
    return { key, col, index: columnIndex(col), header: text(spec.header, `${where}.${key}.header`), ...(role ? { role } : {}) }
  })
  if (!columns.length) throw new ClaudeConfigError(`${where} lists no columns.`)
  const letters = new Set<string>()
  for (const column of columns) {
    if (letters.has(column.col)) throw new ClaudeConfigError(`${where}: column ${column.col} is used twice.`)
    letters.add(column.col)
  }
  for (const role of ROLES.filter((item) => item !== 'readonly')) {
    if (columns.filter((column) => column.role === role).length > 1) throw new ClaudeConfigError(`${where}: more than one column has the role "${role}".`)
  }
  return columns
}

function parseStatusRule(value: unknown, where: string): BoardConfig['ganiCanSetStatus'] {
  if (value === undefined) return []
  if (Array.isArray(value)) return texts(value, where)
  return Object.fromEntries(Object.entries(object(value, where)).map(([from, to]) => [text(from, `${where} key`), texts(to, `${where}.${from}`)]))
}

function parseNeedsYou(value: unknown, where: string, columns: ColumnSpec[]): NeedsYouRule | null {
  if (value === null || value === undefined) return null
  const raw = object(value, where)
  const rule: NeedsYouRule = { status: texts(raw.status, `${where}.status`) }
  if (raw.reason !== undefined) rule.reason = text(raw.reason, `${where}.reason`)
  if (raw.sortBy !== undefined) {
    const [column, direction = 'asc'] = text(raw.sortBy, `${where}.sortBy`).split(/\s+/)
    if (!columns.some((item) => item.key === column) || (direction !== 'asc' && direction !== 'desc')) throw new ClaudeConfigError(`${where}.sortBy must be "<column> asc|desc".`)
    rule.sortBy = { column, direction }
  }
  return rule
}

function parseBoard(raw: Raw, where: string, team: string): BoardConfig {
  const id = text(raw.id, `${where}.id`, BOARD_ID)
  const columns = parseColumns(raw.columns, `${where}.columns`)
  const known = (key: string, what: string) => {
    if (!columns.some((column) => column.key === key)) throw new ClaudeConfigError(`Board ${id}: ${what} names the unknown column "${key}".`)
    return key
  }
  const kind = raw.kind === undefined ? 'table' : raw.kind
  if (kind !== 'table' && kind !== 'taskflow') throw new ClaudeConfigError(`Board ${id}: kind must be "table" or "taskflow".`)
  const rowKey = texts(raw.rowKey, `${where}.rowKey`).map((key) => known(key, 'rowKey'))
  if (!rowKey.length) throw new ClaudeConfigError(`Board ${id}: rowKey is empty.`)
  const writableColumns = texts(raw.writableColumns, `${where}.writableColumns`, true).map((key) => known(key, 'writableColumns'))
  for (const key of writableColumns) {
    const column = columns.find((item) => item.key === key)!
    if (column.role === 'readonly' || rowKey.includes(key)) throw new ClaudeConfigError(`Board ${id}: column "${key}" cannot be writable (read-only or part of the row key).`)
  }
  if (!columns.some((column) => column.role === 'title')) throw new ClaudeConfigError(`Board ${id}: no column has the role "title".`)
  if (kind === 'taskflow') {
    for (const role of ['id', 'status', 'owner', 'dependsOn'] as const) if (!columns.some((column) => column.role === role)) throw new ClaudeConfigError(`Board ${id}: a task-flow board needs a column with the role "${role}".`)
  }
  const files = raw.files === undefined ? undefined : object(raw.files, `${where}.files`)
  const dateColumn = DATE_KEYS.find((key) => columns.some((column) => column.key === key))
  return {
    id,
    title: text(raw.title, `${where}.title`),
    team,
    kind,
    spreadsheetId: text(raw.spreadsheetId, `${where}.spreadsheetId`, SPREADSHEET_ID),
    tab: text(raw.tab, `${where}.tab`),
    rowKey,
    columns,
    statuses: texts(raw.statuses, `${where}.statuses`, true),
    unlockStatuses: texts(raw.unlockStatuses, `${where}.unlockStatuses`, true),
    needsYou: parseNeedsYou(raw.needsYou, `${where}.needsYou`, columns),
    ganiCanSetStatus: parseStatusRule(raw.ganiCanSetStatus, `${where}.ganiCanSetStatus`),
    neverTouchStatus: texts(raw.neverTouchStatus, `${where}.neverTouchStatus`, true),
    writableColumns,
    ...(files ? { files: { root: relativeRoot(files.root, `${where}.files.root`), ...(files.pattern !== undefined ? { pattern: text(files.pattern, `${where}.files.pattern`) } : {}) } } : {}),
    ...(dateColumn ? { dateColumn } : {}),
  }
}

/** A folder below the iCloud root: relative, no `..`, no hidden parts. */
function relativeRoot(value: unknown, where: string): string {
  const root = text(value, where)
  if (path.isAbsolute(root) || root.split('/').some((part) => part === '..' || part.startsWith('.'))) throw new ClaudeConfigError(`${where} must be a folder inside the iCloud root.`)
  return root
}

export function parseClaudeConfig(value: unknown): ClaudeConfig {
  const raw = object(value, 'The config')
  if (raw.version !== 1) throw new ClaudeConfigError('Unsupported config version (expected 1).')
  const timezone = raw.timezone === undefined ? 'Asia/Jakarta' : text(raw.timezone, 'timezone')
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { throw new ClaudeConfigError(`Unknown timezone "${timezone}".`) }
  // The owner's name as the sheets use it (the heading of its notes blocks); neutral when not configured.
  const ownerName = raw.ownerName === undefined ? 'Owner' : text(raw.ownerName, 'ownerName', /^[\p{L}][\p{L} .'-]{0,39}$/u)
  const keyFile = text(raw.serviceAccountKeyFile, 'serviceAccountKeyFile')
  if (!path.isAbsolute(keyFile)) throw new ClaudeConfigError('serviceAccountKeyFile must be an absolute path.')
  let icloudRoot: string | undefined
  if (raw.icloudRoot !== undefined) {
    icloudRoot = text(raw.icloudRoot, 'icloudRoot')
    if (!path.isAbsolute(icloudRoot)) throw new ClaudeConfigError('icloudRoot must be an absolute path.')
  }
  if (!Array.isArray(raw.teams)) throw new ClaudeConfigError('teams must be a list.')
  const ids = new Set<string>()
  const claim = (board: BoardConfig) => {
    if (ids.has(board.id)) throw new ClaudeConfigError(`Board id "${board.id}" is used twice.`)
    ids.add(board.id)
    return board
  }
  const teams: TeamConfig[] = raw.teams.map((item, index) => {
    const team = object(item, `teams[${index}]`)
    const code = text(team.code, `teams[${index}].code`, TEAM_CODE)
    const status = team.status ?? 'active'
    if (status !== 'active' && status !== 'paused') throw new ClaudeConfigError(`Team ${code}: status must be "active" or "paused".`)
    if (!Array.isArray(team.boards) || !Array.isArray(team.agents)) throw new ClaudeConfigError(`Team ${code}: boards and agents must be lists.`)
    const boards = team.boards.map((board, at) => claim(parseBoard(object(board, `${code}.boards[${at}]`), `${code}.boards[${at}]`, code)))
    const agents = team.agents.map((agent, at): AgentConfig => {
      const where = `${code}.agents[${at}]`
      const rawAgent = object(agent, where)
      const agentCode = text(rawAgent.code, `${where}.code`, AGENT_CODE)
      if (!agentCode.startsWith(`${code}.`)) throw new ClaudeConfigError(`Agent ${agentCode} does not belong to team ${code}.`)
      const agentBoards = texts(rawAgent.boards, `${where}.boards`, true)
      for (const board of agentBoards) if (!boards.some((item) => item.id === board)) throw new ClaudeConfigError(`Agent ${agentCode} names the unknown board "${board}".`)
      return { code: agentCode, name: text(rawAgent.name, `${where}.name`), schedule: text(rawAgent.schedule, `${where}.schedule`), runsOnMac: rawAgent.runsOnMac === true, notifierOnly: rawAgent.notifierOnly === true, boards: agentBoards }
    })
    return { code, slug: teamSlug(code), name: text(team.name, `teams[${index}].name`), status, agents, boards }
  })
  const live = teams.flatMap((team) => team.boards)
  const testBoards = (raw.testBoards === undefined ? [] : Array.isArray(raw.testBoards) ? raw.testBoards : (() => { throw new ClaudeConfigError('testBoards must be a list.') })()).map((item, index) => {
    const test = object(item, `testBoards[${index}]`)
    const of = text(test.testCopyOf, `testBoards[${index}].testCopyOf`, BOARD_ID)
    const original = live.find((board) => board.id === of)
    if (!original) throw new ClaudeConfigError(`Test board ${String(test.id)} copies the unknown board "${of}".`)
    return claim({
      ...original,
      id: text(test.id, `testBoards[${index}].id`, BOARD_ID),
      title: `${original.title} (test copy)`,
      spreadsheetId: text(test.spreadsheetId, `testBoards[${index}].spreadsheetId`, SPREADSHEET_ID),
      tab: test.tab === undefined ? original.tab : text(test.tab, `testBoards[${index}].tab`),
      testCopyOf: of,
    })
  })
  if (raw.liveWrites !== undefined && typeof raw.liveWrites !== 'boolean') throw new ClaudeConfigError('liveWrites must be true or false.')
  return { timezone, ownerName, liveWrites: raw.liveWrites === true, keyFile, ...(icloudRoot ? { icloudRoot } : {}), teams, testBoards }
}

export async function loadClaudeConfig(file = claudeConfigPath()): Promise<ClaudeConfig> {
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new ClaudeConfigError(code === 'ENOENT' ? 'The Claude teams config was not found.' : `The Claude teams config cannot be read (${code ?? 'unknown error'}).`)
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new ClaudeConfigError('The Claude teams config is not valid JSON.') }
  return parseClaudeConfig(parsed)
}

/** Every board, live and test copies. */
export const allBoards = (config: ClaudeConfig) => [...config.teams.flatMap((team) => team.boards), ...config.testBoards]
export const findBoard = (config: ClaudeConfig, id: string) => allBoards(config).find((board) => board.id === id)
