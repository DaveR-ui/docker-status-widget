---
id: adr-0019-miscelanea-section-merge
category: adrs
tags: [adr, ui, sections]
aliases: [ADR-0019]
related: [adr-index, adr-0009-widget-owned-shutdown-countdown, adr-0010-inline-shutdown-minutes-in-the-representation, adr-0011-fixed-dark-palette-from-mockup, adr-0016-containers-flat-rows-and-podman-section-removal, adr-0017-podman-launch-button-and-topbar-removal, widget-slice, ui-surfaces]
version: 1.0
status: active
---

# ADR-0019: The video-download and countdown blocks merge into one Miscelánea section

## Problem

The human operator asked to combine the video-download surface and the "Countdown to Extinction" surface
into one popup section named "Miscelánea" (accented Spanish). At the time the popup carried them as two
separate collapsible cards, each with its own header, its own collapse flag and its own caret.

Two recorded constraints make that a design decision rather than a quiet restyle:

1. [../widget/ui-surfaces.md](../widget/ui-surfaces.md) closes its selection guide with "There is no other
   surface. A new one is a design decision, not an implementation detail." Merging two existing surfaces
   into one, renaming it and re-nesting its content changes the popup's surface inventory, so it must be
   recorded here, not slipped in.
2. [ADR-0009](adr-0009-widget-owned-shutdown-countdown.md) lists "the visible countdown and the cancel
   button" among the safeguards that let the power-off run without a password prompt. The countdown card
   therefore had to stay un-collapsible while a shutdown is armed; a single section-level collapse flag
   over both blocks could otherwise hide an armed, destructive state behind a caret.

The config page carried the same two cards and was asked to merge them the same way.

## Solution

One deliberate, narrowly scoped change, recorded here. The merge **supersedes nothing**: ADR-0009's
safeguard is preserved, and ADR-0016 and ADR-0017 are untouched.

1. **One collapsible parent section, two inner titles.** The popup gets one collapsible card titled
   `i18n("Miscelánea")` (accented). Both blocks nest inside it under a **single** toggle. Each block keeps
   its own inner title, so the two stay legible inside the one card: `i18n("Import content")` (the
   video-download block) and `i18n("Countdown to Extinction")` (the shutdown block, with its 35x35 "◷"
   timer tile moved inside the body beside that inner title).
2. **One flag replaces two.** `property bool downloadSectionExpanded` and
   `property bool countdownSectionExpanded` are deleted. One flag replaces them:
   `property bool miscSectionExpanded: true` — local view state, **not** persisted, **not** a signal,
   default true, assigned **exactly once** by the merged header's `MouseArea`
   (`onClicked: fullRoot.miscSectionExpanded = !fullRoot.miscSectionExpanded`).
3. **One derived gate replaces the old countdown gate.**
   `readonly property bool countdownBodyVisible: fullRoot.countdownSectionExpanded || fullRoot.shutdownPending`
   is replaced by
   `readonly property bool miscBodyVisible: fullRoot.miscSectionExpanded || fullRoot.shutdownPending` — the
   same ADR-0009 semantics: while a shutdown is pending the merged body comes back whatever the section
   bool says, so an **armed destructive state can never be collapsed away**. The header's +/- glyph pair
   reads `miscBodyVisible` (not the raw bool), so the affordance never lies — a minus next to hidden
   controls would read as "collapse the countdown away".
4. **The gate decision, and its rationale.** One derived gate over the whole merged body — rather than a
   per-sub-block gate — preserves ADR-0009's un-collapsible armed countdown and makes a **half-open
   section structurally impossible**: there is no state in which the header says collapsed while one of
   its two sub-blocks is showing. The documented cost: an armed countdown also brings the download row
   back into view. That is assessed as harmless — the download row is not destructive and is already gated
   on `downloaderEnabled`. An independent second-opinion pass (analyst) was taken on the gate shape and
   returned `proceed`, confidence 0.85.
5. **The live pending line stays ungated.** The muted "Powering off in %1" line keeps
   `visible: fullRoot.shutdownPending` and nothing else, so it survives even if the section bool were
   collapsed while a shutdown is pending.
6. **The download sub-block keeps its own setting gate.** The old card-level `downloaderEnabled` gate
   moves onto the download sub-block (`visible: fullRoot.downloaderEnabled`): its inner title, the
   unchanged YouTube/X URL label, the `videoUrlField` + `downloadButton` + BusyIndicator row, the cookies
   line, the unsupported-paste line, the SeverityDot feedback row and a **trailing 1px hairline** all
   disappear together when the setting is off. The hairline is the sub-block's LAST child, so it never
   leaves a dangling rule.
7. **The countdown sub-block is otherwise unchanged.** Below its inner title and timer tile sit the
   unchanged minutes row (`shutdownMinutesField` with its seed / `onTextChanged` / `onActiveFocusChanged`
   handlers), the play/cancel row, the pending line, the invalid-value cue and the SeverityDot feedback
   row — every tuned margin and every id preserved.
8. **The merged card's structure.** A marker comment `// --- Miscelanea section ---` opens one card: a
   header row (`id: miscHeaderRow`, in a plain `Item` carrying 16px `Layout` side insets, a `RowLayout`
   with `spacing: 12` and only 12px anchor top/bottom margins) whose whole strip is the tap target, a 1px
   separator, then ONE body `ColumnLayout` (`Layout.margins: 16`, `spacing: 8`,
   `visible: fullRoot.miscBodyVisible`) holding the two sub-blocks.
9. **The config page merges its two cards too.** "Video download" and "Shutdown countdown" become one card
   titled `i18n("Miscelánea")`, position unchanged (after Podman Desktop, before Updates), body id
   `miscBody`, subtitle "Where yt-dlp fetches a pasted link, and how long the shutdown countdown runs.",
   and ONE nested `Kirigami.FormLayout` carrying all seven controls in their original order:
   `showVideoDownloader`, `downloadDirectory`, `jsRuntime`, `ytDlpBinary`, `cookiesBrowser` (its `seeded`
   flag, `Component.onCompleted` seed and `onActivated` / `onEditTextChanged` push-back copied verbatim),
   `shutdownCountdownMinutes`, and the invalid-value cue. No kcfg entry, `cfg_*` alias, control id or
   tooltip changed. The page now has **six** section cards: Docker, Container list, Podman Desktop,
   Miscelánea, Updates, Appearance.
10. **What is NOT touched.** `main.qml`, `dockerstatus.js`, `contents/config/main.xml` (the kcfg entries)
    and every signal/property name are unchanged. The download command boundary, the shutdown resolver,
    the containers list, the compact representation, the tooltip and the contextual actions are all
    untouched. The popup is still a pure consumer and the collapse state still never crosses the property
    boundary: the merge keeps every shell, kcfg and command boundary where it was.

## When to use

Read this record when touching the popup's collapsible sections, the Miscelánea header or its +/- toggle,
the placement of the download row, the countdown section, or the config page's card grouping and order.

## When not to use

This is not permission to re-split the section into two cards, to add a second toggle or a per-sub-block
collapse flag, or to reintroduce `downloadSectionExpanded` / `countdownSectionExpanded`. It is not
permission to gate the armed countdown behind the section bool — ADR-0009's visible-countdown safeguard
stands and `miscBodyVisible` exists to honour it. It is not permission to persist or signal the collapse
state: `miscSectionExpanded` stays local view state that never reaches `main.qml`. And it changes no kcfg
entry, no command and no boundary: the download command and the shutdown resolver are untouched.

## Examples

- **`FullRepresentation.qml`** — the two collapsible cards are replaced by one merged "Miscelánea" card;
  `downloadSectionExpanded` and `countdownSectionExpanded` are deleted for `miscSectionExpanded`, and
  `countdownBodyVisible` for `miscBodyVisible`; the download sub-block absorbs the `downloaderEnabled`
  gate and gains a trailing hairline; the countdown sub-block keeps its inner title and moves its 35x35
  timer tile inside the body. `// --- Miscelanea section` is the marker comment the tests key on:
  unaccented (ASCII) on purpose, unlike the accented visible title `i18n("Miscelánea")`, because the Node
  suite anchors two region boundaries on that exact ASCII string — "fixing" the accent in the comment would
  silently break those anchors.
- **`ConfigGeneral.qml`** — the two section cards become one "Miscelánea" card with one nested
  `Kirigami.FormLayout` and the seven controls in their original order; six section cards remain.
- **`tests/dockerstatus.test.mjs`** — the static-text pins are retargeted to the merged structure
  (`COLLAPSIBLE_SECTIONS` is one entry; the +/- glyph pair count 3 → 2, token reads 6 → 4, halos 3 → 2;
  the two region boundaries that used `// --- Video download section` now use
  `// --- Miscelanea section`), plus new pins that the merged title is present and that no orphaned state
  survives (`downloadSectionExpanded`, `countdownSectionExpanded`, `countdownBodyVisible` must not appear
  anywhere in the file).
- **Measured evidence.** `qmllint` Qt5 (syntax) is clean before and after. `qmllint` Qt6 6.12.0
  (semantic): `contents/ui/*.qml` 0 errors / 140 `[unqualified]` / 89 infos (2 `[unused-imports]`);
  `contents/ui/config/*.qml` 0 errors / 38 `[unqualified]` / 5 infos; across the six files 0 errors,
  178 warnings, 94 infos — one warning below ADR-0017's 179. The Node suite is 166/166 before and after.
  The headless render harness (`QT_QPA_PLATFORM=offscreen python3 tools/render_preview.py`) is clean and
  produced `render_active.png` (both blocks inside Miscelánea), `render_inactive_armed.png` (armed
  countdown: "Shutting down…", Cancel enabled, "Powering off in 12:34") and `render_unknown_update.png`
  (`previewDownloaderEnabled=False`: Miscelánea contains ONLY the countdown, no dangling hairline).
- **Ids minted.** `adr-0019-miscelanea-section-merge` (this record).

## Common mistakes

- **Gating the armed countdown behind the section bool.** The merged body must come back while
  `shutdownPending`, or ADR-0009's visible-countdown safeguard is broken. That is what
  `miscBodyVisible` is for; do not read `miscSectionExpanded` directly where the body is gated.
- **Reading the raw section bool in the +/- glyph.** The affordance must describe what the user can
  actually see, so both the glyph and the drill-down gates read `miscBodyVisible`.
- **Leaving the old flags or the old gate in place.** `downloadSectionExpanded`,
  `countdownSectionExpanded` and `countdownBodyVisible` are gone; a half-migrated merge has dead state.
- **Leaving the download hairline behind when the downloader is off.** It must stay the download
  sub-block's last child so it disappears with the block.
- **Persisting or signalling the collapse state.** It is local view state only; the popup stays a pure
  consumer and `main.qml` remains the single owner of every shell and kcfg boundary.
- **Re-splitting the config card, or reordering its controls.** The seven controls keep their original
  order inside one nested `Kirigami.FormLayout`; the card keeps its place (after Podman Desktop, before
  Updates).
- **Assuming the merge changes a command, a kcfg entry or a signal.** It changes only where two blocks are
  grouped in the UI; every boundary and every identifier is unchanged.

## References

- [[adr-0009-widget-owned-shutdown-countdown]] — its visible-countdown safeguard is the constraint the
  merged gate preserves; nothing in it is superseded.
- [[adr-0010-inline-shutdown-minutes-in-the-representation]] — the inline minutes field carried unchanged
  inside the countdown sub-block.
- [[adr-0011-fixed-dark-palette-from-mockup]] — the palette and SeverityDot rules the merge must not
  disturb.
- [[adr-0016-containers-flat-rows-and-podman-section-removal]] — the flat-rows idiom whose +/- affordance
  the merged header copies; untouched by this record.
- [[adr-0017-podman-launch-button-and-topbar-removal]] — the record whose measured 179-warning baseline
  this merge moves to 178; untouched by this record.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the inventory this record updates.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the slice that owns the merged state.
- [[adr-index]] — the hub this record is registered in.
