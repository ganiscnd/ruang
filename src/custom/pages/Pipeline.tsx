// custom: Lead & Proposal Pipeline page (#/pipeline). Leads live on the Hermes Kanban board `leads`.
import { useRef, useState } from 'react'
import { formatNumber } from '../../format.ts'
import { usePolling, type Polled } from '../../polling.ts'
import type { Source } from '../../types.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../../ui.tsx'
import { AddLeadDialog, WritesOff } from '../ActionDialogs.tsx'
import { useWriteAction } from '../use-write-action.tsx'
import { LeadDetailDialog, UpworkLink } from '../LeadDetail.tsx'
import { budgetLabel, dateLabel, daysLabel, fitLabel, matchesSearch, NOT_AVAILABLE, STAGE_TONE, stageColumn, UNKNOWN_STAGE, type StageColumn } from '../lead-view.ts'
import { STAGES, type Lead, type PipelineSnapshot } from '../types.ts'
import '../pipeline.css'

const COLUMNS: StageColumn[] = [UNKNOWN_STAGE, ...STAGES]
type View = 'board' | 'list'

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: (trigger: HTMLButtonElement) => void }) {
  return <article className="task lead-card">
    <button type="button" className="task-card lead-open" onClick={(event) => onOpen(event.currentTarget)} aria-label={`${lead.title}. Stage ${stageColumn(lead)}. Open lead details.`}><strong>{lead.title}</strong></button>
    <p className="lead-client">{lead.fields.client ?? <span className="muted">Client {NOT_AVAILABLE}</span>}</p>
    <dl className="lead-facts">
      <div><dt>Budget</dt><dd>{budgetLabel(lead.fields.budget)}</dd></div>
      <div><dt>Posted</dt><dd>{dateLabel(lead.fields.posted)}</dd></div>
      <div><dt>Fit</dt><dd>{fitLabel(lead.fields.fit)}</dd></div>
      <div><dt>In stage</dt><dd>{daysLabel(lead)}</dd></div>
    </dl>
    <div className="task-meta">{lead.fields.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}{lead.assignedAgent ? <span className="chip chip-priority">agent: {lead.assignedAgent}</span> : null}</div>
    <UpworkLink url={lead.fields.upworkUrl}/>
  </article>
}

export function Pipeline() {
  return <PipelineView snapshot={usePolling<PipelineSnapshot>('/api/custom/pipeline', 30_000)}/>
}

export function PipelineView({ snapshot }: { snapshot: Polled<PipelineSnapshot> }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('board')
  const [open, setOpen] = useState<Lead | undefined>()
  const trigger = useRef<HTMLElement | null>(null)
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const board = data?.board
  // SourceStatus speaks the shared Source shape; the board read is this page's source.
  const source: Source<null> | undefined = board && { availability: board.availability, data: null, ...(board.error ? { error: { code: 'COMMAND_FAILED' as const, message: board.error } } : {}) }
  const leads = data?.leads ?? []
  const visible = leads.filter((lead) => matchesSearch(lead, query))
  const openLead = (lead: Lead, element: HTMLElement) => { trigger.current = element; setOpen(lead) }
  const close = () => { setOpen(undefined); trigger.current?.focus() }
  const writesOff = data && !data.writes.enabled ? data.writes.reason ?? 'Write actions are not available.' : undefined
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<string | undefined>()
  const write = useWriteAction((result) => {
    snapshot.refresh()
    if (!result.ok) return
    setAdding(false)
    setMessage(result.action === 'board.setup' ? 'The leads board is set up.' : result.action === 'lead.create' ? `Lead added${result.createdId ? ` (${result.createdId})` : ''} with the stage Found.` : undefined)
  })

  return <>
    <PageTitle eyebrow="FREELANCE · HERMES KANBAN BOARD “LEADS”" title="Lead & proposal pipeline">Every Upwork lead and where it stands. Stages come from <code>stage:</code> comments on each card; a lead without one is Unknown. Refreshes every 30 seconds.</PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={snapshot}/>
    {snapshot.status === 'pending' && <LoadingState message="Reading the leads board from Hermes…"/>}
    <Unavailable source={source} request={snapshot}/>
    {message && <p className="form-success" role="status">{message}</p>}
    {board?.availability === 'available' && board.exists === false && <section className="empty-state"><h2>Leads board not set up</h2><p>Hermes has no Kanban board called <code>leads</code> yet. Setting it up is a one-time write action: <code>hermes kanban boards create … leads</code>.</p>
      <div className="access-actions"><button type="button" className="primary-button" disabled={Boolean(writesOff) || write.busy} onClick={() => void write.start('board.setup', {})}>Set up leads board</button></div>
      <WritesOff reason={writesOff}/>{write.error && !adding && <p className="form-error" role="alert">{write.error}</p>}
    </section>}
    {board?.availability === 'available' && board.exists === true && <>
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} label="Search leads (title, client, tags, stage)"/>
        <div className="view-toggle" role="group" aria-label="Pipeline view">{(['board', 'list'] as const).map((item) => <button type="button" key={item} className={view === item ? 'active' : ''} aria-pressed={view === item} onClick={() => setView(item)}>{item.toUpperCase()}</button>)}</div>
        <button type="button" className="primary-button" disabled={Boolean(writesOff)} title={writesOff} onClick={() => { write.clearError(); setMessage(undefined); setAdding(true) }}>+ Add lead</button>
        <span className="toolbar-count">{visible.length} of {formatNumber(leads.length)} shown{data && data.omitted > 0 ? ` · ${data.omitted} older not loaded` : ''}</span>
      </div>
      {writesOff && <p className="file-notice">{writesOff}</p>}
      {leads.length === 0 ? <EmptyState title="No leads yet">The <code>leads</code> board is empty. Add a lead, or let an agent add one following <code>docs/LEADS_PROTOCOL.md</code>.</EmptyState>
        : view === 'board'
          ? <section className="board" aria-label="Pipeline board">{COLUMNS.map((column) => {
            const items = visible.filter((lead) => stageColumn(lead) === column)
            if (column === UNKNOWN_STAGE && items.length === 0) return null
            return <article key={column} className={`column tone-border-${STAGE_TONE[column]}`} aria-label={`${column} column`}><header className="column-head"><p className="eyebrow">{column}</p><span className="column-count">{items.length}</span></header>
              {items.length === 0 ? <p className="column-empty">—</p> : items.map((lead) => <LeadCard key={lead.id} lead={lead} onOpen={(element) => openLead(lead, element)}/>)}
            </article>
          })}</section>
          : <div className="table-scroll"><table className="log-table lead-table"><thead><tr><th>Lead</th><th>Client</th><th>Budget</th><th>Posted</th><th>Fit</th><th>Stage</th><th>In stage</th><th>Agent</th><th>Upwork</th></tr></thead>
            <tbody>{visible.map((lead) => <tr key={lead.id}><td><button type="button" className="link-button" onClick={(event) => openLead(lead, event.currentTarget)}>{lead.title}</button>{lead.fields.tags.length > 0 && <div className="task-meta">{lead.fields.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}</div>}</td><td>{lead.fields.client ?? NOT_AVAILABLE}</td><td>{budgetLabel(lead.fields.budget)}</td><td>{dateLabel(lead.fields.posted)}</td><td>{fitLabel(lead.fields.fit)}</td><td><span className={`badge ${STAGE_TONE[stageColumn(lead)]}`}>{stageColumn(lead)}</span></td><td>{daysLabel(lead)}</td><td>{lead.assignedAgent ?? '—'}</td><td><UpworkLink url={lead.fields.upworkUrl}/></td></tr>)}</tbody></table></div>}
    </>}
    {open && <LeadDetailDialog key={open.id} lead={open} onClose={close}/>}
    {adding && <AddLeadDialog onClose={() => setAdding(false)} onPreview={(params) => void write.start('lead.create', params)} error={write.error} busy={write.busy}/>}
    {write.dialog}
  </>
}
