---
id: adr-0022-download-cancellation-and-partial-cleanup
category: adrs
tags: [adr, download, cancellation, cleanup, data-engine, command-boundary, ui]
aliases: [ADR-0022]
related: [adr-index, adr-0006-video-downloader-command-boundary, adr-0021-download-folder-tooltip-and-open-folder-shortcut, data-engine-contract, status-slice, widget-slice, ui-surfaces]
version: 1.1
status: active
supersedes: adr-0006-video-downloader-command-boundary
---

# ADR-0022: The download row gains a real cancel — a pid handle, a kill-and-sweep one-shot and a dismissable row

## Problem

The download row could start a download and report on it; it could not stop one. The human operator
asked for both halves of that: a stop that cancels a download in flight **and** deletes the half-written
file it leaves behind, plus a way to dismiss the row's feedback.

The engine gives the row no handle to do that with. `downloadAction` is a one-shot
`P5Support.DataSource` (`engine: "executable"`, `interval: 0`), and the engine hands the row exactly one
event, at process exit — minutes after the click. It exposes **no pid and no kill path**; the only lever
it documents is `connectedSources = []`, and the engine's own contract sheet records precisely what that
is: "disconnect: no further `onNewData`", the supported way to stop a *source*
([data-engine-contract](../status/data-engine-contract.md), field groups and lifecycle). It ends the
reporting, not the run.

## Solution

One deliberate, narrowly scoped change, recorded here. This record **supersedes only ADR-0006's
exact-command-shape clause** — the one that fixes "the assembled command is exactly: `'yt-dlp' …`" as
the whole download command. Every other ADR-0006 clause stands: the row is still the one sanctioned
exception, the URL is still classified before a command exists, quoting is still the protection, and
`~/.config/yt-dlp/config` is still authoritative on purpose. ADR-0006 is not edited: the clause-level
reversal is carried here, the same convention the ADR index already uses for ADR-0006 (browser clause),
ADR-0008, ADR-0013, ADR-0014, ADR-0015 and ADR-0016.

1. **The rejected lie.** `connectedSources = []` plus a defensive sweep of the download directory.
   Rejected, and rejected loudly, because it would only disconnect the events: yt-dlp keeps
   downloading, finishes, writes the finished file, while the row claims "cancelled". A stop that lies
   to the user is worse than no stop. Nothing in this record disconnects a live download.

2. **The handle: the run writes its own pid.** The download command gains a fixed prefix, built in
   `dockerstatus.js` beside the rest of the builder, with the downloader still the last thing the
   command names:

   ```sh
   mkdir -p '<stateDir>' ; echo $$ > '<stopFile>' ; exec '<binary>' --cookies-from-browser '<browser>' --js-runtimes '<runtime>' --no-playlist --no-progress -P '<dir>' -o '%(title)s [%(id)s].%(ext)s' '<url>' # plasma-run-N
   ```

   `$$` is expanded by the shell the engine runs the command in, and `exec` replaces that shell with
   the downloader, so the pid written into the file **is** yt-dlp's pid — no parent/child mismatch and
   no extra process held open for the duration of a download. Without `exec`, `$$` would name a shell
   that outlives the download, and a SIGTERM sent to it would orphan yt-dlp while the row reported a
   clean cancel. The command is refused (`""`) when no usable home or no plain-named stamp/token can
   name the pid file: a download that cannot be located is refused rather than started uncancellable,
   the same empty-command contract the compose builder already has. The prefix separators are ` ; `
   (fail-open) on purpose, so an unwritable state directory degrades the download to "not cancellable"
   instead of breaking it.

3. **Rejected handle designs, with reasons.** Neither alternative earns its risk:
   - **A wrapper shell that traps and forwards.** The engine's child becomes the wrapper, so any
     engine-side teardown kills the wrapper and **orphans yt-dlp** — strictly worse than today, where
     nothing is killed at all. A non-interactive shell also backgrounds jobs with SIGINT/SIGQUIT
     ignored, so the trap buys nothing that SIGTERM does not already do directly.
   - **`setsid` / process-group kill.** A negative-pid kill needs the child to be a process-group
     leader, which the engine does not guarantee; and signalling the wrong group can take down
     plasmashell's own group. Destructive in the wrong direction, for no gain over a plain pid.

4. **One stop command, not two.** A second one-shot (`downloadStopAction`) runs a **single-line shell
   program**: poll ~1 s for the run's pid file accepting only a **live** pid (`kill -0`); `kill -TERM`;
   the refused kill writes a stderr marker and **exits 1 without sweeping** — partials are never deleted
   for a process the widget failed to signal; wait ~1 s, `kill -KILL` if still alive; `rm -f` the pid
   file; the outcome marker; and the sweep **last**, so the sweep's own exit status becomes the run's.
   No live pid → `rm -f` the file and the `not-running` marker. The command is refused (`""`) when no
   stop file can be resolved, exactly as the download command is refused in the same case: a run the
   stop cannot locate is a run the stop must not be asked to kill. One command means one shell process
   means **guaranteed kill-before-sweep ordering**; two one-shots would need sequencing the engine does
   not provide, and the ordering is the whole safety argument (point 7).

5. **The state file.** `'<home>/.local/state/docker-status/download-<sessionStamp>-<runToken>.pid'`,
   resolved by a pure helper so the writing side and the reading side cannot drift. The per-run name is
   the guard, not decoration: a reloaded widget's run-token counter restarts at 0, so a token-only name
   could collide with a previous instance's still-running download and make STOP kill that orphan while
   reporting success. **The stamp must be unique per instance, and a millisecond timestamp is not enough
   for that** *(corrected 2026-10-17: the stamp is `"" + Date.now() + "-" + Math.floor(Math.random() *
   1e9)` — see the addendum)*: two instances loaded in the same millisecond — the same applet in a panel
   and on the desktop, or a second containment — shared the stamp, each minted token 1 for its first run,
   and both named `download-<stamp>-1.pid`; the second run's `echo $$ >` overwrote the first's pid file,
   so the first instance's STOP signalled the second instance's download. The nonce is digits joined by a
   hyphen, which keeps the whole stamp inside `resolveDownloadStopFile()`'s `/^[A-Za-z0-9._-]+$/`
   charset — the only shape that names a stop file at all. `$XDG_RUNTIME_DIR` is the more correct home per
   the XDG base-dir spec, but it is not derivable from state the widget already has; the resolver is the
   seam if that is ever revisited.

6. **Identifying the partial set.** `extractVideoId(url)` recovers the id yt-dlp substitutes for
   `%(id)s`, validated to `/^[A-Za-z0-9_-]+$/` — that charset is exactly why it cannot contain a glob
   metacharacter. A playlist-only link, an empty id and an id longer than 32 characters are refused the
   same way, with `""`, and a run with no id reports `killed no-sweep` instead of pretending the folder
   is clean. The sweep is:

   ```sh
   find '<dir>' -maxdepth 1 -type f \( -name '*.part' -o -name '*.part-Frag*' -o -name '*.ytdl' \) -name '* [[]<id>[]]*' -delete
   ```

   emitted only when the id resolved. **Anchor on the id, never a bare suffix glob:** a suffix-only
   glob would delete an unrelated `*.part` in the default `~/Downloads` — Firefox writes its own
   `.part` files there — which is collateral damage on a live browser download. The in-flight filename
   is unknown by design, because the engine delivers exactly one event, at exit, and `--no-progress`
   emits no live path. Traversal proof, in one sentence: one shell-quoted directory literal,
   `-maxdepth 1`, `-type f` with no `-L`, and no other value reaching the pattern; a `..`-bearing
   configured directory resolves to the same directory the download writes into, so the sweep's reach
   equals the download's reach and never exceeds it.

7. **Interrupt before sweep: yes, but the sweep owns cleanup.** The signal's job is to stop the writer;
   the sweep's job is to delete the partials. Deleting a file while its writer is alive is a race, so
   the process must die first — hence one command with a fixed order, and hence the refusal to sweep
   after a kill that failed. yt-dlp keeps `.part` artefacts by design (they enable resume), and SIGTERM
   terminates a Python process without running a Python-level cleanup path, so relying on the process to
   remove its own partial is an unverified assumption pointed the wrong way. **This record does not
   claim yt-dlp cleans up after itself**; the widget does the sweep because it cannot delegate it.

8. **This is the second built command of the SAME download-row exception, not a third exception.**
   The stop command's inputs are the home directory, the project-owned state path, the id recovered from
   the already-allow-listed URL, and **the directory the run itself resolved `-P` against** — captured
   when the download starts, beside the URL and the run token, never re-read from the configuration at
   click time *(corrected 2026-10-17: this point used to read "the same validated directory and home the
   download command uses", which assumed the stop could re-read the same value when STOP was pressed. It
   could not — see the addendum — so the directory is now part of the captured run identity.)*
   `docs/project.md`'s "two recorded exceptions" stays true, and the row now builds two commands inside
   its one.

9. **The marker protocol.** `killed` / `killed no-sweep` / `not-running` on stdout, behind a
   `docker-status: ` prefix, parsed by one pure function. Distinguishing `killed no-sweep` from `killed`
   is what lets the row say honestly that the partial may remain instead of claiming a clean cancel; it
   is what a successful kill reports when there was no id to anchor a sweep on, while a kill that was
   refused never reaches this marker at all — it fails on stderr and exits 1.

10. **The row.** The busy indicator moves out from beside the Import button into the feedback row's
    leading slot, so the row **is** the notification and renders in the same synchronous turn as the
    click, independent of the button. While a download is in flight the right edge carries **STOP**; the
    X (dismiss) is shown **only when a download is not in flight**, because an X that silently
    cancels-and-deletes risks the accidental loss of an in-progress download. On success the row keeps
    the positive severity and the existing folder-open icon
    ([[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]). Severity stays NEUTRAL in flight,
    so `SeverityDot.qml` remains the only severity-to-colour switch. `miscBodyVisible` gains
    `|| downloadInFlight`, so a live STOP can never be collapsed away — ADR-0009's own reasoning
    ([[adr-0009-widget-owned-shutdown-countdown]]) applied to the second live control.

11. **Races, with their user-visible outcomes.** STOP pressed in the instant the run ends — STOP is
    visible only while a run is in flight, so this is a race, never a click on a finished row: the stop
    command requires a live pid, so an ended download answers `not-running`, the run's own closing event
    then lands, and the user sees the download's own success or failure — the click is visibly a
    no-op, never a false "cancelled". The window in which a stop can relabel a finished run is **wider
    than this record first assumed**, and the mechanism is measurable: the stop command's own predicate
    **accepts a zombie** (`/proc/<pid>/stat` state `Z` still passes `kill -0` rc=0 and `kill -TERM`
    rc=0, and the command's `case`/`kill -0` test answers *accepted*), so a stop can report `killed` for a
    process that already exited and whose own result is already on the row. The guard is the run's own
    latch: the `killed` branch returns early while `downloadRunClosed` is set — the run's closing event
    already painted its real outcome, and that outcome is the truth — so only a stop whose run has **not**
    closed (a genuine kill, whose own failure event the pending-cancel guard withheld) may claim the
    cancel *(corrected 2026-10-17, with the zombie measurement — see the addendum)*. A widget reload
    mid-download drops the row, the process is beyond reach and any partial stays on disk. The widget
    deliberately does **not** kill anything at load, because it cannot verify that a pid found in a
    leftover file is its own, and an unverifiable kill is a destructive act without evidence.

12. **The pins move with the change.** The data-source count pin goes 11 → 12, naming
    `downloadStopAction`; the command-shape pins are extended to the new exact prefix; and the
    argv-stub tests over a real `/bin/sh` are kept, proving that `exec` plus the prefix does not disturb
    yt-dlp's argv. The `Qt.openUrlExternally` `count == 2` set-equality pin is **not** loosened: the new
    controls add no third call site.

## When to use

Read this record when touching the download row's STOP or dismiss control, the pid file and its
resolvers, `extractVideoId`, `buildDownloadStopCommand`, `parseDownloadStopResult`, the partial sweep,
or the `downloadStopAction` one-shot. It is also the record to read before concluding that
`connectedSources = []` "cancels" anything — it ends the events, and nothing else.

## When not to use

It is not permission to kill anything the widget did not start: the stop works only through a pid the
run wrote for itself, and only while that pid is live. It is not permission to sweep with a glob that
is not anchored on a validated video id, to sweep outside `-maxdepth 1`, to follow symlinks, to delete
a partial whose writer was not successfully signalled, or to delete anything after the widget reloads —
a reload loses the row and the run is left alone on purpose. It is not permission to widen the sweep to
`*.fNNN.*`, `*.temp` or "anything that looks partial". It is not permission to turn the download row
into a general process-killer, to add a second exception, or to give the stop command any input beyond
the validated directory, the home directory, the project-owned state path and the recovered id. And it
is not permission to claim in any doc that the process cleans up after itself: it does not.

## Examples

- **`dockerstatus.js`** — gains `extractVideoId(rawUrl)` (the `%(id)s` id, refused unless it matches
  `^[A-Za-z0-9_-]+$`), `resolveDownloadStopDirectory(home)` /
  `resolveDownloadStopFile(home, sessionStamp, token)` (the shared path resolution, where `token` is the
  **download's** run token), `buildDownloadStopCommand(opts)` (the one-line kill-then-sweep program),
  `parseDownloadStopResult(rawOutput)` (the marker parser), and the stop-protocol constants
  (`DOWNLOAD_STOP_MARKER_PREFIX`, the three outcomes and the `""` unknown).
  `buildVideoDownloadCommand()` gains the fixed `mkdir` + pid prefix in front of the downloader.
- **`main.qml`** — the download handler mints one session stamp per instance (`Date.now()` plus a random
  nonce), captures the URL **and the download directory the run resolved against** beside the run token,
  feeds all of them to both builders, and answers `downloadStopRequested()` on the new
  `downloadStopAction` one-shot; the stop's outcome is rendered on the row's own feedback line, and the
  run's own outcome, once painted, is latched so a settling stop cannot overwrite it.
- **`FullRepresentation.qml`** — the busy indicator relocates into the feedback row's leading slot; the
  row's right edge carries STOP while in flight and the X only when it is not; `miscBodyVisible` gains
  `|| fullRoot.downloadInFlight`.
- **`tests/dockerstatus.test.mjs`** — the data-source count pin reads twelve and names
  `downloadStopAction`; the command-shape pins name the new prefix; the argv-stub tests keep proving the
  downloader's argv.
- **Registered in the live docs.** [adr-index.md](adr-index.md) lists this record,
  [../status/status-slice.md](../status/status-slice.md),
  [../status/data-engine-contract.md](../status/data-engine-contract.md),
  [../widget/widget-slice.md](../widget/widget-slice.md),
  [../widget/ui-surfaces.md](../widget/ui-surfaces.md) and
  [../verification/troubleshooting.md](../verification/troubleshooting.md) carry the facts, and
  [../project.md](../project.md) routes the new symptom strings.
- **Ids minted.** `adr-0022-download-cancellation-and-partial-cleanup` (this record).

## Common mistakes

Accepted debt, stated honestly rather than discovered later:

- **Mid-merge `*.fNNN.*` intermediates are left behind.** The sweep is deliberately narrowed to the
  documented partial suffixes instead of patterns that could hit unrelated media.
- **A user `~/.config/yt-dlp/config` carrying its own `--paths temp:` defeats the sweep**, because the
  partials land somewhere the widget cannot name. ADR-0006 point 5 keeps that file authoritative on
  purpose, so this is a consequence of a standing decision, not an oversight.
- **A reload mid-download leaves the process and the partial alone**, and one small pid file per
  non-cancelled run accumulates in `~/.local/state/docker-status/`.
- **The zombie window**, and why it is not the sub-second reap race this record first recorded: the stop
  command's own predicate accepts a zombie pid, so the interval in which a stop can answer `killed` for a
  process that already exited is the interval that pid stays a zombie, not the reaping race. The `killed`
  branch's `downloadRunClosed` early return is what keeps the run's own result on the row; the
  `killed no-sweep` branch does not carry that guard (see the addendum).
- **Not debt, but the designed answer for an unwritable state directory.** `mkdir -p` fails open, so no
  pid file is ever written: STOP polls for about a second, answers `not-running` on every retry, and the
  row surfaces the negative "it may still be running" line while keeping the run in flight and STOP
  retryable — rather than a button that visibly does nothing.
- **The shell assumption is shared and fragile.** If a future plasma5support stopped interpreting
  commands through a shell, the `$$` prefix, the quoting and the existing run-token comment would break
  together — it is the same assumption the current command already depends on, not a new one, but it is
  now load-bearing in one more place.
- **Reading `connectedSources = []` as a cancel.** It is the lie of point 1. A stop that reports
  success while the download continues is the exact failure this record exists to prevent.

## Addendum — 2026-10-17: four corrections the shipped code required

Appended, not substituted: the decision (a real kill through the pid the run wrote for itself, one
kill-and-sweep command, never a sweep after a refused kill) stands. Four claims in the text above did not
hold against the shipped `main.qml`; each is corrected inline where it sat, and recorded here with the code
it is read from.

**1. The session stamp carries a per-instance nonce.** It is
`"" + Date.now() + "-" + Math.floor(Math.random() * 1e9)`. A millisecond timestamp alone was probabilistic,
not unique: two instances loaded in the same millisecond shared the stamp, each named its first run
`download-<stamp>-1.pid`, the second run's `echo $$ >` overwrote the first's pid file, and the first
instance's STOP then signalled the second instance's download. The nonce closes that; digits joined by a
hyphen keep the stamp inside the `/^[A-Za-z0-9._-]+$/` shape `resolveDownloadStopFile()` accepts.

**2. The stop's directory is captured at start, not re-read at click time.** `stopDownload()` used to
re-read `Plasmoid.configuration.downloadDirectory` when STOP was pressed, while the download command had
resolved `-P` from the value in force when the run started: editing the download folder mid-run made the
sweep run in the wrong directory, find nothing, exit 0 and print `killed` — a clean cancel claimed while
the partial stayed exactly where it was written. The handler now captures the directory at start
(`root.downloadDirectory = Plasmoid.configuration.downloadDirectory`) beside the URL and the run token, and
both builders read the captured value.

**3. The zombie window is wider than a reap race, and the `killed` branch latches on the run's outcome.**
The stop command's own predicate accepts a zombie — `/proc/<pid>/stat` state `Z` passes `kill -0` rc=0 and
`kill -TERM` rc=0, and the command's `case`/`kill -0` test answers *accepted* — so the ordering in which a
stop can report `killed` for a run that already finished is genuinely unknowable from the stop side. The
guard sits on the run side: the `killed` branch returns early (`root.downloadRunClosed` → clear
`downloadCancelRequested`, return) whenever the run's own closing event has already painted its result, so
that result is never relabelled. The narrower reading this record first recorded — "a sub-second window
where the pid is a not-yet-reaped zombie" — understated both the mechanism and its width.
**Shipped-code note, for a reviewer:** the `killed no-sweep` branch does **not** carry that early return —
it writes its "cancelled; the partial could not be removed automatically" line unconditionally — so on that
branch a stop that accepted a zombie can still overwrite an already-painted run outcome. This record does
not claim otherwise; the discrepancy between the intended correction and the shipped file is flagged here
rather than papered over.

**4. The silent-stop path is an honest degradation, not debt.** An unwritable state directory makes
`mkdir -p` fail open, so no pid file is ever written: STOP polls for about a second and then answers
`not-running` on every retry, forever. The old row restored the in-flight text with no explanation — a
button that visibly does nothing. The `not-running` branch now surfaces the negative "The download could
not be stopped; it may still be running." line while keeping `downloadInFlight` true, so STOP stays
visible and retryable and the dismiss X stays hidden behind the run it must not cancel. That is the
recorded behaviour: in that configuration the download is not cancellable, and the row says so instead of
pretending otherwise.

## References

- [[adr-0006-video-downloader-command-boundary]] — the record whose exact-command-shape clause this one
  supersedes; its validation, its quoting rule, its `--no-playlist`/`--no-progress` reasoning and its
  "the widget keeps yt-dlp's own configuration" clause all still stand.
- [[adr-0021-download-folder-tooltip-and-open-folder-shortcut]] — the row's tooltip, its folder-open
  shortcut and the strict two-call-site pin this record leaves untouched.
- [[adr-0009-widget-owned-shutdown-countdown]] — the reasoning that a live control must not be
  collapsible, applied here to the STOP button.
- [../status/data-engine-contract.md](../status/data-engine-contract.md) — the `connectedSources`
  lifecycle row, the one-event-per-run measurement and the pid-less engine this record works around.
- [../status/status-slice.md](../status/status-slice.md) — the pure helpers the boundary lives in.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the twelve data sources and the row wiring.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the row's inventory entry and its lifecycle.
- [../verification/troubleshooting.md](../verification/troubleshooting.md) — the refusal, the leftover
  partial and the undismissable row, written up symptom by symptom.
- [[adr-index]] — the hub this record is registered in.
