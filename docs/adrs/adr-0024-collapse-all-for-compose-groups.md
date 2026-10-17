---
id: adr-0024-collapse-all-for-compose-groups
category: adrs
tags: [adr, widget, qml, container-list, collapse]
aliases: [ADR-0024]
related: [adr-index, adr-0016-containers-flat-rows-and-podman-section-removal, adr-0020-footer-removal-and-pinned-popup-layout, adr-0019-miscelanea-section-merge, adr-0022-download-cancellation-and-partial-cleanup, widget-slice, troubleshooting]
version: 1.0
status: active
---

# ADR-0024: A "Collapse all" control closes every compose group at once

## Problem

The human operator asked (verbatim, in Spanish) for a control that shows every compose group closed at
once: *"quiero que agregues un boton de 'colapse all' para que se vean todos los composer cerrados"*.
"composer" is the operator's own word for a **compose group** — the same unit
[ADR-0020](adr-0020-footer-removal-and-pinned-popup-layout.md) reads as "composers row" and
[../project.md](../project.md)'s Domain Entities define as `{ project, containers }` from
`groupContainersByComposeProject()`. The request therefore reads: one action closes every compose group
in the container section, the standalone bucket included.

Two recorded decisions bound what that control may touch:

1. [ADR-0016](adr-0016-containers-flat-rows-and-podman-section-removal.md) deleted the Containers header
   row and its section-level collapse flag (`containerSectionExpanded`) on purpose, and closed with "not
   permission to re-add a section header or a second ± toggle". The surviving per-group affordance is each
   group header's own ±.
2. The Miscelánea card's gate is load-bearing, not decoration. `miscBodyVisible`
   (`miscSectionExpanded || shutdownPending || downloadInFlight`) exists so an armed countdown
   ([ADR-0019](adr-0019-miscelanea-section-merge.md)) or a live download STOP
   ([ADR-0022](adr-0022-download-cancellation-and-partial-cleanup.md)) can never be collapsed away. A
   collapse-all control that reached the Miscelánea card would turn the widget's own safety argument into
   a lie, not add a convenience.

Without a record, the popup would carry a second collapse mechanism whose scope, state shape and
interaction with each group's ± would be unspecified, and a later reader could "simplify" it into exactly
the section-level flag ADR-0016 deleted.

## Solution

One deliberate, narrowly scoped addition, recorded here. This record **supersedes nothing**: ADR-0016's
headerless flat list, ADR-0020's pinned column, ADR-0019's merged Miscelánea gate and ADR-0022's live
STOP all stand, and the container section simply gains one action.

1. **Scope: the compose groups, the standalone bucket included; the Miscelánea card untouched.** The
   control closes every group the list renders — including the no-project "Other containers" bucket, which
   is a group like any other — and nothing else. It never reads or writes `miscSectionExpanded` /
   `miscBodyVisible`, so the Miscelánea card's own ± and its armed-state override survive verbatim: a live
   STOP or a pending shutdown can never be collapsed away by this control
   ([ADR-0019](adr-0019-miscelanea-section-merge.md),
   [ADR-0022](adr-0022-download-cancellation-and-partial-cleanup.md)).

2. **State model: a generation counter on the root, absorbed per group.** The root carries
   `property int groupsCollapseEpoch: 0`, and each group delegate carries its own `groupOpen` (unchanged)
   plus `groupEpoch: 0` and the derived
   `readonly property bool groupBodyVisible: groupOpen && groupEpoch === fullRoot.groupsCollapseEpoch`. The
   control bumps `groupsCollapseEpoch`; a group that has not been tapped since absorbs the new generation
   simply because its recorded `groupEpoch` no longer matches, so its derived flag goes false and its body
   closes. The group's own ± inverts what the body currently shows and records the current generation in
   the same tap, so **the ± always wins over the control**: a group the human reopens stays open until the
   next press.

3. **Why a counter, not a bool.** The control is repeatable, so its effect must be repeatable too. A root
   bool ANDed into each group's body gate would let the control close the groups once, but a group's ±
   could then never reopen it (the bool stays false), and a second press of the control would be a no-op
   for any group reopened in between. A monotonically increasing generation re-fires on every press: each
   press is a new value no group has answered, so every group closes again — which is precisely what "sean
   todos los composer cerrados" asks for, repeatably.

4. **Rejected alternatives, with reasons.**
   - **A root bool ANDed into the body gate.** Rejected: a group's ± could never reopen its own group
     while the bool was set, and the control could not re-close the groups reopened after the first press.
   - **A `Connections` block per delegate listening for a re-emitted signal.** Rejected: it costs one extra
     object per instantiated group, and a bool signal would not re-fire for a second press, so the
     repeatability problem survives the extra machinery.
   - **A root-side JavaScript map keyed by project.** Rejected: it moves per-group state out of the group
     delegate into a root-side map that must be kept in sync with the model, breaking the repo's standing
     rule that each group's open/closed state stays local to its own instantiated delegate.

5. **The control: a compact strip inside the container card, above the list.** A plain `Item` is the FIRST
   child of the container card's own `ColumnLayout` (`id: containerBody`), gated on the same
   `visible: fullRoot.containers.length > 0` the list carries, so an empty section shows neither. Inside it
   a right-aligned, flat, muted `PlasmaComponents3.ToolButton` reads
   `i18n("Collapse all")` and carries the one `onClicked: fullRoot.groupsCollapseEpoch += 1`, plus a
   `PlasmaComponents3.ToolTip` like every other button in the file. There is deliberately **no title and no
   section header**: [ADR-0016](adr-0016-containers-flat-rows-and-podman-section-removal.md) removed the
   header on purpose, and this strip carries only the action.

6. **The label is spelled correctly.** The operator wrote "colapse all"; the shipped, translated label is
   `i18n("Collapse all")` — English and correctly spelled, the same correction the corpus applies to every
   other operator typo before it becomes a user-visible string.

7. **The floor decision, and its honest cost.** The strip is card chrome that sits inside the popup's
   scrollable middle region ([ADR-0020](adr-0020-footer-removal-and-pinned-popup-layout.md)), so its height
   is folded into the region's floor rather than eating into it: `containerScrollFloor` becomes
   `containerRowHeight * 3 / 2 + containerCollapseStripHeight` (52 × 1.5 + 32 = **110px**), with a new
   `readonly property int containerCollapseStripHeight: 32`. The cost is stated plainly: **the popup grows
   by a fixed 32px once**, at every container count, because the strip is always present. The alternative —
   letting the strip consume 32px of the existing 78px floor — was rejected: it would leave a
   half-row-and-a-bit scroll area and quietly shrink the one-and-a-half-row peek ADR-0020 sized the region
   around. Folding the height in keeps that peek intact and pays the 32px once, which is the same
   never-resize-as-the-list-grows invariant ADR-0020 established. The two
   `Layout.minimumHeight: fullRoot.containerScrollFloor` / `Layout.preferredHeight:
   fullRoot.containerScrollFloor` lines on the middle region are unchanged.

8. **What is NOT touched.** The list itself, its grouped model, the per-group play/stop controls, the
   group header's tap target and 8px gutter, the flat row markup, the Miscelánea card and its collapse
   semantics, the download row, the shutdown countdown, SeverityDot, the palette, `main.qml` and every
   fixed command are all unchanged. The control mints no signal and no kcfg entry: it is pure local view
   state owned by the representation, exactly like `miscSectionExpanded`, and the popup stays a pure
   consumer.

9. **The pins move with the change.** `tests/dockerstatus.test.mjs` is revised deliberately, one pin for
   one contract:
   - the floor test **replaces** the `containerScrollFloor: fullRoot.containerRowHeight * 3 / 2` pin with
     the new expression `containerRowHeight * 3 / 2 + containerCollapseStripHeight` — the old expression no
     longer describes the intended contract, because a floor without the strip would shrink the scroll area
     — and **adds** a `readonly property int containerCollapseStripHeight: 32` pin. The two
     `Layout.*Height: fullRoot.containerScrollFloor` pins and the `52 * 3 / 2 === 78` arithmetic pin are
     kept verbatim.
   - the per-group collapse test **keeps** the `property bool groupOpen: true` pin, **extends the message**
     of the single-writer pin (`fullQml.split("containerGroup.groupOpen = ").length - 1 === 1`) to say what
     it now proves — the collapse-all control never writes per-group state, only the group's own header
     does — **replaces** the `visible: containerGroup.groupOpen` pin with
     `visible: containerGroup.groupBodyVisible` **plus** `!fullQml.includes("visible:
     containerGroup.groupOpen")`, and **adds** pins for the exact derived expression, both root/delegate
     epoch properties, both exact header-handler lines, the `onClicked: fullRoot.groupsCollapseEpoch += 1`
     bump, the `i18n("Collapse all")` label, the strip's list-identical visible gate and the ± glyph
     reading the derived flag.
   - the +/- glyph test **retargets** its per-group anchor from `containerGroup.groupOpen ${glyph}` to
     `containerGroup.groupBodyVisible ${glyph}`; its "exactly two headers" and token-read counts are
     unchanged, because the strip adds no glyph.
   - a **new** test pins that the Miscelánea card is untouched: `miscBodyVisible` keeps its exact
     expression (`miscSectionExpanded || shutdownPending || downloadInFlight`), `miscSectionExpanded` still
     has exactly one writer, and nothing in the container section references `miscBodyVisible` or
     `miscSectionExpanded`.

## When to use

Read this record when touching the container section's controls, the per-group collapse state, the
"Collapse all" strip, or the middle region's `containerScrollFloor`. It is also the record to read before
concluding that a root-level collapse flag would be simpler: the generation counter exists because the
control is repeatable and each group's ± must keep winning.

## When not to use

It is not permission to re-add a section header or a title above the list: the strip is an action, not a
header, and ADR-0016 removed the header deliberately. It is not permission to extend the control to the
Miscelánea card: that gate's armed-state override is a safety argument, and the container section must
never read `miscBodyVisible` / `miscSectionExpanded`. It is not permission to make the strip the region's
height driver or to let it consume the one-and-a-half-row floor — its height is folded into the floor, and
the widget must still not resize as the list grows. It is not permission to persist or signal the collapse
state: it is local view state, and `main.qml` keeps every shell and kcfg boundary. And it is not permission
to reword the label back to the operator's "colapse".

## Examples

- **`FullRepresentation.qml`** — the root gains
  `property int groupsCollapseEpoch: 0`; the delegate gains `groupEpoch` and the derived
  `groupBodyVisible`; the group header's `MouseArea` inverts `groupBodyVisible` and records the
  generation; the body's `visible` reads `containerGroup.groupBodyVisible`; the ± glyph reads the derived
  flag; the container card gains the collapse-all strip as the first child of `containerBody`; and
  `containerRowHeight` (52) is joined by `containerCollapseStripHeight` (32) in the floor,
  `containerScrollFloor` (110).
- **`tests/dockerstatus.test.mjs`** — the pins listed in point 9: the floor expression replaced and the
  strip-height pin added, the per-group test's body-gate pin replaced and its derived/counter/handler/label
  pins added, the glyph anchor retargeted, and one new test proving the Miscelánea card is untouched.
- **`docs/widget/widget-slice.md`** and **`docs/widget/ui-surfaces.md`** — the container-list paragraphs
  keep "no section header" true and describe the strip, its scope and its repeatability.
- **Ids minted.** `adr-0024-collapse-all-for-compose-groups` (this record).

## Common mistakes

- **Replacing the counter with a root bool.** A bool closes the groups once, then a group's ± can never
  reopen its own group and a second press does nothing — the exact regression the counter is shaped to
  avoid.
- **Letting the control touch per-group state directly.** The control bumps the root counter and nothing
  else; the group's body and glyph read the derived flag. A direct write to `containerGroup.groupOpen`
  would make the group unreopenable and break the single-writer rule the tests pin.
- **Extending the control to the Miscelánea card.** Its `miscBodyVisible` override keeps an armed countdown
  and a live STOP visible; collapsing them away would break ADR-0009's safeguard, restated by ADR-0019 and
  ADR-0022.
- **Adding a title or a section header to the strip.** The strip is an action; ADR-0016 removed the header
  row on purpose and this record does not bring it back.
- **Letting the strip eat into `containerScrollFloor`.** The floor is `1.5 rows + the strip`; dropping the
  strip from the expression (or hard-coding the old 78) shrinks the scroll peek ADR-0020 established.
- **Reading the raw `groupOpen` in the body or the glyph.** The affordance must describe what the human can
  actually see, so both read `groupBodyVisible`; the raw bool is never a `visible` gate.

## References

- [[adr-0016-containers-flat-rows-and-podman-section-removal]] — the headerless flat list whose per-group ±
  is the affordance this control respects, and whose "no section header" rule the strip obeys.
- [[adr-0020-footer-removal-and-pinned-popup-layout]] — the pinned column and the one-and-a-half-row scroll
  floor the strip's height is folded into.
- [[adr-0019-miscelanea-section-merge]] — the merged Miscelánea gate that must keep its armed-state
  override, untouched by this record.
- [[adr-0022-download-cancellation-and-partial-cleanup]] — the live STOP whose `miscBodyVisible` operand
  also survives verbatim.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the slice that owns the grouped list and the
  popup's local view state.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the inventory the container-list paragraph lives
  in.
- [../project.md](../project.md) — the Domain Entities "Compose group" this record's scope is written
  against.
- [[adr-index]] — the hub this record is registered in.
