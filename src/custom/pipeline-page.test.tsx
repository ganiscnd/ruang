import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Polled } from '../polling.ts'
import { PipelineView } from './pages/Pipeline.tsx'
import type { PipelineSnapshot } from './types.ts'

const ready = (data: Partial<PipelineSnapshot>): Polled<PipelineSnapshot> => ({ status: 'ready', refreshing: false, refresh: () => {}, data: { board: { slug: 'leads', exists: true, availability: 'available' }, leads: [], omitted: 0, writes: { enabled: false, reason: 'Write actions need the access code. Turn it on in Settings.' }, fetchedAt: '2026-10-24T10:00:00.000Z', ...data } })
const render = (snapshot: Polled<PipelineSnapshot>) => renderToStaticMarkup(<PipelineView snapshot={snapshot}/>)

describe('pipeline page states', () => {
  it('shows loading while pending, with no placeholder data', () => {
    const markup = render({ status: 'pending', refreshing: false, refresh: () => {} })
    expect(markup).toContain('Loading')
    expect(markup).not.toContain('No leads yet')
  })

  it('says the board is not set up, and why writes are off', () => {
    const markup = render(ready({ board: { slug: 'leads', exists: false, availability: 'available' } }))
    expect(markup).toContain('Leads board not set up')
    expect(markup).toContain('Write actions need the access code')
  })

  it('reports an unreadable board as Not Available instead of an empty pipeline', () => {
    const markup = render(ready({ board: { slug: 'leads', exists: 'unknown', availability: 'unavailable', error: 'Read timed out.' } }))
    expect(markup).toContain('Not Available')
    expect(markup).toContain('Read timed out.')
    expect(markup).not.toContain('No leads yet')
  })

  it('shows an empty board as No leads yet', () => {
    expect(render(ready({}))).toContain('No leads yet')
  })

  it('puts leads without a stage in Unknown and shows missing fields as Not Available', () => {
    const markup = render(ready({ leads: [
      { id: 't_a', title: 'Procore RFI routing', status: 'ready', fields: { client: 'Northline', budget: { kind: 'fixed', amount: 1500, currency: 'USD' }, fit: 4, tags: ['n8n'], notes: '', upworkUrl: 'https://www.upwork.com/jobs/~01abc' }, hasBlock: true, stage: 'Researched', daysInStage: 2, historyAvailable: true, assignedAgent: 'leadengineer', workCards: [] },
      { id: 't_b', title: 'Mystery card', status: 'ready', fields: { tags: [], notes: '' }, hasBlock: false, historyAvailable: true, workCards: [] },
    ] }))
    expect(markup).toContain('aria-label="Unknown column"')
    expect(markup).toContain('aria-label="Researched column"')
    expect(markup).toContain('Fixed 1,500 USD')
    expect(markup).toContain('agent: leadengineer')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('Client Not Available')
    expect(markup).toContain('2 of 2 shown')
  })
})
