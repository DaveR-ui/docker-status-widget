---
id: status-slice
category: status
tags: [slice, generality, status, logic]
aliases: [Status slice, Logic slice]
related: [status-index, data-engine-contract, widget-slice]
version: 1.3
status: active
---

# Status — Slice Generalities

## What this slice is

The pure-function core, in one file: `dockerstatus.js` plus the design rule that keeps it runnable
outside QML. Its form is deliberately narrow — strings and arrays in, plain objects and strings out,
zero side effects, zero dependencies. This is the part of the plasmoid that can be proven without
Plasma, and it is the reason the project has any automated tests at all. It also owns the download
boundary: URL classification, shell quoting, the `yt-dlp` command builder and the download-result
parsers all live here, so the one place user input reaches a shell is testable without Plasma. And it
owns the update-check boundary: the fixed-command builder, the marker split, the version parsers and the
strictly-greater comparison all live here, so the network feature's only decision — "is there an update" —
is testable without a network.

## Boundaries

**In:** output normalisation; `systemctl is-active` stdout to daemon state; `docker ps` rows to
container objects and their grouping by compose project; counting and the compact badge; severity
mapping for both daemon and containers; the run-token helper; video-link classification; shell quoting;
download-directory, binary, runtime
and runtime resolution; download-command assembly; the video-id recovery, the download-stop pid-file
resolvers, the download-stop command assembly and the stop-outcome parser; the Podman Desktop path
resolver and the compose
and Podman command builders; download-result parsing; the shutdown-duration
resolver and the countdown formatting helpers; the update-check command builder, the marker split, the
version parsers and the version comparison.

**Out:** running anything (the [widget slice](../widget/widget-slice.md) owns the data sources and
the processes); rendering (only `SeverityDot.qml` maps a severity to a colour); proving the behaviour
([verification-slice](../verification/verification-slice.md)); the engine's own semantics, which are
documented in [data-engine-contract](data-engine-contract.md).

## Entry points

- `package/io.github.daver-ui.dockerstatus/contents/ui/dockerstatus.js` — the whole slice is one file. Read
  the exported constants first, then the parsers, then the severity functions.
- The harness that pins it: `tests/dockerstatus.test.mjs` in
  [verification-slice](../verification/verification-slice.md).

## How it works

One pipeline, no hidden state: raw stdout → `normalizeOutput` → a parser → a state string → a
severity. The public surface, and what each function guarantees:

| Function | Contract |
|---|---|
| `normalizeOutput(raw)` | `null`/`undefined` → `""`; CRLF → LF; trimmed |
| `parseDaemonState(raw)` | `active`/`activating`/`reloading` → active; `inactive`/`deactivating` → inactive; `failed` → failed; **anything else, including empty output, → unknown** |
| `parseContainers(raw)` | one `{name, state, project}` per line: name to the **first** `\|`, state to the second, the whole remainder is `project`; a two-field line parses with an empty `project`; a line without a separator, or with an empty name or state side, is skipped |
| `groupContainersByComposeProject(list)` | `[{project, containers}]` grouped by each container's `project`, in first-seen order; the no-project bucket (`COMPOSE_PROJECT_STANDALONE`, `""`) is emitted last and only when non-empty |
| `countByState(list, state)` | exact-state count |
| `summarizeContainers(list)` | `"running/total"`; `"0/0"` for empty, `null` or `undefined` |
| `withRunToken(cmd, n)` | `cmd + " # plasma-run-" + n` — a distinct source for an identical command |
| `daemonSeverity(state)` | active → positive; inactive → neutral; failed → negative; anything else → muted |
| `containerSeverity(state)` | running → positive; exited/created → neutral; restarting/dead/paused → negative; anything else → muted |
| `classifyVideoUrl(raw)` | trims, then `https` only, exact host allow-list, ≤2048 chars, no inner whitespace/quotes/backtick/backslash/control char → `youtube`/`twitter`; anything else → `null` (no command is built) |
| `shellQuote(value)` | wraps in single quotes; an embedded `'` becomes `'\''`; `null`/`undefined` → `''` |
| `expandTilde(path, home)` | a leading `~/` (or a bare `~`) expands against home; a tilde elsewhere stays literal |
| `resolveDownloadDirectory(cfg, home)` | absolute, `~`-expanded, trailing slashes trimmed; empty, relative or control-character value falls back to `<home>/Downloads` |
| `formatDownloadDirectory(cfg, home)` | the display form of the same resolved directory, for the row's tooltip; `""` while `home` is empty (`$HOME` not reported yet) |
| `buildFolderUrl(cfg, home)` | `file://` URL for the resolved directory, every segment `encodeURIComponent`-encoded (so `#`, `?` and spaces survive as data); `""` while `home` is empty or the resolved path is not absolute |
| `resolveYtDlpBinary(cfg, home)` | a plain name or path matching `^(~/)?[A-Za-z0-9._/+-]+$`, else `yt-dlp` |
| `resolvePodmanDesktopPath(cfg, home)` | a plain name or path matching `^(~/)?[A-Za-z0-9._/+-]+$`, a leading `~/` expanded against home; empty or malformed → `podman-desktop` (`PODMAN_DESKTOP_DEFAULT`) |
| `resolveJsRuntime(cfg)` | a valid runtime name; empty opts out and returns `""` so the flag is omitted; garbage falls back to `node` |
| `resolveCookiesBrowser(cfg)` | a valid `BROWSER[+KEYRING][:PROFILE]` token matching `^[A-Za-z0-9._+:,-]+$`; empty opts out and returns `""` so the flag is omitted; garbage falls back to `firefox` |
| `buildVideoDownloadCommand(opts)` | the assembled yt-dlp command, with `--cookies-from-browser` taken from the validated browser value (omitted when that value is `""`); omits `--js-runtimes` when the runtime is `""`; appends `withRunToken()` when a token is given; carries the fixed pid prefix — `mkdir -p '<stateDir>' ; echo $$ > '<stopFile>' ; exec 'yt-dlp' …` — so the run writes its **own** pid before `exec` turns the shell into the downloader. Returns `""` when no stop file can be resolved (no usable home, or a stamp/token that is not a plain name): a run that cannot be cancelled is not started ([[adr-0022-download-cancellation-and-partial-cleanup]]) |
| `extractVideoId(rawUrl)` | the `%(id)s` value yt-dlp substitutes, recovered from an already-classified URL (it calls `classifyVideoUrl()` first, so a refused paste never reaches this far); `""` for a playlist-only link, an empty id, an id longer than 32 characters, or any id outside `^[A-Za-z0-9_-]+$` — so the no-glob-metacharacter guarantee is enforced here rather than trusted at the sweep |
| `resolveDownloadStopDirectory(home)` | the project-owned state directory `<home>/.local/state/docker-status`; `""` when home is empty, not absolute or control-character-tainted — a wrong guess here would point the stop at a stranger's process, so there is no fallback |
| `resolveDownloadStopFile(home, sessionStamp, token)` | the per-run pid file `<dir>/download-<sessionStamp>-<token>.pid`, resolved through `resolveDownloadStopDirectory()`; `""` when either half is not a plain `^[A-Za-z0-9._-]+$` name. `token` is the **download's** run token — the value `buildVideoDownloadCommand()` folded into the name — not the stop run's own token |
| `buildDownloadStopCommand(opts)` | `""` when the stop file cannot be resolved; otherwise the single one-line shell program: poll ~1 s (5 × 0.2 s) for a **live** pid (`kill -0`); `kill -TERM`; a refused kill writes `docker-status: kill failed for pid N` to **stderr** and exits 1 **without sweeping** (never delete a partial whose writer was not signalled); wait ~1 s, `kill -KILL` if still alive, `rm -f` the pid file, print the outcome marker, then run the sweep **last** — only when `extractVideoId()` resolved, anchored on that id at `-maxdepth 1`, `-type f`, no `-L` — so the sweep's exit status is the run's; no live pid means `rm -f` plus the `not-running` marker |
| `DOWNLOAD_STOP_MARKER_PREFIX`, `DOWNLOAD_STOP_KILLED`, `DOWNLOAD_STOP_KILLED_UNSWEPT`, `DOWNLOAD_STOP_NOT_RUNNING`, `DOWNLOAD_STOP_UNKNOWN` | the stop protocol's constants: the stdout prefix `docker-status: `, the three outcome strings `killed` / `killed no-sweep` / `not-running`, and `""` for a run that said nothing at all |
| `parseDownloadStopResult(rawOutput)` | the outcome parsed out of the stop one-shot's stdout; the **first** prefixed line decides and must match one of the three markers exactly, so an absent, unknown or wrong-stream marker answers `DOWNLOAD_STOP_UNKNOWN` (`""`) instead of being read as a cancel; stderr is never consulted |
| `COMPOSE_PROJECT_STANDALONE`, `COMPOSE_ACTION_START`, `COMPOSE_ACTION_STOP`, `PODMAN_DESKTOP_DEFAULT` | the compose/Podman constants: the no-project bucket (`""`), the two actions `buildComposeProjectCommand()` accepts, and the fallback executable name (`podman-desktop`) |
| `buildComposeProjectCommand(opts)` | the assembled `docker start\|stop $(docker ps -aq --filter 'label=com.docker.compose.project=<project>')`, the project name one shell-quoted argument; returns `""` for the standalone bucket or an action outside `COMPOSE_ACTION_START`/`COMPOSE_ACTION_STOP`; appends `withRunToken()` when a token is given |
| `buildPodmanDesktopCommand(opts)` | the quoted resolved path plus the run token and nothing else — no flag channel, no free-form arguments; appends `withRunToken()` when a token is given |
| `parseDownloadedFile(output)` | the `[Merger]` path when present, else the last `[download] Destination:` line; `""` when neither appears |
| `extractErrorLine(output)` | the last `ERROR:` line when present, else the last non-empty line; bounded to 240 characters |
| `SHUTDOWN_MINUTES_DEFAULT` / `SHUTDOWN_MINUTES_MINIMUM` | `15` / `10` — the default when the setting is blank or absent, and the floor a usable whole number must exceed |
| `resolveShutdownMinutes(raw)` | blank, `null` or `undefined` → 15 (the default, not an error); a run of digits whose integer is **strictly greater than 10** → that integer; anything that is not a plain run of digits, or a whole number ≤ 10, → `null`, which disables play |
| `shutdownRemainingSeconds(deadlineMs, nowMs)` | whole seconds until the deadline, rounded up (`Math.ceil`) and floored at 0; unusable input → 0 |
| `formatCountdown(seconds)` | `"M:SS"`, growing to `"H:MM:SS"` past an hour; `0`, negatives, non-finite values and garbage → `"0:00"` |
| `UPDATE_CHECK_URL`, `UPDATE_PAGE_URL`, `UPDATE_CHECK_MAX_TIME_SECONDS`, `UPDATE_CHECK_MARKER`, `UPDATE_CHECK_CURL_BINARY`, `PACKAGE_ID`, `INSTALLED_METADATA_PATH`, `VERSION_PATTERN`, `WIDGET_VERSION_PATTERN` | the update-check constants: the fixed https manifest URL, the fixed release-page root the update indicator opens, the 5-second curl cap, the split marker, the `curl` binary, the package id, the shell-expanded installed `metadata.json` path, and the two version regexes |
| `isVersionString(text)` | true when `text` matches `VERSION_PATTERN`; the one shape gate shared by `parseWidgetVersion`, `parseLatestVersion` and `compareVersions` |
| `buildUpdateCheckCommand(opts)` | the fixed update check — `cat <metadata.json> 2>/dev/null`, a `printf` of the marker, then `curl -fsSL --max-time 5 <fixed-url>` — assembled entirely from constants; appends `withRunToken()` when a token is given |
| `splitUpdateCheckOutput(raw)` | splits the one-shot stdout at the line exactly `UPDATE_CHECK_MARKER` into `{installed, manifest}`; with no marker, `installed: ""` and `manifest` is the whole text; always returns both string keys, never throws |
| `parseWidgetVersion(rawMetadata)` | the `"Version"` value scanned out of the shipped `metadata.json` text, or `""` when the key is missing, empty or not version-shaped |
| `parseLatestVersion(rawManifest)` | the `version` field of the fetched manifest JSON, or `""` when the body is not JSON, not an object, carries no string `version` or an unshaped one; never throws |
| `compareVersions(left, right)` | numeric, segment by segment: `-1` / `0` / `1`; a longer run wins a shared prefix (`1.2` < `1.2.1`); `null` when either side is not a version string |
| `isUpdateAvailable(installed, latest)` | true only when both sides are version strings and the latest is **strictly** greater; identical, lower or garbage → false |

State ownership: this module owns *meaning*; `main.qml` owns the lifetime of the values. The download
helpers own the whole safety argument for the one command that is not a fixed constant: the URL is
classified before a command exists, and every value interpolated into the command — URL and
configuration alike — goes through `shellQuote()`. The boundary itself is recorded in
[../adrs/adr-0006-video-downloader-command-boundary.md](../adrs/adr-0006-video-downloader-command-boundary.md).

The download row now builds **two** commands inside its one exception, and they share the same validated
inputs. `buildVideoDownloadCommand()` writes the run's own pid from a fixed prefix — `exec` replaces the
shell, so the pid in the file is the downloader's, not a wrapper's — and refuses outright (`""`) when no
usable home or no plain-named stamp/token can name that file, because a run that cannot be located is a
run that cannot be cancelled; the ` ; ` separators are deliberate fail-open, so an unwritable state
directory degrades the download to "not cancellable" instead of breaking it. `buildDownloadStopCommand()`
is the single one-line shell program that polls that file, accepts only a **live** pid (`kill -0`),
`kill -TERM`s and, if needed, `kill -KILL`s the writer, prints the outcome marker, and sweeps **last**
(and only when the id resolved) so the sweep's exit status is the run's: one command, one shell process,
a guaranteed kill-before-sweep order. A refused kill exits 1 without sweeping, ever; a run whose pid is
already gone answers `not-running`, so an ended download is never relabelled as cancelled; and a kill that
succeeded with no id to anchor a sweep answers `killed no-sweep` rather than claiming the partials are
gone. The second command's inputs are the same validated directory and home, the project-owned state path,
and the id recovered by `extractVideoId()` from the already-allow-listed URL — which is why it is the
second built command of the same exception rather than a third exception
([[adr-0022-download-cancellation-and-partial-cleanup]]).

The shutdown helpers own a different boundary: the configured minutes are a validated *duration*, not a
command fragment, so `resolveShutdownMinutes` decides whether a countdown can be armed at all while the
fixed `systemctl poweroff` command stays in `main.qml` and is never touched. `null` is the deliberate
answer for an unusable value; the caller disables play and shows why, rather than arming a nonsense
countdown ([../adrs/adr-0009-widget-owned-shutdown-countdown.md](../adrs/adr-0009-widget-owned-shutdown-countdown.md)).

The update-check helpers own a third boundary, and it is deliberately the opposite of the download's:
`buildUpdateCheckCommand()` interpolates nothing — every fragment is a fixed constant, the URL included —
so it adds no new command-building exception
([../adrs/adr-0013-widget-update-check-and-release-site.md](../adrs/adr-0013-widget-update-check-and-release-site.md)).
`VERSION_PATTERN` is the single shape gate — one to three numeric segments, no leading zeros — and
`isVersionString()` is the only place that rule is applied, so `parseWidgetVersion`, `parseLatestVersion`
and `compareVersions` all refuse a malformed segment at once rather than half-parsing it in one place. The
comparison is numeric and segment-wise on purpose (`"0.10"` is greater than `"0.9"`), and
`isUpdateAvailable()` is conservative by construction: it is true only for a strictly-greater remote, so
the widget structurally cannot show an update line that is wrong. `UPDATE_PAGE_URL` is the second fixed
constant in this area: the update indicator's click opens it through one of the widget's two
`Qt.openUrlExternally` calls — the other is the download row's open-folder shortcut, a `file://` URL
built by `buildFolderUrl()` from the resolved configured directory
([[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]). Both are pinned by the Node suite as
exact call-site text, so neither target can drift onto configuration and no third one can appear
silently. `formatDownloadDirectory()` and `buildFolderUrl()` are the display and URL forms of the
configured download directory: both resolve through `resolveDownloadDirectory()`, so the folder the
tooltip names and the folder the shortcut opens are the same one the download command writes into, and
both answer `""` while `$HOME` is unknown — the same condition that gates `downloadReady`
([[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]).

The compose grouping and the Podman launch own a fourth boundary, and it is the second sanctioned
command-building exception. The probe already carries the grouping identity: `parseContainers()` reads
`{name, state, project}` from the label-augmented `docker ps` line, and `groupContainersByComposeProject()`
folds that flat list into `[{project, containers}]` — compose groups in first-seen order, the no-project
bucket last and only when non-empty — so a machine that answers no label still shows one standalone group
rather than nothing. `buildComposeProjectCommand()` turns a group into
`docker start|stop $(docker ps -aq --filter 'label=com.docker.compose.project=<project>')`, the project name
interpolated as exactly one shell-quoted argument and the function returning `""` for the standalone
bucket or an unvalidated action, while `buildPodmanDesktopCommand()` assembles the quoted resolved path
plus the run token and nothing else. Both mutations are unprivileged — the user's own docker socket and
the user's own session — so the daemon's start/stop asymmetry is untouched; the boundary is recorded in
[../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md](../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md)
and the sources and surfaces that call it in the [widget slice](../widget/widget-slice.md). The popup
surface that called the Podman builder was removed
([[adr-0016-containers-flat-rows-and-podman-section-removal]]), which drops the data-source count to ten,
but the builders, the resolver, the `podmanDesktopPath` kcfg entry and their tests stand: the boundary
remains live in the pure core even though no QML surface currently calls it.

## Conventions of this slice

- No QML types, no imports, no I/O. `.pragma library` at the top is the only QML-ism in the file.
- ES5 style (`var`, `switch`) on purpose: a bare engine has to run it. Do not modernise it into
  classes or arrow functions without checking the harness's context first.
- Every enum-like value is an exported constant, and QML compares against the constant rather than a
  literal. A new state means a new constant plus a severity branch plus a colour in the widget slice.
- Default arms degrade to `unknown`/`muted`, never to a healthy reading. A broken probe must not look
  like a stopped daemon.
- Testability is a design constraint, not a by-product: a new behaviour needs a pure function with a
  test, not a branch inside `onNewData`. The shutdown helpers are the worked example — every branch of
  `resolveShutdownMinutes`, the ceiling and the floor of `shutdownRemainingSeconds`, and the `M:SS` /
  `H:MM:SS` boundary of `formatCountdown` all have unit tests.
- Quoting is proven, not asserted: the `shellQuote` round-trips and the assembled download command are
  tested against a real `/bin/sh`, with a stub `yt-dlp` on `PATH` that prints its argv. A change to the
  quoting rule without a shell-level test is a regression waiting to happen. The assembled compose
  command is exercised the same way, with a stub `docker` and a project name carrying shell
  metacharacters.

## Dependencies

**Upstream:** none. The file imports nothing, which is exactly why it is testable.
**Downstream:** the widget slice imports it as `DockerStatus`; the verification slice evaluates these
exact bytes; the data engine contract documents the set semantics that make `withRunToken` necessary.

## Known gaps & accepted debt

- Container states outside the mapped set (for example `removing`) degrade to `muted` by design and
  are not asserted against live `docker ps` output.
- `withRunToken` is coupled to shell semantics. It is safe only because the commands it decorates are
  fixed constants or, in the sanctioned command-building exceptions, values that were validated and
  shell-quoted before the token is appended. If configuration ever supplied an unvalidated command
  string directly, the trailing comment would become injectable text.
- Malformed input is skipped rather than reported, so a systematic format change from `docker` would
  show up as an empty list rather than as an error.
- The functions are string-driven: a change in `systemctl` or `docker` output format is caught by the
  harness, not by the running widget.
- The version shape is deliberately strict — one to three numeric segments, no leading zeros, shared by all
  three parsers through `VERSION_PATTERN`. A legitimate four-segment version (`1.2.3.4`) or a leading-zero
  segment (`01`) is refused everywhere at once, so an unusual release-version scheme would read as "no
  version" and therefore as "no update" rather than as an error. Accepted: a false negative is a silent
  non-event, a false positive is a wrong line the user reads.
- The stop path's process handling is only partly testable here: the resolvers, the command text and the
  marker parser are pure and pinned, and the kill itself is rehearsed through a real `/bin/sh` against a
  stub that stays alive — but whether plasma5support really runs the command through a shell — the `$$`,
  the `exec` and the run token all ride on that — is an assumption shared with the existing download
  command, not a measured fact. The sweep's
  reach is bounded by construction: one shell-quoted directory literal, `-maxdepth 1`, `-type f` with no
  `-L`, and an id-anchored pattern emitted only when `extractVideoId()` resolved
  ([[adr-0022-download-cancellation-and-partial-cleanup]]).
