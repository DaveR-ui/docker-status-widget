---
last_updated: 2026-10-18
status: active
description: Docker Status — a KDE Plasma 6 widget for the Docker daemon, what it is, how to install it, what it does, and where its documentation lives.
tags: [entry-point, index, navigation]
version: 2.0
doc_language: en
related: [project]
---

# Docker Status

**Version 1.0 — stable.**

**The two things every developer actually needs, one click away in the panel: a Docker daemon that is
running, and the meme video saved before it disappears.**

A KDE Plasma 6 widget for the Docker daemon. It tells you the state at a glance, starts the daemon without a
password prompt, stops it behind a deliberate confirmation, and downloads the YouTube or X link you just
pasted — no terminal, no browser tab, no `sudo` dance.

![The design mockup the popup follows: the daemon status card with its start/stop row, the flat grouped container rows with their per-group controls, and the Miscelánea section holding the Import content download row and the Countdown to Extinction controls](screenshots/widget-popup.png)
![The design mockup the config page follows: the Docker, Container list, Podman Desktop and Miscelánea cards](screenshots/settings-general.png)

KDE Plasma 6 on Wayland, developed and verified against **Plasma 6.7.4 / plasma5support 6.7.4 / polkit 127
on CachyOS**.

---

## Install

```bash
git clone https://github.com/DaveR-ui/docker-status-widget.git
cd docker-status-widget
./install.sh install          # the widget itself — unprivileged, reversible
./install.sh install-polkit   # optional, sudo: makes "Start daemon" passwordless
./install.sh status           # what is installed, and whether Docker is up
```

Then right-click the panel or the desktop → **Add Widgets…** → search **"Docker Status"**. On the desktop
the full widget is shown directly; in the panel it collapses to the icon and the severity dot and expands
into a popup. If it does not appear, restart plasmashell:

```bash
kquitapp6 plasmashell && kstart plasmashell
```

Installing the widget needs no root, and removing it is one command. The polkit rule is the only privileged
step, it is a separate command on purpose, and it never happens implicitly.

**Requirements:** KDE Plasma 6 (`X-Plasma-API-Minimum-Version: 6.0`), Docker with `docker.service`, and —
only for downloads — a `yt-dlp` reachable on plasmashell's `PATH`, plus a JavaScript runtime (`node` or
`deno`) for YouTube.

---

## What it does

| Surface | Content |
| --- | --- |
| Panel (compact) | Theme icon (dimmed when stopped) + severity dot |
| Popup / desktop (full) | A pinned column: the daemon status card (state, `running/total` count, start/stop row, and the refresh, Podman Desktop launch and update-indicator buttons), the scrollable grouped container list in the middle, the update notice row, and the Miscelánea card pinned at the bottom |

The popup is laid out so it never changes size as containers come and go: the status card and the
Miscelánea card stay pinned at the two ends, and the container list is the scrollable middle region.

Containers are listed **flat, grouped by their Docker Compose project**: one header row per group
carrying the project name, its running/total counter and — for compose-backed groups — small flat
play/stop buttons, each group collapsing on its own. There is no "Containers" section header, and
there is no footer.

**Miscelánea** is one collapsible card holding both the video-download row ("Import content") and the
shutdown countdown ("Countdown to Extinction"), each under its own inner title.

State is reported honestly in four levels, not two:

| State | Severity | Colour | Meaning |
| --- | --- | --- | --- |
| `active` | positive | green | the daemon is running |
| `inactive` | neutral | orange | the daemon is stopped |
| `failed` | negative | red | the unit failed |
| `unknown` (probe failed) | muted | grey | the probe could not tell |

`unknown` is deliberately *not* rendered as "stopped": a broken probe must never
look like a healthy reading.

---

## Save the meme before it disappears

The full representation has a download row: paste a YouTube or X (Twitter) link, press the button, and
`yt-dlp` fetches the video into the configured folder, reading cookies from the configured browser
(**Firefox** by default). The row exists only in the full representation — the desktop widget or the panel
popup — never in the panel icon.

The assembled command is exactly this, with every value single-quoted by `shellQuote()`:

```
'yt-dlp' --cookies-from-browser '<browser>' --js-runtimes '<runtime>' --no-playlist --no-progress -P '<dir>' -o '%(title)s [%(id)s].%(ext)s' '<url>' # plasma-run-N
```

The `--cookies-from-browser` pair is omitted entirely when the browser setting is empty, and so is
`--js-runtimes` when that setting is empty. The trailing comment is the
pre-existing `withRunToken()` mechanism that makes a repeated one-shot re-run.

Two flags are deliberate:

- `--no-playlist`: the YouTube links people paste carry `&list=...&start_radio=1`; you want *that*
  video, not the radio mix it belongs to.
- `--no-progress`: keeps the captured output small. The widget shows a busy indicator instead of a
  progress bar.

### Safety model

This is the one place user input reaches a command, and it is bounded on purpose:

- **URL validation before a command exists.** https only; the host must match exactly one of
  `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`,
  `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com`, `mobile.twitter.com`; at most 2048
  characters; once surrounding whitespace is trimmed, refused if it contains inner whitespace, a single
  quote, a double quote, a backtick, a backslash or a control character. A refused link never reaches a
  shell, and the popup says
  "Paste a YouTube or X (Twitter) link first."
- **Quoting is the actual protection.** `shellQuote()` wraps every interpolated value — URL and
  configuration alike — in single quotes and escapes an embedded quote as `'\''`. The unit tests run
  the assembled command through a real `/bin/sh` with a stub `yt-dlp` on `PATH` and assert the argv
  arrives intact.
- **Configuration supplies validated values, never a command.** A bad binary, runtime name or browser
  value falls back to its safe default; a relative or control-character download directory falls back to
  `~/Downloads`. An empty browser setting omits `--cookies-from-browser` instead of guessing.
- **yt-dlp's own configuration still applies.** There is no `--ignore-config`, so
  `~/.config/yt-dlp/config` (a PO-token plugin, a format preference) survives.

### Download prerequisites

- `yt-dlp` reachable on plasmashell's `PATH`, or an absolute path in the setting. On this machine it
  lives in `~/.local/bin`, which is on plasmashell's environment.
- For YouTube, a JavaScript runtime (`node` or `deno`). Without it, YouTube fails with
  "The page needs to be reloaded".
- Cookies from a signed-in browser for X/Twitter and for age-gated YouTube. The command passes
  `--cookies-from-browser <your setting>` (default `firefox`); leave the setting empty to send no cookies
  at all. yt-dlp resolves the browser's profile itself.

---

## Settings

Everything on the widget's config page. Every value that reaches a command is validated by
`dockerstatus.js` before it is assembled, and a value it refuses falls back to the default in this
table.

| Setting | Default | Meaning |
| --- | --- | --- |
| Poll interval (seconds) | `3` | How often the daemon state is re-read from systemd. |
| Panel icon | `folder-docker-symbolic` | Any icon name from the active theme. |
| List containers in the popup | on | Turns the container list off without hiding the count. |
| Show the download row | on | Hides the row entirely when off. |
| Download folder | `~/Downloads` | Videos are written here; `~/` expands to your home directory. |
| JS runtime | `node` | Passed as `--js-runtimes`; leave empty to omit the flag entirely. |
| yt-dlp binary | `yt-dlp` | Executable name or path; `~/` expands. |
| Cookies browser | `firefox` | Passed as `--cookies-from-browser`; accepts yt-dlp syntax such as `chrome:Default` or `firefox+gnomekeyring`. Leave empty to send no cookies. |
| Podman Desktop path | `podman-desktop` | Executable name or path behind the square launch button beside the daemon status. `~/` expands. |
| Shutdown countdown (minutes) | `15` | How long the countdown runs before the power-off; a whole number greater than 10, editable inline in the popup too. |
| Update check interval (hours) | `6` | How often the widget asks the release manifest whether a newer version exists; `0` disables the check entirely. |

## Starting and stopping the daemon

`systemctl start docker` needs root, and this widget wants that to be one click. The rule in
`polkit/49-docker-status-widget.rules` grants exactly one action id, one unit, one verb, from a local
active session only. It does not grant stop, restart, disable or mask.

Stopping is deliberately different: the stop button arms on the first click and runs on the second, behind
an expiring confirmation, and it is outside the grant, so polkit asks for your password as well. Two
safeguards on a destructive verb, on purpose.

## Updates

The widget checks a fixed release manifest on a schedule and says so when a newer version exists. The
notice is a muted line in the popup plus one indicator beside the daemon status; clicking that indicator
opens the release page. Nothing is said while the widget is current, and a failed check — offline, no
`curl`, an unreadable manifest — draws nothing at all. The manifest is generated from the same
`metadata.json` the widget is packaged with, so the version is authored exactly once.

---

## Documentation

| Document | What it holds |
| --- | --- |
| [docs/project.md](docs/project.md) | The project at a glance: stack, the areas a change lands in, commands, conventions and symptom routing. |
| [docs/widget/widget-index.md](docs/widget/widget-index.md) | The QML surfaces: representations, data sources, actions, the config page. |
| [docs/status/status-index.md](docs/status/status-index.md) | The pure logic: parsing, state, severity and the command boundaries. |
| [docs/privilege/privilege-index.md](docs/privilege/privilege-index.md) | The polkit grant that makes the start button passwordless. |
| [docs/installer/installer-index.md](docs/installer/installer-index.md) | The lifecycle CLI: install, upgrade, removal, the polkit rule. |
| [docs/verification/verification-index.md](docs/verification/verification-index.md) | How the project is proven, and the symptom-keyed write-ups. |
| [tools/README.md](tools/README.md) | The headless render harness, for previewing the widget without a Plasma session. |

## Layout

```
package/io.github.daver-ui.dockerstatus/
├── metadata.json                     # KPackageStructure: Plasma/Applet
└── contents/
    ├── config/main.xml               # kcfg entries -> cfg_* aliases
    ├── icons/dockerstatus.svg        # bundled app icon (metadata.json Icon: /icons/dockerstatus.svg)
    └── ui/
        ├── main.qml                  # PlasmoidItem: commands, polling, actions, download/update wiring, state
        ├── CompactRepresentation.qml # panel icon + severity dot
        ├── FullRepresentation.qml    # popup/desktop: pinned column — status card, scrollable grouped container list, update notice, Miscelánea
        ├── SeverityDot.qml           # single severity -> colour mapping
        ├── DockerStatusPalette.qml   # the mockup's fixed dark palette and type scale
        ├── dockerstatus.js           # pure logic incl. download boundary, unit tested in Node
        └── config/ConfigGeneral.qml  # config page (poll, icon, list, Podman path, download, countdown, updates)
polkit/49-docker-status-widget.rules
install.sh                            # lifecycle CLI
tests/dockerstatus.test.mjs
.github/                              # CI gate (test, qmllint, docs) and the Pages release workflow
site/                                 # the GitHub Pages release site, and the manifest the widget fetches
screenshots/                          # the two images above
docs/                                 # the documentation; entry point: this README, routing: docs/project.md
index.md                              # generated documentation tree (marker region, repo root)
tag-index.md                          # generated tag → docs surface (marker region, repo root)
validate.js                           # zero-dependency documentation validator: node validate.js
tools/                                # dev/verification aids — nothing here ships in the plasmoid
```

Notes on the layout:

- The config page lives in `contents/ui/config/`, and `source:` in
  `contents/config/config.qml` is resolved relative to `contents/ui/` — not
  relative to `contents/`.
- `dockerstatus.js` is deliberately free of QML types so it can run under a bare
  JavaScript engine. Keep it that way.
- A setting carried by a combo box cannot be a `cfg_*` alias: Plasma's initial write lands before the
  control initialises. `ConfigGeneral.qml` keeps `cfg_cookiesBrowser` a plain property and seeds the combo
  from it in the combo's own `Component.onCompleted`.

---

## Requirements

- KDE Plasma 6 on Wayland, developed on Plasma 6.7.4 / plasma5support 6.7.4 / polkit 127 (CachyOS).
- Docker with `docker.service`. Only that unit is supported: no rootless Docker and no user-scoped daemon.
- For downloads, the optional extras listed above: `yt-dlp`, a JavaScript runtime for YouTube, and a
  signed-in browser profile for cookies.

## License

MIT — see [LICENSE](LICENSE).
