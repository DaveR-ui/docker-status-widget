---
id: bootstrap-checklist
category: checklists
tags: [checklist, bootstrap]
aliases: [Bootstrap Checklist]
related: [readme, new-note-checklist]
version: 1.0
status: active
---

# Corpus Bootstrap Checklist

## Problem

The first ten minutes of a new documentation repo decide whether it becomes a navigable corpus
or a pile. The mistakes made here compound into migration debt.

## Solution

Order matters: each step makes the next one checkable.

**Skeleton**
- [ ] Create root `readme.md` — THE single entry point: what the corpus is, how to navigate, the
      rules, the table of docs (`File | Purpose | When to read`).
- [ ] Declare `doc_language` once, in the `readme.md` frontmatter. No exceptions after that.
- [ ] Bring the schema layer in: copy or link `templates/document-template.md` and the two checklists.
- [ ] Create 2–4 topic folders *only when the first real note needs one* — no speculative tree. Each starts with its hub `<folder>-index.md`.

**Runbook**
- [ ] Follow the ordered agent runbook: [the upstream bootstrap workflow](https://github.com/DaveR-ui/DocumentationAsAService).

**Store guarantees**
- [ ] `index.md` and `tag-index.md` generated (create the two files with their marker pairs by hand
      to start; `node docs/validate.js --write` fills both regions): overview stats +
      tree + hub list, and the tag → docs inverted index.
- [ ] Generated aids (index regions, diagrams) are marked as generated and rebuildable — never hand-patched.

**Review discipline from day one**
- [ ] Adopt the review catalog (see [[new-note-checklist]]) — walk it over your first notes; the two checklists are the mechanism, no tools required.
- [ ] Calibrate: walk it against the corpus *as it exists* and demand zero gaps — or write down, explicitly, what you tolerate (accepted debt).
- [ ] Make the walk a step of every merge the day it catches a real error you agree with.
- [ ] Walk the catalog with code where it exists: `node docs/validate.js` (errors exit 1).

**Agent-readiness (skip only if this stays a human-only corpus for now)**
- [ ] Query path is read-only; sandbox rejects absolute paths / `..` / symlink escapes.
- [ ] Not-found semantics chosen (`null` / `[]`), documented next to the tool surface.
- [ ] Snapshot staleness visible (a footer date on generated files is the minimum).

## When to use

Starting any new documentation repo, or auditing an existing one that "grew naturally".

## When not to use

Mid-scale restructuring of a healthy corpus — there, walk the review catalog first and follow its
findings; this checklist is for when there is no catalog walk yet.

## Examples

This corpus was bootstrapped with this checklist: `readme.md` as the single entry point, the five
slices of [[project]] as the routing layer, `templates/` and `checklists/` as the schema layer and the
review mechanism, and `node docs/validate.js --write` keeping the two generated regions in sync.

## Common mistakes

- Bootstrapping the tooling before the content. One real note + hub beats an empty perfect repo.
- Skipping the calibration step: an unchecked catalog graduates from advisor to nuisance in a week.
- Writing two entry points ("see also START-HERE.md") — navigation dies by branching at the root.

## References

- [[readme]] — the entry point this checklist starts with.
- [[new-note-checklist]] — the per-note walk this checklist boots.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream
  layout and review catalog this checklist bootstraps.
