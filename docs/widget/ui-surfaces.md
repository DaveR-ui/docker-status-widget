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
| `unknown` never looks healthy. | Muted (`disabledTextColor`), never neutral. |
| Secondary text stays secondary. | `opacity: 0.7` for small labels, `0.3` for the separator, `1.0`/`0.5` for the panel icon. |
| Everything user-visible is translated. | `i18n(...)` for plain strings, `i18nc("@info", ...)` when the argument needs context. |

Verification tooling: two `qmllint` binaries exist on this machine and they are not interchangeable. The
one on `PATH` is Qt5 (`qt5-declarative 5.15.19`) and reports syntax only. The matching
`/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.11.2`) is the semantic tool for a Plasma 6 target: on all
six QML files it reported 0 errors, 66 warnings (every one `[unqualified]`) and 37 infos of which 3 are
`[unused-imports]`, and none of `[missing-property]`, `[incompatible-type]`, `[unresolved-type]` or
`[import]`. Every
"Verification" line below means both binaries were run; "the Qt6 semantic run is clean" records that
measured result, and the exit code is not the evidence (Qt6 exits 0 unless `--max-warnings` is set).

## Component inventory

### CompactRepresentation

#### Purpose
The panel presence: the configured theme icon plus a severity dot, so the daemon state is readable
without opening anything.

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
The popup/desktop surface: what the daemon is doing, how many containers run, which ones, a start/stop
button row, a refresh button, any failure feedback, the video-download row, and the fixed tagline pinned
to the bottom.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml`

#### Interface
Takes `daemonState`, `containers`, `daemonRunning`, `containerListEnabled`, `actionInFlight`,
`actionKind`, `actionFeedback`, `downloaderEnabled`, `downloadReady`, `downloadInFlight`,
`downloadFeedback` and `downloadFeedbackSeverity`; emits `startRequested()`, `stopRequested()`,
`refreshRequested()` and `downloadRequested(url)`.

#### Data Flow
All state flows down as properties from `main.qml`; the signals flow back up and are handled by
`root.startDaemon()`, `root.stopDaemon()`, `root.refreshDaemonState()` and `root.downloadVideo(url)`. The
container list model is the parsed array itself. `actionKind` (`DockerStatus.ACTION_START` / `ACTION_STOP`)
says which action owns an in-flight reply, so the row can show the matching label while both actions share
one `actionInFlight` flag.

#### Usage Pattern
Shown directly as the desktop widget and as the panel popup. Both buttons are always visible so their
position never moves: start is disabled while an action is in flight or while the daemon already runs, and
stop is disabled while an action is in flight or while the daemon is not running. Stop never fires on one
click — the first click arms a confirmation and shows a negative warning ("Stopping the daemon stops every
running container. Press again to confirm."), the second click runs the stop, and the arming expires after
five seconds so a forgotten armed button cannot be completed by a later click. A confirmation arriving
sooner than half a second after the arming (`stopConfirmMinDwellMs`) is treated as the tail of the same
physical gesture and does not confirm, so one double-click cannot stop every running container. Start stays
passwordless
when the polkit rule is installed; stop always prompts, because the grant is deliberately not widened for
it ([[adr-0007-stop-button-confirmation-and-narrow-grant]]). A failure appears below the row as normalised
`stderr` (CR stripped, trimmed), or as a generic message when `stderr` is empty. The download row appears
only while the `showVideoDownloader` setting is on; its button is disabled while a download is in flight,
while the paste is empty, or until the one-shot `homeSource` has reported `$HOME`. The last child is an
unconditional, muted, centre-aligned tagline (`Persiguiendo la singularidad`); it carries no state and is
the only text allowed on this surface's periphery.

#### Anti-Patterns
A stop that runs on a single click, a stop entry in the context menu, or widening `ALLOWED_VERBS` to make
stopping passwordless — the confirmation plus the interactive prompt are the whole safety argument
([[adr-0007-stop-button-confirmation-and-narrow-grant]]). Swallowing a failed action into a silent no-op
instead of showing `stderr`. Rendering the container list while the daemon is down. Binding the tagline to
state — it is a constant. Building the download command here instead of in `dockerstatus.js`. Adding a
second severity-to-colour mapping for the download feedback.

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
Takes `severity` (one of `positive`, `neutral`, `negative`, `muted`) and an optional `diameter`; exposes
the resolved `severityColor`.

#### Data Flow
`severity` is always produced by `dockerstatus.js`; the component resolves it against Kirigami theme
colours and nothing else flows out.

#### Usage Pattern
Used by the compact icon row, the popup header and every container row. The `default` branch resolves to
the muted colour on purpose.

#### Anti-Patterns
Passing a daemon *state* into this component instead of a severity — the mapping would then live in two
places. Reusing `neutral` for unknown states, which would make a broken probe look merely stopped.

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); the underlying severity mapping is covered by the Node harness.

### ConfigGeneral

#### Purpose
The configuration page: poll interval, panel icon name, whether containers are listed, and the
download settings.

#### Path
`package/io.github.daver-ui.dockerstatus/contents/ui/config/ConfigGeneral.qml`
(the `source` in `contents/config/config.qml` is resolved relative to `contents/ui/`, not `contents/`).

#### Interface
Seven `cfg_*` aliases — `cfg_pollIntervalSeconds`, `cfg_iconName`, `cfg_showContainerList`,
`cfg_showVideoDownloader`, `cfg_downloadDirectory`, `cfg_jsRuntime` and `cfg_ytDlpBinary` — each bound
to a plain writable property of a widget. There is no alias for the browser: the cookies always come
from Firefox, as a constant in `dockerstatus.js`.

#### Data Flow
Plasma binds each `cfg_<entryName>` alias to the matching entry in `contents/config/main.xml`; the values
reach `main.qml` through `Plasmoid.configuration`.

#### Usage Pattern
Add a setting by adding a kcfg entry **and** its alias in the same change. Keep the alias target a plain
property.

#### Anti-Patterns
Aliasing an expression: the page saves nothing and reports nothing. Adding a setting that lets the user
type a command — configuration never supplies a command string, and the download settings are validated
values inside a command the widget builds ([[adr-0006-video-downloader-command-boundary]]).

#### Verification
`qmllint` (both binaries — see the verification-tooling note; the Qt6 semantic run is clean); manual save/reload in a live session.

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

| Token | Used for |
|---|---|
| `Kirigami.Theme.positiveTextColor` | healthy daemon, running container |
| `Kirigami.Theme.neutralTextColor` | stopped daemon, exited/created container |
| `Kirigami.Theme.negativeTextColor` | failed daemon, crash-looping container, action feedback |
| `Kirigami.Theme.disabledTextColor` | unknown state (muted), and the list separator |

### Spacing and sizing

| Token | Used for |
|---|---|
| `Kirigami.Units.smallSpacing` | gaps inside every layout row |
| `Kirigami.Units.gridUnit` | dot diameter (`/3`), popup width (`*16`), list height cap (`*10`) |
| `Kirigami.Units.iconSizes.smallMedium` | the panel icon |
| `Kirigami.Units.iconSizes.small` | the busy indicator |

### Typography

| Token | Used for |
|---|---|
| `Kirigami.Theme.smallFont` | secondary labels: badge, container state, feedback, empty-list message |

### Opacity

| Value | Used for |
|---|---|
| `1.0` / `0.5` | panel icon when the daemon runs / when it does not |
| `0.7` | secondary labels |
| `0.3` | the container-list separator |

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
