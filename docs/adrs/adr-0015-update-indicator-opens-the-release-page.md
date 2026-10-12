---
id: adr-0015-update-indicator-opens-the-release-page
category: adrs
tags: [adr, update-check, network, ui]
aliases: [ADR-0015]
related: [adr-index, adr-0013-widget-update-check-and-release-site, adr-0011-fixed-dark-palette-from-mockup, status-slice, widget-slice, ui-surfaces, data-engine-contract]
version: 1.0
status: active
supersedes: adr-0013-widget-update-check-and-release-site
---

# ADR-0015: The outdated-update indicator opens the release page

## Problem

[ADR-0013](adr-0013-widget-update-check-and-release-site.md) deliberately made the update
notice a muted line that is **not a link**, on the stated grounds that "the widget opens no
browser". The line names the available version and stops there: the user reads it and goes to the
repository themselves. That was a recorded, reasoned choice, not an oversight.

The human operator then asked for the opposite affordance: an exclamation-mark icon beside the
daemon status while the widget is out of date, whose click opens the widget's GitHub Pages page —
a one-click path from "your build is stale" to "here is the new one". That reverses a clause
ADR-0013 wrote down on purpose. A quiet exemption inside the feature would leave ADR-0013
describing behaviour the widget no longer has, and would falsify the corpus; the reversal is
therefore recorded here, as a successor carrying `supersedes`, rather than edited into the
original.

The forces that shaped the solution:

- **The silence contract must not weaken.** ADR-0013's whole point is that a check the user did
  not ask for never nags; a clickable target may therefore exist only when an update genuinely
  exists, on the same gate the muted line already uses.
- **The URL must be a fixed constant**, exactly as `UPDATE_CHECK_URL` is — never configuration,
  never interpolated, never assembled from a value.
- **The widget must not grow a browser-opening habit.** One explicit user click, one fixed
  target, nothing automatic and nothing second.
- **The target is the Pages site root**, deliberately, not the repository page: the site is the
  release's front door and the repository is not.

## Solution

One deliberate, narrowly scoped reversal, recorded here. ADR-0013 is not edited: this record
supersedes exactly one of its clauses, and the rest of it still governs.

1. **The reversal is scoped, not wholesale.** Only ADR-0013's "the notice is deliberately … not a
   link" / "a link would mean the widget opening a browser — which this widget does not do" clause
   is superseded. The silence contract, the one fixed https fetch, the constant-URL rule, the
   numeric **strictly-greater** comparison, the three-status-check CI gate and every other clause
   of ADR-0013 stand unchanged. This is the same partial-reversal shape as
   [[adr-0008-configurable-cookies-browser-and-bottom-text]], which supersedes one clause of a
   predecessor while its own prose says the rest still stands.
2. **The indicator.** It is a small flat `ToolButton` carrying the theme's `emblem-important`
   icon, placed in the status card beside the daemon state and visible **only** while
   `updateAvailable` — the same gate the muted version line already has, so an offline machine, a
   missing `curl` or an unparseable manifest renders nothing at all. Its colour is the theme's
   functional attention colour (`Kirigami.Theme.negativeTextColor`), not a severity accent and not
   a palette hex: the SeverityDot rule (severity resolves only in `SeverityDot.qml`, and the fixed
   palette lives there) is untouched.
3. **The click target.** The button opens the new fixed constant `UPDATE_PAGE_URL` =
   `https://dave-r-ui.github.io/docker-status-widget/`, defined in `dockerstatus.js` and opened
   through `Qt.openUrlExternally(DockerStatus.UPDATE_PAGE_URL)`. This is the widget's only
   browser-opening call: one explicit user click, no configuration, no interpolated text. The
   constant exists for the same reason `UPDATE_CHECK_URL` does — a misconfiguration cannot point
   the widget at another host.
4. **What is explicitly NOT added.** No system notification; no automatic open; no configurable
   URL; no second link target. The muted version line stays exactly as ADR-0013 described it: it
   remains, it names the available version, and it stays non-clickable. The indicator is an
   **addition** beside the line, not a replacement for it.
5. **The Node suite pins the arrangement.** `tests/dockerstatus.test.mjs` pins the
   `UPDATE_PAGE_URL` constant, the single `Qt.openUrlExternally` call site, and the shared
   `updateAvailable` visibility gate — so the browser-opening surface cannot silently multiply or
   drift onto a different gate.

## When to use

Read this record when touching the update indicator, the `UPDATE_PAGE_URL` constant, the
`Qt.openUrlExternally` call, or anything about the widget's relationship to the release site.

## When not to use

This is not permission to open any other URL, to open one **without** a click, to take a URL from
configuration, to notify the user, or to weaken the silence contract in any way. It is not a slice
decision: `site/` still has no Slices-table row (per ADR-0013). Do not edit this record to widen
it — supersede it.

## Examples

- **Files touched.** `package/io.github.daver-ui.dockerstatus/contents/ui/dockerstatus.js` gains
  `UPDATE_PAGE_URL`; `FullRepresentation.qml` gains the indicator beside the daemon status in the
  status card; `tests/dockerstatus.test.mjs` pins the constant, the single call site and the
  shared visibility gate.
- **Ids minted.** `adr-0015-update-indicator-opens-the-release-page` (this record).

## Common mistakes

- **Turning the icon into a notification.** The ask was a click target, not an interruption; a
  system notification would reverse a different, still-standing clause.
- **Making the URL configurable.** The URL is a constant so a misconfiguration cannot point the
  widget elsewhere; a settings field for it reintroduces exactly the risk the constant avoids.
- **Colouring it with a severity accent.** That would be a second severity-to-colour mapping and
  would undermine the SeverityDot rule; the colour is the theme's functional attention colour.
- **Opening a second URL.** The widget opens exactly one page, from exactly one call site, on
  exactly one click.
- **Showing the icon when no update exists.** The gate is `updateAvailable` and nothing else — the
  same gate the muted line uses, so the silence contract is preserved.

## References

- [[adr-0013-widget-update-check-and-release-site]] — the record whose "not a link" clause this one
  supersedes; the silence contract and the fixed-URL rule it leaves in force.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the fixed palette and SeverityDot rule the
  indicator's colour must not disturb.
- [../status/status-slice.md](../status/status-slice.md) — the constants and pure helpers the
  widget's logic lives in.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the popup surfaces the indicator sits
  among.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — which UI surface a change belongs to.
- [../status/data-engine-contract.md](../status/data-engine-contract.md) — the data-source contract
  the update check rides on.
- [[adr-index]] — the hub this record is registered in.
