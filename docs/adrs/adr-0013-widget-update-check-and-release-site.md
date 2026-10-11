---
id: adr-0013-widget-update-check-and-release-site
category: adrs
tags: [adr, update-check, network, ci, github-pages]
aliases: [ADR-0013]
related: [adr-index, adr-0003-slice-taxonomy, adr-0006-video-downloader-command-boundary, adr-0009-widget-owned-shutdown-countdown, status-slice, widget-slice, data-engine-contract, verification-slice, project]
version: 1.0
status: active
---

# ADR-0013: The widget update check and the GitHub Pages release site

## Problem

This corpus listed "no network code" among the project's goals — stated in [../project.md](../project.md)'s
Overview and echoed by the fixed-command rule that every executed command is a constant. A read-mostly
observer of `systemctl` and `docker` needs no network at all, and that made the promise easy to keep. But
an *installed* widget then had no way to learn that a newer release existed: it could not tell the user its
own build was stale, and the only signal was the user remembering to look at the repository.

Serving that signal needs two things the project did not have: a machine-readable place to publish the
release version, and a small piece of network code inside the widget that reads it. Both were forbidden by
the stated goal, so adding them quietly would have made the corpus lie. The change is a reversal of a
documented anti-goal, and this corpus records reversals as ADRs — the human operator approved it, and this
record is that approval written down rather than left to the diff.

The forces that shaped the solution: the widget must not grow a service of its own (nothing to run, nothing
to be down); it must not phone home (no telemetry, no POST); it must not open a browser; it must not accept
a URL from anywhere but a constant; it must fail to **silence**, never to an error the user has to read; and
the release site that publishes the manifest must not become a second place where the version is authored by
hand.

## Solution

One deliberate, human-approved reversal, recorded here: the installed widget reads one local file and one
fixed https URL to learn whether a newer version exists, and a GitHub Pages site publishes that URL.

1. **The reversal, stated plainly.** `project.md` listed "no network code" as an anti-goal; a human approved
   reversing it so an installed widget can be told an update exists. The widget now performs exactly one
   local read and one network read, and nothing else about it touches the network.
2. **What it reads, and what it still never does.** It reads the widget's own installed `metadata.json`
   (one local file) and fetches one fixed https URL,
   `https://dave-r-ui.github.io/docker-status-widget/latest.json` (one network fetch). It has no service of
   its own, sends no telemetry, makes no POST, takes no URL from configuration, and opens no browser. The
   URL is a constant (`UPDATE_CHECK_URL`) precisely so a misconfiguration cannot point the widget at another
   host; it is `https`, and it is never assembled from a value.
3. **The command is assembled entirely from fixed constants — deliberately not a third command-building
   exception.** `DockerStatus.buildUpdateCheckCommand()` builds
   `cat <installed-metadata-path> 2>/dev/null; printf '\n%s\n' '<marker>'; curl -fsSL --max-time 5 '<fixed-url>'`,
   and every byte of it is a fixed constant (`INSTALLED_METADATA_PATH`, `UPDATE_CHECK_MARKER`,
   `UPDATE_CHECK_CURL_BINARY`, `UPDATE_CHECK_MAX_TIME_SECONDS`, `UPDATE_CHECK_URL`). Nothing is interpolated
   from configuration or user input. [ADR-0006](adr-0006-video-downloader-command-boundary.md) sanctions the
   one command-building exception — the video-download row, which interpolates a validated URL and validated
   configuration values — and [ADR-0009](adr-0009-widget-owned-shutdown-countdown.md) declined to mint a
   second for the shutdown. This change mints none either: it is a different class, the same class as the
   fixed daemon commands, with one fixed URL folded in. The run token appended for the manual re-check is
   safe for exactly the reason it is safe on every fixed command — the string is built by the project, not
   supplied to it.
4. **The manifest contract.** `package/io.github.daver-ui.dockerstatus/metadata.json`'s `KPlugin.Version`
   is the single source of version truth. `site/latest.json` is generated from it by
   `.github/scripts/sync-manifest.mjs` (key order `app`, `name`, `version`, `released`, `url`), and the Pages
   workflow regenerates it on every push, so the published bytes cannot drift from the file Plasma itself
   reads. The widget reads only the manifest's `version` field; `app`, `name`, `released` and `url` are for
   the page. The comparison is numeric and segment-wise, and `isUpdateAvailable()` is true only when the
   remote version is **strictly** greater than the installed one — identical, lower, or either side
   unparseable all answer false — so a false positive is structurally impossible.
5. **The silence contract.** Every failure path renders nothing: an offline machine, a missing `curl`, a
   missing or unreadable `metadata.json`, an unparseable manifest, or a remote that is not strictly newer
   all collapse to "no update available". There is no error text anywhere in this feature — the handler
   reads neither `stderr` nor the exit code beyond the end-of-run guard — and the one line it can ever show
   appears only when an update genuinely exists. This is the opposite of the download row, which surfaces
   failures; the asymmetry is deliberate, because a check the user did not ask for must never nag.
6. **Cadence and presentation.** The check is polled every `updateCheckIntervalHours` (kcfg Int, default 6,
   0–168, 0 disables) plus a manual "Check for updates" context-menu action. The notice is one muted line
   inside the popup, rendered only while an update is available; it is deliberately **not** a system
   notification and **not** a link. That is an accepted, reasoned trade-off: a notification would interrupt
   for something non-urgent, and a link would mean the widget opening a browser — which this widget does not
   do. The user reads the line and goes to the repository themselves.
7. **CI and the merge gate.** `.github/workflows/ci.yml` runs on every pull request into `master` and
   reports exactly three status-check contexts — `test` (`node --test tests/`), `qmllint` (Qt6,
   error-counted), and `docs` (`node docs/validate.js`) — which are the required checks. Playwright is
   deliberately **non-gating** (`continue-on-error: true`), and the reason is recorded in the workflow
   itself: the only web surface this project has is the new site, and the widget's real logic is QML that no
   browser test can reach.
8. **The slice question, honestly.** `site/` and `.github/` are new territory and belong to none of the
   five slices. [ADR-0003](adr-0003-slice-taxonomy.md) reserves a sixth Slices-table row for human approval —
   "a sixth row requires human approval … split only when tasks actually land in one area repeatedly". This
   change did **not** add a row: `site/` and `.github/` are documented in [project.md](../project.md)'s
   Repository Structure instead, and the routing decision is left to the human. The alternatives that were
   on the table: a new `release-site` slice; folding `site/` into `verification` (it is, after all, evidence
   tooling); or documenting it only here. The choice is pending the human, and this record states the
   options rather than picking one.

## When to use

Read this record when changing anything in the update path or the release site: the URL or any
`UPDATE_CHECK_*` constant, the command builder, the version parsers or the comparison, the cadence setting,
the popup line, the manifest script, the Pages workflow, or the CI merge gate. It is the reference for why
the widget now has network code and for what it still refuses to do.

## When not to use

Do not read this as permission to add network behaviour beyond the one fixed fetch — no telemetry, no second
endpoint, no configuration-supplied host, no POST. Do not read it as a slice decision: `site/` has no slice
row yet. Do not read it as licence to turn `sync-manifest --check` into a fourth status-check context (it is
a step inside the `test` job, deliberately, so the branch-protection contract stays three checks), or to
promote Playwright to a gate — both are separate decisions. Do not edit this record to reverse it again; a
successor supersedes it.

## Examples

- **Widget, logic:** `package/io.github.daver-ui.dockerstatus/contents/ui/dockerstatus.js` gains the
  `UPDATE_CHECK_URL`, `UPDATE_CHECK_MAX_TIME_SECONDS` (5), `UPDATE_CHECK_MARKER`, `UPDATE_CHECK_CURL_BINARY`,
  `PACKAGE_ID`, `INSTALLED_METADATA_PATH`, `VERSION_PATTERN` and `WIDGET_VERSION_PATTERN` constants, and the
  `isVersionString`, `buildUpdateCheckCommand`, `splitUpdateCheckOutput`, `parseWidgetVersion`,
  `parseLatestVersion`, `compareVersions` and `isUpdateAvailable` functions.
- **Widget, wiring:** `main.qml` gains `updateCheckCommand`, `updateCheckIntervalMs`, the `installedVersion`
  / `updateCheckInFlight` / `updateAvailable` / `updateFeedback` state,
  `checkForUpdates()`, `handleUpdateCheck()`, the two `P5Support.DataSource` instances
  (`updateCheckSource`, `updateCheckForced`), the third `PlasmaCore.Action` ("Check for updates") and the
  full-representation forwarding. `FullRepresentation.qml` gains the muted update line and the
  `updateCheckRequested()` signal. `contents/config/main.xml` gains the `updateCheckIntervalHours` Int entry
  (default 6, 0–168) and `config/ConfigGeneral.qml` its `Updates` section and `QQC2.SpinBox`.
- **Release site:** `site/index.html`, `site/styles.css`, `site/latest.json` and the non-gating
  `site/e2e/playwright.config.mjs` + `site/e2e/site.spec.mjs`. The manifest is `site/latest.json`, served at
  `https://dave-r-ui.github.io/docker-status-widget/latest.json`; the site is at
  `https://dave-r-ui.github.io/docker-status-widget/`.
- **CI and script:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`,
  `.github/workflows/playwright.yml`, and `.github/scripts/sync-manifest.mjs` (`--write` / `--check`).
- **Ids minted:** `adr-0013-widget-update-check-and-release-site` (this record).
- **Checks added:** the three PR status contexts `test`, `qmllint`, `docs`; the `test` job additionally runs
  `sync-manifest.mjs --check` as a step, which adds no fourth context.
- **Evidence:** `tests/dockerstatus.test.mjs` pins the constants, the assembled fixed command (run through a
  real `/bin/sh` with a stub `curl`), the split, the parsers, the comparison, and the QML wiring as static
  text.

## Common mistakes

- **Treating the version as authored in two places.** `metadata.json` is the single source; `site/latest.json`
  is generated. A hand-edited manifest is drift, and the widget trusts the version it carries.
- **The static version text in `site/index.html` is a second source of truth that nothing guards.**
  `sync-manifest.mjs --check` guards the manifest only. A release checklist has to update `site/index.html`'s
  static `#latest-version` / `#release-line` text by hand; the inline script rewrites it from the manifest
  when JavaScript runs, but the no-JavaScript fallback and the `--check` gate both miss a stale hand-edit.
  Accepted debt.
- **`sync-manifest --check` guards the manifest, but only from inside the `test` job.** A
  `metadata.json` version bump with a stale committed `site/latest.json` now fails `ci.yml`. What it does
  **not** guard is the hand-authored page: `site/index.html`'s static `#latest-version` / `#release-line`
  text is a second source of truth that `--check` never looks at, so a release checklist has to update that
  file by hand; the inline script rewrites it from the manifest when JavaScript runs, but the no-JavaScript
  fallback and the gate both miss a stale hand-edit. Accepted debt, listed in
  [../verification/verification-slice.md](../verification/verification-slice.md).
- **Expecting an error when the check fails.** Silence is the contract. Habitual error-surfacing code —
  reading `stderr`, showing "check failed" — is a regression against this record.
- **Expecting a runtime test of the update check.** The QML surface cannot be instantiated outside
  plasmashell, so the check's control flow — offline, no `curl`, unreadable metadata — is review-and-lint
  only, exactly like every other QML wrapper in this repo. The pure version maths is tested; the wrapper is
  not.
- **Making the URL configurable.** The URL is a constant so a misconfiguration cannot point the widget at
  another host; a settings field for it would reintroduce exactly the risk this record avoids.
- **Adding a sixth slice row in the same change.** The row is a human decision (ADR-0003); this record
  documents the territory and leaves the routing choice open.
- **Opening a browser from the notice.** The line is deliberately not a link.

## References

- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the one
  command-building exception; the update check is not a second.
- [adr-0009-widget-owned-shutdown-countdown](adr-0009-widget-owned-shutdown-countdown.md) — the precedent
  that declining a second exception is itself a decision.
- [adr-0003-slice-taxonomy](adr-0003-slice-taxonomy.md) — the slice map, and the sixth-row rule this record
  does not invoke.
- [adr-index](adr-index.md) — the hub this record is registered in.
- [../status/status-slice.md](../status/status-slice.md) — the pure helpers the boundary lives in.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the two data sources and the popup line.
- [../status/data-engine-contract.md](../status/data-engine-contract.md) — the set semantics and the marker
  split that let one one-shot carry both halves.
- [../verification/verification-slice.md](../verification/verification-slice.md) — the CI layer and the
  accepted gaps this record creates.
- [../project.md](../project.md) — the Overview's reversed anti-goal, the Technology Stack row and the
  Repository Structure entries for `.github/` and `site/`.
