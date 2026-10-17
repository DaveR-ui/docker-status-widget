---
id: widget-slice
category: widget
tags: [slice, generality, widget, qml]
aliases: [Widget slice, QML surfaces slice]
related: [widget-index, status-slice, ui-surfaces]
version: 1.3
status: active
---

# Widget — Slice Generalities

## What this slice is

The QML layer Plasma loads: one KPackage that selects a representation, polls two Docker commands and a
fixed update check, exposes three contextual actions, renders a panel item and a popup, and hosts a
config page. The form matters —
**the files ARE the widget**. There is no compile step, no transpile, no bundling: the bytes under
`package/io.github.daver-ui.dockerstatus/contents/` are exactly what runs.

## Boundaries

**In:** representation selection and layout; the eleven `P5Support.DataSource` instances and their wiring
(five for the Docker side, one for the Podman Desktop launch, two for the download row, one for the power-off, two for the update check);
the grouped compose containers section and its per-group play/stop controls;
`Plasmoid.contextualActions` and the start/stop/refresh/update handlers; the download handler and its
observable state; the shutdown
countdown, its ticker, its inline minutes editor and its observable state; the update check and its
observable state, including the muted line and the update indicator it can render; i18n strings, tooltips and
`Plasmoid.title`; the
severity-to-colour mapping; the kcfg entries and the `cfg_*` alias wiring; the config page widgets.

**Out:** parsing, state and severity *decisions* belong to [status-slice](../status/status-slice.md);
the privilege grant belongs to [privilege-slice](../privilege/privilege-slice.md); installing the
package belongs to [installer-slice](../installer/installer-slice.md); linting and evidence belong to
[verification-slice](../verification/verification-slice.md). Assembling a command from configuration
is out of scope for every slice; the two sanctioned command-building exceptions are the video-download
command and the compose/Podman commands, whose
assembly lives in the [status slice](../status/status-slice.md) and whose boundaries are recorded in
[ADR-0006](../adrs/adr-0006-video-downloader-command-boundary.md) and
[ADR-0014](../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md).

## Entry points

- `package/io.github.daver-ui.dockerstatus/contents/ui/main.qml` — start here: fixed commands, observable
  state, data sources, actions, representation wiring.
- Then the file the change actually touches: `CompactRepresentation.qml` (panel),
  `FullRepresentation.qml` (popup and desktop), `SeverityDot.qml` (colour),
  `config/ConfigGeneral.qml` (settings), `contents/config/main.xml` (the kcfg entries behind `cfg_*`).
- `metadata.json` only when the plugin's identity or advertised minimum version changes.

## How it works

`PlasmoidItem` is the root. `preferredRepresentation` is the full representation on a planar
(desktop) form factor and null in a panel, which falls back to the compact one. Eleven `DataSource`
instances with the `executable` engine carry every command:

| id | connectedSources | interval | role |
|---|---|---|---|
| `daemonSource` | `systemctl is-active docker` | `effectivePollIntervalMs` | the only unconditional Docker probe |
| `containerSource` | the `docker ps -a` command while enabled, `[]` otherwise | the same interval, or `0` when disabled | polled only while the daemon is up |
| `forcedDaemonRead` | assigned on demand | `0` | one-shot immediate re-read after an action |
| `daemonAction` | assigned on demand | `0` | the privileged action, `systemctl start docker` or `systemctl stop docker`; one source serves both because only one action can be in flight |
| `composeAction` | assigned on demand | `0` | the unprivileged `docker start`/`docker stop` for one compose project, built by `DockerStatus.buildComposeProjectCommand()`; one-shot whose exit code and `stderr` are surfaced like `daemonAction`'s |
| `homeSource` | `printf %s "$HOME"` (a constant) | `0` | one-shot at load: the shell expands `$HOME`; the result is validated before it is used |
| `downloadAction` | the assembled yt-dlp command, assigned on demand | `0` | one-shot video download; the single event at exit closes the run, and the consumer still guards and accumulates in case a future engine streams |
| `podmanLaunch` | the shell-quoted resolved Podman Desktop path, assigned on demand | `0` | one-shot Podman Desktop launch behind the status card's square button, built by `DockerStatus.buildPodmanDesktopCommand()`; stays in flight for as long as the app runs — the engine delivers exactly one event, at exit — so the flag is released when it closes and a wrong path fails immediately with the binary's own message |
| `powerAction` | the fixed `systemctl poweroff`, assigned on demand | `0` | one-shot at countdown expiry; clears `shutdownInFlight` and surfaces the exit code and `stderr`; can stay alive while `systemctl` waits for the shutdown job |
| `updateCheckSource` | the fixed `updateCheckCommand` while `updateCheckIntervalHours > 0`, `[]` otherwise | `updateCheckIntervalMs` | the polled update check; the engine runs it once on connect, so the load-time check is free, and the `connectedSources` binding disconnects it (`[]`) when the interval is `0` |
| `updateCheckForced` | assigned on demand | `0` | one-shot manual re-check behind "Check for updates"; a polled source's `connectedSources` is a binding and cannot be reassigned per click, so the tokenised command rides this one instead |

`effectivePollIntervalMs` is `max(1000, pollIntervalSeconds * 1000)`, so a configured sub-second
interval is silently floored. `onNewData` handlers write `root.daemonState` and the parsed container
list, which `DockerStatus.groupContainersByComposeProject()` folds into the grouped list the popup
renders; when the daemon stops, `containers` is dropped, and the container source disconnects itself
because
its `connectedSources` binding then evaluates to `[]`. Feedback is explicit: exit code `0` clears
`actionFeedback` and forces a daemon re-read; a non-zero exit shows `stderr` after
`normalizeOutput` has stripped CR and trimmed it, or a generic
i18n message when `stderr` is empty. Because start and stop share one one-shot source and one
`actionInFlight` flag, `actionKind` (`DockerStatus.ACTION_START` / `ACTION_STOP`) is captured when the
reply arrives so that generic fallback and the button labels name the action that actually ran. State
ownership is one-directional — `main.qml` owns state, the
representations are pure consumers of properties, and `SeverityDot.qml` owns the only colour
decision.

The container list is richer than before, and the popup renders it as a flat list of grouped rows. The
probe line carries the compose project, and the list crosses into `FullRepresentation.qml` already
grouped: the popup draws one flat header row per project — the bundled Docker box glyph on a 28px tile,
the project name, the running/total counter and, for compose-backed groups only, small flat 28x28
play/stop `ToolButton`s with muted glyphs — with the same +/- affordance the merged Miscelánea section
header uses, and
the standalone group keeps its header but carries no controls. There is no section header above the
list and no section-level collapse flag: each group carries its own open/closed state last, so
per-group collapse is the surviving affordance
([[adr-0016-containers-flat-rows-and-podman-section-removal]]). A play or stop click does not build a
command in the representation: it emits a signal naming the project and the action, and `main.qml`
assembles the command with `DockerStatus.buildComposeProjectCommand()` and runs it on the `composeAction`
one-shot. The popup stays a pure consumer — everything crosses a property in and a signal out.

The popup's one remaining section-level collapsible card is the merged "Miscelánea" section
([[adr-0019-miscelanea-section-merge]]): one header (the "Miscelánea" title and the ± glyph) over one body
holding both the video-download sub-block (gated on the `showVideoDownloader` setting, as the old card
was) and the "Countdown to Extinction" sub-block (its inner title and its 35x35 timer tile moved inside the
body), each keeping its own inner title. One flag replaces the two the blocks used to carry:
`miscSectionExpanded` (local view state, default true, never persisted and never signalled) collapses both
together, and the derived `miscBodyVisible` (`miscSectionExpanded || shutdownPending`) gates the body — the
same adr-0009 semantics as the old `countdownBodyVisible`, so an armed countdown comes back whatever the
section bool says and can never be collapsed away. The renamed state stays entirely inside
`FullRepresentation.qml`: like `downloadSectionExpanded` and `countdownSectionExpanded` before it, it never
crosses into `main.qml`, and the popup remains a pure consumer. The config page merges its two cards the
same way: one "Miscelánea" card (after Podman Desktop, before Updates) whose single nested
`Kirigami.FormLayout` holds the seven download and shutdown controls in their original order, with no kcfg
entry, `cfg_*` alias, control id or tooltip changed; the page now renders six section cards.

The popup is a pinned column ([[adr-0020-footer-removal-and-pinned-popup-layout]]): the status card is its
first region and the merged Miscelánea card is its last, neither inside a scroll region, and the container
section between them is the scrollable middle region — `Layout.fillHeight: true`, its `ListView` uncapped
and clipped, and a height floor of one and a half container rows
(`containerScrollFloor: containerRowHeight * 3 / 2` = 78px) so the next row always peeks in and the widget
never resizes as the list grows. The update notice sits in a reserved one-grid-unit row between the middle
region and the pinned Miscelánea card, its text emptied rather than the label hidden, so it cannot grow the
widget either. The footer and the configurable bottom text are removed; the palette's `footerText` token
stays in `DockerStatusPalette.qml` because the palette is the mockup's fixed set, not a list of tokens in
use ([[adr-0020-footer-removal-and-pinned-popup-layout]]).

The Podman Desktop launch ADR-0014 added as the popup's fourth collapsible card, and ADR-0016 removed, is back
as a square 28x28 `ToolButton` beside the daemon-status label in the status card: `FullRepresentation.qml`
emits `podmanLaunchRequested()` and `main.qml` answers with `launchPodmanDesktop()`, running
`DockerStatus.buildPodmanDesktopCommand()` on the restored `podmanLaunch` one-shot — one source, one in-flight
flag, exit code 0 clears the feedback and anything else surfaces stderr verbatim (or a generic fallback naming
the exit code), with the button disabled while the app runs. The data-source count is eleven again
([[adr-0017-podman-launch-button-and-topbar-removal]]). The backing logic —
`DockerStatus.buildPodmanDesktopCommand()`, `DockerStatus.resolvePodmanDesktopPath()`, the `podmanDesktopPath`
kcfg entry and the `ConfigGeneral` setting — is the retained adr-0014 boundary and has a QML caller again.

`downloadVideo(url)` is the one handler that accepts input. It classifies the paste with
`DockerStatus.classifyVideoUrl()` before a command exists; a refused paste sets `downloadFeedback` and
never reaches the engine. Otherwise it sets `downloadInFlight`, clears the captured output, and assigns
`downloadAction.connectedSources` with the command from `DockerStatus.buildVideoDownloadCommand()`,
which shell-quotes every value. `homeSource` exists only to feed `homeDirectory` into that builder: a
configured `~/Downloads` must be expanded to an absolute path before it is quoted. When the run ends,
`downloadFeedbackSeverity` drives the same `SeverityDot` the header uses.

The shutdown countdown is the other stateful handler, and it is widget-owned.
`startShutdownCountdown()` arms it by setting `shutdownDeadlineMs` to `Date.now()` plus
`shutdownMinutes * 60 * 1000`; a one-second `shutdownTicker` then recomputes `shutdownRemainingSeconds`
from `Date.now()` against
that fixed deadline through `DockerStatus.shutdownRemainingSeconds()`, so a late tick cannot make the
deadline drift. At zero the ticker calls `firePowerOff()`, which runs the fixed `powerOffCommand` through
`withRunToken()` on `powerAction` and surfaces the exit code and `stderr`. `stopShutdownCountdown()` clears
the pending state locally and needs no privilege. Because the deadline lives in `main.qml`, a reload drops
it and silently cancels a pending shutdown — the intended fail-safe. `shutdownReady` derives from
`DockerStatus.resolveShutdownMinutes(Plasmoid.configuration.shutdownCountdownMinutes)`: a `null` result
disables play rather than arming a nonsense countdown. The duration is also editable inline in the popup:
the representation carries the raw stored string (`shutdownMinutesText`) and emits
`shutdownMinutesEdited(raw)` with the field text; the field seeds once, mirrors inbound stored changes
only while it is unfocused, and re-syncs a valid field value from the stored string when it loses focus
(so an external change the focused sync skipped cannot leave the two surfaces disagreeing, while invalid
user text stays visible to be fixed). `setShutdownMinutes(raw)` — the ONLY writer of the
kcfg entry — resolves through that same `DockerStatus.resolveShutdownMinutes()`, refuses a `null` value
without persisting, skips a redundant write, and otherwise writes
`Plasmoid.configuration.shutdownCountdownMinutes`. The representation validates its field through the same
resolver but reads and writes no configuration ([[adr-0010-inline-shutdown-minutes-in-the-representation]]).

The update check is the second polled source, and it is deliberately not a third command-building
exception: `DockerStatus.buildUpdateCheckCommand()` assembles `updateCheckCommand` entirely from fixed
constants, so no configuration value and no user input reaches it
([[adr-0013-widget-update-check-and-release-site]]). `handleUpdateCheck()` is the one handler both sources
deliver to; it reads only the closing event, splits the output at the marker and decides with
`DockerStatus.isUpdateAvailable()`. Every failure branch is silent by construction: offline, no `curl`, an
unreadable `metadata.json` or an unparseable manifest all clear the state and render nothing — there is no
error text anywhere in this feature. `checkForUpdates()` is the manual one-shot behind the third contextual
action ("Check for updates", `enabled: !root.updateCheckInFlight`), and it tokenises the fixed command
because a polled source's `connectedSources` is a binding. State ownership is unchanged: `main.qml` owns
`installedVersion`, `updateCheckInFlight`, `updateAvailable` and `updateFeedback`, and the
representation is a pure consumer. `FullRepresentation.qml` renders the feature as a muted, centred
line in a reserved row between the scroll region and the pinned Miscelánea card, reading
`updateFeedback`, its text emptied while no update exists so the row stays blank and the widget never
grows by a line when one appears —
plus a small flat `emblem-important` `ToolButton` beside the daemon state in the status card, on the
same `updateAvailable` gate. The line stays deliberately neither a button nor a `SeverityDot` nor a
link, but the indicator is the update feature's one sanctioned browser target: its click opens the fixed
`DockerStatus.UPDATE_PAGE_URL` release-page constant through one of the widget's two
`Qt.openUrlExternally` calls, and the URL is never configuration
([[adr-0015-update-indicator-opens-the-release-page]]). The second call site opens no browser at all: it
hands the configured download folder's `file://` URL to the desktop, which resolves it to the file
manager ([[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]).

## Conventions of this slice

- Commands are `readonly` constants in `main.qml`, with **two** recorded command-building exceptions:
  the video-download command, assembled by `DockerStatus.buildVideoDownloadCommand()` from a validated
  URL and validated configuration values with every interpolated value shell-quoted
  ([[adr-0006-video-downloader-command-boundary]]), and the compose project play/stop plus the Podman
  Desktop launch, assembled by `DockerStatus.buildComposeProjectCommand()` /
  `DockerStatus.buildPodmanDesktopCommand()` ([[adr-0014-compose-grouping-and-podman-desktop-launch]]).
  The compose builder is called by `main.qml`; the Podman Desktop builder is called by `main.qml` again
  too, from the relocated status-card button
  ([[adr-0017-podman-launch-button-and-topbar-removal]]).
  No other configuration value is a command; everywhere else configuration supplies only values inside
  a command the widget builds. The update-check command is also
  built in the pure module, but entirely from fixed constants, so it mints no further exception
  ([[adr-0013-widget-update-check-and-release-site]]).
- The per-project compose action needs no privilege — it is the user's own docker socket and the user's
  own containers — so the daemon's start/stop asymmetry
  ([[adr-0007-stop-button-confirmation-and-narrow-grant]]) is untouched: the per-group stop is
  deliberately NOT `systemctl stop docker`.
- The compose project name is interpolated as a single shell-quoted argument
  (`DockerStatus.shellQuote()`), and the builder returns `""` for the standalone bucket or an action
  outside `COMPOSE_ACTION_START`/`COMPOSE_ACTION_STOP`; `main.qml` refuses an empty command before it
  reaches the engine.
- The shutdown countdown is widget-owned and its command is a fixed constant (`powerOffCommand`). The
  configured minutes size a local `Date.now()` deadline and never reach a shell; the cancel path is purely
  local and needs no privilege ([[adr-0009-widget-owned-shutdown-countdown]]).
- The download row lives only in the full representation. It is never rendered in the panel, and every
  tooltip in it is attached to a `ToolButton` — the Import button's and the "YouTube or X URL" title's
  alike: `PlasmaComponents3.ToolTip` only renders when its parent is an `AbstractButton`, so the title is
  a flat, visually-invisible `ToolButton`, never a `Label` with a tooltip child. The feedback row's right
  edge carries a flat `folder-open` `ToolButton` that opens the containing folder, visible only after a
  successful download, and both its display text and its `file://` URL come from the pure
  `DockerStatus.formatDownloadDirectory()` / `DockerStatus.buildFolderUrl()` helpers rather than from a
  configured string interpolated into a URL
  ([[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]).
- Every one-shot assignment goes through `DockerStatus.withRunToken()`; identical `connectedSources`
  strings are a no-op in the engine (see [data-engine-contract](../status/data-engine-contract.md)).
- Representations receive properties and emit signals. They never reach for a `DataSource`, and a
  representation reads `Plasmoid.configuration` only for the panel icon; persisting a setting goes through
  a value-carrying signal to `main.qml`, never through configuration access in the representation
  ([[adr-0010-inline-shutdown-minutes-in-the-representation]]).
- The severity-to-colour switch lives only in `SeverityDot.qml`, and now resolves against the mockup
  palette (`DockerStatusPalette.qml`) rather than the Kirigami theme; the neutral chrome tokens live in
  that palette file, and the palette never maps a severity
  ([[adr-0011-fixed-dark-palette-from-mockup]]). A new state adds a severity in
  [status-slice](../status/status-slice.md), never a colour here.
- The `cfg_*` alias target must stay a plain writable property; aliasing an expression saves nothing
  and reports nothing. A setting carried by a combo box is the exception: the initial property Plasma
  writes arrives before the control initialises, so the setting is a plain property and the control is
  seeded from it (`ConfigGeneral.qml` — the cookies browser).
- `contents/config/config.qml` resolves `source` relative to `contents/ui/`, so the config page lives
  at `ui/config/ConfigGeneral.qml` — not at `config/ConfigGeneral.qml`.

## Dependencies

**Upstream:** `dockerstatus.js` for parsing, severity, the download-command builder, the compose/Podman
command builders and the update-check
helpers; `metadata.json`
and `main.xml` for plugin identity and config defaults; the probed behaviour of Plasma 6.7.4 and
plasma5support 6.7.4. **Runtime (download only):** a `yt-dlp` executable reachable on plasmashell's
`PATH`; for YouTube a JavaScript runtime (`node` or `deno`); cookies from the configured browser (default
Firefox) for X and for age-gated YouTube. **Runtime (update check only):** a `curl` reachable on
plasmashell's `PATH`, plus network reachability to the fixed Pages URL; a missing `curl` or an offline
machine is not an error — it is simply no update notice.
**Runtime (Podman launch only):** the Podman Desktop executable, on plasmashell's `PATH` (default
`podman-desktop`) or named by an absolute or `~/`-expanded path in the widget's options; a wrong
setting fails at click time with the binary's own message, not at load time. The status card's square
launch button is the UI trigger again ([[adr-0017-podman-launch-button-and-topbar-removal]]); a wrong
setting fails at click time with the binary's own message, not at load time.
**Downstream:** the installer copies this package; the privilege slice decides whether the start
button prompts; the verification slice can lint these files and now render the representations
headless for pixel review ([[render-preview]]), but the full wrapper is only observable inside
a running Plasma session.

## Known gaps & accepted debt

- `main.qml` as a `PlasmoidItem` is **not executable outside plasmashell**; the wrapper is validated
  by `qmllint` and review only. The representations it hosts are previewable headless ([[render-preview]]).
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
- The download row's layout is previewable headless through the render harness ([[render-preview]]),
  but only its command boundary is unit tested, so its enable/disable behaviour is reviewed until it
  runs in a session.
- The update check's QML surface — the two sources, the silent handler and the muted line — is
  review-and-lint only, exactly like every other QML wrapper here. The Node suite pins its pure helpers and
  its wiring as static text, which proves the arrangement, not the running behaviour.
- The countdown lives in QML, so the play/stop timing, the inline field's interaction and the effective
  passwordless power-off are reviewed, not tested; the pure resolver (`resolveShutdownMinutes`), the two
  helpers (`shutdownRemainingSeconds`, `formatCountdown`) and the inline field's wiring (inbound property,
  edit signal, single-writer rule, seed/sync guards, the focus-loss mirror guarded against clobbering the
  user's error text) are pinned by the Node suite as static text.
- A reload or plasmashell restart cancels a pending shutdown on purpose: the deadline is widget-owned and
  does not survive the widget being replaced.
- The countdown uses absolute-deadline semantics: a forward system-clock step, or a resume after the
  deadline already passed while suspended, fires the power-off on the next tick. The `Cancel` button and
  the configurable duration are the mitigations.
- The download depends on external tools the widget cannot probe for: a wrong `yt-dlp` binary or a
  missing JavaScript runtime fails at download time with yt-dlp's own message, not at load time.
- The flat grouped container section is a QML surface like the rest: the grouping pipeline and the
  compose command boundary are pinned by the Node suite, but its layout and interaction are reviewed
  until they run in a session.
- A compose stack that disappears between the last poll and the click makes `docker start`/`docker stop`
  exit non-zero with docker's own `requires at least 1 container argument`, surfaced verbatim on the
  feedback line rather than swallowed.
- Grouping depends on the `com.docker.compose.project` label. A docker that does not answer it (or does
  not support the `.Label` template function) degrades the list to one standalone group, never to an
  empty list.
- The Podman path is a PATH name by default, so a wrong `podmanDesktopPath` fails at click time with the binary's own message (for example `podman-desktop: not found`), not at load time — the relocated status-card button reports it on the card's feedback row ([[adr-0017-podman-launch-button-and-topbar-removal]]).
