// custom: invented Claude config for tests only (no real teams, ids or sheets). Not built.
export function exampleConfig(): Record<string, unknown> {
  return {
    version: 1,
    timezone: 'Asia/Jakarta',
    serviceAccountKeyFile: '/tmp/example-key.json',
    icloudRoot: '/tmp/example-icloud',
    teams: [
      {
        code: 'ZZ.1', name: 'Example content', status: 'active',
        agents: [{ code: 'ZZ.1.A', name: 'Example writer', schedule: 'daily 06:00', runsOnMac: true, boards: ['example-drafts'] }],
        boards: [{
          id: 'example-drafts', title: 'Drafts', spreadsheetId: 'example-sheet-id-000000001', tab: 'Drafts', rowKey: ['postDate', 'topic'],
          columns: { postDate: { col: 'A', header: 'Post date' }, topic: { col: 'B', header: 'Topic', role: 'title' }, status: { col: 'C', header: 'Status', role: 'status' }, ganiNotes: { col: 'D', header: 'Gani notes', role: 'ganiNotes' } },
          needsYou: { status: ['Drafted'], reason: 'Check the draft' }, ganiCanSetStatus: ['Posted', 'Skipped'], writableColumns: ['status', 'ganiNotes'], files: { root: 'Example Drafts' },
        }],
      },
      {
        code: 'ZZ.3', name: 'Example lab', status: 'paused',
        agents: [{ code: 'ZZ.3.A', name: 'Example builder', schedule: 'daily 09:00', runsOnMac: true }, { code: 'ZZ.3.0', name: 'Example notifier', schedule: 'hourly at :05, 08:00-21:00', notifierOnly: true }],
        boards: [{
          id: 'example-lab', title: 'Lab board', kind: 'taskflow', spreadsheetId: 'example-sheet-id-000000002', tab: 'Tasks', rowKey: ['id'],
          columns: { id: { col: 'A', header: 'ID', role: 'id' }, owner: { col: 'B', header: 'Owner', role: 'owner' }, dependsOn: { col: 'C', header: 'Depends on', role: 'dependsOn' }, status: { col: 'D', header: 'Status', role: 'status' }, notified: { col: 'E', header: 'Notified', role: 'readonly' }, title: { col: 'AA', header: 'Title', role: 'title' } },
          statuses: ['waiting', 'ready', 'review', 'done'], unlockStatuses: ['done'], needsYou: { status: ['review'] }, ganiCanSetStatus: { review: ['done'] }, writableColumns: ['status'],
        }],
      },
    ],
    testBoards: [{ id: 'example-lab-copy', testCopyOf: 'example-lab', spreadsheetId: 'example-sheet-id-000000003', tab: 'Tasks' }],
  }
}
