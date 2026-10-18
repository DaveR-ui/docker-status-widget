---
last_updated: 2026-10-18
status: active
description: Single entry point for the Docker Status documentation corpus — what the project is and how to navigate its docs.
tags: [entry-point, index, navigation]
version: 1.3
doc_language: en
related: [project]
---

# Docker Status

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

The full boundary and the rejected alternatives are recorded in
[ADR-0006](docs/adrs/adr-0006-video-downloader-command-boundary.md).

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

## Updates

The widget checks a fixed release manifest on a schedule and says so when a newer version exists. The
notice is a muted line in the popup plus one indicator beside the daemon status; clicking that indicator
opens the release page. Nothing is said while the widget is current, and a failed check — offline, no
`curl`, an unreadable manifest — draws nothing at all. The manifest is generated from the same
`metadata.json` the widget is packaged with, so the version is authored exactly once.

---

## How to navigate this corpus

This corpus documents the Docker Status plasmoid: its QML surfaces, its pure logic, its privilege
model, its installer and the way it is proven. The thesis is the same one every corpus in this
family states — *the files are the store*; the organization **is** the index; and health is a
routine walk of a machine-checkable catalog, not a feeling. The methodology it follows is
[documentation-onrails](https://github.com/DaveR-ui/documentation-onrails) v1.4 — an upstream
referenced by URL, never vendored. Navigation is designed, not discovered: this file is the single
entry point, every topic folder has exactly one hub, and every note is reachable in three hops or
fewer.

**Start with [`docs/project.md`](docs/project.md)** — the canonical agent-facing entry point
(overview, technology stack, the Slices routing table, commands, conventions, domain entities,
context index, common lookups). This README is the single human entry point; there is no second
"start here".

| File | Purpose | When to read |
|---|---|---|
| [docs/project.md](docs/project.md) | Canonical agent-facing entry point: overview, stack, Slices routing table, commands, conventions, domain entities, context index, common lookups. | First, if you are an agent; whenever you need to know where a task lands. |
| [docs/widget/widget-index.md](docs/widget/widget-index.md) | Hub for the QML surfaces slice. | Changing anything Plasma renders. |
| [docs/widget/widget-slice.md](docs/widget/widget-slice.md) | Slice map: boundaries, flows, conventions, known gaps. | Before touching the representations or the config page. |
| [docs/widget/ui-surfaces.md](docs/widget/ui-surfaces.md) | UI inventory sheet: which surface to pick, and what each one is. | Choosing where a change belongs in the UI. |
| [docs/status/status-index.md](docs/status/status-index.md) | Hub for the pure-logic slice. | Changing parsing, state, severity or a command boundary. |
| [docs/status/status-slice.md](docs/status/status-slice.md) | Slice map for the pure logic. | Before changing `dockerstatus.js`. |
| [docs/status/data-engine-contract.md](docs/status/data-engine-contract.md) | Interface-surface sheet: the `executable` engine payload and set semantics. | When a data source behaves unexpectedly. |
| [docs/privilege/privilege-index.md](docs/privilege/privilege-index.md) | Hub for the scoped polkit grant. | Touching privilege or the passwordless start. |
| [docs/privilege/privilege-slice.md](docs/privilege/privilege-slice.md) | Slice map for the grant. | Before widening or narrowing what a local user may do. |
| [docs/installer/installer-index.md](docs/installer/installer-index.md) | Hub for the lifecycle CLI slice. | Changing install, upgrade or removal. |
| [docs/installer/installer-slice.md](docs/installer/installer-slice.md) | Slice map for the lifecycle CLI. | Before changing `install.sh`. |
| [docs/verification/verification-index.md](docs/verification/verification-index.md) | Hub for how the project is proven. | Running the tests, auditing evidence, chasing a symptom. |
| [docs/verification/verification-slice.md](docs/verification/verification-slice.md) | Slice map for the evidence layers and their limits. | Deciding what a claim rests on. |
| [docs/verification/troubleshooting.md](docs/verification/troubleshooting.md) | Symptom-keyed write-ups. | Resolving an exact error or symptom string. |
| [docs/verification/render-preview.md](docs/verification/render-preview.md) | The `tools/` render harness and its capture tiers. | Seeing the widget without a Plasma session. |
| [docs/protocols/new-note-protocol.md](docs/protocols/new-note-protocol.md) | Procedure: add a note to this corpus and keep validation green. | Before writing any documentation here. |
| [docs/protocols/bootstrap-protocol.md](docs/protocols/bootstrap-protocol.md) | Procedure: bootstrap or audit the corpus skeleton. | When starting or restructuring the docs. |
| [docs/adrs/adr-index.md](docs/adrs/adr-index.md) | Hub for the append-only decision records. | When questioning *why* the corpus is shaped this way. |
| [tools/README.md](tools/README.md) | The dev and verification aids (headless render harness). | Rendering the widget without plasmashell. |
| [index.md](index.md) | Generated tree and stats of the whole corpus (region `index`). | To see everything the corpus holds. |
| [tag-index.md](tag-index.md) | Generated tag → docs surface (region `tags`). | When the vocabulary is unknown — search by tag. |
| [validate.js](validate.js) | Zero-dependency corpus validator. Run `node validate.js` (read-only) or `node validate.js --write` (regenerate the two indexes), from the repo root. | Before every change; after adding or moving docs. |

### Folders

| Folder | Hub | What it holds |
|---|---|---|
| `docs/widget/` | [widget-index.md](docs/widget/widget-index.md) | The QML surfaces slice and its UI inventory sheet. |
| `docs/status/` | [status-index.md](docs/status/status-index.md) | The pure-logic slice and the data engine contract sheet. |
| `docs/privilege/` | [privilege-index.md](docs/privilege/privilege-index.md) | The scoped polkit grant slice. |
| `docs/installer/` | [installer-index.md](docs/installer/installer-index.md) | The lifecycle CLI slice. |
| `docs/verification/` | [verification-index.md](docs/verification/verification-index.md) | How the project is proven, and the symptom write-ups. |
| `docs/adrs/` | [adr-index.md](docs/adrs/adr-index.md) | Append-only decision records: the archaeology of *why*. |
| `docs/protocols/` | — (schema folder) | The corpus's procedures: bootstrap and new-note. |
| `docs/templates/` | — (schema folder) | The copyable shapes: note, hub, ADR, project entry, slice generalities, and the three registered doc classes. |
| `tools/` | — (no hub) | Dev and verification aids; nothing here ships in the plasmoid. |

Schema folders have no hub on purpose: their files register in the navigation tables above instead.

### Generated navigation

- [index.md](index.md) — tree, counts and ids for the whole corpus.
- [tag-index.md](tag-index.md) — tag → documents, for when the vocabulary is unknown.

Both live at the repository root and are written by `node validate.js --write` into marker-delimited
regions, write-if-diff. Human text outside the markers survives regeneration; text **inside** them
is rebuilt, never rescued — if it is lost, rerun the generator.

### Rules of this corpus

- Every corpus file and folder name is **lower-case**; ids are slugs. The conventional `README.md`
  is the one exemption.
- Notes carry the 7 required frontmatter keys and the 7 verbatim body sections; context docs carry
  their own lighter key set, with `doc_language` on the entry points.
- `related` uses **ids**; wikilinks and body links use **filename stems**. One resolver accepts both,
  case-insensitively.
- One hub per folder; a note missing from its hub, an unresolvable link, or a duplicate id is an
  **error** at review. Warnings (no H1, `category` ≠ folder, near-duplicate body) advise without
  blocking.
- Nothing is documented per file: the map scales with areas, not with the size of the territory.
- The methodology is **referenced by URL**, never vendored: the normative prose lives in
  [documentation-onrails](https://github.com/DaveR-ui/documentation-onrails), and this corpus keeps
  the shapes its templates encode.

### Schema layer

| Template | Instantiate it when |
|---|---|
| [templates/document-template.md](docs/templates/document-template.md) | Creating any note. |
| [templates/hub-template.md](docs/templates/hub-template.md) | Creating any folder's `<folder>-index.md`. |
| [templates/adr-template.md](docs/templates/adr-template.md) | Recording a decision under `docs/adrs/`. |
| [templates/project-md-template.md](docs/templates/project-md-template.md) | Starting (or auditing) `docs/project.md`. |
| [templates/slice-generalities-template.md](docs/templates/slice-generalities-template.md) | Building the map of a slice. |
| [templates/ui-inventory-template.md](docs/templates/ui-inventory-template.md) | Adding a surface readers must choose among. |
| [templates/interface-surface-template.md](docs/templates/interface-surface-template.md) | Documenting a group's surfaces or a payload contract. |
| [templates/troubleshooting-template.md](docs/templates/troubleshooting-template.md) | Writing up a symptom that can recur. |

| Protocol | Walks |
|---|---|
| [protocols/new-note-protocol.md](docs/protocols/new-note-protocol.md) | One note, before it merges. |
| [protocols/bootstrap-protocol.md](docs/protocols/bootstrap-protocol.md) | A whole corpus, when structure changes. |

### Decision records

| Record | Decision |
|---|---|
| [adrs/adr-0001-corpus-location-and-entry-point.md](docs/adrs/adr-0001-corpus-location-and-entry-point.md) | The corpus lives in `docs/`; `readme.md` is the entry point, `project.md` the agent-facing one. Its router clause is superseded by [ADR-0018](docs/adrs/adr-0018-onrails-v1-4-retrofit.md). |
| [adrs/adr-0002-lowercase-naming-convention.md](docs/adrs/adr-0002-lowercase-naming-convention.md) | Every name under `docs/` is lower-case, and the validator is vendored and adapted to match. Its validator-location clause is superseded by [ADR-0018](docs/adrs/adr-0018-onrails-v1-4-retrofit.md). |
| [adrs/adr-0003-slice-taxonomy.md](docs/adrs/adr-0003-slice-taxonomy.md) | The five slices, and the evidence each one rests on. |
| [adrs/adr-0004-scoped-polkit-grant.md](docs/adrs/adr-0004-scoped-polkit-grant.md) | Privilege is granted by one scoped polkit rule, not by `pkexec` per click or a sudoers entry. |
| [adrs/adr-0005-doc-classes-and-body-shape-exceptions.md](docs/adrs/adr-0005-doc-classes-and-body-shape-exceptions.md) | Four doc classes are registered here, with an explicit body-shape exception; the checklist half of the registry is retired by [ADR-0018](docs/adrs/adr-0018-onrails-v1-4-retrofit.md). |
| [adrs/adr-0006-video-downloader-command-boundary.md](docs/adrs/adr-0006-video-downloader-command-boundary.md) | The video-download row is the one sanctioned exception to the fixed-command rule. |
| [adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md](docs/adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md) | A stop button that confirms on a second click, with the polkit grant deliberately left at `["start"]` so stop prompts while start does not. |
| [adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md](docs/adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md) | The cookies browser becomes a validated setting, reversing ADR-0006's browser-constancy clause; the bottom text is configuration, and the stop button gets a fixed narrow width. Its bottom-text clause is superseded by [ADR-0020](docs/adrs/adr-0020-footer-removal-and-pinned-popup-layout.md), which removes the bottom text and the footer entirely. |
| [adrs/adr-0009-widget-owned-shutdown-countdown.md](docs/adrs/adr-0009-widget-owned-shutdown-countdown.md) | A widget-owned "Countdown to Extinction" shutdown: the power-off is a fixed command, the duration is a validated setting that never reaches it, and, unlike the docker stop, it does not prompt. Its inline-field rejection is superseded by ADR-0010. |
| [adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md](docs/adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md) | The shutdown minutes become an inline field in the representation: it emits a value-carrying signal and `main.qml` stays the only writer of the kcfg entry; the duration still never reaches a shell. |
| [adrs/adr-0011-fixed-dark-palette-from-mockup.md](docs/adrs/adr-0011-fixed-dark-palette-from-mockup.md) | The widget paints the mockup's fixed dark palette and type scale instead of following the Kirigami theme: a deliberate override that reverses the colour half of the SeverityDot rule (severity still resolves only in `SeverityDot.qml`), switches the popup to its own card, and makes the action buttons equal width. |
| [adrs/adr-0013-widget-update-check-and-release-site.md](docs/adrs/adr-0013-widget-update-check-and-release-site.md) | The installed widget learns an update exists from one local file and one fixed https manifest — a human-approved reversal of the "no network code" goal — and a GitHub Pages site publishes that manifest, generated from `metadata.json` so the version is authored once; the sixth-slice question for `site/` and `.github/` is left to the human. |
| [adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md](docs/adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md) | Containers group by the `com.docker.compose.project` label — the no-project bucket is a group like any other — a per-project play/stop runs a label-filtered `docker start\|stop` as a new container-level mutation, and the Podman Desktop path is one validated setting quoted into a fixed command; the polkit grant stays at `["start"]`. Its Podman Desktop UI-section clause is superseded by ADR-0016, which removes the popup section while retaining the builders, kcfg entry and tests. |
| [adrs/adr-0015-update-indicator-opens-the-release-page.md](docs/adrs/adr-0015-update-indicator-opens-the-release-page.md) | An exclamation-mark indicator beside the daemon status, shown only while an update exists, opens the widget's fixed Pages URL on one click — superseding only ADR-0013's "not a link" clause, with the silence contract and the fixed-URL rule left standing. |
| [adrs/adr-0016-containers-flat-rows-and-podman-section-removal.md](docs/adrs/adr-0016-containers-flat-rows-and-podman-section-removal.md) | The Containers header and its collapse flag are removed and group rows go flat per the mockup; the Podman Desktop section is deleted while its builders, kcfg entry and tests are retained — superseding ADR-0014's UI-section clause, with the compose boundary left standing. |
| [adrs/adr-0017-podman-launch-button-and-topbar-removal.md](docs/adrs/adr-0017-podman-launch-button-and-topbar-removal.md) | The Podman Desktop launch returns as a square button beside the daemon-status label, and the "Workspace" topbar is removed — superseding ADR-0016's Podman Desktop UI-removal clause, with the flat container rows still standing. |
| [adrs/adr-0018-onrails-v1-4-retrofit.md](docs/adrs/adr-0018-onrails-v1-4-retrofit.md) | The corpus is retrofitted to documentation-onrails v1.4: the root `README.md` becomes the single entry point, the procedure container becomes `docs/protocols/`, the validator and the generated artifacts move to the repo root, and the methodology is cited by URL. |
| [adrs/adr-0019-miscelanea-section-merge.md](docs/adrs/adr-0019-miscelanea-section-merge.md) | The popup's video-download block and its "Countdown to Extinction" block merge into one collapsible "Miscelánea" section under a single toggle, each keeping its own inner title, with one local flag and one derived gate replacing the two per-block flags — so an armed countdown can never be collapsed away. The config page merges its two cards the same way. It supersedes nothing. |
| [adrs/adr-0020-footer-removal-and-pinned-popup-layout.md](docs/adrs/adr-0020-footer-removal-and-pinned-popup-layout.md) | The popup's footer and its configurable bottom text are deleted end to end (kcfg entry and config control included), and the popup becomes a pinned column — status card on top, Miscelánea at the bottom, the container list as a scrollable middle region floored at one and a half rows — so the widget no longer resizes as the list grows. Its bottom-text clause supersedes only ADR-0008's. |

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
docs/                                 # documentation corpus — entry point: this README; routing: docs/project.md
index.md                              # generated corpus tree (marker region, repo root)
tag-index.md                          # generated tag → docs surface (marker region, repo root)
validate.js                           # zero-dependency corpus validator: node validate.js
tools/                                # dev/verification aids — nothing here ships in the plasmoid
```

Notes on the layout, both learned the hard way:

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
