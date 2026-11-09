// custom: file-system checks of iCloud folders, run in a short-lived child process. macOS privacy
// (TCC) can hold a read of ~/Library/Mobile Documents indefinitely (waiting for a permission prompt
// a background service cannot show). Such a call cannot be cancelled and would block one of Node's
// few file-system threads for good, so Ruang itself never touches those folders directly: the
// child does, under a hard time limit, and is killed when it does not answer.
import { execFile } from 'node:child_process'

export const PROBE_TIMEOUT_MS = 5_000

export type ProbeResult = { ok: true; entries: number } | { ok: false; code: string }

// Lists the folder given as the only argument and prints the outcome as JSON. No shell; the path
// is an argv entry, never part of the script.
const SCRIPT = `const fs = require('node:fs'); try { const entries = fs.readdirSync(process.argv[1]); process.stdout.write(JSON.stringify({ ok: true, entries: entries.length })) } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code || 'ERROR' })) }`

export type Probe = (folder: string) => Promise<ProbeResult>

export const probeFolder: Probe = (folder) => new Promise((resolve) => {
  execFile(process.execPath, ['-e', SCRIPT, folder], { timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 4096 }, (error, stdout) => {
    if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) { resolve({ ok: false, code: 'TIMEOUT' }); return }
    try {
      const parsed = JSON.parse(stdout) as ProbeResult
      resolve(parsed && typeof parsed.ok === 'boolean' ? parsed : { ok: false, code: 'ERROR' })
    } catch {
      resolve({ ok: false, code: error ? 'ERROR' : 'BAD_OUTPUT' })
    }
  })
})

/**
 * Remembers each folder's result for a while and runs at most one probe per folder at a time, so
 * a blocked folder costs one child process per `ttl`, not one per page refresh.
 */
export function cachedProbe(probe: Probe = probeFolder, ttl = 5 * 60_000, now = () => Date.now()): Probe {
  const results = new Map<string, { result: ProbeResult; expires: number }>()
  const running = new Map<string, Promise<ProbeResult>>()
  return (folder) => {
    const cached = results.get(folder)
    if (cached && cached.expires > now()) return Promise.resolve(cached.result)
    let pending = running.get(folder)
    if (!pending) {
      pending = probe(folder).then((result) => {
        // A readable folder is re-checked sooner, so a revoked permission shows within a minute.
        results.set(folder, { result, expires: now() + (result.ok ? Math.min(ttl, 60_000) : ttl) })
        return result
      }).finally(() => running.delete(folder))
      running.set(folder, pending)
    }
    return pending
  }
}

/** Rejects with `timeoutError()` when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeoutError()), ms) })]).finally(() => clearTimeout(timer))
}
