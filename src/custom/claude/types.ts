// custom: UI copies of the Claude section's API shapes (keep in step with server/custom/claude/teams.ts).
export interface NextRun { at?: string; label: string; macOff?: boolean }
export type AgentState = 'Working' | 'Waiting for you' | 'Queued' | 'Idle' | 'Ran today' | 'Not run yet today' | 'Paused' | 'Notifier' | 'Unknown'
export interface AgentLine { code: string; name: string; state: AgentState; detail: string; nextRun: NextRun; runsOnMac: boolean; notifierOnly: boolean; provenance: string }
export interface CardSummary { row: number; key: string; id?: string; title: string; status: string; statusKey: string; owner?: string; date?: string; score?: string; updated?: string }
export interface FilesHealth { status: 'readable' | 'denied' | 'missing' | 'error'; message: string }
export interface BoardView {
  id: string
  title: string
  kind: 'taskflow' | 'table'
  testCopy: boolean
  fetchedAt: string
  availability: 'available' | 'unavailable'
  reason?: string
  readOnly?: string
  files?: FilesHealth
  cards: CardSummary[]
  needsYou: number[]
  needsYouRule: boolean
  needsYouReason?: string
  neverTouch: number[]
}
export interface BoardLink { id: string; title: string; availability: 'available' | 'unavailable'; reason?: string; readOnly?: string; testCopy: boolean }
export interface TeamSummary {
  slug: string
  code: string
  name: string
  status: 'active' | 'paused'
  needsYou: number | null
  incomplete: boolean
  working: number | null
  waiting: number | null
  nextRun: { agent: string; run: NextRun } | null
  boards: BoardLink[]
  agents: AgentLine[]
}
export interface ClaudeOverview { availability: 'available' | 'unavailable'; reason?: string; ownerName: string; timezone: string; fetchedAt: string; teams: TeamSummary[] }
export interface ClaudeTeamData { team: TeamSummary; boards: BoardView[]; ownerName: string; timezone: string; fetchedAt: string }
