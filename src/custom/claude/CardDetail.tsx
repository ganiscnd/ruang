// custom: detail panel of one Claude board row (task text, agent notes, output files, the owner's notes).
import { useEffect, useState } from 'react'
import { Dialog } from '../../ui.tsx'
import { FileViewer } from './FileViewer.tsx'
import type { AgentNotes, PathStateName, RowDetail } from './types.ts'

const STATE_LABEL: Partial<Record<PathStateName, string>> = { missing: 'Not found', 'not-downloaded': 'Not downloaded on the Mac yet', refused: 'Outside the output folder', error: 'Not Available' }

function NotesList({ title, items }: { title: string; items: string[] }) {
  return items.length ? <><h4>{title}</h4><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null
}

export function AgentNotesView({ notes }: { notes: AgentNotes }) {
  if (notes.format === 'empty') return <p className="muted">No agent notes.</p>
  return <div className="claude-notes">
    {notes.format === 'paragraphs' && <p className="muted">Older free-form notes, shown one sentence per bullet (the sheet is unchanged).</p>}
    <NotesList title="Done" items={notes.done}/>
    <NotesList title="Check" items={notes.check}/>
    {notes.questions.length > 0 && <><h4>Questions</h4><ul>{notes.questions.map((question) => <li key={question.n}><b>Q{question.n}:</b> {question.text}{question.recommend && <span className="claude-recommend"> Recommend: {question.recommend}</span>}</li>)}</ul></>}
    <NotesList title={notes.format === 'paragraphs' ? 'Notes' : 'Other'} items={notes.other}/>
  </div>
}

export function CardDetail({ board, row, onClose, onOpenTask }: { board: string; row: number; onClose: () => void; onOpenTask?: (id: string) => void }) {
  const [state, setState] = useState<{ status: 'pending' } | { status: 'ready'; detail: RowDetail } | { status: 'failed'; message: string }>({ status: 'pending' })
  const [file, setFile] = useState<string | undefined>()
  useEffect(() => {
    let active = true
    setState({ status: 'pending' })
    setFile(undefined)
    fetch(`/api/custom/claude/boards/${encodeURIComponent(board)}/rows/${row}`).then(async (response) => {
      const body = await response.json().catch(() => undefined) as RowDetail & { error?: string } | undefined
      if (active) setState(response.ok && body ? { status: 'ready', detail: body } : { status: 'failed', message: body?.error ?? `The row could not be loaded (HTTP ${response.status}).` })
    }, () => { if (active) setState({ status: 'failed', message: 'The Ruang API could not be reached.' }) })
    return () => { active = false }
  }, [board, row])
  const detail = state.status === 'ready' ? state.detail : undefined
  const card = detail?.card
  const relations = card?.relations
  const taskLinks = (ids: string[]) => (ids.length ? ids.map((id, index) => <span key={id}>{index ? ', ' : ''}{onOpenTask ? <button type="button" className="link-button" onClick={() => onOpenTask(id)}>{id}</button> : id}</span>) : '—')
  return <Dialog labelledBy="claude-detail-title" onClose={onClose} closeLabel="Close details" className="task-detail claude-detail">
    {state.status === 'pending' && <p className="muted">Loading…</p>}
    {state.status === 'failed' && <p className="form-error" role="alert">{state.message}</p>}
    {detail && card && <>
      <p className="eyebrow">{detail.board.title}{detail.board.testCopy ? ' · TEST COPY' : ''} · ROW {card.row}</p>
      <h2 id="claude-detail-title">{card.id && <span className="claude-code">{card.id} </span>}{card.title}</h2>
      {detail.board.readOnly && <p className="form-error">{detail.board.readOnly}</p>}
      <dl className="claude-detail-grid">
        <div><dt>Status</dt><dd>{card.status || '(no status)'}{relations?.stuck ? ' · stuck (not updated today)' : ''}</dd></div>
        {card.owner !== undefined && <div><dt>Owner</dt><dd>{card.owner}</dd></div>}
        {card.updated !== undefined && <div><dt>Updated</dt><dd>{card.updated}</dd></div>}
        {card.date !== undefined && <div><dt>Date</dt><dd>{card.date}</dd></div>}
        {relations && <>
          <div><dt>Depends on</dt><dd>{taskLinks(relations.dependsOn)}{relations.unknownDeps.length > 0 && <span className="text-bad"> (not on this board: {relations.unknownDeps.join(', ')})</span>}</dd></div>
          {relations.waitsFor.length > 0 && <div><dt>Still waits for</dt><dd>{taskLinks(relations.waitsFor)}</dd></div>}
          <div><dt>Unlocks</dt><dd>{taskLinks(relations.unlocks)}</dd></div>
        </>}
        {detail.fields.filter((field) => field.value).map((field) => <div key={field.key}><dt>{field.header}</dt><dd className="claude-field">{field.value}</dd></div>)}
      </dl>
      {detail.task && <details className="claude-section"><summary>Task</summary><p className="claude-pre">{detail.task}</p></details>}
      <section className="claude-section"><h3>Agent notes</h3><AgentNotesView notes={detail.agentNotes}/></section>
      {detail.outputs.length > 0 && <section className="claude-section"><h3>Output files</h3>
        <ul className="claude-outputs">{detail.outputs.map((line, index) => <li key={index}>
          {line.links.length ? line.links.map((link) => <span key={link.path} className="claude-output-link">{link.state === 'file' || link.state === 'dir' || link.state === 'unknown' ? <button type="button" className="link-button" onClick={() => setFile(link.path)}>{link.state === 'dir' ? '📁' : '📄'} {link.path}</button> : <span className="text-bad">{STATE_LABEL[link.state] ?? link.state} ({link.path})</span>}</span>) : null}
          {(!line.links.length || line.text !== line.links[0].path) && <small className="claude-output-text">{line.text}</small>}
        </li>)}</ul>
        {detail.board.hasFiles && <button type="button" className="link-button" onClick={() => setFile('')}>Browse the output folder</button>}
        {file !== undefined && <FileViewer board={detail.board.id} path={file} onOpen={setFile} onClose={() => setFile(undefined)}/>}
      </section>}
      <section className="claude-section"><h3>{detail.ownerName} notes</h3>
        {detail.ownerNotes.length ? detail.ownerNotes.map((block, index) => <article key={index} className="claude-note-block">{block.heading ? <h4>{block.heading}</h4> : detail.ownerNotes.length > 1 ? <h4 className="muted">Earlier notes (no date)</h4> : null}<p className="claude-pre">{block.lines.join('\n')}</p></article>) : <p className="muted">No notes yet.</p>}
      </section>
    </>}
  </Dialog>
}
