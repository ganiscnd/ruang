// custom: HTTP routes of the Claude section (read-only so far), installed by server/custom/routes.ts.
// The browser only ever talks to these routes; Google is called from the server alone.
import type { Express, Request, Response } from 'express'
import { cachedSource } from '../../mission-control.js'
import type { ClaudeConfig } from './config.js'
import { withTimeout } from './probe.js'
import { SheetsClient, type SheetsApi } from './sheets.js'
import { collectClaude, type ClaudeData } from './teams.js'

/** Boards are read at most every 30 s (5 boards → about 10 Sheets reads a minute at most). */
export const CLAUDE_CACHE_MS = 30_000
const FRESH_WINDOW_MS = 25_000
const TEAM_SLUG = /^[a-z]{1,4}-\d{1,2}$/
/** Every part of a read is time-limited already; this is the last guard so a page never waits forever. */
export const CLAUDE_ROUTE_TIMEOUT_MS = 30_000

class RouteTimeout extends Error {}

/** One client per key file, so the access token is reused across reads. */
function clientFor(): (config: ClaudeConfig) => SheetsApi {
  let client: { keyFile: string; api: SheetsClient } | undefined
  return (config) => {
    if (client?.keyFile !== config.keyFile) client = { keyFile: config.keyFile, api: new SheetsClient({ keyFile: config.keyFile }) }
    return client.api
  }
}

export const claudeSource = cachedSource(() => collectClaude({ sheets: clientFor() }), CLAUDE_CACHE_MS)

export function installClaude(app: Express, options: { source?: (now: number) => Promise<ClaudeData>; timeoutMs?: number } = {}): void {
  const timeoutMs = options.timeoutMs ?? CLAUDE_ROUTE_TIMEOUT_MS
  const read = options.source ?? claudeSource
  const source = (time: number) => withTimeout(read(time), timeoutMs, () => new RouteTimeout(`Not Available: the Claude boards did not load within ${Math.round(timeoutMs / 1000)} seconds.`))
  const now = (fresh: unknown) => Date.now() + (fresh === '1' ? FRESH_WINDOW_MS : 0)
  /** A read that hits the last-resort deadline answers 503 with the reason instead of hanging. */
  const timed = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
    try {
      await handler(request, response)
    } catch (error) {
      if (error instanceof RouteTimeout) { response.status(503).json({ error: error.message }); return }
      throw error
    }
  }

  app.get('/api/custom/claude/teams', timed(async (request, response) => {
    const { boards: _boards, ...data } = await source(now(request.query.fresh))
    void _boards
    response.json(data)
  }))
  app.get('/api/custom/claude/teams/:team', timed(async (request, response) => {
    const slug = String(request.params.team)
    if (!TEAM_SLUG.test(slug)) { response.status(400).json({ error: 'Invalid team.' }); return }
    const data = await source(now(request.query.fresh))
    if (data.availability !== 'available') { response.status(503).json({ error: `Not Available: ${data.reason}` }); return }
    const team = data.teams.find((item) => item.slug === slug)
    if (!team) { response.status(404).json({ error: 'Unknown team.' }); return }
    response.json({ team, boards: team.boards.map((board) => data.boards[board.id]), ownerName: data.ownerName, timezone: data.timezone, fetchedAt: data.fetchedAt })
  }))
}
