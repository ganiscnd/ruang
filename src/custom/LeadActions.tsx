// custom: write actions inside the lead detail: change stage, add a note, assign to an agent.
import { useState, type FormEvent } from 'react'
import { WritesOff } from './ActionDialogs.tsx'
import { STAGES, type LeadDetailSnapshot, type Stage } from './types.ts'
import type { ActionName } from './write-actions.ts'

const CLOSING: readonly Stage[] = ['Won', 'Lost']
const OPEN_WORK = new Set(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'scheduled'])
/** Open research statuses that block a proposal (same rule as server/custom/actions.ts researchState). */
const RESEARCH_RUNNING = new Set([...OPEN_WORK].filter((status) => status !== 'blocked'))
type WorkKind = 'research' | 'proposal'
/** The dedicated Hermes profiles (see server/custom/actions.ts WORK_PROFILES). */
const WORK_PROFILES: Record<WorkKind, string> = { research: 'lead-researcher', proposal: 'proposal-writer' }

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
  const initialKind: WorkKind = lead.stage === 'Researched' ? 'proposal' : 'research'
  const preferred = (job: WorkKind) => (detail.agents.includes(WORK_PROFILES[job]) ? WORK_PROFILES[job] : detail.agents[0] ?? '')
  const [kind, setKind] = useState<WorkKind>(initialKind)
  const [agent, setAgent] = useState(preferred(initialKind))
  const changeKind = (job: WorkKind) => { setKind(job); setAgent(preferred(job)) }
  const finished = lead.workCards.filter((card) => card.status === 'done' && card.title.startsWith(`[lead ${lead.id}] ${kind === 'research' ? 'Research' : 'Draft proposal'}:`)).length
  const researchRunning = kind === 'proposal' ? lead.workCards.find((card) => card.title.startsWith(`[lead ${lead.id}] Research:`) && RESEARCH_RUNNING.has(card.status)) : undefined
  const researchMissing = kind === 'proposal' && !researchRunning && (lead.historyAvailable ? (lead.stageHistory.some((entry) => entry.stage === 'Researched' && entry.author !== 'owner') ? undefined : 'none') : 'unknown')
  const off = writes.enabled ? undefined : writes.reason ?? 'Write actions are not available.'
  const closed = lead.status === 'done'
  const openWork = lead.workCards.filter((card) => OPEN_WORK.has(card.status))
  const closing = CLOSING.includes(stage)
  const submitStage = (event: FormEvent) => { event.preventDefault(); void start('lead.stage', { id: lead.id, stage, ...(reason.trim() ? { reason } : {}) }) }
  // The panel is remounted after a successful write (see Pipeline), which also clears the note.
  const submitNote = (event: FormEvent) => { event.preventDefault(); void start('lead.note', { id: lead.id, text: note }) }
  const submitAssign = (event: FormEvent) => { event.preventDefault(); void start('lead.assign', { id: lead.id, profile: agent, kind }) }

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
    {!closed && <form onSubmit={submitAssign}>
      <label className="field-label" htmlFor="lead-agent">Assign to agent</label>
      {detail.agents.length === 0 ? <p className="small-note muted">No Hermes profiles could be read, so no agent can be assigned right now.</p> : <>
        <div className="code-input-row">
          <select id="lead-agent" className="text-input" value={agent} onChange={(event) => setAgent(event.target.value)} disabled={Boolean(off)} aria-label="Agent">{detail.agents.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          <select className="text-input" value={kind} onChange={(event) => changeKind(event.target.value as WorkKind)} disabled={Boolean(off)} aria-label="Job"><option value="research">Research the lead</option><option value="proposal">Draft a proposal</option></select>
          <button type="submit" className="primary-button" disabled={Boolean(off) || busy || !agent || Boolean(researchRunning)}>Assign to agent…</button>
        </div>
        <p className="small-note muted">Creates a separate work card for the agent, linked to this lead. The agent starts within about a minute and uses tokens. The lead card itself is never assigned. One attempt only, at most 15 minutes. Use {WORK_PROFILES[kind]} for this job: other profiles lack the leads protocol and Hermes stops their card at once.</p>
        {researchRunning && <p className="small-note form-error" role="note">Research on this lead is not finished yet ({researchRunning.id}: {researchRunning.status}). Wait until it is done, so the proposal can use its research comment.</p>}
        {researchMissing === 'none' && <p className="small-note form-error" role="note">This lead has no research comment from an agent yet. A proposal now would use only the job text, without Niche fit, hard requirements or application questions from research.</p>}
        {researchMissing === 'unknown' && <p className="small-note form-error" role="note">The lead&apos;s comments could not be read, so it is unknown whether a research comment exists.</p>}
        {finished > 0 && <p className="small-note form-error" role="note">This lead already has {finished} finished {kind === 'research' ? 'research' : 'proposal'} run{finished === 1 ? '' : 's'}. A new run uses tokens again.</p>}
      </>}
    </form>}
    <form onSubmit={submitNote}>
      <label className="field-label" htmlFor="lead-note">Add a note</label>
      <textarea id="lead-note" className="text-input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={6000} disabled={Boolean(off)}/>
      <button type="submit" className="primary-button" disabled={Boolean(off) || busy || !note.trim()}>Add note…</button>
    </form>
  </section>
}
