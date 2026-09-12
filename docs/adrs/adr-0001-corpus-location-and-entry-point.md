---
id: adr-0001-corpus-location-and-entry-point
category: adrs
tags: [adr, documentation, entry-point, structure]
aliases: [ADR-0001]
related: [adr-index, adr-0002-lowercase-naming-convention]
version: 1.0
status: active
---

# ADR-0001: The corpus lives in `docs/`, with two fixed entry points

## Problem

The repository already had a human `README.md` at its root, describing the widget, its install
commands, its two design decisions and its known edges. The documentation methodology this corpus
follows requires exactly one entry point per corpus, an always-loaded agent-facing entry point, and
generated navigation. Three questions had to be answered before a single note could be written:
where does the corpus root sit, which file is *the* entry point, and where does the agent-facing
routing table live without becoming a rival source of truth for the human README.

## Solution

1. **Corpus root: `docs/`.** The repository root keeps its human-facing `README.md`; the corpus,
   its generated artifacts, its validator, its schema layer and its decision records all live under
   `docs/`. The root README gains a short pointer to `docs/readme.md` and never duplicates corpus
   content.
2. **`docs/readme.md` is the single entry point** and carries `doc_language` for the whole corpus.
   It is a *router*: navigation tables, the corpus rules, and links onward. It does not teach.
3. **`docs/project.md` is the agent-facing entry point** — the always-loaded tier — with the nine
   fixed sections: Overview, Technology Stack, Slices, Commands, Repository Structure, Key
   Conventions, Domain Entities, Context Index, Common Lookups.
4. **Generated artifacts are `docs/index.md` and `docs/tag-index.md`**, written by
   `docs/validate.js --write` into marker-delimited regions. The validator is vendored into the
   corpus so that `node docs/validate.js` needs no install, no `package.json` and no cwd discipline.
5. **`docs/context/` is reserved and not created.** The validator already classifies that folder as
   the context-doc tier; the folder is born the first time a strategic doc needs a home, not
   speculatively.

## When to use

When adding a file to this corpus: place it in a slice folder or a schema folder, register it in the
right hub, and link it from `readme.md` if its folder has no hub. When auditing the corpus: walk
`readme.md` → hub → note and confirm no hop requires guessing.

## When not to use

Do not read it as permission to create a second "start here": `project.md` does not open with
navigation, and `readme.md` does not restate the Slices table. Do not move the corpus root to the
repository root later "for discoverability" — that decision would need a successor record.

## Examples

- Corpus entry point: `docs/readme.md`
- Agent entry point: `docs/project.md`
- Generated: `docs/index.md`, `docs/tag-index.md`
- Machine walk: `node docs/validate.js` (read-only) and `node docs/validate.js --write`
- Root README pointer: the Documentation section added to `/README.md`

## Common mistakes

- **Tolerated fallout:** two files sit at the top of the corpus. `readme.md` must stay a router —
  the moment it grows a manual, the corpus has two entry points and the maze is back.
- Treating the root `README.md` as part of the corpus: it carries no frontmatter and is not walked
  by the validator, and it must not be edited to satisfy a corpus check.
- Writing `docs/context/` "for structure" before anything needs it — speculative folders are how a
  tree rots into a graveyard.
- Assuming `project.md` needs the note contract's `id`/`aliases`: it is a context doc, and its keys
  are the lighter set plus `doc_language`.

## References

- [../project.md](../project.md) — the entry point this record fixes.
- [../readme.md](../readme.md) — the corpus router.
- [../templates/project-md-template.md](../templates/project-md-template.md) — the skeleton `project.md` instantiates.
- [adr-0002-lowercase-naming-convention](adr-0002-lowercase-naming-convention.md) — the naming rule that came with it.
