# Report 05: Claude Teams (2026-11-09 to 2026-11-10)

Final report of the Claude section (brief: `docs/plans/feature-claude-teams.md`; architecture:
CLAUDE.md, "Feature: Claude Teams"). Public-repo privacy rule applies: no spreadsheet IDs, task
IDs, titles, file names, note text or the owner's name. All of that stays in the private config
(`~/freelance-private/ruang-claude/`) and in the sheets.

## What was built

| Step | What | Commits |
| --- | --- | --- |
| 1 | Private config loader, Google Sheets client (service-account JWT signed with `node:crypto`, no new packages), header check of every configured column, read-only access check. All boards readable, all headers matched. | `2729c2d` |
| 2 | Read API, sidebar groups **Hermes** / **Claude** (one entry per team from the config), overview cards, team pages. Agent states only from board rows. | `5b358c5`, `561bac7` |
| fix | Every Claude request hung on the live service: macOS privacy (TCC) held the LaunchAgent's read of the iCloud folder and the board read waited for it. iCloud is now only touched by a time-limited child process; every read has a deadline. The owner then gave `node` Full Disk Access. | `9d5f28e` |
| 3 | Task flow for the Product Board: ranked Needs-you list with reasons, queues, critical chain, warnings, stuck badge, agent filter; row detail with parsed notes and output links; read-only file viewer. | `2c2052d` |
| 3+ | Owner's tie-breaker: a proposed/blocked task that gives an otherwise idle agent work comes first among items that unlock nothing. | `8e3f75c` |
| 4 | Sheets writes (`claude.note`, `claude.status`) with the Pipeline's safeguards; owner notes appended, never overwritten; refused when the row changed since it was opened. | `c9a29fb` |
| 5 | Table boards (ZZ.1, ZZ.2): short sortable table, status groups, Needs you on top; past post dates in a collapsed "Old drafts, not posted" group; notice that these agents do not read the owner's notes yet; links and long text in the detail panel. | `4928006`, `1d32e39` |
| 6 | Claude wing: a separate building east of the 3D office (coral accent, one desk cluster per team, notifier terminal, lounge, Needs-you wall boards), placement only from board state, a "Claude wing" camera button; a "Claude wing" tab in the 2D office. | `c7a280a` |
| 6+ | Wing labels kept apart (terminal moved to a free front-row slot, camera aimed further back, speech bubbles only for states with news); the sign moved in front of the wall. | `07c006f` |
| 7 | CLAUDE.md architecture section and this report. | this commit |

## How it was checked

- **Unit and UI tests:** 320 in total. Every test uses invented data and fake Sheets clients and
  never calls Google.
  - Config and headers, JWT and errors, timeouts, the Needs-you order, queues, schedules.
  - Notes, file containment, every write rule, the write routes' guards.
  - Table columns, the wing layout, page rendering.
- **Ranking:** set up by the owner on the test copy. The order matched the agreed order of 7 items
  once the idle-agent tie-breaker was added.
- **Writes (step 4):** run on the test copy only, through a launchd test instance on port 3002 with
  a throwaway access code. Each case behaved as intended:

  | Case | Result |
  | --- | --- |
  | Write to a live board (liveWrites off) | Refused |
  | Status not allowed from the current one | Refused |
  | Comment only | Written, read back OK |
  | Reusing a confirmation | Refused |
  | Confirmation prepared before another write | Refused: row changed |
  | Status change with answer and comment | Three cells written, read back OK |

  A diff of the whole test copy showed only the expected cells changed. The audit file had no
  comment text.
- **Table boards (step 5):** previews only (a preview never writes), because these live boards
  have no test copy.
- **3D wing (step 6):** checked in headless Chromium against real data at 1400×900, 1280×720 and
  1024×640, dark and light theme. All 14 labels were visible, with none overlapping, none under
  the toolbars and none outside the view. The Hermes view is unchanged.

## State at the end

- Service deployed and healthy, API version 14.
- `liveWrites` is on (set by the owner).
- Two test comment blocks remain on the test copy (append-only by design). The owner reset the
  test row's status and keeps the comments.

## Open points (the owner checks them while using Ruang)

1. Watch the first real write on a live board: the read-back, the audit entry, and the agents
   picking up the change at their next run.
2. The new agent-note format (`Done:` / `Check:` / `Questions:`) has not yet appeared in real data.
   Check the bullets and the per-question answer boxes on the first real note.
3. "File not downloaded on the Mac yet" relies on placeholder files and on files that report zero
   allocated blocks. It has not yet been seen with a real cloud-only file.
4. Back-row agent labels can partly cover a team's wall board in the 3D wing. The same Needs-you
   count is on the team's floor label.
5. The wing sits outside the area the scene's sunlight covers for shadows, so it has none.
