import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sortCards } from './claude-view.ts'
import { TableBoard } from './TableBoard.tsx'
import type { BoardView, CardSummary } from './types.ts'

// Invented drafts board.
const card = (row: number, postDate: string, topic: string, status: string, slot = 'a'): CardSummary => ({ row, key: `${postDate} · ${topic}`, title: topic, status, statusKey: status.toLowerCase(), date: postDate, values: { postDate, topic, status, slot } })
const board: BoardView = {
  id: 'example-drafts', title: 'Drafts', kind: 'table', testCopy: false, fetchedAt: '2026-11-10T02:00:00.000Z', availability: 'available', needsYouRule: true, needsYouReason: 'Check the draft', neverTouch: [],
  cards: [card(2, '2026-11-10', 'Example today', 'Drafted'), card(3, '2026-11-11', 'Example tomorrow', 'Drafted', 'b'), card(4, '2026-11-08', 'Example old draft', 'Drafted'), card(5, '2026-11-07', 'Example posted', 'Posted')],
  needsYou: [2, 3],
  table: { columns: [{ key: 'postDate', header: 'Post date', kind: 'date' }, { key: 'topic', header: 'Topic', kind: 'title' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'slot', header: 'Slot', kind: 'text' }], stale: { label: 'Old drafts, not posted', rows: [4] } },
}

describe('table board', () => {
  const markup = renderToStaticMarkup(<TableBoard board={board} onOpen={() => {}}/>)

  it('says the agents do not read the owner\'s notes yet', () => {
    expect(markup).toContain('agents do not read your notes yet')
  })

  it('lists only current drafts in Needs you and puts past ones in a collapsed group', () => {
    const needs = markup.slice(markup.indexOf('aria-label="Needs you"'), markup.indexOf('</section>', markup.indexOf('aria-label="Needs you"')))
    expect(needs).toContain('Example today')
    expect(needs).toContain('Example tomorrow')
    expect(needs).not.toContain('Example old draft')
    expect(markup).toMatch(/<details class="claude-group"><summary><span class="badge muted">Old drafts, not posted<\/span> <span class="room-count">1<\/span>/)
    // The old draft is not also listed under "drafted".
    expect(markup.match(/Example old draft/g)).toHaveLength(1)
  })

  it('shows only the configured columns with sortable headers', () => {
    expect(markup).toContain('>Post date ▼</button>')
    expect(markup).toContain('>Slot</button>')
  })

  it('sorts numbers as numbers, text ignoring case, empty values last', () => {
    const rows = [{ ...board.cards[0], values: { score: '9' } }, { ...board.cards[1], values: { score: '10' } }, { ...board.cards[2], values: { score: '' } }]
    expect(sortCards(rows, { column: 'score', direction: 'desc' }).map((item) => item.values?.score)).toEqual(['10', '9', ''])
    expect(sortCards(rows, { column: 'score', direction: 'asc' }).map((item) => item.values?.score)).toEqual(['9', '10', ''])
    expect(sortCards(rows, { column: '', direction: 'asc' }).map((item) => item.row)).toEqual([2, 3, 4])
  })
})
