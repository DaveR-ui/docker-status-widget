---
id: verification-slice
category: verification
tags: [slice, generality, verification, tests, evidence]
aliases: [Verification slice, Evidence slice]
related: [verification-index, troubleshooting, status-slice]
version: 1.0
status: active
---

# Verification — Slice Generalities

## What this slice is

The slice whose territory is proof rather than product: the harness that evaluates the shipped
JavaScript in a bare V8 context, the lint pass over QML, the CI that runs both (and the corpus checker)
on every pull request, the recorded probe evidence, and the honest
catalogue of what remains unverified. Form matters here more than anywhere else — tests run against
the exact shipped bytes, and evidence that cannot be re-run is labelled a **probe**, never dressed up
as a test.

## Boundaries

**In:** `tests/dockerstatus.test.mjs`; the shell-level tests over the assembled download command; the
`qmllint` pass over QML; the CI workflows that run the suite, the lint, the corpus check and the non-gating
site e2e; the evidence layers and their limits; the symptom-keyed
[troubleshooting](troubleshooting.md) sheet.

**Out:** production logic ([status-slice](../status/status-slice.md)); UI wiring
([widget-slice](../widget/widget-slice.md)); install mechanics
([installer-slice](../installer/installer-slice.md)); publishing the release site (that is the Pages
workflow's job, not a proof); the polkit rule's correctness, which is argued in
[privilege-slice](../privilege/privilege-slice.md) and tested nowhere.

## Entry points

- `tests/dockerstatus.test.mjs` — the harness; read the header comment before the assertions.
- `.github/workflows/ci.yml` — the merge gate: the three jobs whose names are the three status-check
  contexts (`test`, `qmllint`, `docs`).
- `.github/workflows/pages.yml` and `.github/scripts/sync-manifest.mjs` — the publish path, and the manifest
  derivation the widget's version check depends on.
- [troubleshooting.md](troubleshooting.md) — the symptom-keyed write-ups.
- [../project.md](../project.md) — the Commands table, plus Common Lookups for symptom routing.

## How it works

Harness mechanics, in order: read the shipped `dockerstatus.js`; strip only the `.pragma library` line
(QML-only syntax, not valid JavaScript); evaluate the result with `runInContext` in a fresh V8 context;
round-trip realm-crossing values through JSON before comparing them, because `deepStrictEqual` rejects
a cross-realm object for the wrong reason; then assert behaviour by group — constants, daemon-state
parsing, normalisation, container parsing, malformed-line handling, the badge, the run token, both
severity mappings, the download helpers (URL classification, quoting, path/binary/runtime
resolution, command assembly and result parsing), and the update-check helpers (the fixed command, the
marker split, the version parsers and the comparison), plus the static files that ship beside them: the two
action identities, both fixed privileged commands and the polkit rule's `ALLOWED_VERBS` array. Two of
those tests are the strongest available check
that user input never becomes shell syntax: they run the real assembled command through `/bin/sh` with
a stub `yt-dlp` on `PATH` that prints its argv, so a quoting failure would show up as split arguments
or an executed injection rather than as a wrong string.

The evidence layers, and which of them can be re-run:

| Layer | How it is verified | Re-runnable |
|---|---|---|
| Node unit suite | 120 unit tests under `node --test`, over the shipped bytes: parsing, severity, the run token, the download helpers, the update-check helpers (the constants, the fixed command they assemble, the marker split, the version parsers and the strictly-greater comparison), the shutdown countdown helpers (`resolveShutdownMinutes`, `shutdownRemainingSeconds`, `formatCountdown` and the two constants), the two action identities and their exact QML `actionKind` expressions, both fixed privileged commands, and the polkit rule as text plus a default-deny predicate matrix over its whole decision surface; also the surfaces a runtime test cannot reach — the tagline default, the `firefox` cookies default, the cookies combo's seed-and-mute arrangement, the shutdown kcfg entry and its config control, the fixed `powerOffCommand` literal and the countdown state machine in `main.qml`, the full-representation shutdown bindings, the inline shutdown-minutes field's wiring (inbound property, edit signal, validation through the single resolver, seed/sync guards, the focus-loss mirror that re-syncs a valid field value without clobbering the user's error text, disabled-while-pending) and the single-writer rule (only `main.qml` writes the entry; an unresolvable value is never persisted), and the stop button's fixed width | yes |
| Download command boundary | unit tests run the assembled command through a real `/bin/sh` with a stub `yt-dlp` on `PATH` and assert the argv arrives intact, including the real YouTube URL with its `&list=` and a quote-injection URL; a separate test pins the `withRunToken()` newline case an adversarial pass found | yes |
| CI (GitHub Actions) | `.github/workflows/ci.yml`, on `pull_request` into `master`: `node --test tests/*.mjs`; the Qt6 `qmllint` — the job installs `qt6-declarative-dev-tools` and runs `/usr/lib/qt6/bin/qmllint` over both QML roots, read as a **diagnostic stream**, not an exit code, because Qt6 exits 0 unless `--max-warnings` is set, so a real defect is an `Error:`-severity diagnostic in the captured output **or** a non-zero qmllint exit status (a file it cannot parse exits 255); and `node docs/validate.js` in check mode only — plus one more step inside the `test` job:
  `.github/scripts/sync-manifest.mjs --check`, which fails the pull request when the committed
  `site/latest.json` no longer matches `metadata.json`. It is a step, not a job, so it adds no fourth
  status context. Three status-check contexts: `test`, `qmllint`, `docs`. | yes — this is the merge gate |
| Release site (Playwright) | `.github/workflows/playwright.yml` — `continue-on-error: true`, so deliberately **non-gating**: it serves `site/` with a local `python3` static server through `site/e2e/playwright.config.mjs` and runs `site/e2e/site.spec.mjs` on pull requests that touch `site/`, plus a weekly sweep. It never runs in the merge gate. | yes, but not part of the gate |
| Data engine contract | probe QML against live plasma5support 6.7.4, re-measured on 6.7.5 for the long one-shot row: payload keys, set semantics, interval quantisation, and the finding that a two-second silence produces no event at all | no — probe |
| Full pipeline against live Docker | a probe harness parsed the real three-container stack | no — probe |
| End-to-end download | the exact assembled command for an X link exited 0 and wrote a 10,365,309-byte mp4, with yt-dlp reporting cookies extracted from Firefox; a YouTube `--simulate` run reported `--no-playlist`, node solving JS challenges and format 401+251; without `--js-runtimes` the same URL failed with "The page needs to be reloaded", and without cookies with "Sign in to confirm you're not a bot" | no — probe |
| All QML files | two binaries measured. The `qmllint` on `PATH` is Qt5 (`qt5-declarative 5.15.19`): exit 0 and no output, and a deliberate `property int x: "boom"` probe also exited 0 — syntax-only. The matching `/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.11.2`, the tool for a Plasma 6 target) reports semantics: on `contents/ui/*.qml` exit 0 with **0 errors, 75 warnings all `[unqualified]`, 43 infos of which 2 are `[unused-imports]`**; on `contents/ui/config/*.qml` exit 0 with **0 errors, 22 warnings all `[unqualified]`, 6 infos of which 1 is `[unused-imports]`** — and no `[missing-property]`, `[incompatible-type]`, `[unresolved-type]` or `[import]` diagnostic. Exit code is not the evidence: Qt6 exits 0 unless `--max-warnings` is set, so the diagnostic stream is. These counts predate the update-check addition (two data sources, one action, one config section) and should be re-measured | yes, re-run to confirm |
| Shutdown countdown (QML) | the play/stop timing, the inline field's interaction, the wall-clock deadline and the effective passwordless power-off live in QML that cannot be instantiated outside plasmashell; only the resolver, the formatting helpers and the field's wiring (pinned as static text) are covered by the suite | impossible here — review only |
| `main.qml` as a `PlasmoidItem` | **not executable outside plasmashell** — the attached-properties factory fails with `PlasmaQuick::PlasmoidAttached`; the representations are previewable headless ([[render-preview]]) | wrapper: impossible outside a session; representation: yes (manual probe) |

The last column is the point of the table: even with a CI merge gate, a reader must be able to tell
which claims rest on a reproducible test and which rest on a measurement someone took once. Probe
evidence is version-bound and dated, so when the environment changes it expires instead of silently
still applying.

## Conventions of this slice

- Tests load the shipped file. A test over a copy proves nothing about what ships.
- Stripping the pragma line is the only permitted transformation of the source under test.
- A new branch in the logic needs a test in the same change. A new observable behaviour in QML needs a
  probe note or an explicit entry in a slice's known gaps — never silence.
- Realm-crossing values are compared after a JSON round-trip.
- A symptom string in `project.md`'s Common Lookups must be the exact H2 of the troubleshooting sheet.
  The string is the routing key; a paraphrase breaks the lookup for humans and for agents alike.
- Evidence that cannot be re-run is labelled a probe, with the version it was measured against. A
  quoting claim needs a real shell behind it: a regex assertion about the command string is not
  evidence that a shell parses it that way.
- The three CI job names **are** the required status-check contexts (`test`, `qmllint`, `docs`); renaming a
  job renames the required check, so that is a branch-protection change, not a cosmetic one. Keep `qmllint`
  read as a diagnostic stream, never an exit code — Qt6 exits 0 with warnings unless `--max-warnings` is
  set.

## Dependencies

**Upstream:** Node ≥ 18 for `node:test`; `qmllint` — Qt5 on `PATH` is syntax-only, the Qt6 binary at `/usr/lib/qt6/bin/qmllint` is the semantic tool matching the Plasma 6 target; a live Plasma session for probes; live Docker for
the pipeline probe; `yt-dlp` plus a JavaScript runtime and a signed-in Firefox profile for the download
probes; a GitHub runner (Ubuntu, Node 22, the `qt6-declarative-dev-tools` package) for the CI layer, and
`python3` on that runner for the non-gating Playwright server.
**Downstream:** the Common Lookups anchors resolve into the troubleshooting sheet, and every trust
claim this corpus makes about the widget rests on these layers.

## Known gaps & accepted debt

- **The deployed Pages artifact is only verified by simulation.** The e2e suite serves `site/` with a local
  `python3` server; it never sees the assembled `dist/` the Pages workflow uploads (`site/*` plus the copied
  icon and screenshots). A missing or mis-pathed asset in `dist/` would not be caught here.
- **`sync-manifest --check` now guards the manifest, but only the manifest.** It runs as a step inside the
  `test` job of `ci.yml` — deliberately a step rather than a fourth job, so the branch-protection contract
  stays three status contexts — so a `metadata.json` version bump with a stale committed `site/latest.json`
  fails the pull request. What it does not see is the site itself: the non-gating e2e suite reads the
  committed `site/latest.json` and would notice the mismatch in its weekly sweep, but nothing gates on it.
- **The static version text in `site/index.html` is hand-maintained**, and `sync-manifest --check` does not
  guard it — it guards the manifest only. A release checklist has to update the page's static
  `#latest-version` / `#release-line` text by hand; the inline script rewrites it from the manifest when
  JavaScript runs, so the no-JavaScript fallback is the path that will silently go stale.
- **Playwright is deliberately non-gating**, so the site cannot block a merge. Promoting it is a separate
  decision, not a default.
- **The update check inside plasmashell is unreachable by any test.** Its control flow — offline, no `curl`,
  an unreadable `metadata.json`, an unparseable manifest — is review-and-lint only; the Node suite pins the
  pure helpers and the wiring as static text, which proves the arrangement, not the running behaviour
  ([[adr-0013-widget-update-check-and-release-site]]).
- No QML behavioural test: the widget wrapper — including the download row, the shutdown countdown and the
  update check —
  is lint-and-review only. The download's *command boundary* and the countdown's *resolver* are well
  tested; their *rows*, the inline field's interaction and the play/stop timing are not — the field's
  wiring is pinned as static text, which proves the arrangement, not the behaviour. The *pixels* of the
  representations are now reviewable without a session ([[render-preview]]); that is still a probe, not a test.
- The effective passwordless power-off has no runtime test: whether logind authorises
  `org.freedesktop.login1.power-off` is a property of the machine's policy (measured with `pkcheck`, exit
  0 in a local active session), not of anything this suite runs. A policy change on another machine would
  not be caught here ([[adr-0009-widget-owned-shutdown-countdown]]).
- Probes are one-off evidence rather than scripted reproductions — the weakest layer, and it is
  labelled as such rather than promoted to a test.
- Container states outside the mapped set are untested against live `docker ps` output.
- The end-to-end download probes are dated environment measurements (yt-dlp 2026.08.19, node, a local
  Firefox profile), not scripted reproductions, and the success path is not covered by CI.
- The representations can be previewed outside plasmashell — headless for the full
  representation, live for the rest ([[render-preview]]); this machine has a live
  Plasma 6 session, a CI runner does not. What still cannot be instantiated outside
  a running plasmashell is the `main.qml` wrapper and the panel integ
