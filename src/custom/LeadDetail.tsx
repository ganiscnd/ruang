// custom: detail dialog of one pipeline lead (fields, dated stage history, comments, work cards).
import { useEffect, useState, type ReactNode } from 'react'
import { formatDateTime, statusTone } from '../format.ts'
import { loadSnapshot, type RequestState } from '../request-state.ts'
import { Dialog } from '../ui.tsx'
import { budgetLabel, dateLabel, daysLabel, fitLabel, NOT_AVAILABLE, STAGE_TONE, stageColumn } from './lead-view.ts'
import type { Lead, LeadDetailSnapshot } from './types.ts'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

export function UpworkLink({ url }: { url?: string }) {
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="lead-link">Open on Upwork ↗</a> : <span className="muted">{NOT_AVAILABLE}</span>
}

/** `actions` renders the write actions for the loaded lead (added by the write steps). */
export function LeadDetailDialog({ lead, onClose, reloadKey = 0, actions }: { lead: Lead; onClose: () => void; reloadKey?: number; actions?: (detail: LeadDetailSnapshot) => ReactNode }) {
  const [state, setState] = useState<RequestState<LeadDetailSnapshot>>({ status: 'pending' })
  useEffect(() => {
    let active = true
    void loadSnapshot<LeadDetailSnapshot>(`/api/custom/pipeline/${encodeURIComponent(lead.id)}${reloadKey > 0 ? '?fresh=1' : ''}`).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [lead.id, reloadKey])
  const detail = state.status === 'ready' ? state.data.lead : undefined
  const shown = detail ?? lead
  const column = stageColumn(shown)
  return <Dialog labelledBy="lead-detail-title" onClose={onClose} closeLabel={`Close details for ${lead.title}`} className="task-detail lead-detail">
    <p className="eyebrow">LEAD · LEADS BOARD · {lead.id}</p>
    <h2 id="lead-detail-title">{shown.title}</h2>
    <div className="task-meta"><span className={`badge ${STAGE_TONE[column]}`}>{column}</span><span className="chip chip-muted" title="Hermes status of the lead card">card: {shown.status}</span>{shown.assignedAgent ? <span className="chip">agent: {shown.assignedAgent}</span> : <span className="chip chip-muted">no agent working</span>}</div>
    {state.status === 'pending' && <p className="muted">Loading lead details…</p>}
    {state.status === 'failed' && <p className="file-notice">Full details are not available right now: {state.message}</p>}
    {!shown.hasBlock && <p className="file-notice">This card has no <code>[lead]</code> block, so its lead fields are unknown.</p>}
    {!shown.historyAvailable && <p className="file-notice">The comments of this card could not be read (<code>hermes kanban show</code>), so its stage is Unknown.</p>}
    <dl className="office-detail-grid task-grid">
      <Field label="Client">{shown.fields.client ?? NOT_AVAILABLE}</Field>
      <Field label="Budget">{budgetLabel(shown.fields.budget)}</Field>
      <Field label="Posted">{dateLabel(shown.fields.posted)}</Field>
      <Field label="Fit">{fitLabel(shown.fields.fit)}</Field>
      <Field label="Days in stage">{daysLabel(shown)}</Field>
      <Field label="Upwork"><UpworkLink url={shown.fields.upworkUrl}/></Field>
      <Field label="Tags">{shown.fields.tags.length ? <span className="task-meta">{shown.fields.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}</span> : NOT_AVAILABLE}</Field>
      <Field label="Created">{shown.createdAt ? `${formatDateTime(shown.createdAt)}${shown.createdBy ? ` by ${shown.createdBy}` : ''}` : NOT_AVAILABLE}</Field>
    </dl>
    {state.status === 'ready' && actions?.(state.data)}
    <section className="task-section"><p className="eyebrow">NOTES</p>{shown.fields.notes ? <pre className="task-text">{shown.fields.notes}</pre> : <p className="muted">No notes.</p>}</section>
    <section className="task-section"><p className="eyebrow">AGENT WORK CARDS ({shown.workCards.length})</p>
      {shown.workCards.length === 0 ? <p className="muted">No work cards. An agent only starts when you use “Assign to agent”.</p>
        : <ul className="task-timeline">{shown.workCards.map((card) => <li key={card.id}><b>{card.title}</b><span className="task-meta"><span className={`badge ${statusTone(card.status)}`}>{card.status}</span><span className={`chip ${card.assignee ? '' : 'chip-muted'}`}>{card.assignee ?? 'unassigned'}</span><small>{card.id}</small></span></li>)}</ul>}
    </section>
    {detail && <section className="task-section"><p className="eyebrow">STAGE HISTORY ({detail.stageHistory.length})</p>
      {detail.stageHistory.length === 0 ? <p className="muted">No stage comments yet, so the stage is Unknown.</p>
        : <ul className="task-timeline">{[...detail.stageHistory].reverse().map((entry, index) => <li key={index} className={entry.ignored ? 'stage-ignored' : ''}><b>{entry.stage}</b><small>{entry.at ? formatDateTime(entry.at) : 'Time Not Available'} · {entry.author}</small>{entry.reason && <p>{entry.reason}</p>}{entry.ignored && <p className="text-bad">Ignored: {entry.ignored}</p>}</li>)}</ul>}
    </section>}
    {detail && <section className="task-section"><p className="eyebrow">COMMENTS ({detail.comments.length})</p>
      {detail.comments.length === 0 ? <p className="muted">No comments.</p>
        : <ul className="task-timeline">{[...detail.comments].reverse().map((comment, index) => <li key={index}><b>{comment.author}</b><small>{formatDateTime(comment.createdAt)}</small><p>{comment.body}</p></li>)}</ul>}
    </section>}
  </Dialog>
}
