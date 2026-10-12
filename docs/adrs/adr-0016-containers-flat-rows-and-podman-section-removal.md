---
id: adr-0016-containers-flat-rows-and-podman-section-removal
category: adrs
tags: [adr, ui, compose, podman]
aliases: [ADR-0016]
related: [adr-index, adr-0014-compose-grouping-and-podman-desktop-launch, adr-0011-fixed-dark-palette-from-mockup, adr-0013-widget-update-check-and-release-site, adr-0015-update-indicator-opens-the-release-page, status-slice, widget-slice, ui-surfaces]
version: 1.0
status: active
supersedes: adr-0014-compose-grouping-and-podman-desktop-launch
---

# ADR-0016: Flat container rows; the Containers header and the Podman Desktop section are removed

## Problem

The human operator asked for the containers section to read like the design mockup: a flat list
where each row is a leading box/cube glyph, a name and an optional status subtitle, with small
right-aligned action icons. They flagged the old 38x38 mint/pink compose buttons as
disproportionate and badly centred, and asked to delete two things outright — the "Containers"
header row (title, "%1 services" meta and the neon ± toggle) and the "Podman Desktop" card — and to
find a Docker/Podman glyph for the containers area.

Two recorded decisions are contradicted by that request:

1. [ADR-0014](adr-0014-compose-grouping-and-podman-desktop-launch.md) deliberately added the Podman
   Desktop section as a fourth collapsible card with its own launch wiring, its own
   `podmanLaunchRequested()` signal and its own command path.
2. The "Containers" header row carried the entire collapse state of the section
   (`containerSectionExpanded`): removing it removes the only thing that could toggle that flag.

A quiet restyle would leave the corpus describing a popup that no longer exists. The reversal is
therefore recorded here, as a successor carrying `supersedes`, rather than edited into ADR-0014.

## Solution

One deliberate, narrowly scoped successor, recorded here. ADR-0014 is **not edited**: this record
supersedes only its UI-section clause, and the rest of it still stands.

1. **The Containers header row is removed entirely.** Title, "%1 services" meta and ± toggle go,
   and with them the `containerSectionExpanded` view state: with no header there is nothing to tap,
   so the flag and its gates are deleted rather than kept as dead state. The card itself stays, its
   `containerListEnabled` gate stays, the empty state stays, and the compose feedback row stays.
   Per-group collapse (`groupOpen`) stays too, because the group headers remain tappable.
2. **The group rows go flat per the mockup.** Each row uses the bundled
   `contents/icons/dockerstatus.svg` box glyph on a 28px tile (resolved with `Qt.resolvedUrl`, so no
   new external asset and no network fetch), the project name, the running/total counter, small flat
   28x28 play/stop `ToolButton`s with muted glyphs and no chunky backgrounds, and the ± affordance
   last. The controls' enable/disable gates, signals and tooltips are unchanged, and the container
   rows keep their deterministic hash tiles.
3. **The Podman Desktop section is removed from `FullRepresentation.qml`,** reversing the UI half of
   ADR-0014 — the card, its header, the launch button, the feedback row and the
   `podmanLaunchRequested()` signal are gone. The backing logic is retained **by explicit human
   decision**: `buildPodmanDesktopCommand()`, `resolvePodmanDesktopPath()`, the `podmanDesktopPath`
   kcfg entry, the `ConfigGeneral` setting and their unit tests all stay, so the capability is
   preserved even though no surface currently calls it.
4. **The now-unreachable wiring is removed from `main.qml`.** With no surface left to call it, the
   `podmanLaunch` one-shot source, `launchPodmanDesktop()`, the podman state properties and the
   popup forwarding are deleted as dead code, and the data-source count drops from eleven to ten.
5. **What is NOT touched.** The compose command boundary and its tests stand — ADR-0014's grouping,
   its label-filtered mutation and its shell-quoting are all unchanged. The daemon start/stop row,
   the Import content and Countdown sections, the panel representation, the palette and the
   SeverityDot rule are all untouched.
6. **ADR-0014 is not edited.** This record supersedes its Podman Desktop UI-section clause, and the
   rest of ADR-0014 still stands — including the container-level exception it minted.

## When to use

Read this record when changing the containers list, its controls, or any Podman surface question.

## When not to use

This is not permission to delete the `podmanDesktopPath` kcfg entry, the builders or their tests
along with the card — the human explicitly retained the backing logic. It is not permission to
re-add a section header or a second ± toggle, and not permission to remove the per-group collapse.
It is not a change to the compose command boundary: widening that still requires editing nothing
less than a successor to ADR-0014.

## Examples

- **`FullRepresentation.qml`** — the containers section is restyled flat; the header, the
  `containerSectionExpanded` flag and the Podman Desktop section are removed; the update indicator
  is added.
- **`main.qml`** — the podman wiring is removed, the data-source count is ten, and the
  source-count comment is updated.
- **`tests/dockerstatus.test.mjs`** — the pins are updated: a headerless flat list, the bundled
  glyph call site, the small flat controls, the absent Podman surfaces, ten sources, and the single
  `Qt.openUrlExternally` call.
- **Ids minted.** `adr-0016-containers-flat-rows-and-podman-section-removal` (this record).

## Common mistakes

- **Deleting the `podmanDesktopPath` kcfg entry or the `ConfigGeneral` setting with the card.** The
  human explicitly retained the backing logic — removing it reverses a decision this record does
  not make.
- **Resurrecting a chunky play/stop surface.** The mockup's small flat controls are the decision;
  the old 38x38 buttons are what the request rejected.
- **Re-adding a collapse flag nothing can toggle.** With no section header, `containerSectionExpanded`
  has no trigger; per-group collapse is the surviving affordance.
- **Treating the removal as touching the compose command boundary.** It does not: the boundary, its
  quoting and its tests are untouched.

## References

- [[adr-0014-compose-grouping-and-podman-desktop-launch]] — the record whose Podman Desktop
  UI-section clause this one supersedes; its compose boundary and retained backing logic still
  stand.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the palette and SeverityDot rule the flat rows must
  not disturb.
- [[adr-0015-update-indicator-opens-the-release-page]] — the indicator added to the same section in
  the same pass.
- [../status/status-slice.md](../status/status-slice.md) — the pure helpers the boundary lives in.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the surfaces that call them.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — which UI surface a change belongs to.
- [[adr-index]] — the hub this record is registered in.
