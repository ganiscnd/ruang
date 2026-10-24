// custom: the browser side of the guarded write path (server/custom/actions.ts).
import { LOCKED_EVENT } from '../access.ts'

export type ActionName = 'board.setup' | 'lead.create' | 'lead.stage' | 'lead.note' | 'lead.assign'
export interface Preview { token: string; action: ActionName; summary: string[]; commands: string[]; expiresAt: string }
export interface ExecuteResult { ok: boolean; action: ActionName; leadId?: string; createdId?: string; completedSteps: number; totalSteps: number; error?: string; uncertain?: boolean }
export type Answer<T> = { ok: true; data: T } | { ok: false; error: string }

async function post<T>(path: string, body: unknown): Promise<Answer<T>> {
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, error: 'The Ruang API could not be reached. Nothing was changed.' }
  }
  const data = await response.json().catch(() => undefined) as (T & { error?: unknown; locked?: unknown }) | undefined
  if (response.status === 401 && data?.locked === true) window.dispatchEvent(new Event(LOCKED_EVENT))
  if (!response.ok || !data) return { ok: false, error: typeof data?.error === 'string' ? data.error : `The Ruang API answered HTTP ${response.status}.` }
  return { ok: true, data }
}

export const previewAction = (action: ActionName, params: Record<string, unknown>) => post<Preview>('/api/custom/actions/preview', { action, params })
export const executeAction = (token: string) => post<ExecuteResult>('/api/custom/actions/execute', { token })
