// custom: a table board (ZZ.1, ZZ.2): Needs you on top, then a sortable table grouped by status,
// showing only a few useful columns; everything else is in the row's detail panel.
import { useState } from 'react'
import { needsYouStatuses, plural, sortCards, statusGroups, statusTone, type SortState } from './claude-view.ts'
import type { BoardView, CardSummary, TableColumn } from './types.ts'

/** Shown on boards whose agents do not read the owner's notes yet (all table boards today). */
export const NOT_READ_NOTICE = "This team's agents do not read your notes yet: your comments are stored in the sheet for you, and status changes still count."

function Cell({ card, column, needs, onOpen }: { card: CardSummary; column: TableColumn; needs: ReadonlySet<string>; onOpen: (card: CardSummary) => void }) {
  const value = card.values?.[column.key] ?? ''
  if (column.kind === 'title') return <td><button type="button" className="link-button" onClick={() => onOpen(card)}>{value || card.title}</button></td>
  if (column.kind === 'status') return <td><span className={`badge ${statusTone(card.statusKey, needs)}`} title={card.status}>{card.status || '(no status)'}</span></td>
  return <td className={column.kind === 'date' || column.kind === 'score' ? 'claude-key' : undefined}>{value || '—'}</td>
}

function Table({ cards, columns, needs, onOpen, sort, onSort }: { cards: CardSummary[]; columns: TableColumn[]; needs: ReadonlySet<string>; onOpen: (card: CardSummary) => void; sort: SortState; onSort: (sort: SortState) => void }) {
  return <div className="table-scroll"><table className="claude-table">
    <thead><tr>{columns.map((column) => {
      const active = sort.column === column.key
      return <th key={column.key} scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="claude-sort" onClick={() => onSort({ column: column.key, direction: active && sort.direction === 'asc' ? 'desc' : 'asc' })}>{column.header}{active ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}</button>
      </th>
    })}</tr></thead>
    <tbody>{sortCards(cards, sort).map((card) => <tr key={card.row}>{columns.map((column) => <Cell key={column.key} card={card} column={column} needs={needs} onOpen={onOpen}/>)}</tr>)}</tbody>
  </table></div>
}

export function TableBoard({ board, onOpen }: { board: BoardView; onOpen: (card: CardSummary) => void }) {
  const columns = board.table?.columns ?? []
  const dateColumn = columns.find((column) => column.kind === 'date')?.key
  // Needs you keeps the server's order (the config's sortBy); the other groups start newest first.
  const [sort, setSort] = useState<SortState>({ column: dateColumn ?? columns[0]?.key ?? '', direction: 'desc' })
  const needs = needsYouStatuses(board)
  const byRow = new Map(board.cards.map((card) => [card.row, card]))
  const needsCards = board.needsYou.map((row) => byRow.get(row)).filter((card): card is CardSummary => Boolean(card))
  const stale = board.table?.stale
  const staleRows = new Set(stale?.rows ?? [])
  const groups = statusGroups({ ...board, cards: board.cards.filter((card) => !staleRows.has(card.row)) })
  return <>
    <p className="notice">{NOT_READ_NOTICE}</p>
    <section className="claude-needs-panel" aria-label="Needs you">
      <h2>Needs you <span className="room-count">{needsCards.length}</span></h2>
      {board.needsYouReason && <p className="muted">{board.needsYouReason}</p>}
      {needsCards.length ? <Table cards={needsCards} columns={columns} needs={needs} onOpen={onOpen} sort={{ column: '', direction: 'asc' }} onSort={setSort}/>
        : <p className="muted">{board.needsYouRule ? 'Nothing needs you on this board right now.' : 'Nothing on this board waits for you (it has no Needs-you rule); comments only.'}</p>}
    </section>
    {groups.map((group) => <details key={group.key} className="claude-group" open={!group.collapsed}>
      <summary><span className={`badge ${statusTone(group.key, needs)}`}>{group.label}</span> <span className="room-count">{group.cards.length}</span></summary>
      <Table cards={group.cards} columns={columns} needs={needs} onOpen={onOpen} sort={sort} onSort={setSort}/>
    </details>)}
    {stale && stale.rows.length > 0 && <details className="claude-group">
      <summary><span className="badge muted">{stale.label}</span> <span className="room-count">{stale.rows.length}</span> <small className="muted">post date passed; not counted in Needs you</small></summary>
      <Table cards={stale.rows.map((row) => byRow.get(row)).filter((card): card is CardSummary => Boolean(card))} columns={columns} needs={needs} onOpen={onOpen} sort={sort} onSort={setSort}/>
    </details>}
    <p className="small-note muted">{plural(board.cards.length, 'row')} · click a column header to sort · click a title for every column, notes and the comment form.</p>
  </>
}
