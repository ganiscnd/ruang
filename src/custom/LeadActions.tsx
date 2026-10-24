// custom: write actions inside the lead detail: change stage, add a note, assign to an agent.
import { useState, type FormEvent } from 'react'
import { WritesOff } from './ActionDialogs.tsx'
import { STAGES, type LeadDetailSnapshot, type Stage } from './types.ts'
import type { ActionName } from './write-actions.ts'

const CLOSING: readonly Stage[] = ['Won', 'Lost']
const OPEN_WORK = new Set(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'scheduled'])

export interface LeadActionProps {
  detail: LeadDetailSnapshot
  start: (action: ActionName, params: Record<string, unknown>) => Promise<boolean>
  busy: boolean
  error?: string
  message?: string
}

export function LeadActions({ detail, start, busy, error, message }: LeadActionProps) {
  const { lead, writes } = detail
  const nextIndex = lead.stage ? Math.min(STAGES.indexOf(lead.stage) + 1, STAGES.length - 1) : 0
  const [stage, setStage] = useState<Stage>(STAGES[nextIndex])
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const off = writes.enabled ? undefined : writes.reason ?? 'Write actions are not available.'
  const closed = lead.status === 'done'
  const openWork = lead.workCards.filter((card) => OPEN_WORK.has(card.status))
  const closing = CLOSING.includes(stage)
  const submitStage = (event: FormEvent) => { event.preventDefault(); void start('lead.stage', { id: lead.id, stage, ...(reason.trim() ? { reason } : {}) }) }
  // The panel is remounted after a successful write (see Pipeline), which also clears the note.
  const submitNote = (event: FormEvent) => { event.preventDefault(); void start('lead.note', { id: lead.id, text: note }) }

  return <section className="task-section lead-actions" aria-label="Lead actions">
    <p className="eyebrow">ACTIONS</p>
    <WritesOff reason={off}/>
    {message && <p className="form-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {closed ? <p className="small-note muted">This lead is closed (done, {lead.stage ?? 'stage Unknown'}). Notes can still be added.</p> : <form onSubmit={submitStage}>
      <label className="field-label" htmlFor="lead-stage">Change stage {lead.stage ? `(now ${lead.stage})` : '(now Unknown)'}</label>
      <div className="code-input-row">
        <select id="lead-stage" className="text-input" value={stage} onChange={(event) => setStage(event.target.value as Stage)} disabled={Boolean(off)}>{STAGES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <button type="submit" className="primary-button" disabled={Boolean(off) || busy}>Change stage…</button>
      </div>
      <textarea className="text-input" rows={2} placeholder="Reason (optional, saved under the stage line)" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={Boolean(off)} aria-label="Reason for the stage change"/>
      {closing && <p className="small-note muted">{stage} also marks the lead card done in Hermes. That is final.{openWork.length > 0 ? ` It cannot be done while a work card is open (${openWork.map((card) => `${card.id}: ${card.status}`).join(', ')}).` : ''}</p>}
    </form>}
    <form onSubmit={submitNote}>
      <label className="field-label" htmlFor="lead-note">Add a note</label>
      <textarea id="lead-note" className="text-input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={Boolean(off)}/>
      <button type="submit" className="primary-button" disabled={Boolean(off) || busy || !note.trim()}>Add note…</button>
    </form>
  </section>
}
