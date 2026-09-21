---
last_updated: 2026-09-21
status: active
description: Entry point of the Docker Status documentation corpus — what it is, how to navigate it, and the rules every note obeys.
tags: [index, entry-point, navigation, documentation]
version: 1.0
doc_language: en
---

# Docker Status — Documentation Corpus

This corpus documents the Docker Status plasmoid: its QML surfaces, its pure logic, its privilege
model, its installer and the way it is proven. The thesis is the same one every corpus in this
family states — *the files are the store*; the organization **is** the index; and health is a
routine walk of a machine-checkable catalog, not a feeling.

Navigation is designed, not discovered: this file is the single entry point, every folder has
exactly one hub, and every note is reachable in three hops or fewer. [project.md](project.md) is
the agent-facing entry point — it carries the Slices routing table. This file routes to it.

## Start here

| If you need to… | Read |
|---|---|
| know what this project is, in what form, and what it refuses to be | [project.md](project.md) — Overview |
| know where a task lands | [project.md](project.md) — Slices |
| change the QML surfaces | [widget/widget-slice.md](widget/widget-slice.md) |
| choose which UI surface a change belongs to | [widget/ui-surfaces.md](widget/ui-surfaces.md) |
| change parsing, state or severity logic | [status/status-slice.md](status/status-slice.md) |
| understand the data engine contract the widget relies on | [status/data-engine-contract.md](status/data-engine-contract.md) |
| touch privilege or the passwordless start | [privilege/privilege-slice.md](privilege/privilege-slice.md) |
| change install, upgrade or removal | [installer/installer-slice.md](installer/installer-slice.md) |
| run the tests, audit the evidence, or chase a symptom | [verification/verification-slice.md](verification/verification-slice.md) |
| resolve an exact error or symptom string | [verification/troubleshooting.md](verification/troubleshooting.md) |
| know *why* something is shaped this way | [adrs/adr-index.md](adrs/adr-index.md) |
| write a new note | [templates/document-template.md](templates/document-template.md) |
| review before merging | [checklists/new-note-checklist.md](checklists/new-note-checklist.md) |
| validate the whole corpus | run `node docs/validate.js` — the machine walk of the catalog |

## Folders

| Folder | Hub | What it holds |
|---|---|---|
| `adrs/` | [adrs/adr-index.md](adrs/adr-index.md) | Append-only decision records: the archaeology of *why*. |
| `widget/` | [widget/widget-index.md](widget/widget-index.md) | The QML surfaces slice and its UI inventory sheet. |
| `status/` | [status/status-index.md](status/status-index.md) | The pure-logic slice and the data engine contract sheet. |
| `privilege/` | [privilege/privilege-index.md](privilege/privilege-index.md) | The scoped polkit grant slice. |
| `installer/` | [installer/installer-index.md](installer/installer-index.md) | The lifecycle CLI slice. |
| `verification/` | [verification/verification-index.md](verification/verification-index.md) | How the project is proven, and the symptom write-ups. |
| `templates/` | — (schema folder) | The copyable shapes: note, hub, ADR, project entry, slice generalities, and the three registered doc classes. |
| `checklists/` | — (schema folder) | The by-hand validation walk, no tooling required. |

Schema folders have no hub on purpose: their files register in the navigation tables below instead.

## Generated navigation

- [index.md](index.md) — tree, counts and ids for the whole corpus.
- [tag-index.md](tag-index.md) — tag → documents, for when the vocabulary is unknown.

Both are written by `node docs/validate.js --write` into marker-delimited regions, write-if-diff.
Human text outside the markers survives regeneration; text **inside** them is rebuilt, never
rescued — if it is lost, rerun the generator.

## Rules of this corpus

- Every file and folder name is **lower-case**; ids are slugs.
- Notes carry the 7 required frontmatter keys and the 7 verbatim body sections; context docs carry
  their own lighter key set, with `doc_language` on the entry points.
- `related` uses **ids**; wikilinks and body links use **filename stems**. One resolver accepts both,
  case-insensitively.
- One hub per folder; a note missing from its hub, an unresolvable link, or a duplicate id is an
  **error** at review. Warnings (no H1, `category` ≠ folder, near-duplicate body) advise without
  blocking.
- Nothing is documented per file: the map scales with areas, not with the size of the territory.

## Schema layer

| Template | Instantiate it when |
|---|---|
| [templates/document-template.md](templates/document-template.md) | Creating any note. |
| [templates/hub-template.md](templates/hub-template.md) | Creating any folder's `<folder>-index.md`. |
| [templates/adr-template.md](templates/adr-template.md) | Recording a decision under `adrs/`. |
| [templates/project-md-template.md](templates/project-md-template.md) | Starting (or auditing) `project.md`. |
| [templates/slice-generalities-template.md](templates/slice-generalities-template.md) | Building the map of a slice. |
| [templates/ui-inventory-template.md](templates/ui-inventory-template.md) | Adding a surface readers must choose among. |
| [templates/interface-surface-template.md](templates/interface-surface-template.md) | Documenting a group's surfaces or a payload contract. |
| [templates/troubleshooting-template.md](templates/troubleshooting-template.md) | Writing up a symptom that can recur. |

| Checklist | Walks |
|---|---|
| [checklists/new-note-checklist.md](checklists/new-note-checklist.md) | One note, before it merges. |
| [checklists/bootstrap-checklist.md](checklists/bootstrap-checklist.md) | A whole corpus, when structure changes. |

## Decision records

| Record | Decision |
|---|---|
| [adrs/adr-0001-corpus-location-and-entry-point.md](adrs/adr-0001-corpus-location-and-entry-point.md) | The corpus lives in `docs/`; `readme.md` is the entry point, `project.md` the agent-facing one. |
| [adrs/adr-0002-lowercase-naming-convention.md](adrs/adr-0002-lowercase-naming-convention.md) | Every name under `docs/` is lower-case, and the validator is vendored and adapted to match. |
| [adrs/adr-0003-slice-taxonomy.md](adrs/adr-0003-slice-taxonomy.md) | The five slices, and the evidence each one rests on. |
| [adrs/adr-0004-scoped-polkit-grant.md](adrs/adr-0004-scoped-polkit-grant.md) | Privilege is granted by one scoped polkit rule, not by `pkexec` per click or a sudoers entry. |
| [adrs/adr-0005-doc-classes-and-body-shape-exceptions.md](adrs/adr-0005-doc-classes-and-body-shape-exceptions.md) | Four doc classes are registered here, with an explicit body-shape exception. |
| [adrs/adr-0006-video-downloader-command-boundary.md](adrs/adr-0006-video-downloader-command-boundary.md) | The video-download row is the one sanctioned exception to the fixed-command rule. |
| [adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md](adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md) | A stop button that confirms on a second click, with the polkit grant deliberately left at `["start"]` so stop prompts while start does not. |
| [adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md](adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md) | The cookies browser becomes a validated setting, reversing ADR-0006's browser-constancy clause; the bottom text is configuration, and the stop button gets a fixed narrow width. |
| [adrs/adr-0009-widget-owned-shutdown-countdown.md](adrs/adr-0009-widget-owned-shutdown-countdown.md) | A widget-owned "Countdown to Extinction" shutdown: the power-off is a fixed command, the duration is a validated setting that never reaches it, and, unlike the docker stop, it does not prompt. Its inline-field rejection is superseded by ADR-0010. |
| [adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md](adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md) | The shutdown minutes become an inline field in the representation: it emits a value-carrying signal and `main.qml` stays the only writer of the kcfg entry; the duration still never reaches a shell. |
