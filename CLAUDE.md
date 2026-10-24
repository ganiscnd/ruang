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

## Run, test, build

```sh
npm install
npm run build        # tsc + vite build (UI → dist/) + server build (→ build/server/)
npm start            # node bin/ruang.js → http://127.0.0.1:3001 (needs a build first)
npm run dev          # tsx watch server on 3001 + Vite dev UI (proxies /api to 3001)
npm run lint
npm test             # vitest; tests use fake command runners, never the real hermes
```

- Port: `RUANG_PORT` or `ruang --port <n>`. Use a spare port (e.g. 3011) for checks so the owner's
  own server on 3001 is not disturbed.
- Remote viewing: `ssh -L 3001:127.0.0.1:3001 kimi@<mac-mini>` (the server binds 127.0.0.1 only).
- Ruang's own config (access code, profile lock) lives in `~/.config/ruang/` (`RUANG_CONFIG_DIR`).
- Machine: Mac mini M4, Hermes Agent v0.22.4 in `~/.hermes`, profiles `default` and `leadengineer`.
  OpenCode is not installed (it shows as Not Available; that is expected).

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
