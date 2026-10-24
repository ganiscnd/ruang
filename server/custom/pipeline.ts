// custom: Lead & Proposal Pipeline. Reads the Hermes Kanban board `leads` (read-only commands):
// one `list --json` for every card, then `show --json` per lead for its comments (stage history)
// and its links. Missing or unreadable data stays unknown; nothing is guessed.
import { CommandError, jsonPayload, mapLimit, parseBoards, parseTaskDetail, redactLogLine, systemRun, TASK_ID, type Availability, type RunOptions, type TaskDetail } from '../mission-control.js'
import { currentStage, daysSince, LEADS_BOARD, leadIdOfWorkTitle, parseLeadBody, stageHistory, type LeadFields, type Stage, type StageEntry } from './lead-format.js'

type Run = (file: string, args: string[], options?: RunOptions) => Promise<string>

export const MAX_LEADS = 100
const SHOW_CONCURRENCY = 4
const OPEN_WORK = new Set(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'scheduled'])

export interface WorkCard { id: string; title: string; status: string; assignee?: string; /** Withheld by the profile lock. */ private?: boolean }
export interface Lead {
  id: string
  title: string
  /** Hermes status of the lead card itself. */
  status: string
  fields: LeadFields
  /** False when the body has no `[lead]` block, so every field is unknown. */
  hasBlock: boolean
  /** undefined = Unknown (no stage comment, or the history could not be read). */
  stage?: Stage
  stageSince?: string
  daysInStage?: number
  /** False when `show` failed for this lead: stage, comments and links are unknown. */
  historyAvailable: boolean
  /** Assignee of an open work card, when there is one. */
  assignedAgent?: string
  workCards: WorkCard[]
  createdAt?: string
  createdBy?: string
}
export interface LeadDetail extends Lead {
  stageHistory: StageEntry[]
  comments: { author: string; body: string; createdAt?: string; private?: boolean }[]
}
export interface PipelineSnapshot {
  board: { slug: string; exists: boolean | 'unknown'; availability: Availability; error?: string }
  leads: Lead[]
  /** Leads on the board beyond MAX_LEADS (not shown). */
  omitted: number
  fetchedAt: string
}
/** The full read, details included; the list endpoint strips comments and history. */
export interface PipelineData extends Omit<PipelineSnapshot, 'leads'> { leads: LeadDetail[] }

interface RawCard { id: string; title: string; body?: string; status: string; assignee?: string; createdAt?: string; createdBy?: string }

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function epoch(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : undefined
}

/** Every card of `hermes kanban --board leads list --json`, body included. */
export function parseCards(output: string): RawCard[] {
  const parsed = jsonPayload(output)
  if (!Array.isArray(parsed)) throw new Error('Unrecognized Kanban output.')
  return parsed.flatMap((item): RawCard[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = text(record.id)
    const title = text(record.title)
    const status = text(record.status)
    if (!id || !TASK_ID.test(id) || !title || !status) return []
    return [{ id, title, status: status.toLowerCase(), ...(text(record.body) ? { body: record.body as string } : {}), ...(text(record.assignee) ? { assignee: text(record.assignee) } : {}), ...(epoch(record.created_at) ? { createdAt: epoch(record.created_at) } : {}), ...(text(record.created_by) ? { createdBy: text(record.created_by) } : {}) }]
  })
}

const redactBody = (body: string | undefined) => body?.split('\n').map((line) => redactLogLine(line, Number.POSITIVE_INFINITY)).join('\n')

function failure(error: unknown): string {
  if (error instanceof CommandError) return error.message
  if (error instanceof SyntaxError) return 'Source returned output that could not be parsed.'
  return error instanceof Error && /^Unrecognized/.test(error.message) ? error.message : 'Read command was unavailable.'
}

export async function collectPipeline(run: Run = systemRun, now = Date.now()): Promise<PipelineData> {
  const fetchedAt = new Date().toISOString()
  const board = { slug: LEADS_BOARD }
  let exists: boolean
  try {
    exists = parseBoards(await run('hermes', ['kanban', 'boards', 'list', '--json'])).some((item) => item.slug === LEADS_BOARD)
  } catch (error) {
    return { board: { ...board, exists: 'unknown', availability: 'unavailable', error: failure(error) }, leads: [], omitted: 0, fetchedAt }
  }
  if (!exists) return { board: { ...board, exists: false, availability: 'available' }, leads: [], omitted: 0, fetchedAt }
  let cards: RawCard[]
  try {
    cards = parseCards(await run('hermes', ['kanban', '--board', LEADS_BOARD, 'list', '--json']))
  } catch (error) {
    return { board: { ...board, exists: true, availability: 'unavailable', error: failure(error) }, leads: [], omitted: 0, fetchedAt }
  }
  const work = cards.filter((card) => leadIdOfWorkTitle(card.title))
  const leadCards = cards.filter((card) => !leadIdOfWorkTitle(card.title)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const shown = leadCards.slice(0, MAX_LEADS)
  const details = await mapLimit(shown, SHOW_CONCURRENCY, async (card): Promise<TaskDetail | undefined> => {
    try { return parseTaskDetail(await run('hermes', ['kanban', '--board', LEADS_BOARD, 'show', card.id, '--json'])) } catch { return undefined }
  })
  const leads = shown.map((card, index) => buildLead(card, details[index], work, now))
  return { board: { ...board, exists: true, availability: 'available' }, leads, omitted: leadCards.length - shown.length, fetchedAt }
}

function buildLead(card: RawCard, detail: TaskDetail | undefined, work: RawCard[], now: number): LeadDetail {
  const { fields, hasBlock } = parseLeadBody(redactBody(card.body))
  const comments = detail?.comments ?? []
  const history = detail ? stageHistory(comments) : []
  const current = currentStage(history)
  // Linked work cards are the lead's parents; the `[lead <id>]` title prefix is the fallback.
  const parents = new Set(detail?.parents ?? [])
  const workCards = work.filter((item) => parents.has(item.id) || leadIdOfWorkTitle(item.title) === card.id).map((item): WorkCard => ({ id: item.id, title: item.title, status: item.status, ...(item.assignee ? { assignee: item.assignee } : {}) }))
  const open = workCards.find((item) => item.assignee && OPEN_WORK.has(item.status))
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    fields,
    hasBlock,
    ...(current ? { stage: current.stage, ...(current.at ? { stageSince: current.at } : {}) } : {}),
    ...(current && daysSince(current.at, now) !== undefined ? { daysInStage: daysSince(current.at, now) } : {}),
    historyAvailable: detail !== undefined,
    ...(open?.assignee ? { assignedAgent: open.assignee } : {}),
    workCards,
    ...(card.createdAt ? { createdAt: card.createdAt } : {}),
    ...(card.createdBy ? { createdBy: card.createdBy } : {}),
    stageHistory: history,
    comments,
  }
}
