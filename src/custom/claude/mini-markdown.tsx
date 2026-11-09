// custom: a small Markdown renderer for agent output files. It builds React elements directly
// (never HTML strings), so a file can never run code in the page. Covers headings, lists, quotes,
// code blocks, bold, italic, inline code and links (http/https only).
import type { ReactNode } from 'react'

function inline(text: string, key: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    const id = `${key}-${index++}`
    if (match[1]) parts.push(<code key={id}>{token.slice(1, -1)}</code>)
    else if (match[2]) parts.push(<strong key={id}>{inline(token.slice(2, -2), id)}</strong>)
    else if (match[3]) parts.push(<em key={id}>{inline(token.slice(1, -1), id)}</em>)
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!
      parts.push(/^https?:\/\//i.test(url) ? <a key={id} href={url} target="_blank" rel="noreferrer noopener">{label}</a> : <span key={id}>{label} ({url})</span>)
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const key = `b${index}`
    if (/^```/.test(line)) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) body.push(lines[index++])
      index += 1
      blocks.push(<pre key={key}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1].length + 2)
      const Tag = `h${level}` as 'h3'
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>)
      index += 1
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        items.push(<li key={index} className={/^\s{2,}/.test(lines[index]) ? 'nested' : undefined}>{inline(item.replace(/^\[( |x)\]\s+/i, (box) => (box.toLowerCase().includes('x') ? '☑ ' : '☐ ')), `${key}-${index}`)}</li>)
        index += 1
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>)
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key}>{inline(quote.join(' '), key)}</blockquote>)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={key}/>); index += 1; continue }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = []
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index])) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[index])) rows.push(lines[index].trim().slice(1, -1).split('|').map((cell) => cell.trim()))
        index += 1
      }
      blocks.push(<div key={key} className="table-scroll"><table className="claude-table"><tbody>{rows.map((cells, at) => <tr key={at}>{cells.map((cell, column) => (at === 0 ? <th key={column}>{inline(cell, `${key}-${at}-${column}`)}</th> : <td key={column}>{inline(cell, `${key}-${at}-${column}`)}</td>))}</tr>)}</tbody></table></div>)
      continue
    }
    if (!line.trim()) { index += 1; continue }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|)/.test(lines[index])) paragraph.push(lines[index++])
    blocks.push(<p key={key}>{inline(paragraph.join(' '), key)}</p>)
  }
  return <div className="mini-markdown">{blocks}</div>
}
