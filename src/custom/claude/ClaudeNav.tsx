// custom: the Claude group in the sidebar, one entry per team from the private config.
import type { ReactNode } from 'react'
import { usePolling } from '../../polling.ts'
import { OVERVIEW_PATH, POLL_MS, teamHash } from './claude-view.ts'
import type { ClaudeOverview } from './types.ts'

export function ClaudeNav({ active, current, onNavigate }: { active: boolean; current?: string; onNavigate: (hash: string) => void }) {
  const overview = usePolling<ClaudeOverview>(OVERVIEW_PATH, POLL_MS)
  const teams = overview.status === 'ready' ? overview.data.teams : []
  const link = (hash: string, label: string, selected: boolean, extra?: ReactNode, key = hash) => <a key={key} href={hash} className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate(hash) }}>{label}{extra}</a>
  return <>
    <p className="nav-group">Claude</p>
    {link(teamHash(), 'Claude', active && !current)}
    {teams.map((team) => link(teamHash(team.slug), `${team.code} ${team.name}`, active && current === team.slug,
      team.status === 'paused' ? <span className="nav-tag">PAUSED</span> : team.needsYou ? <span className="nav-badge claude-badge" title="Needs you">{team.needsYou}</span> : null))}
  </>
}
