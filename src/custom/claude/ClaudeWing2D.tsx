// custom: the Claude wing in the 2D office: one block per team with its agents and Needs-you count.
import { AGENT_TONE, openClaudeAgent, teamHash } from './claude-view.ts'
import type { ClaudeOverview } from './types.ts'
import { wingCaption } from './wing-layout.ts'
import './claude.css'

export function ClaudeWing2D({ data }: { data?: ClaudeOverview }) {
  if (!data) return <p className="room-empty">Reading the Claude teams…</p>
  if (data.availability !== 'available') return <p className="room-empty">Claude teams: Not Available ({data.reason})</p>
  return <section className="pixel-room claude-wing-2d" aria-label="Claude wing">
    <div className="room-label"><span>Claude wing</span><small>{data.teams.length} TEAM{data.teams.length === 1 ? '' : 'S'} · FROM THEIR BOARDS</small></div>
    <div className="claude-wing-teams">{data.teams.map((team) => <article key={team.slug} className={`claude-wing-team${team.status === 'paused' ? ' paused' : ''}`}>
      <header><a href={teamHash(team.slug)}><span className="claude-code">{team.code}</span> {team.name}</a><span className={`badge ${team.status === 'paused' ? 'muted' : team.needsYou ? 'unknown' : 'good'}`}>{team.status === 'paused' ? 'PAUSED' : `${team.needsYou ?? '?'} NEED YOU`}</span></header>
      <div className="claude-wing-agents">{team.agents.map((agent) => <button key={agent.code} type="button" className="claude-wing-agent" onClick={() => openClaudeAgent(team.slug, agent.code)} title={agent.provenance} aria-label={`${agent.code} ${agent.name}. ${agent.state}. ${wingCaption(agent)}. Open its cards.`}>
        <span className="claude-code">{agent.code}{agent.notifierOnly ? ' ▣' : ''}</span>
        <span className={`badge ${AGENT_TONE[agent.state]}`}>{agent.state}</span>
        <small>{wingCaption(agent)}</small>
      </button>)}</div>
    </article>)}</div>
  </section>
}
