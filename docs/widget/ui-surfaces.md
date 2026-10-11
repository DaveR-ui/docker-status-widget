---
id: widget-ui-surfaces
category: widget
tags: [ui, inventory, widget, surfaces, qml]
aliases: [UI Surfaces, Widget UI Inventory]
related: [widget-index, widget-slice, troubleshooting]
version: 1.0
status: active
---

# Widget UI Inventory

## Selection guide

- State must be readable at a glance in a panel → **CompactRepresentation** (theme icon + severity dot).
- The user must read state and act on it → **FullRepresentation** (the popup in a panel; the widget
  itself on the desktop).
- A state must become a colour → **SeverityDot**. Never compute a colour at a call site.
- The user must change poll interval, panel icon, container-list visibility or the download settings →
  **ConfigGeneral**, backed by the kcfg entries in `contents/config/main.xml`.
- The user must paste a link and fetch a video → the **video download row** inside FullRepresentation
  (full representation only; never the compact representation or the tooltip).
- State must be readable on hover, without opening anything → the **tooltip subtext** on the root
  `PlasmoidItem`.
- An action must be reachable without opening the popup → the **contextual actions** (right-click menu).

There is no other surface. A new one is a design decision, not an implementation detail.

## Usage rules

| Rule | Boundary |
|---|---|
| Severity is computed in `dockerstatus.js`; colour is chosen only in `SeverityDot.qml`. | No other file may map a state to a colour. |
| Representations are pure consumers: properties in, signals out. | No `DataSource` access, and `Plasmoid.configuration` only for the compact icon name. |
| Configuration never supplies a command, only validated values inside one. | The video-download row is the ONE place user input enters a command; the URL is validated against a host allow-list and every interpolated value is shell-quoted, so the run token stays safe. A second exception needs a new ADR ([[adr-0006-video-downloader-command-boundary]]). |
| `unknown` never looks healthy. | Muted (the palette's `muted` grey), never neutral (the palette's `orange` accent). |
| Secondary text stays secondary. | The palette's `muted` colour for small labels and footer text; `opacity: 0.5` for the tagline, `0.38` for a disabled button, `1.0`/`0.5` for the panel icon. |
| Everything user-visible is translated. | `i18n(...)` for plain strings, `i18nc("@info", ...)` when the argument needs context. |

Verification tooling: two `qmllint` binaries exist on this machine and they are not interchangeable. The
one on `PATH` is Qt5 (`qt5-declarative 5.15.19`) and reports syntax only. The matching
`/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.12.0`) is the semantic tool for a Plasma 6 target. Measured
on the five `contents/ui/*.qml` files it reports 0 errors, 99 warnings (every one `[unqualified]`) and 51
infos, of which 2 are `[unused-imports]`; on `contents/ui/config/*.qml` it reports 0 errors, 32 warnings
(all `[unqualified]`) and 5 infos, none of them `[unused-imports]`. Across the six files that is 0
errors, 131 warnings and 56 infos (2 `[unused-imports]`), and none of `[missing-property]`,
`[incompatible-type]`, `[unresolved-type]` or `[import]`. Every
"Verification" line below means both binaries were run; "the Qt6 semantic run is clean" records that
measured result, and the exit code is not the evidence (Qt6 exits 0 unless `--max-warnings` is set).

## Component inventory

### CompactRepresentation

#### Purpose
The panel presence: the configured theme icon plus a severity dot, so the daemon state is readable
without opening anything. It is restyled only through the shared tokens — the dot reads the mockup
palette via `SeverityDot` — while the icon deliberately stays a theme icon, so the panel still follows
the user's theme ([[adr-0011-fixed-dark-palette-from-mockup]]).

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/CompactRepresentation.qml`

#### Interface
Takes `daemonState` (string) and `daemonRunning` (bool); emits nothing. Sizes itself from the layout's
implicit size.

#### Data Flow
`main.qml` passes both properties; the icon source comes from `Plasmoid.configuration.iconName`; the dot
gets `DockerStatus.daemonSeverity(daemonState)`.

#### Usage Pattern
Selected automatically whenever the form factor is not planar; a click on it opens the popup that hosts
the full representation.

#### Anti-Patterns
Adding text or a status message here — a panel item must stay icon-sized. Computing a colour instead of
delegating to `SeverityDot`. Hiding the dot when the state is unknown.

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); visual review inside a running Plasma session (there is no QML behavioural test).

### FullRepresentation

#### Purpose
The popup/desktop surface, restyled to the mockup's fixed dark palette: a topbar (logo tile, eyebrow and
title, refresh icon-button), a status card (daemon state, an ONLINE/OFFLINE pill, a running-container
count and progress bar, the start/stop button row), the container list, the video-download row with its
cookies-browser line, the "Countdown to Extinction" shutdown section, the configurable bottom text and a
footer. It paints its own dark 20px-radius card, so Plasma's own background is switched off
(`Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground` in `main.qml`;
[[adr-0011-fixed-dark-palette-from-mockup]]).

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml`

#### Interface
Takes `daemonState`, `containers`, `daemonRunning`, `containerListEnabled`, `actionInFlight`,
`actionKind`, `actionFeedback`, `downloaderEnabled`, `taglineText`, `cookiesBrowser`, `downloadReady`,
`downloadInFlight`, `downloadFeedback`, `downloadFeedbackSeverity`, `shutdownReady`, `shutdownMinutes`,
`shutdownMinutesText`, `shutdownPending`, `shutdownInFlight`, `shutdownRemainingSeconds`, `shutdownFeedback`
and `shutdownFeedbackSeverity`; emits `startRequested()`, `stopRequested()`, `refreshRequested()`,
`downloadRequested(url)`, `shutdownStartRequested()`, `shutdownStopRequested()` and
`shutdownMinutesEdited(text)`.

#### Data Flow
All state flows down as properties from `main.qml`; the signals flow back up and are handled by
`root.startDaemon()`, `root.stopDaemon()`, `root.refreshDaemonState()`, `root.downloadVideo(url)`,
`root.startShutdownCountdown()`, `root.stopShutdownCountdown()` and `root.setShutdownMinutes(text)`. The
container list model is the parsed array itself. `actionKind` (`DockerStatus.ACTION_START` / `ACTION_STOP`)
says which action owns an in-flight reply, so the row can show the matching label while both actions share
one `actionInFlight` flag. The view derives its own display values from those properties:
`runningContainerRatio` (`DockerStatus.countByState(containers, "running")` over the container count,
guarded against a zero total) feeds the progress bar; `containerIconFor(name)` hashes a container name
into a fixed list of generic theme icons for the row tile; and every severity accent reads
`statusDot.severityColor`.

#### Usage Pattern
Shown directly as the desktop widget and as the panel popup. The root is an `Item` wrapping a
`ColumnLayout` — a layout-managed item must not carry anchors, so the mockup's one dark card is painted
behind the column at `z: -1` and the column supplies the inner padding. The topbar carries the logo tile,
an uppercase eyebrow over the title, the in-flight busy indicator and a refresh icon-button. The status
card shows the daemon state beside a severity dot (`halo: true`), an ONLINE/OFFLINE pill whose text and
tint both derive from that dot's `severityColor`, the running/total figure (`DockerStatus.countByState()`
over the container count) over a progress bar whose fill is the same severity colour, and the action row.
Every severity accent on the card — dot, pill, progress fill, footer dot — is read from
`statusDot.severityColor`; no colour is computed here. Both buttons are always visible and equal width
(`Layout.fillWidth: true`), which supersedes ADR-0008's narrow-stop clause (`gridUnit * 7`); the row still
cannot reflow between "Stop daemon" and "Confirm stop", because both fill and only their labels change.
Start is disabled while an action is in flight or while the daemon already runs, and stop is disabled
while an action is in flight or while the daemon is not running. Stop never fires on one click — the first
click arms a confirmation and shows a negative warning ("Stopping the daemon stops every running
container. Press again to confirm."), the second click runs the stop, and the arming expires after five
seconds so a forgotten armed button cannot be completed by a later click. A confirmation arriving sooner
than half a second after the arming (`stopConfirmMinDwellMs`) is treated as the tail of the same physical
gesture and does not confirm, so one double-click cannot stop every running container. Start stays
passwordless when the polkit rule is installed; stop always prompts, because the grant is deliberately not
widened for it ([[adr-0007-stop-button-confirmation-and-narrow-grant]]). A failure appears below the row
as normalised `stderr` (CR stripped, trimmed), or as a generic message when `stderr` is empty.

The container list is a `ListView` over the parsed array; each row shows a deterministic theme-icon tile
(`containerIconFor(name)`, a cheap hash into a fixed list of generic theme names, so the same container
always gets the same tile and a missing theme icon degrades to nothing), the container name, and a
six-pixel severity dot beside the state. The download row appears only while the `showVideoDownloader`
setting is on; its button is disabled while a download is in flight, while the paste is empty, or until
the one-shot `homeSource` has reported `$HOME`. The browser is configured on the same page and resolved
through `DockerStatus.resolveCookiesBrowser()`, the same function `main.qml` feeds into the command, so
the muted `Cookies from: <browser>` line under the row can never claim a browser the download is not
using; an opted-out setting reads `Cookies: not used`. The configured bottom text (default
`Persiguiendo la singularidad`) is a muted, centre-aligned line that disappears entirely when the setting
is empty; it is configured copy, not a status message. A footer closes the card: a hairline rule, the
static "Docker Status · Local panel" label, and the daemon state beside a five-pixel dot that reuses the
header dot's `severityColor`.

The "Countdown to Extinction" section sits above the tagline: a separator, a bold title, a "Minutes until
power-off:" label with an inline `TextField` (`shutdownMinutesField`), a wide play button ("Shut down" /
"Shutting down…") and a narrow "Cancel" button, both with tooltips. The inline field is a second editing
surface for `shutdownCountdownMinutes`: it seeds once from the raw stored string (`shutdownMinutesText`),
mirrors inbound changes only while it is unfocused (never a `text:` binding), and emits the raw text as
`shutdownMinutesEdited(text)`. When the field loses focus it re-syncs a VALID field value from the stored
string: an external change that arrives while the field is focused is skipped by the focused sync and
nothing re-runs on blur, so that moment is the only one left to mirror it; invalid user text is
deliberately left visible to be fixed. Its validity comes from the same `DockerStatus.resolveShutdownMinutes()` the
deadline uses (`shutdownMinutesFieldValid`), so a value the resolver refuses tints the text red, shows the
cue "Enter a whole number of minutes greater than 10.", and disables play; the field is disabled while a
countdown is pending or in flight. An invalid edit never persists: the representation owns no
configuration — it emits, and `main.qml`'s `setShutdownMinutes()` is the single writer that validates and
writes the kcfg entry ([[adr-0010-inline-shutdown-minutes-in-the-representation]]). Play is disabled the
instant the sequence is armed (`shutdownPlayEnabled` requires ready, a valid field, not pending and not in
flight), so one activation cannot arm twice; `Cancel` is enabled only while a shutdown is pending, and it
cancels locally without any privilege. While pending, a muted line reads `Powering off in M:SS` from
`DockerStatus.formatCountdown(shutdownRemainingSeconds)` and counts down once a second. The section's
feedback row reuses `SeverityDot` with `shutdownFeedbackSeverity`, exactly as the header does. The section
renders and emits only; the deadline, the ticker and the fixed power-off command all live in `main.qml`
([[adr-0009-widget-owned-shutdown-countdown]]).

#### Anti-Patterns
A stop that runs on a single click, a stop entry in the context menu, or widening `ALLOWED_VERBS` to make
stopping passwordless — the confirmation plus the interactive prompt are the whole safety argument
([[adr-0007-stop-button-confirmation-and-narrow-grant]]). Swallowing a failed action into a silent no-op
instead of showing `stderr`. Rendering the container list while the daemon is down. Binding the tagline to
state — it is configured copy, not a status message. Building the download command here instead of in
`dockerstatus.js`. Adding a second severity-to-colour mapping for the download feedback. Reading or
writing `Plasmoid.configuration` (or touching a `DataSource`) from the inline minutes field: the field is
sanctioned, but persistence goes only through its value-carrying signal to `main.qml`, the single writer of
the kcfg entry ([[adr-0010-inline-shutdown-minutes-in-the-representation]]). Building the
power-off command here, or naming `powerOffCommand`, instead of emitting a signal. An arming confirmation
on play: unlike the stop, play starts the sequence and disables itself at once, and the countdown is the
confirmation window. Assuming the power-off prompts for a password — that is a logind default, not this
widget's gate ([[adr-0009-widget-owned-shutdown-countdown]]).

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); a probe with a deliberately failing command confirmed the failure path renders — that
probe is **not** recorded in the repository, so treat the failure path as reviewed, not tested.

### Video download row

#### Purpose
The one place this widget accepts input: paste a YouTube or X link, press the button, and yt-dlp fetches
the video into the configured folder.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml` — the "Video download" section. It
is a row, not a separate component file, and it exists only inside the full representation.

#### Interface
Reads `downloaderEnabled`, `downloadReady`, `downloadInFlight`, `downloadFeedback` and
`downloadFeedbackSeverity`; emits `downloadRequested(url)` with the raw field text. It builds no command
and touches no `DataSource`.

#### Data Flow
`main.qml` owns the `download*` state and `root.downloadVideo(url)` validates the paste before a command
exists; the row only reports the paste and renders the result. `downloadReady` is true once the one-shot
`homeSource` has reported `$HOME`, because the resolved download directory is built from it. The row
reuses `SeverityDot` for its feedback, so no second severity-to-colour mapping exists.

#### Usage Pattern
Shown only while the `showVideoDownloader` setting is on. The button is disabled while a download is in
flight, while the field is empty, or before `$HOME` is known. An unsupported paste is still accepted by
the button — a click then reports why it was refused instead of the button looking dead — and an inline
label warns "Only YouTube and X (Twitter) links are supported." while the paste is unsupported. The
tooltip lives on the `ToolButton`, not the `TextField`: `PlasmaComponents3.ToolTip` renders only when its
parent is an `AbstractButton`.

#### Anti-Patterns
Adding a free-form "extra yt-dlp arguments" setting — configuration supplies validated values, never
flags. Building the command in the row instead of in `dockerstatus.js`, which would move the quoting
boundary out of the tested layer. Rendering a second colour for the feedback. Putting the row in the
compact representation: a panel item stays icon-sized.

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); the command boundary behind it is unit tested against a real shell. The row
itself cannot be instantiated outside plasmashell, so its interaction is reviewed until it runs in a real
session.

### Bundled app icon

The package ships its own icon at `contents/icons/dockerstatus.svg`, referenced from
`metadata.json` as `"Icon": "/icons/dockerstatus.svg"`. The leading slash is the
package-relative convention: `KPluginMetaData::iconName()` returns the string verbatim, and the
consumers that display it — the Add Widgets / Widget Explorer and the About page (Plasma 6.7.0+) —
detect the leading `/`, load the package and resolve the value against the package's `contents/`
directory. It is not a `QIcon::fromTheme` name.

The panel icon is separate: `CompactRepresentation.qml` renders
`Plasmoid.configuration.iconName`, a theme icon name (default `folder-docker-symbolic`), so the
panel still needs the configured name to exist in the active theme. A fully self-contained panel
icon would require resolving the bundled file in QML (`Qt.resolvedUrl`) — a deliberate follow-up,
not part of this change.

### SeverityDot

#### Purpose
The single severity-to-colour mapping, shared by every representation.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/SeverityDot.qml`

#### Interface
Takes `severity` (one of `positive`, `neutral`, `negative`, `muted`), an optional `diameter` (default
`Kirigami.Units.gridUnit / 3`) and an opt-in `halo` (a 4px ring at 0.1 alpha, off by default); exposes
the resolved `severityColor`.

#### Data Flow
`severity` is always produced by `dockerstatus.js`; the component resolves it against the mockup palette
(`DockerStatusPalette.qml`) — positive → green `#55d69e`, negative → red `#ff737d`, neutral → orange
`#ffad5c`, muted → grey `#9aa9b1` — and nothing else flows out. The palette holds neutral chrome only;
it never maps a severity.

#### Usage Pattern
Used by the compact icon row, the popup status card, the running-count progress fill, the footer dot, the
download and shutdown feedback rows and every container row. The status card opts into `halo: true` (the
mockup's soft ring); the six-pixel list dots do not, so a consumer opts in rather than getting a bigger
dot by accident. The `default` branch resolves to the muted colour on purpose — never neutral.

#### Anti-Patterns
Passing a daemon *state* into this component instead of a severity — the mapping would then live in two
places. Mapping a severity to a palette colour anywhere else: every consumer reads `severityColor`.
Reusing `neutral` for unknown states, which would make a broken probe look merely stopped.

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); the underlying severity mapping is covered by the Node harness.

### ConfigGeneral

#### Purpose
The configuration page, restyled to the palette as five section cards (Docker, Container list, Video
download, Shutdown countdown, Appearance): poll interval, panel icon name, whether containers are listed,
the download settings, the shutdown minutes and the bottom text. The page keeps Plasma's chrome — unlike
the popup it does not switch the background off — and paints the palette's optional dark page surface
(`paintPageBackground`) behind the cards; `import ".."` lets the palette `QtObject` resolve from `ui/`
([[adr-0011-fixed-dark-palette-from-mockup]]).

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/config/ConfigGeneral.qml`
(the `source` in `contents/config/config.qml` is resolved relative to `contents/ui/`, not `contents/`).

#### Interface
Nine `cfg_*` aliases — `cfg_pollIntervalSeconds`, `cfg_iconName`, `cfg_showContainerList`,
`cfg_showVideoDownloader`, `cfg_downloadDirectory`, `cfg_jsRuntime`, `cfg_ytDlpBinary`,
`cfg_taglineText` and `cfg_shutdownCountdownMinutes` — each bound to a plain writable property of a
widget, plus a plain string `cfg_cookiesBrowser`. The bottom text is a setting like the rest: display-only
copy that leaves the panel representation untouched, and the browser is validated by
`resolveCookiesBrowser()` before it reaches the command.

The browser is the one setting carried by a `QQC2.ComboBox`, and that is why it alone is not an alias.
Plasma delivers every stored value as an *initial property*, and that write arrives before the combo
initialises: the combo's own startup then adopts index 0 and rewrites `editText` to `brave`, and its
`Component.onCompleted` runs only after that. An `editText` alias therefore cannot hold the stored value —
the page opened on `brave` and, because Plasma reads `cfg_<entryName>` back on apply, saving the page wrote
`brave` over the configured browser. The combo is seeded from the plain property in its own
`Component.onCompleted`, and pushes both a list pick and a free-form edit (`chrome:Default`,
`firefox+gnomekeyring`) back into it; the push-back stays muted until the seed is in, because the combo's
startup fires `editTextChanged` with `brave` first. Order measured against Qt 6.11.2 with the shipped file.

#### Data Flow
Plasma reads every `cfg_<entryName>` property — alias or plain — and writes it into the matching entry in
`contents/config/main.xml` when the page is applied; the values reach `main.qml` through
`Plasmoid.configuration`.

#### Usage Pattern
Add a setting by adding a kcfg entry **and** its `cfg_*` property in the same change. Keep the alias target
a plain property, and use the plain-property form when the widget is a combo box: there the initial write
lands before the control can hold it (see Interface above).

#### Anti-Patterns
Aliasing an expression: the page saves nothing and reports nothing. Aliasing `editText` of a
`QQC2.ComboBox`: the stored value is overwritten before the page can seed the control, so the page opens —
and then saves — the model's first item. Adding a setting that lets the user type a command — configuration
never supplies a command string, and the download settings are validated values inside a command the widget
builds ([[adr-0006-video-downloader-command-boundary]]).

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); manual save/reload in a live session; the seed-and-mute arrangement is pinned as text by the Node suite.

### Tooltip subtext

#### Purpose
State on hover, without opening the popup: the container badge while the daemon runs, the daemon state
otherwise.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/main.qml` — `toolTipMainText` / `toolTipSubText`.

#### Interface
Plain strings on the root `PlasmoidItem`; no signals.

#### Data Flow
Reads `daemonRunning` and `containers` from the root, and formats through
`DockerStatus.summarizeContainers()`.

#### Usage Pattern
Keep it to one line of fact. It is the cheapest place to answer "what is happening" without a click.

#### Anti-Patterns
Duplicating the popup's full status text. Using the tooltip to report an error that the popup already
shows.

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); live hover review.

### Contextual actions

#### Purpose
Refresh and start, reachable from the right-click menu without opening the popup.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/main.qml` — `Plasmoid.contextualActions`.

#### Interface
Two `PlasmaCore.Action` entries with `text`, `icon.name`, `enabled` and `onTriggered`.

#### Data Flow
`onTriggered` calls `root.refreshDaemonState()` and `root.startDaemon()` — the same handlers the popup
signals reach, so there is one code path per action.

#### Usage Pattern
`enabled` reflects real availability: start is disabled while the daemon runs or an action is in flight.
Add a new action here only if it is also represented in the popup, or if it is genuinely menu-only.

#### Anti-Patterns
A second implementation of an action that already exists in the popup. Menu entries that stay enabled
while an action is in flight and can be double-triggered. A **stop** entry: a context menu is still a
one-click surface, so the stop belongs behind the popup confirmation and nowhere else
([[adr-0007-stop-button-confirmation-and-narrow-grant]]).

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); live review of the enabled/disabled transitions.

## Style tokens

Fast anchors: colour · spacing · typography · opacity

### Colour

The widget paints the mockup's fixed dark palette, not the Kirigami theme. The tokens live in
`DockerStatusPalette.qml`, and this table is a sanctioned override of the theme-following rule, recorded
in [[adr-0011-fixed-dark-palette-from-mockup]]. The severity accents are consumed through
`SeverityDot.severityColor`, never read directly at a call site.

| Token | Used for |
|---|---|
| `paletteTokens.green` (`#55d69e`) | healthy daemon, running container |
| `paletteTokens.orange` (`#ffad5c`) | stopped daemon, exited/created container |
| `paletteTokens.red` (`#ff737d`) | failed daemon, crash-looping container |
| `paletteTokens.muted` (`#9aa9b1`) | unknown state (muted), footer text, secondary labels |
| `paletteTokens.line` | hairline borders and the list separator |
| `Kirigami.Theme.negativeTextColor` | functional error text only: a failed action, an armed stop, an invalid inline value (not a severity accent) |

### Spacing and sizing

| Token | Used for |
|---|---|
| `Kirigami.Units.smallSpacing` | gaps inside every layout row |
| `Kirigami.Units.largeSpacing` | section spacing, config-card margins |
| `Kirigami.Units.gridUnit` | dot diameter (`/3`), popup width (`*34`, minimum `*30`), list height cap (`*10`) |
| `Kirigami.Units.iconSizes.smallMedium` | the panel icon |
| `Kirigami.Units.iconSizes.small` | the busy indicators |

### Typography

| Token | Used for |
|---|---|
| `paletteTokens.fontFamily` (Inter) with the pixel sizes | every label on the popup and config page: body 14, title 19, section 13, metric 26, subtle 11, label 12 |
| `Kirigami.Theme.smallFont` | the config page's one inline error label (functional error text) |

### Opacity

| Value | Used for |
|---|---|
| `1.0` / `0.5` | panel icon when the daemon runs / when it does not |
| `0.5` | the configured bottom text |
| `0.38` | a disabled button |

## Related

- A button that appears to do nothing on the second click →
  [troubleshooting.md](../verification/troubleshooting.md#the-start-daemon-button-does-nothing-on-the-second-click)
  (the write-up lives there; nothing is copied here).
- A grey dot where "stopped" was expected →
  [troubleshooting.md](../verification/troubleshooting.md#the-widget-shows-a-grey-dot-instead-of-a-stopped-daemon)
- An empty container list with the daemon running →
  [troubleshooting.md](../verification/troubleshooting.md#the-container-list-is-empty-while-the-daemon-is-running)
- A missing or greyed-out download button →
  [troubleshooting.md](../verification/troubleshooting.md#the-download-row-is-missing-or-its-button-is-greyed-out)
- A YouTube download that fails with "The page needs to be reloaded" →
  [troubleshooting.md](../verification/troubleshooting.md#youtube-fails-with-the-page-needs-to-be-reloaded)
