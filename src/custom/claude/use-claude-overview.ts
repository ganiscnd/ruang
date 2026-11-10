// custom: the Claude overview, polled once by the Office page for the 3D wing and the 2D section.
import { usePolling } from '../../polling.ts'
import { OVERVIEW_PATH, POLL_MS } from './claude-view.ts'
import type { ClaudeOverview } from './types.ts'

export function useClaudeOverview(): ClaudeOverview | undefined {
  const overview = usePolling<ClaudeOverview>(OVERVIEW_PATH, POLL_MS)
  return overview.status === 'ready' ? overview.data : undefined
}

/**
 * The wing's shape (teams, agents, paused) as text: it changes only when the shape does, so a poll
 * does not rebuild the wing or move the camera. `wingLayout(JSON.parse(shape))` builds the layout.
 */
export const wingShape = (data: ClaudeOverview | undefined) => (data?.availability === 'available' && data.teams.length ? JSON.stringify(data.teams.map((team) => ({ slug: team.slug, code: team.code, name: team.name, status: team.status, agents: team.agents.map((agent) => ({ code: agent.code, notifierOnly: agent.notifierOnly })) }))) : '')
