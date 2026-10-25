// custom: the ONLY write actions Ruang can perform, each a fixed Hermes argv built from validated
// input (validate.ts). Flow: preview (validate, build the exact commands, hand out a single-use
// token) → the owner confirms in the UI → execute (re-validate against fresh data, run the same
// argv through the audited command runner). Never a shell; board pinned to `leads`; free text
// always after `--`; options only in `--opt=value` form.
import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { accessConfigDir } from '../access.js'
import { CommandError, jsonPayload, systemRun, TASK_ID, type RunOptions } from '../mission-control.js'
import { CLOSING_STAGES, formatLeadBody, LEADS_BOARD, OWNER, stageComment, type LeadFields } from './lead-format.js'
import type { PipelineData } from './pipeline.js'
import { cleanText, LIMITS, leadInput, params, profileName, stage as stageInput, taskId, ValidationError } from './validate.js'

type Run = (file: string, args: string[], options?: RunOptions) => Promise<string>

export const ACTIONS = ['board.setup', 'lead.create', 'lead.stage', 'lead.note', 'lead.assign'] as const
export type ActionName = typeof ACTIONS[number]
export const WORK_KINDS = { research: 'Research', proposal: 'Draft proposal' } as const
export type WorkKind = keyof typeof WORK_KINDS
/** Skills Hermes force-loads into the worker (`--skill`). A profile that has none of them refuses the run. */
export const WORK_SKILLS: Record<WorkKind, readonly string[]> = { research: ['leads-protocol', 'freelancer-facts'], proposal: ['leads-protocol', 'freelancer-facts'] }
/** The dedicated Hermes profile for each job, preselected in the UI. */
export const WORK_PROFILES: Record<WorkKind, string> = { research: 'lead-researcher', proposal: 'proposal-writer' }
/** Cost caps per work card: one attempt only (a failure or timeout blocks the card), at most 15 minutes. */
export const WORK_LIMITS = ['--max-runtime=15m', '--max-retries=1'] as const

export const TOKEN_TTL_MS = 2 * 60_000
export const WRITE_TIMEOUT_MS = 20_000
export const MAX_PER_MINUTE = 10
export const MAX_PER_DAY = 100
/** Placeholder for the id of the card created by an earlier step (cannot come from input). */
const CREATED = '\u0000created'
const BOARD = `--board=${LEADS_BOARD}`
const OPEN = new Set(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'scheduled'])
/** Statuses `hermes kanban complete` accepts. */
const COMPLETABLE = new Set(['ready', 'running', 'blocked', 'review'])

export class ActionError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

interface Step { args: string[]; /** What the audit log shows (free text replaced by its length). */ display: string; captureId?: boolean }
export interface Plan { action: ActionName; summary: string[]; steps: Step[]; leadId?: string }
export interface ActionContext { pipeline: PipelineData; profiles: readonly string[]; today: string }

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const chars = (label: string, value: string) => `<${label}: ${value.length} chars>`

function lookupLead(context: ActionContext, value: unknown) {
  const id = taskId(value)
  const lead = context.pipeline.leads.find((item) => item.id === id)
  if (!lead) throw new ActionError('This lead is not on the leads board (or not loaded). Refresh and try again.', 404)
  return lead
}

function requireBoard(context: ActionContext): void {
  if (context.pipeline.board.availability !== 'available') throw new ActionError('The leads board cannot be read right now, so no change is made.', 409)
  if (context.pipeline.board.exists !== true) throw new ActionError('The leads board is not set up yet.', 409)
}

function workBody(lead: { id: string; title: string; fields: LeadFields }, kind: WorkKind): string {
  const job = kind === 'research'
    ? ['Job: research this lead.', '1. Read the lead card with kanban_show(task_id="' + lead.id + '"), including every comment (the owner may have pasted the job post there).', '2. Try web_extract on the Upwork URL once; if it is blocked, write "Not Available" and continue. Never log in.', '3. Comment your findings on the LEAD card, including the Deliverables, Application questions (word for word) and Niche fit sections (Niche fit judged only against the freelancer-facts skill); the first line must be exactly: stage: Researched', '4. Finish this work card with kanban_complete(summary="<short findings>").']
    : ['Job: draft a proposal for this lead.', '1. Read the lead card with kanban_show(task_id="' + lead.id + '"), including every comment.', '2. Facts about the freelancer only from the freelancer-facts skill; write [MISSING: ...] for anything not there.', '3. Put the full draft in kanban_complete(summary="<draft>") on THIS work card.', '4. Comment on the LEAD card; the first line must be exactly: stage: Proposal Drafted', 'Never send anything to Upwork or the client.']
  return [`lead: ${lead.id}`, `job: ${kind}`, '', ...job, '', 'Rules: follow the leads-protocol skill. Never assign, block, archive or complete the lead card; you may only set the stages Researched and Proposal Drafted; finish with kanban_complete, never a review request; create or link no cards; no secrets; say "unknown" instead of guessing.', '', `Lead "${lead.title}" at assignment time:`, formatLeadBody(lead.fields)].join('\n')
}

/** Validates one request and builds its exact commands. Throws ValidationError / ActionError. */
export function plan(action: unknown, raw: unknown, context: ActionContext): Plan {
  if (!ACTIONS.includes(action as ActionName)) throw new ValidationError('Unknown action.')
  switch (action as ActionName) {
    case 'board.setup': {
      params(raw ?? {}, [])
      if (context.pipeline.board.availability !== 'available' || context.pipeline.board.exists === 'unknown') throw new ActionError('Hermes boards cannot be read right now, so the board is not created.', 409)
      if (context.pipeline.board.exists) throw new ActionError('The leads board already exists.', 409)
      const args = ['kanban', 'boards', 'create', '--name=Leads', '--description=Upwork lead and proposal pipeline (Ruang)', '--', LEADS_BOARD]
      return { action: 'board.setup', summary: ['Create the Hermes Kanban board "leads" (Leads).'], steps: [{ args, display: `hermes ${args.join(' ')}` }] }
    }
    case 'lead.create': {
      requireBoard(context)
      const { title, fields } = leadInput(raw, context.today)
      const duplicate = context.pipeline.leads.find((lead) => (fields.upworkUrl && lead.fields.upworkUrl === fields.upworkUrl) || lead.title.toLowerCase() === title.toLowerCase())
      if (duplicate) throw new ActionError(`A lead with this ${fields.upworkUrl && duplicate.fields.upworkUrl === fields.upworkUrl ? 'Upwork URL' : 'title'} already exists (${duplicate.id}).`, 409)
      const body = formatLeadBody(fields)
      const key = `ruang-lead-${sha(`${title.toLowerCase()}|${fields.upworkUrl ?? ''}`).slice(0, 16)}`
      const create = ['kanban', BOARD, 'create', `--body=${body}`, `--created-by=${OWNER}`, `--idempotency-key=${key}`, '--json', '--', title]
      const comment = ['kanban', BOARD, 'comment', `--author=${OWNER}`, '--', CREATED, stageComment('Found')]
      return {
        action: 'lead.create',
        summary: [`Add the lead "${title}" to the leads board (unassigned: no agent starts).`, 'Set its stage to Found.'],
        steps: [
          { args: create, display: `hermes kanban ${BOARD} create ${chars('--body', body)} --created-by=${OWNER} --idempotency-key=${key} --json -- ${chars('title', title)}`, captureId: true },
          { args: comment, display: `hermes kanban ${BOARD} comment --author=${OWNER} -- <new card> stage: Found` },
        ],
      }
    }
    case 'lead.stage': {
      requireBoard(context)
      const input = params(raw, ['id', 'stage', 'reason'])
      const lead = lookupLead(context, input.id)
      const next = stageInput(input.stage)
      const reason = cleanText(input.reason, 'Reason', { max: LIMITS.reason, multiline: true, optional: true })
      if (lead.status === 'done') throw new ActionError('This lead is closed (done). Its stage can no longer change.', 409)
      const closing = CLOSING_STAGES.includes(next)
      if (closing) {
        const open = lead.workCards.filter((card) => OPEN.has(card.status))
        if (open.length) throw new ActionError(`An agent work card is still open (${open.map((card) => `${card.id}: ${card.status}`).join(', ')}). Hermes cannot close the lead until it is done or archived.`, 409)
        if (!COMPLETABLE.has(lead.status)) throw new ActionError(`Hermes keeps this card in "${lead.status}", so it cannot be marked done now.`, 409)
      }
      const text = stageComment(next, reason)
      const comment = ['kanban', BOARD, 'comment', `--author=${OWNER}`, '--', lead.id, text]
      const steps: Step[] = [{ args: comment, display: `hermes kanban ${BOARD} comment --author=${OWNER} -- ${lead.id} stage: ${next}${reason ? ` ${chars('reason', reason)}` : ''}` }]
      if (closing) {
        const complete = ['kanban', BOARD, 'complete', `--result=${next}`, '--', lead.id]
        steps.push({ args: complete, display: `hermes ${complete.join(' ')}` })
      }
      return { action: 'lead.stage', leadId: lead.id, summary: [`Set the stage of "${lead.title}" to ${next}${reason ? ', with your reason' : ''}.`, ...(closing ? [`Mark the lead card done (result: ${next}). This is final.`] : [])], steps }
    }
    case 'lead.note': {
      requireBoard(context)
      const input = params(raw, ['id', 'text'])
      const lead = lookupLead(context, input.id)
      const text = cleanText(input.text, 'Note', { max: LIMITS.comment, multiline: true })!
      // A note never changes the stage: a first line that reads like a stage comment is refused.
      if (/^\s*stage\s*:/i.test(text)) throw new ValidationError('A note cannot start with "stage:". Use Change stage instead.')
      const args = ['kanban', BOARD, 'comment', `--author=${OWNER}`, '--', lead.id, text]
      return { action: 'lead.note', leadId: lead.id, summary: [`Add a note to "${lead.title}".`], steps: [{ args, display: `hermes kanban ${BOARD} comment --author=${OWNER} -- ${lead.id} ${chars('note', text)}` }] }
    }
    case 'lead.assign': {
      requireBoard(context)
      const input = params(raw, ['id', 'profile', 'kind'])
      const lead = lookupLead(context, input.id)
      const profile = profileName(input.profile, context.profiles)
      if (input.kind !== 'research' && input.kind !== 'proposal') throw new ValidationError('Pick the job: research or proposal.')
      const kind = input.kind as WorkKind
      if (lead.status === 'done') throw new ActionError('This lead is closed (done).', 409)
      const prefix = `[lead ${lead.id}] ${WORK_KINDS[kind]}:`
      const busy = lead.workCards.find((card) => card.title.startsWith(prefix) && OPEN.has(card.status))
      if (busy) throw new ActionError(`This lead already has an open ${WORK_KINDS[kind].toLowerCase()} card (${busy.id}: ${busy.status}).`, 409)
      const finished = lead.workCards.filter((card) => card.title.startsWith(prefix) && card.status === 'done').length
      const title = `${prefix} ${lead.title.slice(0, 120)}`
      const body = workBody(lead, kind)
      const key = `ruang-work-${lead.id}-${kind}-${sha(`${profile}|${lead.workCards.length}`).slice(0, 8)}`
      const skills = WORK_SKILLS[kind].map((skill) => `--skill=${skill}`)
      const options = [`--assignee=${profile}`, ...skills, ...WORK_LIMITS]
      const create = ['kanban', BOARD, 'create', ...options, `--body=${body}`, `--created-by=${OWNER}`, `--idempotency-key=${key}`, '--json', '--', title]
      const link = ['kanban', BOARD, 'link', '--', CREATED, lead.id]
      return {
        action: 'lead.assign',
        leadId: lead.id,
        summary: [
          `Create a "${WORK_KINDS[kind]}" work card for "${lead.title}", assigned to ${profile}.`,
          `${profile} starts working on it within about a minute (the Hermes gateway runs it) and uses tokens.`,
          `Limits: one attempt only (a failure or timeout blocks the card), at most 15 minutes. Skills loaded: ${WORK_SKILLS[kind].join(', ')}.`,
          ...(finished ? [`Warning: this lead already has ${finished} finished ${WORK_KINDS[kind].toLowerCase()} run${finished === 1 ? '' : 's'}. A new run uses tokens again.`] : []),
          ...(profile === WORK_PROFILES[kind] ? [] : [`${profile} is not the dedicated ${WORK_PROFILES[kind]} profile: if it lacks these skills, Hermes stops the card at once.`]),
          'Link it to the lead card so the lead shows it.',
        ],
        steps: [
          { args: create, display: `hermes kanban ${BOARD} create ${options.join(' ')} ${chars('--body', body)} --created-by=${OWNER} --idempotency-key=${key} --json -- ${chars('title', title)}`, captureId: true },
          { args: link, display: `hermes kanban ${BOARD} link -- <new card> ${lead.id}` },
        ],
      }
    }
  }
}

/** The commands as the owner sees them in the confirmation dialog (display quoting only; no shell). */
export function shown(steps: readonly Step[]): string[] {
  const quote = (arg: string) => (arg === CREATED ? '<new card id>' : /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)
  return steps.map((step) => ['hermes', ...step.args.map(quote)].join(' '))
}

export interface ExecuteResult { ok: boolean; action: ActionName; leadId?: string; createdId?: string; completedSteps: number; totalSteps: number; error?: string; /** A timed-out write may or may not have been applied. */ uncertain?: boolean }

interface Pending { action: ActionName; raw: unknown; session: string; expires: number; argv: string }

export class WriteActions {
  private tokens = new Map<string, Pending>()
  private recent: number[] = []
  private busy = false

  constructor(private readonly options: { run?: Run; auditPath?: string; now?: () => number } = {}) {}

  get auditPath(): string { return this.options.auditPath ?? join(accessConfigDir(), 'write-audit.jsonl') }
  private now(): number { return this.options.now?.() ?? Date.now() }

  preview(action: unknown, raw: unknown, context: ActionContext, session: string) {
    const built = plan(action, raw, context)
    const now = this.now()
    for (const [key, item] of this.tokens) if (item.expires <= now) this.tokens.delete(key)
    if (this.tokens.size > 200) this.tokens.clear()
    const token = randomBytes(16).toString('hex')
    const expires = now + TOKEN_TTL_MS
    this.tokens.set(token, { action: built.action, raw, session: sha(session), expires, argv: JSON.stringify(built.steps.map((step) => step.args)) })
    return { token, action: built.action, summary: built.summary, commands: shown(built.steps), expiresAt: new Date(expires).toISOString() }
  }

  async execute(token: unknown, session: string, freshContext: () => Promise<ActionContext>): Promise<ExecuteResult> {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) throw new ValidationError('Missing confirmation token.')
    const pending = this.tokens.get(token)
    this.tokens.delete(token)
    const now = this.now()
    if (!pending || pending.session !== sha(session)) throw new ActionError('This confirmation is not valid (already used, or from another session). Start the action again.', 409)
    if (pending.expires <= now) throw new ActionError('This confirmation expired. Start the action again.', 409)
    this.recent = this.recent.filter((time) => now - time < 86_400_000)
    if (this.recent.filter((time) => now - time < 60_000).length >= MAX_PER_MINUTE) throw new ActionError(`At most ${MAX_PER_MINUTE} write actions per minute. Wait a moment.`, 429)
    if (this.recent.length >= MAX_PER_DAY) throw new ActionError(`At most ${MAX_PER_DAY} write actions per day.`, 429)
    if (this.busy) throw new ActionError('Another write action is still running. Wait for it to finish.', 429)
    this.busy = true
    this.recent.push(now)
    try {
      // Re-check against fresh data: the same request must still be valid and build the same argv.
      const built = plan(pending.action, pending.raw, await freshContext())
      if (JSON.stringify(built.steps.map((step) => step.args)) !== pending.argv) throw new ActionError('The lead changed since you confirmed. Nothing was done; start the action again.', 409)
      const result = await this.run(built)
      await this.audit(result)
      return result
    } finally {
      this.busy = false
    }
  }

  private async run(built: Plan): Promise<ExecuteResult> {
    const run = this.options.run ?? systemRun
    let createdId: string | undefined
    const base = { action: built.action, ...(built.leadId ? { leadId: built.leadId } : {}), totalSteps: built.steps.length }
    for (const [index, step] of built.steps.entries()) {
      const args = step.args.map((arg) => (arg === CREATED ? createdId! : arg))
      try {
        const output = await run('hermes', args, { write: { display: step.display, timeoutMs: WRITE_TIMEOUT_MS } })
        if (step.captureId) {
          const id = (() => { try { const parsed = jsonPayload(output) as Record<string, unknown>; return typeof parsed?.id === 'string' && TASK_ID.test(parsed.id) ? parsed.id : undefined } catch { return undefined } })()
          if (!id) return { ...base, ok: false, completedSteps: index + 1, error: 'Hermes created the card but did not report its id, so the next step was not run. Refresh to see it.', uncertain: true }
          createdId = id
        }
      } catch (error) {
        const timeout = error instanceof CommandError && error.code === 'TIMEOUT'
        return { ...base, ok: false, completedSteps: index, ...(createdId ? { createdId } : {}), error: timeout ? 'Hermes did not answer in time. Unknown whether this step was applied. Refresh to check.' : `Hermes refused step ${index + 1} of ${built.steps.length}${error instanceof Error ? ` (${error.message})` : ''}.`, ...(timeout ? { uncertain: true } : {}) }
      }
    }
    return { ...base, ok: true, completedSteps: built.steps.length, ...(createdId ? { createdId } : {}) }
  }

  /** Append-only record in Ruang's own config folder. No free text, only what happened. */
  private async audit(result: ExecuteResult): Promise<void> {
    const entry = { at: new Date(this.now()).toISOString(), action: result.action, leadId: result.leadId, createdId: result.createdId, ok: result.ok, steps: `${result.completedSteps}/${result.totalSteps}`, ...(result.uncertain ? { uncertain: true } : {}), ...(result.ok ? {} : { error: result.error }) }
    try {
      await mkdir(dirname(this.auditPath), { recursive: true, mode: 0o700 })
      await appendFile(this.auditPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch (error) {
      console.error('Ruang write audit could not be saved:', error instanceof Error ? error.message : error)
    }
  }
}
