// custom: the task-flow logic of a Product Board: which tasks wait on which, what the owner should
// handle first (and why), the order each agent picks its work in, and the longest chain still
// open. Pure functions over the board's rows; the rules are the brief's (docs/plans/feature-claude-teams.md 6.2, 6.3).
import { cellOf, knownStatuses, statusKey, TASKFLOW, type BoardRead } from './board.js'
import type { BoardConfig } from './config.js'
import type { NextRun } from './schedule.js'

export type FlowColumn = 'needs' | 'queue' | 'working' | 'waiting' | 'done' | 'other'
export interface Task { id: string; row: number; owner: string; status: string; deps: string[]; updated: string }
export interface Relations { column: FlowColumn; dependsOn: string[]; unknownDeps: string[]; waitsFor: string[]; unlocks: string[]; stuck: boolean }
export interface NeedsItem { rank: number; id: string; row: number; status: string; unblocksNow: string[]; unblocksAll: string[]; reason: string }
export interface Queue { agent: string; order: string[]; nextRun?: NextRun }
export interface Flow { needs: NeedsItem[]; queues: Queue[]; chain: string[]; relations: Record<number, Relations>; warnings: string[] }

const TASK_ID = /^[A-Za-z]{1,4}\d{1,4}$/
/** "T12" → 12, so T9 sorts before T10. */
const idNumber = (id: string) => Number(/\d+/.exec(id)?.[0] ?? Number.MAX_SAFE_INTEGER)
export const byId = (a: string, b: string) => idNumber(a) - idNumber(b) || a.localeCompare(b)

/** "T03, T04" / "T03,T04" / "T03 T04" → ["T03", "T04"]; "-" or "none" → []. */
export function parseDeps(value: string): string[] {
  return [...new Set(value.split(/[,;\s]+/).map((part) => part.trim().toUpperCase()).filter((part) => part && !/^(-|—|none|n\/a)$/i.test(part)))]
}

export function tasksOf(read: BoardRead): Task[] {
  const known = knownStatuses(read.board)
  return read.rows.flatMap((row) => {
    const id = cellOf(read.board, row, 'id').toUpperCase()
    return id ? [{ id, row: row.row, owner: cellOf(read.board, row, 'owner'), status: statusKey(cellOf(read.board, row, 'status'), known), deps: parseDeps(cellOf(read.board, row, 'dependsOn')), updated: cellOf(read.board, row, 'updated') }] : []
  })
}

function columnOf(status: string, board: Pick<BoardConfig, 'needsYou' | 'unlockStatuses'>): FlowColumn {
  if (board.needsYou?.status.some((item) => item.toLowerCase() === status)) return 'needs'
  if ((TASKFLOW.queued as readonly string[]).includes(status)) return 'queue'
  if (status === TASKFLOW.working) return 'working'
  if (status === TASKFLOW.waiting) return 'waiting'
  if (board.unlockStatuses.some((item) => item.toLowerCase() === status) || status === 'rejected') return 'done'
  return 'other'
}

/** The order an agent picks its tasks: changes requested first, then ready; lowest ID first; one per run. */
export function queueOrder(tasks: readonly Pick<Task, 'id' | 'status'>[]): string[] {
  const rank = (status: string) => (TASKFLOW.queued as readonly string[]).indexOf(status)
  return tasks.filter((task) => rank(task.status) >= 0).sort((a, b) => rank(a.status) - rank(b.status) || byId(a.id, b.id)).map((task) => task.id)
}

const list = (ids: readonly string[]) => (ids.length <= 3 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more`)

export function computeFlow(read: BoardRead, options: { today: string; runs?: ReadonlyMap<string, NextRun> }): Flow {
  const { board } = read
  const tasks = tasksOf(read)
  const byKey = new Map(tasks.map((task) => [task.id, task]))
  const warnings: string[] = []
  const duplicates = tasks.filter((task, index) => tasks.findIndex((other) => other.id === task.id) !== index)
  if (duplicates.length) warnings.push(`The ID ${[...new Set(duplicates.map((task) => task.id))].join(', ')} is used on more than one row; only the first row counts in the order.`)
  const unlocked = new Set(board.unlockStatuses.map((status) => status.toLowerCase()))
  const finished = (task: Task) => unlocked.has(task.status) || task.status === 'rejected'
  const dependents = new Map<string, string[]>()
  for (const task of byKey.values()) for (const dep of task.deps) dependents.set(dep, [...(dependents.get(dep) ?? []), task.id])
  // A dependency is still missing until its task is approved/done; an unknown ID never resolves.
  const missing = (task: Task) => task.deps.filter((dep) => !byKey.has(dep) || !unlocked.has(byKey.get(dep)!.status))
  const unknown = (task: Task) => task.deps.filter((dep) => !byKey.has(dep) || !TASK_ID.test(dep))
  for (const task of byKey.values()) {
    const bad = unknown(task)
    if (bad.length) warnings.push(`${task.id} depends on ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} not on this board.`)
  }
  const downstream = (id: string): string[] => {
    const seen = new Set<string>()
    const walk = (from: string) => { for (const next of dependents.get(from) ?? []) if (!seen.has(next) && next !== id) { seen.add(next); walk(next) } }
    walk(id)
    return [...seen].filter((other) => !finished(byKey.get(other)!)).sort(byId)
  }
  const queues = new Map<string, Task[]>()
  for (const task of byKey.values()) if (task.owner) queues.set(task.owner, [...(queues.get(task.owner) ?? []), task])
  const runLabel = (agent: string) => { const run = options.runs?.get(agent); return run ? ` (${run.label}${run.macOff ? ', Mac off at that time' : ''})` : '' }
  /** Where `id` would land in its owner's queue once it is set to `status`. */
  const positionAfter = (task: Task, status: string) => queueOrder((queues.get(task.owner) ?? []).map((other) => (other.id === task.id ? { id: other.id, status } : other))).indexOf(task.id) + 1
  const pickLine = (task: Task) => {
    if (!task.owner) return `${task.id} becomes ready (no owner set)`
    const position = positionAfter(task, 'ready')
    return position === 1 ? `${task.id} becomes ready; ${task.owner} picks it at its next run${runLabel(task.owner)}` : `${task.id} becomes ready; ${task.owner} queue position ${position}${runLabel(task.owner)}`
  }

  /** Why approving `task` makes none of its direct dependents ready: what each still waits for. */
  const stillWaiting = (task: Task) => {
    const open = (dependents.get(task.id) ?? []).map((id) => byKey.get(id)!).filter((other) => !finished(other)).sort((a, b) => byId(a.id, b.id))
    const needsYou = open.filter((other) => !(other.status === TASKFLOW.waiting))
    const waiting = open.filter((other) => other.status === TASKFLOW.waiting).map((other) => `${other.id} also waits for ${list(missing(other).filter((dep) => dep !== task.id))}`)
    return [...waiting, ...(needsYou.length ? [`${list(needsYou.map((other) => other.id))} ${needsYou.length === 1 ? 'is' : 'are'} ${[...new Set(needsYou.map((other) => other.status))].join('/')}`] : [])]
  }
  const order = board.needsYou?.status.map((status) => status.toLowerCase()) ?? []
  const items = [...byKey.values()].filter((task) => order.includes(task.status)).map((task) => {
    const unblocksNow = (dependents.get(task.id) ?? []).map((id) => byKey.get(id)!).filter((other) => other.status === TASKFLOW.waiting && missing(other).length === 1 && missing(other)[0] === task.id).map((other) => other.id).sort(byId)
    return { task, unblocksNow, unblocksAll: downstream(task.id) }
  }).sort((a, b) => b.unblocksNow.length - a.unblocksNow.length || b.unblocksAll.length - a.unblocksAll.length || order.indexOf(a.task.status) - order.indexOf(b.task.status) || byId(a.task.id, b.task.id))

  const needs = items.map(({ task, unblocksNow, unblocksAll }, index): NeedsItem => {
    const later = unblocksAll.filter((id) => !unblocksNow.includes(id))
    const tail = later.length ? ` Later unlocks ${list(later)}.` : ''
    let reason: string
    if (task.status === TASKFLOW.review) {
      reason = unblocksNow.length ? `Approve → ${unblocksNow.map((id) => pickLine(byKey.get(id)!)).join('; ')}.${tail}`
        : unblocksAll.length ? `Approve → nothing becomes ready yet: ${stillWaiting(task).join('; ')}. Unlocks ${list(unblocksAll)} in the end.`
          : 'Nothing waits for this; review when you have time.'
    } else {
      const verb = task.status === 'blocked' ? 'Unblock (set ready)' : 'Set ready'
      const position = task.owner ? positionAfter(task, 'ready') : 0
      const open = missing(task).map((dep) => `${dep} (${byKey.get(dep)?.status || 'not on this board'})`)
      reason = `${verb} → ${task.owner ? `${task.owner} queue position ${position}${runLabel(task.owner)}` : 'no owner set'}.${open.length ? ` It depends on ${open.join(', ')}, not approved yet.` : ''}${unblocksAll.length ? ` Unlocks ${list(unblocksAll)} once done.` : ' Nothing waits for this.'}`
    }
    return { rank: index + 1, id: task.id, row: task.row, status: task.status, unblocksNow, unblocksAll, reason }
  })

  // Longest chain of open tasks (by dependency); ties go to the chain that starts with the
  // owner's highest-ranked item, then to lower IDs. Cycles are reported, not followed.
  const open = [...byKey.values()].filter((task) => !finished(task))
  const openIds = new Set(open.map((task) => task.id))
  const memo = new Map<string, string[]>()
  const visiting = new Set<string>()
  let cycle = false
  const longest = (id: string): string[] => {
    if (memo.has(id)) return memo.get(id)!
    if (visiting.has(id)) { cycle = true; return [id] }
    visiting.add(id)
    const next = (dependents.get(id) ?? []).filter((other) => openIds.has(other)).sort(byId).map(longest).reduce<string[]>((best, path) => (path.length > best.length ? path : best), [])
    visiting.delete(id)
    const path = [id, ...next]
    memo.set(id, path)
    return path
  }
  const rankOf = (id: string) => { const at = needs.findIndex((item) => item.id === id); return at < 0 ? needs.length : at }
  const starts = open.filter((task) => !task.deps.some((dep) => openIds.has(dep))).sort((a, b) => rankOf(a.id) - rankOf(b.id) || byId(a.id, b.id))
  const chain = starts.map((task) => longest(task.id)).reduce<string[]>((best, path) => (path.length > best.length ? path : best), [])
  // Tasks in a circle have no start; walking every open task finds them.
  for (const task of open) longest(task.id)
  if (cycle) warnings.push('Some tasks depend on each other in a circle; check Depends on.')

  const relations = Object.fromEntries(tasks.map((task) => [task.row, {
    column: columnOf(task.status, board),
    dependsOn: task.deps,
    unknownDeps: unknown(task),
    waitsFor: finished(task) ? [] : missing(task),
    unlocks: (dependents.get(task.id) ?? []).filter((id) => !finished(byKey.get(id)!)).sort(byId),
    // In progress but last updated before today (Updated is text YYYY-MM-DD on these boards).
    stuck: task.status === TASKFLOW.working && Boolean(task.updated) && task.updated < options.today,
  } satisfies Relations]))
  const agents = [...queues.keys()].sort()
  return {
    needs,
    queues: agents.map((agent) => ({ agent, order: queueOrder(queues.get(agent)!), ...(options.runs?.get(agent) ? { nextRun: options.runs.get(agent)! } : {}) })),
    chain: chain.length > 1 ? chain : [],
    relations,
    warnings,
  }
}
