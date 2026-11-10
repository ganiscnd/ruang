// custom: one Claude team (#/claude/<team>): its agents, then a tab per board with Needs you on top.
import { useState } from 'react'
import { usePolling, type Polled } from '../../../polling.ts'
import type { Source } from '../../../types.ts'
import { formatTime } from '../../../format.ts'
import { LoadingState, PageTitle, SourceStatus, Unavailable } from '../../../ui.tsx'
import { AGENT_TONE, agentFromHash, plural, POLL_MS, teamHash } from '../claude-view.ts'
import { CardDetail } from '../CardDetail.tsx'
import { NOT_READ_NOTICE, TableBoard } from '../TableBoard.tsx'
import { TaskflowBoard } from '../TaskflowBoard.tsx'
import type { AgentLine, BoardView, CardSummary, ClaudeTeamData } from '../types.ts'

function Agents({ agents }: { agents: AgentLine[] }) {
  return <section className="claude-agents" aria-label="Agents">
    {agents.map((agent) => <article key={agent.code}>
      <span className="claude-code">{agent.code}</span>
      <span className="claude-agent-name">{agent.name}</span>
      <span className={`badge ${AGENT_TONE[agent.state]}`}>{agent.state}</span>
      <span className="claude-agent-detail">{agent.detail}</span>
      <span className="claude-agent-next">Next: {agent.nextRun.label}{agent.nextRun.macOff ? ' · Mac off at that time' : ''}</span>
      <small title="Where this state comes from">{agent.provenance}</small>
    </article>)}
  </section>
}

function Board({ board, paused, onOpen, agent, onAgent }: { board: BoardView; paused: boolean; onOpen: (card: CardSummary) => void; agent?: string; onAgent: (agent?: string) => void }) {
  return <section className="claude-board" aria-label={board.title}>
    <p className="claude-board-meta">{board.kind === 'taskflow' ? 'Task flow' : 'Table'} · read {formatTime(board.fetchedAt)} · {plural(board.cards.length, 'row')}{board.testCopy && <span className="badge info">TEST COPY · agents never read it</span>}</p>
    {paused && <p className="notice">This team is paused: its scheduled tasks are switched off. The board still shows what is there.</p>}
    {board.availability !== 'available' && <section className="empty-state" role="alert"><h2>Not Available</h2><p>{board.reason}</p></section>}
    {board.readOnly && <p className="form-error" role="alert">{board.readOnly}</p>}
    {board.files && board.files.status !== 'readable' && <p className="form-error">Output files: {board.files.message}</p>}
    {board.availability === 'available' && board.kind === 'taskflow' && <TaskflowBoard board={board} onOpen={onOpen} agent={agent} onAgent={onAgent}/>}
    {board.availability === 'available' && board.kind === 'table' && <TableBoard board={board} onOpen={onOpen}/>}
  </section>
}

export function ClaudeTeamPage({ slug }: { slug: string }) {
  return <ClaudeTeamView team={usePolling<ClaudeTeamData>(`/api/custom/claude/teams/${slug}`, POLL_MS)}/>
}

export function ClaudeTeamView({ team }: { team: Polled<ClaudeTeamData> }) {
  const data = team.status === 'ready' ? team.data : undefined
  const [tab, setTab] = useState<string | undefined>()
  const [agent, setAgent] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : agentFromHash(window.location.hash)))
  const [open, setOpen] = useState<{ board: string; row: number } | undefined>()
  // With ?agent=, start on the first board that agent has rows on.
  const board = data?.boards.find((item) => item.id === tab) ?? (agent ? data?.boards.find((item) => item.cards.some((card) => card.owner === agent)) : undefined) ?? data?.boards[0]
  const openTask = (id: string) => { const card = board?.cards.find((item) => item.id === id); if (board && card) setOpen({ board: board.id, row: card.row }) }
  const source: Source<null> | undefined = data && { availability: 'available', data: null }
  return <>
    <PageTitle eyebrow={`CLAUDE · ${data ? `${data.team.code} · ${data.team.status === 'paused' ? 'PAUSED' : 'ACTIVE'}` : 'TEAM'}`} title={data ? data.team.name : 'Claude team'}><a href={teamHash()}>← All Claude teams</a></PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={team}/>
    {team.status === 'pending' && <LoadingState message="Reading the team's boards from Google Sheets…"/>}
    <Unavailable source={source} request={team}/>
    {data && <>
      <Agents agents={data.team.agents}/>
      <div className="room-tabs" role="tablist" aria-label="Boards">{data.boards.map((item) => <button type="button" role="tab" key={item.id} aria-selected={board?.id === item.id} className={board?.id === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.title} <span className="room-count">{item.availability === 'available' ? item.needsYou.length : '?'}</span></button>)}</div>
      {board && <Board board={board} paused={data.team.status === 'paused'} onOpen={(card) => setOpen({ board: board.id, row: card.row })} agent={agent} onAgent={setAgent}/>}
      {open && <CardDetail key={`${open.board}-${open.row}`} board={open.board} row={open.row} onClose={() => setOpen(undefined)} onOpenTask={openTask} onChanged={team.refresh} notice={data.boards.find((item) => item.id === open.board)?.kind === 'table' ? NOT_READ_NOTICE : undefined}/>}
    </>}
  </>
}
