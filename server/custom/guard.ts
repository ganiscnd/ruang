// custom: the checks every write request passes, shared by the Hermes actions (actions.ts) and
// the Claude section's Sheets writes (claude/actions.ts).
import type { Request } from 'express'
import type { AccessOfRequest } from '../access.js'

export interface WriteStatus { enabled: boolean; reason?: string }

export function writeStatus(access: AccessOfRequest): WriteStatus {
  if (!access.enabled) return { enabled: false, reason: 'Write actions need the access code. Turn it on in Settings.' }
  if (!access.unlocked || !access.session) return { enabled: false, reason: 'Ruang is locked. Enter the access code to use write actions.' }
  return { enabled: true }
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
