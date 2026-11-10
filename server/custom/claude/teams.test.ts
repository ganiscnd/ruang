import { mkdtemp, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import { describe, expect, it } from 'vitest'
import { knownStatuses, readBoard, rowTitle, statusKey, type BoardRead } from './board.js'
import { findBoard, parseClaudeConfig, type TeamConfig } from './config.js'
import { exampleConfig } from './example.fixture.js'
import { installClaude } from './routes.js'
import { localDate, nextRun, runTimes } from './schedule.js'
import { SheetsError, type SheetsApi } from './sheets.js'
import { agentLine, collectClaude, tableColumns, type ClaudeData } from './teams.js'

// 2026-11-09 09:30 in Jakarta (UTC+7).
const NOW = Date.parse('2026-11-09T02:30:00Z')
const TZ = 'Asia/Jakarta'

describe('schedule', () => {
  it('understands the config forms and nothing else', () => {
    expect(runTimes('daily 05:30')).toEqual([330])
    expect(runTimes('daily 19:00, 07:00')).toEqual([420, 1140])
    const hourly = runTimes('hourly at :05, 08:00-21:00')!
    expect(hourly[0]).toBe(8 * 60 + 5)
    expect(hourly.at(-1)).toBe(20 * 60 + 5)
    expect(hourly).toHaveLength(13)
    for (const unknown of ['weekly monday', 'daily 25:00', 'daily 9:00', 'every 5 minutes']) expect(runTimes(unknown)).toBeUndefined()
  })

  it('gives the next run in the configured time zone', () => {
    expect(nextRun({ schedule: 'daily 10:00', runsOnMac: true }, false, NOW, TZ)).toEqual({ at: '2026-11-09T03:00:00.000Z', label: '10:00 WIB' })
    expect(nextRun({ schedule: 'daily 09:00', runsOnMac: true }, false, NOW, TZ)).toEqual({ at: '2026-11-10T02:00:00.000Z', label: 'Tomorrow 09:00 WIB' })
    expect(nextRun({ schedule: 'daily 07:00, 19:00', runsOnMac: false }, false, NOW, TZ).label).toBe('19:00 WIB')
    expect(nextRun({ schedule: 'hourly at :05, 08:00-21:00', runsOnMac: false }, false, NOW, TZ).label).toBe('10:05 WIB')
    expect(nextRun({ schedule: 'daily 10:00', runsOnMac: true }, true, NOW, TZ)).toEqual({ label: 'Paused' })
    expect(nextRun({ schedule: 'sometimes', runsOnMac: true }, false, NOW, TZ)).toEqual({ label: 'Unknown schedule' })
  })

  it('flags Mac runs outside the power window (05:30-22:55) only for tasks on the Mac', () => {
    expect(nextRun({ schedule: 'daily 23:30', runsOnMac: true }, false, NOW, TZ)).toMatchObject({ label: '23:30 WIB', macOff: true })
    expect(nextRun({ schedule: 'daily 05:30', runsOnMac: true }, false, NOW, TZ).macOff).toBeUndefined()
    expect(nextRun({ schedule: 'daily 23:30', runsOnMac: false }, false, NOW, TZ).macOff).toBeUndefined()
  })

  it('dates by the local calendar', () => {
    expect(localDate(Date.parse('2026-11-09T17:30:00Z'), TZ)).toBe('2026-11-10')
    expect(localDate(NOW, TZ)).toBe('2026-11-09')
  })
})

const config = parseClaudeConfig(exampleConfig())
const drafts = findBoard(config, 'example-drafts')!
const lab = findBoard(config, 'example-lab')!

describe('board reading', () => {
  it('groups statuses: known ones whole, free text by its first word, case-insensitive', () => {
    const known = knownStatuses({ ...lab, statuses: ['changes requested', 'in progress'] })
    expect(statusKey('Changes  Requested', known)).toBe('changes requested')
    expect(statusKey('In progress', known)).toBe('in progress')
    expect(statusKey('used 2026-11-01 (c)', known)).toBe('used')
    expect(statusKey('Backup (in drafts/_backup/)', known)).toBe('backup')
    expect(statusKey('  ', known)).toBe('')
  })

  it('reads non-empty rows with their sheet row number', async () => {
    const sheets: SheetsApi = { batchGet: async () => [[['Post date', 'Topic', 'Status', 'Owner notes'], ['2026-11-09', 'Example topic', 'Drafted'], [], ['', '', '', ''], ['2026-11-08', ' Older topic ', 'Posted', 'ok']]] }
    const read = await readBoard(drafts, sheets, NOW)
    expect(read).toMatchObject({ availability: 'available', fetchedAt: '2026-11-09T02:30:00.000Z' })
    expect(read.readOnly).toBeUndefined()
    expect(read.rows).toEqual([
      { row: 2, cells: { postDate: '2026-11-09', topic: 'Example topic', status: 'Drafted', ganiNotes: '' } },
      { row: 5, cells: { postDate: '2026-11-08', topic: 'Older topic', status: 'Posted', ganiNotes: 'ok' } },
    ])
  })

  it('makes a board with a moved column read-only and hides that column', async () => {
    const sheets: SheetsApi = { batchGet: async () => [[['Post date', 'Topic', 'Mood', 'Owner notes'], ['2026-11-09', 'Example topic', 'happy', '']]] }
    const read = await readBoard(drafts, sheets, NOW)
    expect(read.readOnly).toMatch(/C should be "Status" but is "Mood"/)
    expect(read.rows[0].cells.status).toBe('')
  })

  it('turns a failed read into an unavailable board', async () => {
    const sheets: SheetsApi = { batchGet: async () => { throw new SheetsError('The spreadsheet was not found.', 'not-found') } }
    expect(await readBoard(drafts, sheets, NOW)).toMatchObject({ availability: 'unavailable', reason: 'The spreadsheet was not found.', rows: [] })
  })

  it('titles a row by its title column, else the first 8 words of the task', () => {
    const board = { columns: [{ key: 'title', col: 'A', index: 0, header: 'Title', role: 'title' as const }, { key: 'task', col: 'B', index: 1, header: 'Task', role: 'description' as const }] }
    expect(rowTitle(board, { row: 2, cells: { title: 'Short', task: 'x' } })).toBe('Short')
    expect(rowTitle(board, { row: 2, cells: { title: '', task: 'one two three four five six seven eight nine' } })).toBe('one two three four five six seven eight…')
    expect(rowTitle(board, { row: 2, cells: { title: '', task: '' } })).toBe('(no title)')
  })
})

const read = (board: typeof lab, rows: string[][], availability: 'available' | 'unavailable' = 'available'): BoardRead => ({ board, fetchedAt: '2026-11-09T02:15:00.000Z', availability, ...(availability === 'unavailable' ? { reason: 'The spreadsheet was not found.' } : {}), rows: rows.map((cells, index) => ({ row: index + 2, cells: Object.fromEntries(board.columns.map((column, at) => [column.key, cells[at] ?? ''])) })) })

describe('agent states', () => {
  const team: TeamConfig = { ...config.teams[1], status: 'active' }
  const agent = { code: 'ZZ.3.A', name: 'Example builder', schedule: 'daily 10:00', runsOnMac: true, notifierOnly: false, boards: [] }
  const state = (rows: string[][]) => agentLine(agent, team, new Map([[lab.id, read(lab, rows)]]), config, NOW)

  it('derives task-flow states from the agent\'s own rows only', () => {
    expect(state([['T01', 'ZZ.3.A', '', 'In progress'], ['T02', 'ZZ.3.A', '', 'review']])).toMatchObject({ state: 'Working', detail: 'In progress: T01', provenance: 'from Lab board, read 09:15', nextRun: { label: '10:00 WIB' } })
    expect(state([['T01', 'ZZ.3.A', '', 'ready'], ['T02', 'ZZ.3.A', '', 'review']])).toMatchObject({ state: 'Waiting for you', detail: 'In review: T02' })
    expect(state([['T01', 'ZZ.3.A', '', 'changes requested'], ['T02', 'ZZ.3.B', '', 'in progress']])).toMatchObject({ state: 'Queued', detail: '1 task queued' })
    expect(state([['T01', 'ZZ.3.A', '', 'done']])).toMatchObject({ state: 'Idle' })
    expect(agentLine(agent, team, new Map([[lab.id, read(lab, [], 'unavailable')]]), config, NOW)).toMatchObject({ state: 'Unknown', detail: 'Not Available: The spreadsheet was not found.' })
  })

  it('says "Ran today" for table-board agents only when rows are dated today, never Working', () => {
    const writer = { ...config.teams[0].agents[0] }
    const content = config.teams[0]
    const line = (rows: string[][]) => agentLine(writer, content, new Map([[drafts.id, read(drafts, rows)]]), config, NOW)
    expect(line([['2026-11-09', 'A', 'Drafted'], ['2026-11-09', 'B', 'Drafted'], ['2026-11-08', 'C', 'Posted']])).toMatchObject({ state: 'Ran today', detail: '2 rows dated today (Drafts).' })
    expect(line([['2026-11-08', 'C', 'in progress']])).toMatchObject({ state: 'Not run yet today', nextRun: { label: 'Tomorrow 06:00 WIB' } })
  })

  it('shows paused teams as Paused and the notifier as Notifier', () => {
    expect(agentLine(agent, { ...team, status: 'paused' }, new Map(), config, NOW)).toMatchObject({ state: 'Paused', nextRun: { label: 'Paused' } })
    expect(agentLine({ ...agent, code: 'ZZ.3.0', notifierOnly: true }, team, new Map(), config, NOW)).toMatchObject({ state: 'Notifier' })
  })
})

async function collect(sheets: SheetsApi) {
  const raw = exampleConfig() as { teams: { status: string }[] }
  raw.teams[1].status = 'active'
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'ruang-claude-')), 'teams.json')
  await writeFile(file, JSON.stringify(raw))
  return collectClaude({ sheets: () => sheets, configFile: file, now: () => NOW, probe: async () => ({ ok: false, code: 'ENOENT' }) })
}

const fakeSheets: SheetsApi = {
  async batchGet(id) {
    if (id === 'example-sheet-id-000000001') return [[['Post date', 'Topic', 'Status', 'Owner notes'], ['2026-11-09', 'Example topic', 'Drafted'], ['2026-11-07', 'Older topic', 'Drafted'], ['2026-11-06', 'Old topic', 'Posted'], ['2026-11-06', 'Spare', 'backup (spare)']]]
    if (id === 'example-sheet-id-000000002') { const header = ['ID', 'Owner', 'Depends on', 'Status', 'Notified']; return [[header, ['T02', 'ZZ.3.A', '', 'review'], ['T01', 'ZZ.3.A', '', 'review'], ['T03', 'ZZ.3.A', 'T01', 'waiting'], ['T04', 'ZZ.3.A', '', 'in progress']]] }
    throw new SheetsError('The spreadsheet is not shared with the service account, or the Google Sheets API is not enabled.', 'not-shared')
  },
}

describe('Claude overview', () => {
  it('summarises every team from its boards, test copies listed but not counted', async () => {
    const data = await collect(fakeSheets)
    expect(data).toMatchObject({ availability: 'available', ownerName: 'Owner', timezone: TZ })
    const [content, lab] = data.teams
    // One "Drafted" row is dated before today: it moves to Old drafts, not posted.
    expect(content).toMatchObject({ slug: 'zz-1', needsYou: 1, incomplete: false, working: null, waiting: null, nextRun: { agent: 'ZZ.1.A', run: { label: 'Tomorrow 06:00 WIB' } } })
    expect(content.agents[0]).toMatchObject({ state: 'Ran today' })
    // The lab board's Title column (AA) is not in the fake sheet: read-only, titles from nothing.
    expect(lab).toMatchObject({ needsYou: 2, working: 1, waiting: 1, incomplete: false })
    expect(lab.boards.map((board) => [board.id, board.availability, board.testCopy])).toEqual([['example-lab', 'available', false], ['example-lab-copy', 'unavailable', true]])
    expect(data.boards['example-lab'].readOnly).toMatch(/AA should be "Title"/)
    expect(data.boards['example-lab'].needsYou).toEqual([3, 2])
    expect(data.boards['example-drafts'].cards.map((card) => card.statusKey)).toEqual(['drafted', 'drafted', 'posted', 'backup'])
    expect(data.boards['example-drafts'].files).toMatchObject({ status: 'missing' })
    expect(data.boards['example-drafts'].needsYou).toEqual([2])
    expect(data.boards['example-drafts'].table).toEqual({
      columns: [{ key: 'postDate', header: 'Post date', kind: 'date' }, { key: 'topic', header: 'Topic', kind: 'title' }, { key: 'status', header: 'Status', kind: 'status' }],
      stale: { label: 'Old drafts, not posted', rows: [3] },
    })
    expect(data.boards['example-drafts'].cards[0].values).toEqual({ postDate: '2026-11-09', topic: 'Example topic', status: 'Drafted' })
    expect(data.boards['example-lab'].table).toBeUndefined()
    expect(data.teams[1].agents.map((agent) => agent.state)).toEqual(['Working', 'Notifier'])
  })

  it('reports an unreadable config without failing', async () => {
    expect(await collectClaude({ sheets: () => fakeSheets, configFile: '/nonexistent/teams.json', now: () => NOW })).toMatchObject({ availability: 'unavailable', reason: 'The Claude teams config was not found.', teams: [] })
  })
})

describe('Claude routes', () => {
  async function serve(data: ClaudeData | Promise<never>, timeoutMs?: number) {
    const app = express()
    installClaude(app, { source: () => (data instanceof Promise ? data : Promise.resolve(data)), ...(timeoutMs ? { timeoutMs } : {}) })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { get: (url: string) => fetch(`${base}${url}`), close: () => server.close() }
  }

  it('serves the overview without board rows and one team with its boards', async () => {
    const data = await collect(fakeSheets)
    const api = await serve(data)
    try {
      const overview = await (await api.get('/api/custom/claude/teams')).json() as Record<string, unknown>
      expect(overview.boards).toBeUndefined()
      expect((overview.teams as unknown[]).length).toBe(2)
      const team = await (await api.get('/api/custom/claude/teams/zz-3')).json() as { boards: { id: string }[]; team: { code: string } }
      expect(team.team.code).toBe('ZZ.3')
      expect(team.boards.map((board) => board.id)).toEqual(['example-lab', 'example-lab-copy'])
      expect((await api.get('/api/custom/claude/teams/zz-9')).status).toBe(404)
      expect((await api.get('/api/custom/claude/teams/..%2Fetc')).status).toBe(400)
      expect(JSON.stringify(overview) + JSON.stringify(team)).not.toMatch(/example-sheet-id|example-icloud|example-key/)
    } finally {
      api.close()
    }
  })

  it('answers 503 with the reason when the boards never load, instead of hanging', async () => {
    const api = await serve(new Promise<never>(() => {}), 30)
    try {
      const response = await api.get('/api/custom/claude/teams')
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Not Available: the Claude boards did not load within 0 seconds.' })
    } finally {
      api.close()
    }
  })
})

describe('table columns', () => {
  const board = findBoard(parseClaudeConfig(exampleConfig()), 'example-drafts')!
  const columns = [...board.columns, { key: 'slot', col: 'E', index: 4, header: 'Slot' }, { key: 'visual', col: 'F', index: 5, header: 'Visual style' }, { key: 'source', col: 'G', index: 6, header: 'Main source' }]
  const rows = [{ row: 2, cells: { postDate: '2026-11-09', topic: 'T', status: 'Drafted', ganiNotes: '', slot: 'a', visual: 'a long description of the visual style here', source: 'https://example.com/x' } }]

  it('picks date, title, status, score and the first short plain column; never long text or links', () => {
    expect(tableColumns({ ...board, columns }, rows).map((column) => column.key)).toEqual(['postDate', 'topic', 'status', 'slot'])
    expect(tableColumns({ ...board, columns: columns.filter((column) => column.key !== 'slot') }, rows).map((column) => column.key)).toEqual(['postDate', 'topic', 'status'])
  })

  it('uses the config\'s tableColumns when set', () => {
    expect(tableColumns({ ...board, columns, tableColumns: ['topic', 'visual'] }, rows)).toEqual([{ key: 'topic', header: 'Topic', kind: 'title' }, { key: 'visual', header: 'Visual style', kind: 'text' }])
  })
})
