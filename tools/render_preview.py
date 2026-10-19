#!/usr/bin/env python3
"""Render the shipped Docker Status full representation and save PNGs.

Loads package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml
by file:// URL (no copy; the KPackage is never touched) inside
tools/render_preview.qml, injects preview state as QML context properties, then
grabs the window with grabToImage() -- an offline render that does not need the
widget to be installed, a session to be running, or the panel to be visible.

Usage:
    python3 tools/render_preview.py                 # all three states, offscreen
    python3 tools/render_preview.py --state active  # one state
    python3 tools/render_preview.py --platform wayland --out ./shots
    QT_QPA_PLATFORM=offscreen python3 tools/render_preview.py

Prerequisites: Qt 6 QML modules (kirigami + plasma components) and PyQt6
(Debian/Ubuntu: python3-pyqt6; Arch: python-pyqt6). No package.json, no npm.

See docs/verification/render-preview.md for what this proves and what it cannot
(CompactRepresentation and main.qml stay plasmashell-only).
"""

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
REPRESENTATION = REPO_ROOT / "package" / "io.github.daver-ui.dockerstatus" / "contents" / "ui" / "FullRepresentation.qml"
HARNESS = Path(__file__).resolve().parent / "render_preview.qml"
DEFAULT_OUT = Path("/tmp/dockerstatus-render")

ACTIVE_CONTAINERS = [
    {"name": "web-1", "state": "running", "project": "daver"},
    {"name": "postgres-1", "state": "running", "project": "daver"},
    {"name": "cache-1", "state": "exited", "project": "daver"},
    {"name": "portainer", "state": "running", "project": ""},
]

# Three named preview states. Each one drives the SAME properties
# main.qml would push at runtime, so the render is the real consumer code path.
STATES = {
    "active": dict(
        previewDaemonState="active", previewDaemonRunning=True,
        previewContainers=ACTIVE_CONTAINERS, previewContainerListEnabled=True,
        previewActionInFlight=False, previewActionKind="", previewStopArmed=False,
        previewActionFeedback="", previewDownloaderEnabled=True,
        previewShutdownPending=False, previewShutdownRemainingSeconds=0,
        previewUpdateAvailable=False, previewUpdateFeedback="",
    ),
    "inactive_armed": dict(
        previewDaemonState="inactive", previewDaemonRunning=False,
        previewContainers=[], previewContainerListEnabled=True,
        previewActionInFlight=False, previewActionKind="", previewStopArmed=True,
        previewActionFeedback="Permission denied", previewDownloaderEnabled=True,
        previewShutdownPending=True, previewShutdownRemainingSeconds=754,
        previewUpdateAvailable=False, previewUpdateFeedback="",
    ),
    "unknown_update": dict(
        previewDaemonState="unknown", previewDaemonRunning=False,
        previewContainers=[], previewContainerListEnabled=True,
        previewActionInFlight=True, previewActionKind="start", previewStopArmed=False,
        previewActionFeedback="", previewDownloaderEnabled=False,
        previewShutdownPending=False, previewShutdownRemainingSeconds=0,
        previewUpdateAvailable=True, previewUpdateFeedback="Version 0.6.0 is available",
    ),
}

SETTLE_MS = 1200


def check_prerequisites():
    if not REPRESENTATION.is_file():
        sys.exit(f"missing {REPRESENTATION}: run from the project root")
    try:
        from PyQt6.QtQml import QQmlApplicationEngine  # noqa: F401
        from PyQt6.QtQuick import QQuickWindow  # noqa: F401
    except ImportError:
        sys.exit("PyQt6 is required (Debian/Ubuntu: python3-pyqt6; Arch: python-pyqt6)")


def render_state(app, name, state, out_dir):
    from PyQt6.QtCore import QUrl, QTimer
    from PyQt6.QtGui import QImage
    from PyQt6.QtQml import QQmlApplicationEngine
    from PyQt6.QtQuick import QQuickWindow

    engine = QQmlApplicationEngine()
    root = engine.rootContext()
    root.setContextProperty("previewRepresentationUrl", REPRESENTATION.as_uri())
    for key, value in state.items():
        root.setContextProperty(key, value)
    engine.load(QUrl.fromLocalFile(str(HARNESS)))
    if not engine.rootObjects():
        print(f"FAIL load {name}")
        return False
    window = engine.rootObjects()[0]
    if not isinstance(window, QQuickWindow):
        print(f"FAIL root type {name}: {type(window)}")
        return False

    dest = out_dir / f"render_{name}.png"
    done = {"saved": False}

    def finish(grab):
        if done["saved"]:
            return
        done["saved"] = True
        image = grab.image()
        if image is None or image.isNull():
            print(f"FAIL empty image {name}")
            app.quit()
            return
        rgb = image.convertToFormat(QImage.Format.Format_ARGB32)
        rgb.save(str(dest))
        # Coarse-grid alpha sample: proves the grab is not a blank frame.
        n = sum(
            1
            for y in range(0, rgb.height(), 6)
            for x in range(0, rgb.width(), 6)
            if rgb.pixel(x, y) & 0xFF000000 != 0
        )
        print(f"SAVED {dest}  {rgb.width()}x{rgb.height()}  non-transparent (grid): {n}")
        app.quit()

    def go():
        # No explicit QSize: grabToImage() uses the item's own size, which is
        # deterministic (window default) and does not depend on the QPA
        # platform's notion of the virtual screen.
        grab = window.contentItem().grabToImage()
        if grab is None:
            print(f"FAIL grabToImage returned None for {name}")
            app.quit()
            return
        grab.ready.connect(lambda: finish(grab))
        QTimer.singleShot(8000, lambda: finish(grab))

    QTimer.singleShot(SETTLE_MS, go)
    QTimer.singleShot(30000, app.quit)
    app.exec()
    return done["saved"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--state", choices=sorted(STATES), help="render only this state (default: all)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output directory (default: {DEFAULT_OUT})")
    parser.add_argument("--platform", help=f"Qt QPA platform (default: offscreen; env QT_QPA_PLATFORM wins)")
    args = parser.parse_args()

    check_prerequisites()

    if args.platform:
        os.environ["QT_QPA_PLATFORM"] = args.platform

    from PyQt6.QtGui import QGuiApplication

    args.out.mkdir(parents=True, exist_ok=True)
    app = QGuiApplication(sys.argv)
    ok = True
    for name in ([args.state] if args.state else list(STATES)):
        if not render_state(app, name, STATES[name], args.out):
            ok = False
            break
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
