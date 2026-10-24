import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
})
