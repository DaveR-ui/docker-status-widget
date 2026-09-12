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
JavaScript in a bare V8 context, the lint pass over QML, the recorded probe evidence, and the honest
catalogue of what remains unverified. Form matters here more than anywhere else — tests run against
the exact shipped bytes, and evidence that cannot be re-run is labelled a **probe**, never dressed up
as a test.

## Boundaries

**In:** `tests/dockerstatus.test.mjs`; the shell-level tests over the assembled download command; the
`qmllint` pass over QML; the evidence layers and their limits; the symptom-keyed
[troubleshooting](troubleshooting.md) sheet.

**Out:** production logic ([status-slice](../status/status-slice.md)); UI wiring
([widget-slice](../widget/widget-slice.md)); install mechanics
([installer-slice](../installer/installer-slice.md)); the polkit rule's correctness, which is argued in
[privilege-slice](../privilege/privilege-slice.md) and tested nowhere.

## Entry points

- `tests/dockerstatus.test.mjs` — the harness; read the header comment before the assertions.
- [troubleshooting.md](troubleshooting.md) — the symptom-keyed write-ups.
- [../project.md](../project.md) — the Commands table, plus Common Lookups for symptom routing.

## How it works

Harness mechanics, in order: read the shipped `dockerstatus.js`; strip only the `.pragma library` line
(QML-only syntax, not valid JavaScript); evaluate the result with `runInContext` in a fresh V8 context;
round-trip realm-crossing values through JSON before comparing them, because `deepStrictEqual` rejects
a cross-realm object for the wrong reason; then assert behaviour by group — constants, daemon-state
parsing, normalisation, container parsing, malformed-line handling, the badge, the run token, both
severity mappings, and the download helpers (URL classification, quoting, path/binary/runtime
resolution, command assembly and result parsing), plus the static files that ship beside them: the two
action identities, both fixed privileged commands and the polkit rule's `ALLOWED_VERBS` array. Two of
those tests are the strongest available check
that user input never becomes shell syntax: they run the real assembled command through `/bin/sh` with
a stub `yt-dlp` on `PATH` that prints its argv, so a quoting failure would show up as split arguments
or an executed injection rather than as a wrong string.

The evidence layers, and which of them can be re-run:

| Layer | How it is verified | Re-runnable |
|---|---|---|
| Node unit suite | 67 unit tests under `node --test`, over the shipped bytes: parsing, severity, the run token, the download helpers, the two action identities and their exact QML `actionKind` expressions, both fixed privileged commands, and the polkit rule as text plus a default-deny predicate matrix over its whole decision surface; also the config surfaces a runtime test cannot reach — the tagline default, the `firefox` cookies default, the cookies combo's seed-and-mute arrangement, the full-representation bindings and the stop button's fixed width | yes |
| Download command boundary | unit tests run the assembled command through a real `/bin/sh` with a stub `yt-dlp` on `PATH` and assert the argv arrives intact, including the real YouTube URL with its `&list=` and a quote-injection URL; a separate test pins the `withRunToken()` newline case an adversarial pass found | yes |
| Data engine contract | probe QML against live plasma5support 6.7.4, re-measured on 6.7.5 for the long one-shot row: payload keys, set semantics, interval quantisation, and the finding that a two-second silence produces no event at all | no — probe |
| Full pipeline against live Docker | a probe harness parsed the real three-container stack | no — probe |
| End-to-end download | the exact assembled command for an X link exited 0 and wrote a 10,365,309-byte mp4, with yt-dlp reporting cookies extracted from Firefox; a YouTube `--simulate` run reported `--no-playlist`, node solving JS challenges and format 401+251; without `--js-runtimes` the same URL failed with "The page needs to be reloaded", and without cookies with "Sign in to confirm you're not a bot" | no — probe |
| All QML files | two binaries measured. The `qmllint` on `PATH` is Qt5 (`qt5-declarative 5.15.19`): exit 0 and no output, and a deliberate `property int x: "boom"` probe also exited 0 — syntax-only. The matching `/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.11.2`, the tool for a Plasma 6 target) reports semantics: exit 0 with **0 errors, 69 warnings all `[unqualified]`, 37 infos of which 3 are `[unused-imports]`**, and no `[missing-property]`, `[incompatible-type]`, `[unresolved-type]` or `[import]` diagnostic. Exit code is not the evidence: Qt6 exits 0 unless `--max-warnings` is set, so the diagnostic stream is | yes, re-run to confirm |
| `main.qml` as a `PlasmoidItem` | **not executable outside plasmashell** | impossible here |

The third column is the point of the table: in a project with no CI, a reader must be able to tell
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

## Dependencies

**Upstream:** Node ≥ 18 for `node:test`; `qmllint` — Qt5 on `PATH` is syntax-only, the Qt6 binary at `/usr/lib/qt6/bin/qmllint` is the semantic tool matching the Plasma 6 target; a live Plasma session for probes; live Docker for
the pipeline probe; `yt-dlp` plus a JavaScript runtime and a signed-in Firefox profile for the download
probes.
**Downstream:** the Common Lookups anchors resolve into the troubleshooting sheet, and every trust
claim this corpus makes about the widget rests on these layers.

## Known gaps & accepted debt

- **No CI.** Nothing runs the suite automatically, so "the tests pass" is a local claim with a date
  attached.
- No QML behavioural test: the widget wrapper — including the download row — is lint-and-review only,
  and the lint is syntax-only. The download's *command boundary* is well tested; its *row* is not.
- Probes are one-off evidence rather than scripted reproductions — the weakest layer, and it is
  labelled as such rather than promoted to a test.
- Container states outside the mapped set are untested against live `docker ps` output.
- The end-to-end download probes are dated environment measurements (yt-dlp 2026.08.19, node, a local
  Firefox profile), not scripted reproductions, and the success path is not covered by CI.
- Nothing in this slice can observe the widget inside plasmashell; see the
  `PlasmaQuick::PlasmoidAttached` entry in [troubleshooting.md](troubleshooting.md).
