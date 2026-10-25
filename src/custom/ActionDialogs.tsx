// custom: confirmation dialog for every write action, and the Add lead form.
import { useState, type FormEvent } from 'react'
import { Dialog } from '../ui.tsx'
import { executeAction, type ExecuteResult, type Preview } from './write-actions.ts'

/** Shows what will happen and the exact commands; runs them only on Confirm. */
export function ConfirmDialog({ preview, onClose, onDone }: { preview: Preview; onClose: () => void; onDone: (result: ExecuteResult) => void }) {
  const [state, setState] = useState<{ phase: 'ready' | 'running' } | { phase: 'failed'; error: string; uncertain?: boolean }>({ phase: 'ready' })
  const confirm = async () => {
    setState({ phase: 'running' })
    const answer = await executeAction(preview.token)
    if (!answer.ok) { setState({ phase: 'failed', error: answer.error }); return }
    if (!answer.data.ok) { setState({ phase: 'failed', error: answer.data.error ?? 'Hermes refused the change.', uncertain: answer.data.uncertain }); onDone(answer.data); return }
    onDone(answer.data)
  }
  return <Dialog labelledBy="confirm-title" onClose={() => { if (state.phase !== 'running') onClose() }} closeLabel="Cancel" className="confirm-dialog">
    <p className="eyebrow">CONFIRM WRITE ACTION</p>
    <h2 id="confirm-title">Change Hermes?</h2>
    <ul className="confirm-summary">{preview.summary.map((line) => <li key={line}>{line}</li>)}</ul>
    <p className="field-label">Exact command{preview.commands.length > 1 ? 's, in this order' : ''}</p>
    <pre className="task-text">{preview.commands.join('\n\n')}</pre>
    <p className="small-note muted">Recorded in the command log. This confirmation expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
    {state.phase === 'failed' && <p className="form-error" role="alert">{state.error}{state.uncertain ? '' : ' Nothing more was run.'}</p>}
    <div className="access-actions">
      {state.phase !== 'failed' && <button type="button" className="primary-button" onClick={() => void confirm()} disabled={state.phase === 'running'}>{state.phase === 'running' ? 'Running…' : 'Confirm'}</button>}
      <button type="button" className="refresh-button" onClick={onClose} disabled={state.phase === 'running'}>{state.phase === 'failed' ? 'CLOSE' : 'CANCEL'}</button>
    </div>
  </Dialog>
}

/** Why a write button is disabled; shown next to it, not only as a tooltip. */
export function WritesOff({ reason }: { reason?: string }) {
  return reason ? <p className="small-note muted writes-off">{reason}</p> : null
}

const today = () => new Date().toLocaleDateString('en-CA')

export function AddLeadDialog({ onClose, onPreview, error, busy }: { onClose: () => void; onPreview: (params: Record<string, unknown>) => void; error?: string; busy: boolean }) {
  const [form, setForm] = useState({ title: '', client: '', budgetType: 'unknown', budgetMin: '', budgetMax: '', upworkUrl: '', posted: '', fit: '', tags: '', notes: '' })
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const params: Record<string, unknown> = { title: form.title }
    for (const key of ['client', 'upworkUrl', 'posted', 'tags', 'notes'] as const) if (form[key].trim()) params[key] = form[key]
    if (form.fit) params.fit = Number(form.fit)
    params.budgetType = form.budgetType
    if (form.budgetType !== 'unknown') { params.budgetMin = form.budgetMin; if (form.budgetType === 'hourly' && form.budgetMax) params.budgetMax = form.budgetMax }
    onPreview(params)
  }
  return <Dialog labelledBy="add-lead-title" onClose={onClose} closeLabel="Cancel adding a lead" className="lead-form-dialog">
    <p className="eyebrow">NEW LEAD · LEADS BOARD</p>
    <h2 id="add-lead-title">Add lead</h2>
    <p className="small-note muted">The card is created unassigned (no agent starts) with the stage Found. Only the title is required; empty fields show as Not Available.</p>
    <form className="lead-form" onSubmit={submit}>
      <label className="field-label" htmlFor="lead-title">Job title *</label>
      <input id="lead-title" className="text-input" value={form.title} onChange={set('title')} required minLength={3} maxLength={150}/>
      <label className="field-label" htmlFor="lead-client">Client</label>
      <input id="lead-client" className="text-input" value={form.client} onChange={set('client')} maxLength={120}/>
      <fieldset className="segmented"><legend className="field-label">Budget</legend>
        {(['unknown', 'fixed', 'hourly'] as const).map((kind) => <label key={kind} className={form.budgetType === kind ? 'active' : ''}><input type="radio" name="budget" value={kind} checked={form.budgetType === kind} onChange={set('budgetType')}/> {kind === 'unknown' ? 'Unknown' : kind === 'fixed' ? 'Fixed price' : 'Hourly'}</label>)}
      </fieldset>
      {form.budgetType !== 'unknown' && <div className="lead-form-row">
        <label className="field-label">{form.budgetType === 'fixed' ? 'Amount (USD)' : 'Min rate (USD/h)'}<input className="text-input" inputMode="decimal" value={form.budgetMin} onChange={set('budgetMin')} required/></label>
        {form.budgetType === 'hourly' && <label className="field-label">Max rate (USD/h, optional)<input className="text-input" inputMode="decimal" value={form.budgetMax} onChange={set('budgetMax')}/></label>}
      </div>}
      <label className="field-label" htmlFor="lead-url">Upwork job URL</label>
      <input id="lead-url" className="text-input" type="url" placeholder="https://www.upwork.com/jobs/~01…" value={form.upworkUrl} onChange={set('upworkUrl')} maxLength={300}/>
      <div className="lead-form-row">
        <label className="field-label">Posted<input className="text-input" type="date" max={today()} value={form.posted} onChange={set('posted')}/></label>
        <label className="field-label">My fit<select className="text-input" value={form.fit} onChange={set('fit')}><option value="">Not set</option>{[5, 4, 3, 2, 1].map((fit) => <option key={fit} value={fit}>{fit} / 5</option>)}</select></label>
      </div>
      <label className="field-label" htmlFor="lead-tags">Tags (comma separated: a-z, 0-9, -)</label>
      <input id="lead-tags" className="text-input" placeholder="n8n, procore, rag" value={form.tags} onChange={set('tags')}/>
      <label className="field-label" htmlFor="lead-notes">Notes</label>
      <textarea id="lead-notes" className="text-input" rows={5} value={form.notes} onChange={set('notes')} maxLength={6000}/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="access-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Checking…' : 'Review and confirm'}</button><button type="button" className="refresh-button" onClick={onClose}>CANCEL</button></div>
    </form>
  </Dialog>
}
