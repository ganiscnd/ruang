# Feature 1 plan: Lead & Proposal Pipeline (approved 2026-10-24)

## Owner's answers

1. "Assign to agent" creates a **separate work card**. Its title starts with `[lead <id>]`, and it
   is **linked** to the lead card with a Hermes dependency link, so the lead detail can show it.
2. **Won** = comment `stage: Won`, then mark done, same as Lost.
3. `kanban.auto_decompose` turned **off** with `hermes config set` (both profiles, because each
   profile's gateway runs its own dispatcher). Before: `true`/`true`. After: `false`/`false`.
   The dispatcher re-reads it every tick, so no restart is needed. `review_dispatch` is unchanged
   (`true`); it is explained when Feature 2 is planned.
4. End-to-end test on the real `leads` board with one lead "TEST: delete me", then archive only
   that lead. The board stays.

## Hermes facts that shaped the design (read-only source/docs check)

- `auto_decompose` (now off) would split and auto-assign any `triage` card.
- block → unblock → block (same kind) twice routes a card to `triage`.
- `review_dispatch: true` spawns a reviewer agent for cards in `review`.
- `assign` does not change status; a `done` card never runs again.
- Unassigned `ready` cards are never dispatched (`default_assignee` is empty).
- `link <parent> <child>`: a `ready` child is demoted to `todo` while the parent is open, and
  promoted back when the parent is done or archived. A running child cannot be linked.
- `complete` refuses a card whose parents are not done/archived, and accepts only
  `ready|running|blocked|review`. It needs a `--result` from non-review statuses.
- `list --json` includes `body`; comments and parents/children only come from `show --json`.
- Hermes has no tags or labels. `--` (end of options) is respected.

**Consequence for the link direction:** the work card is the **parent** and the lead the
**child** (`link <work> <lead>`). The reverse would gate the work card forever (the lead is never
done while work happens), so the agent would never start. While a work card is open, the lead sits
in `todo`; it cannot be closed as Won/Lost until its work cards are done or archived. Ruang checks
this first and explains it.

## 1. Data format

Lead card on board `leads`. The title is the job title. The body starts with a `[lead]` block of
`key: value` lines; free notes follow a line `---`.

```
title:  Automate RFI routing from Procore to n8n
body:
[lead]
client: Northline Builders LLC
budget: hourly 45-65 USD
upwork_url: https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9
posted: 2026-10-23
fit: 4
tags: n8n, procore, rfi, document-automation
---
Client wants RFIs from Procore classified and routed to the right subcontractor.

comments:
  [2026-10-24 09:12, owner]       stage: Found
  [2026-10-24 11:40, researcher]  stage: Researched
                                  Client has 3 past hires, 4.9 rating.
```

- Keys are case-insensitive; unknown keys are ignored; a missing or invalid value shows as
  **Not Available**.
- `budget`: `fixed <n> USD` | `hourly <min>-<max> USD` (or `hourly <n> USD`) | `unknown`.
- `fit`: whole number 1-5. `tags`: lowercase `a-z0-9-`, comma separated, max 10.
- `posted`: `YYYY-MM-DD`.

Work card: title `[lead <lead id>] Research: <lead title>` or
`[lead <lead id>] Draft proposal: <lead title>`, assigned to the chosen profile. The body starts
with `lead: <lead id>`, followed by the job instructions and a copy of the lead fields. It is
linked with `link <work id> <lead id>`. Ruang finds a lead's work cards by the link (the lead's
`parents`) and, as a fallback, by the `[lead <id>]` title prefix.

## 2. Stage model and status mapping

- Stages: Found, Researched, Proposal Drafted, Approved, Sent, Interview, Won, Lost.
- Current stage = the newest comment whose first line is exactly `stage: <Stage>`
  (case-insensitive). No stage comment means **Unknown**. Days in stage are counted from that
  comment's date. Invalid stage names are plain comments.
- Agents may set only Found, Researched and Proposal Drafted. Ruang ignores, and flags, an
  owner-only stage (Approved, Sent, Interview, Won, Lost) written by any author other than `owner`.
- Lead card status: `ready` (or `todo` while a linked work card is open), unassigned. Won/Lost:
  stage comment, then `complete --result=<Won|Lost>` → `done`. Archived cards are hidden.
  Ruang never assigns, blocks, reviews or triages a lead card.
- Work card status = what the agent is doing: `ready` (waiting ≤ 60 s) → `running` (Working) →
  `blocked` (needs you) / `review` / `done` (result in its summary).
- Feature 2 builds on "Draft proposal" work cards.

## 3. Allowlisted write commands

Board pinned with `--board=leads`; options use the `--opt=value` form; free text always after `--`;
every argument is a separate `execFile` argv element (no shell).

| Action | argv |
|---|---|
| `board.setup` | `hermes kanban boards create --name=Leads --description=Upwork lead and proposal pipeline (Ruang) -- leads` |
| `lead.create` 1/2 | `hermes kanban --board=leads create --body=<[lead] block> --created-by=owner --idempotency-key=<key> --json -- <title>` |
| `lead.create` 2/2 | `hermes kanban --board=leads comment --author=owner -- <id> stage: Found` |
| `lead.stage` | `hermes kanban --board=leads comment --author=owner -- <id> <"stage: X" + optional reason line>` |
| `lead.stage` (Won/Lost) | the comment above, then `hermes kanban --board=leads complete --result=<Won\|Lost> -- <id>` |
| `lead.note` | `hermes kanban --board=leads comment --author=owner -- <id> <text>` |
| `lead.assign` 1/2 | `hermes kanban --board=leads create --assignee=<profile> --body=<lead: id + instructions> --created-by=owner --idempotency-key=<key> --json -- <[lead id] Research: title>` |
| `lead.assign` 2/2 | `hermes kanban --board=leads link -- <work id> <lead id>` |

Never: `--triage`, `--parent`, `--initial-status`, `--skill`, `--model`, `--workspace`, `assign`
on a lead card, `block`, `archive`, `boards rm`, `edit`.

Validation: task ids match `TASK_ID` and must exist on the `leads` board; the profile must be in
`hermes profile list`; the stage must be one of the eight; title 3-150 characters, one line; client
≤ 120, one line; notes ≤ 4000; comment ≤ 2000; URL
`^https://www\.upwork\.com/(jobs|freelance-jobs)/…` ≤ 300; fit 1-5; budget 0-1,000,000; posted a
valid date, not in the future. Unicode NFC, control characters removed (newlines kept only in
notes and comments). One-line fields cannot contain newlines (so no injected `stage:` or key lines).

## 4. API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/custom/pipeline` | `{ board, leads, writes: {enabled, reason}, fetchedAt }` |
| GET | `/api/custom/pipeline/:id` | Detail: fields, stage history, comments, work cards |
| POST | `/api/custom/actions/preview` | Validates `{action, params}`, returns `{token, summary, commands, expiresAt}`; runs nothing |
| POST | `/api/custom/actions/execute` | `{token}` → runs exactly the previewed argv |

Reads: one `list --json` + one `show --json` per lead (4 at a time, cached 30 s, max 100 leads).

## 5. UI layout

New menu item **Pipeline** (`#/pipeline`). Top bar: search (title, client, tags), Board/List
toggle, **Add lead**. Board: columns Unknown · Found · … · Won · Lost. List: sortable table. Card:
title, client, budget, posted, fit, tags, stage, days in stage, assigned agent (from an open work
card), Upwork link (new tab, `noopener noreferrer`). Detail panel: all fields, stage timeline,
comments, work cards with status, and actions Change stage, Add note, Assign to agent. Every
action has a confirmation dialog with a plain-English summary and the exact commands. Board
missing: "Set up leads board" banner. Access code off: write buttons disabled with "Write actions
need the access code. Turn it on in Settings." Truthful empty, unavailable and partial states.

## 6. Security measures

- Writes refused unless the access code is enabled and unlocked (403 + reason).
- `x-ruang-request: 1` header, `Sec-Fetch-Site: same-origin` when sent, `Origin` matches `Host`.
- Confirmation tokens: 128-bit random, single use, 2 minutes, bound to the exact argv and session.
- JSON body ≤ 16 KB; ≤ 10 writes/minute and ≤ 100/day; one write at a time (429).
- Audit: every write in the command log marked `write: true`, with free text shown as
  `<text: N chars>`; also appended to `<Ruang config>/write-audit.jsonl` (no free text).
- A timed-out write reports "Unknown whether this was applied. Refresh to check."; idempotency
  keys prevent duplicate cards on retry.
- Profile lock: titles of locked agents' work cards are withheld.
- Unchanged: `execFile`, no shell, 127.0.0.1, secret redaction.

## 7. Test plan

Unit: lead-format round-trip and malformed input; stage parsing and owner-only rule; validators
(leading `-`, `--assignee=` in titles, newlines, control characters, oversize, bad URLs, unknown
keys); exact argv per action (`--` present, board pinned, no assignee on lead create). Routes with a
fake runner: access code off → 403, missing header → 403, token reuse/expiry/mismatch, rate limit,
unknown profile/task, audit marking. Collector: missing board, failed list, partial `show`
failures. UI (jsdom): empty/unavailable states, disabled buttons, confirmation dialog, search.
End-to-end on port 3002 with an isolated `RUANG_CONFIG_DIR` and a temporary access code: create
the board, the lead "TEST: delete me", stage changes, a note; then archive that lead.

## 8. Acceptance criteria

1. `#/pipeline` shows real leads or a truthful empty / not set up / unavailable state.
2. Cards show the listed fields; missing data is "Not Available"; no stage is "Unknown".
3. The detail shows the dated stage history, comments and work-card statuses matching Hermes.
4. Every write needs the access code and a confirmation, runs only allowlisted argv, and is in the
   command log.
5. Ruang never gives a lead card an assignee or moves it to `triage`, `review` or `blocked`.
6. Lint, tests and build pass; other pages unchanged; `deploy.sh` succeeds.

## 9. Known limitations

N+1 `show` calls (first load slower with many leads, then cached); comment authors are plain text,
so the owner-only stage rule is a convention; Won/Lost is final in the MVP; no field editing;
a lead cannot be closed while a linked work card is open; whether a work-card agent may comment on
the lead card is to be verified; lead data is entered by hand (no Upwork connection).

## 10. Build order

1. `server/custom/lead-format.ts` + tests.
2. Pipeline collector + GET endpoints + tests.
3. Read-only Pipeline page, menu and route.
4. Write foundation (`actions.ts`: preview/execute, tokens, guards, rate limit, audit) + tests.
5. Board setup + Add lead UI with confirmation; end-to-end test.
6. Change stage + Add note.
7. Assign to agent (work card + link).
8. Docs, report, deploy.

Upstream hooks (small, marked `// custom:`): `server/index.ts` (one `installCustom(app)` line),
`src/routes.ts` (menu item), `src/App.tsx` (page branch), `server/mission-control.ts` (export
`RunOptions`, `write` audit flag, task-board cache clear), `API_VERSION` bump.
