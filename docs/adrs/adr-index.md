---
id: adr-index
category: adrs
tags: [hub, index, adr, decisions]
aliases: [ADR Index, Decision Records]
related: [adr-0001-corpus-location-and-entry-point]
version: 1.1
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
  entry point and `project.md` as the agent-facing one. Its router clause is superseded by
  [[adr-0018-onrails-v1-4-retrofit]], which moves the entry point to the root `README.md`; the
  record itself is append-only and unedited.
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
  button gets a fixed narrow width. Its fixed narrow-width clause is superseded by
  [[adr-0011-fixed-dark-palette-from-mockup]]; the rest still stands.
- [[adr-0009-widget-owned-shutdown-countdown]] — the shutdown countdown is widget-owned (a wall-clock
  deadline with a local cancel), the power-off is a fixed command that adds no second command-building
  exception, and, unlike the docker stop, it does not prompt: logind's `allow_active=yes` default makes a
  local active session power off passwordlessly. Its inline-field rejection is superseded by
  [[adr-0010-inline-shutdown-minutes-in-the-representation]]; the rest still stands.
- [[adr-0010-inline-shutdown-minutes-in-the-representation]] — the shutdown minutes become an inline field
  in the representation: it emits a value-carrying signal and `main.qml` stays the only writer of the
  `shutdownCountdownMinutes` kcfg entry, validating through the unchanged resolver; the duration still
  never reaches a shell, so no second command-building exception is minted.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the widget paints the mockup's fixed dark palette and
  pixel type scale instead of following the Kirigami theme: a deliberate human-operator override that
  reverses the colour half of the SeverityDot rule (severity still resolves only in `SeverityDot.qml`),
  switches the popup to its own card via `PlasmaCore.Types.NoBackground`, and makes the two action buttons
  equal width; every command stays fixed and `unknown` stays muted.
- [[adr-0013-widget-update-check-and-release-site]] — the installed widget reads one local file and fetches
  one fixed https manifest to learn an update exists (a human-approved reversal of the "no network code"
  goal), with the command assembled entirely from constants so it mints no third command-building exception;
  `metadata.json` stays the single source of version truth through `sync-manifest.mjs`; CI gates on `test` +
  `qmllint` + `docs` while Playwright stays non-gating; and `site/` and `.github/` are documented in the
  Repository Structure because the sixth-slice question is left to the human. Its "not a link" clause is
  superseded by [[adr-0015-update-indicator-opens-the-release-page]]; the rest still stands.
- [[adr-0014-compose-grouping-and-podman-desktop-launch]] — containers group by the
  `com.docker.compose.project` label (the no-project bucket is a group like any other), a per-project
  play/stop runs a label-filtered `docker start|stop` as a new container-level mutation, and the Podman
  Desktop path is one validated setting quoted into a fixed command; it is the container-level exception
  [[adr-0006-video-downloader-command-boundary]] reserved a record for, and the polkit grant stays at
  `["start"]`. Its Podman Desktop UI-section clause is superseded by
  [[adr-0016-containers-flat-rows-and-podman-section-removal]]; the compose boundary and the retained
  backing logic still stand.
- [[adr-0015-update-indicator-opens-the-release-page]] — an exclamation-mark indicator beside the daemon
  status, shown only while an update exists, whose single click opens the widget's fixed Pages URL; it
  supersedes only [[adr-0013-widget-update-check-and-release-site]]'s "not a link / opens no browser"
  clause, and the silence contract, the fixed-URL rule and every other clause still stand.
- [[adr-0016-containers-flat-rows-and-podman-section-removal]] — the Containers header row and its
  `containerSectionExpanded` flag are deleted, group rows go flat with the bundled box glyph and small flat
  play/stop controls, and the Podman Desktop section is removed while its builders, kcfg entry and tests are
  retained; it supersedes [[adr-0014-compose-grouping-and-podman-desktop-launch]]'s UI-section clause, and the
  compose boundary still stands.
- [[adr-0017-podman-launch-button-and-topbar-removal]] — the Podman Desktop launch returns as a
  square 28x28 button beside the daemon-status label in the status card, wired back to the retained
  builder and one-shot source (eleven data sources again), and the "Workspace" topbar — logo tile,
  eyebrow, busy indicator, refresh button and hairline — is removed, with the refresh button and the
  busy indicator relocated into the status card; it supersedes
  [[adr-0016-containers-flat-rows-and-podman-section-removal]]'s Podman Desktop UI-removal clause,
  and the flat container rows still stand.
- [[adr-0018-onrails-v1-4-retrofit]] — the whole corpus is retrofitted to
  [documentation-onrails](https://github.com/DaveR-ui/documentation-onrails) v1.4: the root
  `README.md` becomes the single entry point (superseding ADR-0001's router clause), the procedure
  container becomes `docs/protocols/` (retiring the checklist class of the registry ADR-0005
  fixed), the validator and the two generated artifacts move to the repository root, and the
  methodology's name in every live citation becomes `documentation-onrails`. The append-only
  records above keep their historical text; this one carries the deltas.

## Elsewhere

- The contract these decisions bind: [../templates/document-template.md](../templates/document-template.md)
- The corpus rules in one page: [../../README.md](../../README.md)
- The slice map these records presuppose: [../project.md](../project.md)
