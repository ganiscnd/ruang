import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentNotesView } from './CardDetail.tsx'
import { agentFromHash, relationLine } from './claude-view.ts'
import { MiniMarkdown } from './mini-markdown.tsx'
import { TaskflowBoard } from './TaskflowBoard.tsx'
import type { BoardView, CardSummary, Relations } from './types.ts'

const rel = (extra: Partial<Relations>): Relations => ({ column: 'done', dependsOn: [], unknownDeps: [], waitsFor: [], unlocks: [], stuck: false, ...extra })
const card = (row: number, id: string, status: string, owner: string, relations: Partial<Relations>): CardSummary => ({ row, key: id, id, title: `Example task ${id}`, status, statusKey: status, owner, relations: rel(relations) })
// Invented board.
const board: BoardView = {
  id: 'example-lab', title: 'Lab board', kind: 'taskflow', testCopy: true, fetchedAt: '2026-11-09T02:15:00.000Z', availability: 'available', needsYouRule: true, neverTouch: [], needsYou: [3, 2],
  cards: [
    card(2, 'T01', 'review', 'ZZ.3.A', { column: 'needs' }),
    card(3, 'T02', 'review', 'ZZ.3.B', { column: 'needs', unlocks: ['T03'] }),
    card(4, 'T03', 'waiting', 'ZZ.3.B', { column: 'waiting', waitsFor: ['T02'] }),
    card(5, 'T04', 'in progress', 'ZZ.3.C', { column: 'working', stuck: true }),
    card(6, 'T05', 'approved', 'ZZ.3.A', { column: 'done' }),
  ],
  flow: {
    needs: [
      { rank: 1, id: 'T02', row: 3, status: 'review', unblocksNow: ['T03'], unblocksAll: ['T03'], feedsIdleAgent: false, reason: 'Approve → T03 becomes ready; ZZ.3.B picks it at its next run (10:00 WIB).' },
      { rank: 2, id: 'T01', row: 2, status: 'review', unblocksNow: [], unblocksAll: [], feedsIdleAgent: false, reason: 'Nothing waits for this; review when you have time.' },
    ],
    queues: [{ agent: 'ZZ.3.B', order: [], nextRun: { label: '10:00 WIB' } }],
    chain: ['T02', 'T03'],
    warnings: ['T09 depends on T99, which is not on this board.'],
  },
}

describe('task-flow board', () => {
  const render = (agent?: string) => renderToStaticMarkup(<TaskflowBoard board={board} onOpen={() => {}} agent={agent} onAgent={() => {}}/>)

  it('lists Needs you in rank order with reasons, the chain, queues and warnings', () => {
    const markup = render()
    expect(markup).toMatch(/<li value="1">.*T02.*picks it at its next run.*<li value="2">.*T01/s)
    expect(markup).toContain('T02 → T03')
    expect(markup).toContain('ZZ.3.B</span>: nothing queued')
    expect(markup).toContain('T09 depends on T99')
    expect(markup).toContain('stuck')
    expect(markup).toContain('Waits for T02')
    // Done starts collapsed with its count.
    expect(markup).toContain('Show 1 task')
    expect(markup).not.toContain('Example task T05')
  })

  it('filters by agent', () => {
    const markup = render('ZZ.3.A')
    expect(markup).toContain('Example task T01')
    expect(markup).not.toContain('Example task T02')
  })

  it('reads the agent filter from the address and builds card lines', () => {
    expect(agentFromHash('#/claude/zz-3?agent=ZZ.3.B')).toBe('ZZ.3.B')
    expect(agentFromHash('#/claude/zz-3?agent=<x>')).toBeUndefined()
    expect(relationLine(card(9, 'T09', 'review', 'ZZ.3.A', { column: 'needs', unlocks: ['T10', 'T11', 'T12', 'T13', 'T14'] }))).toBe('Unlocks T10, T11, T12, T13 +1')
  })
})

describe('mini markdown', () => {
  it('renders structure but never raw HTML or script links', () => {
    const markup = renderToStaticMarkup(<MiniMarkdown text={'# Title\n- **bold** item\n- [site](https://example.com)\n- [bad](javascript:alert(1))\n<script>alert(1)</script>\n```\ncode <b>\n```'}/>)
    expect(markup).toContain('<h3>Title</h3>')
    expect(markup).toContain('<strong>bold</strong>')
    expect(markup).toContain('href="https://example.com"')
    expect(markup).not.toContain('href="javascript')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).toContain('code &lt;b&gt;')
  })
})

describe('agent notes view', () => {
  it('shows questions with their recommendation and marks older paragraph notes', () => {
    expect(renderToStaticMarkup(<AgentNotesView notes={{ format: 'sections', done: ['Built it'], check: [], questions: [{ n: 1, text: 'One sheet?', recommend: 'yes' }], other: [] }}/>)).toMatch(/Q1:.*One sheet\?.*Recommend: yes/)
    expect(renderToStaticMarkup(<AgentNotesView notes={{ format: 'paragraphs', done: [], check: [], questions: [], other: ['A.', 'B.'] }}/>)).toContain('one sentence per bullet')
  })
})
