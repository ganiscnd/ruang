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
