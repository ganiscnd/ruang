// custom: shows one output file or folder of a Claude board (read-only, through the server).
import { useEffect, useState } from 'react'
import { formatBytes } from '../../format.ts'
import { MiniMarkdown } from './mini-markdown.tsx'
import type { FileView } from './types.ts'

const api = (board: string, kind: 'files' | 'raw', file: string) => `/api/custom/claude/boards/${encodeURIComponent(board)}/${kind}?path=${encodeURIComponent(file)}`

export function FileViewer({ board, path, onOpen, onClose }: { board: string; path: string; onOpen: (path: string) => void; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'pending' } | { status: 'ready'; view: FileView } | { status: 'failed'; message: string }>({ status: 'pending' })
  useEffect(() => {
    let active = true
    setState({ status: 'pending' })
    fetch(api(board, 'files', path)).then(async (response) => {
      const body = await response.json().catch(() => undefined) as FileView & { error?: string } | undefined
      if (!active) return
      setState(response.ok && body ? { status: 'ready', view: body } : { status: 'failed', message: body?.error ?? `The file could not be loaded (HTTP ${response.status}).` })
    }, () => { if (active) setState({ status: 'failed', message: 'The Ruang API could not be reached.' }) })
    return () => { active = false }
  }, [board, path])
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return <section className="claude-file" aria-label={`File ${path || 'output folder'}`}>
    <header><code>{path || 'Output folder'}</code><span>{path && <button type="button" className="link-button" onClick={() => onOpen(parent)}>↑ Folder</button>}<button type="button" className="link-button" onClick={onClose}>Close file</button></span></header>
    {state.status === 'pending' && <p className="muted">Loading…</p>}
    {state.status === 'failed' && <p className="form-error" role="alert">{state.message}</p>}
    {state.status === 'ready' && <FileBody board={board} view={state.view} onOpen={onOpen}/>}
  </section>
}

function FileBody({ board, view, onOpen }: { board: string; view: FileView; onOpen: (path: string) => void }) {
  switch (view.kind) {
    case 'dir': return <ul className="claude-file-list">{view.entries.length ? view.entries.map((entry) => <li key={entry.path}><button type="button" className="link-button" onClick={() => onOpen(entry.path)}>{entry.type === 'dir' ? '📁' : '📄'} {entry.name}</button>{entry.type === 'file' && <small>{formatBytes(entry.size)}</small>}</li>) : <li className="muted">Empty folder.</li>}{view.truncated && <li className="muted">More entries not shown.</li>}</ul>
    case 'text': return <>
      {view.truncated && <p className="notice">Only the first 256 KB of this {formatBytes(view.size)} file is shown.</p>}
      {view.redactions > 0 && <p className="notice">{view.redactions} line{view.redactions === 1 ? '' : 's'} had secrets hidden.</p>}
      {view.ext === 'md' ? <MiniMarkdown text={view.content}/> : <pre className="claude-file-text">{view.content}</pre>}
    </>
    case 'inline': return view.ext === 'pdf'
      ? <><iframe className="claude-file-pdf" src={api(board, 'raw', view.path)} title={view.path}/><a href={api(board, 'raw', view.path)} target="_blank" rel="noreferrer">Open PDF in a new tab</a></>
      : <img className="claude-file-image" src={api(board, 'raw', view.path)} alt={view.path}/>
    case 'download': return <p><a className="primary-button" href={api(board, 'raw', view.path)} download>Download .{view.ext} ({formatBytes(view.size)})</a> <span className="muted">No preview for .{view.ext} files.</span></p>
    case 'other': return <p className="muted">No preview for .{view.ext || '(no extension)'} files ({formatBytes(view.size)}).</p>
  }
}
