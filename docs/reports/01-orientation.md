# Report 01: Orientation (2026-10-24)

First look at the fork (upstream Ruang v0.2.0) on the Mac mini, Hermes Agent v0.22.4+261.

## Architecture summary

- **Server (`server/`)**: a small Express web server that only listens on 127.0.0.1. When the UI
  asks for data, it runs a fixed `hermes` command, reads the text it prints, keeps the result for
  10 seconds, and returns it as JSON. Almost everything is in `server/mission-control.ts`: the
  command runner (`execFile`, no shell, 8 s timeout), the parsers for Hermes output, the cache,
  secret redaction, an in-memory audit log of the last 100 command runs, and the logic that decides
  each agent's office state. The allowlist is not a separate file: it is the fixed command in each
  `collect*` function. The few values that come from the browser (profile, board, task id) are
  checked against strict patterns. `access.ts` is the access code, `profile-lock.ts` the PIN lock.
- **Frontend (`src/`)**: React pages switched by the address (`#/office`, `#/task-board`, …), each
  polling the server every few seconds. The server decides the state of each agent (Working,
  Reviewing, Collaborating, Idle, Unknown) and its room (Idle → Lounge, work → desk/meeting room);
  the 2D and 3D offices only draw it. 3D room coordinates are in `office3d-layout.ts`.

## Lint and tests

Before changes: lint clean, 131/131 tests passed. After changes: lint clean, 133/133 passed, build OK.

## The "3 CLI errors"

The counter is not "3 different commands". It counts failed runs among the last 100 commands,
and every failure was the same one, repeated on each refresh (it grew 3 → 6 while I watched).
There was also one real problem the counter does not show.

| # | Problem | Cause | Fix | Verified |
|---|---|---|---|---|
| 1 | `opencode --version` fails each refresh | OpenCode is not installed; Ruang treats it as optional but counted the missing program as a CLI error | A missing optional program is logged as an expected state; the UI still says OpenCode is Not Available | Yes, failed reads 6 → 0 |
| 2 | Calendar "Unrecognized cron output" (not in the counter) | Hermes v0.22 prints `No scheduled jobs in profile 'default'.`; the parser only knew `No scheduled jobs.` | Parser accepts both; test added with the real output | Yes, `/api/calendar` available (0 jobs) |

Every other allowlisted read (profiles, kanban, sessions, skills, status, insights, logs) was run
by hand and parses correctly. Commit `dd8bde4`.

## Kanban write commands (from `--help` only, none run)

Hermes statuses are fixed (`triage, todo, ready, running, blocked, scheduled, review, done,
archived`); there is no "move to any status" command, only specific verbs: `request-review`
(→ review), `complete` (→ done), `block`/`unblock`, `schedule`, `promote`, `archive`. Others:
`boards create <slug> --name …`, `create <title> --body … --assignee …`, `comment <id> <text>`,
`assign <id> <profile|none>` / `reassign`, `edit <id> --title/--body/…`,
`request-changes <id> <reason>`, `link <parent> <child>`. Full syntax in `docs/CUSTOM_ROADMAP.md`.

## npm audit (9 findings)

- The running server: 1 high, `body-parser` (via express): a crafted compressed request can
  crash it. Low real risk (127.0.0.1 only), still worth fixing.
- The other 8 are development tools only (vite, vitest, concurrently and their packages).
- Plain `npm audit fix` (no `--force`, dry run) fixes body-parser, vite, concurrently, undici and
  source-map-js without breaking changes. vitest/@vitest/mocker/tinypool need the breaking
  vitest 5 upgrade; tests only.

## Risks and questions raised

1. Where to store the pipeline stage (comment vs title prefix).
2. A `ready` card with an assignee is run automatically by the Hermes gateway.
3. Token cost per proposal may not be measurable (insights are per profile, not per task).
4. Should write actions require the access code?
5. Reject: block or archive?
6. `git push` had no GitHub login in the session; pushed via `gh` once.

All were answered on 2026-10-24; see "Decisions" in `docs/CUSTOM_ROADMAP.md`.
