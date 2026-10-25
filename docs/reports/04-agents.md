# Report 04: Lead agents and the first research runs (2026-10-25)

Set up as approved: two dedicated Hermes profiles (`lead-researcher`, `proposal-writer`), the
`leads-protocol` skill, cost caps on work cards, and a blank private facts template. Then the owner
ran test C from the browser. This report follows the public-repo privacy rule: it names no lead,
URL, card id, job text or finding.

## Setup (part A and B)

| Item | Result |
|---|---|
| Profiles | Cloned from `leadengineer` without messaging: no bot tokens, no platform settings, "0 adapter(s) connected". Served by the default profile's multiplexed gateway, which also runs the kanban dispatcher. |
| Telegram | Only `default` has a bot. It stayed `connected` throughout (timestamp unchanged). Short network blips before and after the change recovered by themselves. |
| Toolsets | `web`, `skills`, `todo` only (before: 18, incl. terminal, file, computer use, browser, memory). |
| Limits | `agent.max_turns` 150 → 30, `agent.run_budget_seconds` null → 600; cards: `--max-runtime=15m --max-retries=1`. |
| Skills | `leads-protocol` (repo) for both; `freelancer-facts` (private, outside the repo) for `proposal-writer`. Loaded through `skills.external_dirs`, force-loaded per card with `--skill`. |
| Skill protection | `curator pin` is refused for outside-folder skills (the curator never touches them). Instead `skills.write_approval true`: an agent's skill edits are only staged. |
| Ruang | Assign adds the skills and limits and preselects the dedicated profile; notes take 6000 characters; a too-large request gets a clear 413 instead of a 500. |

## Test C: what happened

The owner confirmed **Assign to agent** three times (Ruang's write audit: three `lead.assign`
entries, plus one `lead.note` with the pasted job post between the first and second).

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Job text available | No | Yes (owner note) | Yes (owner note) |
| Wait from Confirm to start | 19 s | 58 s | 32 s |
| Run time | 25 s | 54 s | 26 s |
| Model calls / tool calls | 5 / 5 | 5 / 5 | 5 / 5 |
| Upwork page (`web_extract`, 1 attempt) | Blocked (403) | Read | Read |
| Input tokens (uncached) | 12 | 12 | 12 |
| Output tokens | 2,307 | 5,618 | 4,110 |
| Cache read tokens | 96,040 | 117,101 | 143,088 |
| Cache write tokens | 26,478 | 36,034 | 23,702 |
| **Total tokens** | **124,837** | **158,765** | **170,912** |
| Cost at list price (estimate) | ≈ $0.0054 | ≈ $0.0085 | ≈ $0.0064 |

- Token figures are Hermes' own records per session (`lead-researcher` `state.db`, source `kanban`).
- Hermes recorded **no cost** (`cost_status: unknown`). The estimate uses Hermes' cached Anthropic
  list price for claude-haiku-5-5 (per million tokens: input $0.10, output $0.50, cache read $0.01,
  cache write $0.125; every call stayed under the 100k-context tier). It is not a bill: how this API
  key is billed is Not Available here. Three runs together: about $0.02.
- Almost all input is the cached system prompt (SOUL, the 58-skill index, the protocol skill, the
  tool definitions). Output and cache writes drive the cost.
- The caps were never close: 5 of 30 tool calls, under 1 of 15 minutes, one attempt each.

### Why the first run showed as "#2"

Run numbers are counted per **board**, not per card. Run #1 on the `leads` board is the Feature 1
test lead's closing step (`complete --result=Lost`, no agent, no profile). The three research runs
are #2, #3 and #4, one per work card.

### Protocol compliance (all three runs)

| Rule | Result |
|---|---|
| Skill loaded | `leads-protocol` was in every run's prompt |
| Reads the lead card, including comments | Yes (`kanban_show` of the lead and of its own card) |
| Job text first, URL once, never log in | Yes: exactly one `web_extract` per run, no retry, no log-in |
| One comment on the lead, first line `stage: Researched` | Yes, one each |
| Only agent stages | Yes (`Researched` only) |
| Finish with `kanban_complete` on its own card | Yes; no review request, so no reviewer was spawned |
| Creates or links no cards; never touches the lead's status | Yes; the lead stayed unassigned and `ready` |
| Gaps marked unknown | Yes: run 1 (no text, page blocked) marked every detail unknown or Not Available |

### Did run 2 invent anything?

Checked line by line against what the agent actually received: the owner's note and the raw
`web_extract` output stored in the session.

- Every requirement, risk and question traces to the job text. Every client and job detail (spend,
  hires, proposals, duration, level, hours field, skills) appears in the extracted page.
- The agent rejected a misleading number: it saw Upwork's platform rating on the page and said it
  is not the client's rating.
- It flagged a real conflict between the post text and a page field and asked about it instead of
  picking one.
- One small interpretation: the page shows a bare "24 hours" under the client; the agent labelled it
  "response time". The page gives no label. Minor, but not literally supported.
- Run 3 read the page again and got one client detail that differs by a day from run 2's read; it
  reported both and said its read supersedes. Both values were really on the page at the time, so
  this is the page varying, not invention.

Verdict: no invented facts; one unlabelled interpretation.

## Web access in practice

The worker's `web_extract` did **not** use Perplexity, although `hermes doctor` lists Perplexity for
this profile. The log shows Hermes' free keyless services: Keenable (runs 1 and 2) and Firecrawl's
keyless tier (run 3). The first attempt was refused (403), the next two worked. So:

- Reading Upwork works sometimes, without a key, and is not reliable. The pasted job post stays the
  dependable source.
- Keyless services fetch the page on Hermes' behalf. Only the public job URL is sent.

## The `coder` profile

Not created by Ruang, by Claude Code, from a shell, or by an agent (no `profile create` in shell
histories, Claude Code transcripts, or any agent session). Hermes' log shows it was created on
2026-10-24 at 15:36:17 as a clone of `default`, with its Telegram settings stripped (0 adapters),
plus a `coder` shortcut. About 20 seconds earlier, the Hermes dashboard/desktop app on the owner's
Windows PC (on the tailnet, logged in with the dashboard password) opened new connections. It was
most likely created from that app's profile screen; the app does not log the click itself. It was
not changed.

## Known limitations and follow-ups

- Assign allows a new research card once the previous one is done, so repeated clicks run (and pay)
  again. A warning ("this lead already has N finished research runs") would help.
- Research results are visible as lead comments; a proposal draft (in the work card's completion
  summary) is not shown in Ruang yet.
- Hermes records tokens but no cost; the cost above is an estimate at list price.
- The first web read can fail; there is no way to choose the extract service per card.
- `proposal-writer` is untested; it waits for the owner's facts file.
