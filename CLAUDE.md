# CLAUDE.md

Personal fork of [Ruang](https://github.com/yugienugraha/ruang) (upstream v0.2.0): a 3D virtual
office and mission control for Hermes Agent, being extended into a Mission Control for a
freelance AI-automation business (see `docs/CUSTOM_ROADMAP.md`).

The owner reads Python but not JavaScript/TypeScript: explain decisions in plain language.

## Project rules

- All UI text in English.
- Never show fake, simulated or guessed data as real. Use "Unknown" / "Not Available" when data is
  not reliable.
- Keep Ruang's security model: fixed command allowlist, `execFile` (no shell), no browser input
  reaching a shell, secret redaction, 127.0.0.1 binding.
- Write actions are allowed ONLY through a small, explicit allowlist of Hermes commands, each with a
  confirmation step in the UI and an entry in the existing command audit log. Never edit Hermes
  files directly.
- Keep custom code separated from upstream code where practical (dedicated folders/modules for the
  custom features, e.g. `server/custom/`, `src/custom/`) so future upstream updates still merge.
  When an upstream file must change, keep the hook small and mark it with a `// custom:` comment.
- Inspect existing code before changing it. Do not rewrite unrelated working code.
- After every meaningful change run: `npm run lint`, `npm test`, `npm run build`. Read real errors
  before fixing.
- Make small, focused git commits with clear messages. Push to `origin` (the fork), never to
  `upstream`.
- **Privacy: the fork on GitHub is public.** Never commit personal facts, rates, client data, lead
  contents (titles, URLs, card ids, notes, agent findings) or job post text to the repo, including
  in `docs/reports/` and test fixtures. Keep them only in `~/freelance-private/` or in Hermes.
  Reports describe real runs generically ("the test lead", counts, statuses, token totals).

## Run, test, build

```sh
npm install
npm run build        # tsc + vite build (UI → dist/) + server build (→ build/server/)
npm start            # node bin/ruang.js → http://127.0.0.1:3001 (needs a build first)
npm run dev          # tsx watch server on 3001 + Vite dev UI (proxies /api to 3001)
npm run lint
npm test             # vitest; tests use fake command runners, never the real hermes
```

- **Development and test servers always use port 3002** (`RUANG_PORT=3002 npm start`, or
  `RUANG_PORT=3002 npm run dev:server`). Port 3001 belongs to the always-on instance; never start,
  stop or kill anything on 3001 except through the scripts below. When stopping a test server, stop
  that process only (never `pkill -f ruang.js`, which would also hit the service).
- Remote viewing: Tailscale (see below), or `ssh -L 3001:127.0.0.1:3001 kimi@<mac-mini>`. The server
  itself always binds 127.0.0.1 only.
- Ruang's own config (access code, profile lock) lives in `~/.config/ruang/` (`RUANG_CONFIG_DIR`).
- Machine: Mac mini M4, Hermes Agent v0.22.4 in `~/.hermes`, profiles `default` and `leadengineer`.
  OpenCode is not installed (it shows as Not Available; that is expected).

## Always-on instance (launchd)

Ruang runs whenever the Mac is on (see the power schedule below) as the LaunchAgent `com.ganiscnd.ruang` (same pattern as Hermes' own
`ai.hermes.dashboard`): `node bin/ruang.js --port 3001` from `~/projects/ruang`, using the
production build (`dist/` + `build/server/`), with `RunAtLoad` and `KeepAlive` (restarted by
launchd after a crash, 20 s throttle). `PATH` includes `~/.local/bin` so `hermes` is found. Logs:
`~/Library/Logs/ruang/ruang.log`. The plist source is `scripts/launchd/com.ganiscnd.ruang.plist`.

| Script | When to use it |
| --- | --- |
| `scripts/deploy.sh` | **After every finished feature** (after lint/test/build pass and the commit): runs `npm run build`, restarts the service with `launchctl kickstart -k`, and waits for `/api/health`. It does not `git pull`. |
| `scripts/status.sh` | Is the service running? Shows launchd state, PID, restarts, last exit, the health check, and the last 20 log lines. |
| `scripts/install-service.sh` | Only after changing the plist (or on a new machine): copies it to `~/Library/LaunchAgents`, builds, and reloads the job. |

Stop or start by hand: `launchctl bootout gui/$(id -u)/com.ganiscnd.ruang` /
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ganiscnd.ruang.plist`.

Remote access over Tailscale (tailnet only, never `tailscale funnel`): `tailscale serve --bg
--https=443 http://127.0.0.1:3001` proxies **https://abiyudhas-mac-mini.tail5349c4.ts.net/** to
the service. Check with `tailscale serve status`; undo with `tailscale serve --https=443 off`.

**Power schedule: the Mac is not on 24/7.** It runs on a scheduled smart plug: it boots when the
plug turns on (`autorestartatconnect 1`) and shuts down cleanly every day at 10:55 PM
(`pmset repeat`), a few minutes before the plug turns off. Never change power settings. Cron jobs
due while the Mac is off are missed and show as **overdue**. That is correct, real data: do not
hide, smooth over, or "fix" it.

## Architecture map

### Server (`server/`, Express 5, Node ≥ 20)

| File | What it does |
| --- | --- |
| `index.ts` | Express app on 127.0.0.1. Wires every `GET /api/*` route to a cached collector, applies per-request redaction for locked agents, serves `dist/` as the UI. |
| `mission-control.ts` | The core. **Command runner** `systemRun` (`execFile`, 8s timeout, `NO_COLOR`/`COLUMNS=200`, no shell), the **audit log** (in-memory, last 100 runs, `/api/command-log`), all **parsers** of Hermes CLI text/JSON, the **collectors** (each a fixed argv: the allowlist), the 10s **cache** (`cachedSource`, `?fresh=1` bypass), secret redaction (`redactLogLine`), and the **office state** logic (`buildOfficeSnapshot`, `roomForState`). |
| `access.ts` | Optional access code (scrypt hash, signed session cookie). POSTs need header `x-ruang-request: 1` (blocks cross-site requests). CLI: `ruang access-code status/new/off`. |
| `profile-lock.ts` | Optional 6-digit PIN that withholds chosen agents' private data per browser. |
| `privacy.ts` | Redacts locked agents' data from shared snapshots. |
| `folders.ts`, `memory.ts` | Read-only file views of each agent's folder and context/memory files, with path containment and hidden-file rules. |
| `api-version.ts` | API version the UI checks to detect a stale server. |
| `*.test.ts` | Vitest; `hermes-formats.test.ts` holds real Hermes output samples. |

The command allowlist is not a separate list: it is the fixed argv in each `collect*` function in
`mission-control.ts`. Browser input only reaches argv after strict regex checks (`PROFILE_NAME`,
`BOARD_SLUG`, `TASK_ID`). Reads that run today:

```
hermes profile list                         opencode --version (optional)
hermes kanban boards list --json            hermes kanban --board <slug> list --json
hermes kanban [--board <slug>] show <id> --json
hermes -p <profile> cron list --all         hermes sessions list --limit 20
hermes skills list --enabled-only           hermes status --all
hermes -p <profile> insights --days <1|7|30>
hermes logs <agent|gateway|errors> -n 200
hermes -p <profile> logs agent -n 80 --since 3m      hermes -p <profile> sessions list --limit 3
```

A failed run (non-zero exit, timeout, missing program) counts in the header's "CLI errors". A run
that succeeds but whose output a parser cannot read shows as an unavailable source, not as a CLI
error.

### Frontend (`src/`, React 19 + Vite, three.js via @react-three/fiber)

| File | What it does |
| --- | --- |
| `App.tsx` | Shell: drawer menu, header (sync label, refresh), access lock screen, page switch. |
| `routes.ts` | Hash routes (`#/office`, `#/task-board`, …) and the menu order. |
| `polling.ts`, `request-state.ts` | `usePolling(path, ms)`: fetch + interval + global refresh. |
| `types.ts` | UI copies of the server snapshot types (keep in sync with `mission-control.ts`). |
| `pages/Office.tsx` | Home page: 2D office (rooms → stations), HUD stats, detail dialogs; lazy-loads 3D. |
| `pages/Office3D.tsx`, `office3d-layout.ts`, `scene3d/*` | 3D office. Layout math (desks, lounge, meeting room, game room, lantai 2, walk paths) lives in `office3d-layout.ts`; positions come from each station's `room`, `roomPosition`, `seat`. |
| `pages/TaskBoard.tsx`, `Calendar.tsx`, `Activity.tsx`, `Usage.tsx`, `Logs.tsx`, `Memory.tsx`, `Folders.tsx`, `Settings.tsx`, `Agents.tsx` | One page per menu item. |
| `office-state.ts`, `agents.ts`, `format.ts`, `ui.tsx` | Badges, agent looks, formatting, shared UI pieces. |

### How office state is computed (server, `buildOfficeSnapshot`)

One station per Hermes profile (+ OpenCode if installed). Per agent, in priority order: explicit
state record → live evidence (recent `agent.log` lines / sessions active in the last 3 min) refined
by a Kanban task → Kanban task (`running` → Working, `review` → Reviewing) → active chat session
(Collaborating) → Idle only when every source is fresh, otherwise Unknown. `roomForState` maps:
Idle → Lounge; Working → assigned desk; Reviewing → review desk; Collaborating → meeting room;
Unknown → neutral presence. Each station carries `provenance` and `freshness` strings explaining why.

## Custom features (this fork)

Plans and protocol: `docs/CUSTOM_ROADMAP.md` (decisions), `docs/plans/feature1-pipeline.md`,
`docs/LEADS_PROTOCOL.md` (give this to Hermes agents). Reports: `docs/reports/`.

### Feature 1: Lead & Proposal Pipeline (`#/pipeline`)

| File | What it does |
| --- | --- |
| `server/custom/lead-format.ts` | The `[lead]` body block and `stage: <Stage>` comments: parse, write, stage history (newest counting stage wins; owner-only stages by agents ignored). |
| `server/custom/pipeline.ts` | Read-only collector for board `leads`: `boards list`, `--board leads list --json`, `show --json` per lead (max 100, 4 at a time). |
| `server/custom/validate.ts` | Validation of browser input for writes (types, lengths, no control characters, no unknown keys). |
| `server/custom/actions.ts` | **The write allowlist**: `board.setup`, `lead.create`, `lead.stage`, `lead.note`, `lead.assign`, each a fixed argv. Preview → single-use token → execute; rate limits; `write-audit.jsonl` in Ruang's config folder. |
| `server/custom/routes.ts` | `GET /api/custom/pipeline[/:id]`, `POST /api/custom/actions/{preview,execute}`; same-origin and access-code guards; profile-lock redaction. |
| `src/custom/pages/Pipeline.tsx`, `LeadDetail.tsx`, `LeadActions.tsx`, `ActionDialogs.tsx`, `use-write-action.tsx`, `write-actions.ts`, `lead-view.ts`, `types.ts`, `pipeline.css` | The page, detail dialog, action forms, confirmation dialog and display helpers. |

Upstream hooks (marked `custom:`): `server/index.ts` (`installCustom`, `accessOf`),
`server/access.ts` (`installAccess` returns `accessOf`), `server/mission-control.ts` (exports,
`write` audit option, `clearTaskBoardCache`), `src/routes.ts` (menu), `src/App.tsx` (page, sidebar
label), `src/pages/Logs.tsx` + `src/types.ts` (WRITE chip), `api-version.ts` (13).

Write rules (never weaken):
- Writes need the access code **enabled and unlocked**; otherwise buttons are disabled with the reason.
- Board pinned (`--board=leads`); options only as `--opt=value`; free text always after `--`.
- Lead cards are never assigned, blocked, triaged or put in review by Ruang. Agents work on
  separate work cards `[lead <id>] Research: …` / `Draft proposal: …`, linked with
  `link <work> <lead>` (work = parent). While a work card is open the lead sits in `todo` and cannot
  be closed (Hermes refuses `complete` while a parent is open).
- Won/Lost = `stage:` comment, then `complete --result=<Won|Lost>`. Final.
- `kanban.auto_decompose` is off in every profile (set 2026-10-24); keep it off.
- New write actions go into `actions.ts` only, with tests of their exact argv.
- Work cards carry `--skill=leads-protocol --skill=freelancer-facts` (research uses the facts only
  for the Niche fit section), `--max-runtime=15m` and `--max-retries=1` (one attempt; a failure or
  timeout blocks the card).

### Lead agents (Hermes profiles, set up 2026-10-25)

| Profile | Job | Toolsets | Skills (via `skills.external_dirs`) |
| --- | --- | --- | --- |
| `lead-researcher` | Research a lead (incl. Niche fit), comment `stage: Researched` | `web`, `skills`, `todo` | `leads-protocol`, `freelancer-facts` |
| `proposal-writer` | Draft a proposal, comment `stage: Proposal Drafted` | `web`, `skills`, `todo` | `leads-protocol`, `freelancer-facts` |

- Both are clones of `leadengineer` without messaging (no bot tokens, 0 adapters), served by the
  default profile's multiplexed gateway (it runs the kanban dispatcher and executes their cards).
  Each has a role `SOUL.md`, `agent.max_turns 30`, `agent.run_budget_seconds 600` and
  `skills.write_approval true` (an agent's skill edits are only staged).
- Assign warns when the lead already has a finished run of the same job (a new run pays again).
- Assign refuses a proposal while a research card on the lead is open (any open status except
  `blocked`) and warns when no agent `stage: Researched` comment exists (an owner-set stage does not
  count), in `researchState` (server) and `LeadActions.tsx` (UI).
- `hermes/skills/leads-protocol/SKILL.md` in this repo is the agent-facing protocol
  (`docs/LEADS_PROTOCOL.md` is the human summary; keep them in step). Edits take effect for the
  next card, no reinstall.
- `~/freelance-private/hermes-skills/freelancer-facts/SKILL.md` holds the owner's facts. It is
  private, outside the repo, written only by the owner. Never copy it into the repo.
- If none of a card's `--skill` skills exist for the assignee, Hermes refuses the run before any
  model call (`kanban_skills_unavailable`), so other profiles cannot do lead work.
- Hermes has no token cap; the caps are turns, time and one attempt. Measure real use with
  `hermes -p <profile> insights --days 1`.

### Testing writes safely

Use port 3002 and an isolated config folder with a throwaway access code, so the real
`~/.config/ruang/access.json` is never read or changed:

```sh
RUANG_CONFIG_DIR=$(mktemp -d) RUANG_PORT=3002 node bin/ruang.js
curl -c jar -H 'content-type: application/json' -H 'x-ruang-request: 1' \
  -d '{"code":"a-temporary-test-code"}' http://127.0.0.1:3002/api/access/code
```

Unit tests never run the real `hermes` (fake runners only). Real writes on the live Hermes need the
owner's OK first.
