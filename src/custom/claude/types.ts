// custom: UI copies of the Claude section's API shapes (keep in step with server/custom/claude/teams.ts).
export interface NextRun { at?: string; label: string; macOff?: boolean }
export type AgentState = 'Working' | 'Waiting for you' | 'Queued' | 'Idle' | 'Ran today' | 'Not run yet today' | 'Paused' | 'Notifier' | 'Unknown'
export interface AgentLine { code: string; name: string; state: AgentState; detail: string; nextRun: NextRun; runsOnMac: boolean; notifierOnly: boolean; provenance: string }
export interface CardSummary { row: number; key: string; id?: string; title: string; status: string; statusKey: string; owner?: string; date?: string; score?: string; updated?: string; relations?: Relations }
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
  flow?: Flow
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

export type FlowColumn = 'needs' | 'queue' | 'working' | 'waiting' | 'done' | 'other'
export interface Relations { column: FlowColumn; dependsOn: string[]; unknownDeps: string[]; waitsFor: string[]; unlocks: string[]; stuck: boolean }
export interface NeedsItem { rank: number; id: string; row: number; status: string; unblocksNow: string[]; unblocksAll: string[]; reason: string }
export interface Queue { agent: string; order: string[]; nextRun?: NextRun }
export interface Flow { needs: NeedsItem[]; queues: Queue[]; chain: string[]; warnings: string[] }

export interface Question { n: number; text: string; recommend?: string }
export interface AgentNotes { format: 'sections' | 'paragraphs' | 'empty'; done: string[]; check: string[]; questions: Question[]; other: string[] }
export interface NoteBlock { date?: string; heading?: string; lines: string[] }
export type PathStateName = 'file' | 'dir' | 'missing' | 'not-downloaded' | 'refused' | 'error' | 'unknown'
export interface RowDetail {
  board: { id: string; title: string; kind: 'taskflow' | 'table'; testCopy: boolean; fetchedAt: string; readOnly?: string; hasFiles: boolean }
  card: CardSummary
  fields: { key: string; header: string; value: string }[]
  task: string
  agentNotes: AgentNotes
  ownerNotes: NoteBlock[]
  outputs: { text: string; links: { path: string; state: PathStateName }[] }[]
  ownerName: string
}
export interface DirEntry { name: string; path: string; type: 'dir' | 'file'; size: number }
export type FileView =
  | { path: string; kind: 'dir'; entries: DirEntry[]; truncated: boolean }
  | { path: string; kind: 'text'; ext: string; size: number; content: string; truncated: boolean; redactions: number }
  | { path: string; kind: 'inline' | 'download'; ext: string; size: number; mime: string }
  | { path: string; kind: 'other'; ext: string; size: number }
