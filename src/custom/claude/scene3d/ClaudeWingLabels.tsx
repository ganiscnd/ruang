// custom: the Claude wing's labels over the 3D canvas (placed each frame by Office3D's
// LabelProjector) and the shared click targets: an agent opens its cards on the team page, a
// team label opens the team.
import { AGENT_TONE, openClaudeAgent, openClaudeTeam } from '../claude-view.ts'
import type { ClaudeOverview } from '../types.ts'
import { BUBBLE_STATES, wingCaption } from '../wing-layout.ts'

export function ClaudeWingLabels({ data, label }: { data: ClaudeOverview; label: (key: string) => (element: HTMLElement | null) => void }) {
  return <>
    {data.teams.map((team) => <button key={team.slug} ref={label(`claude-team-${team.slug}`)} type="button" className="claude-team-tag-3d" onClick={() => openClaudeTeam(team.slug)} aria-label={`${team.code} ${team.name}. ${team.status === 'paused' ? 'Paused.' : `${team.needsYou ?? 'Unknown'} need you.`} Open the team page.`}>
      <span className="claude-code">{team.code}</span> {team.name}{team.status === 'paused' ? ' · PAUSED' : team.needsYou ? ` · ${team.needsYou} need you` : ''}
    </button>)}
    {data.teams.flatMap((team) => team.agents.map((agent) => <button key={agent.code} ref={label(`claude-agent-${agent.code}`)} type="button" className={`agent-tag-3d claude-agent-tag state-${agent.state.toLowerCase().replace(/\s+/g, '-')}`} onClick={() => openClaudeAgent(team.slug, agent.code)} title={`${wingCaption(agent)} · ${agent.provenance}`} aria-label={`${agent.code} ${agent.name}. ${agent.state}. ${wingCaption(agent)}. ${agent.provenance}. Open its cards.`}>
      {BUBBLE_STATES.has(agent.state) && <span className="speech speech-3d speech-idle claude-speech">{wingCaption(agent)}</span>}
      <span className="agent-tag-row"><span className="pixel-station-name">{agent.code}</span><span className={`badge ${AGENT_TONE[agent.state]}`}>{agent.state}</span></span>
    </button>))}
  </>
}
