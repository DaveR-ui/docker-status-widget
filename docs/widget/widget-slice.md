---
id: widget-slice
category: widget
tags: [slice, generality, widget, qml]
aliases: [Widget slice, QML surfaces slice]
related: [widget-index, status-slice, ui-surfaces]
version: 1.0
status: active
---

# Widget — Slice Generalities

## What this slice is

The QML layer Plasma loads: one KPackage that selects a representation, polls two commands, exposes
two contextual actions, renders a panel item and a popup, and hosts a config page. The form matters —
**the files ARE the widget**. There is no compile step, no transpile, no bundling: the bytes under
`package/io.github.daver-ui.dockerstatus/contents/` are exactly what runs.

## Boundaries

**In:** representation selection and layout; the six `P5Support.DataSource` instances and their wiring
(four for the Docker side, two for the download row); `Plasmoid.contextualActions` and the
start/stop/refresh handlers; the download handler and its observable state; i18n strings, tooltips and
`Plasmoid.title`; the severity-to-colour mapping; the kcfg entries and the `cfg_*` alias wiring; the
config page widgets.

**Out:** parsing, state and severity *decisions* belong to [status-slice](../status/status-slice.md);
the privilege grant belongs to [privilege-slice](../privilege/privilege-slice.md); installing the
package belongs to [installer-slice](../installer/installer-slice.md); linting and evidence belong to
[verification-slice](../verification/verification-slice.md). Assembling a command from configuration
is out of scope for every slice; the single sanctioned exception is the video-download command, whose
assembly lives in the [status slice](../status/status-slice.md) and whose boundary is recorded in
[ADR-0006](../adrs/adr-0006-video-downloader-command-boundary.md).

## Entry points

- `package/io.github.daver-ui.dockerstatus/contents/ui/main.qml` — start here: fixed commands, observable
  state, data sources, actions, representation wiring.
- Then the file the change actually touches: `CompactRepresentation.qml` (panel),
  `FullRepresentation.qml` (popup and desktop), `SeverityDot.qml` (colour),
  `config/ConfigGeneral.qml` (settings), `contents/config/main.xml` (the kcfg entries behind `cfg_*`).
- `metadata.json` only when the plugin's identity or advertised minimum version changes.

## How it works

`PlasmoidItem` is the root. `preferredRepresentation` is the full representation on a planar
(desktop) form factor and null in a panel, which falls back to the compact one. Six `DataSource`
instances with the `executable` engine carry every command:

| id | connectedSources | interval | role |
|---|---|---|---|
| `daemonSource` | `systemctl is-active docker` | `effectivePollIntervalMs` | the only unconditional poll |
| `containerSource` | the `docker ps -a` command while enabled, `[]` otherwise | the same interval, or `0` when disabled | polled only while the daemon is up |
| `forcedDaemonRead` | assigned on demand | `0` | one-shot immediate re-read after an action |
| `daemonAction` | assigned on demand | `0` | the privileged action, `systemctl start docker` or `systemctl stop docker`; one source serves both because only one action can be in flight |
| `homeSource` | `printf %s "$HOME"` (a constant) | `0` | one-shot at load: the shell expands `$HOME`; the result is validated before it is used |
| `downloadAction` | the assembled yt-dlp command, assigned on demand | `0` | one-shot video download; the single event at exit closes the run, and the consumer still guards and accumulates in case a future engine streams |

`effectivePollIntervalMs` is `max(1000, pollIntervalSeconds * 1000)`, so a configured sub-second
interval is silently floored. `onNewData` handlers write `root.daemonState` and `root.containers`;
when the daemon stops, `containers` is dropped, and the container source disconnects itself because
its `connectedSources` binding then evaluates to `[]`. Feedback is explicit: exit code `0` clears
`actionFeedback` and forces a daemon re-read; a non-zero exit shows `stderr` after
`normalizeOutput` has stripped CR and trimmed it, or a generic
i18n message when `stderr` is empty. Because start and stop share one one-shot source and one
`actionInFlight` flag, `actionKind` (`DockerStatus.ACTION_START` / `ACTION_STOP`) is captured when the
reply arrives so that generic fallback and the button labels name the action that actually ran. State
ownership is one-directional — `main.qml` owns state, the
representations are pure consumers of properties, and `SeverityDot.qml` owns the only colour
decision.

`downloadVideo(url)` is the one handler that accepts input. It classifies the paste with
`DockerStatus.classifyVideoUrl()` before a command exists; a refused paste sets `downloadFeedback` and
never reaches the engine. Otherwise it sets `downloadInFlight`, clears the captured output, and assigns
`downloadAction.connectedSources` with the command from `DockerStatus.buildVideoDownloadCommand()`,
which shell-quotes every value. `homeSource` exists only to feed `homeDirectory` into that builder: a
configured `~/Downloads` must be expanded to an absolute path before it is quoted. When the run ends,
`downloadFeedbackSeverity` drives the same `SeverityDot` the header uses.

## Conventions of this slice

- Commands are `readonly` constants in `main.qml`, with ONE deliberate exception: the video-download
  command. It is assembled by `DockerStatus.buildVideoDownloadCommand()` from a validated URL and
  validated configuration values, and every interpolated value is shell-quoted. Configuration never
  supplies a command; it supplies values inside one. A second exception needs a new ADR — see
  [ADR-0006](../adrs/adr-0006-video-downloader-command-boundary.md).
- The download row lives only in the full representation. It is never rendered in the panel, and its
  tooltip is attached to the `ToolButton`: `PlasmaComponents3.ToolTip` only renders when its parent is
  an `AbstractButton`.
- Every one-shot assignment goes through `DockerStatus.withRunToken()`; identical `connectedSources`
  strings are a no-op in the engine (see [data-engine-contract](../status/data-engine-contract.md)).
- Representations receive properties and emit signals. They never reach for a `DataSource`, and they
  read `Plasmoid.configuration` only for the panel icon.
- The severity-to-colour switch lives only in `SeverityDot.qml`. A new state adds a severity in
  [status-slice](../status/status-slice.md), never a colour here.
- The `cfg_*` alias target must stay a plain writable property; aliasing an expression saves nothing
  and reports nothing. A setting carried by a combo box is the exception: the initial property Plasma
  writes arrives before the control initialises, so the setting is a plain property and the control is
  seeded from it (`ConfigGeneral.qml` — the cookies browser).
- `contents/config/config.qml` resolves `source` relative to `contents/ui/`, so the config page lives
  at `ui/config/ConfigGeneral.qml` — not at `config/ConfigGeneral.qml`.

## Dependencies

**Upstream:** `dockerstatus.js` for parsing, severity and the download-command builder; `metadata.json`
and `main.xml` for plugin identity and config defaults; the probed behaviour of Plasma 6.7.4 and
plasma5support 6.7.4. **Runtime (download only):** a `yt-dlp` executable reachable on plasmashell's
`PATH`; for YouTube a JavaScript runtime (`node` or `deno`); cookies from the configured browser (default
Firefox) for X and for age-gated YouTube.
**Downstream:** the installer copies this package; the privilege slice decides whether the start
button prompts; the verification slice can lint these files but can only *observe* this slice inside
a running Plasma session.

## Known gaps & accepted debt

- `main.qml` as a `PlasmoidItem` is **not executable outside plasmashell**; the wrapper is validated
  by `qmllint` and review only.
- No QML-level automated test exists, so layout and interaction changes are reviewed rather than
  tested. The stop confirmation — its arming, half-second dwell and five-second expiry — is UI state
  inside `FullRepresentation.qml` and is covered by review alone; the Node suite pins the action
  identities and their exact `actionKind` expressions, both fixed privileged commands, and the polkit
  rule as text and as an executed default-deny predicate.
- The engine quantises `interval` to roughly one second, so polls below that are pointless.
- Container churn is visible at the poll interval, never instantly: there is no `docker events`
  subscription.
- Only `docker.service` is supported; there is no rootless or user-scoped daemon, and adding one
  would change this slice's assumptions about which command answers.
- The download row cannot be instantiated outside plasmashell either; only its command boundary is
  unit tested, so its layout and enable/disable behaviour are reviewed until they run in a session.
- The download depends on external tools the widget cannot probe for: a wrong `yt-dlp` binary or a
  missing JavaScript runtime fails at download time with yt-dlp's own message, not at load time.
