import { useEffect, useRef, useState } from 'react'
import { formatTime } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { CommandLogSnapshot, LogLevel, LogsSnapshot } from '../types.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput, SourceStatus } from '../ui.tsx'

const LEVELS: ('ALL' | LogLevel)[] = ['ALL', 'ERROR', 'WARNING', 'INFO', 'DEBUG']
const MISSION_CONTROL = 'mission-control'

export function Logs() {
  const [follow, setFollow] = useState(true)
  const logs = usePolling<LogsSnapshot>('/api/logs', follow ? 5_000 : 0)
  const commands = usePolling<CommandLogSnapshot>('/api/command-log', follow ? 5_000 : 0)
  const [tab, setTab] = useState('agent')
  const [level, setLevel] = useState<'ALL' | LogLevel>('ALL')
  const [query, setQuery] = useState('')
  const viewer = useRef<HTMLPreElement>(null)
  const data = logs.status === 'ready' ? logs.data : undefined
  const file = data?.files.find((item) => item.name === tab)
  const needle = query.trim().toLowerCase()
  const lines = (file?.source.data ?? []).filter((line) => (level === 'ALL' || line.level === level) && (!needle || line.text.toLowerCase().includes(needle)))
  const commandData = commands.status === 'ready' ? commands.data : undefined

  useEffect(() => {
    if (follow && viewer.current) viewer.current.scrollTop = viewer.current.scrollHeight
  }, [follow, lines.length, tab])

  const tabs = [...(data?.files.map((item) => ({ name: item.name, label: item.label, count: item.source.data.filter((line) => line.level === 'ERROR').length })) ?? []), { name: MISSION_CONTROL, label: 'Command audit', count: commandData?.health.failed ?? 0 }]
  return <><PageTitle eyebrow="HERMES LOGS" title="Logs">Tail of <code>hermes logs</code> (agent, gateway, errors) with secrets redacted, plus the server's own audit of every read command it ran.</PageTitle>
    {tab === MISSION_CONTROL ? <SourceStatus source={commandData ? { availability: 'available', data: null } : undefined} fetchedAt={commandData?.fetchedAt} request={commands}/> : <SourceStatus source={file?.source} fetchedAt={data?.fetchedAt} request={logs}/>}
    <div className="room-tabs log-tabs" role="tablist" aria-label="Log files">{tabs.map((item) => <button key={item.name} role="tab" aria-selected={tab === item.name} className={tab === item.name ? 'active' : ''} onClick={() => setTab(item.name)}>{item.label}{item.count > 0 && <span className="room-count error-count">{item.count}</span>}</button>)}</div>
    {tab === MISSION_CONTROL ? (commands.status === 'pending' ? <LoadingState message="Reading command audit..."/> : !commandData ? <EmptyState title="Not Available">The Ruang API could not be reached.</EmptyState> : <>
      <p className="card-note">{commandData.health.total} reads recorded · {commandData.health.failed} failed · {commandData.health.averageMs} ms average. Only fixed, read-only commands are ever executed.</p>
      {commandData.entries.length === 0 ? <EmptyState title="No reads yet">Commands appear here as pages load data.</EmptyState> : <table className="log-table"><thead><tr><th>Time</th><th>Command</th><th>Result</th><th>Duration</th></tr></thead><tbody>{commandData.entries.map((entry, index) => <tr key={`${entry.at}-${index}`}><td>{formatTime(entry.at)}</td><td>{entry.write && <span className="chip chip-priority" title="Write action (confirmed in the UI)">WRITE</span>} <code>{entry.command}</code></td><td>{entry.ok ? <span className="badge good">ok</span> : <span className="badge bad" title={entry.error}>{entry.error ?? 'failed'}</span>}</td><td>{entry.durationMs} ms</td></tr>)}</tbody></table>}
    </>) : logs.status === 'pending' ? <LoadingState message="Reading Hermes logs..."/> : !file ? <EmptyState title="Not Available">The Ruang API could not be reached.</EmptyState> : file.source.availability === 'unavailable' ? <EmptyState title="Not Available">{file.source.error?.message ?? 'hermes logs could not be read.'}</EmptyState> : <>
      <div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Filter log lines"/><label className="select-label">Level <select value={level} onChange={(event) => setLevel(event.target.value as 'ALL' | LogLevel)}>{LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)}/> Follow (5s)</label><span className="toolbar-count">{lines.length} of {file.source.data.length} lines</span></div>
      {file.source.data.length === 0 ? <EmptyState title="Log is empty">Hermes has not written to the {file.label.toLowerCase()} log yet.</EmptyState> : <pre className="log-viewer" ref={viewer} tabIndex={0} aria-label={`${file.label} log`}>{lines.map((line, index) => <span key={index} className={`log-line level-${line.level.toLowerCase()}`}>{line.text}{'\n'}</span>)}</pre>}
    </>}
  </>
}
