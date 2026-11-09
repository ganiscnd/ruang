// custom: reading the long text cells of a Claude board for display. Nothing is ever written back
// from here; older free-form text is only split into bullets on screen.

export interface Question { n: number; text: string; recommend?: string }
export interface AgentNotes { format: 'sections' | 'paragraphs' | 'empty'; done: string[]; check: string[]; questions: Question[]; other: string[] }

const SECTION = /^(done|check|questions)\s*:\s*(.*)$/i
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/
const QUESTION = /^Q(\d{1,2})\s*[:.)]\s*(.+)$/i
const RECOMMEND = /\s*\((?:recommend(?:ed|ation)?|rec)\s*:\s*([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/i

/** One bullet per sentence; abbreviations and versions (v1.2, e.g.) do not split. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9("'“])/).map((part) => part.trim()).filter(Boolean)
}

function question(text: string, fallback: number): Question {
  const match = QUESTION.exec(text)
  const body = match ? match[2] : text
  const recommend = RECOMMEND.exec(body)
  return { n: match ? Number(match[1]) : fallback, text: recommend ? body.slice(0, recommend.index).trim() : body.trim(), ...(recommend ? { recommend: recommend[1].trim() } : {}) }
}

/**
 * The agents' note format (from 2026-11-09): `Done:` / `Check:` / `Questions:` sections with
 * `- ` bullets, questions as `- Q1: … (recommend: …)`. Older notes are paragraphs: one bullet
 * per sentence, display only.
 */
export function parseAgentNotes(value: string): AgentNotes {
  const text = value.replace(/\r\n?/g, '\n').trim()
  const notes: AgentNotes = { format: 'empty', done: [], check: [], questions: [], other: [] }
  if (!text) return notes
  const lines = text.split('\n')
  if (!lines.some((line) => SECTION.test(line.trim()))) {
    notes.format = 'paragraphs'
    notes.other = lines.flatMap((line) => sentences(line.replace(BULLET, '')))
    return notes
  }
  notes.format = 'sections'
  let current = 'other' as 'done' | 'check' | 'questions' | 'other'
  const add = (item: string) => {
    if (!item) return
    if (current === 'questions') notes.questions.push(question(item, notes.questions.length + 1))
    else notes[current].push(item)
  }
  for (const raw of lines) {
    const line = raw.trim()
    const section = SECTION.exec(line)
    if (section) { current = section[1].toLowerCase() as typeof current; add(section[2].trim()); continue }
    if (!line) continue
    if (BULLET.test(line)) add(line.replace(BULLET, '').trim())
    else if (current === 'questions' && notes.questions.length && !QUESTION.test(line)) notes.questions.at(-1)!.text += ` ${line}`
    else if (current !== 'questions' && notes[current].length) notes[current][notes[current].length - 1] += ` ${line}`
    else add(line)
  }
  return notes
}

export interface NoteBlock { date?: string; heading?: string; lines: string[] }

/** A block starts at a heading line with a date in brackets, ending in a colon: "Owner (2026-11-09):", "Feedback (2026-11-06) – about the plan:". */
const BLOCK_HEAD = /^(?![-*•]\s)(.{0,60}?)\((\d{4}-\d{2}-\d{2})\)(.{0,80}):$/

/** The owner's notes as dated blocks, newest first; text before the first dated line is one undated block at the end. */
export function parseOwnerNotes(value: string): NoteBlock[] {
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const blocks: NoteBlock[] = []
  let current: NoteBlock = { lines: [] }
  for (const line of text.split('\n')) {
    const head = BLOCK_HEAD.exec(line.trim())
    if (head && line.trim().length <= 140) {
      if (current.lines.length || current.date) blocks.push(current)
      current = { date: head[2], heading: line.trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  blocks.push(current)
  const trimmed = blocks.map((block) => ({ ...block, lines: trimBlank(block.lines) })).filter((block) => block.date || block.lines.length)
  const dated = trimmed.filter((block) => block.date).map((block, index) => ({ block, index })).sort((a, b) => b.block.date!.localeCompare(a.block.date!) || b.index - a.index).map((item) => item.block)
  return [...dated, ...trimmed.filter((block) => !block.date)]
}

function trimBlank(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return lines.slice(start, end)
}

export interface OutputLine { text: string; paths: string[] }

const FILE_NAME = /^[^\s/()]+\.[A-Za-z0-9]{1,6}$/

/**
 * One output line: the leading path (folder names may contain spaces), plus file names listed in
 * brackets after a folder ("dir/ (a.py, b.md)") or as extra siblings ("x.md (+ y.py, z.py)").
 * Lines that are only a remark in brackets carry no path. The full text is always shown.
 */
export function parseOutputLine(line: string): OutputLine {
  const text = line.trim()
  if (!text || text.startsWith('(')) return { text, paths: [] }
  const lead = /^(.+?)(?=\s+\(|,\s|\s+-\s|$)/.exec(text)?.[1]?.trim() ?? text
  if (!lead.includes('/') && !FILE_NAME.test(lead)) return { text, paths: [] }
  const paths = [lead]
  const listed = /\((\+\s*)?([^()]*)\)/.exec(text.slice(lead.length))
  if (listed) {
    const folder = lead.endsWith('/') ? lead : lead.slice(0, lead.lastIndexOf('/') + 1)
    if (lead.endsWith('/') || listed[1]) {
      for (const name of listed[2].split(',').map((part) => part.trim())) if (FILE_NAME.test(name)) paths.push(`${folder}${name}`)
    }
  }
  return { text, paths }
}

/** Output paths are relative to the board's files root; a leading "<root>/" is dropped. */
export function relativeToRoot(value: string, root: string): string {
  const clean = value.replace(/\\/g, '/').replace(/^\.?\//, '')
  return clean.startsWith(`${root}/`) ? clean.slice(root.length + 1) : clean
}

export const parseOutput = (value: string) => value.replace(/\r\n?/g, '\n').split('\n').map(parseOutputLine).filter((line) => line.text)
