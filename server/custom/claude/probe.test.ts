import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBoard } from './board.js'
import { findBoard, parseClaudeConfig } from './config.js'
import { exampleConfig } from './example.fixture.js'
import { cachedProbe, probeFolder, withTimeout, type ProbeResult } from './probe.js'
import type { SheetsApi } from './sheets.js'
import { filesHealth } from './teams.js'

const config = parseClaudeConfig(exampleConfig())
const drafts = findBoard(config, 'example-drafts')!

describe('folder probe (child process)', () => {
  it('lists a readable folder and reports a missing one', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'ruang-probe-'))
    await writeFile(path.join(folder, 'a.md'), 'x')
    await writeFile(path.join(folder, 'b.md'), 'y')
    expect(await probeFolder(folder)).toEqual({ ok: true, entries: 2 })
    expect(await probeFolder(path.join(folder, 'missing'))).toEqual({ ok: false, code: 'ENOENT' })
    // A path is an argv entry, never script text.
    expect(await probeFolder("x'); process.exit(3); ('")).toEqual({ ok: false, code: 'ENOENT' })
  })

  it('runs one probe per folder at a time and remembers the result', async () => {
    let now = 0
    let calls = 0
    let release: (result: ProbeResult) => void = () => {}
    const probe = cachedProbe(() => { calls += 1; return new Promise((resolve) => { release = resolve }) }, 300_000, () => now)
    const first = probe('/held')
    const second = probe('/held')
    expect(calls).toBe(1)
    release({ ok: false, code: 'TIMEOUT' })
    expect(await first).toEqual(await second)
    now += 200_000
    await probe('/held')
    expect(calls).toBe(1)
    now += 200_000
    void probe('/held')
    expect(calls).toBe(2)
  })

  it('explains a folder that macOS holds or refuses, as Not Available', async () => {
    const withIcloud = { icloudRoot: '/example-icloud' }
    expect(await filesHealth(withIcloud, drafts, async () => ({ ok: false, code: 'TIMEOUT' }))).toMatchObject({ status: 'blocked', message: expect.stringMatching(/^Not Available: macOS held Ruang's access to the iCloud folder for more than 5 seconds/) })
    expect(await filesHealth(withIcloud, drafts, async () => ({ ok: false, code: 'EPERM' }))).toMatchObject({ status: 'denied' })
    expect(await filesHealth(withIcloud, drafts, async () => ({ ok: true, entries: 4 }))).toMatchObject({ status: 'readable' })
  })
})

describe('time limits', () => {
  it('turns a Sheets read that never answers into an unavailable board', async () => {
    const hanging: SheetsApi = { batchGet: () => new Promise(() => {}) }
    expect(await readBoard(drafts, hanging, Date.now(), 30)).toMatchObject({ availability: 'unavailable', reason: 'Google Sheets did not answer within 0 seconds.', rows: [] })
  })

  it('rejects after the deadline and passes results through before it', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, () => new Error('late'))).rejects.toThrow('late')
    expect(await withTimeout(Promise.resolve(1), 10, () => new Error('late'))).toBe(1)
  })
})
