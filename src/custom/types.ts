// custom: UI copies of the pipeline types (keep in sync with server/custom/pipeline.ts).

export const STAGES = ['Found', 'Researched', 'Proposal Drafted', 'Approved', 'Sent', 'Interview', 'Won', 'Lost'] as const
export type Stage = typeof STAGES[number]

export type Budget = { kind: 'fixed'; amount: number; currency: string } | { kind: 'hourly'; min: number; max?: number; currency: string } | { kind: 'unknown' }
export interface LeadFields { client?: string; budget?: Budget; upworkUrl?: string; posted?: string; fit?: number; tags: string[]; notes: string }
export interface WorkCard { id: string; title: string; status: string; assignee?: string; private?: boolean }
export interface Lead {
  id: string
  title: string
  status: string
  fields: LeadFields
  hasBlock: boolean
  stage?: Stage
  stageSince?: string
  daysInStage?: number
  historyAvailable: boolean
  assignedAgent?: string
  workCards: WorkCard[]
  createdAt?: string
  createdBy?: string
}
export interface StageEntry { stage: Stage; author: string; at?: string; reason?: string; ignored?: string }
export interface LeadDetail extends Lead {
  stageHistory: StageEntry[]
  comments: { author: string; body: string; createdAt?: string; private?: boolean }[]
}
export interface PipelineBoard { slug: string; exists: boolean | 'unknown'; availability: 'available' | 'unavailable'; error?: string }
export interface WriteStatus { enabled: boolean; reason?: string }
export interface PipelineSnapshot { board: PipelineBoard; leads: Lead[]; omitted: number; writes: WriteStatus; fetchedAt: string }
export interface LeadDetailSnapshot { lead: LeadDetail; board: PipelineBoard; writes: WriteStatus; fetchedAt: string }
