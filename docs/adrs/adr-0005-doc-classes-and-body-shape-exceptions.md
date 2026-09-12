---
id: adr-0005-doc-classes-and-body-shape-exceptions
category: adrs
tags: [adr, doc-classes, schema, contract]
aliases: [ADR-0005]
related: [adr-index, adr-0003-slice-taxonomy, adr-0002-lowercase-naming-convention]
version: 1.0
status: active
---

# ADR-0005: Four registered doc classes, and the body-shape exception they need

## Problem

This corpus needed recurring *kinds* of sheet, not just generic notes: a map per slice, an inventory a
reader chooses a UI surface from, a contract sheet for a group's surface, and a symptom-keyed write-up.
Each has a fixed internal anatomy that is **not** the seven standard note sections, so adopting them
means granting an explicit exception to the body contract. Two failure modes were available and both
are bad: importing the upstream rationale for those classes (which lives in the reference
implementation, not here, and whose scope was a different expansion decision), or letting each sheet
invent its own anatomy — which turns the schema back into folklore and makes the class templates a
suggestion instead of a contract.

## Solution

1. **Four doc classes are registered in this corpus**, each keeping its documented anatomy:
   - **Slice generalities** — one per slice, mandatory, the routing unit of the map.
   - **UI inventory sheet** — selection guide first, then usage rules, then a fixed per-item anatomy
     (Purpose, Path, Interface, Data Flow, Usage Pattern, Anti-Patterns, Verification), then style
     tokens.
   - **Interface-surface sheet** — one sheet per functional group, in catalog mode or contract mode.
   - **Troubleshooting sheet** — quick-ref entries keyed by the exact symptom string, with Context,
     Root cause, Fix, Reference; an optional deep-dive spoke per failure class.
2. **The body-shape exception is granted here, by this record.** A contracted class doc keeps its class
   anatomy instead of the seven verbatim sections. Nothing else changes: the frontmatter contract is
   the standard note contract, and **no class may invent a frontmatter key** — membership and mode ride
   on `tags` (`interface-catalog` / `interface-contract`; `ui-inventory`; `troubleshooting`; `slice`).
3. **The class templates are ordinary notes.** The copyable shapes live in `templates/` and carry the
   seven standard sections themselves; the exception applies to the *instances* a reader opens for a
   task, not to the templates that define them.
4. **Instances must exist before a class is claimed.** At the time of this record: the five `*-slice.md`
   docs, `widget/ui-surfaces.md`, `status/data-engine-contract.md`, and
   `verification/troubleshooting.md`.
5. **A new class needs a new ADR.** Anatomy is not invented ad hoc; adding one is a schema change.

## When to use

When a question recurs and its sheet shape recurs with it: a reader choosing among surfaces, a group
whose surface is referenced from more than one slice, a symptom that has already been diagnosed once.
Read the matching template before writing the sheet.

## When not to use

Not for a one-off topic — that is a plain note with the seven sections. Not for per-file documentation,
which is the anti-pattern every class exists to avoid. Not as a licence to reorder or rename a class's
fixed subsections: their order is what makes the sheet skimmable. And a class sheet with exactly one
reader is a second truth to maintain — keep that content in the slice doc instead.

## Examples

| Class | Instance in this corpus | Template |
|---|---|---|
| Slice generalities | `widget/widget-slice.md`, `status/status-slice.md`, `privilege/privilege-slice.md`, `installer/installer-slice.md`, `verification/verification-slice.md` | [[slice-generalities-template]] |
| UI inventory | `widget/ui-surfaces.md` | [[ui-inventory-template]] |
| Interface surface (contract mode) | `status/data-engine-contract.md` | [[interface-surface-template]] |
| Troubleshooting (quick-ref) | `verification/troubleshooting.md` | [[troubleshooting-template]] |

The interplay rule that makes the troubleshooting class pay off: every row of `project.md`'s Common
Lookups carries the **exact** symptom string that is the H2 of its entry in
[[troubleshooting]]. The table routes; the sheet holds the write-up; neither duplicates the other.

## Common mistakes

- **Tolerated fallout:** the exception is granted per class, so a poorly written class doc is
  contract-compliant and still unhelpful. The remedy is review, not more schema.
- Inventing a frontmatter key for class membership (`class: ui-inventory`, `mode: contract`) instead of
  using `tags` — a metadata-outside-contract error, and the reason mode is a tag.
- Copying a class sheet's body into `project.md`: the entry point routes, it never holds the write-up.
- Treating the class templates as exempt from the note contract. They are notes; they carry the seven
  sections and the seven keys.
- Adding a fifth class without a record — the schema then has two sources of truth about what shapes
  exist.

## References

- [../templates/slice-generalities-template.md](../templates/slice-generalities-template.md) — the mandatory per-slice shape.
- [../templates/ui-inventory-template.md](../templates/ui-inventory-template.md) — the selection-guide-first shape.
- [../templates/interface-surface-template.md](../templates/interface-surface-template.md) — the one-class-two-modes shape.
- [../templates/troubleshooting-template.md](../templates/troubleshooting-template.md) — the symptom-keyed shape.
- [adr-0003-slice-taxonomy](adr-0003-slice-taxonomy.md) — the slices each generalities doc maps.
- [DocumentationAsAService](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream class registry this corpus adopted and recorded locally.
