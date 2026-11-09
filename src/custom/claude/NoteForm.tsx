// custom: the owner's answer / comment / status form under a Claude board row, and its
// confirmation dialog that shows exactly which cells change.
import { useState } from 'react'
import { Dialog } from '../../ui.tsx'
import { CharCount, WritesOff } from '../ActionDialogs.tsx'
import { NOTE_LIMIT, noteLength } from '../write-actions.ts'
import { executeClaude, previewClaude, resultMessage, type ClaudeAction, type ClaudePreview, type ClaudeResult } from './claude-writes.ts'
import type { RowDetail } from './types.ts'

export function ClaudeConfirm({ preview, onClose, onDone }: { preview: ClaudePreview; onClose: () => void; onDone: (result: ClaudeResult) => void }) {
  const [state, setState] = useState<{ phase: 'ready' | 'running' } | { phase: 'failed'; error: string }>({ phase: 'ready' })
  const confirm = async () => {
    setState({ phase: 'running' })
    const answer = await executeClaude(preview.token)
    if (!answer.ok) { setState({ phase: 'failed', error: answer.error }); return }
    if (!answer.data.ok) setState({ phase: 'failed', error: resultMessage(answer.data) })
    onDone(answer.data)
  }
  return <Dialog labelledBy="claude-confirm-title" onClose={() => { if (state.phase !== 'running') onClose() }} closeLabel="Cancel" className="confirm-dialog">
    <p className="eyebrow">CONFIRM WRITE · GOOGLE SHEET</p>
    <h2 id="claude-confirm-title">Change {preview.boardTitle}?</h2>
    {preview.testCopy ? <p className="badge info">TEST COPY · agents never read it</p> : <p className="badge unknown">LIVE BOARD · agents read it</p>}
    <ul className="confirm-summary">{preview.summary.map((line) => <li key={line}>{line}</li>)}</ul>
    <p className="field-label">Exactly these cells on tab “{preview.tab}”, row {preview.row} ({preview.key}); nothing else:</p>
    <div className="claude-cells">{preview.cells.map((cell) => <div key={cell.cell}>
      <p><code>{cell.cell}</code> {cell.header}</p>
      {'append' in cell ? <><small className="muted">{cell.keeps ? `Keeps the existing ${cell.keeps.toLocaleString('en-US')} characters, then adds:` : 'The cell is empty; it becomes:'}</small><pre className="task-text">{cell.append}</pre></>
        : <p className="claude-cell-change"><span>{cell.from || '(empty)'}</span> → <b>{cell.to}</b></p>}
    </div>)}</div>
    <p className="small-note muted">Recorded in the command log and the write audit. This confirmation expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
    {state.phase === 'failed' && <p className="form-error" role="alert">{state.error}</p>}
    <div className="access-actions">
      {state.phase !== 'failed' && <button type="button" className="primary-button" onClick={() => void confirm()} disabled={state.phase === 'running'}>{state.phase === 'running' ? 'Writing…' : 'Confirm'}</button>}
      <button type="button" className="refresh-button" onClick={onClose} disabled={state.phase === 'running'}>{state.phase === 'failed' ? 'CLOSE' : 'CANCEL'}</button>
    </div>
  </Dialog>
}

export function NoteForm({ detail, onSaved, notice }: { detail: RowDetail; onSaved: (message: string) => void; notice?: string }) {
  const questions = detail.agentNotes.questions
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<ClaudePreview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const { write } = detail
  const filled = questions.some((question) => (answers[question.n] ?? '').trim()) || comment.trim().length > 0
  const total = noteLength(comment) + questions.reduce((sum, question) => sum + noteLength(answers[question.n] ?? ''), 0)
  const over = total > NOTE_LIMIT
  const start = async (action: ClaudeAction) => {
    setBusy(true)
    setError(undefined)
    const answer = await previewClaude(action, { board: detail.board.id, row: detail.card.row, key: detail.key, seen: detail.seen, answers: questions.map((question) => ({ n: question.n, text: answers[question.n] ?? '' })), comment, ...(action === 'claude.status' ? { status } : {}) })
    setBusy(false)
    if (!answer.ok) { setError(answer.error); return }
    setPreview(answer.data)
  }
  if (!write.allowed) return <section className="claude-section"><h3>Your answer</h3><WritesOff reason={write.reason}/></section>
  return <section className="claude-section claude-form">
    <h3>Your answer</h3>
    {notice && <p className="notice">{notice}</p>}
    {write.comments && questions.map((question) => <div key={question.n} className="claude-answer">
      <label className="field-label" htmlFor={`claude-q${question.n}`}>Q{question.n}: {question.text}</label>
      <textarea id={`claude-q${question.n}`} rows={2} value={answers[question.n] ?? ''} onChange={(event) => setAnswers({ ...answers, [question.n]: event.target.value })}/>
      <span className="claude-quick"><button type="button" className="refresh-button" onClick={() => setAnswers({ ...answers, [question.n]: 'Yes' })}>Yes</button>{question.recommend && <button type="button" className="refresh-button" onClick={() => setAnswers({ ...answers, [question.n]: `Yes, use your recommendation: ${question.recommend}` })}>Use your recommendation</button>}</span>
    </div>)}
    {write.comments && <>
      <label className="field-label" htmlFor="claude-comment">Comment <small className="muted">(each line becomes a bullet; appended under “{detail.ownerName} (date):”, never replacing what is there)</small></label>
      <textarea id="claude-comment" rows={4} value={comment} onChange={(event) => setComment(event.target.value)} aria-describedby="claude-comment-count"/>
      <CharCount id="claude-comment-count" value={comment}/>
      {questions.length > 0 && over && <p className="form-error">Comment and answers together are {total.toLocaleString('en-US')} characters; at most {NOTE_LIMIT.toLocaleString('en-US')}.</p>}
    </>}
    {write.statuses.length > 0 && <label className="field-label">Set status
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">(keep “{detail.card.status}”)</option>{write.statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </label>}
    <div className="access-actions">
      {write.comments && <button type="button" className="refresh-button" disabled={busy || !filled || over} onClick={() => void start('claude.note')}>Save comment only</button>}
      {write.statuses.length > 0 && <button type="button" className="primary-button" disabled={busy || !status || over} onClick={() => void start('claude.status')}>{busy ? 'Checking…' : `Save + set status${status ? ` to “${status}”` : ''}`}</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <ClaudeConfirm preview={preview} onClose={() => setPreview(undefined)} onDone={(result) => { if (result.ok) { setPreview(undefined); setAnswers({}); setComment(''); setStatus(''); onSaved(resultMessage(result)) } }}/>}
  </section>
}
