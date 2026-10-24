// custom: Lead & Proposal Pipeline. The human-readable lead format shared by Ruang and the Hermes
// agents (docs/LEADS_PROTOCOL.md): a `[lead]` block of `key: value` lines at the top of a Kanban
// task body, free notes after a `---` line, and the stage as `stage: <Stage>` comments.

export const LEADS_BOARD = 'leads'
/** Author name Ruang writes on the owner's comments and cards. */
export const OWNER = 'owner'

export const STAGES = ['Found', 'Researched', 'Proposal Drafted', 'Approved', 'Sent', 'Interview', 'Won', 'Lost'] as const
export type Stage = typeof STAGES[number]
/** Stages an agent may set; the others are the owner's decisions. */
export const AGENT_STAGES: readonly Stage[] = ['Found', 'Researched', 'Proposal Drafted']
/** Stages that close the lead card (stage comment, then `complete`). */
export const CLOSING_STAGES: readonly Stage[] = ['Won', 'Lost']

export type Budget = { kind: 'fixed'; amount: number; currency: string } | { kind: 'hourly'; min: number; max?: number; currency: string } | { kind: 'unknown' }

export interface LeadFields {
  client?: string
  budget?: Budget
  upworkUrl?: string
  /** YYYY-MM-DD */
  posted?: string
  /** 1-5 */
  fit?: number
  tags: string[]
  notes: string
}

export const UPWORK_URL = /^https:\/\/www\.upwork\.com\/(?:jobs|freelance-jobs)\/[A-Za-z0-9_~%.-]+(?:\/[A-Za-z0-9_~%.-]+)*\/?$/
export const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/
export const MAX_TAGS = 10
const MAX_FIELD_LENGTH = 200

function amount(value: string): number | undefined {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : undefined
}

export function parseBudget(value: string): Budget | undefined {
  const text = value.trim()
  if (/^unknown$/i.test(text)) return { kind: 'unknown' }
  const fixed = text.match(/^fixed\s+([\d,.]+)\s+([A-Za-z]{3})$/i)
  if (fixed) {
    const parsed = amount(fixed[1])
    return parsed === undefined ? undefined : { kind: 'fixed', amount: parsed, currency: fixed[2].toUpperCase() }
  }
  const hourly = text.match(/^hourly\s+([\d,.]+)(?:\s*-\s*([\d,.]+))?\s+([A-Za-z]{3})$/i)
  if (hourly) {
    const min = amount(hourly[1])
    const max = hourly[2] === undefined ? undefined : amount(hourly[2])
    if (min === undefined || (hourly[2] !== undefined && (max === undefined || max < min))) return undefined
    return { kind: 'hourly', min, ...(max !== undefined && max !== min ? { max } : {}), currency: hourly[3].toUpperCase() }
  }
  return undefined
}

export function formatBudget(budget: Budget): string {
  if (budget.kind === 'unknown') return 'unknown'
  if (budget.kind === 'fixed') return `fixed ${budget.amount} ${budget.currency}`
  return `hourly ${budget.min}${budget.max !== undefined ? `-${budget.max}` : ''} ${budget.currency}`
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag) => TAG.test(tag)))].slice(0, MAX_TAGS)
}

/** Reads the `[lead]` block. A body without one is all notes and every field is unknown. */
export function parseLeadBody(body: string | undefined): { fields: LeadFields; hasBlock: boolean } {
  const lines = (body ?? '').replace(/\r/g, '').split('\n')
  const start = lines.findIndex((line) => line.trim() !== '')
  if (start < 0 || !/^\[lead\]$/i.test(lines[start].trim())) return { fields: { tags: [], notes: (body ?? '').trim() }, hasBlock: false }
  const fields: LeadFields = { tags: [], notes: '' }
  let index = start + 1
  for (; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '---') { index += 1; break }
    const match = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim().slice(0, MAX_FIELD_LENGTH)
    if (!value) continue
    if (key === 'client') fields.client = value
    else if (key === 'budget') fields.budget = parseBudget(value)
    else if (key === 'upwork_url' && UPWORK_URL.test(value)) fields.upworkUrl = value
    else if (key === 'posted' && isValidDate(value)) fields.posted = value
    else if (key === 'fit' && /^[1-5]$/.test(value)) fields.fit = Number(value)
    else if (key === 'tags') fields.tags = parseTags(value)
  }
  fields.notes = lines.slice(index).join('\n').trim()
  if (!fields.budget) delete fields.budget
  return { fields, hasBlock: true }
}

/** The body Ruang writes for a new lead. Values must already be validated (validate.ts). */
export function formatLeadBody(fields: LeadFields): string {
  const rows = [
    '[lead]',
    ...(fields.client ? [`client: ${fields.client}`] : []),
    `budget: ${formatBudget(fields.budget ?? { kind: 'unknown' })}`,
    ...(fields.upworkUrl ? [`upwork_url: ${fields.upworkUrl}`] : []),
    ...(fields.posted ? [`posted: ${fields.posted}`] : []),
    ...(fields.fit !== undefined ? [`fit: ${fields.fit}`] : []),
    ...(fields.tags.length ? [`tags: ${fields.tags.join(', ')}`] : []),
    '---',
  ]
  return fields.notes ? `${rows.join('\n')}\n${fields.notes}` : rows.join('\n')
}

/** `stage: <Stage>` on the first line of a comment, with an optional reason after it. */
export function parseStageComment(body: string): { stage: Stage; reason?: string } | undefined {
  const [first = '', ...rest] = body.replace(/\r/g, '').split('\n')
  const match = first.trim().match(/^stage\s*:\s*(.+?)\s*$/i)
  if (!match) return undefined
  const wanted = match[1].replace(/\s+/g, ' ').toLowerCase()
  const stage = STAGES.find((item) => item.toLowerCase() === wanted)
  if (!stage) return undefined
  const reason = rest.join('\n').trim()
  return { stage, ...(reason ? { reason } : {}) }
}

export function stageComment(stage: Stage, reason?: string): string {
  return reason ? `stage: ${stage}\n${reason}` : `stage: ${stage}`
}

export interface StageEntry { stage: Stage; author: string; at?: string; reason?: string; /** Why this entry does not count. */ ignored?: string }

/** Every stage comment in order; owner-only stages written by anyone else are kept but ignored. */
export function stageHistory(comments: readonly { author: string; body: string; createdAt?: string }[]): StageEntry[] {
  // Oldest first; comments without a time keep their Hermes order (stable sort).
  const ordered = [...comments].sort((a, b) => (a.createdAt && b.createdAt ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : 0))
  return ordered.flatMap((comment): StageEntry[] => {
    const parsed = parseStageComment(comment.body)
    if (!parsed) return []
    const ownerOnly = !AGENT_STAGES.includes(parsed.stage) && comment.author !== OWNER
    return [{ stage: parsed.stage, author: comment.author, ...(comment.createdAt ? { at: comment.createdAt } : {}), ...(parsed.reason ? { reason: parsed.reason } : {}), ...(ownerOnly ? { ignored: `Only the owner sets ${parsed.stage}.` } : {}) }]
  })
}

/** The newest counting stage entry; undefined means the stage is Unknown. */
export function currentStage(history: readonly StageEntry[]): StageEntry | undefined {
  return [...history].reverse().find((entry) => !entry.ignored)
}

export function daysSince(at: string | undefined, now: number): number | undefined {
  const time = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(time) && time <= now ? Math.floor((now - time) / 86_400_000) : undefined
}

/** Work cards carry `[lead <id>]` at the start of their title. */
export function leadIdOfWorkTitle(title: string): string | undefined {
  return title.match(/^\[lead ([A-Za-z0-9][A-Za-z0-9_-]{0,63})\]/)?.[1]
}
