---
id: adr-index
category: adrs
tags: [hub, index, adr, decisions]
aliases: [ADR Index, Decision Records]
related: [adr-0001-corpus-location-and-entry-point]
version: 1.5
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
  superseded by [[adr-0008-configurable-cookies-browser-and-bottom-text]] and its exact-command-shape
  clause by [[adr-0022-download-cancellation-and-partial-cleanup]]; the rest still stands.
- [[adr-0007-stop-button-confirmation-and-narrow-grant]] — a stop button that confirms on a second
  click, with the polkit grant deliberately left at `["start"]` so stop prompts while start does not.
- [[adr-0008-configurable-cookies-browser-and-bottom-text]] — the cookies browser becomes a validated
  setting, reversing ADR-0006's browser-constancy clause; the bottom text is configuration, and the stop
  button gets a fixed narrow width. Its fixed narrow-width clause is superseded by
  [[adr-0011-fixed-dark-palette-from-mockup]] and its bottom-text clause by
  [[adr-0020-footer-removal-and-pinned-popup-layout]]; the rest still stands.
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
  clause, and the silence contract, the fixed-URL rule and every other clause still stand. Its
  single-`Qt.openUrlExternally`-call clause is superseded by
  [[adr-0021-download-folder-tooltip-and-open-folder-shortcut]]; the constant-URL rule and the
  `updateAvailable` gate still stand.
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
- [[adr-0019-miscelanea-section-merge]] — the popup's video-download block and its "Countdown to
  Extinction" block merge into one collapsible "Miscelánea" section under a single toggle, each block
  keeping its own inner title, with one local flag (`miscSectionExpanded`) and one derived gate
  (`miscBodyVisible`, `miscSectionExpanded || shutdownPending`) replacing the two per-block flags and
  the old `countdownBodyVisible`; the config page merges its two cards into one. It supersedes
  nothing: adr-0009's un-collapsible armed countdown and every safeguard are preserved, and adr-0016
  and adr-0017 are untouched.
- [[adr-0020-footer-removal-and-pinned-popup-layout]] — the popup's footer and its configurable bottom
  text are deleted end-to-end (the `taglineText` kcfg entry, its config control, its `main.qml` forwarding
  and the preview-harness injection included), and the popup becomes a pinned column: the status card on
  top, the container section as the scrollable middle region floored at one and a half rows
  (`containerRowHeight * 3 / 2` = 78px), the merged Miscelánea card pinned last, and the update notice in a
  reserved one-grid-unit row between the middle region and Miscelánea. It supersedes only
  [[adr-0008-configurable-cookies-browser-and-bottom-text]]'s bottom-text clause; the cookies clause and
  the rest of that record still stand.
- [[adr-0021-download-folder-tooltip-and-open-folder-shortcut]] — the download row's "YouTube or X URL"
  title carries a tooltip with the configured download folder, expanded (`~/Downloads` →
  `/home/<user>/Downloads`), and the download feedback row's right edge carries a flat `folder-open`
  ToolButton that opens the containing folder, visible only after a successful download; because
  `PlasmaComponents3.ToolTip` renders only when its parent is an `AbstractButton`, the title becomes a
  flat, visually-invisible `ToolButton`, and the folder URL is built by a pure, unit-tested helper with
  per-segment percent-encoding — never a browser URL and never a configured string interpolated into a
  URL. It supersedes only [[adr-0015-update-indicator-opens-the-release-page]]'s single-`Qt.openUrlExternally`
  clause: the widget now has two call sites, pinned by a deliberately strict `count == 2` assertion that
  names both, while ADR-0013's silence contract and ADR-0015's constant-URL rule still stand.
- [[adr-0022-download-cancellation-and-partial-cleanup]] — the download row gains a real cancel: the
  download command carries a fixed prefix that writes the downloader's own pid (the prefix `exec`s the
  downloader, so the pid in the file is yt-dlp's), a second one-shot (`downloadStopAction`) signals only a
  pid that run wrote for itself and that `kill -0` accepts — a predicate that even passes a zombie — and
  then sweeps the documented partial suffixes anchored on the video id recovered from the
  already-allow-listed URL; the run's stamp carries a per-instance nonce and its URL, directory and token
  are captured at start, so a second instance or an edited folder cannot make STOP kill or sweep in the
  wrong place; and the row moves its busy indicator into the feedback row so the row carries a
  STOP while a download is in flight and offers the dismiss X only when nothing is in flight. It supersedes
  only [[adr-0006-video-downloader-command-boundary]]'s exact-command-shape clause — the stop command is the
  second built command of the same exception, not a third exception — and it refuses outright to call
  `connectedSources = []` a cancel, because that stops the events, not the download.
- [[adr-0023-qmllint-gate-contract-correction]] — the CI `qmllint` gate keeps its intent and repairs its
  implementation: a pass now fails on `Error:`-severity diagnostics, on a parse failure named by the
  parser's **message text** as well as by its category (the runner's Qt prints one and not the other), and
  on `Failed to open file` diagnostics, and on a non-zero exit status only when that pass resolved every
  import — because a module-less `ubuntu-24.04` runner cannot resolve the five `org.kde.*` modules the
  corpus imports and exits 255 over a clean corpus. The job is pinned to `ubuntu-24.04` on purpose, since
  its Qt is what all four legs were measured against. The job name and the three status-check contexts
  (`test`, `qmllint`, `docs`) are untouched.
- [[adr-0024-collapse-all-for-compose-groups]] — the popup's container section gains a flat "Collapse
  all" action on a compact strip above the list: it closes every compose group at once, the standalone
  "Other containers" bucket included, while each group's own ± still toggles only its group. The request
  is a generation counter on the root (`groupsCollapseEpoch`) that each not-yet-tapped group absorbs by
  closing through its derived `groupBodyVisible`, so the control is repeatable and the ± always wins;
  the strip's 32px height is folded into `containerScrollFloor` (`containerRowHeight * 3 / 2 +
  containerCollapseStripHeight` = 110px) so the one-and-a-half-row scroll peek is preserved rather than
  shrunk, at the honest cost of a fixed 32px taller popup. It supersedes nothing: ADR-0016's headerless
  flat list, ADR-0020's pinned column, and the Miscelánea card's armed-state override
  (ADR-0019/ADR-0022) all stand untouched.

## Elsewhere

- The contract these decisions bind: [../templates/document-template.md](../templates/document-template.md)
- The corpus rules in one page: [../../README.md](../../README.md)
- The slice map these records presuppose: [../project.md](../project.md)
