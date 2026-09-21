---
id: adr-0009-widget-owned-shutdown-countdown
category: adrs
tags: [adr, power-management, shutdown, security, ui]
aliases: [ADR-0009]
related: [adr-index, adr-0004-scoped-polkit-grant, adr-0006-video-downloader-command-boundary, adr-0007-stop-button-confirmation-and-narrow-grant, widget-slice, ui-surfaces, status-slice, privilege-slice, verification-slice]
version: 1.0
status: superseded
---

# ADR-0009: A widget-owned shutdown countdown, not a scheduled shutdown

## Problem

The widget could start the daemon and stop it behind a confirmation, and both of those are changes to a
service it already knows how to talk to. "Power the machine off" is a different kind of action: it ends
the session, it is not undoable from inside it, and on a local active session logind performs it without
a password. Putting it one click away, with no recovery window, would be the destructive-action mistake
[ADR-0007](adr-0007-stop-button-confirmation-and-narrow-grant.md) refused for the docker stop — one order
of magnitude worse, because the fallout is the whole machine rather than one daemon.

Three forces had to be reconciled:

1. **The action is genuinely wanted.** A "Countdown to Extinction" that powers the machine off after a
   user-chosen delay belongs in the same widget as the start and stop buttons.
2. **Arming and cancelling must not become a privilege exercise.** Anything that needs root to *arm* is
   not a countdown, it is a second grant; anything that needs root to *cancel* is worse, because a denied
   or agent-less cancel leaves the machine armed with no local way back.
3. **The fixed-command rule must survive.** [ADR-0006](adr-0006-video-downloader-command-boundary.md)
   sanctions exactly one command-building exception — the video-download row — and a power-off that
   assembled its command from a configured duration would quietly be a second one.

The fact that shapes every safeguard below: unlike `systemctl stop docker`, the power-off does **not**
prompt. That is recorded in full in **Solution** point 6.

## Solution

One deliberate, narrowly bounded feature, recorded here.

1. **The countdown is widget-owned.** `main.qml` holds `shutdownPending`, `shutdownDeadlineMs` (a
   `Date.now()` wall-clock deadline), `shutdownRemainingSeconds`, `shutdownInFlight`,
   `shutdownFeedback`/`shutdownFeedbackSeverity`, a one-second `shutdownTicker` `Timer`, and a one-shot
   `powerAction` `DataSource`. The widget computes the deadline, ticks it locally, and fires the fixed
   command itself; nothing is scheduled in systemd, logind or cron. Cancel is purely local and needs no
   privilege.
2. **The deadline is a wall-clock timestamp, not one long `Timer` interval.**
   `shutdownDeadlineMs = Date.now() + shutdownMinutes * 60 * 1000`, and each one-second tick recomputes
   `shutdownRemainingSeconds` from `Date.now()` against that fixed deadline through
   `DockerStatus.shutdownRemainingSeconds()`. One second is only the display resolution, so a late tick
   cannot make the deadline drift. A 15-minute `Timer` interval could not survive suspend/resume or a
   clock adjustment, and the user could not watch it count down.
3. **Play arms once, stop cancels locally.** Pressing play starts the sequence and disables play the
   instant it is armed, so a single activation cannot arm twice; the only way to reverse it is the
   `Cancel` button, which is enabled only while a shutdown is pending. At expiry the ticker calls
   `firePowerOff()`, which runs the fixed constant through `withRunToken()` on `powerAction`.
4. **The power-off is a fixed constant and the duration never reaches it.**
   `readonly property string powerOffCommand: "systemctl poweroff"` — no interpolation, no concatenation,
   no configured value inside it. The configured minutes only size the local deadline. This decision
   therefore adds **no second command-building exception** to ADR-0006: the video-download row remains
   the only place user input reaches a shell.
5. **The duration is a validated setting, not an argument channel.** kcfg entry
   `shutdownCountdownMinutes` (type **String**, default **15**) plus a plain `QQC2.TextField` in
   `config/ConfigGeneral.qml`. `DockerStatus.resolveShutdownMinutes(raw)` is the single resolver:
   blank or absent → 15 (the default, not an error); anything that is not a run of digits, or a whole
   number ≤ **10** → `null`; otherwise the integer. `null` disables play, and both the config page and
   the popup say why ("Enter a whole number of minutes greater than 10." /
   "Set a countdown longer than 10 minutes in the widget settings.").
6. **The privilege truth, recorded in full.** The widget adds **no polkit rule** and does not widen the
   grant: `ALLOWED_VERBS` stays exactly `["start"]` in `polkit/49-docker-status-widget.rules`, untouched
   by this change. Unlike `systemctl stop docker`, the power-off does **not** prompt.
   `/usr/share/polkit-1/actions/org.freedesktop.login1.policy` gives `org.freedesktop.login1.power-off`
   the defaults `allow_any=auth_admin_keep`, `allow_inactive=auth_admin_keep`, **`allow_active=yes`**
   (`power-off-multiple-sessions` is likewise `allow_active=yes`), and
   `pkcheck --action-id org.freedesktop.login1.power-off --process $$` exits **0** without interaction in
   a local active session. A local active session therefore powers off passwordlessly. The safeguards are
   the deliberate human activation, the more-than-10-minute minimum countdown, the live visible countdown
   and the `Cancel` button — **not** a password gate. ADR-0007 already states the analogous insight
   ("the confirmation is UI state, not a security control"); the countdown is not one either.
7. **Rejected alternatives.**
   - **A logind-scheduled shutdown** (`shutdown -h +N` to arm, `shutdown -c` to cancel). Rejected: it
     would mint a second command-building exception, because the duration would have to reach a command,
     and it would make cancel privilege-dependent — a denied or agent-less `shutdown -c` leaves the
     machine armed with no local way back. Widget-owned state keeps the deadline and the cancel inside the
     widget the user is already looking at.
   - **An inline duration field inside the representation.** Rejected: the representations are pure
     consumers (properties in, signals out), and persistence needs the kcfg entry anyway, so a field in
     the popup would either be thrown away on reload or duplicate the setting.
   - **A two-click/arming confirmation on play**, mirroring the stop button. Rejected because the frozen
     play semantics are that pressing play starts the sequence and disables play immediately; the
     countdown is already a multi-minute confirmation window with a live readout and a `Cancel` button,
     so a second click would only lengthen it. This is the one place the stop's two-click rule is
     deliberately *not* copied.
8. **Failure is surfaced, never swallowed.** `powerAction` mirrors `daemonAction`: a non-zero exit shows
   normalised `stderr` verbatim (else a generic "Powering off failed (exit code N).") with a negative
   `SeverityDot`, and a zero exit shows the neutral "Powering off…" line. The one-shot can stay alive
   while `systemctl` waits for the shutdown job to complete, which is why the feedback row remains visible
   after play is disabled.

## When to use

Read this record when changing anything in the shutdown path: the play/stop semantics, the
`shutdownTicker`, the wall-clock deadline, the `powerAction` source, the `shutdownCountdownMinutes`
setting, its resolver, the popup section, or the decision not to add a polkit rule. It is also the
reference the corpus cites wherever it states that the power-off is passwordless while the docker stop
prompts.

## When not to use

Do not read this as permission to widen `ALLOWED_VERBS`, or to add a polkit rule "so the power-off is
covered": point 6 is the whole argument, and the power-off is outside the grant by decision. Do not
assemble a power-off command from configuration, and do not treat the countdown as a security control —
it is a cancellation window, not an authorization gate. Do not add a scheduled-shutdown variant "for
robustness": point 7 rejects it for concrete reasons (a second command exception, and a
privilege-dependent cancel).

## Examples

- `shutdownCountdownMinutes` = `15` → play is enabled, the tooltip reads "Arm a 15-minute countdown…",
  and the pending line reads `Powering off in 15:00` and counts down.
- `shutdownCountdownMinutes` = `""` (or the value absent) → the resolver returns the default 15, not an
  error.
- `shutdownCountdownMinutes` = `10` (or `0`, `-5`, `abc`, `12.5`, `1e3`, ` 1 2`) →
  `resolveShutdownMinutes()` returns `null`; play is disabled and the popup shows "Set a countdown longer
  than 10 minutes in the widget settings." while the config page shows "Enter a whole number of minutes
  greater than 10.".
- Press play, then reload the widget or restart plasmashell → the pending shutdown is silently cancelled
  and no command runs. This is the intended fail-safe.
- Press play, then `Cancel` → `shutdownPending` clears, the deadline is zeroed and play re-enables; no
  privilege is touched, because cancel is local.
- The `powerAction` fails (for example no logind seat, or a `systemctl` error) → the feedback row shows
  the normalised `stderr` with a negative dot; the widget does not pretend the machine is powering off.

## Common mistakes

- **Assuming a password gate exists.** There is none: logind's `allow_active=yes` default makes a local
  active session power off without authentication. The countdown and the `Cancel` button are the
  safeguard, not a password. Any reasoning about this feature must start from that fact.
- **Widening `ALLOWED_VERBS` for the power-off.** The power-off is a logind action, not a `manage-units`
  verb; adding anything to the array would not even cover it, and would weaken the docker grant. There is
  no rule to add, and none was added.
- **Minting a second command-building exception.** The configured duration is a local duration, never a
  command fragment, and `powerOffCommand` is a fixed literal the tests pin. Reaching a shell with a
  configured value is the one thing this feature must never do.
- **Putting the duration inline in the representation.** A setting needs the kcfg entry and the config
  page; the popup renders state and emits signals, nothing more.
- **Treating the countdown as a security control.** It buys a cancellation window. Like ADR-0007's stop
  confirmation it is UI state: it stops an accidental activation, not a determined one.
- **Expecting the pending countdown to survive a reload.** It does not, on purpose. A plasmashell or
  widget reload drops the widget-owned state and silently cancels the shutdown — an armed countdown must
  not outlive the thing that would fire it.
- **Reading the accepted debt as absent.** A forward system-clock step, or a resume after the deadline
  already passed while suspended, fires the power-off on the next tick (absolute-deadline semantics). The
  `Cancel` button and the configurable duration are the mitigations; there is no wall-clock re-arming.
- **Expecting an automated test of the timing.** QML cannot be instantiated outside plasmashell, so the
  play/stop timing and the effective passwordless power-off are reviewed, not tested. The pure resolver,
  the two helpers and the static wiring are unit tested; the interaction is not.

## References

- [adr-0007-stop-button-confirmation-and-narrow-grant](adr-0007-stop-button-confirmation-and-narrow-grant.md)
  — the analogous destructive-action decision; its grant stays unwidened, and its "confirmation is UI
  state, not a security control" is the insight this record reuses.
- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the one
  existing command-building exception, which the power-off deliberately does not extend.
- [adr-0004-scoped-polkit-grant](adr-0004-scoped-polkit-grant.md) — the docker grant, untouched by this
  feature.
- [../privilege/privilege-slice.md](../privilege/privilege-slice.md) — why the power-off is outside the
  grant and, unlike the docker stop, does not prompt.
- [../status/status-slice.md](../status/status-slice.md) — `resolveShutdownMinutes`,
  `shutdownRemainingSeconds`, `formatCountdown`.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the popup section and its anti-patterns.
- [../verification/verification-slice.md](../verification/verification-slice.md) — what is tested and
  what is review-only.

## Addendum — 2026-09-21

Two clauses of this record are reversed by
[adr-0010-inline-shutdown-minutes-in-the-representation](adr-0010-inline-shutdown-minutes-in-the-representation.md):

- **Solution point 7, the inline-field bullet** — "An inline duration field inside the representation" is
  no longer rejected. The shutdown section now carries an inline minutes field that emits a value-carrying
  signal, and `main.qml` remains the only writer of the kcfg entry.
- **The matching Common-mistakes entry** — "Putting the duration inline in the representation" is no
  longer a mistake. What stays forbidden is the mechanism this record objected to: a representation
  reading or writing `Plasmoid.configuration`, or touching a `DataSource`.

One parenthetical in Solution point 5 is also now stale: the popup no longer says "Set a countdown longer
than 10 minutes in the widget settings." The inline field itself shows the config page's wording, "Enter a
whole number of minutes greater than 10.".

Everything else in this record still stands and is not re-decided here: the countdown is widget-owned with
a wall-clock deadline; `powerOffCommand` is a fixed literal; no polkit rule is added and `ALLOWED_VERBS`
stays `["start"]`; the passwordless logind truth (point 6) is unchanged; play disables immediately; cancel
is purely local and needs no privilege; a reload cancels a pending shutdown; and
`resolveShutdownMinutes` (blank → 15, a whole number strictly greater than 10, else `null`) is unchanged.
