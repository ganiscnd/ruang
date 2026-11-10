import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClaudeWing2D } from './ClaudeWing2D.tsx'
import type { AgentLine, AgentState, ClaudeOverview, TeamSummary } from './types.ts'
import { wingShape } from './use-claude-overview.ts'
import { wingCaption, wingLayout, wingPlacement, withWing } from './wing-layout.ts'

// Invented teams shaped like the owner's: 2 agents, 3 agents (paused), notifier + 5 agents.
const agent = (code: string, state: AgentState = 'Idle', extra: Partial<AgentLine> = {}): AgentLine => ({ code, name: `Example ${code}`, state, detail: '', nextRun: { label: '10:00 WIB' }, runsOnMac: true, notifierOnly: false, provenance: 'from Example board, read 09:15', ...extra })
const team = (slug: string, code: string, agents: AgentLine[], status: 'active' | 'paused' = 'active'): TeamSummary => ({ slug, code, name: `Example ${code}`, status, needsYou: 2, incomplete: false, working: null, waiting: null, nextRun: null, boards: [], agents })
const teams = [
  team('zz-1', 'ZZ.1', [agent('ZZ.1.A', 'Ran today'), agent('ZZ.1.B', 'Not run yet today')]),
  team('zz-2', 'ZZ.2', [agent('ZZ.2.A', 'Paused'), agent('ZZ.2.B', 'Paused'), agent('ZZ.2.C', 'Paused')], 'paused'),
  team('zz-3', 'ZZ.3', [agent('ZZ.3.0', 'Notifier', { notifierOnly: true }), agent('ZZ.3.A', 'Working', { detail: 'In progress: T01' }), agent('ZZ.3.B', 'Waiting for you'), agent('ZZ.3.C', 'Queued'), agent('ZZ.3.D'), agent('ZZ.3.E')]),
]
const overview: ClaudeOverview = { availability: 'available', ownerName: 'Owner', timezone: 'Asia/Jakarta', fetchedAt: '2026-11-10T02:15:00.000Z', teams }

describe('Claude wing layout', () => {
  const layout = wingLayout(teams)

  it('is a separate building east of the Hermes office, with every cluster inside it and none overlapping', () => {
    expect(layout.building.minX).toBeGreaterThan(17)
    for (const cluster of layout.clusters) {
      expect(cluster.minX).toBeGreaterThanOrEqual(layout.building.minX)
      expect(cluster.maxX).toBeLessThanOrEqual(layout.building.maxX)
    }
    for (let index = 1; index < layout.clusters.length; index += 1) expect(layout.clusters[index].minX).toBeGreaterThan(layout.clusters[index - 1].maxX)
  })

  it('gives every working agent a desk and the notifier a terminal instead of an avatar', () => {
    expect(layout.clusters.map((cluster) => cluster.desks.length)).toEqual([2, 3, 5])
    expect(layout.clusters[2].terminal?.agent).toBe('ZZ.3.0')
    expect(layout.clusters[2].desks.some((desk) => desk.agent === 'ZZ.3.0')).toBe(false)
    const positions = layout.clusters.flatMap((cluster) => cluster.desks.map((desk) => desk.desk.join(',')))
    expect(new Set(positions).size).toBe(positions.length)
    // Seats are in front of their desk, facing the camera.
    for (const desk of layout.clusters.flatMap((cluster) => cluster.desks)) expect(desk.seat.position[2]).toBeLessThan(desk.desk[2])
  })

  it('places agents by their board state only: idle in the lounge, everyone else at the desk', () => {
    const desk = layout.clusters[2].desks[0]
    expect(wingPlacement('Working', desk, layout, 0)).toMatchObject({ at: 'desk', seated: true })
    expect(wingPlacement('Waiting for you', desk, layout, 0).at).toBe('desk')
    expect(wingPlacement('Paused', desk, layout, 0).at).toBe('desk')
    expect(wingPlacement('Unknown', desk, layout, 0)).toMatchObject({ at: 'desk', seated: false })
    const first = wingPlacement('Idle', desk, layout, 0)
    const second = wingPlacement('Idle', desk, layout, 1)
    expect(first.at).toBe('lounge')
    expect(first.position).not.toEqual(second.position)
    expect(first.position[0]).toBeLessThan(layout.building.maxX)
  })

  it('widens the pan area and points the camera at the wing only when asked', () => {
    const base = { pan: { minX: -14, maxX: 17, minZ: -7, maxZ: 11 }, camera: { target: [1, 0.6, 0.2] as [number, number, number], offset: [-3.9, 15.2, 18.8] as [number, number, number] } }
    expect(withWing(base, undefined, 'claude')).toBe(base)
    const office = withWing(base, layout, 'office')
    expect(office.pan.maxX).toBe(layout.building.maxX + 1)
    expect(office.camera).toBe(base.camera)
    expect(withWing(base, layout, 'claude').camera.target).toEqual(layout.center)
  })

  it('rebuilds the same layout from the polled shape, and has none without teams', () => {
    expect(wingLayout(JSON.parse(wingShape(overview)))).toEqual(layout)
    expect(wingShape({ ...overview, teams: [] })).toBe('')
    expect(wingShape({ ...overview, availability: 'unavailable', teams: [] })).toBe('')
  })

  it('captions agents with what the board says, never more', () => {
    expect(wingCaption(agent('X', 'Queued'))).toBe('Queued · next run 10:00 WIB')
    expect(wingCaption(agent('X', 'Working', { detail: 'In progress: T01' }))).toBe('In progress: T01')
    expect(wingCaption(agent('X', 'Paused'))).toBe('Paused')
  })
})

describe('Claude wing in 2D', () => {
  it('shows each team with its agents, paused teams marked, Not Available when unreadable', () => {
    const markup = renderToStaticMarkup(<ClaudeWing2D data={overview}/>)
    expect(markup).toContain('ZZ.3.0 ▣')
    expect(markup).toContain('PAUSED')
    expect(markup).toContain('2 NEED YOU')
    expect(markup).toContain('Waiting for you')
    expect(renderToStaticMarkup(<ClaudeWing2D data={{ ...overview, availability: 'unavailable', reason: 'The Claude teams config was not found.', teams: [] }}/>)).toContain('Not Available (The Claude teams config was not found.)')
  })
})
