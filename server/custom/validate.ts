// custom: validation of browser input for write actions. Everything that reaches a Hermes argv
// passes through here first: fixed types, length limits, no control characters, no unknown keys.
import { PROFILE_NAME, TASK_ID } from '../mission-control.js'
import { isValidDate, MAX_TAGS, parseBudget, STAGES, TAG, UPWORK_URL, type Budget, type LeadFields, type Stage } from './lead-format.js'

export class ValidationError extends Error {}

export const LIMITS = { title: 150, client: 120, notes: 4000, comment: 2000, reason: 500, url: 300 } as const

type Params = Record<string, unknown>

export function params(value: unknown, allowed: readonly string[]): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Expected an object.')
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new ValidationError(`Unknown field: ${unknown[0]}.`)
  return value as Params
}

/**
 * Normalized text. One-line fields lose every control character and may not contain a line
 * break, so they can never add a `key:` or `stage:` line to a card. Multi-line fields keep `\n`.
 */
export function cleanText(value: unknown, label: string, { max, min = 0, multiline = false, optional = false }: { max: number; min?: number; multiline?: boolean; optional?: boolean }): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined
    throw new ValidationError(`${label} is required.`)
  }
  if (typeof value !== 'string') throw new ValidationError(`${label} must be text.`)
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
  if (!multiline && normalized.includes('\n')) throw new ValidationError(`${label} must be a single line.`)
  // eslint-disable-next-line no-control-regex
  const text = normalized.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g : /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim()
  if (!text) {
    if (optional) return undefined
    throw new ValidationError(`${label} is required.`)
  }
  if (text.length < min) throw new ValidationError(`${label} needs at least ${min} characters.`)
  if (text.length > max) throw new ValidationError(`${label} can have at most ${max} characters.`)
  return text
}

export function taskId(value: unknown, label = 'Lead id'): string {
  if (typeof value !== 'string' || !TASK_ID.test(value)) throw new ValidationError(`${label} is not valid.`)
  return value
}

export function profileName(value: unknown, known: readonly string[]): string {
  if (typeof value !== 'string' || !PROFILE_NAME.test(value) || !known.includes(value)) throw new ValidationError('Pick an agent from the list of Hermes profiles.')
  return value
}

export function stage(value: unknown): Stage {
  const found = STAGES.find((item) => item === value)
  if (!found) throw new ValidationError('Pick a stage from the list.')
  return found
}

function budget(kind: unknown, min: unknown, max: unknown): Budget {
  if (kind === undefined || kind === '' || kind === 'unknown') return { kind: 'unknown' }
  const number = (value: unknown, label: string, optional = false) => {
    if (optional && (value === undefined || value === '' || value === null)) return undefined
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value) : Number.NaN
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) throw new ValidationError(`${label} must be a number from 0 to 1,000,000.`)
    return parsed
  }
  if (kind === 'fixed') return { kind: 'fixed', amount: number(min, 'Budget')!, currency: 'USD' }
  if (kind === 'hourly') {
    const low = number(min, 'Hourly rate')!
    const high = number(max, 'Hourly maximum', true)
    if (high !== undefined && high < low) throw new ValidationError('The hourly maximum is lower than the minimum.')
    const result = parseBudget(`hourly ${low}${high !== undefined && high !== low ? `-${high}` : ''} USD`)
    if (!result) throw new ValidationError('Budget is not valid.')
    return result
  }
  throw new ValidationError('Budget type must be fixed, hourly or unknown.')
}

export const LEAD_KEYS = ['title', 'client', 'budgetType', 'budgetMin', 'budgetMax', 'upworkUrl', 'posted', 'fit', 'tags', 'notes'] as const

/** A new lead from the Add lead form. `today` is YYYY-MM-DD (local), the latest allowed posted date. */
export function leadInput(value: unknown, today: string): { title: string; fields: LeadFields } {
  const input = params(value, LEAD_KEYS)
  const title = cleanText(input.title, 'Title', { max: LIMITS.title, min: 3 })!
  if (/^\[lead\b/i.test(title)) throw new ValidationError('A lead title cannot start with "[lead" (that marks agent work cards).')
  const client = cleanText(input.client, 'Client', { max: LIMITS.client, optional: true })
  const upworkUrl = cleanText(input.upworkUrl, 'Upwork URL', { max: LIMITS.url, optional: true })
  if (upworkUrl && !UPWORK_URL.test(upworkUrl)) throw new ValidationError('The Upwork URL must start with https://www.upwork.com/jobs/ (or /freelance-jobs/).')
  const posted = cleanText(input.posted, 'Posted date', { max: 10, optional: true })
  if (posted && (!isValidDate(posted) || posted > today)) throw new ValidationError('The posted date must be a real date, not in the future.')
  let fit: number | undefined
  if (input.fit !== undefined && input.fit !== '' && input.fit !== null) {
    fit = typeof input.fit === 'string' ? Number(input.fit) : typeof input.fit === 'number' ? input.fit : Number.NaN
    if (!Number.isInteger(fit) || fit < 1 || fit > 5) throw new ValidationError('Fit is a whole number from 1 to 5.')
  }
  const rawTags = input.tags === undefined || input.tags === '' ? [] : Array.isArray(input.tags) ? input.tags : typeof input.tags === 'string' ? input.tags.split(',') : undefined
  if (!rawTags || rawTags.some((tag) => typeof tag !== 'string')) throw new ValidationError('Tags must be text.')
  const tags = [...new Set((rawTags as string[]).map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
  const badTag = tags.find((tag) => !TAG.test(tag))
  if (badTag) throw new ValidationError(`Tag "${badTag.slice(0, 30)}" may only use a-z, 0-9 and - (max 24 characters).`)
  if (tags.length > MAX_TAGS) throw new ValidationError(`At most ${MAX_TAGS} tags.`)
  const notes = cleanText(input.notes, 'Notes', { max: LIMITS.notes, multiline: true, optional: true }) ?? ''
  return { title, fields: { ...(client ? { client } : {}), budget: budget(input.budgetType, input.budgetMin, input.budgetMax), ...(upworkUrl ? { upworkUrl } : {}), ...(posted ? { posted } : {}), ...(fit !== undefined ? { fit } : {}), tags, notes } }
}
