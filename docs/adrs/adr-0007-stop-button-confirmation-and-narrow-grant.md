---
id: adr-0007-stop-button-confirmation-and-narrow-grant
category: adrs
tags: [adr, privilege, polkit, security, ui, daemon]
aliases: [ADR-0007]
related: [adr-index, adr-0004-scoped-polkit-grant, project, widget-slice, ui-surfaces, privilege-slice, troubleshooting]
version: 1.0
status: active
---

# ADR-0007: A stop button that confirms, without widening the grant

## Problem

The widget could start the daemon but not stop it. That was not an oversight; it was the anti-goal
[project.md](../project.md) stated on purpose: stopping the daemon is destructive to every running
container, and a destructive action does not belong one click away in a status widget.
[ADR-0004](adr-0004-scoped-polkit-grant.md) reached the same conclusion from the privilege side and
rejected `stop` and `restart` as `ALLOWED_VERBS` members for exactly that reason. A status widget that
can turn the daemon on but forces a terminal command to turn it off is also, plainly, half a control.

Three forces had to be reconciled:

1. **The feature is genuinely wanted.** Saying "the daemon is running" while offering no way to change
   that leaves the user one `systemctl` away — in a shell the widget was built to spare them.
2. **The original objection stands.** One click that kills every running container is still wrong; the
   objection was never "stop is useless", it was "stop must not be one click".
3. **The grant must not grow to make it convenient.** Making stop passwordless would be the easiest
   path and the worst decision: it would hand a destructive verb the same silent pass as a benign one.

## Solution

One deliberate, narrowly bounded feature, recorded here.

1. **A stop button exists, beside start.** Both live in the popup/desktop action row, both always
   visible so their position is predictable. Neither is hidden behind a mode or a menu.
2. **It never fires on one click.** The first click arms a confirmation and shows a warning: stopping
   the daemon stops every running container. Only the second click runs `systemctl stop docker`. The
   arming expires on its own after five seconds, so a forgotten armed button cannot be completed by an
   unrelated later click, and a minimum dwell of half a second separates arming from confirming, so the
   two clicks of one physical double-click cannot arm and stop in a single gesture. The button's label
   moves through `Stop daemon` → `Confirm stop` → `Stopping…`.
3. **The grant is deliberately unchanged.** `ALLOWED_VERBS` stays `["start"]`. Stopping therefore keeps
   polkit's interactive password prompt while starting stays passwordless. **The asymmetry is the
   feature**, not a gap: the benign action is silent, the destructive one asks. Adding `"stop"` to the
   array is a security decision, not a fix.
4. **There is one stop path, and it is the button.** No stop entry in `Plasmoid.contextualActions`: a
   context menu is still a one-click surface, and a right-click is easier to hit by accident than a
   button behind a confirmation. A code comment in `main.qml` states why the entry is absent.
5. **One shared one-shot DataSource, one in-flight flag.** `startAction` is renamed `daemonAction` and
   serves both commands, because only one action can be in flight and having a single place that clears
   the flag is deliberate. `actionKind` (`DockerStatus.ACTION_START` / `DockerStatus.ACTION_STOP`)
   records which action owns the reply, so the failure message names the action that actually ran and
   the buttons can show the right spinner text. Both commands stay fixed string constants
   (`daemonStartCommand`, `daemonStopCommand`): no command is ever assembled, and this decision adds no
   second exception to the fixed-command rule.
6. **Failure surfacing is unchanged.** A non-zero exit shows normalised `stderr` verbatim — including
   the polkit denial, which is the expected outcome for stop when no agent answers — and only falls back
   to a generic message (chosen by `actionKind`) when `stderr` is empty.
7. **This record does not supersede ADR-0004.** The grant decision stands exactly as written. What is
   reversed is [project.md](../project.md)'s earlier "no stop button" anti-goal; the ADR that follows
   from that reversal is this one, and the anti-goal is restated rather than deleted.

## When to use

Read this record when changing anything in the stop path: the confirmation and its expiry, the warning
text, the button row, the `daemonAction` handler, `actionKind`, or the decision not to add a context-menu
entry. It is also the reference the documentation corpus cites wherever it states that the stop button
prompts while start does not.

## When not to use

Do not read this as permission to widen `ALLOWED_VERBS`. Point 3 is the whole safety argument: the grant
stays at `["start"]`, and making stop passwordless is a separate decision with its own record. Do not
add a stop entry to the context menu "for parity" — point 4 rejects it deliberately. Do not replace the
expiring confirmation with a modal dialog: the button-plus-warning shape is the decision, and a dialog
would move a status widget closer to a control panel than this project wants.

## Examples

Files that carry the decision: `main.qml` carries `daemonStopCommand`, `stopDaemon()`, the `actionKind`
state and the renamed `daemonAction` source; `FullRepresentation.qml` carries the two-button row,
`stopArmed`, `requestStop()`, `disarmStop()`, the five-second `stopArmTimer` and the warning label;
`dockerstatus.js` carries `ACTION_START` / `ACTION_STOP`; `metadata.json` advertises the stop behind a
confirmation. The grant itself is untouched:
[../privilege/privilege-slice.md](../privilege/privilege-slice.md).

Evidence: `tests/dockerstatus.test.mjs` pins the action identities and counts their exact `actionKind`
assignments and comparisons in both representations, reads the shipped rule file to assert `ALLOWED_VERBS`
is exactly `["start"]` (naming this record in the failure message), executes the captured polkit predicate
over a default-deny matrix that allows exactly one action id, one unit and one verb, and pins both
privileged commands as fixed string literals.

## Common mistakes

- **The confirmation is UI state, not a security control.** It stops an accidental click; it stops
  nothing that means to run the command. The password prompt is the only real gate, and only when a
  polkit agent runs in the session.
- **The five-second window is not configurable.** That is deliberate — a setting would be one more way
  to weaken the confirmation — but it is accepted debt: a user who needs longer has no recourse.
- **No prompt, no success.** If no polkit authentication agent runs in the session, the stop call fails
  and its `stderr` is shown. The widget does not install or detect an agent, and it does not pretend
  the daemon stopped.
- **There is no automated test for the confirmation itself.** `main.qml` is not executable outside
  plasmashell, so the two-click sequence, the dwell, the expiry and the warning are reviewed, not tested.
  The suite covers the action identities and their exact `actionKind` expressions, the fixed commands, and
  the rule as text and as an executed default-deny predicate — none of which exercises the button's
  timing.
- **The grant's comment is now longer, and its logic is not.** The rule file gained a paragraph about
  this decision; `ALLOWED_VERBS` did not change by one character.

## References

- [adr-0004-scoped-polkit-grant](adr-0004-scoped-polkit-grant.md) — the grant this record upholds, with
  an addendum pointing here.
- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the one
  existing exception to the fixed-command rule, which the stop button deliberately does not extend.
- [../privilege/privilege-slice.md](../privilege/privilege-slice.md) — the grant's gates and accepted
  debt.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the action row and its anti-patterns.
- [../verification/troubleshooting.md](../verification/troubleshooting.md) — the password-prompt and
  two-click symptoms.
