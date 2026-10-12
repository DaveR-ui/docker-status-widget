---
id: render-preview
category: verification
tags: [probe, preview, qml, render, evidence]
aliases: [Render Preview, Widget Render Harness, Visual Preview]
related: [verification-slice, troubleshooting, widget-slice]
version: 1.0
status: active
---

# Render Preview — seeing the widget when no panel is available

## Problem

`main.qml` is a `PlasmoidItem`, so the widget cannot be instantiated by a bare QML
runtime — the attached-properties factory fails with
`PlasmaQuick::PlasmoidAttached` ([[troubleshooting]]). There is no QML-level
automated test either, so a layout or colour regression in a representation has,
until now, had exactly one proof: a human eyeballing a running Plasma session.
Whether a given environment *can* observe a render is not knowable from the
repository, so the method has to name its own prerequisites instead of assuming
them.

## Solution

Three capture tiers plus one optional viewer, all of which have been exercised on
this project. They are listed by determinism: the first needs no session, no
installed widget and no visible panel; the last ones show the real integration.

**Tier 1 — headless representation preview (deterministic).**
`tools/render_preview.py` loads the *shipped bytes* of
`FullRepresentation.qml` — the real file, resolved from the checkout by
`file://` URL, never a copy — into a Qt6 `Window` harness
(`tools/render_preview.qml`), sets the same properties `main.qml` would push for
a given state (`daemonState`, `containers`, `actionInFlight`, `shutdownPending`,
`updateAvailable`, …), and grabs the window with `grabToImage()`. It renders
fully offline with `QT_QPA_PLATFORM=offscreen`, so it works with no display and
no installed package, and it is re-runnable at will, which a session screenshot
is not. This works **only for `FullRepresentation.qml`**, because that file is a
pure consumer (properties in, signals out). `main.qml` and
`CompactRepresentation.qml` read `Plasmoid.configuration` / are a
`PlasmoidItem` and still need plasmashell.

```sh
python3 tools/render_preview.py                     # all three preview states
python3 tools/render_preview.py --state active      # one state
python3 tools/render_preview.py --platform wayland   # visible window instead of offscreen
```

**Tier 2 — plasmashell-native containment capture.** With a running plasmashell:

```sh
kscreen-doctor -o   # find the screen name, e.g. HDMI-A-1
qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.grabContainmentImage HDMI-A-1 <W> <H> out.png
```

This renders the containment and its applets as plasma draws them — including
real live state and the real theme — and, unlike a screenshot, it is unaffected
by other windows covering the widget (it renders the desktop, not the screen).

**Tier 3 — whole-session screenshot.** `spectacle -b -n -o out.png`
(`-a` active window, `-r` region). The simplest tool, but it also shows every
other window: if a browser covers the widget, tier 2 is the answer.

**Optional — `plasmoidviewer`** (`plasma-sdk` package, when installed):
`plasmoidviewer -a io.github.daver-ui.dockerstatus -f planar` opens the packaged
applet itself in its own window, and `-f horizontal` the panel form factor. This
is the sanctioned way to preview a KPackage without installing it, but it is a
GUI process, not a scriptable grab.

**Prerequisites, per tier:** tier 1 needs Qt6 QML modules (kirigami + plasma
components) and PyQt6 (`python-pyqt6` on Arch, `python3-pyqt6` on Debian/Ubuntu);
tier 2 and 3 need a live KDE Wayland/X11 session with `qdbus6`/`spectacle`;
`plasmoidviewer` needs the `plasma-sdk` package. CI runs none of them — no
runner has a display — so every tier is a **manual probe**, recorded here rather
than promoted to a gate.

## When to use

Reviewing a change to a representation: popup layout, palette tokens, severity
accents, the download row, the shutdown section, the update line. Before/after
pixel comparison of a restyle. Recording what the widget looks like for a
corpus note. Any time the panel is not visible, the widget slot is covered by
another window, or the machine is headless.

## When not to use

Proving *behaviour* — button arming, `DataSource` wiring, countdown timing,
config-page persistence. A render shows pixels, not wiring; those stay on the
unit suite plus review, exactly as [[verification-slice]] records. Also not for
the panel representation in isolation (it reads `Plasmoid.configuration`), and
not as a release gate: nothing here blocks a merge.

## Examples

Measured on this machine (Plasma 6.7.5, Qt 6.12.0, plasmashell live under
`kwin_wayland`, widget installed at version 0.5.0): tier 1 produced
`render_active.png` (daemon online, grouped containers, download row, countdown),
`render_inactive_armed.png` (OFFLINE, armed stop, denied feedback, live
countdown) and `render_unknown_update.png` (muted unknown state, busy
"Starting…", update indicator and its line). Tier 2 grabbed the real installed
desktop widget from behind a covering browser window.
`plasmoidviewer -a io.github.daver-ui.dockerstatus -f planar` opens the packaged
applet in a simulated desktop containment (the full representation, live state
and all); `-f horizontal` shows the panel form factor with the compact
representation. Both were exercised after installing `plasma-sdk`.

## Common mistakes

- Treating a render as a test. It is review-grade evidence about one surface in
  one state — label it a probe, never a gate.
- Forgetting the QPA platform: without `offscreen` (or `--platform`), the harness
  opens a visible window on your desktop and waits for it to settle.
- Committing the output PNGs; they default to `/tmp/dockerstatus-render/` and are
  scratch.
- Expecting `main.qml` or `CompactRepresentation.qml` to load in the harness:
  they are plasmashell-only (the `PlasmaQuick::PlasmoidAttached` symptom is the
  proof, see [[troubleshooting]]).
- Editing files under `package/io.github.daver-ui.dockerstatus/contents/` to
  make a preview "work": the KPackage is the shipped artifact and the harness
  deliberately loads it read-only.

## References

- [[verification-slice]] — the evidence layers this feed does and does not join.
- [[troubleshooting]] — the `PlasmaQuick::PlasmoidAttached` symptom write-up.
- [[widget-slice]] — the QML surfaces under review.
- [../templates/document-template.md](../templates/document-template.md) — the
  note contract this file follows.
