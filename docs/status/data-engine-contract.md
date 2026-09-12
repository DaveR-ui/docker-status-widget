---
id: data-engine-contract
category: status
tags: [interface-surface, interface-contract, status, data-engine]
aliases: [Data engine contract, Executable engine contract]
related: [status-index, status-slice, widget-slice]
version: 1.0
status: active
---

# Executable Data Engine — Contract

Surface: `org.kde.plasma.plasma5support`, `DataSource` with `engine: "executable"`.
Owner: [status-slice](status-slice.md). Callers: [widget-slice](../widget/widget-slice.md).

## Contract

### Rule

One row per engine fact a consumer may rely on. Everything here is **probe evidence**: it was measured
against plasma5support 6.7.4 on the reference machine, in one session, and it is not reproducible by a
committed test — see the evidence layers in
[verification-slice](../verification/verification-slice.md#how-it-works). Anything not in these tables is
unverified, and treating
it as a guarantee is how a widget silently stops updating. This is a *contract* sheet, not a catalog:
the six sources that implement it are listed in
[widget-slice](../widget/widget-slice.md#how-it-works).

### Field groups

| Group | Fields | Meaning | Guarantee |
|---|---|---|---|
| Addressing | `connectedSources` | the list of shell command strings the source runs | an **assignment**, not an append; the engine treats it as a **set** |
| Payload | `stdout`, `stderr`, `exit code`, `exit status` | the run's result, handed to `onNewData` | the keys are present on delivery; values arrive as strings |
| Cadence | `interval` | milliseconds between runs; `0` disables repetition | quantised to roughly one second regardless of the requested value |
| Lifecycle | `connectedSources = []` | disconnect: no further `onNewData` | the supported way to stop a source |

### Mode differences

| Aspect | Polled (`interval > 0`) | One-shot (`interval: 0`) |
|---|---|---|
| Purpose | continuous state | an action, or an immediate re-read |
| The identical command assigned again | re-runs on the next tick | **not re-run** — the assignment is a set no-op |
| Instances | `daemonSource`, `containerSource` | `forcedDaemonRead`, `daemonAction`, `homeSource`, `downloadAction` |
| Output delivery | one `onNewData` per run | exactly one `onNewData`, at process exit, carrying the whole run |

Measured event counts for the trap that shapes this design:

| Action | Events |
|---|---|
| `connectedSources = ["echo A"]` | 1 |
| `connectedSources = ["echo A"]` again | **0** |
| `connectedSources = []` then `["echo A"]` | 1 |
| `connectedSources = ["echo A # run1"]` then `["echo A # run2"]` | 1 each |

Measured delivery for a LONG one-shot, which is what the download row is. Probe run under `qml6`
against live plasma5support 6.7.5, command
`printf 'first\n'; sleep 2; printf 'second\n'; printf 'oops\n' 1>&2; exit 3`:

| Observation | Value |
|---|---|
| Events for the whole run | **1** |
| Keys in that one event | `exit code`, `exit status`, `stderr`, `stdout` |
| `stdout` | both bursts, delivered together when the process exited |
| `exit code` | `3` |

The engine does **not** stream: a two-second silence in the middle of a run produces no event at all.
That is why the download row shows a busy indicator instead of a progress bar.

The last row is why `withRunToken()` exists: appending a unique trailing shell comment makes each
assignment a distinct source, so the command re-runs. Because that trick appends a shell comment, it is
safe only for command strings the project itself builds — fixed constants, never configuration.

### Normalization rules

- The engine normalises nothing. `stdout` and `stderr` arrive raw; consumers call `normalizeOutput()`
  from [status-slice](status-slice.md) so that CRLF, stray whitespace and `null` all collapse first.
- `exit code` arrives as a value, not a number. Convert before comparing, and treat anything non-zero as
  a failure the user must see.
- `stderr` can be empty on a failure, so the caller owns the fallback message.
- Setting `connectedSources` to `[]` disconnects the source; a binding that evaluates to `[]` is the
  mechanism the container source uses to stop polling while the daemon is down.
- A one-shot is not necessarily short: `downloadAction` can run for minutes with no event in between. The
  engine still delivers exactly one event, at exit, so the consumer's accumulation of `stdout` and `stderr`
  is defence against a future engine that streams, not a response to observed chunking. The consumer
  treats the event that carries `exit code` as the end of the run either way, which is why
  `downloadAction` ignores an event without that key while the fast one-shots (`forcedDaemonRead`,
  `daemonAction`, `homeSource`) read it unconditionally. `daemonAction` serves both privileged actions:
  only one of start and stop can be in flight at a time, so one one-shot source and one `actionInFlight`
  flag are enough, and `actionKind` distinguishes the reply's owner.

## Related sheets

- [status-slice.md](status-slice.md) — the logic that consumes this payload.
- [widget-slice.md](../widget/widget-slice.md) — the six sources that implement this contract.
- [troubleshooting.md](../verification/troubleshooting.md#the-start-daemon-button-does-nothing-on-the-second-click)
  — the symptom a consumer sees when the set semantics are ignored.
