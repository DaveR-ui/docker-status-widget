---
id: adr-0010-inline-shutdown-minutes-in-the-representation
category: adrs
tags: [adr, power-management, shutdown, ui, config]
aliases: [ADR-0010]
related: [adr-index, adr-0009-widget-owned-shutdown-countdown, adr-0006-video-downloader-command-boundary, adr-0007-stop-button-confirmation-and-narrow-grant, widget-slice, ui-surfaces, status-slice, verification-slice]
version: 1.0
status: active
supersedes: adr-0009-widget-owned-shutdown-countdown
---

# ADR-0010: The shutdown minutes become an inline field in the representation

## Problem

[ADR-0009](adr-0009-widget-owned-shutdown-countdown.md) settled the shutdown countdown and, in doing so,
explicitly rejected "an inline duration field inside the representation": the representations were pure
consumers (properties in, signals out), persistence needed the kcfg entry anyway, and a field in the popup
would either be thrown away on reload or duplicate the setting. Its Common-mistakes list repeated the ban.

That reasoning was right about the mechanism and wrong about the surface. The setting lives in
`shutdownCountdownMinutes` and was edited only on the config page, but the play button and its disabled
state live in the popup — so a user told "the play button stays disabled" had to leave the surface they
were looking at, find the config page, and come back. The duration should be editable where the countdown
is armed.

A rejected alternative is itself a decision, so reversing the inline-field clause needs a successor
record, not an edit of ADR-0009. The corpus rule is explicit: reversals arrive as a successor carrying
`supersedes` (the ADR-0006 → ADR-0008 precedent).

## Solution

One clause of ADR-0009 is reversed; everything else stands.

1. **The shutdown section gains a typeable minutes field.** `FullRepresentation.qml` renders a seeded
   `PlasmaComponents3.TextField` (`id: shutdownMinutesField`) beside the play/cancel row. It deliberately
   refuses no keystrokes — a non-number has to stay typeable so the error cue can explain a disabled play
   — and it is disabled while a countdown is `pending` or `inFlight`, because the deadline is snapshotted
   in `main.qml` and editing could only imply a running deadline would change.
2. **The field emits a value-carrying signal; it never touches configuration.** The representation takes
   the RAW stored string as an inbound property (`property string shutdownMinutesText`) and emits
   `shutdownMinutesEdited(string text)`. It never reads or writes `Plasmoid.configuration`, and it touches
   no `DataSource`. The pure-consumer convention therefore holds with one precise widening: a
   value-carrying signal for persistence is now sanctioned; configuration access in a representation stays
   forbidden.
3. **`main.qml` stays the ONLY writer, validating through the unchanged resolver.**
   `setShutdownMinutes(raw)` resolves through the same `DockerStatus.resolveShutdownMinutes` the deadline
   uses; on `null` it returns early and nothing is persisted; on an unchanged value it skips a redundant
   write; otherwise it writes `Plasmoid.configuration.shutdownCountdownMinutes = raw`. The field's own
   validity (`shutdownMinutesFieldValid`) runs through that same resolver, so the field, the play gate and
   the persisted value cannot drift apart.
4. **The duration still never reaches a shell.** It is a local duration, so this decision mints **no
   second command-building exception**: the fixed `powerOffCommand` literal and the video-download row's
   ADR-0006 boundary are untouched.
5. **Every other clause of ADR-0009 remains in force** and is not re-decided here: the countdown is
   widget-owned with a wall-clock deadline; the power-off is a fixed literal; no polkit rule is added and
   `ALLOWED_VERBS` stays `["start"]`; the power-off does not prompt (logind `allow_active=yes`); play
   disables immediately; cancel is local and needs no privilege; a reload cancels a pending shutdown; and
   the resolver's contract (blank → 15, a whole number strictly greater than 10, else `null`) is unchanged.

Two mechanics the change is easy to get wrong:

- **Write-through, not staged.** A valid edit persists immediately — there is no "apply" — and an invalid
  edit never persists. The error cue (`i18n("Enter a whole number of minutes greater than 10.")`, red
  text on the field) says why play is disabled. The play gate is
  `shutdownReady && shutdownMinutesFieldValid && !shutdownPending && !shutdownInFlight`.
- **Seeded and synced, never `text:`-bound.** The stored value is copied in once in
  `Component.onCompleted` behind a `programmatic` latch, and afterwards only mirrored while the field is
  not focused, behind a `seeded` latch — the same trap the config page's cookies combo documents, because
  a plain `text:` binding would be destroyed by the first user edit and a mirrored write must not echo
  back as a user edit.

## When to use

Read this when changing the shutdown section's inline field, its signal or `setShutdownMinutes(raw)`; when
deciding whether a representation may persist a setting; or when a reader cites ADR-0009's inline-field
rejection.

## When not to use

Do not read this as licence for a representation to read `Plasmoid.configuration` or reach for a
`DataSource` — only a value-carrying signal to the single writer is permitted. Do not read it as reversing
anything else in ADR-0009: the widget-owned countdown, the fixed power-off, the absent polkit rule and the
unchanged resolver are untouched. A second command-building exception still needs its own record, and the
configured minutes are still a local duration that never reaches a command.

## Examples

- Type `20` in the inline field → `setShutdownMinutes("20")` persists `20` immediately; play stays enabled.
- Type `5` (or `abc`, `12.5`, `-5`) → the resolver returns `null`, nothing is persisted, the field turns red
  and the cue reads "Enter a whole number of minutes greater than 10."; play is disabled.
- Clear the field to `""` → the resolver returns the 15-minute default (blank is not an error), so `""` is
  persisted and play remains enabled.
- Reload with a stored `20` → the field seeds to `20`; an invalid stored value is shown verbatim in red
  with the cue, and play is disabled.

## Common mistakes

- **Re-adding the config-page-only rule.** The setting is still a kcfg entry edited on the config page; the
  inline field is a second editing surface, not a replacement, and it must go through `main.qml` to
  persist.
- **Reading or writing `Plasmoid.configuration` in the representation.** The signal is the boundary; the
  representation stays free of configuration and of the data engine.
- **Binding `text:` to the stored value.** The first user edit destroys a binding; seed and sync instead.
- **Treating invalid input as "revert to default".** An invalid edit persists nothing and leaves the stored
  value untouched. Blank, by contrast, is valid and resolves to the 15-minute default.
- **Re-deciding the rest of ADR-0009.** Point 6 stands: the power-off does not prompt, no polkit rule is
  added, and the grant is not widened.
- **Minting a second command-building exception.** The inline value is a local duration; it never reaches
  the fixed `powerOffCommand`.

## References

- [adr-0009-widget-owned-shutdown-countdown](adr-0009-widget-owned-shutdown-countdown.md) — the successor's
  predecessor; its inline-field rejection is the one clause reversed here.
- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the one
  command-building exception, which this change deliberately does not extend.
- [adr-0007-stop-button-confirmation-and-narrow-grant](adr-0007-stop-button-confirmation-and-narrow-grant.md)
  — the analogous destructive-action decision, untouched here.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the shutdown section, the inline field and its
  anti-patterns.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the inline flow in `main.qml` and the
  pure-consumer convention.
- [../status/status-slice.md](../status/status-slice.md) — `resolveShutdownMinutes`, the single resolver
  both surfaces validate through.
- [../verification/verification-slice.md](../verification/verification-slice.md) — the static pins for the
  inline field and the single-writer rule.
