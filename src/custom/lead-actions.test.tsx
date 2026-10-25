import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CharCount } from './ActionDialogs.tsx'
import { tooLong } from './write-actions.ts'
import { LeadActions } from './LeadActions.tsx'
import type { LeadDetail, LeadDetailSnapshot } from './types.ts'

const lead: LeadDetail = { id: 't_a', title: 'Procore RFI routing', status: 'ready', fields: { tags: [], notes: '' }, hasBlock: true, stage: 'Interview', historyAvailable: true, workCards: [], stageHistory: [], comments: [] }
const snapshot = (extra: Partial<LeadDetail> = {}, enabled = true): LeadDetailSnapshot => ({ lead: { ...lead, ...extra }, board: { slug: 'leads', exists: true, availability: 'available' }, writes: enabled ? { enabled: true } : { enabled: false, reason: 'Write actions need the access code. Turn it on in Settings.' }, agents: ['default', 'leadengineer'], fetchedAt: '2026-10-24T10:00:00.000Z' })
const render = (detail: LeadDetailSnapshot) => renderToStaticMarkup(<LeadActions detail={detail} start={async () => true} busy={false}/>)

describe('lead actions panel', () => {
  it('disables every action with the reason while writes are off', () => {
    const markup = render(snapshot({}, false))
    expect(markup).toContain('Write actions need the access code')
    expect(markup).toMatch(/<button type="submit" class="primary-button" disabled="">Change stage…<\/button>/)
  })

  it('proposes the next stage and warns that Won/Lost is final', () => {
    const markup = render(snapshot())
    expect(markup).toContain('(now Interview)')
    expect(markup).toMatch(/<option value="Won" selected="">Won<\/option>/)
    expect(markup).toContain('Won also marks the lead card done in Hermes. That is final.')
  })

  it('explains that an open work card blocks closing, and keeps notes for closed leads', () => {
    expect(render(snapshot({ workCards: [{ id: 't_w', title: '[lead t_a] Research: x', status: 'running', assignee: 'default' }] }))).toContain('(t_w: running)')
    const closed = render(snapshot({ status: 'done', stage: 'Lost' }))
    expect(closed).toContain('This lead is closed (done, Lost)')
    expect(closed).not.toContain('Change stage…')
    expect(closed).toContain('Add note…')
  })

  it('offers only the Hermes profiles for Assign to agent, and never for a closed lead', () => {
    const markup = render(snapshot({ stage: 'Researched' }))
    expect(markup).toContain('<option value="leadengineer">leadengineer</option>')
    expect(markup).toMatch(/<option value="proposal" selected="">Draft a proposal<\/option>/)
    expect(markup).toContain('The lead card itself is never assigned.')
    expect(render(snapshot({ status: 'done', stage: 'Won' }))).not.toContain('Assign to agent')
    expect(render({ ...snapshot(), agents: [] })).toContain('No Hermes profiles could be read')
  })

  it('preselects the dedicated profile for the job when it exists', () => {
    const agents = ['default', 'lead-researcher', 'proposal-writer']
    expect(render({ ...snapshot({ stage: 'Found' }), agents })).toContain('<option value="lead-researcher" selected="">lead-researcher</option>')
    const proposal = render({ ...snapshot({ stage: 'Researched' }), agents })
    expect(proposal).toContain('<option value="proposal-writer" selected="">proposal-writer</option>')
    expect(proposal).toContain('Use proposal-writer for this job')
  })

  it('blocks a proposal while research runs and warns when no agent research comment exists', () => {
    const running = render(snapshot({ stage: 'Researched', workCards: [{ id: 't_w1', title: '[lead t_a] Research: x', status: 'running', assignee: 'lead-researcher' }] }))
    expect(running).toContain('Research on this lead is not finished yet (t_w1: running).')
    expect(running).toMatch(/<button type="submit" class="primary-button" disabled="">Assign to agent…<\/button>/)
    expect(render(snapshot({ stage: 'Researched', stageHistory: [{ stage: 'Researched', author: 'owner' }] }))).toContain('This lead has no research comment from an agent yet.')
    expect(render(snapshot({ stage: 'Researched', historyAvailable: false }))).toContain('unknown whether a research comment exists')
    const ready = render(snapshot({ stage: 'Researched', stageHistory: [{ stage: 'Researched', author: 'lead-researcher' }] }))
    expect(ready).not.toContain('research comment')
    expect(ready).toMatch(/<button type="submit" class="primary-button">Assign to agent…<\/button>/)
    expect(render(snapshot({ stage: 'Found' }))).not.toContain('research comment')
  })

  it('counts note characters live and explains an over-long note instead of cutting it', () => {
    expect(render(snapshot())).toContain('0 / 20,000 characters')
    expect(render(snapshot())).not.toContain('maxlength')
    expect(renderToStaticMarkup(<CharCount id="c" value={'x'.repeat(20_000)}/>)).not.toContain('Too long')
    const over = renderToStaticMarkup(<CharCount id="c" value={'x'.repeat(20_150)}/>)
    expect(over).toContain('20,150 / 20,000 characters')
    expect(over).toContain('Too long by 150. Nothing is cut off: shorten it or split it into two notes.')
    expect([tooLong('x'.repeat(20_000)), tooLong('x'.repeat(20_001)), tooLong(` ${'x'.repeat(20_000)}\n`)]).toEqual([false, true, false])
  })

  it('warns when the selected job already finished on this lead', () => {
    const workCards = [{ id: 't_w1', title: '[lead t_a] Research: x', status: 'done', assignee: 'lead-researcher' }]
    expect(render(snapshot({ stage: 'Found', workCards }))).toContain('This lead already has 1 finished research run. A new run uses tokens again.')
    expect(render(snapshot({ stage: 'Researched', workCards }))).not.toContain('finished proposal')
  })
})
