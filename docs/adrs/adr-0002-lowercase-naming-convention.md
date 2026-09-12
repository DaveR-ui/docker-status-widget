---
id: adr-0002-lowercase-naming-convention
category: adrs
tags: [adr, naming, convention, validator, tooling]
aliases: [ADR-0002]
related: [adr-index, adr-0001-corpus-location-and-entry-point]
version: 1.0
status: active
---

# ADR-0002: Lower-case names under `docs/`, and a vendored validator

## Problem

The reference implementation of this methodology names its own files with mixed case — `README.md`,
`ADRs/`, `Templates/`, `Checklists/`, `matching TAGS` — while every note name is already a lower-case
slug. The project owner required that **every file and folder name under `docs/` be lower-case**. That
requirement breaks the upstream machine walk in two ways: the validator identifies the corpus entry
point by the literal string `README.md`, and it classifies files by the folder names `ADRs/`,
`Templates/` and `Checklists/`. Left unadapted, a lower-case corpus reports a missing entry point and
a folder full of notes in the wrong contract.

## Solution

1. **Lower-case is the naming contract** for everything under `docs/`: `readme.md`, `project.md`,
   `index.md`, `tag-index.md`, `validate.js`, and the folders `adrs/`, `widget/`, `status/`,
   `privilege/`, `installer/`, `verification/`, `templates/`, `checklists/`. Ids and filename stems
   are already slugs, so ids, wikilink stems and heading anchors stay unchanged by the rule.
2. **The validator is vendored to `docs/validate.js`** and adapted in exactly three places:
   - the entry point is `readme.md`;
   - `project.md` is classified as a context-doc **entry point** rather than as a note;
   - folder classification uses this corpus's lower-case folder names (`adrs/`, `templates/`,
     `checklists/`) plus `context/` for the reserved context-doc tier.
   The header of the vendored file names the adaptation, so a future diff against upstream
   (https://github.com/DaveR-ui/DocumentationAsAService) is deliberate rather than accidental.
3. **The upstream guidelines prose is not vendored.** This corpus adopted the *shapes*, not the
   essay: the normative contract is what the templates encode, and the catalog the vendored
   validator implements — eight errors, three warnings — is normative for this corpus.
4. **Precedence inside the corpus:** where the vendored validator and a template disagree, the
   template wins and the validator carries the bug.

## When to use

Before creating any file or folder under `docs/`, and before adapting the validator anywhere else.
Read the header of `docs/validate.js` first: it states the three adaptation sites in place.

## When not to use

Do not extend lower-case naming outward: the repository root keeps `README.md` as GitHub expects it,
and vendored or third-party artifacts keep their upstream names. Do not treat a case-only rename of a
corpus path as cosmetic — classification and the entry-point lookup are name-based.

## Examples

| Upstream name | This corpus |
|---|---|
| `README.md` | `readme.md` |
| `ADRs/`, `Templates/`, `Checklists/` | `adrs/`, `templates/`, `checklists/` |
| `guidelines/` (context docs) | `context/` (reserved, not created) |
| `project.md` classified as a note | `project.md` classified as a context-doc entry point |

```bash
node docs/validate.js          # check only: read-only, exit 1 on errors
node docs/validate.js --write  # regenerate the two generated regions, then check
```

## Common mistakes

- Assuming a lower-case `readme.md` stops GitHub from rendering it — it renders identically, so the
  rename costs nothing and breaks nothing.
- Renaming a corpus folder without touching the classifier: the notes silently fall out of the
  contract and the review reports errors that look like content bugs.
- Letting the vendored copy drift from upstream without noting *why* in its header — an unexplained
  divergence is the first step back to a rival source of truth.
- Adding a new folder (for example `context/`) and forgetting to teach the classifier about it.

## References

- [../validate.js](../validate.js) — the vendored machine walk and its adaptation header.
- [../templates/document-template.md](../templates/document-template.md) — the contract the validator enforces.
- [adr-0001-corpus-location-and-entry-point](adr-0001-corpus-location-and-entry-point.md) — where the corpus lives.
- [DocumentationAsAService](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream methodology this corpus follows.
