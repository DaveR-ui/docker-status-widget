---
id: ui-inventory-template
category: templates
tags: [template, ui, inventory, components, styles]
aliases: [UI Inventory Template]
related: [document-template, troubleshooting-template, project]
version: 1.0
status: active
---

# UI Inventory Template

## Problem

A reader facing six variants of the same widget with no map picks by what they last saw, not by what
fits. Choices and tokens scattered across slice docs get re-derived on every task — and re-derived
differently each time. One sheet per area answers the two questions readers actually bring: *which
variant do I choose?* and *which token do I look up?*

## Solution

Copy one sheet per UI area, with a fixed anatomy ordered by reader need: the selection guide comes
first — one line per decision, including a warning line wherever no modern variant exists — then
usage rules (ownership boundaries and value contracts), then the component inventory, where every
item carries the same seven subsections in the same order, then style tokens opening with a fast
anchor index so a lookup never scrolls. A compatibility matrix or decision tree is optional;
`## Related` points symptom write-ups at troubleshooting sheets and never copies fixes. The body
shape is a contracted exception under
[the upstream document contract §2](https://github.com/DaveR-ui/DocumentationAsAService); the
frontmatter is the standard note contract. Rationale:
[[adr-0005-doc-classes-and-body-shape-exceptions|ADR-0005]].

## When to use

An area with multiple variants of the same widget, shared style tokens worth looking up, or a
recurring "which component should I use?" question in review. One sheet per area — not per
component, not per slice.

## When not to use

Single-component areas (a plain note suffices); the framework's own API surface (that is upstream
documentation — record only this corpus's choices about it); per-slice private component notes;
symptom fixes (troubleshooting sheets hold those — link here, copy nowhere).

## Examples

```markdown
# <Area> UI Inventory

## Selection guide
- Plain form field → `Field`.
- Field fed by async data → `AsyncSelect`.
- Multi-pick with search → `MultiTypeahead` (legacy — no modern equivalent for grouped
  results; treat as frozen, do not extend).

## Usage rules
| Rule | Boundary |
|---|---|
| Components own presentation; slices own data shaping. | A component never fetches. |
| Values leave a component normalized. | Callers do not trim what they receive. |

## Component inventory

### AsyncSelect
#### Purpose
#### Path
#### Interface        ← what it takes in / emits
#### Data Flow
#### Usage Pattern
#### Anti-Patterns
#### Verification

### MultiTypeahead
...(same seven subsections, same order)...

## Style tokens
Fast anchors: spacing · color · typography · elevation

### Spacing
| Token | Value | Use |
|---|---|---|
| `--gap-form-row` | 12px | vertical rhythm in form stacks |

### Color
| Token | Value | Use |
|---|---|---|
| ... | ... | ... |

## Compatibility matrix     ← optional; drop it if nothing is deprecated
## Decision tree            ← optional; only when the guide outgrows its lines

## Related
- "dropdown opens behind the dialog" → the troubleshooting sheet; the fix lives there.
```

## Common mistakes

- Burying the selection guide below the inventory: the guide is the sheet's reason to exist —
  readers arrive to choose, not to read specs.
- Per-item subsections drifting in order or name: the fixed anatomy is what makes the sheet
  skimmable; a renamed or reordered item breaks every reader's muscle memory.
- Documenting the framework's own API surface: this sheet records *this corpus's* choices — which
  variant, which token, which rule — not upstream's method list.
- Duplicating troubleshooting fixes here: `## Related` points at the sheet that holds the write-up;
  a copied fix is a second truth.

## References

- [[document-template]] — the base note shape.
- [[troubleshooting-template]] — the sheet `## Related` points at.
- [[project]] — the Slices table that routes here.
