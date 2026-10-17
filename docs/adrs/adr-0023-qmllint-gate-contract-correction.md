---
id: adr-0023-qmllint-gate-contract-correction
category: adrs
tags: [adr, ci, verification, qmllint, gate]
aliases: [ADR-0023]
related: [adr-index, adr-0013-widget-update-check-and-release-site, verification-slice, troubleshooting]
version: 1.1
status: active
---

# ADR-0023: The qmllint gate keeps its intent and repairs its implementation — four legs, and an exit status read only where the imports resolve

## Problem

The `qmllint` job in `.github/workflows/ci.yml` failed every pull request with
`qmllint error diagnostics: 0; unparseable/unopenable passes: 2`. Measured facts, all re-runnable:

- **Both passes exited 255 with ZERO error diagnostics.** CI run `39055120672` (PR #5) and, identically,
  CI run `38177079659` (PR `feature/ci-pages-update-check`, 2026-10-12) — so the failure predates PR #5.
- **The cause is unresolved imports, not a parse failure.** 11 `Failed to import …` warnings
  (`QtQuick` ×2, `QtQuick.Layouts` ×2, `QtQuick.Controls`, `org.kde.kirigami` ×2,
  `org.kde.plasma.components`, `org.kde.plasma.core`, `org.kde.plasma.plasmoid`,
  `org.kde.plasma.plasma5support`) — that is **eleven import failures over eight distinct modules**
  (three Qt modules: `QtQuick`, `QtQuick.Controls`, `QtQuick.Layouts`; and five KDE modules,
  `org.kde.kirigami` counted twice) — 253 `was not found` warnings, and **0** `[syntax]` and **0**
  `Failed to open file` diagnostics.
- **The corpus is clean.** Local Qt6 `qmllint` (6.12.0) exits **0** on both QML roots with 0 error
  diagnostics.
- **PR #5 added no import and no syntax error** — `git diff master...HEAD -- package/` contains zero
  `import` lines.
- **The runner cannot be fixed by installing packages — for the KDE modules only.** *(corrected 2026-10-17:
  the earlier text dropped that qualification and spoke of "the 6 `org.kde.*` imports"; what is
  unresolvable is five distinct modules — see the addendum.)* `ubuntu-24.04` (noble) *does* offer
  candidates for `qml6-module-qtquick`, `qml6-module-qtquick-controls` and `qml6-module-qtquick-layouts`
  (Qt 6.4.2), but the job installs **none** of them: `qt6-declarative-dev-tools` does not pull them and
  the install line passes `--no-install-recommends`, which is why the QtQuick imports fail on the runner
  too. For the *five* `org.kde.*` modules the two linted roots import — `org.kde.kirigami`,
  `org.kde.plasma.plasmoid`, `org.kde.plasma.plasma5support`, `org.kde.plasma.core` and
  `org.kde.plasma.components` — there is no candidate at all; the apt names probed (`org.kde.kirigami`,
  `libplasma6`, `qml6-module-org-kde-plasma`, `libkf6plasma5support6`) have none. Those imports are
  permanently unresolvable there, so the exit status will be 255 there forever regardless of the corpus.
- **Local injection probes (Qt 6.12.0) define the honest contract:** clean corpus → exit 0, no
  `[syntax]`; an injected `Item { {{{` → exit 255 **and** exactly one `[syntax]` diagnostic
  (`Expected token }' [syntax]`); a nonexistent path → exit 255 **and**
  `Failed to open file … [import]`. The same matrix re-run on the runner's own Qt 6.4.2 — where the
  diagnostics are untagged — is in the addendum, together with what it proved about the first version of
  leg 2.
- `ci.yml` is `pull_request`-only, and `gh run list --branch master` shows no `ci` runs at all — **the
  gate has never been green in this repo's history**.

The gate's own documented contract (`ci.yml` comments,
[../verification/verification-slice.md](../verification/verification-slice.md)) said warnings and infos
are not gating, and that a real defect surfaces as an `Error:` diagnostic **or** a non-zero exit status,
on the premise that "the clean corpus exits 0". That premise was only ever measured on the developer
machine, where Plasma is installed. It is false on the runner, so the gate violated its own documented
contract: it failed a clean corpus.

## Solution

Keep the intent, repair the implementation. The gate now fails a pass on **four legs**:

1. `Error:`-severity diagnostics — unchanged;
2. a parse failure — the `[syntax]` category **or** the parser's untagged message text (`Syntax error`,
   `Expected token`, `Unexpected token`) — new: the file could not parse. *(corrected 2026-10-17: the
   message-text half is not decoration; the runner's Qt prints parse failures with no category at all, so a
   leg anchored on `[syntax]` alone is inert there — see the addendum.)*
3. `Failed to open file` diagnostics — new: the file could not be read;
4. the exit status — **gating only when the pass resolved every import** (no `Failed to import` line),
   because with imports resolved the status measures the code and behaves exactly as the old contract
   promised, while with imports unresolved it measures the environment.

The whole diagnostic stream is still printed in full and never summarised away. The job name `qmllint`
and the three status-check contexts (`test`, `qmllint`, `docs`) are untouched, because
[../verification/verification-slice.md](../verification/verification-slice.md) records that renaming a
job is a branch-protection change.

Two consequences are deliberate and worth stating plainly:

- **The exit status is read conditionally, not ignored.** Leg 4 is not a loosening "for CI to pass": it
  is the half of the old contract whose premise actually holds. On any machine where the imports resolve
  — including a future runner that ships the KDE modules — a non-zero status still fails the pass, so
  the gate keeps measuring the code the moment the environment stops lying.
- **Legs 2 and 3 are the replacements for the part the exit status used to cover.** They name the two
  defects a parse-capable linter reports with a non-zero status *and* a diagnostic, so a real breakage
  is caught on the module-less runner too.

## When to use

Read this record when changing `.github/workflows/ci.yml`'s `qmllint` job, when adding a QML import,
when a PR fails `qmllint` on a clean corpus, or before concluding from a local run that the CI lint
"should be green". It is also the record to read before adding apt packages to the job in the hope of
resolving the KDE imports: no package exists on `ubuntu-24.04` for those modules.

## When not to use

It is not permission to silence the stream: the full log stays printed, and a new diagnostic pattern is
added to the counters, never removed by summarising the output. It is not permission to relax the
`Error:`-severity leg, to set `--max-warnings` (the warning and info counts are in the low hundreds and
version-bound, which the gate deliberately does not treat as evidence), to rename the job, or to add a
fourth status-check context. It is not permission to treat a green local run as proof about the runner:
the two environments differ in exactly the way this record measures.

## Examples

- **`.github/workflows/ci.yml`** — the `qmllint` step counts `errors`, `[syntax]`-or-message-text,
  `Failed to open file` and `Failed to import` per pass, fails the pass on legs 1–3, fails it on leg 4 only
  when the import count is zero, and prints the whole log plus a per-pass summary before deciding.
- **The four counters and their grep shapes** are measured on **both** Qt families (6.12.0 locally, 6.4.2 in
  a real `ubuntu:24.04` container running the package the job installs) and recorded in the workflow
  comments: `file:line:col: error: msg`, a leading `Error: file:…` or the bracketed `[error]`;
  `[syntax]` **or** `Syntax error` / `Expected token` / `Unexpected token`; `Failed to open file`;
  `Failed to import <module>`. The shipped leg-2 line is
  `grep -cE '\[syntax\]|Syntax error|Expected token|Unexpected token' "$log"`.
- **The runner pin** — `qmllint` alone carries `runs-on: ubuntu-24.04` (`test` and `docs` stay on
  `ubuntu-latest`), and the reason is the Qt it resolves. See the addendum before relaxing it.
- **The glob guard** — the step tests the expansion (`if [ "${files[0]}" = "$pattern" ]`) rather than the
  first match, so an unreadable or dangling first match is reported by the open-file leg instead of being
  misreported as "no QML files matched". See the addendum.
- **The evidence trail** named in the record: CI run `39055120672` and CI run `38177079659` for the
  failure signature, the local Qt 6.12.0 injection probes for the honest contract, and the `ubuntu:24.04`
  container table (both Qt families) in the addendum.
- **The docs swept with it.** [../verification/verification-slice.md](../verification/verification-slice.md)
  — the CI row, the "diagnostic stream, never an exit code" convention and the missing known gap;
  [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the verification-tooling note;
  [../verification/troubleshooting.md](../verification/troubleshooting.md) —
  "the CI qmllint check fails on a clean widget", routed from
  [../project.md](../project.md)'s Common Lookups.
- **Ids minted.** `adr-0023-qmllint-gate-contract-correction` (this record).

## Common mistakes

- **Assuming the runner can be made to resolve the KDE imports.** It cannot, with packages that exist:
  no apt candidate exists on `ubuntu-24.04` for the five `org.kde.*` modules this corpus imports, so the
  module-less pass is the permanent case this gate must be honest about. Only the KDE half is unfixable —
  the three QtQuick module packages do have candidates and the job simply does not install them.
- **The residual risk, now measured rather than assumed.** *(corrected 2026-10-17: this bullet used to read
  "6.4.2's labelling of a parse failure is unproven — it is assumed to print `[syntax]`". It is measured
  now, and the assumption was false: see the addendum.)* The runner's Qt 6.4.2 prints a parse failure
  **untagged and with no severity prefix** (`…/FullRepresentation.qml:1730:1: Syntax error`), while 6.12.0
  tags the same failure `Warning: … [syntax]`. Leg 2 therefore anchors on the parser's **message text** as
  well as its category, and the first version of this gate — which grepped only `[syntax]` — was **inert on
  the runner**: a pull request that broke the parse of any of the five `contents/ui/*.qml` files could have
  merged green. The conditional exit-status leg is not the hedge for that (it cannot be: the same pass that
  carries a parse failure also prints failed imports, which keeps the import counter above zero), the
  message-text anchor is.
- **The leg-2 false-positive caveat, stated rather than hidden.** The pattern matches **0** lines of the
  clean stream on both Qt families, and it is case-sensitive on purpose — qmllint echoes the offending
  source line into the same stream, so a case-insensitive single-word sweep fires on identifiers this
  corpus is full of (`paletteTokens`). The residual: if QML source ever carries one of the anchored phrases
  verbatim, leg 2 fires on it — a spurious FAIL, to be fixed by rewording the string, never by weakening
  the leg.
- **Reading "diagnostic stream, not an exit code" as "the exit status is meaningless".** It measured the
  code exactly where the contract said it would; it measured the environment on a runner the contract
  never considered. The correction is conditional, not a discard.
- **Fixing the symptom by making the job non-gating.** `continue-on-error` on the lint would move the
  problem out of sight while the corpus stays unlinted on every PR; the four legs keep the lint gating
  and make it honest.
- **Relaxing the `runs-on` pin without re-measuring.** `ubuntu-latest` migrates to Ubuntu 26 on
  2026-10-19 and would silently swap the Qt under all four legs; the pin exists because this job is the
  only one that reads Qt output. Re-measure all four legs against the new Qt first — the probe that
  matters is injecting a parse failure into a `contents/ui/*.qml` file and confirming the step still exits
  non-zero.
- **Forgetting the branch-protection contract.** The job name is the status-check context; renaming it
  in the same change would silently drop the required check.

## Addendum — 2026-10-17: the runner's Qt measured, and leg 2 re-anchored on the parser's message text

Appended, not substituted: the decision (four legs, the conditional exit status, the untouched job name)
stands. What the addendum changes is the evidence under leg 2 and the two claims in this record the
measurement falsified — the corrections are marked inline above, and this is the measurement they point at.

**The runner, reproduced.** `docker run ubuntu:24.04` plus
`apt-get install --no-install-recommends qt6-declarative-dev-tools` installs `6.4.2+dfsg-4build3` — the
same package the `qmllint` job installs. Measured on that Qt over scratch copies of both QML roots:

- 6.4.2 prints a parse failure **with no severity prefix and no bracketed category**:
  `.../FullRepresentation.qml:1730:1: Syntax error`. The category tag only exists from a later Qt: a clean
  6.4.2 run over this corpus (8,117 + 3,314 lines) carries **zero** bracketed categories of any kind, and
  CI run `39055120672`'s own log accordingly shows no `[syntax]`, no `[import]` and no `[unqualified]` on
  any real diagnostic.
- 6.12.0 prints the same failure tagged: `Warning: .../FullRepresentation.qml:1730:1: Syntax error [syntax]`.
- The consequence, stated plainly: **the first version of this gate was inert on the runner** — its leg 2
  grepped only `[syntax]`, which 6.4.2 never prints, and leg 4 could not cover for it, because the same
  pass that carries a parse failure also prints failed imports, which keeps the import counter above zero
  and disables the exit-status leg. A pull request that broke the parse of any of the five
  `contents/ui/*.qml` files merged green. (The same break in `config/ConfigGeneral.qml` was caught only by
  accident: that pass holds one file, so the parse short-circuits before the imports.)

**The shipped leg-2 pattern, and why each phrase earns its place.**
`grep -cE '\[syntax\]|Syntax error|Expected token|Unexpected token' "$log"`. The category covers the Qt
family that tags; the three phrases cover the family that does not. An eight-input malformed matrix —
unbalanced braces, an unclosed block, an unterminated string, an unterminated import, plain junk, a missing
expression, a missing comma and a top-level handler — measured on **both** families produced
`Expected token` or `Unexpected token` for every input and the phrase `Syntax error` for none, so all three
phrases earn their place: dropping either family's anchor reopens the hole above.

**False-positive safety, measured.** On the clean stream the pattern matches **0** lines on 6.4.2
(8,117 + 3,314 lines) and **0** on 6.12.0 (894 + 128 lines). Case sensitivity is deliberate: qmllint echoes
the offending source line into the same stream, and this corpus is full of identifiers like `paletteTokens`
— a case-insensitive single-word `token|error|syntax` sweep of the clean 6.4.2 log fires **705** times, for
example on `color: paletteTokens.statusCardTop`. Residual caveat, stated rather than hidden: if QML source
ever carries one of those phrases verbatim, leg 2 fires on it — a spurious FAIL, fixed by rewording the
string, never by weakening the leg.

**The `runs-on` pin, and what relaxing it would cost.** Only the `qmllint` job is pinned to
`ubuntu-24.04`; `test` and `docs` stay on `ubuntu-latest`, because neither reads Qt output. This job is the
only one that does, and all four legs key on diagnostic formats measured against the Qt the runner
installs: `ubuntu-latest` migrates to Ubuntu 26 on **2026-10-19**, which would silently swap the Qt and
invalidate every label assumption the four legs rest on. Relaxing the pin therefore requires re-measuring
all four legs against the new Qt first, and the probe that matters is injecting a parse failure into a
`contents/ui/*.qml` file and confirming the step still exits non-zero.

**The container evidence table** (the shipped step reproduced verbatim, both QML roots):

| Injected condition | Result |
|---|---|
| clean corpus | **PASS** — exit 255 from the unresolved imports, no gating diagnostic |
| `Item { {{{` in `FullRepresentation.qml` | **FAIL by leg 2 alone** — one parse failure, 6 failed imports, so leg 4 stays informational |
| `Item { {{{` in `config/ConfigGeneral.qml` | **FAIL** — that pass holds one file, so the parse short-circuits before the imports |
| a dangling symlink sorting first in the glob | **FAIL** via the failed-to-open leg, with the file named |
| a nonexistent path | **FAIL** |

**The glob guard.** The step tests the *expansion* — `if [ "${files[0]}" = "$pattern" ]` — because an
unmatched glob leaves the pattern itself in place, and that is what "this glob matched nothing" actually
means. Testing the first match instead would misreport the case where that match exists but cannot be read:
a dangling symlink or an unreadable file sorting first is a corpus defect for the open-file leg to name
honestly, not a "no QML files matched". The old `no QML files matched` guard would have lied in exactly
that case.

## References

- [[adr-0013-widget-update-check-and-release-site]] — the record that established the three PR status
  contexts (`test`, `qmllint`, `docs`) and the non-gating Playwright stance this record leaves intact.
- [../verification/verification-slice.md](../verification/verification-slice.md) — the evidence layers,
  the CI row this record rewrites, and the difference between a test and a probe.
- [../verification/troubleshooting.md](../verification/troubleshooting.md) — the symptom write-up and
  its routing key in [../project.md](../project.md).
- [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml) — the workflow the four legs live in.
- [[adr-index]] — the hub this record is registered in.
