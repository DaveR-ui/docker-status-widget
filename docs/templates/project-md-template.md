---
id: project-md-template
category: templates
tags: [template, project-md, entry-point]
aliases: [project.md Template]
related: [project, slice-generalities-template]
version: 1.0
status: active
---

# project.md Template

## Problem

An AI agent starts every session cold: if the repo's identity, stack, boundaries, and commands
aren't in one machine-consumable place, every turn burns budget rediscovering (or inventing)
them. A `project.md` written free-form fails the same way — consumers cannot rely on sections
they have to hunt for.

## Solution

Copy the fenced skeleton below as `docs/project.md`. It carries the **context-doc contract**
(see [the upstream document contract](https://github.com/DaveR-ui/DocumentationAsAService) §4)
plus the entry-point-only key `doc_language`, and **nine fixed sections in fixed order, fixed
names**: Overview, Technology Stack, Slices, Commands, Repository Structure, Key Conventions,
Domain Entities, Context Index, Common Lookups. Keep it short (~100–150 lines) — its value is
being read whole, every session; depth lives in `docs/context/`, linked from the Context Index.

## When to use

Day zero of any repo an agent will operate in — and as the audit checklist for any agent system
that "keeps misunderstanding the project". Fill it in the bootstrap order of
[the upstream project.md guidance](https://github.com/DaveR-ui/DocumentationAsAService) (facts
from reality first, Slices from recent change history).

## When not to use

Not a store for strategic reasoning (that's `docs/context/`), not decision history (that's
`adrs/`), not a second human readme opening with "start here" — pick one canonical agent-facing
entry point.

## Examples

```markdown
---
last_updated: YYYY-MM-DD
status: active
description: one line — what this repo is and how to enter it
tags: [project, entry-point]
version: 1.0
doc_language: english
---

# Project Entry Point — <repo name>

## Overview
One paragraph: what this is, in what form (e.g. "files ARE the store — no database").
The anti-goals belong here too.

## Technology Stack
Language + pinned version, frameworks, database/auth/secrets posture, architecture
pattern name. Exactness beats ranges.

## Slices
| Slice | Description | Keywords | Entry points | Primary agents |
|---|---|---|---|---|
| api    | HTTP surface, auth, rate limits      | handler, jwt, 429, cors, openapi   | api/, api/handlers/       | coder, tester, reviewer |
| ui     | Routes, components, client state     | router, form, dialog, css, state    | src/app/, src/components/ | coder, tester           |
| docs   | Architecture notes, ADRs, onboarding | frontmatter, hub, index, adr, tag   | docs/, docs/context/      | documenter, explorer    |

## Commands
| Command | Purpose |
|---|---|
| `make dev`   | run the dev server (note working directory + env quirks) |
| `make test`  | run the test suite                                          |

## Repository Structure
<compact tree with one-line roles — the human-readable mirror of the hub model>

## Key Conventions
- Binding, checkable bullets only: public API contracts, vocabulary rules,
  `doc_language`, invariants. Each is a candidate catalog row (see 04).

## Domain Entities
- <Noun> — one-line definition. (The vocabulary every reader, human or machine,
  reconciles against.)

## Context Index
- docs/context/<topic>.md — its purpose, one line. The doorway, never the room.

## Common Lookups
- "build fails with `Cannot find module 'left-pad'`" → docs/context/build-notes.md#missing-modules
- "the test runner hangs with no output" → docs/context/testing-notes.md#hangs
```

## Common mistakes

- Leaving the Keywords column empty because the description "sounds descriptive" — a narrative
  row with no routing tokens routes nothing.
- Updating prose but not the Slices table during refactors: misrouting starts silently because
  the table *looks* authoritative.
- Growing in place past ~150 lines: agents stop reading it whole and start guessing again —
  extract to a context doc and leave a one-line pointer.
- Common Lookups rows written as topics instead of **exact symptom strings** (an error message,
  a failed goal) pointing at doc + heading anchor: the symptom is the navigation key.

## References

- [[project]] — the artifact this skeleton produces.
- [[slice-generalities-template]] — the per-slice doc each Slices row points at.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the
  upstream section anatomy and bootstrap order this skeleton instantiates.
