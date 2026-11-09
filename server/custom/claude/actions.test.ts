import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCommandLog } from '../../mission-control.js'
import { ValidationError } from '../validate.js'
import { allowedStatuses, appendNotes, ClaudeActionError, ClaudeWrites, notesHash, noteBlock, planClaude, rowWriteState, type WriteContext } from './actions.js'
import type { BoardRead } from './board.js'
import { findBoard, parseClaudeConfig, type BoardConfig } from './config.js'
import { exampleConfig } from './example.fixture.js'
import type { CellWrite, SheetsApi } from './sheets.js'

// Invented boards: a task-flow test copy (with Updated and owner-notes columns) and a table board.
const raw = exampleConfig() as { teams: { boards: Record<string, unknown>[] }[] }
const labRaw = raw.teams[1].boards[0]
labRaw.columns = { ...(labRaw.columns as object), ganiNotes: { col: 'F', header: 'Owner notes', role: 'ganiNotes' }, updated: { col: 'G', header: 'Updated', role: 'updated' } }
labRaw.ganiCanSetStatus = { review: ['approved', 'changes requested', 'done'], proposed: ['ready', 'rejected'] }
labRaw.writableColumns = ['status', 'ganiNotes', 'updated']
labRaw.unlockStatuses = ['approved', 'done']
const draftsRaw = raw.teams[0].boards[0]
draftsRaw.neverTouchStatus = ['do-not-contact']
draftsRaw.ganiCanSetStatus = ['Posted', 'Skipped', 'do-not-contact']
const config = parseClaudeConfig(raw)
const copy = findBoard(config, 'example-lab-copy')!
const live = findBoard(config, 'example-lab')!
const drafts = findBoard(config, 'example-drafts')!

const labRow = (status: string, notes = '') => ({ row: 5, cells: { id: 'T04', owner: 'ZZ.3.A', dependsOn: '', status, notified: 'yes', title: 'Example task', ganiNotes: notes, updated: '2026-11-08' } })
const readOf = (board: BoardConfig, rows: BoardRead['rows'], extra: Partial<BoardRead> = {}): BoardRead => ({ board, fetchedAt: '2026-11-09T02:00:00.000Z', availability: 'available', rows, ...extra })
const context = (read: BoardRead, extra: Partial<WriteContext> = {}): WriteContext => ({ read, ownerName: 'Owner', today: '2026-11-09', liveWrites: false, ...extra })
const seen = (status: string, notes = '') => ({ status, notes: notesHash(notes) })
const request = (status: string, notes = '', extra: Record<string, unknown> = {}) => ({ board: 'example-lab-copy', row: 5, key: 'T04', seen: seen(status, notes), ...extra })

describe('owner notes block', () => {
  it('appends a dated block with answers and bulleted comment lines, never overwriting', () => {
    const block = noteBlock('Owner', '2026-11-09', [{ n: 1, text: 'Yes' }, { n: 2, text: 'Use one sheet\nand keep the old tab' }], 'Looks good\n\n- keep the naming\n')
    expect(block).toBe('Owner (2026-11-09):\n- Q1: Yes\n- Q2: Use one sheet\n  and keep the old tab\n- Looks good\n- keep the naming')
    expect(appendNotes('Earlier note.\n\n', block!)).toBe(`Earlier note.\n\n${block}`)
    expect(appendNotes('', block!)).toBe(block)
    expect(noteBlock('Owner', '2026-11-09', [], '  ')).toBeUndefined()
  })
})

describe('Claude write plan', () => {
  it('builds exactly the status, Updated and appended notes cells on a test copy', () => {
    const plan = planClaude('claude.status', request('review', 'Earlier.', { status: 'Approved', answers: [{ n: 1, text: 'Yes' }, { n: 2, text: '' }], comment: 'Ship it' }), context(readOf(copy, [labRow('review', 'Earlier.')])))
    expect(plan.cells.map((cell) => [cell.cell, cell.range, cell.to])).toEqual([
      ['F5', "'Tasks'!F5", 'Earlier.\n\nOwner (2026-11-09):\n- Q1: Yes\n- Ship it'],
      ['D5', "'Tasks'!D5", 'approved'],
      ['G5', "'Tasks'!G5", '2026-11-09'],
    ])
    expect(plan.status).toEqual({ from: 'review', to: 'approved' })
    expect(plan.summary).toContain('Set Status from "review" to "approved".')
  })

  it('saves a comment only without touching status or Updated', () => {
    const plan = planClaude('claude.note', request('review', '', { comment: 'A question for later' }), context(readOf(copy, [labRow('review')])))
    expect(plan.cells.map((cell) => cell.cell)).toEqual(['F5'])
    expect(() => planClaude('claude.note', request('review', '', { comment: 'x', status: 'approved' }), context(readOf(copy, [labRow('review')])))).toThrow('cannot change the status')
    expect(() => planClaude('claude.note', request('review'), context(readOf(copy, [labRow('review')])))).toThrow('Write a comment or an answer first.')
  })

  it('refuses when the row changed since the owner opened it', () => {
    const read = readOf(copy, [labRow('review', 'Earlier.')])
    const changed = /This task changed since you opened it/
    expect(() => planClaude('claude.note', request('ready', 'Earlier.', { comment: 'x' }), context(read))).toThrow(changed)
    expect(() => planClaude('claude.note', request('review', 'Different.', { comment: 'x' }), context(read))).toThrow(changed)
    expect(() => planClaude('claude.note', { ...request('review', 'Earlier.', { comment: 'x' }), key: 'T09' }, context(read))).toThrow(changed)
    expect(() => planClaude('claude.note', { ...request('review', 'Earlier.', { comment: 'x' }), row: 6 }, context(read))).toThrow(changed)
  })

  it('refuses statuses the config does not allow from the current one', () => {
    const read = readOf(copy, [labRow('review')])
    expect(() => planClaude('claude.status', request('review', '', { status: 'ready' }), context(read))).toThrow(/not a status you can set from "review" \(allowed: approved, changes requested, done\)/)
    expect(allowedStatuses(copy, 'Proposed')).toEqual(['ready', 'rejected'])
    expect(allowedStatuses(copy, 'in progress')).toEqual([])
    // A flat list allows any listed status except the current one.
    expect(allowedStatuses(drafts, 'Posted')).toEqual(['Skipped', 'do-not-contact'])
  })

  it('refuses columns the config does not list as writable, and never writes a read-only one', () => {
    const narrow: BoardConfig = { ...copy, writableColumns: ['status'] }
    expect(() => planClaude('claude.note', { ...request('review', '', { comment: 'x' }), board: narrow.id }, context(readOf(narrow, [labRow('review')])))).toThrow('does not allow writing Owner notes')
    const noUpdated: BoardConfig = { ...copy, writableColumns: ['status', 'ganiNotes'] }
    const plan = planClaude('claude.status', request('review', '', { status: 'done' }), context(readOf(noUpdated, [labRow('review')])))
    expect(plan.cells.map((cell) => cell.cell)).toEqual(['D5'])
    expect(plan.summary).toContain('Updated is not writable in the config, so it is left as is.')
  })

  it('keeps do-not-contact rows read-only', () => {
    const row = { row: 3, cells: { postDate: '2026-11-09', topic: 'Example topic', status: 'do-not-contact', ganiNotes: '' } }
    const read = readOf(drafts, [row])
    expect(rowWriteState(drafts, read, row, true)).toMatchObject({ allowed: false, reason: 'This row is "do-not-contact": Ruang never changes it.' })
    expect(() => planClaude('claude.note', { board: drafts.id, row: 3, key: '2026-11-09 · Example topic', seen: seen('do-not-contact'), comment: 'x' }, context(read, { liveWrites: true }))).toThrow('never changes it')
  })

  it('refuses live boards until liveWrites is on', () => {
    const read = readOf(live, [labRow('review')])
    expect(() => planClaude('claude.note', { ...request('review', '', { comment: 'x' }), board: live.id }, context(read))).toThrow(/Writes to live boards are off for now/)
    expect(planClaude('claude.note', { ...request('review', '', { comment: 'x' }), board: live.id }, context(read, { liveWrites: true })).cells).toHaveLength(1)
  })

  it('refuses read-only boards, a cell past 50,000 characters and comments past 20,000; drops control characters', () => {
    expect(() => planClaude('claude.note', request('review', '', { comment: 'x' }), context(readOf(copy, [labRow('review')], { readOnly: 'Column header mismatch, so this board is read-only: D should be "Status".' })))).toThrow('read-only')
    const full = 'n'.repeat(49_990)
    expect(() => planClaude('claude.note', request('review', full, { comment: 'one more line here' }), context(readOf(copy, [labRow('review', full)])))).toThrow(/holds at most 50,000 per cell/)
    expect(() => planClaude('claude.note', request('review', '', { comment: 'x'.repeat(20_001) }), context(readOf(copy, [labRow('review')])))).toThrow(ValidationError)
    // Control characters are dropped (same rule as the Pipeline notes), never written to the sheet.
    expect(planClaude('claude.note', request('review', '', { comment: 'bad \u0007bell' }), context(readOf(copy, [labRow('review')]))).cells[0].to).toBe('Owner (2026-11-09):\n- bad bell')
  })
})

function fakeSheets(rows: () => BoardRead['rows'], options: { fail?: Error } = {}) {
  const writes: CellWrite[][] = []
  const store = new Map<string, string>()
  const sheets: SheetsApi = {
    async batchGet(_id, ranges) { return ranges.map((range) => [[store.get(range) ?? '']]) },
    async batchUpdate(_id, cells) { if (options.fail) throw options.fail; writes.push(cells); for (const cell of cells) store.set(cell.range, cell.value) },
  }
  return { sheets, writes, fresh: async () => ({ context: context(readOf(copy, rows())), sheets }) }
}

describe('Claude writes (preview → confirm → execute)', () => {
  const session = 'session-a'
  const make = async () => new ClaudeWrites({ auditPath: path.join(await mkdtemp(path.join(tmpdir(), 'ruang-audit-')), 'write-audit.jsonl') })

  it('writes exactly the previewed cells once, reads them back and audits without the comment text', async () => {
    const writes = await make()
    const google = fakeSheets(() => [labRow('review', 'Earlier.')])
    const preview = writes.preview('claude.status', request('review', 'Earlier.', { status: 'approved', comment: 'Private thought' }), context(readOf(copy, [labRow('review', 'Earlier.')])), session)
    expect(preview).toMatchObject({ board: 'example-lab-copy', testCopy: true, row: 5, key: 'T04' })
    expect(preview.cells).toEqual([
      { cell: 'F5', header: 'Owner notes', append: 'Owner (2026-11-09):\n- Private thought', keeps: 8 },
      { cell: 'D5', header: 'Status', from: 'review', to: 'approved' },
      { cell: 'G5', header: 'Updated', from: '2026-11-08', to: '2026-11-09' },
    ])
    const result = await writes.execute(preview.token, session, google.fresh)
    expect(result).toEqual({ ok: true, action: 'claude.status', board: 'example-lab-copy', row: 5, cells: ['F5', 'D5', 'G5'], verified: true })
    expect(google.writes).toHaveLength(1)
    await expect(writes.execute(preview.token, session, google.fresh)).rejects.toThrow('not valid')
    const audit = await readFile(writes.auditPath, 'utf8')
    expect(JSON.parse(audit)).toMatchObject({ kind: 'sheets', action: 'claude.status', board: 'example-lab-copy', testCopy: true, row: 5, rowKey: 'T04', cells: ['F5', 'D5', 'G5'], status: { from: 'review', to: 'approved' }, ok: true, verified: true })
    expect(audit).not.toContain('Private thought')
    expect(getCommandLog().entries[0]).toMatchObject({ command: 'sheets update example-lab-copy row 5 [F,D,G]', ok: true, write: true })
  })

  it('refuses at execute when an agent wrote in the meantime, and writes nothing', async () => {
    const writes = await make()
    let notes = 'Earlier.'
    const google = fakeSheets(() => [labRow('review', notes)])
    const preview = writes.preview('claude.note', request('review', 'Earlier.', { comment: 'x' }), context(readOf(copy, [labRow('review', 'Earlier.')])), session)
    notes = 'Earlier.\n\nAgent: replied.'
    await expect(writes.execute(preview.token, session, google.fresh)).rejects.toThrow(new ClaudeActionError('This task changed since you opened it. Reload.', 409))
    expect(google.writes).toHaveLength(0)
  })

  it('refuses another session\'s token and reports an unanswered write as uncertain', async () => {
    const writes = await make()
    const ctx = context(readOf(copy, [labRow('review')]))
    const first = writes.preview('claude.note', request('review', '', { comment: 'x' }), ctx, session)
    await expect(writes.execute(first.token, 'session-b', fakeSheets(() => [labRow('review')]).fresh)).rejects.toThrow('not valid')
    const { SheetsError } = await import('./sheets.js')
    const second = writes.preview('claude.note', request('review', '', { comment: 'x' }), ctx, session)
    const result = await writes.execute(second.token, session, fakeSheets(() => [labRow('review')], { fail: new SheetsError('Google did not answer in time.', 'network') }).fresh)
    expect(result).toMatchObject({ ok: false, uncertain: true, error: expect.stringMatching(/^Google did not answer in time\. Unknown whether/) })
  })
})

describe('Claude write routes', () => {
  async function serve(access: { enabled: boolean; unlocked: boolean; session?: string }) {
    const { default: express } = await import('express')
    const { installClaude } = await import('./routes.js')
    const app = express()
    const google = fakeSheets(() => [labRow('review')])
    installClaude(app, { accessOf: async () => access, writeContext: google.fresh, writes: new ClaudeWrites({ auditPath: path.join(await mkdtemp(path.join(tmpdir(), 'ruang-audit-')), 'a.jsonl') }), afterWrite: () => {} })
    const server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const post = (url: string, body: unknown, headers: Record<string, string> = { 'x-ruang-request': '1' }) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { post, google, close: () => server.close() }
  }
  const body = { action: 'claude.note', params: request('review', '', { comment: 'From the route' }) }

  it('needs the request header, the same origin and the access code unlocked', async () => {
    const off = await serve({ enabled: false, unlocked: false })
    try {
      expect((await off.post('/api/custom/claude/actions/preview', body, {})).status).toBe(403)
      expect((await off.post('/api/custom/claude/actions/preview', body, { 'x-ruang-request': '1', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      const refused = await off.post('/api/custom/claude/actions/preview', body)
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ error: 'Write actions need the access code. Turn it on in Settings.' })
    } finally { off.close() }
    const locked = await serve({ enabled: true, unlocked: false })
    try { expect((await locked.post('/api/custom/claude/actions/preview', body)).status).toBe(403) } finally { locked.close() }
  })

  it('previews and executes for an unlocked session', async () => {
    const api = await serve({ enabled: true, unlocked: true, session: 'session-a' })
    try {
      const preview = await (await api.post('/api/custom/claude/actions/preview', body)).json() as { token: string }
      expect(preview.token).toMatch(/^[0-9a-f]{32}$/)
      const result = await (await api.post('/api/custom/claude/actions/execute', { token: preview.token })).json()
      expect(result).toMatchObject({ ok: true, cells: ['F5'], verified: true })
      expect(api.google.writes[0]).toEqual([{ range: "'Tasks'!F5", value: 'Owner (2026-11-09):\n- From the route' }])
      expect((await api.post('/api/custom/claude/actions/preview', { action: 'claude.drop', params: {} })).status).toBe(400)
    } finally { api.close() }
  })
})
