import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Polled } from '../../polling.ts'
import { pageFromHash } from '../../routes.ts'
import { statusGroups, teamFromHash } from './claude-view.ts'
import { ClaudeOverviewView } from './pages/ClaudeOverview.tsx'
import { ClaudeTeamView } from './pages/ClaudeTeam.tsx'
import type { BoardView, ClaudeOverview, ClaudeTeamData, TeamSummary } from './types.ts'

// Invented teams and rows.
const ready = <T,>(data: T): Polled<T> => ({ status: 'ready', refreshing: false, refresh: () => {}, data })
const team = (extra: Partial<TeamSummary> = {}): TeamSummary => ({
  slug: 'zz-3', code: 'ZZ.3', name: 'Example lab', status: 'active', needsYou: 2, incomplete: false, working: 1, waiting: 3,
  nextRun: { agent: 'ZZ.3.B', run: { at: '2026-11-09T03:00:00.000Z', label: '10:00 WIB' } },
  boards: [{ id: 'example-lab', title: 'Lab board', availability: 'available', testCopy: false }],
  agents: [{ code: 'ZZ.3.B', name: 'Example builder', state: 'Waiting for you', detail: 'In review: T02', nextRun: { label: '10:00 WIB' }, runsOnMac: true, notifierOnly: false, provenance: 'from Lab board, read 09:15' }],
  ...extra,
})
/** Table boards get two table columns (title, status) and their values, as the server sends them. */
const board = (extra: Partial<BoardView> = {}): BoardView => {
  const view = baseBoard(extra)
  return view.kind === 'table' && !view.table ? { ...view, table: { columns: [{ key: 'title', header: 'Title', kind: 'title' }, { key: 'status', header: 'Status', kind: 'status' }] }, cards: view.cards.map((card) => ({ ...card, values: { title: card.title, status: card.status } })) } : view
}
const baseBoard = (extra: Partial<BoardView> = {}): BoardView => ({
  id: 'example-lab', title: 'Lab board', kind: 'taskflow', testCopy: false, fetchedAt: '2026-11-09T02:15:00.000Z', availability: 'available', needsYouRule: true, neverTouch: [],
  cards: [
    { row: 2, key: 'T01', id: 'T01', title: 'Example done task', status: 'approved', statusKey: 'approved', owner: 'ZZ.3.A' },
    { row: 3, key: 'T02', id: 'T02', title: 'Example review task', status: 'review', statusKey: 'review', owner: 'ZZ.3.B' },
    { row: 4, key: 'T03', id: 'T03', title: 'Example waiting task', status: 'waiting', statusKey: 'waiting', owner: 'ZZ.3.B' },
  ],
  needsYou: [3],
  ...extra,
})

describe('Claude routes', () => {
  it('opens the Claude page for the overview and any team', () => {
    expect(pageFromHash('#/claude')).toBe('Claude')
    expect(pageFromHash('#/claude/zz-3')).toBe('Claude')
    expect(teamFromHash('#/claude/zz-3')).toBe('zz-3')
    expect(teamFromHash('#/claude/ZZ-1?agent=x')).toBe('zz-1')
    expect(teamFromHash('#/claude')).toBeUndefined()
    expect(teamFromHash('#/claude/../x')).toBeUndefined()
    expect(teamFromHash('#/office/zz-3')).toBeUndefined()
  })
})

describe('Claude overview', () => {
  const overview = (teams: TeamSummary[]): ClaudeOverview => ({ availability: 'available', ownerName: 'Owner', timezone: 'Asia/Jakarta', fetchedAt: '2026-11-09T02:15:00.000Z', teams })

  it('shows a card per team with the Needs-you count, paused teams marked', () => {
    const markup = renderToStaticMarkup(<ClaudeOverviewView overview={ready(overview([team(), team({ slug: 'zz-2', code: 'ZZ.2', name: 'Example sales', status: 'paused', working: null, waiting: null, nextRun: { agent: '', run: { label: 'Paused' } } })]))}/>)
    expect(markup).toContain('ZZ.3.B 10:00 WIB')
    expect(markup).toContain('PAUSED')
    expect(markup).toContain('Not tracked')
    expect(markup).toContain('href="#/claude/zz-2"')
  })

  it('never shows a count for a team whose boards cannot be read', () => {
    const markup = renderToStaticMarkup(<ClaudeOverviewView overview={ready(overview([team({ needsYou: null, working: null, boards: [{ id: 'example-lab', title: 'Lab board', availability: 'unavailable', reason: 'The spreadsheet was not found.', testCopy: false }] })]))}/>)
    expect(markup).toContain('<strong>—</strong>')
    expect(markup).toContain('Lab board: Not Available: The spreadsheet was not found.')
  })

  it('reports an unreadable config as Not Available', () => {
    const markup = renderToStaticMarkup(<ClaudeOverviewView overview={ready({ ...overview([]), availability: 'unavailable', reason: 'The Claude teams config was not found.' })}/>)
    expect(markup).toContain('Not Available')
    expect(markup).toContain('The Claude teams config was not found.')
  })
})

describe('Claude team page', () => {
  const data = (boards: BoardView[], extra: Partial<TeamSummary> = {}): ClaudeTeamData => ({ team: team(extra), boards, ownerName: 'Owner', timezone: 'Asia/Jakarta', fetchedAt: '2026-11-09T02:15:00.000Z' })

  it('shows agents with provenance, and a table board\'s Needs-you list and status groups', () => {
    const markup = renderToStaticMarkup(<ClaudeTeamView team={ready(data([board({ kind: 'table' })]))}/>)
    expect(markup).toContain('Waiting for you')
    expect(markup).toContain('from Lab board, read 09:15')
    expect(markup).toMatch(/Needs you.*Example review task/s)
    expect(markup).toMatch(/<details class="claude-group"><summary><span class="badge muted">approved/)
  })

  it('shows a read-only board\'s reason and a test copy badge', () => {
    const markup = renderToStaticMarkup(<ClaudeTeamView team={ready(data([board({ readOnly: 'Column header mismatch, so this board is read-only: F should be "Status".', testCopy: true })]))}/>)
    expect(markup).toContain('Column header mismatch')
    expect(markup).toContain('TEST COPY')
  })

  it('shows an unreadable board as Not Available with no rows', () => {
    const markup = renderToStaticMarkup(<ClaudeTeamView team={ready(data([board({ availability: 'unavailable', reason: 'Google cannot be reached (network).', cards: [], needsYou: [] })]))}/>)
    expect(markup).toContain('Google cannot be reached (network).')
    expect(markup).not.toContain('Nothing needs you')
  })

  it('groups free-text statuses by their first word but keeps the full text', () => {
    const groups = statusGroups(board({ kind: 'table', needsYou: [], cards: [
      { row: 2, key: 'a', title: 'Idea A', status: 'used 2026-11-01 (c)', statusKey: 'used' },
      { row: 3, key: 'b', title: 'Idea B', status: 'used 2026-11-02 (a)', statusKey: 'used' },
      { row: 4, key: 'c', title: 'Idea C', status: 'unused', statusKey: 'unused' },
    ] }))
    expect(groups.map((group) => [group.key, group.cards.length, group.collapsed])).toEqual([['unused', 1, false], ['used', 2, true]])
    const markup = renderToStaticMarkup(<ClaudeTeamView team={ready(data([board({ kind: 'table', needsYou: [], needsYouRule: false, cards: groups.flatMap((group) => group.cards) })]))}/>)
    expect(markup).toContain('used 2026-11-01 (c)')
    expect(markup).toContain('it has no Needs-you rule')
  })
})
