// custom: display text for pipeline leads. Missing data reads "Not Available", never a guess.
import type { Budget, Lead, Stage } from './types.ts'

export const NOT_AVAILABLE = 'Not Available'
export const UNKNOWN_STAGE = 'Unknown'
export type StageColumn = Stage | typeof UNKNOWN_STAGE

const money = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

export function budgetLabel(budget: Budget | undefined): string {
  if (!budget) return NOT_AVAILABLE
  if (budget.kind === 'unknown') return 'Unknown'
  if (budget.kind === 'fixed') return `Fixed ${money.format(budget.amount)} ${budget.currency}`
  return `Hourly ${money.format(budget.min)}${budget.max !== undefined ? `-${money.format(budget.max)}` : ''} ${budget.currency}/h`
}

export function fitLabel(fit: number | undefined): string {
  return fit === undefined ? NOT_AVAILABLE : `${'●'.repeat(fit)}${'○'.repeat(5 - fit)} ${fit}/5`
}

export function stageColumn(lead: Pick<Lead, 'stage'>): StageColumn {
  return lead.stage ?? UNKNOWN_STAGE
}

export function daysLabel(lead: Pick<Lead, 'stage' | 'daysInStage'>): string {
  if (!lead.stage) return UNKNOWN_STAGE
  if (lead.daysInStage === undefined) return NOT_AVAILABLE
  return lead.daysInStage === 0 ? 'Today' : `${lead.daysInStage} day${lead.daysInStage === 1 ? '' : 's'}`
}

export function dateLabel(date: string | undefined): string {
  if (!date) return NOT_AVAILABLE
  const time = Date.parse(`${date}T00:00:00`)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString() : NOT_AVAILABLE
}

/** Search over title, client, tags and stage. */
export function matchesSearch(lead: Lead, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [lead.title, lead.fields.client ?? '', lead.fields.tags.join(' '), lead.stage ?? UNKNOWN_STAGE, lead.id].join(' ').toLowerCase().includes(needle)
}

export const STAGE_TONE: Record<StageColumn, 'good' | 'info' | 'unknown' | 'muted' | 'bad'> = {
  Unknown: 'unknown', Found: 'unknown', Researched: 'info', 'Proposal Drafted': 'info', Approved: 'info', Sent: 'info', Interview: 'good', Won: 'good', Lost: 'muted',
}
