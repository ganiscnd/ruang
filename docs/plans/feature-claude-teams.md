# Feature: Claude Teams (menu "Claude", boards, actions, 3D wing)

Brief written 2026-11-09 with the owner. Priority: before Feature 2 (Approval Queue).
Plan first, get the owner's OK, then build in small commits (see "Build order").

## 1. Why

Besides the Hermes agents, the owner runs teams of **Claude scheduled tasks** (agent codes start
with `ZZ.`). They coordinate through **Google Sheets**. The owner finds the sheets hard to read:
too many columns, long paragraph notes, and no way to see what is active, what needs him, and in
what order he must approve things (A before B). Ruang gets a separate **Claude** section so Claude
teams and Hermes agents are never mixed, and so more Claude teams can be added later by config only.

## 2. Ground rules

- **The Google Sheet stays the single source of truth.** Ruang reads it and writes only the owner's
  decisions (status) and comments (Gani notes) back to it. No local copy of board data is kept
  except a short in-memory cache.
- All UI text in English. The owner's comments may be Indonesian or English; store them as typed.
- Never show guessed data as real. If a sheet, a column or a file cannot be read: "Not Available"
  with the reason.
- Public repo: **no spreadsheet IDs, sheet contents, lead data, file contents or task texts in the
  repo, tests or reports.** All IDs live in the private config (below). Test fixtures use invented
  rows ("T01 Example task").
- Custom code only in `server/custom/claude/` and `src/custom/claude/`; small `// custom:` hooks in
  upstream files.
- **New kind of write.** CLAUDE.md today allows writes only through allowlisted Hermes commands.
  The owner approves one more write path: Google Sheets writes for the Claude section, under the
  same safeguards (access code on and unlocked, preview → single-use token → execute, rate limits,
  `write-audit.jsonl` + the command audit with a WRITE chip). Update CLAUDE.md with this rule.

## 3. Private config (already created by the owner's assistant)

- `~/freelance-private/ruang-claude/teams.json`: teams, agents, schedules, boards. For each board:
  spreadsheet ID, tab, column letters **with expected header text**, row key columns, which status
  values count as "needs you", which status values the owner may set (per current status), which
  columns Ruang may write, and the file root for outputs.
- `~/freelance-private/ruang-claude/google-service-account.json`: service account key (the owner
  creates it; see section 10). Read-only for the file system, `chmod 600`.
- Path override for tests: `RUANG_CLAUDE_CONFIG` (default the path above). Tests use a fake config
  and a fake Sheets client, never the real API.
- At load and on every read, check each configured column's header text in row 1. If a header does
  not match, the board shows an error naming the column and **all writes on that board are
  refused** (protects against someone inserting a column).

Teams today (from the config): **ZZ.1 Content** (2 agents, boards "Drafts" and "Research ideas"),
**ZZ.2 Sales** (3 agents, boards "Jobs" and "Prospects", status *paused*), **ZZ.3 Product Lab**
(dispatcher + 5 agents, board "Product Board", kind `taskflow`).

## 4. Google Sheets access

- Service account (JWT) with scope `https://www.googleapis.com/auth/spreadsheets`. Prefer the small
  `google-auth-library` plus plain `fetch` to the Sheets REST API over the full `googleapis` package.
  The owner shares only the three spreadsheets with the service account e-mail (Editor).
- Reads: one `values:batchGet` per board, cached 30 s (`?fresh=1` bypass, like `cachedSource`).
  UI polls every 60 s. Stay well under the Sheets quota (60 reads/min).
- Errors (no key file, not shared, quota, network) show per board as "Not Available: <reason>"; the
  rest of Ruang keeps working.

## 5. Menu and pages

- Sidebar gets two labelled groups: **Hermes** (all existing pages, unchanged) and **Claude**.
- Claude group: `Claude` overview (`#/claude`) and one entry per team (`#/claude/zz-3` ...), built
  from the config, so a new team appears by editing the config only.
  (`pageFromHash` splits on `/`; the Claude page reads the sub-path itself.)

**Overview `#/claude`:** one card per team: name and code, status (active / paused), **Needs you**
count (the big number), working now, waiting, next agent run (from the schedule; "Paused" for a
paused team), link to the team page.

**Team page:** a tab per board. Every board has a **Needs you** panel at the top, then the board.

## 6. The task-flow board (ZZ.3 Product Board)

### 6.1 Columns on screen (5, not 12)

| Column | Sheet statuses | Notes |
| --- | --- | --- |
| Needs you | review, proposed, blocked | ordered, see 6.2 |
| Agent queue | ready, changes requested | in the order the agents will pick them (6.3) |
| Working | in progress | "stuck" badge if Updated is before today |
| Waiting | waiting | shows which tasks it still waits for |
| Done | approved, done, rejected | collapsed by default, with a count |

Filter chips by agent (ZZ.3.A ... E). Unknown status values go to a visible "Other" column, never
hidden.

**Card:** ID, Title (column L; if empty, the first 8 words of Task), owner agent, status badge, and
one line: "Unlocks T12 → T11, T13, T19" or "Waits for T18". No long text on the card.

### 6.2 "Needs you" order (the main feature)

Compute from Depends on (comma-separated IDs; ignore spaces; unknown IDs shown as a warning):

1. For each task X that needs the owner (review / proposed / blocked), compute
   - `unblocksNow`: waiting tasks whose ONLY missing dependency is X (approving X makes them ready),
   - `unblocksAll`: every task downstream of X that is not approved/done/rejected (transitive).
2. Sort: larger `unblocksNow` first, then larger `unblocksAll`, then review before proposed before
   blocked, then lowest ID.
3. Each item shows a number (1, 2, 3 ...) and the reason in one line, for example:
   "1. T18 (review). Approve → T12 becomes ready; ZZ.3.B picks it at its next run (10:00)."
   "3. T21 (proposed). Set ready → ZZ.3.B queue position 2."
   Tasks that unlock nothing say "Nothing waits for this; review when you have time."
4. Show the critical chain as a small line under the panel: the longest path of not-done tasks
   (e.g. T18 → T12 → T11). A simple text chain is enough; no graph library.

### 6.3 Agent queue

Per agent, mirror the agents' own rule: changes requested first, then ready, lowest ID first, one
task per run. Show "ZZ.3.B: T12 → T21 → T22 (next run 10:00 WIB)". Compute the next run from the
config schedule and the Mac power window (05:30-22:55; a run outside it says "Mac off at that
time").

### 6.4 Detail panel (click a card)

- Title, ID, owner, status, Updated, Depends on (clickable), Unlocks.
- **Task:** full text (collapsible).
- **Agent notes as bullets.** New format (agents switched on 2026-11-09):
  ```
  Done:
  - ...
  Check:
  - ...
  Questions:
  - Q1: ... (recommend: ...)
  ```
  Parse `Done:` / `Check:` / `Questions:` sections and `- Qn:` items. Older notes are paragraphs:
  split them into one bullet per line or sentence for display only, never rewrite the sheet.
- **Output files:** each path in Output as a link. Paths are relative to the board's file root
  inside the configured iCloud root. Server-side containment exactly like `folders.ts` (resolve
  real path, must stay inside the root, no hidden files, size limit).
  `.md .txt .json .py .csv` render as text (Markdown rendered); `.png .jpg .pdf` inline;
  `.docx .xlsx` → download link (later maybe a PDF preview via LibreOffice, not in this feature).
  Folders listed one level deep. Missing file → "Not found (path)".
- **Gani notes history:** existing blocks shown newest first.

### 6.5 Actions (writes) on this board

One form at the bottom of the detail panel:
- one answer box per parsed question (Q1, Q2 ...), each with quick buttons "Yes" / "Use your
  recommendation" that fill the box,
- one free "Comment" box (bullets: each new line becomes "- ..."),
- a status choice limited to `ganiCanSetStatus[currentStatus]` from the config
  (e.g. review → approved / changes requested / done; proposed → ready / rejected),
- buttons "Save comment only" and "Save + set status". Confirmation dialog shows exactly what will
  be written to which cells.

Write rules (server, `server/custom/claude/actions.ts`, tests for each):
- Gani notes are **appended, never overwritten**. Read the cell, append
  ```
  Gani (YYYY-MM-DD):
  - Q1: <answer>
  - Q2: <answer>
  - <comment line>
  ```
  separated by one blank line from earlier text. Empty answers are left out.
- Before writing, re-read the row: the row key (ID) must still be on that row, and status and Gani
  notes must still equal what the owner saw (send them with the preview token). If anything changed
  (an agent wrote in the meantime): refuse with "This task changed since you opened it. Reload."
- Only columns listed in `writableColumns`. Only status values allowed for the current status. For
  the Product Board also set Updated = today (Asia/Jakarta) when the status changes.
- Never delete, insert, sort or move rows. Never write the Dispatcher column (K).
- Max 20,000 characters per comment, live counter, no silent cut (same as Pipeline notes).

## 7. Table boards (ZZ.1 and ZZ.2)

Same page frame, simpler board: a sortable table with only the useful columns (title, status,
score/date, one short field), grouped by status, "Needs you" on top (from `needsYou` in the
config, sorted by `sortBy`). Detail panel shows all configured columns, long text as bullets, and
the same comment + status form (status choices from `ganiCanSetStatus`). Rows with a status in
`neverTouchStatus` (do-not-contact) are read-only. Row identity check before writing uses
`rowKey`. ZZ.2 shows a "Paused" banner because its agents are switched off; the board still works.
Note for the owner in the UI: ZZ.1 and ZZ.2 agents do not read Gani notes yet (comments are stored
for him); ZZ.3 agents do.

## 8. 3D office: Claude wing (in this feature)

- A separate area for Claude teams, clearly apart from the Hermes office (for example a building
  or room across the grounds or a new wing; choose what fits `office3d-layout.ts` and show the
  owner the layout in the plan). Sign on the wall: "Claude".
- One desk cluster per team (ZZ.1, ZZ.2, ZZ.3), with a team label; one avatar per agent
  (the Dispatcher can be a small terminal/notice board instead of an avatar). Use a different
  accent colour from Hermes agents.
- State per agent, derived from the board only, with provenance text ("from Product Board,
  read 20:15"):
  - has a task `in progress` → Working at its desk,
  - has a task in `review` → Waiting for owner (review desk or a flag on the desk),
  - has queued tasks (ready / changes requested) → Queued, sitting at the desk, "next run 10:00",
  - nothing → Idle in the wing's lounge corner,
  - team paused → desks dimmed, "Paused",
  - board not readable → Unknown.
  Never animate "working" when the data does not say so.
- A wall board in the wing shows the team's Needs-you count; clicking an agent opens that agent's
  cards on the team page.
- 2D office page: add the Claude teams as a separate section the same way.

## 9. Security checklist

- Service account key never sent to the browser, never logged; redact it in errors.
- Google API calls only from the server; the browser talks only to `/api/custom/claude/*`.
- Same-origin guard, `x-ruang-request` header, access code required for every write.
- File views: containment, no symlinks out of the root, no hidden files, size cap.
- Audit: every write in `write-audit.jsonl` (board, row key, cells, old → new status, comment
  length, not the full comment) and in the command audit with the WRITE chip.

## 10. Owner setup (done by the owner, outside Claude Code)

1. Google Cloud console: create a project (e.g. `ruang-claude`), enable **Google Sheets API**,
   create a **service account** (no roles needed), add a **JSON key**, save it as
   `~/freelance-private/ruang-claude/google-service-account.json`, `chmod 600`.
2. Share the three spreadsheets with the service account e-mail as **Editor**.
3. Claude Code checks access with a read-only script before any UI work.

## 11. Tests and acceptance

Tests (vitest, fake Sheets client, invented rows):
- config loading and header mismatch → board read-only;
- Needs-you order on a fixture that copies the real dependency shape with invented titles (e.g. a
  review task that is the last missing dependency of a waiting task ranks first);
- agent queue order; next run computation incl. paused team and Mac power window;
- notes parsing (new format, old paragraphs, Q items);
- Gani notes append format; concurrency refusal; disallowed status refused; disallowed column
  refused; do-not-contact read-only;
- file containment.

Acceptance (on port 3002 with a throwaway access code, then deploy):
- Menu shows Hermes and Claude groups; overview shows ZZ.1, ZZ.2 (paused), ZZ.3.
- Product Board needs-you list matches the order agreed with the owner on 2026-11-09:
  T18, T08, then the proposed T20/T21/T22, then T17, T14 (or explains any difference).
- Approving a test row in a **copy** of the sheet (not the live board) writes status + Updated +
  an appended Gani notes block, and nothing else. Real writes on the live board only after the
  owner's OK.
- 3D: Claude wing visible, agents placed by the rules in section 8.
- `npm run lint`, `npm test`, `npm run build` pass; then `scripts/deploy.sh`.

## 12. Build order (one commit or more per step, report after each)

1. Plan (this brief → concrete plan: files, endpoints, data shapes, UI sketch, 3D layout sketch,
   risks). **Stop for the owner's OK.**
2. Access check script + config loader + Sheets client (read-only) + tests.
3. Read API + Claude overview + team pages (read-only) for all three teams.
4. Task-flow logic for ZZ.3 (needs-you order, queues, chain) + detail panel + file viewer.
5. Writes: comment + status, with all checks, first against a copy of the sheet.
6. Table boards for ZZ.1 / ZZ.2 with comments and status.
7. 3D Claude wing + 2D section.
8. CLAUDE.md + `docs/reports/05-claude-teams.md` (generic, no private data), deploy.

## 13. Things to verify early (tell the owner if they fail)

- Can the LaunchAgent's `node` read the iCloud folder (`~/Library/Mobile Documents/...`)? macOS
  may block it (TCC). If so, explain the permission the owner must grant (Files and Folders / Full
  Disk Access for node), do not work around it.
- iCloud files that are "cloud only" (not downloaded) open slowly or fail: show "File not
  downloaded on the Mac yet".
