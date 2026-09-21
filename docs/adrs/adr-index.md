---
id: adr-index
category: adrs
tags: [hub, index, adr, decisions]
aliases: [ADR Index, Decision Records]
related: [adr-0001-corpus-location-and-entry-point]
version: 1.0
status: active
---

# ADR Index

What belongs here: decisions about the *shape* of this corpus and about the project's structural
boundaries — where the corpus lives, what its names look like, how the territory is sliced, where
privilege is granted. Records are append-only: corrections arrive as an addendum block, reversals as
a successor record carrying `supersedes`.

Anything that merely states how things already are belongs in a note, not here. Anything that can be
re-litigated from the code alone does not need a record either — only the *why* does.

## Contents

- [[adr-0001-corpus-location-and-entry-point]] — the corpus lives in `docs/`, with `readme.md` as
  entry point and `project.md` as the agent-facing one.
- [[adr-0002-lowercase-naming-convention]] — every name under `docs/` is lower-case, and the
  validator is vendored and adapted to match.
- [[adr-0003-slice-taxonomy]] — the five slices, and the evidence each one rests on.
- [[adr-0004-scoped-polkit-grant]] — privilege is granted by one scoped polkit rule, not by `pkexec`
  per click or a sudoers entry.
- [[adr-0005-doc-classes-and-body-shape-exceptions]] — four doc classes are registered here, with an
  explicit body-shape exception and mode-by-tag membership.
- [[adr-0006-video-downloader-command-boundary]] — the video-download row is the one sanctioned
  exception to the fixed-command rule; a second exception needs a new ADR. Its browser-constancy clause is
  superseded by [[adr-0008-configurable-cookies-browser-and-bottom-text]]; the rest still stands.
- [[adr-0007-stop-button-confirmation-and-narrow-grant]] — a stop button that confirms on a second
  click, with the polkit grant deliberately left at `["start"]` so stop prompts while start does not.
- [[adr-0008-configurable-cookies-browser-and-bottom-text]] — the cookies browser becomes a validated
  setting, reversing ADR-0006's browser-constancy clause; the bottom text is configuration, and the stop
  button gets a fixed narrow width.
- [[adr-0009-widget-owned-shutdown-countdown]] — the shutdown countdown is widget-owned (a wall-clock
  deadline with a local cancel), the power-off is a fixed command that adds no second command-building
  exception, and, unlike the docker stop, it does not prompt: logind's `allow_active=yes` default makes a
  local active session power off passwordlessly. Its inline-field rejection is superseded by
  [[adr-0010-inline-shutdown-minutes-in-the-representation]]; the rest still stands.
- [[adr-0010-inline-shutdown-minutes-in-the-representation]] — the shutdown minutes become an inline field
  in the representation: it emits a value-carrying signal and `main.qml` stays the only writer of the
  `shutdownCountdownMinutes` kcfg entry, validating through the unchanged resolver; the duration still
  never reaches a shell, so no second command-building exception is minted.

## Elsewhere

- The contract these decisions bind: [../templates/document-template.md](../templates/document-template.md)
- The corpus rules in one page: [../readme.md](../readme.md)
- The slice map these records presuppose: [../project.md](../project.md)
