// custom: a task-flow board (Product Board): ranked Needs you, agent queues, the open chain, and
// five columns instead of the sheet's twelve.
import { useState } from 'react'
import { plural, relationLine, statusTone } from './claude-view.ts'
import type { BoardView, CardSummary, FlowColumn } from './types.ts'

const COLUMNS: { key: FlowColumn; title: string; hint: string }[] = [
  { key: 'needs', title: 'Needs you', hint: 'review, proposed, blocked' },
  { key: 'queue', title: 'Agent queue', hint: 'in the order agents pick them' },
  { key: 'working', title: 'Working', hint: 'in progress' },
  { key: 'waiting', title: 'Waiting', hint: 'on other tasks' },
  { key: 'other', title: 'Other', hint: 'status not in the protocol' },
  { key: 'done', title: 'Done', hint: 'approved, done, rejected' },
]

function Card({ card, needs, onOpen, rank }: { card: CardSummary; needs: ReadonlySet<string>; onOpen: (card: CardSummary) => void; rank?: number }) {
  const line = relationLine(card)
  return <button type="button" className="claude-card" onClick={() => onOpen(card)} aria-label={`${card.id ?? `Row ${card.row}`}: ${card.title}. ${card.status}. Open details.`}>
    <span className="claude-card-head">{rank !== undefined && <b className="claude-rank">{rank}</b>}<span className="claude-code">{card.id ?? `Row ${card.row}`}</span>{card.owner && <span className="chip">{card.owner}</span>}<span className={`badge ${statusTone(card.statusKey, needs)}`}>{card.status}</span>{card.relations?.stuck && <span className="badge bad" title="In progress, but not updated today">stuck</span>}</span>
    <span className="claude-card-title">{card.title}</span>
    {line && <small>{line}</small>}
  </button>
}

export function TaskflowBoard({ board, onOpen, agent, onAgent }: { board: BoardView; onOpen: (card: CardSummary) => void; agent?: string; onAgent: (agent?: string) => void }) {
  const [showDone, setShowDone] = useState(false)
  const flow = board.flow
  const needs = new Set(flow?.needs.map((item) => item.status) ?? [])
  const byRow = new Map(board.cards.map((card) => [card.row, card]))
  const agents = [...new Set(board.cards.map((card) => card.owner).filter((owner): owner is string => Boolean(owner)))].sort()
  const visible = board.cards.filter((card) => !agent || card.owner === agent)
  const rankOf = new Map(flow?.needs.map((item) => [item.row, item.rank]) ?? [])
  const queuePosition = new Map(flow?.queues.flatMap((queue) => queue.order.map((id, index) => [id, index])) ?? [])
  const inColumn = (column: FlowColumn) => visible.filter((card) => (card.relations?.column ?? 'other') === column).sort((a, b) =>
    column === 'needs' ? (rankOf.get(a.row) ?? 999) - (rankOf.get(b.row) ?? 999)
      : column === 'queue' ? (queuePosition.get(a.id ?? '') ?? 999) - (queuePosition.get(b.id ?? '') ?? 999) || (a.owner ?? '').localeCompare(b.owner ?? '')
        : (a.id ?? '').localeCompare(b.id ?? '', 'en', { numeric: true }))
  const ranked = (flow?.needs ?? []).filter((item) => !agent || byRow.get(item.row)?.owner === agent)
  return <>
    <section className="claude-needs-panel" aria-label="Needs you, in order">
      <h2>Needs you, in this order <span className="room-count">{ranked.length}</span></h2>
      {ranked.length ? <ol className="claude-ranked">{ranked.map((item) => { const card = byRow.get(item.row); return <li key={item.row} value={item.rank}>
        <button type="button" className="link-button" onClick={() => card && onOpen(card)}><b>{item.id}</b> ({item.status})</button> <span className="claude-card-title">{card?.title}</span>
        <p>{item.reason}</p>
      </li> })}</ol> : <p className="muted">Nothing needs you on this board right now.</p>}
      {flow && flow.chain.length > 0 && <p className="claude-chain"><span className="eyebrow">Critical chain (longest open path)</span> {flow.chain.join(' → ')}</p>}
      {flow?.warnings.map((warning) => <p key={warning} className="form-error">{warning}</p>)}
    </section>
    {flow && <section className="claude-queues" aria-label="Agent queues">
      {flow.queues.filter((queue) => !agent || queue.agent === agent).map((queue) => <p key={queue.agent}><span className="claude-code">{queue.agent}</span>: {queue.order.length ? queue.order.join(' → ') : 'nothing queued'} <span className="muted">(next run {queue.nextRun?.label ?? 'Unknown'}{queue.nextRun?.macOff ? ', Mac off at that time' : ''})</span></p>)}
    </section>}
    <div className="claude-filter" role="group" aria-label="Filter by agent">
      <button type="button" className={!agent ? 'active' : ''} aria-pressed={!agent} onClick={() => onAgent(undefined)}>All</button>
      {agents.map((code) => <button type="button" key={code} className={agent === code ? 'active' : ''} aria-pressed={agent === code} onClick={() => onAgent(code)}>{code}</button>)}
    </div>
    <div className="claude-columns">
      {COLUMNS.map((column) => {
        const cards = inColumn(column.key)
        if (column.key === 'other' && !cards.length) return null
        const collapsed = column.key === 'done' && !showDone
        return <section key={column.key} className={`claude-column column-${column.key}`} aria-label={column.title}>
          <h3>{column.title} <span className="room-count">{cards.length}</span></h3>
          <small>{column.hint}</small>
          {collapsed ? <button type="button" className="link-button" onClick={() => setShowDone(true)}>Show {plural(cards.length, 'task')}</button>
            : cards.map((card) => <Card key={card.row} card={card} needs={needs} onOpen={onOpen} rank={column.key === 'needs' ? rankOf.get(card.row) : undefined}/>)}
          {column.key === 'done' && showDone && <button type="button" className="link-button" onClick={() => setShowDone(false)}>Hide</button>}
        </section>
      })}
    </div>
  </>
}
