// custom: display helpers of the Claude pages (no data is invented here).
import type { AgentState, BoardView, CardSummary } from './types.ts'

export const OVERVIEW_PATH = '/api/custom/claude/teams'
export const POLL_MS = 60_000

/** `#/claude/zz-3` → `zz-3`; the overview has none. */
export function teamFromHash(hash: string): string | undefined {
  const [page, team] = hash.replace(/^#\/?/, '').split(/[/?]/)
  return page?.toLowerCase() === 'claude' && team && /^[a-z]{1,4}-\d{1,2}$/.test(team.toLowerCase()) ? team.toLowerCase() : undefined
}
export const teamHash = (slug?: string) => (slug ? `#/claude/${slug}` : '#/claude')
/** `#/claude/zz-3?agent=ZZ.3.B` → `ZZ.3.B` (the agent filter, used by the 3D wing's links). */
export function agentFromHash(hash: string): string | undefined {
  const agent = new URLSearchParams(hash.split('?')[1] ?? '').get('agent')
  return agent && /^[A-Z]{1,4}\.\d{1,2}\.[A-Z0-9]{1,3}$/.test(agent) ? agent : undefined
}

/** Statuses after which the owner has nothing left to do; their groups start collapsed. */
const FINISHED = new Set(['done', 'approved', 'rejected', 'posted', 'scheduled', 'skipped', 'expired', 'used', 'won', 'lost', 'applied', 'sent', 'do-not-contact', 'backup'])

export function statusTone(statusKey: string, needsYou: ReadonlySet<string>): 'good' | 'unknown' | 'muted' | 'bad' | 'info' {
  if (needsYou.has(statusKey)) return 'unknown'
  if (['in progress'].includes(statusKey)) return 'good'
  if (['blocked', 'rejected', 'lost', 'do-not-contact'].includes(statusKey)) return 'bad'
  if (['ready', 'changes requested', 'waiting', 'new', 'unused'].includes(statusKey)) return 'info'
  return 'muted'
}

export const AGENT_TONE: Record<AgentState, 'good' | 'unknown' | 'muted' | 'bad' | 'info'> = {
  Working: 'good', 'Waiting for you': 'unknown', Queued: 'info', Idle: 'muted', 'Ran today': 'good', 'Not run yet today': 'muted', Paused: 'muted', Notifier: 'muted', Unknown: 'unknown',
}

export interface StatusGroup { key: string; label: string; cards: CardSummary[]; collapsed: boolean; needsYou: boolean }

/** Cards grouped by status: Needs-you statuses first, then the rest by size; finished groups collapsed. */
export function statusGroups(board: BoardView): StatusGroup[] {
  const needs = needsYouStatuses(board)
  const groups = new Map<string, CardSummary[]>()
  for (const card of board.cards) groups.set(card.statusKey, [...(groups.get(card.statusKey) ?? []), card])
  return [...groups].map(([key, cards]) => ({ key, label: key || '(no status)', cards, collapsed: FINISHED.has(key), needsYou: needs.has(key) }))
    .sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || Number(a.collapsed) - Number(b.collapsed) || b.cards.length - a.cards.length || a.key.localeCompare(b.key))
}

export function needsYouStatuses(board: BoardView): Set<string> {
  return new Set(board.needsYou.map((row) => board.cards.find((card) => card.row === row)?.statusKey).filter((key): key is string => Boolean(key)))
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** One line per card: what it unlocks, or what it waits for. */
export function relationLine(card: CardSummary): string {
  const relations = card.relations
  if (!relations) return ''
  if (relations.column === 'waiting' && relations.waitsFor.length) return `Waits for ${relations.waitsFor.join(', ')}`
  if (relations.unlocks.length) return `Unlocks ${relations.unlocks.slice(0, 4).join(', ')}${relations.unlocks.length > 4 ? ` +${relations.unlocks.length - 4}` : ''}`
  return ''
}

export interface SortState { column: string; direction: 'asc' | 'desc' }

/** Sorts table rows by one column; numbers as numbers, empty values last. An empty column keeps the given order. */
export function sortCards(cards: readonly CardSummary[], sort: SortState): CardSummary[] {
  if (!sort.column) return [...cards]
  const value = (card: CardSummary) => card.values?.[sort.column] ?? ''
  return [...cards].sort((a, b) => {
    const [x, y] = [value(a), value(b)]
    if (!x || !y) return x ? -1 : y ? 1 : a.row - b.row
    const numeric = Number.isFinite(Number(x)) && Number.isFinite(Number(y))
    const order = numeric ? Number(x) - Number(y) : x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' })
    return (sort.direction === 'asc' ? order : -order) || a.row - b.row
  })
}

/** Opens a team page from the office (3D wing or 2D section); with an agent, filtered to its cards. */
export const openClaudeAgent = (team: string, agent: string) => { window.location.hash = `/claude/${team}?agent=${encodeURIComponent(agent)}` }
export const openClaudeTeam = (team: string) => { window.location.hash = teamHash(team).slice(1) }
