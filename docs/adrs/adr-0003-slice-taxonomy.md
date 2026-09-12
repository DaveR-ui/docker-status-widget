---
id: adr-0003-slice-taxonomy
category: adrs
tags: [adr, slices, brownfield, routing]
aliases: [ADR-0003]
related: [adr-index, widget-slice, status-slice]
version: 1.0
status: active
---

# ADR-0003: Five slices — widget, status, privilege, installer, verification

## Problem

This is a brownfield retrofit: the code existed before the corpus. The first artifact worth making is
the territory map, and the map is only worth making if its borders are real. Git evidence is thin
here — the repository has a single commit, so co-change history cannot be consulted and the usual
strongest signal is unavailable. Slicing by file type (`/utils`, `/handlers`) or by the folders that
happen to exist is the documented anti-signal, and per-file documentation was rejected outright: a
map at 1:1 scale cannot be kept fresh.

## Solution

Five slices, demarcated by **runtime and process boundaries** plus **dependency direction**, with the
existing content folders as corroboration rather than as the reason:

| Slice | Boundary it follows | Corroborating evidence |
|---|---|---|
| widget | Plasma loads a KPackage and renders QML | `package/io.github.daver-ui.dockerstatus/contents/` — one deployment unit |
| status | Pure functions runnable outside Plasma | `contents/ui/dockerstatus.js` — zero dependencies, tested in Node |
| privilege | polkit mediates the one privileged verb | `polkit/49-docker-status-widget.rules` — a system-wide file, not a package file |
| installer | A shell process the user runs | `install.sh` — the only entry point a human invokes |
| verification | A Node harness and linter runs, not shipped code | `tests/dockerstatus.test.mjs` — depends on status, deploys nothing |

Two structural facts make the borders load-bearing rather than cosmetic:

- **Dependency direction is acyclic and shallow.** `widget` imports `status`. `status` imports
  nothing. `verification` depends on `status`. `installer` copies `widget` and invokes
  `verification`. `privilege` depends on nothing and is depended on by nobody in code — its only
  caller is polkit at runtime.
- **Ownership of the privilege boundary is separate on purpose.** The rule file is the only artifact
  in the project that grants anything to anyone, and it is installed by its own command. Folding it
  into `installer` would hide the one fact a reviewer must check.

Registration is metadata, not a new key: membership rides on `category` and `tags`; each row's
primary doc is a slice-generalities note in its own folder.

## When to use

When a task arrives, route it through the Slices table in [../project.md](../project.md). When a
change spans two slices, say so explicitly — `widget` + `status` changes are the common pair, because
a new state must be parsed and rendered.

## When not to use

Do not add a slice because a folder exists or a file type appears. A **sixth row requires human
approval**, and the rule is: split only when tasks actually land in one area repeatedly. Do not make
`docs/` a slice — the corpus is the map of the territory, not a part of it. Do not split `status` into
"parsing" and "severity" at this size; routing dies of granularity long before it dies of vagueness.

## Examples

- A change to how `unknown` is rendered: `status` (severity mapping) + `widget` (colour only).
- A change from `systemctl` to a D-Bus call: `status` alone, and `status/data-engine-contract.md` is
  the sheet to update.
- A grant for a second verb: `privilege` (deliberate edit of `ALLOWED_VERBS`) + `verification`
  (a symptom string may need to be added).
- A new install target: `installer` alone.
- One row per slice, one generalities doc per row: see [../widget/widget-slice.md](../widget/widget-slice.md)
  and its siblings.

## Common mistakes

- **Tolerated fallout:** `verification` is a slice whose territory is proofs rather than shipped
  code. It earns its row because a task genuinely lands there (adding a test, chasing a probe), but
  it is the row most likely to need re-cutting if the harnesses grow.
- Treating `tests/` as a "type folder" slice — tests belong to the territory they prove; the row
  exists for the *harness and evidence* kinds of task, not for the file extension.
- Slicing by team or by author: nobody owns these files individually, and the org chart drifts.
- Leaving a code area out of the table: the brownfield twin of "missing from its hub" is *an area
  missing from the Slices table*, and it is the first thing a review should chase.

## References

- [../project.md](../project.md) — the Slices table this record fixes.
- [../templates/slice-generalities-template.md](../templates/slice-generalities-template.md) — the shape each row's primary doc instantiates.
- [../widget/widget-index.md](../widget/widget-index.md) — a slice folder and its hub.
- [adr-0001-corpus-location-and-entry-point](adr-0001-corpus-location-and-entry-point.md) — the corpus this map belongs to.
