# Report 05: Claude Teams, steps 1-4 (2026-11-09)

Handoff note for the Claude section (brief: `docs/plans/feature-claude-teams.md`). Public-repo
privacy rule applies: no spreadsheet IDs, task IDs, titles, file names or note text here. All of
that lives in the private config (`~/freelance-private/ruang-claude/`) and in the sheets.

Build steps (as numbered in the approved plan): 1 access check and config, 2 read API and pages,
3 task-flow logic and detail panel, 4 writes, 5 table boards, 6 3D wing and 2D section, 7 docs
and final report.

## Done

| Step | What | Commits |
|---|---|---|
| 1 | Private config loader (`RUANG_CLAUDE_CONFIG`), Google Sheets client with a service-account JWT signed by `node:crypto` (no new packages), header check of every configured column, read-only access check script (prints counts and value shapes only). All boards readable, all headers matched. | `2729c2d` |
| 2 | `GET /api/custom/claude/teams[/:team]`, sidebar groups **Hermes** and **Claude** (one entry per team from the config), overview cards and team pages. Agent states only from board rows; free-text statuses grouped by first word; owner name from the config (code and tests use "Owner"). | `5b358c5`, `561bac7` |
| fix | The live service hung on every Claude request: macOS privacy (TCC) held the LaunchAgent's read of the iCloud folder, and the board read waited for it. Fixed: iCloud is only touched by a time-limited child process (5 s), each board read has a 20 s limit, the routes answer 503 with a reason after 30 s. The owner then gave `node` Full Disk Access; both output folders are readable by the service. | `9d5f28e` |
| 3 | Task flow: ranked Needs-you list with a one-line reason per item, agent queues with next run, critical chain, warnings (unknown IDs, duplicates, cycles), "stuck" badge, agent filter (`?agent=`). Row detail (parsed agent notes, owner-notes history, output links) and a read-only file viewer (containment, no hidden files, size caps, safe Markdown, images/PDF inline, Office files as downloads). | `2c2052d` |
| 3+ | Owner's tie-breaker: among items that unlock nothing, a proposed/blocked task that gives an otherwise idle agent work comes first. The test copy's order then matched the order agreed with the owner (7 items). | `8e3f75c` |
| 4 | Sheets writes `claude.note` / `claude.status` with the Pipeline's safeguards (access code, preview → single-use token → execute, rate limits, audit without comment text, command log WRITE). Owner notes appended, never overwritten; status only from the config's allowed list; Updated = today on task-flow boards; refused when the row changed since it was opened. CLAUDE.md has the rule. | `c9a29fb` |

### Step 4 test on the test copy

Done through a launchd test instance on port 3002 with a throwaway access code (the real Ruang
config was not touched). Results: a live-board write was refused (live writes were still off);
a status not allowed from the current one was refused; a comment-only save wrote one cell and
read it back; reusing a confirmation was refused; a second confirmation prepared before that
write was refused ("This task changed since you opened it. Reload."); a status change with an
answer and a comment wrote three cells (notes, status, Updated) and read them back. A diff of
the whole test copy showed only the expected cells changed. The audit file held both writes,
without comment text.

Since then the owner set `"liveWrites": true` and reset the test row's status by hand. One test
comment block from step 4 is still in the test copy's owner notes (append-only by design).

Checks at handoff: `npm run lint`, `npm test` (306 tests), `npm run build` pass; deployed with
`scripts/deploy.sh`, service healthy (API version 14).

## Next

- **Step 5, table boards (ZZ.1, ZZ.2):** sortable table with only the useful columns, grouped by
  status, Needs you on top (config `needsYou`, `sortBy`), detail panel with all configured
  columns and long text as bullets, the same comment and status form (flat `ganiCanSetStatus`
  list), do-not-contact rows read-only, a "Paused" banner for ZZ.2, and the notice that ZZ.1/ZZ.2
  agents do not read the owner's notes yet. The detail panel and form already work generically;
  step 5 is mostly the table view and these notices.
- **Step 6, 3D Claude wing and 2D section:** separate building east of the flag (layout in the
  plan), one desk cluster per team, coral accent, agent states from `agentLine` (never animated
  "working" without data), wall board with each team's Needs-you count, clicks open
  `#/claude/<team>?agent=<code>`; a "Claude wing" room tab in the 2D office.
- **Step 7, docs and wrap-up:** CLAUDE.md architecture section for `server/custom/claude/` and
  `src/custom/claude/`, final report, deploy.

## Open questions

1. **Live writes are now on.** The first real write on a live board should be watched (read back,
   audit entry, agents' next run picking up the change).
2. **The pages have not been checked in a browser by Claude** (no browser tools in the session).
   The owner should look over the overview, the Product Board columns, the detail panel and the
   confirmation dialog, and report anything that looks wrong.
3. **New agent-note format not yet seen in real data.** All current notes are older paragraphs
   (shown one sentence per bullet). The `Done:` / `Check:` / `Questions:` parser and the per-question
   answer boxes are tested on invented notes only; check them on the first real note.
4. **Drafts board Needs-you counts every "Drafted" row,** including drafts whose post date has
   passed. Should older drafts still count, or only today and later? (Step 5.)
5. **Owner-notes history:** older free-text notes are split into blocks at headings of the form
   "... (YYYY-MM-DD) ...:". Headings in another form show as one undated block. Fine as is?
6. **iCloud "not downloaded" detection** is tested with placeholder files and relies on a file
   reporting zero allocated blocks; not yet seen with a real cloud-only file.
7. **Cleaning the test copy:** keep the remaining test block in its owner notes, or remove it by
   hand?
