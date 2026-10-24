import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it } from 'vitest'
import { CommandError } from '../mission-control.js'
import { collectPipeline } from './pipeline.js'
import { installCustom, redactLead } from './routes.js'

const NOW = Date.parse('2026-10-26T10:00:00.000Z')
const at = (iso: string) => Date.parse(iso) / 1000
const BOARDS = JSON.stringify([{ slug: 'default', name: 'Default', archived: false, is_current: true, total: 0 }, { slug: 'leads', name: 'Leads', archived: false, is_current: false, total: 3 }])
const LEAD_BODY = '[lead]\nclient: Northline Builders LLC\nbudget: fixed 1500 USD\nupwork_url: https://www.upwork.com/jobs/~01abc\nposted: 2026-10-23\nfit: 4\ntags: n8n, procore\n---\nRFI routing.'
const LIST = JSON.stringify([
  { id: 't_lead1', title: 'Automate RFI routing', body: LEAD_BODY, status: 'todo', assignee: null, created_at: at('2026-10-24T09:00:00Z'), created_by: 'owner' },
  { id: 't_lead2', title: 'Agent-made lead without a block', body: 'Found on Upwork', status: 'ready', assignee: null, created_at: at('2026-10-25T09:00:00Z'), created_by: 'researcher' },
  { id: 't_work1', title: '[lead t_lead1] Research: Automate RFI routing', body: 'lead: t_lead1', status: 'running', assignee: 'leadengineer', created_at: at('2026-10-25T10:00:00Z'), created_by: 'owner' },
])
const show = (id: string, comments: { author: string; body: string; created_at: number }[], parents: string[] = []) => JSON.stringify({ task: { id, title: 'x', status: 'todo' }, parents, children: [], comments, events: [], runs: [] })

function fakeRun(overrides: Record<string, string | Error> = {}) {
  const calls: string[] = []
  const run = async (file: string, args: string[]) => {
    const command = [file, ...args].join(' ')
    calls.push(command)
    const result = overrides[command] ?? ({
      'hermes kanban boards list --json': BOARDS,
      'hermes kanban --board leads list --json': LIST,
      'hermes kanban --board leads show t_lead1 --json': show('t_lead1', [
        { author: 'owner', body: 'stage: Found', created_at: at('2026-10-24T09:12:00Z') },
        { author: 'leadengineer', body: 'stage: Researched\nClient has 3 past hires.', created_at: at('2026-10-25T11:40:00Z') },
        { author: 'owner', body: 'Good fit, prioritise.', created_at: at('2026-10-25T12:00:00Z') },
      ], ['t_work1']),
      'hermes kanban --board leads show t_lead2 --json': show('t_lead2', []),
    } as Record<string, string>)[command]
    if (result instanceof Error) throw result
    if (result === undefined) throw new CommandError('Command exited with code 1.', 'COMMAND_FAILED')
    return result
  }
  return { run, calls }
}

describe('pipeline collector', () => {
  it('reads every lead with its fields, current stage, days in stage and linked work card', async () => {
    const { run, calls } = fakeRun()
    const data = await collectPipeline(run, NOW)
    expect(data.board).toEqual({ slug: 'leads', exists: true, availability: 'available' })
    expect(data.leads.map((lead) => lead.id)).toEqual(['t_lead2', 't_lead1'])
    expect(data.leads[1]).toMatchObject({
      id: 't_lead1', title: 'Automate RFI routing', status: 'todo', hasBlock: true, historyAvailable: true,
      fields: { client: 'Northline Builders LLC', budget: { kind: 'fixed', amount: 1500, currency: 'USD' }, fit: 4, tags: ['n8n', 'procore'], posted: '2026-10-23', notes: 'RFI routing.' },
      stage: 'Researched', stageSince: '2026-10-25T11:40:00.000Z', daysInStage: 0, assignedAgent: 'leadengineer',
      workCards: [{ id: 't_work1', title: '[lead t_lead1] Research: Automate RFI routing', status: 'running', assignee: 'leadengineer' }],
    })
    expect(data.leads[1].stageHistory.map((entry) => entry.stage)).toEqual(['Found', 'Researched'])
    // Work cards are not leads, and only read commands run.
    expect(calls.every((call) => /^hermes kanban (boards list --json|--board leads (list --json|show t_\w+ --json))$/.test(call))).toBe(true)
  })

  it('keeps a lead without a [lead] block or stage comment unknown, not guessed', async () => {
    const lead = (await collectPipeline(fakeRun().run, NOW)).leads[0]
    expect(lead).toMatchObject({ id: 't_lead2', hasBlock: false, fields: { tags: [], notes: 'Found on Upwork' }, historyAvailable: true, workCards: [] })
    expect(lead.stage).toBeUndefined()
    expect(lead.daysInStage).toBeUndefined()
    expect(lead.assignedAgent).toBeUndefined()
  })

  it('reports a missing board as not set up, without reading tasks', async () => {
    const { run, calls } = fakeRun({ 'hermes kanban boards list --json': JSON.stringify([{ slug: 'default', name: 'Default' }]) })
    expect(await collectPipeline(run, NOW)).toMatchObject({ board: { exists: false, availability: 'available' }, leads: [] })
    expect(calls).toEqual(['hermes kanban boards list --json'])
  })

  it('reports unreadable boards or lists as unavailable', async () => {
    expect((await collectPipeline(fakeRun({ 'hermes kanban boards list --json': new CommandError('Read timed out.', 'TIMEOUT') }).run, NOW)).board).toEqual({ slug: 'leads', exists: 'unknown', availability: 'unavailable', error: 'Read timed out.' })
    expect((await collectPipeline(fakeRun({ 'hermes kanban --board leads list --json': 'not json' }).run, NOW)).board).toMatchObject({ exists: true, availability: 'unavailable', error: 'Source returned output that could not be parsed.' })
  })

  it('marks a lead whose history cannot be read, keeping its stage unknown', async () => {
    const data = await collectPipeline(fakeRun({ 'hermes kanban --board leads show t_lead1 --json': new CommandError('Read timed out.', 'TIMEOUT') }).run, NOW)
    const lead = data.leads.find((item) => item.id === 't_lead1')!
    expect(lead).toMatchObject({ historyAvailable: false, fields: { client: 'Northline Builders LLC' } })
    expect(lead.stage).toBeUndefined()
    // The title prefix still finds the work card when the links cannot be read.
    expect(lead.workCards.map((card) => card.id)).toEqual(['t_work1'])
  })

  it('withholds work card titles and comments of locked agents', async () => {
    const lead = (await collectPipeline(fakeRun().run, NOW)).leads[1]
    const redacted = redactLead(lead, { hidden: new Set(['leadengineer']), locked: new Set(['leadengineer']), all: false })
    expect(redacted.workCards[0]).toMatchObject({ title: '🔒 Private task', private: true })
    expect(redacted.comments.map((comment) => comment.body)).toEqual(['stage: Found', '🔒 Private comment', 'Good fit, prioritise.'])
    expect(redacted.stageHistory[1]).toEqual({ stage: 'Researched', author: 'leadengineer', at: '2026-10-25T11:40:00.000Z' })
  })
})

describe('pipeline routes', () => {
  it('serves the list without comments, a detail, 400 for bad ids and 404 for unknown leads', async () => {
    const app = express()
    const { run } = fakeRun()
    installCustom(app, async () => ({ hidden: new Set(), locked: new Set(), all: false }), async () => ({ enabled: false, reason: 'Off.' }), () => collectPipeline(run, NOW))
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const list = await (await fetch(`${base}/api/custom/pipeline`)).json() as { writes: unknown; leads: { id: string }[] }
      expect(list).toHaveProperty('writes', { enabled: false, reason: 'Off.' })
      expect(list.leads.map((lead) => lead.id)).toEqual(['t_lead2', 't_lead1'])
      expect(((await (await fetch(`${base}/api/custom/pipeline/t_lead1`)).json()) as { lead: { stageHistory: unknown[] } }).lead.stageHistory).toHaveLength(2)
      for (const lead of list.leads) { expect(lead).not.toHaveProperty('comments'); expect(lead).not.toHaveProperty('stageHistory') }
      expect((await fetch(`${base}/api/custom/pipeline/--evil`)).status).toBe(400)
      expect((await fetch(`${base}/api/custom/pipeline/t_doesnotexist`)).status).toBe(404)
    } finally { server.close() }
  })
})
