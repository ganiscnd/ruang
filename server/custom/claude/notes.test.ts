import { describe, expect, it } from 'vitest'
import { parseAgentNotes, parseOutput, parseOutputLine, parseOwnerNotes, relativeToRoot, sentences } from './notes.js'

describe('agent notes', () => {
  it('parses the Done / Check / Questions format with Q items and recommendations', () => {
    const notes = parseAgentNotes('Done:\n- Wrote the example plan\n- Added tests\n  for edge cases\nCheck:\n- Is the naming ok?\nQuestions:\n- Q1: Use one sheet or two? (recommend: one sheet)\n- Q2: Ship today?\n')
    expect(notes).toEqual({
      format: 'sections',
      done: ['Wrote the example plan', 'Added tests for edge cases'],
      check: ['Is the naming ok?'],
      questions: [{ n: 1, text: 'Use one sheet or two?', recommend: 'one sheet' }, { n: 2, text: 'Ship today?' }],
      other: [],
    })
  })

  it('splits older paragraph notes into one bullet per sentence, keeping versions whole', () => {
    expect(parseAgentNotes('Built v1.2.3 of the example. Tests pass: 9/9.\nNext: review it.')).toMatchObject({ format: 'paragraphs', other: ['Built v1.2.3 of the example.', 'Tests pass: 9/9.', 'Next: review it.'] })
    expect(sentences('One. two stays. Three!')).toEqual(['One. two stays.', 'Three!'])
    expect(parseAgentNotes('  ').format).toBe('empty')
  })
})

describe('owner notes history', () => {
  it('splits dated blocks, newest first, undated text last', () => {
    const blocks = parseOwnerNotes('Early remark without a date.\n\nOwner (2026-11-06):\n- Q1: yes\n- keep it short\n\nFeedback (2026-11-08) – about the example:\n1. first\n- deadline 2026-11-20 stays\n')
    expect(blocks.map((block) => [block.date, block.lines])).toEqual([
      ['2026-11-08', ['1. first', '- deadline 2026-11-20 stays']],
      ['2026-11-06', ['- Q1: yes', '- keep it short']],
      [undefined, ['Early remark without a date.']],
    ])
    expect(parseOwnerNotes('')).toEqual([])
  })
})

describe('output paths', () => {
  it('links the leading path, folder contents and extra siblings; remarks carry no path', () => {
    expect(parseOutputLine('02_Example Folder/sub/plan.md')).toEqual({ text: '02_Example Folder/sub/plan.md', paths: ['02_Example Folder/sub/plan.md'] })
    expect(parseOutputLine('05_Code/app/ (main.py, util.py, README.md)').paths).toEqual(['05_Code/app/', '05_Code/app/main.py', '05_Code/app/util.py', '05_Code/app/README.md'])
    expect(parseOutputLine('05_Code/a/schema.json (+ build_schema.py)').paths).toEqual(['05_Code/a/schema.json', '05_Code/a/build_schema.py'])
    expect(parseOutputLine('05_Code/a/notes.md (v1 kept for reference)').paths).toEqual(['05_Code/a/notes.md'])
    expect(parseOutputLine('05_Code/a/x.md, other *.md (all), y.py').paths).toEqual(['05_Code/a/x.md'])
    expect(parseOutputLine('(see the folder above for the rest)').paths).toEqual([])
    expect(parseOutputLine('just a remark').paths).toEqual([])
    expect(parseOutput('a/b.md\n\n(remark)').map((line) => line.text)).toEqual(['a/b.md', '(remark)'])
  })

  it('drops a leading board root from paths', () => {
    expect(relativeToRoot('3. Example Lab/02_Plan/x.md', '3. Example Lab')).toBe('02_Plan/x.md')
    expect(relativeToRoot('./02_Plan/x.md', '3. Example Lab')).toBe('02_Plan/x.md')
  })
})
