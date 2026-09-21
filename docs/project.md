---
last_updated: 2026-09-21
status: active
description: Agent-facing entry point for the Docker Status plasmoid — stack, slices, commands, conventions, vocabulary and symptom routing.
tags: [project, entry-point, routing, slices]
version: 1.0
doc_language: en
---

# Project Entry Point — Docker Status

## Overview

Docker Status is a KDE Plasma 6 plasmoid (panel widget, and full widget on the desktop)
that reports whether the Docker daemon is running, starts it with one click, and stops it behind a
confirmation. Its form is a KPackage of QML files, one polkit rule, and one Bash installer: no build
step, no service of its own, no database, no network code. The widget is a read-mostly observer of two
external commands — `systemctl is-active docker` and `docker ps -a` — and the only mutations it can
perform are `systemctl start docker.service`, passwordless through a deliberately narrow privilege
grant; `systemctl stop docker.service`, which is deliberately not covered by that grant and so goes
through polkit's interactive password prompt; and `systemctl poweroff`, which runs only when a
widget-owned countdown expires and, unlike the stop, does not prompt.

Anti-goals, stated so nobody adds them by accident: no stop on a single click — stopping the daemon is
destructive to every running container, so the stop button arms on the first click and runs on the
second, with an expiring confirmation ([[adr-0007-stop-button-confirmation-and-narrow-grant]]); no stop
without the interactive polkit prompt, and no widening of the grant for stop — `ALLOWED_VERBS` stays
`["start"]`; no scheduled or systemd-owned shutdown — the countdown is widget-owned, so a reload cancels
it; no countdown of 10 minutes or less, and no unvalidated duration — the configured minutes size a
local deadline and never reach the fixed `systemctl poweroff` command
([[adr-0009-widget-owned-shutdown-countdown]]); no polkit rule for the power-off and no widening of the
grant for it — unlike the docker stop it does not prompt, so the countdown and the Cancel button, not a
password, are the safeguard; no restart/disable/mask button; no stop entry in the context menu, because
a menu is also a one-click surface; no rootless or user-scoped daemon support; no `docker events` subscription (state
is polled, not streamed); no command string taken from configuration — the single sanctioned exception
is the video-download row, where configuration supplies only validated values inside a command the
widget builds ([[adr-0006-video-downloader-command-boundary]]); no privileged work in the installer
beyond the explicit `install-polkit` command.

## Technology Stack

| Layer | Technology | Version / posture |
|---|---|---|
| QML runtime | KDE Plasma 6 plasmoid API | `X-Plasma-API-Minimum-Version: 6.0`; verified on Plasma 6.7.4 |
| Data engine | `org.kde.plasma.plasma5support` `DataSource`, `executable` engine | verified on plasma5support 6.7.4 |
| UI toolkit | QtQuick + Kirigami + PlasmaComponents3 | imported by module URI; no pinned patch version |
| Core logic | plain JavaScript, `.pragma library` | ES5 style on purpose — must run under a bare engine |
| Privilege | polkit JavaScript rule | verified on polkit 127; `isInGroup` method/boolean shim |
| Packaging | KPackage `Plasma/Applet` via `kpackagetool6` | plain-copy fallback when unavailable |
| Installer | Bash with `set -euo pipefail` | system `bash`, no shell framework |
| Tests | Node.js `node --test` | zero dependencies; no `package.json`, no `npm install` |
| Architecture pattern | thin QML shell + pure-function core + external privilege boundary | logic is testable without Plasma |

## Slices

| Slice | Description | Keywords | Entry points | Primary agents |
|---|---|---|---|---|
| widget | The QML surfaces Plasma renders: representations, actions, polling wiring, download row, shutdown countdown, config page | plasmoid, qml, representation, popup, icon, dot, layout, config, tooltip, download, yt-dlp, video, shutdown, countdown, poweroff | package/io.github.daver-ui.dockerstatus/contents/ | coder, tester |
| status | Pure parsing, state and severity logic, plus the download command boundary and the shutdown-duration resolver; zero dependencies | parse, severity, systemctl, is-active, unknown, summarize, container, run token, shell quote, url, yt-dlp, shutdown, countdown, poweroff | package/io.github.daver-ui.dockerstatus/contents/ui/dockerstatus.js | coder, tester, reviewer |
| privilege | The single scoped polkit grant that makes the start button passwordless | polkit, privilege, wheel, manage-units, password, sudo, pkexec | polkit/49-docker-status-widget.rules | reviewer |
| installer | The lifecycle CLI: install, remove, grant, report, run tests | install, kpackagetool6, uninstall, status, plasmoid, reversible | install.sh | coder, tester |
| verification | How the project is proven: test harness, linters, probe evidence, symptom routing | test, qmllint, probe, evidence, symptom, troubleshoot | tests/dockerstatus.test.mjs, verification/troubleshooting.md | tester, reviewer |

## Commands

| Command | Purpose |
|---|---|
| `./install.sh install` | Install or upgrade the plasmoid for the current user. Unprivileged, reversible. |
| `./install.sh status` | Report plasmoid, polkit rule and docker unit state. Exits 0 even when nothing is installed. |
| `./install.sh uninstall` | Remove the plasmoid. Remove it from the panel first. |
| `./install.sh install-polkit` | Install the polkit rule into `/etc/polkit-1/rules.d/`. Escalates with `sudo` internally. |
| `./install.sh remove-polkit` | Remove the polkit rule. |
| `./install.sh test` | Run the Node unit tests (`node --test tests/`). |
| `node --test tests/` | Same tests without the wrapper. |
| `qmllint package/io.github.daver-ui.dockerstatus/contents/ui/*.qml` | Lint every QML file. |
| `node docs/validate.js` | Walk the documentation catalog. Read-only; exit 1 on errors. |
| `node docs/validate.js --write` | Regenerate the two generated regions (write-if-diff), then validate. |

Working-directory quirks: `install.sh` resolves every path from its own directory and
`docs/validate.js` from the directory containing itself, so both work from any cwd. QML files are
not runnable from a shell — see Common Lookups.

## Repository Structure

```
package/io.github.daver-ui.dockerstatus/      the plasmoid KPackage — what Plasma loads
├── metadata.json                     KPackageStructure: Plasma/Applet, id, version
└── contents/
    ├── config/main.xml               kcfg entries -> cfg_<entry> aliases
    ├── config/config.qml             config page registration (source is relative to contents/ui/)
    ├── icons/dockerstatus.svg        bundled app icon, referenced by metadata.json Icon (/icons/dockerstatus.svg)
    └── ui/
        ├── main.qml                  PlasmoidItem: fixed commands, polling, actions, download wiring, state
        ├── CompactRepresentation.qml panel: icon + severity dot
        ├── FullRepresentation.qml    popup/desktop: state, list, start/stop action row, feedback, download row, shutdown countdown, tagline
        ├── SeverityDot.qml           the single severity -> theme colour mapping
        ├── dockerstatus.js           pure logic, no QML types, unit tested
        └── config/ConfigGeneral.qml  config page widgets (poll, icon, list, download settings)
polkit/49-docker-status-widget.rules  the scoped privilege grant (installed by hand)
tests/dockerstatus.test.mjs           Node harness over the shipped dockerstatus.js
install.sh                            lifecycle CLI
docs/                                 this corpus — entry: readme.md, routing: project.md
```

## Key Conventions

- Executed commands are **fixed constants in `main.qml`**, with one deliberate exception: the
  video-download command. It is built in `dockerstatus.js` from a validated URL and validated
  configuration values, and every interpolated value is shell-quoted. Configuration never supplies a
  command, only values inside one ([[adr-0006-video-downloader-command-boundary]]). The run-token trick
  appends a shell comment, which is safe only for strings this project builds itself.
- Every one-shot assignment goes through `withRunToken()`: the `executable` engine treats
  `connectedSources` as a **set**, so an identical command string is not re-executed.
- `dockerstatus.js` carries no QML types and no side effects; keep it ES5-style. The test harness
  strips only the `.pragma library` line and evaluates the shipped bytes.
- Severity is decided in `dockerstatus.js`; QML only maps severity onto theme colours. That mapping
  lives in `SeverityDot.qml` and nowhere else.
- `unknown` is a first-class state and must never render as "stopped": it gets the muted colour,
  never the neutral one.
- Privilege is granted only by the polkit rule: one action id, one unit (`docker.service`), one verb
  (`start`), local and active session, `wheel` group. Never replace the verb lookup with a wildcard.
  The stop button is deliberately outside this grant and always prompts; adding `stop` to the verb
  array is a security decision, not a fix ([[adr-0007-stop-button-confirmation-and-narrow-grant]]).
- The plasmoid install and the privilege grant are two separate commands; the privileged one is
  never implicit.
- Frontmatter keys are never invented: membership rides on `tags`, ownership on `category`.
- Every file and folder name under `docs/` is lower-case. Wikilinks use filename stems; `related`
  uses ids.

## Domain Entities

- **Daemon state** — one of `active` / `inactive` / `failed` / `unknown`, from the stdout of
  `systemctl is-active docker`.
- **Severity** — one of `positive` / `neutral` / `negative` / `muted`; the single answer to "how bad
  is this state".
- **Container** — `{ name, state }`, parsed from `docker ps -a --format '{{.Names}}|{{.State}}'`.
- **Run token** — a unique trailing shell comment (`# plasma-run-N`) that makes a repeated command a
  distinct source for the `executable` engine.
- **Video link** — the raw text pasted into the download row; accepted only as an `https` URL on the
  exact host allow-list, at most 2048 characters long, with no whitespace, quote, backtick, backslash
  or control character.
- **Video kind** — `youtube` or `twitter`, decided by the link's host; it drives the in-progress
  message and nothing else.
- **Download job** — one `downloadAction` one-shot: a yt-dlp command whose `stdout`/`stderr` accumulate
  across events until the event carrying `exit code` closes it.
- **Shutdown countdown** — widget-owned state: a `Date.now()` wall-clock deadline plus a one-second
  ticker, armed by play and cancelled locally by stop (no privilege). The configured minutes size the
  deadline only and never reach the fixed `systemctl poweroff` command.
- **Shell quote** — `shellQuote()`'s single-quote wrapping with `'\''` escaping; the protection that
  keeps a pasted value one inert shell argument.
- **Data engine** — the `plasma5support` `DataSource` with the `executable` engine.
- **Polkit action** — `org.freedesktop.systemd1.manage-units`, scoped to unit `docker.service` and
  verb `start`.
- **Slice** — a code area a human demarcated; the routing unit of this corpus.
- **Hub** — the single `<folder>-index.md` that registers every note in its folder.
- **Generated region** — the marker-delimited block of `index.md` / `tag-index.md` that
  `validate.js` rewrites.

## Context Index

- [widget/widget-slice.md](widget/widget-slice.md) — the QML surfaces slice: boundaries, flows, gaps.
- [widget/ui-surfaces.md](widget/ui-surfaces.md) — UI inventory sheet: which surface to pick.
- [status/status-slice.md](status/status-slice.md) — the pure-logic slice.
- [status/data-engine-contract.md](status/data-engine-contract.md) — interface-surface sheet: the
  `executable` engine payload and set semantics.
- [privilege/privilege-slice.md](privilege/privilege-slice.md) — the polkit grant slice.
- [installer/installer-slice.md](installer/installer-slice.md) — the lifecycle CLI slice.
- [verification/verification-slice.md](verification/verification-slice.md) — how the project is
  proven, layer by layer.
- [verification/troubleshooting.md](verification/troubleshooting.md) — symptom-keyed write-ups.
- [adrs/adr-index.md](adrs/adr-index.md) — decision records, append-only.
- [templates/document-template.md](templates/document-template.md) — the note contract, copyable.
- [checklists/new-note-checklist.md](checklists/new-note-checklist.md) — walk one note before merging.

## Common Lookups

- "the Start daemon button does nothing on the second click" →
  [troubleshooting.md](verification/troubleshooting.md#the-start-daemon-button-does-nothing-on-the-second-click)
- "the start button asks for a password every time" →
  [troubleshooting.md](verification/troubleshooting.md#the-start-button-asks-for-a-password-every-time)
- "the stop button asks for a password" →
  [troubleshooting.md](verification/troubleshooting.md#the-stop-button-asks-for-a-password)
- "the stop button needs two clicks" →
  [troubleshooting.md](verification/troubleshooting.md#the-stop-button-needs-two-clicks)
- "the widget shows a grey dot instead of a stopped daemon" →
  [troubleshooting.md](verification/troubleshooting.md#the-widget-shows-a-grey-dot-instead-of-a-stopped-daemon)
- "the container list is empty while the daemon is running" →
  [troubleshooting.md](verification/troubleshooting.md#the-container-list-is-empty-while-the-daemon-is-running)
- "Docker Status does not appear in Add Widgets" →
  [troubleshooting.md](verification/troubleshooting.md#docker-status-does-not-appear-in-add-widgets)
- "Could not create attached properties object 'PlasmaQuick::PlasmoidAttached'" →
  [troubleshooting.md](verification/troubleshooting.md#could-not-create-attached-properties-object-plasmaquickplasmoidattached)
- "Docker does not come back after a reboot" →
  [troubleshooting.md](verification/troubleshooting.md#docker-does-not-come-back-after-a-reboot)
- "the download row is missing or its button is greyed out" →
  [troubleshooting.md](verification/troubleshooting.md#the-download-row-is-missing-or-its-button-is-greyed-out)
- "YouTube fails with The page needs to be reloaded" →
  [troubleshooting.md](verification/troubleshooting.md#youtube-fails-with-the-page-needs-to-be-reloaded)
- "yt-dlp: not found" →
  [troubleshooting.md](verification/troubleshooting.md#yt-dlp-not-found)
- "Sign in to confirm you're not a bot" →
  [troubleshooting.md](verification/troubleshooting.md#sign-in-to-confirm-youre-not-a-bot)
- "the download finished but no file appeared" →
  [troubleshooting.md](verification/troubleshooting.md#the-download-finished-but-no-file-appeared)
- "the cookies browser setting shows brave after opening the options" →
  [troubleshooting.md](verification/troubleshooting.md#the-cookies-browser-setting-shows-brave-after-opening-the-options)
- "the shutdown play button stays disabled" →
  [troubleshooting.md](verification/troubleshooting.md#the-shutdown-play-button-stays-disabled)
- "the machine powers off without asking for a password" →
  [troubleshooting.md](verification/troubleshooting.md#the-machine-powers-off-without-asking-for-a-password)
