// custom: layout of the Claude wing in the 3D office: a separate single-storey building east of
// the Hermes office (past the flag), so Claude teams and Hermes agents are never mixed.
//
//   x: 18.5 ──────────────────────────────────────────────── maxX (grows with the teams)
//   z -5.2 ┌── back wall: CLAUDE sign · one Needs-you board per team ──────────┐
//          │ [team 1 desks]   [team 2 desks]   [team 3 desks + notifier ▣]      │
//          │  two rows, one column per two agents                              │
//          │───────────────────────── aisle ───────────────────────────────────│
//          │ team labels                          lounge corner (sofa, idle)    │
//   z  3.8 └────── low front wall ────── entrance ───────────────────────────────┘
//            sidewalk (continues from the Hermes office) · road
//
// Pure functions, kept apart from the scene so they can be tested.
import type { Placement, Vec3 } from '../../office3d-layout.ts'
import type { AgentLine, AgentState, TeamSummary } from './types.ts'

export const WING_MIN_X = 18.5
export const WING_MIN_Z = -5.2
export const WING_MAX_Z = 3.8
const MARGIN = 1.1
const COLUMN_PITCH = 2.3
const CLUSTER_GAP = 1.2
/** Desk rows (desk centres); the agent sits 0.75 in front of the desk, facing the camera (+z). */
const DESK_ROWS_Z = [-3.4, -1.0]
const SEAT_OFFSET = 0.75
const LOUNGE_WIDTH = 4.2
export const LOUNGE_Z = 2.4

export interface WingDesk { agent: string; desk: Vec3; seat: Placement }
export interface WingCluster { slug: string; code: string; name: string; paused: boolean; minX: number; maxX: number; label: Vec3; board: Vec3; desks: WingDesk[]; terminal?: { agent: string; position: Vec3 } }
export interface WingLayout { building: { minX: number; maxX: number; minZ: number; maxZ: number }; sign: Vec3; entranceX: number; clusters: WingCluster[]; lounge: { sofa: Vec3; spots: Placement[] }; center: Vec3 }

type TeamShape = Pick<TeamSummary, 'slug' | 'code' | 'name' | 'status'> & { agents: Pick<AgentLine, 'code' | 'notifierOnly'>[] }

export function wingLayout(teams: readonly TeamShape[]): WingLayout {
  let x = WING_MIN_X + MARGIN
  const clusters = teams.map((team): WingCluster => {
    const workers = team.agents.filter((agent) => !agent.notifierOnly)
    const notifier = team.agents.find((agent) => agent.notifierOnly)
    const columns = Math.max(1, Math.ceil(workers.length / DESK_ROWS_Z.length)) + (notifier ? 1 : 0)
    const minX = x
    const maxX = x + columns * COLUMN_PITCH
    // Back row fills first, left to right, then the front row.
    const perRow = Math.ceil(workers.length / DESK_ROWS_Z.length) || 1
    const desks = workers.map((agent, index): WingDesk => {
      const row = Math.floor(index / perRow)
      const deskX = minX + COLUMN_PITCH * (index % perRow + 0.5)
      const desk: Vec3 = [deskX, 0, DESK_ROWS_Z[row]]
      return { agent: agent.code, desk, seat: { position: [deskX, 0, desk[2] - SEAT_OFFSET], facing: 0, seated: true } }
    })
    const center = (minX + maxX) / 2
    x = maxX + CLUSTER_GAP
    return {
      slug: team.slug, code: team.code, name: team.name, paused: team.status === 'paused', minX, maxX, desks,
      label: [center, 0, 0.6], board: [center, 1.55, WING_MIN_Z + 0.16],
      ...(notifier ? { terminal: { agent: notifier.code, position: [maxX - COLUMN_PITCH / 2, 0, DESK_ROWS_Z[0]] as Vec3 } } : {}),
    }
  })
  const desksEnd = x - CLUSTER_GAP + MARGIN
  const maxX = Math.max(desksEnd, WING_MIN_X + LOUNGE_WIDTH + 2 * MARGIN)
  // The sofa faces the camera (+z), so idle agents sit facing it too.
  const sofa: Vec3 = [maxX - MARGIN - LOUNGE_WIDTH / 2, 0, LOUNGE_Z]
  const spots: Placement[] = [-0.75, 0, 0.75].map((dx) => ({ position: [sofa[0] + dx, 0, sofa[2] + 0.1], facing: 0, seated: true }))
  return {
    building: { minX: WING_MIN_X, maxX, minZ: WING_MIN_Z, maxZ: WING_MAX_Z },
    sign: [(WING_MIN_X + maxX) / 2, 2.95, WING_MIN_Z + 0.05],
    entranceX: WING_MIN_X + 2.4,
    clusters,
    lounge: { sofa, spots },
    center: [(WING_MIN_X + maxX) / 2, 0.6, (WING_MIN_Z + WING_MAX_Z) / 2],
  }
}

/** States that keep an agent at its desk; only Idle goes to the lounge (Unknown stays put, neutral). */
const AT_DESK: ReadonlySet<AgentState> = new Set(['Working', 'Waiting for you', 'Queued', 'Ran today', 'Not run yet today', 'Paused', 'Unknown'])

/** Where an agent of the wing is: its desk, or a lounge spot (`idleIndex` = how many idle agents come before it). */
export function wingPlacement(state: AgentState, desk: WingDesk, layout: WingLayout, idleIndex: number): Placement & { at: 'desk' | 'lounge' } {
  if (AT_DESK.has(state)) return { ...desk.seat, seated: state !== 'Unknown', at: 'desk' }
  const spot = layout.lounge.spots[idleIndex % layout.lounge.spots.length]
  // More idle agents than sofa places stand around the sofa.
  const extra = Math.floor(idleIndex / layout.lounge.spots.length)
  return extra ? { position: [spot.position[0], 0, spot.position[2] + 0.9 * extra], facing: 0, seated: false, at: 'lounge' } : { ...spot, at: 'lounge' }
}

/** One line under an agent's name: what the board says, never more. */
export function wingCaption(agent: Pick<AgentLine, 'state' | 'nextRun' | 'detail'>): string {
  switch (agent.state) {
    case 'Working': return agent.detail
    case 'Waiting for you': return agent.detail
    case 'Queued': return `Queued · next run ${agent.nextRun.label}`
    case 'Not run yet today': return `Next run ${agent.nextRun.label}`
    case 'Ran today': return `Ran today · next ${agent.nextRun.label}`
    case 'Paused': return 'Paused'
    case 'Idle': return `Idle · next run ${agent.nextRun.label}`
    case 'Notifier': return `Notifier · next ${agent.nextRun.label}`
    case 'Unknown': return agent.detail
  }
}

/** The pan bounds and camera target the 3D view needs when the wing is shown. */
export function withWing<T extends { pan: { minX: number; maxX: number; minZ: number; maxZ: number }; camera: { target: Vec3; offset: Vec3 } }>(layout: T, wing: WingLayout | undefined, focus: 'office' | 'claude'): T {
  if (!wing) return layout
  const pan = { ...layout.pan, maxX: Math.max(layout.pan.maxX, wing.building.maxX + 1) }
  if (focus === 'office') return { ...layout, pan }
  // Closer than the whole-office view: the wing is narrower than the Hermes building.
  const scale = Math.min(1, (wing.building.maxX - wing.building.minX + 6) / 28.7)
  return { ...layout, pan, camera: { target: wing.center, offset: layout.camera.offset.map((value) => value * Math.max(scale, 0.65)) as Vec3 } }
}
