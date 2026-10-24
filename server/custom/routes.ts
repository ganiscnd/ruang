// custom: HTTP routes of the freelance Mission Control features, installed by server/index.ts.
import type { Express, Request } from 'express'
import { cachedSource, TASK_ID } from '../mission-control.js'
import { PRIVATE_TASK } from '../privacy.js'
import { isHidden, type Privacy } from '../profile-lock.js'
import { collectPipeline, type LeadDetail, type PipelineData } from './pipeline.js'

const PIPELINE_CACHE_MS = 30_000
const FRESH_WINDOW_MS = 25_000
const PRIVATE_COMMENT = '🔒 Private comment'

export const pipelineSource = cachedSource(() => collectPipeline(), PIPELINE_CACHE_MS)

export interface WriteStatus { enabled: boolean; reason?: string }

/** Withholds what locked agents wrote or work on: work card titles, their comments and stage reasons. */
export function redactLead(lead: LeadDetail, privacy: Privacy): LeadDetail {
  if (!privacy.all && privacy.hidden.size === 0) return lead
  return {
    ...lead,
    workCards: lead.workCards.map((card) => (isHidden(privacy, card.assignee) ? { ...card, title: PRIVATE_TASK, private: true } : card)),
    comments: lead.comments.map((comment) => (isHidden(privacy, comment.author) ? { ...comment, body: PRIVATE_COMMENT, private: true } : comment)),
    stageHistory: lead.stageHistory.map(({ reason, ...entry }) => (isHidden(privacy, entry.author) ? entry : { ...entry, ...(reason ? { reason } : {}) })),
  }
}

function listView(data: PipelineData, privacy: Privacy) {
  return { ...data, leads: data.leads.map((lead) => { const { comments: _comments, stageHistory: _history, ...summary } = redactLead(lead, privacy); void _comments; void _history; return summary }) }
}

export function installCustom(app: Express, privacyOf: (request: Request) => Promise<Privacy>, writeStatus: (request: Request) => Promise<WriteStatus>, source: (now: number) => Promise<PipelineData> = pipelineSource): void {
  const now = (request: Request) => Date.now() + (request.query.fresh === '1' ? FRESH_WINDOW_MS : 0)
  app.get('/api/custom/pipeline', async (request, response) => {
    const [data, privacy, writes] = await Promise.all([source(now(request)), privacyOf(request), writeStatus(request)])
    response.json({ ...listView(data, privacy), writes })
  })
  app.get('/api/custom/pipeline/:id', async (request, response) => {
    const id = String(request.params.id)
    if (!TASK_ID.test(id)) { response.status(400).json({ error: 'Invalid lead id.' }); return }
    const [data, privacy, writes] = await Promise.all([source(now(request)), privacyOf(request), writeStatus(request)])
    const lead = data.leads.find((item) => item.id === id)
    if (!lead) { response.status(404).json({ error: 'Unknown lead.' }); return }
    response.json({ lead: redactLead(lead, privacy), board: data.board, writes, fetchedAt: data.fetchedAt })
  })
}
