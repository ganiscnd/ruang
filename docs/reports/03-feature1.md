# Report 03: Feature 1, Lead & Proposal Pipeline (2026-10-24)

Built as planned in `docs/plans/feature1-pipeline.md`, in 8 steps, each committed and pushed
(`c05ecdb` … `7ddee7f`). Deployed to the always-on instance with `scripts/deploy.sh`.

## What was built

- **Pipeline page** (menu item *Pipeline*, `#/pipeline`):
  - Leads grouped by stage (Unknown · Found · … · Won · Lost) in a board view or a list view, with
    search (title, client, tags, stage).
  - Each card shows title, client, budget, posted date, fit, tags, days in stage, the assigned
    agent (from an open work card), and the Upwork link.
- **Lead detail:** all fields, notes, the dated stage history (ignored agent entries are marked),
  comments, linked agent work cards with their Hermes status, and the actions.
- **Write actions:** Set up leads board, Add lead, Change stage, Add note, Assign to agent. Every
  one goes preview → confirmation dialog (plain summary plus the exact commands) → execute.
- **Truthful states:** loading, board not set up, board unreadable (Not Available + reason),
  empty, a lead without a `[lead]` block (fields Not Available), a lead whose history cannot be
  read (stage Unknown).
- **Small upstream changes** (all marked `custom:`):
  - The sidebar now reads "READ-ONLY + APPROVED ACTIONS".
  - The command log marks write runs with a WRITE chip.
  - API version 13.

## Hermes setting changed (owner-approved)

`kanban.auto_decompose`, set with `hermes -p <profile> config set kanban.auto_decompose false`:

| Profile | Before | After |
|---|---|---|
| default | `true` | `false` |
| leadengineer | `true` | `false` |

Both profiles are changed because each profile's gateway runs its own dispatcher. The dispatcher
re-reads the value every tick, so no restart is needed. `review_dispatch` is unchanged (`true`).

## Allowlisted write commands

In every command, the board is pinned, options use `--opt=value`, free text comes after `--`, and
nothing runs through a shell.

| Action | Commands |
|---|---|
| Set up board | `hermes kanban boards create --name=Leads --description=… -- leads` |
| Add lead | `hermes kanban --board=leads create --body=<[lead] block> --created-by=owner --idempotency-key=… --json -- <title>`, then `… comment --author=owner -- <id> stage: Found` |
| Change stage | `hermes kanban --board=leads comment --author=owner -- <id> "stage: <Stage>[\n reason]"`; Won/Lost then `… complete --result=<Won\|Lost> -- <id>` |
| Add note | `hermes kanban --board=leads comment --author=owner -- <id> <text>` |
| Assign to agent | `hermes kanban --board=leads create --assignee=<profile> --body=<lead: id + job> --created-by=owner --idempotency-key=… --json -- "[lead <id>] Research: <title>"` (or `Draft proposal:`), then `… link -- <work id> <lead id>` |

## Security in practice

- Writes need the access code **enabled and unlocked** (403 with "Write actions need the access
  code. Turn it on in Settings." otherwise; buttons disabled with the same text).
- Same-origin only: the `x-ruang-request: 1` header, `Sec-Fetch-Site`, and an `Origin` that
  matches the host (or `X-Forwarded-Host`, for the Tailscale proxy).
- Single-use confirmation tokens: 2 minutes, bound to the browser session. Execute re-validates
  against fresh Hermes data and refuses if the commands would differ.
- Limits: at most 10 writes per minute, 100 per day, one at a time. JSON bodies up to 16 KB.
- Strict input validation: fixed fields, length limits, no control characters, one-line fields
  without line breaks, Upwork URL pattern, profile must exist, notes may not start with `stage:`.
- Audit: each write appears in the command log (WRITE chip, free text replaced by its length) and
  in `~/.config/ruang/write-audit.jsonl` (no free text).

## Tests

- `npm run lint`: clean. `npm run build`: OK.
- `npm test`: **195 passed** (131 upstream + 2 from the CLI fix + 62 new):

| File | Tests | What they cover |
|---|---|---|
| `server/custom/lead-format.test.ts` | 9 | Format round-trip, bad values stay unknown, stage rules |
| `server/custom/pipeline.test.ts` | 7 | Collector with fake runner: fields, stage, links, missing board, partial failures, redaction, routes |
| `server/custom/actions.test.ts` | 33 | Injection attempts, exact argv per action, token reuse/expiry/session, re-validation, rate limit, partial failure, timeout, audit, HTTP guards |
| `src/custom/*.test.ts(x)` | 13 | Display helpers, page states, disabled buttons, action panel |

Unit tests never run the real `hermes`.

## End-to-end test (real Hermes, port 3002)

Setup: an isolated `RUANG_CONFIG_DIR` in the scratchpad and a temporary access code. The real
`~/.config/ruang/access.json` was not read or changed; the live instance on 3001 was not touched
until the deploy.

| Step | Result |
|---|---|
| Writes with the access code off | Refused (403, clear reason) ✓ |
| Set up leads board | Board `leads` created; `default` stays the current board ✓ |
| Add lead "TEST: delete me" | Created `t_2fcbe559`, unassigned, `ready`, body exactly in the `[lead]` format, comment `stage: Found` ✓ |
| Stage → Researched (with reason) | Comment written; Ruang shows Researched ✓ |
| Add note | Comment written ✓ |
| Assign to agent | **Preview only** (exact commands shown; not executed, because executing starts a real agent) ✓ |
| Refusals | Note starting with `stage:`, profile `--evil`, duplicate title, unknown action, foreign `Origin` (403), no session (401) ✓ |
| Stage → Lost | `stage: Lost` comment, then `complete --result=Lost` → `done`. The run record has no profile and no worker: no agent ran ✓ |
| Archive the test lead (CLI) | `hermes kanban --board leads archive t_2fcbe559` → archived; board `leads` kept; pipeline shows 0 leads ✓ |
| Audit file | 5 entries, no free text ✓ |

## Deploy check (live, port 3001)

- `scripts/deploy.sh` → `{"ok":true,"apiVersion":13}`. The service is running; health is OK
  locally and over Tailscale.
- `/api/custom/pipeline`, `/api/custom/pipeline/<id>` and `/api/custom/actions/preview` answer
  **401 "Ruang is locked"** without a session. That is correct: your access code is on. The
  endpoints exist (an old server would answer 404).
- CLI errors: **0** (fresh instance, 15 reads).

## Known limitations

- The first load needs one `show` per lead (max 100 leads, 4 at a time, then cached for 30 s).
- Comment authors are plain text, so the owner-only stage rule is a convention, not security.
- Won/Lost is final in the UI; there is no reopen. A wrong stage is corrected by a newer stage
  comment.
- Lead fields cannot be edited after creation yet.
- A lead cannot be closed while a linked work card is open (a Hermes rule).
- Assign to agent was tested to the preview only; a real agent run is untested.
- Not verified yet: whether a work-card agent may comment on the lead card.
- The origin check over the Tailscale URL is expected to pass (Host / X-Forwarded-Host) but was
  not exercised with a logged-in browser yet.
- Lead data is entered by hand; there is no connection to Upwork.

## Try it yourself

1. Open https://abiyudhas-mac-mini.tail5349c4.ts.net/ and enter your access code.
2. Press **M** (or ☰) → **Pipeline**. You see an empty board "No leads yet".
3. Click **+ Add lead**, fill in at least the job title, then **Review and confirm**. Read the
   dialog and click **Confirm**. The lead appears in the **Found** column.
4. Click the lead title → detail. Try **Change stage…** (e.g. Researched with a reason) and
   **Add note…**; each asks for confirmation.
5. **Assign to agent…** starts a real Hermes agent (uses tokens). Try it when you want a real
   research run.
6. **Logs** shows your writes with a WRITE chip.
