---
id: bootstrap-protocol
category: protocols
tags: [protocol, bootstrap]
aliases: [Bootstrap Protocol]
related: [README, new-note-protocol]
moved_from: [checklists/bootstrap-checklist.md]
version: 1.1
status: active
---

# Corpus Bootstrap Protocol

## Problem

The first ten minutes of a new documentation repo decide whether it becomes a navigable corpus
or a pile. The mistakes made here compound into migration debt.

## Solution

Order matters: each step makes the next one checkable.

**Skeleton**
- [ ] Create root `README.md` — THE single entry point: what the corpus is, how to navigate, the
      rules, the table of docs (`File | Purpose | When to read`).
- [ ] Declare `doc_language` once, in the `README.md` frontmatter. No exceptions after that.
- [ ] Bring the schema layer in: copy or link `templates/document-template.md` and the two
      protocols.
- [ ] Create 2–4 topic folders *only when the first real note needs one* — no speculative tree.
      Each starts with its hub `<folder>-index.md`.

**Runbook**
- [ ] Follow the ordered agent runbook: [the upstream bootstrap workflow](https://github.com/DaveR-ui/documentation-onrails/blob/main/guidelines/09-bootstrap-workflow.md).

**Store guarantees**
- [ ] Root `index.md` and `tag-index.md` generated (create the two files with their marker pairs by
      hand to start; `node validate.js --write` from the repo root fills both regions): overview
      stats + tree + hub list, and the tag → docs inverted index.
- [ ] Generated aids (index regions, diagrams) are marked as generated and rebuildable — never
      hand-patched.

**Review discipline from day one**
- [ ] Adopt the review catalog (see [[new-note-protocol]]) — walk it over your first notes; the two
      protocols are the mechanism, no tools required.
- [ ] Calibrate: walk it against the corpus *as it exists* and demand zero gaps — or write down,
      explicitly, what you tolerate (accepted debt).
- [ ] Make the walk a step of every merge the day it catches a real error you agree with.
- [ ] Walk the catalog with code where it exists: `node validate.js` from the repo root (errors
      exit 1).

**Agent-readiness (skip only if this stays a human-only corpus for now)**
- [ ] Query path is read-only; sandbox rejects absolute paths / `..` / symlink escapes.
- [ ] Not-found semantics chosen (`null` / `[]`), documented next to the tool surface.
- [ ] Snapshot staleness visible (a footer date on generated files is the minimum).

## When to use

Starting any new documentation repo, or auditing an existing one that "grew naturally".

## When not to use

Mid-scale restructuring of a healthy corpus — there, walk the review catalog first and follow its
findings; this protocol is for when there is no catalog walk yet.

## Examples

This corpus was bootstrapped with this protocol: `README.md` as the single entry point, the five
slices of [[project]] as the routing layer, `templates/` and `protocols/` as the schema layer and
the review mechanism, and `node validate.js --write` keeping the two root generated regions in
sync. The v1.4 retrofit of the whole corpus is recorded in
[[adr-0018-onrails-v1-4-retrofit]].

## Common mistakes

- Bootstrapping the tooling before the content. One real note + hub beats an empty perfect repo.
- Skipping the calibration step: an unchecked catalog graduates from advisor to nuisance in a week.
- Writing two entry points ("see also START-HERE.md") — navigation dies by branching at the root.

## References

- [../../README.md](../../README.md) — the entry point this protocol starts with.
- [[new-note-protocol]] — the per-note walk this protocol boots.
- [[adr-0018-onrails-v1-4-retrofit]] — the record of this corpus's move to the root layout.
- [documentation-onrails — protocols/bootstrap-protocol.md](https://github.com/DaveR-ui/documentation-onrails/blob/main/protocols/bootstrap-protocol.md)
  — the upstream normative shape this protocol follows.
