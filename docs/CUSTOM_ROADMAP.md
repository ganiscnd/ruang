# Custom roadmap: freelance Mission Control

Planned features for this fork. Nothing here is built yet. Custom code goes in `server/custom/`
and `src/custom/`, with small marked hooks in upstream files (see `CLAUDE.md`).

## Decisions (2026-10-24)

1. **Pipeline stage** is stored as a Kanban comment `stage: <Stage>`. The newest stage comment wins;
   no stage comment means **Unknown**. The dated stage history is kept and feeds the Scorecard.
2. **Lead cards are never auto-assigned.** An agent only starts work when the owner clicks an
   explicit "Assign to agent" button (with confirmation).
3. **Token cost per proposal** shows "Not Available" if Hermes does not record tokens per task. If a
   dedicated proposal-writing profile is used later, show an **average** (that profile's tokens for
   the period ÷ proposals drafted in the period), clearly labelled as an average, never as a
   per-proposal value.
4. **The access code must be enabled before any write action is allowed.** When it is off, write
   buttons are disabled with a clear explanation (and the server refuses writes too).
5. **Reject** = block the card with a reason comment (reversible). A lead that is truly lost gets
   `stage: Lost` and is then marked done.

## What Hermes gives us (v0.22.4, checked with `--help` only)

Kanban statuses are fixed by Hermes: `triage, todo, ready, running, blocked, scheduled, review,
done, archived`. There is **no generic "set status" command**. Status changes only through
specific verbs. Write commands relevant to these features:

```
hermes kanban boards create <slug> [--name NAME] [--description D] [--icon I] [--color HEX] [--switch] [--default-workdir PATH]
hermes kanban [--board <slug>] create <title> [--body BODY | --body-file PATH] [--assignee PROFILE] [--parent ID] [--priority N] [--tenant T] [--triage] [--idempotency-key KEY] [--created-by NAME] [--skill S] [--initial-status blocked|running] [--json]
hermes kanban [--board <slug>] comment [--author NAME] [--max-len N] <task_id> <text...>
hermes kanban [--board <slug>] edit <task_id> [--title T] [--body B] [--priority N] [--result R] [--summary S] [--metadata JSON]
hermes kanban [--board <slug>] assign <task_id> <profile|none>
hermes kanban [--board <slug>] reassign [--reclaim] [--reason R] <task_id> <profile|none>
hermes kanban [--board <slug>] request-review [--summary S] [--reviewer PROFILE] [--metadata JSON] [--force] <task_id>   # → review
hermes kanban [--board <slug>] request-changes <task_id> <reason...>        # reviewer verdict: back to implementer
hermes kanban [--board <slug>] reopen-review [--reason R] <task_ids...>     # review → ready/todo
hermes kanban [--board <slug>] complete [--result R] [--summary S] [--metadata JSON] [--force] <task_ids...>   # → done
hermes kanban [--board <slug>] block [--kind capability|dependency|needs_input|transient] [--ids ...] <task_id> [reason...]
hermes kanban [--board <slug>] unblock [--reason R] <task_ids...>
hermes kanban [--board <slug>] schedule [--ids ...] <task_id> [reason...]
hermes kanban [--board <slug>] promote [--ids ...] [--dry-run] [--json] <task_id> [reason...]   # todo/blocked → ready
hermes kanban [--board <slug>] archive [--rm IDS...] [task_ids...]
hermes kanban [--board <slug>] link <parent_id> <child_id>   /   unlink <parent_id> <child_id>
```

Board management also has `boards switch|rename|rm [--delete]|set-default-workdir|export|import`.
None of those should be exposed in the UI.

**Important Hermes behaviour:** the gateway runs the Kanban dispatcher. A task that is `ready` and
has an assignee gets claimed and **run by that agent automatically**. On the `leads` board, assigning
a card means "agent, work on this now". That is useful for research and drafting, but the UI must
make it explicit. Per decision 2, lead cards are created **unassigned**, and assigning only
happens through the confirmed "Assign to agent" action.

## Shared foundation: a guarded write path (build first, with Feature 1)

`server/custom/actions.ts`: a fixed table of named actions (e.g. `lead.create`, `lead.comment`,
`proposal.approve`). Each one builds an argv for `systemRun`, so writes go through the same
`execFile` runner and appear in the same command audit log. Rules:

- Inputs are validated with the existing regexes (`TASK_ID`, `BOARD_SLUG`, `PROFILE_NAME`), the
  board is pinned to `leads`, free text is length-limited and stripped of control characters, and
  `--` is placed before positional text so it can never be read as an option.
- Two-step confirmation: `POST /api/custom/actions/preview` returns the exact command and a
  short-lived one-time token. The UI shows it in a confirm dialog, and `POST .../execute` runs it only
  with that token. POSTs require the existing `x-ruang-request: 1` header (same CSRF guard as
  `access.ts`).
- Audit entries get a `write: true` flag so the Logs page can highlight them. The upstream audit log
  is in memory and keeps only the last 100 runs, so writes also get an append-only file in
  `~/.config/ruang/` (Ruang's own config, never Hermes files).
- Writes are refused by the server (and their buttons disabled in the UI, with an explanation)
  unless the access code is enabled and unlocked in this browser (decision 4).
- Successful writes clear the task-board cache so the UI reflects them at once.
- The sidebar label "READ-ONLY MODE" becomes "READ-ONLY + APPROVED ACTIONS".

## 1. Lead & Proposal Pipeline

A dedicated board, created once with a confirmed `hermes kanban boards create leads --name "Leads"`.
Each Upwork lead is one task, and agents write to it with the same CLI. Hermes statuses cannot hold our
eight stages, so the **stage is recorded as a structured comment** (`stage: Researched`, written by
`hermes kanban comment`). The latest stage comment wins, and the comment history gives timestamps for
free. A lead with no stage comment shows as **Unknown**, never guessed. A won or lost lead first gets
`stage: Won` / `stage: Lost` and is then closed with `complete --result "Won"`/`"Lost"`. The page
(`src/custom/pages/Leads.tsx`, a new menu item) reads `hermes kanban --board leads list --json`
plus `show --json` per lead (bounded concurrency, cached), and renders a column per stage.

## 2. Approval Queue

Agents put a drafted proposal or message in the task body/result and call
`hermes kanban request-review <id> --summary ...`, which moves the task to `review`. The queue lists
`review` tasks on the `leads` board with the draft text (secret-redacted, as task detail is today).
Actions, each through the guarded write path:
**Approve** = `comment -- <id> "stage: Approved"` then `complete <id> --result "Approved by owner"`.
**Request changes** = `request-changes <id> -- <reason>`.
**Reject** = `block --kind needs_input <id> -- <reason>` (Hermes appends the reason as a comment;
reversible with `unblock`).
Ruang never sends anything to Upwork itself. "Sent" is set when the owner (or an agent) records it.

## 3. Weekly Freelance Scorecard

Computed on the server from the stage history of the `leads` board: proposals sent (leads that
reached Sent this week), response rate (Interview ÷ Sent), win rate (Won ÷ (Won + Lost)), each with
the counts shown next to the percentage. A rate with a zero denominator shows "Not Available".
**Token cost per proposal** is the uncertain part. `hermes insights` reports tokens per profile per
period, not per task, so dividing it by proposals would be a guess. Before building this, check
whether `kanban show --json` runs (or `kanban runs`) carry per-run token/cost data. If they do, sum
it per lead. If not, show "Not Available" (decision 3). Once a dedicated proposal-writing profile
exists, also show that profile's tokens for the week ÷ proposals drafted that week, labelled
"Average per proposal (estimate)".

## 4. Proposal Desk room

Server: add `'Proposal Desk'` to `OfficeRoom`. In `buildOfficeSnapshot` (one marked hook), a station
whose attributed task is on the `leads` board and which is Working or Reviewing goes to the
Proposal Desk instead of its normal desk. Tasks already carry their `board`, so no extra command
runs. The rule lives in `server/custom/office.ts`. UI: the 2D office gets a room section; the 3D
office gets a desk cluster defined in `src/custom/proposal-desk-layout.ts` (coordinates, tested
like `office3d-layout.test.ts`) and drawn by a small component, with `placementFor` handling the
new `roomPosition`. An agent with no leads work never appears there, so the room shows real state
only.
