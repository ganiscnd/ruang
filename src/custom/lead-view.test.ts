import { describe, expect, it } from 'vitest'
import { budgetLabel, daysLabel, fitLabel, matchesSearch, stageColumn } from './lead-view.ts'
import type { Lead } from './types.ts'

const lead: Lead = { id: 't_1', title: 'Procore RFI routing', status: 'ready', fields: { client: 'Northline', tags: ['n8n', 'procore'], notes: '' }, hasBlock: true, stage: 'Researched', daysInStage: 3, historyAvailable: true, workCards: [] }

describe('lead display', () => {
  it('labels budgets and never invents a missing one', () => {
    expect(budgetLabel({ kind: 'fixed', amount: 1500, currency: 'USD' })).toBe('Fixed 1,500 USD')
    expect(budgetLabel({ kind: 'hourly', min: 45, max: 65, currency: 'USD' })).toBe('Hourly 45-65 USD/h')
    expect(budgetLabel({ kind: 'unknown' })).toBe('Unknown')
    expect(budgetLabel(undefined)).toBe('Not Available')
  })

  it('shows fit, stage and days in stage, with Unknown when there is no stage', () => {
    expect(fitLabel(4)).toBe('●●●●○ 4/5')
    expect(fitLabel(undefined)).toBe('Not Available')
    expect(stageColumn(lead)).toBe('Researched')
    expect(daysLabel(lead)).toBe('3 days')
    expect(daysLabel({ stage: 'Found', daysInStage: 0 })).toBe('Today')
    expect(daysLabel({ stage: 'Found' })).toBe('Not Available')
    expect(stageColumn({})).toBe('Unknown')
    expect(daysLabel({})).toBe('Unknown')
  })

  it('searches title, client, tags and stage', () => {
    expect(matchesSearch(lead, 'PROCORE')).toBe(true)
    expect(matchesSearch(lead, 'northline')).toBe(true)
    expect(matchesSearch(lead, 'researched')).toBe(true)
    expect(matchesSearch(lead, 'revit')).toBe(false)
    expect(matchesSearch(lead, '  ')).toBe(true)
  })
})
