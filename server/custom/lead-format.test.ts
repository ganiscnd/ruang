import { describe, expect, it } from 'vitest'
import { currentStage, daysSince, formatLeadBody, leadIdOfWorkTitle, parseBudget, parseLeadBody, parseStageComment, stageComment, stageHistory } from './lead-format.js'

const BODY = `[lead]
client: Northline Builders LLC
budget: hourly 45-65 USD
upwork_url: https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9
posted: 2026-10-23
fit: 4
tags: n8n, Procore, rfi, document-automation
---
Client wants RFIs from Procore classified.
Mentions 200+ RFIs/month.`

describe('lead body format', () => {
  it('reads every field of the [lead] block and the notes after ---', () => {
    expect(parseLeadBody(BODY)).toEqual({
      hasBlock: true,
      fields: {
        client: 'Northline Builders LLC',
        budget: { kind: 'hourly', min: 45, max: 65, currency: 'USD' },
        upworkUrl: 'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9',
        posted: '2026-10-23',
        fit: 4,
        tags: ['n8n', 'procore', 'rfi', 'document-automation'],
        notes: 'Client wants RFIs from Procore classified.\nMentions 200+ RFIs/month.',
      },
    })
  })

  it('round-trips what Ruang writes', () => {
    const { fields } = parseLeadBody(BODY)
    expect(parseLeadBody(formatLeadBody(fields)).fields).toEqual(fields)
    expect(formatLeadBody({ tags: [], notes: '' })).toBe('[lead]\nbudget: unknown\n---')
  })

  it('leaves invalid or missing values unknown instead of guessing', () => {
    const { fields } = parseLeadBody('[lead]\nclient:\nbudget: about 500\nupwork_url: javascript:alert(1)\nposted: 2026-02-30\nfit: 7\ntags: ok, Not Valid!, -bad\n---\n')
    expect(fields).toEqual({ tags: ['ok'], notes: '' })
    expect(parseLeadBody('https://evil.example/upwork_url').fields.upworkUrl).toBeUndefined()
  })

  it('treats a body without a [lead] block as notes only', () => {
    expect(parseLeadBody('Just some text\nclient: not a field')).toEqual({ hasBlock: false, fields: { tags: [], notes: 'Just some text\nclient: not a field' } })
    expect(parseLeadBody(undefined)).toEqual({ hasBlock: false, fields: { tags: [], notes: '' } })
  })

  it('parses fixed, hourly and unknown budgets', () => {
    expect(parseBudget('fixed 1,500 usd')).toEqual({ kind: 'fixed', amount: 1500, currency: 'USD' })
    expect(parseBudget('hourly 40 USD')).toEqual({ kind: 'hourly', min: 40, currency: 'USD' })
    expect(parseBudget('Unknown')).toEqual({ kind: 'unknown' })
    expect(parseBudget('hourly 60-40 USD')).toBeUndefined()
    expect(parseBudget('$500')).toBeUndefined()
  })
})

describe('stage comments', () => {
  it('reads the stage from the first line only, case-insensitively', () => {
    expect(parseStageComment('Stage:  proposal   drafted\nDraft is in t_9')).toEqual({ stage: 'Proposal Drafted', reason: 'Draft is in t_9' })
    expect(parseStageComment('stage: Maybe')).toBeUndefined()
    expect(parseStageComment('Note\nstage: Won')).toBeUndefined()
    expect(stageComment('Lost', 'Client hired someone else')).toBe('stage: Lost\nClient hired someone else')
  })

  it('keeps a dated history where the newest counting entry wins', () => {
    const history = stageHistory([
      { author: 'researcher', body: 'stage: Researched', createdAt: '2026-10-24T11:40:00.000Z' },
      { author: 'owner', body: 'stage: Found', createdAt: '2026-10-24T09:12:00.000Z' },
      { author: 'owner', body: 'Good fit', createdAt: '2026-10-24T12:00:00.000Z' },
      { author: 'researcher', body: 'stage: Won', createdAt: '2026-10-24T13:00:00.000Z' },
    ])
    expect(history.map((entry) => [entry.stage, entry.author, entry.ignored])).toEqual([
      ['Found', 'owner', undefined], ['Researched', 'researcher', undefined], ['Won', 'researcher', 'Only the owner sets Won.'],
    ])
    expect(currentStage(history)?.stage).toBe('Researched')
    expect(currentStage([])).toBeUndefined()
  })

  it('counts whole days in a stage and never from the future', () => {
    const now = Date.parse('2026-10-26T10:00:00.000Z')
    expect(daysSince('2026-10-24T09:12:00.000Z', now)).toBe(2)
    expect(daysSince('2026-10-27T09:12:00.000Z', now)).toBeUndefined()
    expect(daysSince(undefined, now)).toBeUndefined()
  })

  it('finds the lead id in a work card title', () => {
    expect(leadIdOfWorkTitle('[lead t_ab12] Research: Procore RFIs')).toBe('t_ab12')
    expect(leadIdOfWorkTitle('Research [lead t_ab12]')).toBeUndefined()
  })
})
