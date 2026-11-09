// custom: when a Claude scheduled task runs next, from the schedule text in the config. Only the
// forms used there are understood; anything else is "Unknown schedule", never a guess.
//   daily 05:30            daily 07:00, 19:00            hourly at :05, 08:00-21:00
// Tasks that run on the Mac (runsOnMac) only run while it is on: it boots at 05:30 and shuts
// down at 22:55 every day (CLAUDE.md, power schedule), so a run outside that window is flagged.

export const MAC_POWER_WINDOW = { from: 5 * 60 + 30, to: 22 * 60 + 55 }

export interface NextRun {
  /** ISO time of the next run; absent when it cannot be known. */
  at?: string
  /** "10:00 WIB", "Tomorrow 05:30 WIB", "Paused", "Unknown schedule". */
  label: string
  macOff?: boolean
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Minutes after midnight of every run in one day, or undefined for an unknown form. */
export function runTimes(schedule: string): number[] | undefined {
  const text = schedule.trim().toLowerCase()
  const daily = /^daily\s+(.+)$/.exec(text)
  if (daily) {
    const times = daily[1].split(',').map((part) => TIME.exec(part.trim()))
    if (times.some((match) => !match)) return undefined
    return [...new Set(times.map((match) => Number(match![1]) * 60 + Number(match![2])))].sort((a, b) => a - b)
  }
  const hourly = /^hourly at :([0-5]\d),\s*([0-2]\d:[0-5]\d)\s*-\s*([0-2]\d:[0-5]\d)$/.exec(text)
  if (hourly) {
    const [from, to] = [hourly[2], hourly[3]].map((value) => TIME.exec(value))
    if (!from || !to) return undefined
    const start = Number(from[1]) * 60 + Number(from[2])
    const end = Number(to[1]) * 60 + Number(to[2])
    const times: number[] = []
    for (let hour = 0; hour < 24; hour += 1) {
      const minute = hour * 60 + Number(hourly[1])
      if (minute >= start && minute <= end) times.push(minute)
    }
    return times.length ? times : undefined
  }
  return undefined
}

const parts = (time: number, timeZone: string) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(time).map((part) => [part.type, part.value]))

/** The calendar date ("2026-11-09") in the given time zone. */
export function localDate(time: number, timeZone: string): string {
  const { year, month, day } = parts(time, timeZone)
  return `${year}-${month}-${day}`
}

function offsetMs(time: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = parts(time, timeZone)
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - Math.floor(time / 1000) * 1000
}

/** The instant of a wall-clock time on a date in the given time zone. */
function zoned(date: string, minutes: number, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60)
  const first = guess - offsetMs(guess, timeZone)
  return guess - offsetMs(first, timeZone)
}

export function zoneName(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone, timeZoneName: 'short' }).formatToParts(time).find((part) => part.type === 'timeZoneName')?.value ?? timeZone
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function nextRun(agent: { schedule: string; runsOnMac: boolean }, paused: boolean, now: number, timeZone: string): NextRun {
  if (paused) return { label: 'Paused' }
  const times = runTimes(agent.schedule)
  if (!times) return { label: 'Unknown schedule' }
  const today = localDate(now, timeZone)
  const tomorrow = localDate(zoned(today, 12 * 60, timeZone) + 86_400_000, timeZone)
  for (const [date, prefix] of [[today, ''], [tomorrow, 'Tomorrow ']] as const) {
    const minute = times.find((time) => zoned(date, time, timeZone) > now)
    if (minute === undefined) continue
    const at = zoned(date, minute, timeZone)
    const macOff = agent.runsOnMac && (minute < MAC_POWER_WINDOW.from || minute > MAC_POWER_WINDOW.to)
    return { at: new Date(at).toISOString(), label: `${prefix}${hhmm(minute)} ${zoneName(at, timeZone)}`, ...(macOff ? { macOff } : {}) }
  }
  return { label: 'Unknown schedule' }
}
