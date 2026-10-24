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

## Tailscale HTTPS (not run yet: needs your OK)

Findings:

- CLI: `/usr/local/bin/tailscale` (a wrapper for `/Applications/Tailscale.app`), version 1.104.2,
  standalone app with its network extension active. Logged in to tailnet `ganiscnd@gmail.com`.
- This Mac: `abiyudhas-mac-mini`, tailnet IP 100.69.40.1.
- **MagicDNS: enabled** (suffix `tail5349c4.ts.net`).
- **HTTPS certificates: NOT enabled** (`CertDomains` is empty).
- No serve or funnel configuration exists. The node has no Funnel permission.

What you need to do first: in the Tailscale admin console → **DNS** → **HTTPS Certificates** →
**Enable HTTPS**. Note: certificate names are published in public Certificate Transparency logs,
so the name `abiyudhas-mac-mini.tail5349c4.ts.net` becomes publicly *visible*. It still cannot
be *reached* from outside your tailnet.

The command I want to run (after you enable HTTPS and say OK):

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3001
```

- URL you will get: **https://abiyudhas-mac-mini.tail5349c4.ts.net/**
- `serve` (not `funnel`) is tailnet-only: only devices logged in to your tailnet can open it.
  Ruang itself keeps listening on 127.0.0.1; Tailscale forwards to it locally.
- `--bg` keeps the setting across reboots and Tailscale restarts.
- Afterwards I would check: `tailscale serve status`, `tailscale funnel status` (must show no
  Funnel), and `curl https://abiyudhas-mac-mini.tail5349c4.ts.net/api/health`.
- Undo: `tailscale serve --https=443 off`.

Recommendation: switch on the Ruang access code (Settings) before or right after this. Anyone on
any device in your tailnet could otherwise open Ruang, and decision 4 needs it for write actions
anyway.

Side note: Hermes' own dashboard listens on the tailnet IP directly (`100.69.40.1:9119`, plain
HTTP), so it is already reachable from your tailnet devices without HTTPS.

## Coming back after a power cut or reboot

| Check | Current | Needed | What to do |
|---|---|---|---|
| Automatic login | **On** (user `kimi`; FileVault is off, which auto-login requires) | On | Nothing |
| Sleep | `sleep 0` (never) | Never | Nothing |
| Start after power failure | **`autorestart 0` (off)** | On | System Settings → Energy → turn on "Start up automatically after a power failure", or `sudo pmset -a autorestart 1` |
| Other | `autorestartatconnect 1`, `womp 1` (wake for network), `powernap 1`, `displaysleep 10`, `disksleep 10` | n/a | Nothing |
| Tailscale starts at login | Could not verify from the terminal | On | Tailscale menu-bar icon → Settings → make sure "Launch at login" is on |

After a reboot: macOS logs in `kimi` automatically, then launchd starts Hermes (gateway, dashboard)
and Ruang. Tailscale starts with its app. Only the Mac's power-on after a power cut is not ensured
yet (`autorestart`).

Security trade-off to be aware of: auto-login with FileVault off means anyone with physical
access to the Mac mini gets your logged-in session. That is a common choice for a home server,
but it is a choice.
