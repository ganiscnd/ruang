import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resultMessage } from './claude-writes.ts'
import { ClaudeConfirm, NoteForm } from './NoteForm.tsx'
import type { RowDetail } from './types.ts'

// Invented row.
const detail = (write: RowDetail['write']): RowDetail => ({
  key: 'T04', seen: { status: 'review', notes: '0'.repeat(64) }, write, notesLength: 10,
  board: { id: 'example-lab-copy', title: 'Lab board (test copy)', kind: 'taskflow', testCopy: true, fetchedAt: '2026-11-09T02:00:00.000Z', hasFiles: false },
  card: { row: 5, key: 'T04', id: 'T04', title: 'Example task', status: 'review', statusKey: 'review' },
  fields: [], task: '', ownerNotes: [], outputs: [], ownerName: 'Owner',
  agentNotes: { format: 'sections', done: [], check: [], questions: [{ n: 1, text: 'One sheet?', recommend: 'one sheet' }, { n: 2, text: 'Ship today?' }], other: [] },
})

describe('owner answer form', () => {
  it('offers one answer box per question with quick buttons, a comment and the allowed statuses', () => {
    const markup = renderToStaticMarkup(<NoteForm detail={detail({ allowed: true, statuses: ['approved', 'changes requested', 'done'], comments: true })} onSaved={() => {}}/>)
    expect(markup).toContain('Q1: One sheet?')
    expect(markup.match(/>Yes</g)).toHaveLength(2)
    expect(markup.match(/Use your recommendation/g)).toHaveLength(1)
    expect(markup).toContain('<option value="changes requested">changes requested</option>')
    expect(markup).toContain('Save comment only')
    expect(markup).toContain('0 / 20,000 characters')
  })

  it('shows why writing is not possible instead of the form', () => {
    const markup = renderToStaticMarkup(<NoteForm detail={detail({ allowed: false, reason: 'Writes to live boards are off for now: only the test copy can be changed.', statuses: [], comments: false })} onSaved={() => {}}/>)
    expect(markup).toContain('Writes to live boards are off for now')
    expect(markup).not.toContain('Save comment only')
  })

  it('confirms with every cell and what goes in it', () => {
    const markup = renderToStaticMarkup(<ClaudeConfirm preview={{ token: 'a'.repeat(32), action: 'claude.status', board: 'example-lab-copy', boardTitle: 'Lab board (test copy)', testCopy: true, tab: 'Tasks', row: 5, key: 'T04', summary: ['Set Status from "review" to "approved".'], expiresAt: '2026-11-09T02:02:00.000Z', cells: [
      { cell: 'F5', header: 'Owner notes', append: 'Owner (2026-11-09):\n- Q1: Yes', keeps: 8 },
      { cell: 'D5', header: 'Status', from: 'review', to: 'approved' },
    ] }} onClose={() => {}} onDone={() => {}}/>)
    expect(markup).toContain('TEST COPY')
    expect(markup).toContain('Keeps the existing 8 characters, then adds:')
    expect(markup).toMatch(/<code>D5<\/code> Status.*review.*approved/s)
  })

  it('reports the read-back result plainly', () => {
    expect(resultMessage({ ok: true, action: 'claude.note', board: 'b', row: 5, cells: ['F5'], verified: true })).toBe('Saved to the sheet (F5) and checked by reading the cells back.')
    expect(resultMessage({ ok: false, action: 'claude.note', board: 'b', row: 5, cells: ['F5'], error: 'Google refused the write. Nothing was changed.' })).toBe('Google refused the write. Nothing was changed.')
  })
})
