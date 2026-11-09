// custom: one Claude team (#/claude/<team>): its agents, then a tab per board with Needs you on top.
import { useState } from 'react'
import { usePolling, type Polled } from '../../../polling.ts'
import type { Source } from '../../../types.ts'
import { formatTime } from '../../../format.ts'
import { LoadingState, PageTitle, SourceStatus, Unavailable } from '../../../ui.tsx'
import { AGENT_TONE, needsYouStatuses, plural, POLL_MS, statusGroups, statusTone, teamHash } from '../claude-view.ts'
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

function StatusBadge({ card, needs }: { card: CardSummary; needs: ReadonlySet<string> }) {
  return <span className={`badge ${statusTone(card.statusKey, needs)}`} title={card.status}>{card.status || '(no status)'}</span>
}

function CardRow({ card, needs, kind }: { card: CardSummary; needs: ReadonlySet<string>; kind: BoardView['kind'] }) {
  return <tr>
    <td className="claude-key">{kind === 'taskflow' ? card.id ?? card.key : card.date ?? '—'}</td>
    <td>{card.title}</td>
    <td><StatusBadge card={card} needs={needs}/></td>
    <td>{kind === 'taskflow' ? card.owner ?? '—' : card.score ?? ''}</td>
    {kind === 'taskflow' && <td>{card.updated ?? '—'}</td>}
  </tr>
}

function Board({ board, paused }: { board: BoardView; paused: boolean }) {
  const needs = needsYouStatuses(board)
  const needsCards = board.needsYou.map((row) => board.cards.find((card) => card.row === row)).filter((card): card is CardSummary => Boolean(card))
  const head = board.kind === 'taskflow' ? ['ID', 'Title', 'Status', 'Owner', 'Updated'] : ['Date', 'Title', 'Status', 'Score']
  return <section className="claude-board" aria-label={board.title}>
    <p className="claude-board-meta">{board.kind === 'taskflow' ? 'Task flow' : 'Table'} · read {formatTime(board.fetchedAt)} · {plural(board.cards.length, 'row')}{board.testCopy && <span className="badge info">TEST COPY · agents never read it</span>}</p>
    {paused && <p className="notice">This team is paused: its scheduled tasks are switched off. The board still shows what is there.</p>}
    {board.availability !== 'available' && <section className="empty-state" role="alert"><h2>Not Available</h2><p>{board.reason}</p></section>}
    {board.readOnly && <p className="form-error" role="alert">{board.readOnly}</p>}
    {board.files && board.files.status !== 'readable' && <p className="form-error">Output files: {board.files.message}</p>}
    {board.availability === 'available' && <>
      <section className="claude-needs-panel" aria-label="Needs you">
        <h2>Needs you <span className="room-count">{needsCards.length}</span></h2>
        {board.needsYouReason && <p className="muted">{board.needsYouReason}</p>}
        {needsCards.length ? <ol>{needsCards.map((card) => <li key={card.row}><b>{card.id ?? card.date ?? `Row ${card.row}`}</b> <StatusBadge card={card} needs={needs}/> {card.title}{card.score ? <span className="muted"> · score {card.score}</span> : null}</li>)}</ol>
          : <p className="muted">{board.needsYouRule ? 'Nothing needs you on this board right now.' : 'Nothing on this board waits for you (it has no Needs-you rule); comments only.'}</p>}
      </section>
      {statusGroups(board).map((group) => <details key={group.key} className="claude-group" open={!group.collapsed}>
        <summary><span className={`badge ${statusTone(group.key, needs)}`}>{group.label}</span> <span className="room-count">{group.cards.length}</span></summary>
        <div className="table-scroll"><table className="claude-table"><thead><tr>{head.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{group.cards.map((card) => <CardRow key={card.row} card={card} needs={needs} kind={board.kind}/>)}</tbody></table></div>
      </details>)}
    </>}
  </section>
}

export function ClaudeTeamPage({ slug }: { slug: string }) {
  return <ClaudeTeamView team={usePolling<ClaudeTeamData>(`/api/custom/claude/teams/${slug}`, POLL_MS)}/>
}

export function ClaudeTeamView({ team }: { team: Polled<ClaudeTeamData> }) {
  const data = team.status === 'ready' ? team.data : undefined
  const [tab, setTab] = useState<string | undefined>()
  const board = data?.boards.find((item) => item.id === tab) ?? data?.boards[0]
  const source: Source<null> | undefined = data && { availability: 'available', data: null }
  return <>
    <PageTitle eyebrow={`CLAUDE · ${data ? `${data.team.code} · ${data.team.status === 'paused' ? 'PAUSED' : 'ACTIVE'}` : 'TEAM'}`} title={data ? data.team.name : 'Claude team'}><a href={teamHash()}>← All Claude teams</a></PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={team}/>
    {team.status === 'pending' && <LoadingState message="Reading the team's boards from Google Sheets…"/>}
    <Unavailable source={source} request={team}/>
    {data && <>
      <Agents agents={data.team.agents}/>
      <div className="room-tabs" role="tablist" aria-label="Boards">{data.boards.map((item) => <button type="button" role="tab" key={item.id} aria-selected={board?.id === item.id} className={board?.id === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.title} <span className="room-count">{item.availability === 'available' ? item.needsYou.length : '?'}</span></button>)}</div>
      {board && <Board board={board} paused={data.team.status === 'paused'}/>}
    </>}
  </>
}
