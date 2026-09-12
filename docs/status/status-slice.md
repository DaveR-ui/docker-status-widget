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
parsers all live here, so the one place user input reaches a shell is testable without Plasma.

## Boundaries

**In:** output normalisation; `systemctl is-active` stdout to daemon state; `docker ps` rows to
container objects; counting and the compact badge; severity mapping for both daemon and containers;
the run-token helper; video-link classification; shell quoting; download-directory, binary, runtime
and runtime resolution; download-command assembly; download-result parsing.

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

State ownership: this module owns *meaning*; `main.qml` owns the lifetime of the values. The download
helpers own the whole safety argument for the one command that is not a fixed constant: the URL is
classified before a command exists, and every value interpolated into the command — URL and
configuration alike — goes through `shellQuote()`. The boundary itself is recorded in
[../adrs/adr-0006-video-downloader-command-boundary.md](../adrs/adr-0006-video-downloader-command-boundary.md).

## Conventions of this slice

- No QML types, no imports, no I/O. `.pragma library` at the top is the only QML-ism in the file.
- ES5 style (`var`, `switch`) on purpose: a bare engine has to run it. Do not modernise it into
  classes or arrow functions without checking the harness's context first.
- Every enum-like value is an exported constant, and QML compares against the constant rather than a
  literal. A new state means a new constant plus a severity branch plus a colour in the widget slice.
- Default arms degrade to `unknown`/`muted`, never to a healthy reading. A broken probe must not look
  like a stopped daemon.
- Testability is a design constraint, not a by-product: a new behaviour needs a pure function with a
  test, not a branch inside `onNewData`.
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
