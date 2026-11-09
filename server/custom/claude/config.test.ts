import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkHeaders, headerMessage, boardRange } from './board.js'
import { exampleConfig } from './example.fixture.js'
import { ClaudeConfigError, claudeConfigPath, columnIndex, findBoard, loadClaudeConfig, parseClaudeConfig, teamSlug } from './config.js'

type Item = Record<string, unknown>
type Config = { timezone: string; teams: { agents: Item[]; boards: Item[] }[]; testBoards: Item[] }
const variant = (change: (config: Config) => void) => { const config = exampleConfig() as unknown as Config; change(config); return config }
const board = (config: Config, team: number) => config.teams[team].boards[0]

describe('Claude config', () => {
  it('loads teams, agents and boards, and test copies inherit the live board', () => {
    const config = parseClaudeConfig(exampleConfig())
    expect(config.teams.map((team) => [team.code, team.slug, team.status])).toEqual([['ZZ.1', 'zz-1', 'active'], ['ZZ.3', 'zz-3', 'paused']])
    const drafts = findBoard(config, 'example-drafts')!
    expect(drafts.kind).toBe('table')
    expect(drafts.dateColumn).toBe('postDate')
    expect(drafts.ganiCanSetStatus).toEqual(['Posted', 'Skipped'])
    const lab = findBoard(config, 'example-lab')!
    expect(lab.columns.find((column) => column.key === 'title')!.index).toBe(26)
    expect(lab.ganiCanSetStatus).toEqual({ review: ['done'] })
    const copy = findBoard(config, 'example-lab-copy')!
    expect(copy).toMatchObject({ kind: 'taskflow', testCopyOf: 'example-lab', spreadsheetId: 'example-sheet-id-000000003', team: 'ZZ.3', title: 'Lab board (test copy)' })
    expect(copy.columns).toEqual(lab.columns)
    expect(config.teams[1].agents[1]).toMatchObject({ notifierOnly: true, runsOnMac: false, boards: [] })
  })

  it('converts column letters and slugs', () => {
    expect([columnIndex('A'), columnIndex('Z'), columnIndex('AA'), columnIndex('AZ')]).toEqual([0, 25, 26, 51])
    expect(teamSlug('ZZ.12')).toBe('zz-12')
  })

  it.each([
    ['a bad column letter', (config: Config) => { (board(config, 0).columns as Record<string, { col: string }>).topic.col = 'a1' }, /invalid value/],
    ['a column used twice', (config: Config) => { (board(config, 0).columns as Record<string, { col: string }>).topic.col = 'A' }, /used twice/],
    ['a read-only column made writable', (config: Config) => { board(config, 1).writableColumns = ['notified'] }, /cannot be writable/],
    ['a row key column made writable', (config: Config) => { board(config, 0).writableColumns = ['topic'] }, /cannot be writable/],
    ['an unknown writable column', (config: Config) => { board(config, 0).writableColumns = ['nope'] }, /unknown column/],
    ['an agent on an unknown board', (config: Config) => { config.teams[0].agents[0].boards = ['missing'] }, /unknown board/],
    ['an agent of another team', (config: Config) => { config.teams[0].agents[0].code = 'ZZ.3.Q' }, /does not belong/],
    ['a task-flow board without dependencies', (config: Config) => { delete (board(config, 1).columns as Record<string, unknown>).dependsOn }, /dependsOn/],
    ['a duplicate board id', (config: Config) => { config.testBoards[0].id = 'example-drafts' }, /used twice/],
    ['a test copy of an unknown board', (config: Config) => { config.testBoards[0].testCopyOf = 'missing' }, /unknown board/],
    ['a files root outside the iCloud root', (config: Config) => { board(config, 0).files = { root: '../Documents' } }, /inside the iCloud root/],
    ['a bad spreadsheet id', (config: Config) => { board(config, 0).spreadsheetId = 'x/../y' }, /invalid value/],
    ['an unknown timezone', (config: Config) => { config.timezone = 'Mars/Base' }, /Unknown timezone/],
    ['a bad sortBy', (config: Config) => { board(config, 0).needsYou = { status: ['Drafted'], sortBy: 'nope up' } }, /sortBy/],
  ])('refuses %s', (_name, change, message) => {
    expect(() => parseClaudeConfig(variant(change))).toThrow(message)
  })

  it('reads the file named by RUANG_CLAUDE_CONFIG and explains a missing one', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'ruang-claude-'))
    const file = path.join(folder, 'teams.json')
    await writeFile(file, JSON.stringify(exampleConfig()))
    expect(claudeConfigPath({ RUANG_CLAUDE_CONFIG: file })).toBe(file)
    expect(claudeConfigPath({}, '/home/example')).toBe('/home/example/freelance-private/ruang-claude/teams.json')
    expect((await loadClaudeConfig(file)).teams).toHaveLength(2)
    await expect(loadClaudeConfig(path.join(folder, 'missing.json'))).rejects.toThrow(new ClaudeConfigError('The Claude teams config was not found.'))
    await writeFile(file, '{ not json')
    await expect(loadClaudeConfig(file)).rejects.toThrow(/not valid JSON/)
  })
})

describe('header check', () => {
  const lab = findBoard(parseClaudeConfig(exampleConfig()), 'example-lab')!
  const header = () => { const row: string[] = Array(27).fill(''); Object.assign(row, ['ID', 'Owner', 'Depends on', 'Status', 'Notified']); row[26] = 'Title'; return row }

  it('accepts matching headers (spaces trimmed) and names a moved column', () => {
    expect(checkHeaders(lab, header())).toEqual([])
    const spaced = header(); spaced[2] = '  Depends   on '
    expect(checkHeaders(lab, spaced)).toEqual([])
    // Someone inserted a column before Status: D now holds something else, the rest shifts.
    const moved = header(); moved.splice(3, 0, 'New column')
    const problems = checkHeaders(lab, moved)
    expect(problems.map((problem) => problem.column)).toEqual(['D', 'E', 'AA'])
    expect(headerMessage(problems)).toMatch(/^Column header mismatch, so this board is read-only: D should be "Status" but is "New column"/)
    expect(checkHeaders(lab, ['ID'])[0]).toMatchObject({ column: 'B', found: '' })
  })

  it('reads the whole board in one quoted range', () => {
    expect(boardRange(lab)).toBe("'Tasks'!A1:AA")
    expect(boardRange({ ...lab, tab: "Owner's ideas" })).toBe("'Owner''s ideas'!A1:AA")
  })
})
