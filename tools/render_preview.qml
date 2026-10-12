/*
 * Preview harness for the Docker Status widget's full representation.
 *
 * Loads the SHIPPED bytes -- package/io.github.daver-ui.dockerstatus/contents/ui/
 * FullRepresentation.qml -- by file:// URL (the URL arrives as the
 * previewRepresentationUrl context property from render_preview.py). This file
 * copies nothing and never edits the package: the KPackage under package/ is what
 * Plasma loads and stays byte-for-byte untouched.
 *
 * Why a harness at all: FullRepresentation.qml is a pure consumer (properties in,
 * signals out, no PlasmoidItem), so it can be instantiated standalone. main.qml and
 * CompactRepresentation.qml cannot -- see docs/verification/render-preview.md.
 *
 * Typical use:
 *     QT_QPA_PLATFORM=offscreen python3 tools/render_preview.py
 */
import QtQuick
import QtQuick.Window

Window {
    id: win
    visible: true
    width: 560
    height: 820
    title: "Docker Status - FullRepresentation preview"
    // The mockup's page background; the representation paints its own card on top.
    color: "#101417"

    Loader {
        id: repLoader
        anchors.centerIn: parent
        source: previewRepresentationUrl
        onLoaded: {
            // Every value is a preview constant injected by render_preview.py;
            // the representation stays a pure consumer, exactly as in the plasmoid.
            item.daemonState = previewDaemonState
            item.daemonRunning = previewDaemonRunning
            item.containers = previewContainers
            item.containerListEnabled = previewContainerListEnabled
            item.actionInFlight = previewActionInFlight
            item.actionKind = previewActionKind
            item.stopArmed = previewStopArmed
            item.actionFeedback = previewActionFeedback
            item.downloaderEnabled = previewDownloaderEnabled
            item.downloadReady = true
            item.downloadInFlight = false
            item.downloadFeedback = ""
            item.shutdownReady = true
            item.shutdownMinutes = 15
            item.shutdownMinutesText = "15"
            item.shutdownPending = previewShutdownPending
            item.shutdownInFlight = false
            item.shutdownRemainingSeconds = previewShutdownRemainingSeconds
            item.shutdownFeedback = ""
            item.updateAvailable = previewUpdateAvailable
            item.updateFeedback = previewUpdateFeedback
            item.taglineText = "Persiguiendo la singularidad"
            item.cookiesBrowser = "firefox"
        }
    }
}
