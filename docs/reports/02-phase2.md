# Report 02: Phase 2, always-on Mission Control (2026-10-24)

## Part A: small fixes

- `gh auth setup-git` run: git now uses the `gh` login, and plain `git push` works.
- `npm audit fix` (no `--force`): only `package-lock.json` changed. body-parser 2.4.0, vite 7.3.7,
  concurrently 9.2.5, undici 8.12.3, source-map-js 1.2.2. **Production dependencies: 0
  vulnerabilities.** 3 remain (vitest, @vitest/mocker, tinypool); they need the breaking vitest 5
  upgrade and only affect running the tests. Lint clean, 133/133 tests, build OK. Commit `da2bdc8`.

## Part B: always-on service

### How Hermes does it

`~/Library/LaunchAgents/ai.hermes.dashboard.plist` runs `hermes dashboard` with `RunAtLoad`,
`KeepAlive`, `ThrottleInterval 20`, an explicit `PATH`/`HOME`, a `WorkingDirectory` and one log
file for stdout and stderr. Ruang's job copies that pattern.

### The LaunchAgent `com.ganiscnd.ruang`

- Source: `scripts/launchd/com.ganiscnd.ruang.plist` (in git); installed copy:
  `~/Library/LaunchAgents/com.ganiscnd.ruang.plist`.
- Runs `/usr/local/bin/node /Users/kimi/projects/ruang/bin/ruang.js --port 3001` (production
  build), on 127.0.0.1 only. `PATH` starts with `~/.local/bin`, where `hermes` lives.
- `RunAtLoad` + `KeepAlive` (restart after any exit, at most every 20 s).
- Log: `~/Library/Logs/ruang/ruang.log`. Not rotated, but Ruang only logs its start line and
  request errors, so it stays small.

### Scripts

- `scripts/deploy.sh`: `npm run build`, then `launchctl kickstart -k gui/501/com.ganiscnd.ruang`,
  then waits for `/api/health`. No `git pull`.
- `scripts/status.sh`: launchd state, PID, number of runs, last exit, health check, last 20 log lines.
- `scripts/install-service.sh`: (re)installs the plist and reloads the job. Only needed when the
  plist changes.

### Verification

- `curl http://127.0.0.1:3001/api/health` → `{"ok":true,"apiVersion":12,…}`.
- Under launchd, `hermes` is found: both profiles listed, **CLI errors 0**, Calendar available.
- Crash test: `kill -9` on the server → launchd restarted it by itself (runs 1 → 2), healthy again.
- `scripts/deploy.sh` rebuilt and restarted it, healthy (runs → 3).
- Dev/test rule in `CLAUDE.md`: test servers use port 3002, never 3001.

## Tailscale HTTPS (done, 2026-10-24)

Before: MagicDNS on (`tail5349c4.ts.net`), HTTPS certificates off, no serve/funnel config. The
owner enabled HTTPS certificates in the admin console (`CertDomains` now lists
`abiyudhas-mac-mini.tail5349c4.ts.net`). Then, with the owner's OK:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3001
```

- URL: **https://abiyudhas-mac-mini.tail5349c4.ts.net/**
- `tailscale serve status` → `https://abiyudhas-mac-mini.tail5349c4.ts.net (tailnet only)`,
  `/ proxy http://127.0.0.1:3001`. `tailscale funnel status` shows the same "tailnet only" entry:
  no Funnel, not public.
- `curl https://abiyudhas-mac-mini.tail5349c4.ts.net/api/health` from this Mac → HTTP 200,
  certificate valid, `{"ok":true,"apiVersion":12,…}`. The very first request timed out while
  Tailscale fetched the certificate; every request after it answered in about 20 ms.
- Ruang still listens on 127.0.0.1:3001 only (checked with `lsof`); Tailscale forwards to it.
- `--bg` keeps the setting across reboots. Undo: `tailscale serve --https=443 off`.
- Certificate names are published in public Certificate Transparency logs: the name is publicly
  visible, but the service is reachable only from the tailnet.
- Still recommended: switch on the Ruang access code (Settings). It is required for write
  actions anyway (decision 4).
- Side note: Hermes' own dashboard listens on the tailnet IP directly (`100.69.40.1:9119`, plain
  HTTP).

## Power schedule (owner's setup, 2026-10-24)

The Mac mini is **not on 24/7**. It is powered by a scheduled smart plug:

- It boots by itself when the plug turns on (`autorestartatconnect 1`). `autorestart 0` (start
  after a power *failure*) does not matter for this setup.
- `pmset -g sched` → `shutdown at 10:55PM every day`: a clean shutdown a few minutes before the
  plug turns off.
- After boot: automatic login (`kimi`), then launchd starts Hermes and Ruang, and Tailscale starts
  with its app (check that "Launch at login" is on in Tailscale's settings).
- **Cron jobs due while the Mac is off are missed and show as overdue in Ruang. That is correct,
  real data**, not a bug.
- Power settings are owned by the owner: never change them.

## Earlier power check (before the owner explained the smart plug)

| Check | Current | Needed | What to do |
|---|---|---|---|
| Automatic login | **On** (user `kimi`; FileVault is off, which auto-login requires) | On | Nothing |
| Sleep | `sleep 0` (never) | Never | Nothing |
| Start after power failure | `autorestart 0` (off) | Not needed (smart plug + `autorestartatconnect 1`) | Nothing; do not change power settings |
| Other | `autorestartatconnect 1`, `womp 1` (wake for network), `powernap 1`, `displaysleep 10`, `disksleep 10` | n/a | Nothing |
| Tailscale starts at login | Could not verify from the terminal | On | Tailscale menu-bar icon → Settings → make sure "Launch at login" is on |

After a reboot: macOS logs in `kimi` automatically, then launchd starts Hermes (gateway, dashboard)
and Ruang. Tailscale starts with its app. Power-on is handled by the smart plug (see above).

Security trade-off to be aware of: auto-login with FileVault off means anyone with physical
access to the Mac mini gets your logged-in session. That is a common choice for a home server,
but it is a choice.
