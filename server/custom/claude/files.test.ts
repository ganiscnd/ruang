import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileViewError, OutputFiles, safeOutputPath } from './files.js'

async function folder() {
  const base = await mkdtemp(path.join(tmpdir(), 'ruang-files-'))
  const root = path.join(base, 'Example Lab')
  await mkdir(path.join(root, '02_Plan'), { recursive: true })
  await writeFile(path.join(root, '02_Plan', 'plan.md'), '# Plan\n- step one\napi_key=sk-abcdefghijklmnopqrstuvwxyz123456\n')
  await writeFile(path.join(root, '02_Plan', 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(path.join(root, '02_Plan', 'sheet.xlsx'), 'xlsx')
  await writeFile(path.join(root, '02_Plan', 'page.html'), '<script>alert(1)</script>')
  await writeFile(path.join(root, '.hidden.md'), 'secret')
  await writeFile(path.join(root, '02_Plan', '.report.md.icloud'), '')
  await writeFile(path.join(base, 'outside.md'), 'outside')
  await symlink(path.join(base, 'outside.md'), path.join(root, '02_Plan', 'link.md'))
  return root
}

const error = async (promise: Promise<unknown>) => promise.then(() => undefined, (caught: unknown) => caught as FileViewError)

describe('output file viewer', () => {
  const files = new OutputFiles()

  it('lists one folder level without hidden files and shows text with secrets hidden', async () => {
    const root = await folder()
    const listing = await files.view(root, '')
    expect(listing).toMatchObject({ kind: 'dir', entries: [{ name: '02_Plan', type: 'dir' }] })
    const plan = await files.view(root, '02_Plan')
    expect(plan.kind === 'dir' && plan.entries.map((entry) => entry.name)).toEqual(['chart.png', 'link.md', 'page.html', 'plan.md', 'sheet.xlsx'])
    const text = await files.view(root, '02_Plan/plan.md')
    expect(text).toMatchObject({ kind: 'text', ext: 'md', truncated: false, redactions: 1 })
    expect(text.kind === 'text' && text.content).not.toContain('sk-abcdefghij')
  })

  it('serves images and PDFs inline, Office files as downloads, nothing else raw', async () => {
    const root = await folder()
    expect(await files.view(root, '02_Plan/chart.png')).toMatchObject({ kind: 'inline', mime: 'image/png', size: 4 })
    expect(await files.view(root, '02_Plan/sheet.xlsx')).toMatchObject({ kind: 'download' })
    expect(await files.view(root, '02_Plan/page.html')).toMatchObject({ kind: 'other' })
    expect((await files.raw(root, '02_Plan/chart.png')).data).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await error(files.raw(root, '02_Plan/page.html'))).toMatchObject({ status: 403 })
  })

  it('refuses paths out of the root, hidden files and symlinks leading out', async () => {
    const root = await folder()
    expect(() => safeOutputPath('../outside.md')).toThrow('escapes')
    expect(() => safeOutputPath('02_Plan/.env')).toThrow('Hidden')
    expect(() => safeOutputPath('a\u0000b')).toThrow('Invalid')
    expect(await error(files.view(root, '02_Plan/link.md'))).toMatchObject({ status: 403 })
    expect(await error(files.view(root, '.hidden.md'))).toMatchObject({ status: 403 })
  })

  it('says Not found for a missing file and "not downloaded" for an iCloud placeholder', async () => {
    const root = await folder()
    expect(await error(files.view(root, '02_Plan/missing.md'))).toMatchObject({ status: 404, message: 'Not found (02_Plan/missing.md).' })
    expect(await error(files.view(root, '02_Plan/report.md'))).toMatchObject({ status: 409, message: expect.stringMatching(/^File not downloaded on the Mac yet/) })
    expect(await files.states(root, ['02_Plan/plan.md', '02_Plan', '02_Plan/missing.md', '../x', '02_Plan/report.md'])).toEqual([
      { path: '02_Plan/plan.md', state: 'file' }, { path: '02_Plan', state: 'dir' }, { path: '02_Plan/missing.md', state: 'missing' }, { path: '../x', state: 'refused' }, { path: '02_Plan/report.md', state: 'not-downloaded' },
    ])
  })

  it('answers Not Available when the reader is held past its time limit', async () => {
    const held = new OutputFiles(async () => ({ state: 'timeout' }))
    expect(await error(held.view('/example', '02_Plan/plan.md'))).toMatchObject({ status: 503, message: expect.stringMatching(/^Not Available: macOS or iCloud did not answer in time/) })
    expect(await held.states('/example', ['a.md'])).toEqual([{ path: 'a.md', state: 'error' }])
  })
})
