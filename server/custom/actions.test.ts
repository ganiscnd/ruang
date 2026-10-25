import { mkdtemp, readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearCommandLog, CommandError, getCommandLog, systemRun } from '../mission-control.js'
import { ActionError, MAX_PER_MINUTE, plan, shown, TOKEN_TTL_MS, WriteActions, type ActionContext } from './actions.js'
import type { LeadDetail, PipelineData } from './pipeline.js'
import { installCustom } from './routes.js'
import { leadInput, ValidationError } from './validate.js'

const lead = (id: string, extra: Partial<LeadDetail> = {}): LeadDetail => ({ id, title: `Lead ${id}`, status: 'ready', fields: { client: 'Northline', upworkUrl: `https://www.upwork.com/jobs/~01${id.replace(/\W/g, '')}`, tags: [], notes: '' }, hasBlock: true, stage: 'Found', historyAvailable: true, workCards: [], stageHistory: [], comments: [], ...extra })
const pipeline = (leads: LeadDetail[] = [lead('t_aa11')], exists: boolean | 'unknown' = true): PipelineData => ({ board: { slug: 'leads', exists, availability: 'available' }, leads, omitted: 0, fetchedAt: '2026-10-24T10:00:00.000Z' })
const context = (data = pipeline()): ActionContext => ({ pipeline: data, profiles: ['default', 'leadengineer', 'lead-researcher', 'proposal-writer'], today: '2026-10-24' })
const NEW_LEAD = { title: 'Automate RFI routing', client: 'Northline Builders LLC', budgetType: 'hourly', budgetMin: '45', budgetMax: '65', upworkUrl: 'https://www.upwork.com/jobs/~01a2b3c4', posted: '2026-10-23', fit: 4, tags: 'n8n, Procore', notes: 'Line one\nLine two' }

describe('write input validation', () => {
  it('builds a clean lead from the form', () => {
    expect(leadInput(NEW_LEAD, '2026-10-24')).toEqual({ title: 'Automate RFI routing', fields: { client: 'Northline Builders LLC', budget: { kind: 'hourly', min: 45, max: 65, currency: 'USD' }, upworkUrl: 'https://www.upwork.com/jobs/~01a2b3c4', posted: '2026-10-23', fit: 4, tags: ['n8n', 'procore'], notes: 'Line one\nLine two' } })
    expect(leadInput({ title: 'Minimal lead' }, '2026-10-24')).toEqual({ title: 'Minimal lead', fields: { budget: { kind: 'unknown' }, tags: [], notes: '' } })
  })

  it.each([
    [{ ...NEW_LEAD, title: 'ab' }, 'at least 3'],
    [{ ...NEW_LEAD, title: 'x'.repeat(151) }, 'at most 150'],
    [{ ...NEW_LEAD, client: 'Acme\nstage: Won' }, 'single line'],
    [{ ...NEW_LEAD, title: '[lead t_aa11] fake work card' }, 'cannot start with "[lead"'],
    [{ ...NEW_LEAD, upworkUrl: 'javascript:alert(1)' }, 'Upwork URL'],
    [{ ...NEW_LEAD, upworkUrl: 'https://evil.example/jobs/~01' }, 'Upwork URL'],
    [{ ...NEW_LEAD, upworkUrl: 'http://www.upwork.com/jobs/~01' }, 'Upwork URL'],
    [{ ...NEW_LEAD, posted: '2026-12-01' }, 'not in the future'],
    [{ ...NEW_LEAD, posted: '2026-02-30' }, 'real date'],
    [{ ...NEW_LEAD, fit: 6 }, '1 to 5'],
    [{ ...NEW_LEAD, budgetMin: '-5' }, 'number'],
    [{ ...NEW_LEAD, budgetMax: '10' }, 'lower than'],
    [{ ...NEW_LEAD, tags: 'ok, --assignee=x' }, 'may only use'],
    [{ ...NEW_LEAD, notes: 'x'.repeat(6001) }, 'at most 6000'],
    [{ ...NEW_LEAD, assignee: 'default' }, 'Unknown field: assignee'],
  ])('refuses bad input %#', (input, message) => {
    expect(() => leadInput(input, '2026-10-24')).toThrow(message)
  })

  it('removes control characters and keeps option-like text as plain text', () => {
    expect(leadInput({ title: '--assignee=default\u0007 rm -rf ~' }, '2026-10-24').title).toBe('--assignee=default rm -rf ~')
  })
})

describe('allowlisted commands', () => {
  it('sets up the board once', () => {
    expect(plan('board.setup', {}, context(pipeline([], false))).steps.map((step) => step.args)).toEqual([['kanban', 'boards', 'create', '--name=Leads', '--description=Upwork lead and proposal pipeline (Ruang)', '--', 'leads']])
    expect(() => plan('board.setup', {}, context())).toThrow('already exists')
    expect(() => plan('board.setup', {}, context(pipeline([], 'unknown')))).toThrow(ActionError)
  })

  it('creates an unassigned lead with every free text after --, then sets stage Found', () => {
    const built = plan('lead.create', { ...NEW_LEAD, title: '--assignee=default' }, context())
    const [create, comment] = built.steps.map((step) => step.args)
    expect(create.slice(0, 3)).toEqual(['kanban', '--board=leads', 'create'])
    expect(create.slice(-3)).toEqual(['--json', '--', '--assignee=default'])
    expect(create[3]).toMatch(/^--body=\[lead\]\nclient: Northline Builders LLC\nbudget: hourly 45-65 USD\n/)
    expect(create.slice(0, create.indexOf('--')).filter((arg) => /^--(assignee|triage|parent|initial-status|skill|model|workspace)\b/.test(arg))).toEqual([])
    expect(create).toContain('--created-by=owner')
    expect(comment).toEqual(['kanban', '--board=leads', 'comment', '--author=owner', '--', '\u0000created', 'stage: Found'])
    expect(built.steps[0].display).not.toContain('Northline')
    expect(shown(built.steps)[1]).toBe("hermes kanban --board=leads comment --author=owner -- <new card id> 'stage: Found'")
  })

  it('refuses a duplicate lead and actions on a missing board', () => {
    expect(() => plan('lead.create', { title: 'Lead t_aa11' }, context())).toThrow('already exists (t_aa11)')
    expect(() => plan('lead.create', NEW_LEAD, context(pipeline([], false)))).toThrow('not set up')
  })

  it('changes the stage with a comment, and closes Won/Lost with complete', () => {
    expect(plan('lead.stage', { id: 't_aa11', stage: 'Sent' }, context()).steps.map((step) => step.args)).toEqual([['kanban', '--board=leads', 'comment', '--author=owner', '--', 't_aa11', 'stage: Sent']])
    expect(plan('lead.stage', { id: 't_aa11', stage: 'Lost', reason: 'Hired someone else' }, context()).steps.map((step) => step.args)).toEqual([
      ['kanban', '--board=leads', 'comment', '--author=owner', '--', 't_aa11', 'stage: Lost\nHired someone else'],
      ['kanban', '--board=leads', 'complete', '--result=Lost', '--', 't_aa11'],
    ])
    expect(() => plan('lead.stage', { id: 't_aa11', stage: 'Maybe' }, context())).toThrow(ValidationError)
    expect(() => plan('lead.stage', { id: 't_zz99', stage: 'Sent' }, context())).toThrow('not on the leads board')
    expect(() => plan('lead.stage', { id: '--evil', stage: 'Sent' }, context())).toThrow('not valid')
  })

  it('will not close a lead while a work card is open, or touch a closed lead', () => {
    const busy = pipeline([lead('t_aa11', { status: 'todo', workCards: [{ id: 't_w1', title: '[lead t_aa11] Research: x', status: 'running', assignee: 'leadengineer' }] })])
    expect(() => plan('lead.stage', { id: 't_aa11', stage: 'Won' }, context(busy))).toThrow('t_w1: running')
    expect(plan('lead.stage', { id: 't_aa11', stage: 'Interview' }, context(busy)).steps).toHaveLength(1)
    const closed = pipeline([lead('t_aa11', { status: 'done', stage: 'Won' })])
    expect(() => plan('lead.stage', { id: 't_aa11', stage: 'Sent' }, context(closed))).toThrow('closed')
    expect(plan('lead.note', { id: 't_aa11', text: 'Follow up in March' }, context(closed)).steps).toHaveLength(1)
  })

  it('adds notes that can never change the stage', () => {
    expect(plan('lead.note', { id: 't_aa11', text: '-- see thread' }, context()).steps[0].args).toEqual(['kanban', '--board=leads', 'comment', '--author=owner', '--', 't_aa11', '-- see thread'])
    expect(() => plan('lead.note', { id: 't_aa11', text: 'Stage: Won' }, context())).toThrow('cannot start with "stage:"')
  })

  it('assigns a work card to a known profile and links it as the lead\'s parent', () => {
    const built = plan('lead.assign', { id: 't_aa11', profile: 'leadengineer', kind: 'research' }, context())
    const [create, link] = built.steps.map((step) => step.args)
    expect(create.slice(0, 7)).toEqual(['kanban', '--board=leads', 'create', '--assignee=leadengineer', '--skill=leads-protocol', '--max-runtime=15m', '--max-retries=1'])
    expect(create.slice(-2)).toEqual(['--', '[lead t_aa11] Research: Lead t_aa11'])
    expect(built.summary.join(' ')).toContain('leadengineer is not the dedicated lead-researcher profile')
    expect(built.steps[0].display).toMatch(/^hermes kanban --board=leads create --assignee=leadengineer --skill=leads-protocol --max-runtime=15m --max-retries=1 <--body: \d+ chars>/)
    expect(create.find((arg) => arg.startsWith('--body='))).toMatch(/^--body=lead: t_aa11\njob: research\n/)
    expect(link).toEqual(['kanban', '--board=leads', 'link', '--', '\u0000created', 't_aa11'])
    expect(() => plan('lead.assign', { id: 't_aa11', profile: 'nobody', kind: 'research' }, context())).toThrow('Hermes profiles')
    expect(() => plan('lead.assign', { id: 't_aa11', profile: '-p', kind: 'research' }, context())).toThrow('Hermes profiles')
    expect(() => plan('lead.assign', { id: 't_aa11', profile: 'default', kind: 'deploy' }, context())).toThrow('research or proposal')
    const busy = pipeline([lead('t_aa11', { workCards: [{ id: 't_w1', title: '[lead t_aa11] Research: x', status: 'ready', assignee: 'default' }] })])
    expect(() => plan('lead.assign', { id: 't_aa11', profile: 'default', kind: 'research' }, context(busy))).toThrow('already has an open research card')
    expect(plan('lead.assign', { id: 't_aa11', profile: 'default', kind: 'proposal' }, context(busy)).steps).toHaveLength(2)
  })

  it('loads the protocol and facts skills for a proposal on the dedicated profile, with the cost caps', () => {
    const built = plan('lead.assign', { id: 't_aa11', profile: 'proposal-writer', kind: 'proposal' }, context())
    const create = built.steps[0].args
    expect(create.slice(0, create.findIndex((arg) => arg.startsWith('--body=')))).toEqual(['kanban', '--board=leads', 'create', '--assignee=proposal-writer', '--skill=leads-protocol', '--skill=freelancer-facts', '--max-runtime=15m', '--max-retries=1'])
    expect(create.slice(-2)).toEqual(['--', '[lead t_aa11] Draft proposal: Lead t_aa11'])
    expect(built.summary.join(' ')).not.toContain('not the dedicated')
    expect(built.summary.join(' ')).toContain('one attempt only')
  })

  it('refuses unknown actions and extra fields', () => {
    expect(() => plan('lead.archive', {}, context())).toThrow('Unknown action')
    expect(() => plan('lead.note', { id: 't_aa11', text: 'hi', author: 'x' }, context())).toThrow('Unknown field: author')
  })
})

describe('preview and execute', () => {
  let dir: string
  let calls: string[][]
  let now: number
  let results: (string | Error)[]
  const run = async (_file: string, args: string[]) => { calls.push(args); const next = results.shift() ?? ''; if (next instanceof Error) throw next; return next }
  const make = () => new WriteActions({ run, auditPath: join(dir, 'write-audit.jsonl'), now: () => now })
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ruang-actions-')); calls = []; now = Date.parse('2026-10-24T10:00:00Z'); results = [] })

  it('runs exactly the previewed commands once, filling in the new card id, and audits without free text', async () => {
    const actions = make()
    const preview = actions.preview('lead.create', NEW_LEAD, context(), 'session-a')
    expect(preview.summary[0]).toContain('unassigned')
    expect(preview.commands).toHaveLength(2)
    results = [JSON.stringify({ id: 't_new1', title: 'Automate RFI routing', status: 'ready' }), 'Comment added']
    expect(await actions.execute(preview.token, 'session-a', async () => context())).toEqual({ ok: true, action: 'lead.create', createdId: 't_new1', completedSteps: 2, totalSteps: 2 })
    expect(calls[1]).toEqual(['kanban', '--board=leads', 'comment', '--author=owner', '--', 't_new1', 'stage: Found'])
    await expect(actions.execute(preview.token, 'session-a', async () => context())).rejects.toThrow('already used')
    const audit = await readFile(join(dir, 'write-audit.jsonl'), 'utf8')
    expect(JSON.parse(audit.trim())).toMatchObject({ action: 'lead.create', createdId: 't_new1', ok: true, steps: '2/2' })
    expect(audit).not.toContain('Northline')
  })

  it('refuses tokens from another session, expired tokens and changed data', async () => {
    const actions = make()
    await expect(actions.execute(actions.preview('lead.note', { id: 't_aa11', text: 'hi' }, context(), 'session-a').token, 'session-b', async () => context())).rejects.toThrow('another session')
    const old = actions.preview('lead.note', { id: 't_aa11', text: 'hi' }, context(), 'session-a').token
    now += TOKEN_TTL_MS + 1
    await expect(actions.execute(old, 'session-a', async () => context())).rejects.toThrow('expired')
    const stale = actions.preview('lead.stage', { id: 't_aa11', stage: 'Won' }, context(), 'session-a').token
    const changed = pipeline([lead('t_aa11', { status: 'todo', workCards: [{ id: 't_w1', title: '[lead t_aa11] Research: x', status: 'running' }] })])
    await expect(actions.execute(stale, 'session-a', async () => context(changed))).rejects.toThrow('still open')
    await expect(actions.execute('not-a-token', 'session-a', async () => context())).rejects.toThrow(ValidationError)
    expect(calls).toEqual([])
  })

  it('limits writes per minute', async () => {
    const actions = make()
    for (let index = 0; index < MAX_PER_MINUTE; index += 1) await actions.execute(actions.preview('lead.note', { id: 't_aa11', text: `note ${index}` }, context(), 's').token, 's', async () => context())
    await expect(actions.execute(actions.preview('lead.note', { id: 't_aa11', text: 'one more' }, context(), 's').token, 's', async () => context())).rejects.toThrow('per minute')
    now += 61_000
    expect((await actions.execute(actions.preview('lead.note', { id: 't_aa11', text: 'later' }, context(), 's').token, 's', async () => context())).ok).toBe(true)
  })

  it('reports a refused step and a timeout honestly', async () => {
    const actions = make()
    results = [JSON.stringify({ id: 't_new2' }), new CommandError('Command exited with code 1.', 'COMMAND_FAILED')]
    expect(await actions.execute(actions.preview('lead.create', NEW_LEAD, context(), 's').token, 's', async () => context())).toMatchObject({ ok: false, createdId: 't_new2', completedSteps: 1, error: 'Hermes refused step 2 of 2 (Command exited with code 1.).' })
    results = [new CommandError('Read timed out.', 'TIMEOUT')]
    expect(await actions.execute(actions.preview('lead.note', { id: 't_aa11', text: 'x' }, context(), 's').token, 's', async () => context())).toMatchObject({ ok: false, uncertain: true, completedSteps: 0 })
    results = ['Created t_x (no json)']
    expect(await actions.execute(actions.preview('lead.create', { title: 'Other lead' }, context(), 's').token, 's', async () => context())).toMatchObject({ ok: false, uncertain: true, completedSteps: 1 })
  })
})

describe('write audit in the command log', () => {
  it('marks write runs and logs the display text instead of the argv', async () => {
    clearCommandLog()
    await expect(systemRun('ruang-test-program-that-does-not-exist', ['secret note text'], { write: { display: 'hermes kanban --board=leads comment -- t_1 <note: 16 chars>', timeoutMs: 1000 } })).rejects.toThrow()
    expect(getCommandLog().entries[0]).toMatchObject({ command: 'hermes kanban --board=leads comment -- t_1 <note: 16 chars>', ok: false, write: true })
    clearCommandLog()
  })
})

describe('write routes', () => {
  async function serve(access: { enabled: boolean; unlocked: boolean; session?: string }, actions = new WriteActions({ run: async () => '', auditPath: join(tmpdir(), `ruang-route-audit-${Date.now()}.jsonl`) })) {
    const app = express()
    let writes = 0
    installCustom(app, { privacyOf: async () => ({ hidden: new Set(), locked: new Set(), all: false }), accessOf: async () => access, source: async () => pipeline(), actions, profiles: async () => ['default'], afterWrite: () => { writes += 1 } })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown, headers: Record<string, string> = { 'x-ruang-request': '1' }) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { post, base, close: () => server.close(), writes: () => writes }
  }

  it('refuses every write while the access code is off, and says why', async () => {
    const { post, base, close } = await serve({ enabled: false, unlocked: true })
    try {
      const response = await post('/api/custom/actions/preview', { action: 'lead.note', params: { id: 't_aa11', text: 'x' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'Write actions need the access code. Turn it on in Settings.' })
      expect(await (await fetch(`${base}/api/custom/pipeline`)).json()).toMatchObject({ writes: { enabled: false } })
    } finally { close() }
  })

  it('refuses cross-site requests and requests without the Ruang header', async () => {
    const { post, close } = await serve({ enabled: true, unlocked: true, session: 'cookie' })
    try {
      expect((await post('/api/custom/actions/preview', {}, {})).status).toBe(403)
      expect((await post('/api/custom/actions/preview', {}, { 'x-ruang-request': '1', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      expect((await post('/api/custom/actions/preview', {}, { 'x-ruang-request': '1', origin: 'https://evil.example' })).status).toBe(403)
    } finally { close() }
  })

  it('previews, executes and refreshes caches when the access code is on and unlocked', async () => {
    const calls: string[][] = []
    const { post, close, writes } = await serve({ enabled: true, unlocked: true, session: 'cookie' }, new WriteActions({ run: async (_file, args) => { calls.push(args); return '' }, auditPath: join(tmpdir(), `ruang-route-audit-${Date.now()}.jsonl`) }))
    try {
      const bad = await post('/api/custom/actions/preview', { action: 'lead.note', params: { id: 't_aa11', text: '' } })
      expect(bad.status).toBe(400)
      const preview = await (await post('/api/custom/actions/preview', { action: 'lead.note', params: { id: 't_aa11', text: 'Call on Monday' } })).json() as { token: string; commands: string[] }
      expect(preview.commands).toEqual(["hermes kanban --board=leads comment --author=owner -- t_aa11 'Call on Monday'"])
      expect(await (await post('/api/custom/actions/execute', { token: preview.token })).json()).toMatchObject({ ok: true, action: 'lead.note' })
      expect(calls).toEqual([['kanban', '--board=leads', 'comment', '--author=owner', '--', 't_aa11', 'Call on Monday']])
      expect(writes()).toBe(1)
      expect((await post('/api/custom/actions/execute', { token: preview.token })).status).toBe(409)
    } finally { close() }
  })

  it('takes a 6000-character note with accents, and answers clearly when a body is too large or unreadable', async () => {
    const { post, base, close } = await serve({ enabled: true, unlocked: true, session: 'cookie' })
    try {
      const long = await post('/api/custom/actions/preview', { action: 'lead.note', params: { id: 't_aa11', text: 'é'.repeat(6000) } })
      expect(long.status).toBe(200)
      const huge = await post('/api/custom/actions/preview', { action: 'lead.note', params: { id: 't_aa11', text: 'x'.repeat(70_000) } })
      expect(huge.status).toBe(413)
      expect(await huge.json()).toEqual({ error: 'This request is too large. Shorten the text and try again.' })
      const broken = await fetch(`${base}/api/custom/actions/preview`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: '{"action":' })
      expect(broken.status).toBe(400)
    } finally { close() }
  })
})
