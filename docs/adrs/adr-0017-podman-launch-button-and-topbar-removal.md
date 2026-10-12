---
id: adr-0017-podman-launch-button-and-topbar-removal
category: adrs
tags: [adr, ui, podman]
aliases: [ADR-0017]
related: [adr-index, adr-0014-compose-grouping-and-podman-desktop-launch, adr-0016-containers-flat-rows-and-podman-section-removal, adr-0011-fixed-dark-palette-from-mockup, adr-0015-update-indicator-opens-the-release-page, widget-slice, ui-surfaces]
version: 1.0
status: active
supersedes: adr-0016-containers-flat-rows-and-podman-section-removal
---

# ADR-0017: The Podman Desktop launch returns as a square status-card button; the Workspace topbar is removed

## Problem

The human operator asked for two changes at once: move the refresh button and the Podman Desktop
launch button out of the topbar and into the Docker-status card, beside the daemon-status label, both
rendered as square icon buttons; and delete the topbar header that shows the literal "Workspace"
label with its logo tile.

Two recorded decisions are contradicted by that request:

1. [ADR-0016](adr-0016-containers-flat-rows-and-podman-section-removal.md) removed the Podman
   Desktop section — its card, its launch button, its feedback row and its `podmanLaunchRequested()`
   signal — together with the `main.qml` wiring that ran it. The backing logic was retained by
   explicit human decision precisely so the capability could return; the human has now asked for
   exactly that, as a button rather than a section.
2. The topbar (logo tile, "Workspace" eyebrow, busy indicator and refresh button on one row above a
   hairline) is the popup's identity header. Removing it leaves the status card as the first row of
   the popup, and the two controls it carried — refresh and the in-flight busy indicator — must be
   relocated rather than orphaned.

A quiet restyle would leave the corpus describing a popup that no longer exists. The reversal is
therefore recorded here as a successor carrying `supersedes`, not edited into ADR-0016.

## Solution

One deliberate, narrowly scoped successor, recorded here. ADR-0016 is **not edited**: this record
supersedes only its Podman Desktop UI-removal clause, and the rest of it still stands.

1. **The topbar is removed entirely.** The logo tile, the "Workspace" eyebrow, the busy indicator,
   the refresh icon-button and the topbar's hairline are all gone. With the refresh button relocated
   the row is empty, and an empty header with its rule is dead chrome, not identity.
2. **The refresh button moves into the status card's head row**, beside the daemon-status label,
   still emitting `refreshRequested()` into `root.refreshDaemonState()`. It keeps its overridden
   background surface (the palette's icon-button tokens) but renders **square**: 28x28, matching the
   flat tile language ADR-0016 established for the group controls, with the palette's
   `iconButtonRadius` set to 0. The human rejected the old 38x38 rounded treatment as
   disproportionate; a rounded icon button in this row would reinstate it.
3. **The Podman Desktop launch button is (re-)added beside it**, the same square 28x28 surface and
   the same `system-run` glyph the ADR-0014 button used. The click emits `podmanLaunchRequested()`,
   and `main.qml` answers it with the retained boundary: `launchPodmanDesktop()` calls
   `DockerStatus.buildPodmanDesktopCommand()` with `path: Plasmoid.configuration.podmanDesktopPath`
   and `home: root.homeDirectory`, shell-quoting the resolved path — the command is still the quoted
   path plus the run token and nothing else. The one-shot `podmanLaunch` source, the
   `podmanLaunchInFlight` flag and the feedback state are restored verbatim from ADR-0014's recorded
   pattern: the button disables while the app runs (the engine delivers exactly one event, at exit),
   and a wrong path still fails at click time with the binary's own message. A failed launch renders
   a small feedback row in the card — the corpus never swallows a failed action — and the
   data-source count returns to eleven.
4. **The busy indicator is relocated into the status head row**, still driven by `actionInFlight`,
   so the start/stop in-flight state is not orphaned by the topbar's removal. The Podman launch has
   its own in-flight gate and does not borrow the daemon one.
5. **The palette loses the dead tokens the topbar leaves behind** (`logoTileTop`, `logoTileBottom`,
   `logoTileBorder`, `logoTileText`, `logoTileRadius`, `eyebrowPixelSize`) and `iconButtonRadius`
   becomes 0. The severity mapping and every other token are untouched.
6. **What is NOT touched.** The update indicator beside the daemon status (ADR-0015) stays exactly
   where it is, on its own `updateAvailable` gate, and is not repurposed into a control. The compose
   command boundary, the flat container rows, the start/stop row and its confirmation, the download
   row, the countdown, SeverityDot, the polkit grant and every fixed command are all unchanged. No
   second refresh control is added: the contextual "Refresh" menu entry and the relocated button are
   two surfaces, one handler, as before.
7. **ADR-0016 is not edited.** This record supersedes its Podman Desktop UI-section clause; its flat
   container rows, its header removal and its retained-backing-logic clauses still stand.

## When to use

Read this record when touching the status card's head row, the refresh or Podman launch buttons, or
any question about whether the popup carries a topbar.

## When not to use

This is not permission to re-add the topbar, a "Workspace" label or a logo tile; not permission to
re-add the Podman Desktop *section* (a card with its own collapse) — the launch is a button now; not
permission to delete the `podmanDesktopPath` kcfg entry, the builders or their tests; and not a
change to the command boundary: the launch still runs only the shell-quoted resolved path, and
widening that still requires editing nothing less than a successor to ADR-0014.

## Examples

- **`FullRepresentation.qml`** — the topbar block (logo tile, eyebrow, hairline) is deleted; the
  status head row carries the busy indicator, the square refresh button, the square Podman launch
  button and the existing update indicator; `podmanLaunchRequested()` and the three podman state
  properties are declared; a muted feedback row renders a failed launch.
- **`main.qml`** — `launchPodmanDesktop()`, the `podmanLaunch` one-shot, the in-flight/feedback
  state and the popup forwarding are restored; the source-count comment reads tenth and eleventh,
  with nine sources before them.
- **`DockerStatusPalette.qml`** — the six dead topbar tokens are removed; `iconButtonRadius` is 0.
- **`tests/dockerstatus.test.mjs`** — the Podman-absence pins are replaced by pins for the
  relocated surface: the signal, the button, the square rendering, eleven sources, and the restored
  launch wiring.
- **Ids minted.** `adr-0017-podman-launch-button-and-topbar-removal` (this record).

## Common mistakes

- **Deleting the `podmanDesktopPath` kcfg entry, the `ConfigGeneral` setting or the builders "while
  you are in there".** They are the retained boundary ADR-0014 recorded and this record puts back
  into use.
- **Re-adding the launch as a section card with a collapse toggle.** The human asked for a button
  beside the status label; ADR-0016's headerless flat idiom is what it replaced.
- **Rounding the buttons, or restoring their 38x38 size.** The human asked for square tiles; the
  38px rounded treatment is the thing both ADR-0016 and this request rejected.
- **Orphaning `actionInFlight`.** The topbar carried the only busy indicator; it moves with the
  refresh button into the status card.
- **Letting the launch button swallow a failure.** A wrong path reports the binary's own message on
  the card's feedback row, exactly as ADR-0014's section did.
- **Repurposing the update indicator.** It stays an `emblem-important` button on its own gate
  (ADR-0015), not a second control surface.

## References

- [[adr-0016-containers-flat-rows-and-podman-section-removal]] — the record whose Podman Desktop
  UI-removal clause this one supersedes; its flat rows and retained backing logic still stand.
- [[adr-0014-compose-grouping-and-podman-desktop-launch]] — the boundary this record puts back into
  use; its command shape is unchanged.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the palette whose dead tokens go and whose
  icon-button radius becomes square.
- [[adr-0015-update-indicator-opens-the-release-page]] — the indicator that stays put in the same
  head row, untouched.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the slice that owns the restored wiring.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the inventory this record updates.
- [[adr-index]] — the hub this record is registered in.
