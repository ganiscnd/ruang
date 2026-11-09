// custom: Claude overview (#/claude): one card per team.
import { usePolling, type Polled } from '../../../polling.ts'
import type { Source } from '../../../types.ts'
import { EmptyState, LoadingState, PageTitle, SourceStatus, Unavailable } from '../../../ui.tsx'
import { OVERVIEW_PATH, POLL_MS, teamHash } from '../claude-view.ts'
import type { ClaudeOverview, TeamSummary } from '../types.ts'

function TeamCard({ team }: { team: TeamSummary }) {
  const unreadable = team.boards.filter((board) => !board.testCopy && board.availability !== 'available')
  const next = team.nextRun
  return <article className={`claude-team-card${team.status === 'paused' ? ' paused' : ''}`}>
    <header><span className="claude-code">{team.code}</span><h2>{team.name}</h2><span className={`badge ${team.status === 'paused' ? 'muted' : 'good'}`}>{team.status === 'paused' ? 'PAUSED' : 'ACTIVE'}</span></header>
    <div className="claude-needs">
      <strong>{team.needsYou ?? '—'}</strong>
      <span>NEEDS YOU{team.incomplete ? ' (some boards not readable)' : ''}</span>
    </div>
    <dl className="claude-facts">
      <div><dt>Working</dt><dd>{team.working ?? 'Not tracked'}</dd></div>
      <div><dt>Waiting</dt><dd>{team.waiting ?? 'Not tracked'}</dd></div>
      <div><dt>Next run</dt><dd>{!next ? 'Unknown' : next.agent ? `${next.agent} ${next.run.label}${next.run.macOff ? ' (Mac off at that time)' : ''}` : next.run.label}</dd></div>
      <div><dt>Boards</dt><dd>{team.boards.filter((board) => !board.testCopy).map((board) => board.title).join(', ')}</dd></div>
    </dl>
    {unreadable.map((board) => <p key={board.id} className="form-error">{board.title}: Not Available: {board.reason}</p>)}
    <a className="primary-button claude-open" href={teamHash(team.slug)}>Open team →</a>
  </article>
}

export function ClaudeOverviewPage() {
  return <ClaudeOverviewView overview={usePolling<ClaudeOverview>(OVERVIEW_PATH, POLL_MS)}/>
}

export function ClaudeOverviewView({ overview }: { overview: Polled<ClaudeOverview> }) {
  const data = overview.status === 'ready' ? overview.data : undefined
  const source: Source<null> | undefined = data && { availability: data.availability, data: null, ...(data.reason ? { error: { code: 'COMMAND_FAILED' as const, message: data.reason } } : {}) }
  return <>
    <PageTitle eyebrow="CLAUDE · SCHEDULED-TASK TEAMS" title="Claude teams">Teams of Claude scheduled tasks and what they need from you. Read from their Google Sheets every minute; the sheets stay the source of truth.</PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={overview}/>
    {overview.status === 'pending' && <LoadingState message="Reading the team boards from Google Sheets…"/>}
    <Unavailable source={source} request={overview}/>
    {data?.availability === 'available' && (data.teams.length ? <div className="claude-team-grid">{data.teams.map((team) => <TeamCard key={team.slug} team={team}/>)}</div> : <EmptyState title="No teams">The Claude teams config lists no teams.</EmptyState>)}
  </>
}
