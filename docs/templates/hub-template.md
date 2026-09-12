---
id: hub-template
category: templates
tags: [template, hub, navigation]
aliases: [Hub Template]
related: [document-template, readme]
version: 1.0
status: active
---

# Hub Template

## Problem

A folder without a gatekeeper is a pile: readers enter blind, and a note that no hub lists is
unreachable through `entry → hub → note` — invisible content, an error at review (the
missing-from-hub check).

## Solution

Every topic folder gets exactly one hub, named `<folder>-index.md`. Its body has three duties and
nothing else: **what belongs here** (the folder's scope, one or two lines), **what is in here** (a
linked list of every note in the folder — the registration that keeps each one reachable), and
**what belongs elsewhere and why** (the boundary that stops the folder from absorbing drift). A
hub routes and catalogs; it never restates note content.

## When to use

When creating any new folder in the wiki layer — the hub is born with the folder, before its
second note. Also as the review reference when a missing-from-hub finding appears.

## When not to use

Not for the root entry point (readme is unique — a second "start here" is a maze); not for
hub-less schema folders (`templates/`, `checklists/`), whose files register in the entry point's
navigation table instead; never as a content page — duplication makes the hub a rival truth.

## Examples

```markdown
---
id: payments-index
category: Payments
tags:
- hub
- index
aliases:
- Payments Index
related:
- payments-flow
version: 1.0
status: active
---

# Payments Index

What belongs here: how money is captured — authorization, settlement, failure handling.
Anything about *returning* money belongs in `Refunds/` — different lifecycle, different owner.

## Contents
- [[payments]] (`payments-flow`) — how a charge is created, then settles or fails.

## Elsewhere
- Refund handling → `Refunds/refunds-index.md`
- Dispute/chargeback policy → `Disputes/disputes-index.md`
```

Hubs keep the **complete 7-key frontmatter** but may shorten the body — the three duties above
are the whole job; the verbatim note sections are optional here.

## Common mistakes

- A hub that duplicates note content — routing and cataloging only; duplication is a warning
  (the near-duplicate-body check) and future drift.
- Adding a note without adding its hub row in the same commit — the gap-close loop closes only
  when note, hub row, and tag entry have all landed
  ([upstream reference](https://github.com/DaveR-ui/DocumentationAsAService)).
- A hub reading like a phone book: past ~30 notes, split the folder — a hub that doesn't route
  is decoration.

## References

- [[document-template]] — the note shape the hub routes to.
- [[new-note-checklist]] — the walk that catches a note missing from its hub.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the
  upstream corpus that defines the hub rule and folder anatomy.
