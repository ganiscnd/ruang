import { describe, expect, it } from 'vitest'
import type { BoardRead } from './board.js'
import { findBoard, parseClaudeConfig } from './config.js'
import { exampleConfig } from './example.fixture.js'
import { computeFlow, parseDeps, queueOrder } from './taskflow.js'

const lab = findBoard(parseClaudeConfig(exampleConfig()), 'example-lab')!
// Columns of the example lab board: id, owner, dependsOn, status, notified, title (AA).
const board = { ...lab, unlockStatuses: ['approved', 'done'], needsYou: { status: ['review', 'proposed', 'blocked'] } }
type Row = [id: string, owner: string, deps: string, status: string, updated?: string]
const read = (rows: Row[]): BoardRead => ({
  board: { ...board, columns: [...board.columns, { key: 'updated', col: 'F', index: 5, header: 'Updated', role: 'updated' }] },
  fetchedAt: '2026-11-09T02:15:00.000Z', availability: 'available',
  rows: rows.map(([id, owner, dependsOn, status, updated = ''], index) => ({ row: index + 2, cells: { id, owner, dependsOn, status, notified: '', title: `Example task ${id}`, updated } })),
})
const runs = new Map([['ZZ.3.B', { label: '10:00 WIB' }], ['ZZ.3.D', { label: '12:00 WIB' }]])

// Invented tasks with the same dependency shape as the owner's test copy (2026-11-09).
const SHAPE: Row[] = [
  ['T01', 'ZZ.3.A', '', 'approved'], ['T02', 'ZZ.3.A', 'T01', 'approved'], ['T03', 'ZZ.3.B', 'T01', 'approved'], ['T04', 'ZZ.3.C', 'T01', 'approved'],
  ['T05', 'ZZ.3.B', 'T03, T04', 'approved'], ['T06', 'ZZ.3.B', 'T03', 'approved'], ['T07', 'ZZ.3.D', 'T05', 'approved'], ['T08', 'ZZ.3.D', 'T04, T06', 'review'],
  ['T09', 'ZZ.3.E', 'T01, T02', 'approved'], ['T10', 'ZZ.3.E', 'T07, T08', 'approved'], ['T11', 'ZZ.3.B', 'T03, T12', 'waiting'], ['T12', 'ZZ.3.B', 'T05, T06, T16, T18', 'waiting'],
  ['T13', 'ZZ.3.D', 'T06, T12', 'waiting'], ['T14', 'ZZ.3.C', 'T04', 'review'], ['T15', 'ZZ.3.B', 'T07', 'approved'], ['T16', 'ZZ.3.B', 'T07', 'approved'],
  ['T17', 'ZZ.3.A', 'T07', 'review'], ['T18', 'ZZ.3.B', 'T16', 'review'], ['T19', 'ZZ.3.E', 'T08, T12', 'waiting'], ['T20', 'ZZ.3.D', 'T15', 'proposed'],
  ['T21', 'ZZ.3.B', 'T08', 'proposed'], ['T22', 'ZZ.3.B', 'T08', 'proposed'], ['T23', 'ZZ.3.D', 'T12, T21, T22', 'waiting'],
]

describe('Needs-you order', () => {
  const flow = computeFlow(read(SHAPE), { today: '2026-11-09', runs })

  it('ranks by tasks unblocked now, then everything downstream, then review > proposed > blocked, then ID', () => {
    expect(flow.needs.map((item) => item.id)).toEqual(['T18', 'T08', 'T21', 'T22', 'T20', 'T14', 'T17'])
    expect(flow.needs[0]).toMatchObject({ rank: 1, unblocksNow: ['T12'], unblocksAll: ['T11', 'T12', 'T13', 'T19', 'T23'] })
    expect(flow.needs[1]).toMatchObject({ unblocksNow: [], unblocksAll: ['T19', 'T21', 'T22', 'T23'] })
  })

  it('explains each item in one line', () => {
    const reason = Object.fromEntries(flow.needs.map((item) => [item.id, item.reason]))
    expect(reason.T18).toBe('Approve → T12 becomes ready; ZZ.3.B picks it at its next run (10:00 WIB). Later unlocks T11, T13, T19 and 1 more.')
    expect(reason.T08).toBe('Approve → nothing becomes ready yet: T19 also waits for T12; T21, T22 are proposed. Unlocks T19, T21, T22 and 1 more in the end.')
    expect(reason.T21).toBe('Set ready → ZZ.3.B has no other work (10:00 WIB). It depends on T08 (review), not approved yet. Unlocks T23 once done.')
    expect(reason.T20).toBe('Set ready → ZZ.3.D has no other work (12:00 WIB). Nothing waits for this.')
    expect(reason.T14).toBe('Nothing waits for this; review when you have time.')
  })

  it('shows the longest open chain, starting from the highest-ranked item on ties', () => {
    expect(flow.chain).toEqual(['T18', 'T12', 'T11'])
  })

  it('relates every card: waits for, unlocks, column', () => {
    const t12 = flow.relations[13]
    expect(t12).toMatchObject({ column: 'waiting', dependsOn: ['T05', 'T06', 'T16', 'T18'], waitsFor: ['T18'], unlocks: ['T11', 'T13', 'T19', 'T23'] })
    expect(flow.relations[2]).toMatchObject({ column: 'done', waitsFor: [] })
    expect(flow.relations[9].column).toBe('needs')
  })

  it('counts the queue position after tasks already queued for that agent', () => {
    const queued = computeFlow(read([...SHAPE.filter(([id]) => id !== 'T03'), ['T03', 'ZZ.3.B', 'T01', 'changes requested'], ['T30', 'ZZ.3.B', '', 'ready']]), { today: '2026-11-09', runs })
    // ZZ.3.B already has T03 (changes requested) and T30 (ready); a newly ready T12 or T21 sorts
    // after the changes request and before T30 (lower ID), so position 2.
    expect(queued.needs.find((item) => item.id === 'T18')!.reason).toContain('T12 becomes ready; ZZ.3.B queue position 2 (10:00 WIB)')
    expect(queued.needs.find((item) => item.id === 'T21')!.reason).toContain('ZZ.3.B queue position 2')
    expect(queued.needs.find((item) => item.id === 'T21')!.feedsIdleAgent).toBe(false)
    expect(queued.queues.find((queue) => queue.agent === 'ZZ.3.B')).toMatchObject({ order: ['T03', 'T30'], nextRun: { label: '10:00 WIB' } })
  })
})

describe('task-flow details', () => {
  it('orders an agent\'s queue: changes requested first, then ready, lowest ID first', () => {
    expect(queueOrder([{ id: 'T10', status: 'ready' }, { id: 'T9', status: 'ready' }, { id: 'T12', status: 'changes requested' }, { id: 'T1', status: 'waiting' }])).toEqual(['T12', 'T9', 'T10'])
  })

  it('reads Depends on with any spacing and ignores "none"', () => {
    expect(parseDeps('T03,T04 ,  t05')).toEqual(['T03', 'T04', 'T05'])
    expect(parseDeps('-')).toEqual([])
    expect(parseDeps('T01; T01')).toEqual(['T01'])
  })

  it('warns about unknown IDs and cycles, and marks old in-progress tasks as stuck', () => {
    const flow = computeFlow(read([['T01', 'ZZ.3.A', 'T99', 'waiting'], ['T02', 'ZZ.3.A', 'T03', 'waiting'], ['T03', 'ZZ.3.A', 'T02', 'waiting'], ['T04', 'ZZ.3.B', '', 'in progress', '2026-11-08'], ['T05', 'ZZ.3.B', '', 'in progress', '2026-11-09']]), { today: '2026-11-09' })
    expect(flow.warnings).toContain('T01 depends on T99, which is not on this board.')
    expect(flow.relations[2]).toMatchObject({ unknownDeps: ['T99'], waitsFor: ['T99'] })
    expect(flow.relations[5].stuck).toBe(true)
    expect(flow.relations[6].stuck).toBe(false)
    // T02 and T03 wait on each other: no chain starts there, nothing loops forever.
    expect(flow.chain).toEqual([])
    expect(flow.warnings).toContain('Some tasks depend on each other in a circle; check Depends on.')
  })

  it('among items that unlock nothing, puts first a proposed/blocked task that gives an idle agent work', () => {
    const flow = computeFlow(read([
      ['T01', 'ZZ.3.A', '', 'review'],
      ['T02', 'ZZ.3.B', '', 'proposed'], ['T03', 'ZZ.3.B', '', 'ready'],
      ['T04', 'ZZ.3.C', '', 'proposed'], ['T05', 'ZZ.3.C', '', 'in progress'],
      ['T06', 'ZZ.3.D', '', 'blocked'],
      ['T07', 'ZZ.3.E', '', 'proposed'], ['T08', 'ZZ.3.E', 'T07', 'waiting'],
    ]), { today: '2026-11-09', runs })
    // T07 unlocks T08, so it ranks by that rule first; T06 feeds idle ZZ.3.D; T02/T04 owners already have work.
    expect(flow.needs.map((item) => [item.id, item.feedsIdleAgent])).toEqual([['T07', true], ['T06', true], ['T01', false], ['T02', false], ['T04', false]])
    expect(flow.needs[1].reason).toBe('Unblock (set ready) → ZZ.3.D has no other work (12:00 WIB). Nothing waits for this.')
    // T02 sorts before the already ready T03 (lower ID), so it would be picked first.
    expect(flow.needs[3].reason).toMatch(/^Set ready → ZZ.3.B queue position 1/)
  })

  it('ranks review before proposed before blocked when nothing else differs', () => {
    // ZZ.3.A has work in progress, so the idle-agent rule does not apply.
    const flow = computeFlow(read([['T01', 'ZZ.3.A', '', 'blocked'], ['T02', 'ZZ.3.A', '', 'proposed'], ['T03', 'ZZ.3.A', '', 'review'], ['T04', 'ZZ.3.A', '', 'in progress', '2026-11-09']]), { today: '2026-11-09' })
    expect(flow.needs.map((item) => item.id)).toEqual(['T03', 'T02', 'T01'])
    expect(flow.needs[2].reason).toMatch(/^Unblock \(set ready\) → ZZ.3.A queue position 1\./)
  })
})
