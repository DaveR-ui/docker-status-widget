---
id: adr-0021-download-folder-tooltip-and-open-folder-shortcut
category: adrs
tags: [adr, ui, download, tooltip, folder]
aliases: [ADR-0021]
related: [adr-index, adr-0015-update-indicator-opens-the-release-page, adr-0013-widget-update-check-and-release-site, adr-0006-video-downloader-command-boundary, widget-slice, ui-surfaces, status-slice]
version: 1.0
status: active
supersedes: adr-0015-update-indicator-opens-the-release-page
---

# ADR-0021: The download row gains a configured-folder tooltip and a success-gated open-folder shortcut

## Problem

The human operator asked (verbatim, in Spanish): "Me gustaria que al lado del titulo de youtube or x url,
haya un tooltip con la ruta seteada. UNa vez descargado el archivo aparece una notificacion. Poner sobre
el borde derecho de la notificacion un acceso directo para abrir la carpeta contenedora rapidamente."
Read as behaviour: beside the row's "YouTube or X URL" title, show the configured download folder on
hover; and, once a file has been downloaded, put a shortcut on the right edge of the feedback that a
download produces, which opens the containing folder quickly.

Three recorded constraints decide how that can be built:

1. **"notificacion" is the in-widget download feedback row — a confirmed reading, not a question.** This
   widget raises no system notification, by design: [ADR-0013](adr-0013-widget-update-check-and-release-site.md)'s
   silence contract refuses to nag, and
   [ADR-0015](adr-0015-update-indicator-opens-the-release-page.md) lists "No system notification" among
   the things it explicitly does not add. The surface that reports a finished download is the download
   sub-block's feedback row (`SeverityDot` + label) inside the merged Miscelánea section
   ([[adr-0019-miscelanea-section-merge]]). That row is the notification; the shortcut therefore goes on
   its right edge, and nothing is raised as a desktop notification.
2. **A `PlasmaComponents3.ToolTip` renders only when its parent is an `AbstractButton`.** Verified in the
   installed `org.kde.plasma.components` ToolTip source. The title was a `Label`, so a tooltip hung off it
   would silently never appear: the title has to become a flat, visually-invisible `ToolButton` carrying
   both its text and the ToolTip. That is the same sanctioned pattern the row's Import button already
   uses.
3. **The widget opens exactly one page, from exactly one call site.** ADR-0015 recorded that in blunt
   terms — "one explicit user click, one fixed target, nothing automatic and nothing second" — and
   `tests/dockerstatus.test.mjs` pinned it with an assertion that the `Qt.openUrlExternally` call count is
   exactly `1`. An open-folder shortcut is a second call site. Shipping it quietly would leave ADR-0015
   describing behaviour the widget no longer has, so the reversal is recorded here.

The folder path is configuration, and this project never lets configuration supply a URL — ADR-0013 and
ADR-0015 both restate that rule for the release page. A shortcut that interpolated
`Plasmoid.configuration.downloadDirectory` into a URL string would be exactly the thing that rule forbids.

## Solution

One deliberate, narrowly scoped change, recorded here. This record **supersedes only ADR-0015's
single-call clause** — "The widget must not grow a browser-opening habit. One explicit user click, one
fixed target, nothing automatic and nothing second." and its "Opening a second URL" common-mistake entry.
ADR-0015's constant-URL release-page rule, its `updateAvailable` gate, its `UPDATE_PAGE_URL` constant and
every other clause of it stand. ADR-0015 is not edited: the clause-level reversal is carried here, the
same convention the ADR index already uses for ADR-0006, ADR-0008, ADR-0013 and ADR-0014.

1. **The row's title carries the folder tooltip.** Beside "YouTube or X URL" the row shows the configured
   download directory on hover, expanded (`~/Downloads` → `/home/<user>/Downloads`). Because of the
   `AbstractButton`-parent rule the title is a flat, visually-invisible `ToolButton` — no border, no
   background, zeroed padding and no tab focus — carrying both the ToolTip and the label
   text; it is not a `Label` with a ToolTip child. The button deliberately keeps the label's implicit
   width rather than `Layout.fillWidth`: a filled `TextOnly` ToolButton centres its label, and the
   mockup keeps the title left-aligned. The tooltip text arrives as a property; the
   representation still reads no configuration.
2. **The shortcut is a flat icon-only `ToolButton` on the right edge of the feedback row.** Icon
   `folder-open`, no text, muted glyph — the same small-flat-control idiom the container group play/stop
   buttons and the status-card buttons use. It is visible **only** after a successful download (severity
   `positive`): it rides the row a finished download produces, and a failed download — or a refused paste
   — never offers it.
3. **The second call is not a browser target.** `Qt.openUrlExternally(folderUrl)` hands a `file://` URL to
   the desktop, which resolves it to the file manager. No browser is involved and nothing is fetched, so
   the widget still talks to the network exactly as much as ADR-0013 described: one fixed https manifest
   and nothing else.
4. **The URL is built, never interpolated from a configured string.** Two new pure helpers live in
   `dockerstatus.js` (the status slice), ES5 and side-effect-free:
   `formatDownloadDirectory(configured, home)` returns the display form and `""` while `$HOME` is unknown;
   `buildFolderUrl(directory, home)` returns the `file://` URL with **per-segment** percent-encoding —
   `encodeURIComponent()` per segment, because a global `encodeURIComponent()` would escape the `"/"`
   separators too and `encodeURI()` leaves `#` and `?` dangerous — and `""` when the resolved path is not
   absolute. Both resolve through the existing `resolveDownloadDirectory()`, so the empty/garbage fallback
   to `$HOME/Downloads`, the `~` expansion and the control-character refusal stay the one already-tested
   code path. No configured host, no configured scheme, no configured URL: the value configured is a
   directory, and the widget turns it into a URL itself.
5. **`main.qml` remains the only configuration reader.** It gains two `readonly` properties —
   `downloadDirectoryDisplay` and `downloadFolderUrl` — and forwards them to the full representation,
   which reads no configuration and builds no URL, per the standing representation convention. An empty
   `downloadFolderUrl` is what happens while `$HOME` is unknown, so the shortcut stays disabled instead of
   handing the desktop a bogus URL.
6. **The gates on the second call site, stated so nobody widens them.** An explicit user click only;
   gated on download success; no automatic open, no open on load, no open after a failure, no
   configuration-supplied host, no second browser target. The update indicator's call is untouched and
   still opens exactly `DockerStatus.UPDATE_PAGE_URL` on exactly the `updateAvailable` gate.
7. **The call-count assertion is amended, not loosened.** `tests/dockerstatus.test.mjs` moves from
   `count == 1` to a strict `count == 2`, pinning **both** exact call-site strings — the indicator's
   `onClicked: Qt.openUrlExternally(DockerStatus.UPDATE_PAGE_URL)` and the folder button's
   `onClicked: Qt.openUrlExternally(fullRoot.downloadFolderUrl)`. That strictness is the mechanism: a
   third call site **in the popup** cannot appear without failing the suite, and `openUrlExternally`
   called there from anywhere but these two exact expressions fails it too. The scan covers the
   representation, which is where both call sites live; a call minted in `main.qml` or the config page
   would need the same pin extended, exactly as the old single-call assertion was scoped.
8. **What is NOT touched.** ADR-0013's silence contract and its "no notification, no error text" framing;
   ADR-0015's constant-URL rule for the release page and its refusal of a configurable URL; the
   video-download command boundary ([[adr-0006-video-downloader-command-boundary]]) — the folder is a
   display value and a desktop URL, never a shell argument, and no command string changes; the
   severity-to-colour rule (`SeverityDot` stays the only mapping, and the shortcut's visibility reads the
   existing `downloadFeedbackSeverity`); the pinned popup column
   ([[adr-0020-footer-removal-and-pinned-popup-layout]]) and the merged Miscelánea section
   ([[adr-0019-miscelanea-section-merge]]); every kcfg entry, `cfg_*` alias and config control. No new
   setting is added, and the tooltip claims no directory it cannot compute.

## When to use

Read this record when touching the download row's tooltip or its open-folder button, either of the two
`Qt.openUrlExternally` call sites, `formatDownloadDirectory` / `buildFolderUrl` and the
`downloadDirectoryDisplay` / `downloadFolderUrl` forwarding, or any question about how many browser-opening
calls the widget has and what gates them.

## When not to use

This is not permission to open a third URL, in a browser or otherwise, nor to open the folder without a
click, nor to offer the shortcut before a download has succeeded. It is not permission to take a URL — or
a host, or a scheme — from configuration, or to interpolate a configured string into a URL: the folder URL
is built per-segment by a pure, unit-tested helper. It is not permission to raise a system notification
for a finished download: that would reverse ADR-0013's silence contract, which this record leaves in
force. It is not permission to loosen the call-count pin back to "one URL anywhere" or to a range. And it
is not a licence to rewrite ADR-0015: exactly one of its clauses is superseded, and its constant-URL rule
still governs the release page.

## Examples

- **`dockerstatus.js`** — gains `formatDownloadDirectory(configured, home)` (the display form, `""` while
  `$HOME` is unknown) and `buildFolderUrl(directory, home)` (the `file://` URL, per-segment
  percent-encoded, `""` when the resolved path is not absolute). Both resolve through the retained
  `resolveDownloadDirectory()`, so the fallback and the `~` expansion are the same tested path the command
  builder uses.
- **`FullRepresentation.qml`** — the "YouTube or X URL" title becomes a flat, visually-invisible
  `ToolButton` carrying the `PlasmaComponents3.ToolTip` with the expanded configured folder; the download
  feedback row gains a flat icon-only `folder-open` `ToolButton` on its right edge, visible only on a
  positive severity, whose click calls `Qt.openUrlExternally(fullRoot.downloadFolderUrl)` — the widget's
  second call site and its first non-browser target.
- **`main.qml`** — gains the two `readonly` properties `downloadDirectoryDisplay` and
  `downloadFolderUrl`, forwarded to the full representation; the representation still reads no
  configuration.
- **`tests/dockerstatus.test.mjs`** — the update-indicator pin is amended from `count == 1` to a strict
  `count == 2` naming both exact call-site strings, and the two helpers gain unit tests: the display form
  expands `~/Downloads`, the URL percent-encodes a directory name containing a space and a `#`, and both
  return `""` while `$HOME` is unknown.
- **Registered in the live docs.** [../widget/widget-slice.md](../widget/widget-slice.md) and
  [../widget/ui-surfaces.md](../widget/ui-surfaces.md) carry the new surface facts, and
  [adr-index.md](adr-index.md) lists this record.
- **Ids minted.** `adr-0021-download-folder-tooltip-and-open-folder-shortcut` (this record).

## Common mistakes

- **Hanging the ToolTip off a `Label`.** A `PlasmaComponents3.ToolTip` renders only when its parent is an
  `AbstractButton`, so a tooltip on a `Label` silently never appears; the title must be the flat,
  visually-invisible `ToolButton` the row's Import button already demonstrates.
- **Offering the shortcut on a failed download.** The button is success-gated (severity `positive`); after
  a failure there is no folder to open, and a dead shortcut reads as a broken widget rather than as a
  refusal.
- **Making the folder URL a browser URL, or a raw configured string.** It is a `file://` URL assembled
  per-segment from the configured directory by a pure, tested builder — never an http/https host, never a
  configured string interpolated into a URL, and never a browser target.
- **Loosening the call-count assertion.** The pin is a strict `count == 2` naming both exact call sites;
  "at least one", "1 or 2" or a regex over any `openUrlExternally(` call is exactly the drift the pin
  exists to stop.
- **Reading the ask as a system notification.** The widget raises none by design (ADR-0013); the
  "notificacion" is the in-widget feedback row, and a real desktop notification would reverse a
  still-standing clause.
- **Editing ADR-0015.** Only its single-call clause is superseded; the record is append-only, and the
  reversal lives here.

## References

- [[adr-0015-update-indicator-opens-the-release-page]] — the record whose single-call clause this one
  supersedes; its constant-URL rule, its `updateAvailable` gate and the silence framing it borrows from
  ADR-0013 all still stand.
- [[adr-0013-widget-update-check-and-release-site]] — the silence contract and the "no URL from
  configuration" rule this record keeps in force; the widget's network surface is unchanged by it.
- [[adr-0006-video-downloader-command-boundary]] — the command boundary the shortcut does not move: the
  folder is a display value and a desktop URL, never a shell argument.
- [[adr-0019-miscelanea-section-merge]] — the merged Miscelánea section whose download sub-block holds the
  feedback row the shortcut rides on.
- [[adr-0020-footer-removal-and-pinned-popup-layout]] — the pinned column whose regions stay as they are.
- [../widget/widget-slice.md](../widget/widget-slice.md) — the slice that owns the row, the tooltip and
  the new forwarding.
- [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the inventory this record updates.
- [../status/status-slice.md](../status/status-slice.md) — the pure helpers the folder URL lives in.
- [[adr-index]] — the hub this record is registered in.
