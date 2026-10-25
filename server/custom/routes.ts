// custom: HTTP routes of the freelance Mission Control features, installed by server/index.ts.
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { AccessOfRequest } from '../access.js'
import { cachedSource, clearTaskBoardCache, getSnapshot, TASK_ID } from '../mission-control.js'
import { PRIVATE_TASK } from '../privacy.js'
import { isHidden, type Privacy } from '../profile-lock.js'
import { ActionError, WriteActions, type ActionContext } from './actions.js'
import { collectPipeline, type LeadDetail, type PipelineData } from './pipeline.js'
import { ValidationError } from './validate.js'

const PIPELINE_CACHE_MS = 30_000
const FRESH_WINDOW_MS = 25_000
const PRIVATE_COMMENT = '🔒 Private comment'

export const pipelineSource = cachedSource(() => collectPipeline(), PIPELINE_CACHE_MS)

export interface WriteStatus { enabled: boolean; reason?: string }

export function writeStatus(access: AccessOfRequest): WriteStatus {
  if (!access.enabled) return { enabled: false, reason: 'Write actions need the access code. Turn it on in Settings.' }
  if (!access.unlocked || !access.session) return { enabled: false, reason: 'Ruang is locked. Enter the access code to use write actions.' }
  return { enabled: true }
}

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

/**
 * Write requests must come from Ruang's own page: the custom header needs a CORS preflight that
 * Ruang never answers, and the browser's own same-origin signals must agree when it sends them.
 */
export function sameOrigin(request: Request): string | undefined {
  if (request.get('x-ruang-request') !== '1') return 'Missing request header.'
  const site = request.get('sec-fetch-site')
  if (site && site !== 'same-origin') return 'Cross-site request.'
  const origin = request.get('origin')
  if (origin) {
    let host: string
    try { host = new URL(origin).host } catch { return 'Bad origin.' }
    const allowed = [request.get('host'), request.get('x-forwarded-host')].filter(Boolean)
    if (!allowed.includes(host)) return 'Cross-origin request.'
  }
  return undefined
}

export interface CustomOptions {
  privacyOf: (request: Request) => Promise<Privacy>
  accessOf: (request: Request) => Promise<AccessOfRequest>
  source?: (now: number) => Promise<PipelineData>
  actions?: WriteActions
  profiles?: () => Promise<string[]>
  /** Called after every executed write, so cached reads show it at once. */
  afterWrite?: () => void
}

const today = () => new Date().toLocaleDateString('en-CA')

export function installCustom(app: Express, options: CustomOptions): void {
  const source = options.source ?? pipelineSource
  const actions = options.actions ?? new WriteActions()
  const profiles = options.profiles ?? (async () => { const runtime = await getSnapshot(); return runtime.profiles.availability === 'available' ? runtime.profiles.data.map((profile) => profile.name) : [] })
  const afterWrite = options.afterWrite ?? (() => { pipelineSource.clear(); clearTaskBoardCache() })
  const now = (request: Request) => Date.now() + (request.query.fresh === '1' ? FRESH_WINDOW_MS : 0)

  app.get('/api/custom/pipeline', async (request, response) => {
    const [data, privacy, access] = await Promise.all([source(now(request)), options.privacyOf(request), options.accessOf(request)])
    response.json({ ...listView(data, privacy), writes: writeStatus(access) })
  })
  app.get('/api/custom/pipeline/:id', async (request, response) => {
    const id = String(request.params.id)
    if (!TASK_ID.test(id)) { response.status(400).json({ error: 'Invalid lead id.' }); return }
    const [data, privacy, access, agents] = await Promise.all([source(now(request)), options.privacyOf(request), options.accessOf(request), profiles()])
    const lead = data.leads.find((item) => item.id === id)
    if (!lead) { response.status(404).json({ error: 'Unknown lead.' }); return }
    // `agents`: the Hermes profiles "Assign to agent" may pick (validated again on the server).
    response.json({ lead: redactLead(lead, privacy), board: data.board, writes: writeStatus(access), agents, fetchedAt: data.fetchedAt })
  })

  const context = async (fresh: boolean): Promise<ActionContext> => {
    const [pipeline, names] = await Promise.all([source(Date.now() + (fresh ? PIPELINE_CACHE_MS + 1 : 0)), profiles()])
    return { pipeline, profiles: names, today: today() }
  }
  const guard = async (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST') { response.status(405).json({ error: 'Method not allowed.' }); return }
    const problem = sameOrigin(request)
    if (problem) { response.status(403).json({ error: `Forbidden: ${problem}` }); return }
    const status = writeStatus(await options.accessOf(request))
    if (!status.enabled) { response.status(403).json({ error: status.reason, writes: status }); return }
    next()
  }
  const handle = (handler: (request: Request) => Promise<unknown>) => async (request: Request, response: Response) => {
    try {
      response.json(await handler(request))
    } catch (error) {
      if (error instanceof ValidationError) { response.status(400).json({ error: error.message }); return }
      if (error instanceof ActionError) { response.status(error.status).json({ error: error.message }); return }
      throw error
    }
  }
  const body = (request: Request) => (request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {})
  app.use('/api/custom/actions', express.json({ limit: '32kb' }), guard)
  app.post('/api/custom/actions/preview', handle(async (request) => {
    const { action, params } = body(request)
    return actions.preview(action, params, await context(false), (await options.accessOf(request)).session!)
  }))
  app.post('/api/custom/actions/execute', handle(async (request) => {
    try {
      return await actions.execute(body(request).token, (await options.accessOf(request)).session!, () => context(true))
    } finally {
      afterWrite()
    }
  }))
}
