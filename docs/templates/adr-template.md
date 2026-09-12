---
id: adr-template
category: templates
tags: [template, adr, decision-record]
aliases: [ADR Template]
related: [document-template, adr-index]
version: 1.0
status: active
---

# ADR Template

## Problem

Structural and schema decisions get re-litigated — or silently reversed — when the *why* lives in
nobody's memory. A note may be revised; a decision record must not be revisable. Without a fixed
append-only shape, ADRs drift into marketing copy for choices already made.

## Solution

Copy this file for every decision record under `adrs/`. Naming: `adr-NNNN-<slug>.md`, with id
`adr-NNNN-<slug>` — a four-digit sequence, assigned as the next free number, never reused. ADRs
are **append-only**: never edit the original text; corrections arrive as an addendum block, and
reversals as a successor ADR carrying `supersedes`. The record keeps the full 7-key note
frontmatter and the seven verbatim body sections: the decision goes in Solution, the tolerated
fallout in Common mistakes or an addendum. Register every new ADR in `adrs/adr-index.md`.

## When to use

Every structural or contract-schema decision: a change to the note or context-doc key set, the
folder anatomy, the generated-artifact pipeline, or the version-bump policy — see the
[upstream lifecycle guidance](https://github.com/DaveR-ui/DocumentationAsAService) §4, where a
contract-breaking (MAJOR) bump *requires* an ADR.

## When not to use

Transient notes, implementation details, and any fact that belongs in a prose doc: an ADR records
a decision and its forces, not the state of the world. If the "decision" merely documents
existing behavior, it is a note.

## Examples

```markdown
---
id: adr-NNNN-<slug>
category: adrs
tags:
- adr
- <topic>
aliases:
- ADR-NNNN
related:
- adr-index
version: 1.0
status: active
# supersedes: <old-adr-id>    # optional: id of the ADR this replaces — omit entirely when unused
# expires_at: 2027-01-01      # optional: strict YYYY-MM-DD review date — omit entirely when unused
# moved_from: <old/path.md>   # optional: former path(s) after a move — omit entirely when unused
---

# ADR-NNNN: <Decision title>

## Problem
The forces at play: what hurt, what was missing, what was on the table.

## Solution
The decision, stated plainly and itemized. Append-only — corrections arrive as an
addendum block below, never as an edit of the text above.

## When to use
Reading back why the corpus is shaped this way.

## When not to use
Do not edit this record "for clarity". Supersede it with a new ADR, or append an addendum.

## Examples
<the concrete instance: files touched, ids minted, checks added>

## Common mistakes
Consequential omissions accepted at decision time (accepted debt), stated honestly.

## References
The guidelines and artifacts this decision binds.
```

## Common mistakes

- Editing the original text after the fact — a decision record that can be rewritten is
  archaeology falsified; add an addendum block instead.
- Reusing or back-filling sequence numbers: `NNNN` is the next free number in `adrs/`, forever.
- Writing an ADR for a non-decision (a fact, a tutorial) — it dilutes the folder's signal.
- Forgetting to register the new record in `adrs/adr-index.md` — an unlisted ADR is invisible
  (the missing-from-hub check).

## References

- [[document-template]] — the general note shape this specializes.
- [[adr-index]] — the hub every new ADR must be registered in.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream
  lifecycle, ADR placement, and version policy this record adapts.
