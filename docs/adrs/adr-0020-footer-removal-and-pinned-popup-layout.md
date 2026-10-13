---
id: adr-0020-footer-removal-and-pinned-popup-layout
category: adrs
tags: [adr, ui, layout, sections]
aliases: [ADR-0020]
related: [adr-index, adr-0008-configurable-cookies-browser-and-bottom-text, adr-0019-miscelanea-section-merge, ui-surfaces, widget-slice, project]
version: 1.0
status: active
---

# ADR-0020: The footer and the configurable bottom text are removed; the popup becomes a pinned column with a scrollable middle

## Problem

The human operator asked (verbatim, in Spanish) to take out the "Docker Status · Local panel" footer and
everything it carried ("All systems available" and the like), to remove the configurable bottom text from
the widget and from the config page, and to pin the ends of the popup: the Docker-status card at the top
and the Miscelánea card at the bottom must stay put, while the middle grows or shrinks to the widget's
height — never below the space one and a half container rows need, and always scrollable, so a sliver of
the next row is visible and the operator can tell there is more below. The widget must not change size as
the container list grows ("y no cambiaria de tamaño").

Three recorded decisions are touched by that request:

1. [ADR-0008](adr-0008-configurable-cookies-browser-and-bottom-text.md) made the bottom text a setting
   (`taglineText`), rendered verbatim by the full representation and hidden when empty. The cookies-browser
   half of that record is unaffected; only the bottom-text clause is superseded.
2. The popup's footer was a fixed region, and its severity dot was the last reader of
   `paletteTokens.footerText` anywhere in QML. Removing the footer therefore leaves a palette token with no
   caller.
3. The container `ListView` was height-capped (`Math.min(contentHeight, Kirigami.Units.gridUnit * 13)`), so a
   growing list grew the widget. That is exactly the behaviour the operator's "y no cambiaria de tamaño"
   rules out.

The surfaces are deleted rather than hidden: a `kcfg` entry or config control left behind with no reader is
dead configuration that a later reader would mistake for a live feature.

## Solution

One deliberate, narrowly scoped change, recorded here. This record **supersedes only the bottom-text clause**
of ADR-0008; its cookies-browser clause, its validation rule and the rest of the record still stand. ADR-0008
is not edited — the clause-level reversal is carried here, the same convention the ADR index already uses for
ADR-0006/0011.

1. **The footer is removed entirely.** The hairline rule, the static `Docker Status · Local panel` label, the
   severity dot and the daemon-state label (`All systems available`) are gone from `FullRepresentation.qml`.
   With them goes the last QML reader of `paletteTokens.footerText`.
2. **The `footerText` token stays in `DockerStatusPalette.qml` on purpose.** The palette is the mockup's fixed
   token set (ADR-0011), not a list of tokens currently in use; deleting one token would make the file drift
   from the mockup it encodes. The token is simply unread now. Do not document it as removed.
3. **The configurable bottom text is removed end-to-end**, so nothing dangles: the `taglineText` kcfg entry in
   `contents/config/main.xml`, the `cfg_taglineText` alias and its "Bottom text:" `QQC2.TextField` in
   `ConfigGeneral.qml`, the `taglineText` forwarding in `main.qml`, and the preview-harness injection in
   `tools/render_preview.qml`. The config page now exposes **ten** `cfg_*` aliases plus the plain
   `cfg_cookiesBrowser` property.
4. **The popup is a pinned column.** The content `ColumnLayout` has three ordered regions: the status card
   first (never in a scroll region), the container section as the MIDDLE region, and the merged Miscelánea
   card last (never in a scroll region). The middle region carries `Layout.fillHeight: true` with
   `Layout.preferredHeight` and `Layout.minimumHeight` bound to `containerScrollFloor`, and the container
   `ListView` is the scroll region (`Layout.fillHeight: true`, `clip: true`, no height cap: the old
   `Math.min(contentHeight, gridUnit * 13)` is deleted). The status card and the Miscelánea card do not
   scroll.
5. **The floor is a named multiple of the row height, not a magic number.**
   `readonly property int containerRowHeight: 52` (the 32px glyph tile plus the row's 20px of vertical
   padding) and `containerScrollFloor: fullRoot.containerRowHeight * 3 / 2` = 78px. Writing the floor as
   `1.5 × rowHeight` keeps "one and a half rows" true across a type-scale change.
6. **The "1.5 rows" reading is recorded deliberately.** "composers row" is read as the container row inside a
   compose group; that floor (78px) is also ≥ 1.5 group-header rows (40px each), so it satisfies either
   reading. The point is not the exact arithmetic but the affordance: a sliver of the next row must always
   show, and that is what tells the operator the region scrolls.
7. **The update notice moves between the middle region and the pinned Miscelánea card, in a reserved row.**
   It sits on the same `updateAvailable` gate as the indicator in the status card and is NOT removed. It
   occupies a reserved row of one `gridUnit` (`Layout.preferredHeight: Kirigami.Units.gridUnit`) and empties
   its text rather than hiding the label, so the row is blank until an update exists and can never grow the
   widget when one appears.
8. **No scrollbar was added: the visible sliver is the scroll affordance.** A platform scrollbar inside the
   mockup's dark card would be chrome the mockup does not carry, and it would be a second size signal
   competing with the pinned layout. The clipped half-row is the deliberate signal.
9. **What is NOT touched.** The status card, its head row (busy indicator, square refresh and Podman launch
   buttons, update indicator), the flat grouped container rows and their per-group play/stop, the merged
   Miscelánea card and its collapse semantics (ADR-0019), the download row, the shutdown countdown,
   SeverityDot, the polkit grant and every fixed command are all unchanged. No kcfg entry other than
   `taglineText` changes, and no command boundary moves.

## When to use

Read this record when touching the popup's column order, the container list's height or scrolling, the
update notice's placement, or any question about whether the popup still carries a footer or a configurable
bottom text.

## When not to use

This is not permission to re-add a footer or a bottom-text setting, nor to restore a height cap on the
container list, nor to let the middle region drive the widget's height. It is not permission to delete the
`footerText` palette token — the palette is the mockup's fixed set (ADR-0011). It is not permission to make
the update notice scroll, to gate it on anything but `updateAvailable`, or to add a scrollbar. And it is not
a licence to rewrite ADR-0008: only its bottom-text clause is superseded, and its cookies clause stands.

## Examples

- **`FullRepresentation.qml`** — the entire footer block is deleted; `containerRowHeight` (52) and
  `containerScrollFloor` (78) are declared; the container section is the `Layout.fillHeight: true` middle
  region with the uncapped `ListView`; the update notice is a reserved one-grid-unit row between the middle
  region and the Miscelánea card; and `taglineText` is gone from the property set.
- **`contents/config/main.xml`** — the `taglineText` entry is deleted; eleven entries remain.
- **`ConfigGeneral.qml`** — the "Bottom text:" `TextField` and the `cfg_taglineText` alias are deleted; ten
  `cfg_*` aliases plus the plain `cfg_cookiesBrowser` remain.
- **`main.qml`** — the `taglineText` forwarding into `FullRepresentation` is deleted.
- **`tools/render_preview.qml`** — the preview-harness injection of the bottom text is deleted.
- **Measured against Qt 6, headless.** The representation's implicit size is identical for 0, 4 and 24
  containers — **612 × 691** (34 grid units wide, the content column plus the card's gutters tall) — and the
  container `ListView` is **78px** tall with `contentHeight` 355 / 1395, i.e. the floor holds and the region
  scrolls. Before the change the same three states measured 694 / 871 / 871 tall: the list used to drive the
  height. The invariant is the point, not the numbers.
- **`tests/dockerstatus.test.mjs`** — the four tagline tests are gone; the suite gains pins that the removed
  footer and bottom-text surfaces leave no `taglineText`, `cfg_taglineText`, `Persiguiendo la singularidad`
  or `footerText` reference in code, and that the column order is status → container → update → Miscelánea,
  with the container section as the scrollable middle region and the Miscelánea card as the last region.
- **Ids minted.** `adr-0020-footer-removal-and-pinned-popup-layout` (this record).

## Common mistakes

- **Leaving the `taglineText` kcfg entry or config control behind.** A setting with no reader is dead
  configuration; the removal is end-to-end for that reason.
- **Deleting the `footerText` palette token as "unused".** The palette is the mockup's fixed token set
  (ADR-0011); an unread token is not a dead one.
- **Restoring a height cap on the container list, or binding the widget's height to the list.** The middle
  region fills and scrolls; the widget must not resize as the list grows.
- **Hard-coding the floor instead of `containerRowHeight * 3 / 2`.** A magic 78 breaks "one and a half rows"
  the moment the row height changes.
- **Adding a scrollbar.** The visible sliver of the next row is the affordance; a scrollbar is rejected.
- **Hiding the update label instead of emptying it.** The reserved row is what keeps the widget from growing;
  a hidden-and-collapsing row reintroduces the resize the change removes.
- **Editing ADR-0008.** Only its bottom-text clause is superseded, and the record is append-only; the
  reversal lives here.

## References

- [[adr-0008-configurable-cookies-browser-and-bottom-text]] — the record whose bottom-text clause this one
  supersedes; its cookies-browser clause and every other clause still stand.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the palette whose fixed token set keeps `footerText` even
  though nothing reads it.
- [[adr-0019-miscelanea-section-merge]] — the merged Miscelánea card that becomes the pinned bottom region.
- [[adr-0015-update-indicator-opens-the-release-page]] — the update indicator that stays in the status card;
  the notice line moves to its reserved row below the scroll region.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the inventory this record updates.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the slice that owns the pinned column.
- [../project.md](../project.md) — the slice map these records presuppose.
- [[adr-index]] — the hub this record is registered in.
