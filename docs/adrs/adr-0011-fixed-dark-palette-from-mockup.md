---
id: adr-0011-fixed-dark-palette-from-mockup
category: adrs
tags: [adr, ui, qml, theming]
aliases: [ADR-0011]
related: [adr-index, adr-0003-slice-taxonomy, adr-0006-video-downloader-command-boundary, adr-0008-configurable-cookies-browser-and-bottom-text, adr-0009-widget-owned-shutdown-countdown, adr-0010-inline-shutdown-minutes-in-the-representation, widget-slice, ui-surfaces, status-slice]
version: 1.0
status: active
---

# ADR-0011: The widget paints the mockup's fixed dark palette

## Problem

Every colour in this widget used to come from the Kirigami theme. The corpus stated the rule in
[ui-surfaces](../widget/ui-surfaces.md) ("Style tokens" → Colour): a healthy daemon, a stopped daemon, a
failure and an unknown state each resolved to a `Kirigami.Theme.*TextColor`, so the widget followed the
system colour scheme, and [SeverityDot](../widget/ui-surfaces.md) was the one place a severity became one
of those theme colours. The rule had a real virtue — the widget always matched the user's desktop — and it
made the widget's look a function of somebody else's palette.

The human operator then asked for the look of an external design mockup, verbatim: its fixed dark
surfaces, its fixed accents and the Inter typeface. A theme-following widget cannot reproduce a fixed
palette; the two are mutually exclusive. The choice therefore could not be made by quiet edits. Overriding
a stated rule is a decision, and this corpus records decisions as ADRs, not as drift. The mockup itself is
a visual reference that lives outside this repository; it is not bundled, copied or imported. It was
translated into tokens by hand, once.

## Solution

One deliberate, human-operator decision, recorded here: the widget paints the mockup's fixed dark palette
and its pixel type scale instead of following the Kirigami theme.

1. **The palette is a component, and it is neutral chrome.** The new `DockerStatusPalette.qml` is a
   `QtObject` holding the mockup's fixed surfaces, lines, text, controls and radii, plus its type scale
   (Inter at 14 / 19 / 26 / 13 / 12 / 11 / 10 px). Every value is a `readonly` constant. It carries no
   severity: it is chrome and metrics only.
2. **The severity switch stays in `SeverityDot.qml`, and only there.** Severity is still computed in
   `dockerstatus.js`; `SeverityDot.qml` still resolves it, now against the palette — positive → green
   `#55d69e`, negative → red `#ff737d`, neutral → orange `#ffad5c`, muted → grey `#9aa9b1` — instead of
   the four `Kirigami.Theme.*TextColor` tokens. Every surface reads `SeverityDot.severityColor`; no
   surface maps a state to a colour itself.
3. **What this supersedes, and what it does not.** This reverses the **colour half** of the
   [ui-surfaces](../widget/ui-surfaces.md) rule: the theme-colour token table is replaced by the mockup
   palette. It does **not** touch the mapping-locus half of that same rule: severity is still decided in
   `dockerstatus.js` and still resolved to a colour in `SeverityDot.qml` and nowhere else. A second
   severity-to-colour mapping is still forbidden.
4. **The popup paints its own card.** `Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground` switches
   Plasma's own frame off, and the full representation's root paints one dark 20px-radius card behind its
   content. `contents/config/main.xml` carries no background entry, so dropping the configurable
   background removes no user-facing setting. The config page keeps Plasma's chrome and does not switch it
   off.
5. **The action buttons become equal width.** Start and stop both take `Layout.fillWidth: true` and share
   the row equally. This supersedes ADR-0008's narrow-stop clause, which pinned stop to
   `Kirigami.Units.gridUnit * 7` with `Layout.fillWidth: false`. The row still cannot reflow between
   "Stop daemon" and "Confirm stop", because both buttons fill and only their labels change.
6. **The panel's theme icon still follows the theme, on purpose.** `Plasmoid.configuration.iconName` is a
   theme icon name resolved by the active theme, not a palette token. The compact representation is
   restyled only through the shared tokens; its icon is deliberately left to the user's theme.

The invariants that do **not** change:

7. **`unknown` still renders muted, never neutral.** The `default:` branch of `SeverityDot.qml` resolves to
   the muted grey on purpose, so a broken probe never reads as merely stopped.
8. **Every command stays a fixed constant, and no config path supplies a command.** This is a styling
   decision; the fixed-command rule and the single video-download exception
   ([[adr-0006-video-downloader-command-boundary]]) are untouched.

## When to use

Read this when changing a colour, the type scale, `DockerStatusPalette.qml` or `SeverityDot.qml`; when
touching the popup card or `Plasmoid.backgroundHints`; or when a reader cites the old "every colour comes
from the theme" rule.

## When not to use

Do not read it as licence to map a state to a colour outside `SeverityDot.qml`, or to have a surface
resolve a severity against the palette at a call site. Do not read it as permission to widen the command
boundary: the palette is decoration, not a data channel. Do not "restore" the theme-following rule for
consistency without a successor record — the override is the decision.

## Examples

Files that carry the decision: `DockerStatusPalette.qml` holds the tokens; `SeverityDot.qml` holds the one
severity switch; `FullRepresentation.qml` paints the card and reads `statusDot.severityColor` for the
header dot, the status pill, the running-count progress fill and the footer dot; `main.qml` sets
`Plasmoid.backgroundHints`; `config/ConfigGeneral.qml` reads the palette and imports the parent directory
(`import ".."`) so the `QtObject` resolves from `ui/`.

Evidence: the palette is a plain `QtObject` of constants, so `qmllint` proves every reference resolves;
the severity mapping is pinned as text by the Node suite, exactly as before.

## Common mistakes

- **Reading the override as drift and "fixing" it back.** The widget no longer follows the system colour
  scheme, and that is the point. Re-adding a theme colour is a reversal and needs a successor record.
- **Mapping severity in a surface.** The pill, the progress fill and the footer dot all read the header
  dot's `severityColor`; none of them computes a colour. A second mapping is still forbidden.
- **Assuming `unknown` now reads as neutral.** Neutral is the orange accent; unknown stays muted grey.
- **Assuming the config page lost Plasma's chrome.** It did not: it is a normal settings page, and only
  the popup switches the background off.
- **Assuming the narrow-stop width still holds.** It does not; the buttons are equal width now, and the
  no-reflow property comes from both filling, not from a pinned width.
- **Assuming the panel icon follows the palette.** It follows the theme, on purpose.

## References

- [adr-0003-slice-taxonomy](adr-0003-slice-taxonomy.md) — the slice map this restyle stays inside.
- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the one
  command-building exception, untouched by a styling change.
- [adr-0008-configurable-cookies-browser-and-bottom-text](adr-0008-configurable-cookies-browser-and-bottom-text.md)
  — its fixed narrow-stop clause is the one clause superseded here.
- [adr-0009-widget-owned-shutdown-countdown](adr-0009-widget-owned-shutdown-countdown.md) and
  [adr-0010-inline-shutdown-minutes-in-the-representation](adr-0010-inline-shutdown-minutes-in-the-representation.md)
  — the shutdown section this restyle only re-skins.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the Style tokens table and the per-surface
  inventory this record amends.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the severity-to-colour convention.
- [../status/status-slice.md](../status/status-slice.md) — where severity is actually computed.
