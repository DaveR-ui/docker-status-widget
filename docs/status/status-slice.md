---
id: status-slice
category: status
tags: [slice, generality, status, logic]
aliases: [Status slice, Logic slice]
related: [status-index, data-engine-contract, widget-slice]
version: 1.0
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
container objects; counting and the compact badge; severity mapping for both daemon and containers;
the run-token helper; video-link classification; shell quoting; download-directory, binary, runtime
and runtime resolution; download-command assembly; download-result parsing; the shutdown-duration
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
| `parseContainers(raw)` | one `{name, state}` per line, split at the **first** `\|`; a line without a separator, or with an empty side, is skipped |
| `countByState(list, state)` | exact-state count |
| `summarizeContainers(list)` | `"running/total"`; `"0/0"` for empty, `null` or `undefined` |
| `withRunToken(cmd, n)` | `cmd + " # plasma-run-" + n` — a distinct source for an identical command |
| `daemonSeverity(state)` | active → positive; inactive → neutral; failed → negative; anything else → muted |
| `containerSeverity(state)` | running → positive; exited/created → neutral; restarting/dead/paused → negative; anything else → muted |
| `classifyVideoUrl(raw)` | trims, then `https` only, exact host allow-list, ≤2048 chars, no inner whitespace/quotes/backtick/backslash/control char → `youtube`/`twitter`; anything else → `null` (no command is built) |
| `shellQuote(value)` | wraps in single quotes; an embedded `'` becomes `'\''`; `null`/`undefined` → `''` |
| `expandTilde(path, home)` | a leading `~/` (or a bare `~`) expands against home; a tilde elsewhere stays literal |
| `resolveDownloadDirectory(cfg, home)` | absolute, `~`-expanded, trailing slashes trimmed; empty, relative or control-character value falls back to `<home>/Downloads` |
| `resolveYtDlpBinary(cfg, home)` | a plain name or path matching `^(~/)?[A-Za-z0-9._/+-]+$`, else `yt-dlp` |
| `resolveJsRuntime(cfg)` | a valid runtime name; empty opts out and returns `""` so the flag is omitted; garbage falls back to `node` |
| `resolveCookiesBrowser(cfg)` | a valid `BROWSER[+KEYRING][:PROFILE]` token matching `^[A-Za-z0-9._+:,-]+$`; empty opts out and returns `""` so the flag is omitted; garbage falls back to `firefox` |
| `buildVideoDownloadCommand(opts)` | the assembled yt-dlp command, with `--cookies-from-browser` taken from the validated browser value (omitted when that value is `""`); omits `--js-runtimes` when the runtime is `""`; appends `withRunToken()` when a token is given |
| `parseDownloadedFile(output)` | the `[Merger]` path when present, else the last `[download] Destination:` line; `""` when neither appears |
| `extractErrorLine(output)` | the last `ERROR:` line when present, else the last non-empty line; bounded to 240 characters |
| `SHUTDOWN_MINUTES_DEFAULT` / `SHUTDOWN_MINUTES_MINIMUM` | `15` / `10` — the default when the setting is blank or absent, and the floor a usable whole number must exceed |
| `resolveShutdownMinutes(raw)` | blank, `null` or `undefined` → 15 (the default, not an error); a run of digits whose integer is **strictly greater than 10** → that integer; anything that is not a plain run of digits, or a whole number ≤ 10, → `null`, which disables play |
| `shutdownRemainingSeconds(deadlineMs, nowMs)` | whole seconds until the deadline, rounded up (`Math.ceil`) and floored at 0; unusable input → 0 |
| `formatCountdown(seconds)` | `"M:SS"`, growing to `"H:MM:SS"` past an hour; `0`, negatives, non-finite values and garbage → `"0:00"` |
| `UPDATE_CHECK_URL`, `UPDATE_CHECK_MAX_TIME_SECONDS`, `UPDATE_CHECK_MARKER`, `UPDATE_CHECK_CURL_BINARY`, `PACKAGE_ID`, `INSTALLED_METADATA_PATH`, `VERSION_PATTERN`, `WIDGET_VERSION_PATTERN` | the update-check constants: the fixed https manifest URL, the 5-second curl cap, the split marker, the `curl` binary, the package id, the shell-expanded installed `metadata.json` path, and the two version regexes |
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
the widget structurally cannot show an update line that is wrong.

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
  quoting rule without a shell-level test is a regression waiting to happen.

## Dependencies

**Upstream:** none. The file imports nothing, which is exactly why it is testable.
**Downstream:** the widget slice imports it as `DockerStatus`; the verification slice evaluates these
exact bytes; the data engine contract documents the set semantics that make `withRunToken` necessary.

## Known gaps & accepted debt

- Container states outside the mapped set (for example `removing`) degrade to `muted` by design and
  are not asserted against live `docker ps` output.
- `withRunToken` is coupled to shell semantics. It is safe only because the commands it decorates are
  fixed constants or, in the one sanctioned exception, values that were validated and shell-quoted
  before the token is appended. If configuration ever supplied a command string directly, the trailing
  comment would become injectable text.
- Malformed input is skipped rather than reported, so a systematic format change from `docker` would
  show up as an empty list rather than as an error.
- The functions are string-driven: a change in `systemctl` or `docker` output format is caught by the
  harness, not by the running widget.
- The version shape is deliberately strict — one to three numeric segments, no leading zeros, shared by all
  three parsers through `VERSION_PATTERN`. A legitimate four-segment version (`1.2.3.4`) or a leading-zero
  segment (`01`) is refused everywhere at once, so an unusual release-version scheme would read as "no
  version" and therefore as "no update" rather than as an error. Accepted: a false negative is a silent
  non-event, a false positive is a wrong line the user reads.
