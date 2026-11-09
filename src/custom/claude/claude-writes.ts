// custom: the browser side of the Claude section's Sheets writes (server/custom/claude/actions.ts).
import { LOCKED_EVENT } from '../../access.ts'

export type ClaudeAction = 'claude.note' | 'claude.status'
export type PreviewCell = { cell: string; header: string } & ({ append: string; keeps: number } | { from: string; to: string })
export interface ClaudePreview { token: string; action: ClaudeAction; board: string; boardTitle: string; testCopy: boolean; tab: string; row: number; key: string; summary: string[]; cells: PreviewCell[]; expiresAt: string }
export interface ClaudeResult { ok: boolean; action: ClaudeAction; board: string; row: number; cells: string[]; verified?: boolean; error?: string; uncertain?: boolean }
export interface WriteParams { board: string; row: number; key: string; seen: { status: string; notes: string }; answers: { n: number; text: string }[]; comment: string; status?: string }
type Answer<T> = { ok: true; data: T } | { ok: false; error: string }

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

export const previewClaude = (action: ClaudeAction, params: WriteParams) => post<ClaudePreview>('/api/custom/claude/actions/preview', { action, params })
export const executeClaude = (token: string) => post<ClaudeResult>('/api/custom/claude/actions/execute', { token })

export function resultMessage(result: ClaudeResult): string {
  if (!result.ok) return result.error ?? 'Google refused the write.'
  const cells = result.cells.join(', ')
  return result.verified === false ? `Written (${cells}), but reading the cells back showed something else. Reload and check the sheet.`
    : result.verified ? `Saved to the sheet (${cells}) and checked by reading the cells back.` : `Saved to the sheet (${cells}). The read-back check could not run; reload to see it.`
}
