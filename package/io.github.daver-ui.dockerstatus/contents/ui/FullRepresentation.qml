import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents3

import "dockerstatus.js" as DockerStatus

/*
 * Popup / desktop representation, restyled to the design mockup's fixed dark palette.
 *
 * SANCTIONED OVERRIDE: the widget no longer takes its colours from the Kirigami
 * theme. The human operator asked for the mockup's look verbatim -- its fixed dark
 * palette and the Inter typeface -- and that decision is closed. The palette itself
 * lives in DockerStatusPalette.qml (id: paletteTokens); this file only reads from it.
 * The ONE exception is the functional error colour, Kirigami.Theme.negativeTextColor:
 * a failed action, an armed stop and an invalid inline value are neither decoration
 * nor severity accents, so they keep the theme's error colour, exactly as the config
 * page documents.
 *
 * SEVERITY: this file never maps a state to a colour. Every accent that means severity
 * -- the header dot, the pill, the progress fill, the footer dot -- is read from
 * statusDot.severityColor, the single mapping that lives in SeverityDot.qml and
 * nowhere else.
 *
 * Two things worth knowing about the action row:
 *  - There IS a stop button, but it never fires on one click: stopping the daemon is
 *    destructive to every running container, so the first click arms a confirmation,
 *    a deliberate second click confirms, and the arming expires on its own.
 *  - Swallowing failures. When the privileged start fails, the exit code and stderr
 *    are shown verbatim, so a polkit denial is visible instead of the button appearing
 *    to do nothing.
 *
 * The root is an Item wrapping the ColumnLayout: the mockup's card is painted behind
 * all content (anchors.fill, z: -1), and a layout-managed item must not carry anchors
 * -- qmllint rejects that as undefined behaviour.
 */
Item {
    id: fullRoot

    property string daemonState: "unknown"
    property var containers: []
    property bool daemonRunning: false
    property bool containerListEnabled: true
    property bool actionInFlight: false
    // Which privileged action is in flight, as DockerStatus.ACTION_*; empty when idle.
    property string actionKind: ""
    property bool stopArmed: false
    // Date.now() at the moment the confirmation was armed; 0 while it is not armed.
    property double stopArmedAt: 0
    // Half a second, deliberately readable next to the five-second window. A physical
    // double-click fires two clicked signals milliseconds apart, so without a minimum dwell
    // one gesture would arm and confirm at once -- exactly the accidental click this
    // confirmation exists to stop.
    readonly property int stopConfirmMinDwellMs: 500
    property string actionFeedback: ""
    property bool downloaderEnabled: true
    property bool downloadReady: false
    property bool downloadInFlight: false
    property string downloadFeedback: ""
    property string downloadFeedbackSeverity: "muted"
    property string taglineText: ""
    property string cookiesBrowser: ""
    property bool shutdownReady: false
    property int shutdownMinutes: 0
    property bool shutdownPending: false
    property bool shutdownInFlight: false
    property int shutdownRemainingSeconds: 0
    property string shutdownFeedback: ""
    property string shutdownFeedbackSeverity: "muted"
    // The RAW stored kcfg value, deliberately a string and not a number: a bad stored
    // value must stay visible in the inline field so the user can fix it, instead of
    // being hidden behind a resolved default. main.qml forwards it verbatim.
    property string shutdownMinutesText: ""

    signal startRequested()
    signal stopRequested()
    signal refreshRequested()
    signal downloadRequested(string url)
    signal shutdownStartRequested()
    signal shutdownStopRequested()
    signal shutdownMinutesEdited(string text)

    // The inline field validates through the same pure resolver main.qml uses to size the
    // deadline, so the field, the play gate and the persisted value cannot drift apart.
    // Validating raw text here also keeps this representation free of its own parsing.
    readonly property bool shutdownMinutesFieldValid: DockerStatus.resolveShutdownMinutes(shutdownMinutesField.text) !== null

    // Play is disabled the instant the sequence starts and stays disabled until stop
    // cancels it or the power-off completes: the button is the arming surface, so one
    // activation must not be able to arm twice. shutdownMinutesFieldValid is the second
    // gate: an unusable inline value must disable play, not be rounded to something else.
    readonly property bool shutdownPlayEnabled: fullRoot.shutdownReady && fullRoot.shutdownMinutesFieldValid && !fullRoot.shutdownPending && !fullRoot.shutdownInFlight

    // The label shows the value the command will actually use, resolved by the same
    // function main.qml feeds into buildVideoDownloadCommand(), so it can never claim a
    // browser the download is not using.
    readonly property string cookiesBrowserDisplay: DockerStatus.resolveCookiesBrowser(fullRoot.cookiesBrowser)

    // The typed link is validated by the same pure function main.qml uses to build the
    // command, so this hint and the button can never disagree with the download itself.
    readonly property bool pastedLinkUnsupported: videoUrlField.text.trim() !== ""
        && DockerStatus.classifyVideoUrl(videoUrlField.text) === null

    // Start and stop mutate the same unit, so one in-flight flag guards both and
    // actionKind says which one is running. These two split it back out for the buttons.
    readonly property bool startInFlight: fullRoot.actionInFlight
        && fullRoot.actionKind === DockerStatus.ACTION_START
    readonly property bool stopInFlight: fullRoot.actionInFlight
        && fullRoot.actionKind === DockerStatus.ACTION_STOP

    // Running/total as a 0..1 ratio for the progress fill. The guard is load-bearing: a
    // zero total (daemon down, or no containers parsed yet) must give an empty bar, not a
    // division by zero that renders NaN and a garbage width.
    readonly property real runningContainerRatio: fullRoot.containers.length > 0
        ? DockerStatus.countByState(fullRoot.containers, "running") / fullRoot.containers.length
        : 0

    // Per-container glyph: a small fixed list of theme icon names chosen by a cheap hash
    // of the container name, so the same container always gets the same tile. Kirigami.Icon
    // resolves a theme name through the icon database and draws nothing for a name the
    // active theme lacks, so a missing entry degrades gracefully instead of producing a
    // broken file path. The names are deliberately generic (folder/mimetype icons) so they
    // exist in every common theme.
    readonly property var containerIcons: [
        "folder",
        "application-x-executable",
        "text-x-generic",
        "package-x-generic",
        "image-x-generic",
        "video-x-generic"
    ]

    function containerIconFor(name) {
        var text = String(name === undefined || name === null ? "" : name);
        var hash = 0;
        for (var i = 0; i < text.length; i += 1) {
            hash = (hash * 31 + text.charCodeAt(i)) % 1000000007;
        }
        var index = Math.abs(hash) % fullRoot.containerIcons.length;
        return fullRoot.containerIcons[index];
    }

    // Stopping is destructive, so the button never fires on one click: the first click
    // arms, a deliberate second click (after the dwell below) confirms. The arming expires
    // on its own so a forgotten armed button cannot be completed by an unrelated later click.
    function disarmStop() {
        fullRoot.stopArmed = false;
        fullRoot.stopArmedAt = 0;
        stopArmTimer.stop();
    }

    function requestStop() {
        if (fullRoot.actionInFlight || !fullRoot.daemonRunning) {
            fullRoot.disarmStop();
            return;
        }

        if (!fullRoot.stopArmed) {
            fullRoot.stopArmed = true;
            fullRoot.stopArmedAt = Date.now();
            stopArmTimer.start();
            return;
        }

        // One physical gesture must not be able to stop every running container, so an
        // activation sooner than the dwell is read as the tail of the arming click, not as
        // intent. The arming stays live: the user can still confirm deliberately after the
        // dwell, or let it expire.
        if (Date.now() - fullRoot.stopArmedAt < fullRoot.stopConfirmMinDwellMs) {
            return;
        }

        fullRoot.disarmStop();
        fullRoot.stopRequested();
    }

    Timer {
        id: stopArmTimer
        interval: 5000
        repeat: false
        onTriggered: fullRoot.disarmStop()
    }

    onDaemonRunningChanged: {
        if (!fullRoot.daemonRunning) {
            fullRoot.disarmStop();
        }
    }

    onActionInFlightChanged: {
        if (fullRoot.actionInFlight) {
            fullRoot.disarmStop();
        }
    }

    // Inbound sync for the inline minutes field. Both guards matter: the field's own programmatic
    // flag keeps a mirrored write from echoing back as a user edit, and the focus guard keeps a
    // reload-driven change from overwriting what the user is in the middle of typing.
    onShutdownMinutesTextChanged: {
        if (!shutdownMinutesField.seeded || shutdownMinutesField.programmatic) return;
        if (shutdownMinutesField.activeFocus) return;
        if (shutdownMinutesField.text === fullRoot.shutdownMinutesText) return;
        shutdownMinutesField.programmatic = true;
        shutdownMinutesField.text = fullRoot.shutdownMinutesText;
        shutdownMinutesField.programmatic = false;
    }

    Layout.preferredWidth: Kirigami.Units.gridUnit * 34
    Layout.minimumWidth: Kirigami.Units.gridUnit * 30

    // The content ColumnLayout is anchored to fill this root, so its implicit size
    // EXCLUDES the anchors.margins it carries (22 left/right, 20 top, 22 bottom).
    // Adding them back makes the root advertise the whole card rather than just the
    // column inside it; otherwise the popup is sized ~44px too narrow and ~42px too
    // short, the last rows are clipped, and the planar widget comes up short too.
    implicitWidth: content.implicitWidth + content.anchors.leftMargin + content.anchors.rightMargin
    implicitHeight: content.implicitHeight + content.anchors.topMargin + content.anchors.bottomMargin

    // The fixed dark palette and type scale of the mockup. A QtObject, so it claims no
    // layout space; the id is paletteTokens, never "palette", because "palette" would
    // shadow QQuickItem::palette.
    DockerStatusPalette {
        id: paletteTokens
    }

    // The one card the whole popup is painted on. It is the root's first child and sits
    // behind everything (z: -1). No second appBackground rectangle: under
    // PlasmaCore.Types.NoBackground the mockup's page background is not needed, and a
    // second rectangle would read as a double border.
    Rectangle {
        anchors.fill: parent
        z: -1
        color: paletteTokens.panel
        radius: paletteTokens.appRadius
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.lineStrong
    }

    // Every section lives in this one column. It fills the card and supplies the mockup's
    // inner padding through its own margins (22px horizontal, 20px top, 22px bottom); the
    // 16px content gap becomes the section spacing.
    ColumnLayout {
        id: content
        anchors.fill: parent
        anchors.leftMargin: 22
        anchors.rightMargin: 22
        anchors.topMargin: 20
        anchors.bottomMargin: 22
        spacing: Kirigami.Units.largeSpacing

        // --- Topbar ----------------------------------------------------------
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0

            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.largeSpacing

                // Logo tile: 40x40, vertical gradient, hairline border, centred glyph.
                Rectangle {
                    Layout.preferredWidth: 40
                    Layout.preferredHeight: 40
                    Layout.alignment: Qt.AlignVCenter
                    radius: paletteTokens.logoTileRadius
                    border.width: paletteTokens.appBorderWidth
                    border.color: paletteTokens.logoTileBorder
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: paletteTokens.logoTileTop }
                        GradientStop { position: 1.0; color: paletteTokens.logoTileBottom }
                    }

                    Text {
                        anchors.centerIn: parent
                        text: "◈"
                        color: paletteTokens.logoTileText
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.titlePixelSize
                    }
                }

                // Two-line identity block: the uppercase eyebrow over the title.
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter
                    spacing: 2

                    PlasmaComponents3.Label {
                        text: i18n("Workspace")
                        color: paletteTokens.muted
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.eyebrowPixelSize
                        font.weight: Font.DemiBold
                        font.letterSpacing: 1.3
                        font.capitalization: Font.AllUppercase
                    }

                    PlasmaComponents3.Label {
                        text: i18n("Docker Control Center")
                        color: paletteTokens.text
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.titlePixelSize
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.7
                    }
                }

                // Shown only while an action is in flight, so the row stays quiet at rest.
                PlasmaComponents3.BusyIndicator {
                    Layout.alignment: Qt.AlignVCenter
                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                    Layout.preferredHeight: Kirigami.Units.iconSizes.small
                    running: fullRoot.actionInFlight
                    visible: fullRoot.actionInFlight
                }

                // Refresh icon-button. Kept a ToolButton so its ToolTip renders (a
                // PlasmaComponents3.ToolTip only shows when its parent is an AbstractButton);
                // the mockup's square surface is supplied by the overridden background.
                PlasmaComponents3.ToolButton {
                    id: refreshButton
                    Layout.preferredWidth: 38
                    Layout.preferredHeight: 38
                    Layout.alignment: Qt.AlignVCenter
                    icon.name: "view-refresh"
                    icon.color: paletteTokens.iconButtonText
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    flat: false
                    onClicked: fullRoot.refreshRequested()

                    background: Rectangle {
                        radius: paletteTokens.iconButtonRadius
                        color: refreshButton.hovered ? paletteTokens.iconButtonSurfaceHover : paletteTokens.iconButtonSurface
                        border.width: paletteTokens.appBorderWidth
                        border.color: paletteTokens.line
                    }

                    PlasmaComponents3.ToolTip {
                        text: i18n("Refresh now")
                    }
                }
            }

            // The topbar's bottom hairline, spanning the content column.
            Rectangle {
                Layout.fillWidth: true
                Layout.topMargin: 20
                Layout.preferredHeight: 1
                color: paletteTokens.line
            }
        }

        // --- Status card -----------------------------------------------------
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: statusBody.implicitHeight + 32
            radius: paletteTokens.cardRadius
            border.width: paletteTokens.appBorderWidth
            border.color: paletteTokens.line
            gradient: Gradient {
                GradientStop { position: 0.0; color: paletteTokens.statusCardTop }
                GradientStop { position: 1.0; color: paletteTokens.statusCardBottom }
            }

            ColumnLayout {
                id: statusBody
                anchors.fill: parent
                anchors.margins: 16
                spacing: 0

                // status-head: the dot every other severity colour on this card reads from.
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 9

                    SeverityDot {
                        id: statusDot
                        Layout.alignment: Qt.AlignVCenter
                        diameter: 8
                        halo: true
                        severity: DockerStatus.daemonSeverity(fullRoot.daemonState)
                    }

                    PlasmaComponents3.Label {
                        Layout.alignment: Qt.AlignVCenter
                        text: fullRoot.daemonRunning
                            ? i18n("Docker daemon is running")
                            : i18nc("@info", "Docker daemon is %1", fullRoot.daemonState)
                        color: paletteTokens.text
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.bodyPixelSize
                        font.weight: Font.DemiBold
                    }

                    Item {
                        Layout.fillWidth: true
                    }

                    // The pill: its text and its tint are both derived from the header dot,
                    // so the two can never disagree about the daemon's state.
                    Rectangle {
                        Layout.alignment: Qt.AlignVCenter
                        implicitWidth: pillLabel.implicitWidth + 18
                        implicitHeight: pillLabel.implicitHeight + 10
                        radius: height / 2
                        color: fullRoot.daemonRunning
                            ? Qt.rgba(statusDot.severityColor.r, statusDot.severityColor.g, statusDot.severityColor.b, 0.1)
                            : Qt.rgba(statusDot.severityColor.r, statusDot.severityColor.g, statusDot.severityColor.b, 0.12)

                        PlasmaComponents3.Label {
                            id: pillLabel
                            anchors.centerIn: parent
                            text: fullRoot.daemonRunning ? i18n("ONLINE") : i18n("OFFLINE")
                            color: statusDot.severityColor
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.subtlePixelSize
                            font.weight: 700
                        }
                    }
                }

                // stats: the running/total figure over its caption, baseline-aligned.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 15
                    spacing: 8

                    PlasmaComponents3.Label {
                        Layout.alignment: Qt.AlignBaseline
                        text: DockerStatus.countByState(fullRoot.containers, "running") + "/" + fullRoot.containers.length
                        color: paletteTokens.text
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.metricPixelSize
                        font.weight: 650
                        font.letterSpacing: -1.3
                    }

                    PlasmaComponents3.Label {
                        Layout.alignment: Qt.AlignBaseline
                        text: i18n("containers running")
                        color: paletteTokens.muted
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.labelPixelSize
                    }
                }

                // progress bar: the fill colour is the header dot's severity colour, and
                // the width animates so the mockup's transition survives.
                Rectangle {
                    id: progressTrack
                    Layout.fillWidth: true
                    Layout.topMargin: 12
                    Layout.preferredHeight: paletteTokens.progressTrackHeight
                    radius: 2.5
                    color: paletteTokens.trackSurface

                    Rectangle {
                        width: parent.width * fullRoot.runningContainerRatio
                        height: parent.height
                        radius: 2.5
                        color: statusDot.severityColor

                        Behavior on width {
                            NumberAnimation { duration: 250 }
                        }
                    }
                }

                // actions: both buttons always visible and equal width, so the row never
                // reflows. The mockup makes them share the row equally.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 16
                    spacing: 9

                    PlasmaComponents3.Button {
                        id: startDaemonButton
                        Layout.fillWidth: true
                        icon.name: "media-playback-start"
                        icon.color: paletteTokens.buttonPrimaryText
                        text: fullRoot.startInFlight
                            ? i18n("Starting…")
                            : i18n("Start daemon")
                        enabled: !fullRoot.actionInFlight && !fullRoot.daemonRunning
                        opacity: enabled ? 1 : 0.38
                        onClicked: fullRoot.startRequested()
                        Kirigami.Theme.textColor: paletteTokens.buttonPrimaryText

                        background: Rectangle {
                            color: startDaemonButton.hovered ? paletteTokens.buttonPrimaryHover : paletteTokens.buttonPrimary
                            radius: paletteTokens.controlRadius
                            border.width: paletteTokens.appBorderWidth
                            border.color: paletteTokens.buttonPrimary
                        }
                    }

                    PlasmaComponents3.Button {
                        id: stopDaemonButton
                        icon.name: "media-playback-stop"
                        // The mockup makes both action buttons share the row equally, which
                        // deliberately supersedes the old narrow-stop rule: Stop used to be
                        // Layout.fillWidth: false with Layout.preferredWidth: Kirigami.Units.gridUnit * 7.
                        // The row still cannot reflow between "Stop daemon" and "Confirm stop",
                        // because both buttons fill and only their labels change.
                        Layout.fillWidth: true
                        icon.color: paletteTokens.buttonDangerText
                        text: fullRoot.stopInFlight
                            ? i18n("Stopping…")
                            : (fullRoot.stopArmed ? i18n("Confirm stop") : i18n("Stop daemon"))
                        enabled: !fullRoot.actionInFlight && fullRoot.daemonRunning
                        opacity: enabled ? 1 : 0.38
                        onClicked: fullRoot.requestStop()
                        Kirigami.Theme.textColor: paletteTokens.buttonDangerText

                        background: Rectangle {
                            color: stopDaemonButton.hovered ? paletteTokens.buttonSurfaceHover : paletteTokens.buttonDanger
                            radius: paletteTokens.controlRadius
                            border.width: paletteTokens.appBorderWidth
                            border.color: paletteTokens.buttonDangerBorder
                        }
                    }
                }
            }
        }

        // The armed-stop warning: the functional error colour, not a severity accent.
        PlasmaComponents3.Label {
            Layout.fillWidth: true
            visible: fullRoot.stopArmed
            text: i18n("Stopping the daemon stops every running container. Press again to confirm.")
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.WordWrap
            font.family: paletteTokens.fontFamily
            font.pixelSize: paletteTokens.subtlePixelSize
        }

        // A failed action reports the exit code and stderr verbatim, never silently.
        PlasmaComponents3.Label {
            Layout.fillWidth: true
            visible: fullRoot.actionFeedback !== ""
            text: fullRoot.actionFeedback
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.WordWrap
            font.family: paletteTokens.fontFamily
            font.pixelSize: paletteTokens.subtlePixelSize
        }

        // --- Container section -----------------------------------------------
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: containerBody.implicitHeight
            visible: fullRoot.containerListEnabled
            radius: paletteTokens.cardRadius
            border.width: paletteTokens.appBorderWidth
            border.color: paletteTokens.line
            // panelSunken at 45% over the panel, as in the mockup.
            color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
            clip: true

            ColumnLayout {
                id: containerBody
                anchors.fill: parent
                spacing: 0

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0

                    RowLayout {
                        Layout.fillWidth: true
                        Layout.leftMargin: 16
                        Layout.rightMargin: 16
                        Layout.topMargin: 14
                        Layout.bottomMargin: 14
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 4

                            PlasmaComponents3.Label {
                                text: i18n("Containers")
                                color: paletteTokens.text
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.sectionTitlePixelSize
                                font.weight: 650
                            }

                            PlasmaComponents3.Label {
                                text: i18n("Application services")
                                color: paletteTokens.muted
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.subtlePixelSize
                            }
                        }

                        PlasmaComponents3.Label {
                            Layout.alignment: Qt.AlignVCenter
                            text: i18nc("@info", "%1 services", fullRoot.containers.length)
                            color: paletteTokens.muted
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.subtlePixelSize
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 1
                        color: paletteTokens.line
                    }
                }

                ListView {
                    id: containerList
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(contentHeight, Kirigami.Units.gridUnit * 10)
                    clip: true
                    visible: fullRoot.containers.length > 0
                    model: fullRoot.containers

                    delegate: Item {
                        id: containerRow
                        required property var modelData

                        width: containerList.width
                        implicitHeight: containerRowLayout.implicitHeight + 20

                        // Faint hover tint behind the row, exactly as the mockup.
                        Rectangle {
                            anchors.fill: parent
                            radius: paletteTokens.tileRadius
                            color: rowHover.containsMouse ? paletteTokens.rowHoverTint : "transparent"
                        }

                        // Hover-only: the row is not clickable, so the area accepts no button
                        // and never swallows events aimed at the list behind it.
                        MouseArea {
                            id: rowHover
                            anchors.fill: parent
                            hoverEnabled: true
                            acceptedButtons: Qt.NoButton
                        }

                        RowLayout {
                            id: containerRowLayout
                            anchors.fill: parent
                            anchors.leftMargin: 8
                            anchors.rightMargin: 8
                            anchors.topMargin: 10
                            anchors.bottomMargin: 10
                            spacing: 11

                            // Deterministic per-container glyph, tinted on a sunken tile.
                            Rectangle {
                                Layout.preferredWidth: 32
                                Layout.preferredHeight: 32
                                Layout.alignment: Qt.AlignVCenter
                                radius: paletteTokens.tileRadius
                                color: paletteTokens.iconTileSurface

                                Kirigami.Icon {
                                    anchors.centerIn: parent
                                    source: fullRoot.containerIconFor(containerRow.modelData.name)
                                    color: paletteTokens.iconTileText
                                    implicitWidth: 16
                                    implicitHeight: 16
                                }
                            }

                            PlasmaComponents3.Label {
                                Layout.fillWidth: true
                                Layout.alignment: Qt.AlignVCenter
                                text: containerRow.modelData.name
                                color: paletteTokens.text
                                elide: Text.ElideMiddle
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.labelPixelSize
                                font.weight: 600
                            }

                            RowLayout {
                                Layout.alignment: Qt.AlignVCenter
                                spacing: 6

                                SeverityDot {
                                    Layout.alignment: Qt.AlignVCenter
                                    diameter: 6
                                    severity: DockerStatus.containerSeverity(containerRow.modelData.state)
                                }

                                PlasmaComponents3.Label {
                                    text: containerRow.modelData.state
                                    color: paletteTokens.containerStateText
                                    font.family: paletteTokens.fontFamily
                                    font.pixelSize: paletteTokens.subtlePixelSize
                                }
                            }
                        }
                    }
                }

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    Layout.margins: 20
                    visible: fullRoot.containers.length === 0
                    text: fullRoot.daemonRunning
                        ? i18n("No containers found.")
                        : i18n("Start the daemon to list containers.")
                    color: paletteTokens.muted
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                }
            }
        }

        // --- Video download section ------------------------------------------
        // The one place this widget accepts input. The URL is validated twice: here, to
        // arm the button and to show a hint; and again inside buildVideoDownloadCommand(),
        // which refuses it and shell-quotes it before it becomes a command. An unsupported
        // paste is reported, never silently ignored.
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: downloadBody.implicitHeight
            visible: fullRoot.downloaderEnabled
            radius: paletteTokens.cardRadius
            border.width: paletteTokens.appBorderWidth
            border.color: paletteTokens.line
            color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
            clip: true

            ColumnLayout {
                id: downloadBody
                anchors.fill: parent
                spacing: 0

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0

                    RowLayout {
                        Layout.fillWidth: true
                        Layout.leftMargin: 16
                        Layout.rightMargin: 16
                        Layout.topMargin: 14
                        Layout.bottomMargin: 14
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 4

                            PlasmaComponents3.Label {
                                text: i18n("Import content")
                                color: paletteTokens.text
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.sectionTitlePixelSize
                                font.weight: 650
                            }

                            PlasmaComponents3.Label {
                                text: i18n("Add a video to process")
                                color: paletteTokens.muted
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.subtlePixelSize
                            }
                        }

                        Text {
                            Layout.alignment: Qt.AlignVCenter
                            text: "↳"
                            color: paletteTokens.blue
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.bodyPixelSize
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 1
                        color: paletteTokens.line
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.margins: 16
                    spacing: 8

                    PlasmaComponents3.Label {
                        text: i18n("YouTube or X URL")
                        color: paletteTokens.labelText
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.labelPixelSize
                        font.weight: 650
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8

                        PlasmaComponents3.TextField {
                            id: videoUrlField
                            Layout.fillWidth: true
                            Layout.preferredHeight: 41
                            placeholderText: i18n("Paste a YouTube or X link")
                            color: paletteTokens.text
                            placeholderTextColor: paletteTokens.placeholder
                            leftPadding: 12
                            rightPadding: 12
                            enabled: !fullRoot.downloadInFlight
                            onAccepted: {
                                if (downloadButton.enabled) {
                                    fullRoot.downloadRequested(videoUrlField.text);
                                }
                            }

                            background: Rectangle {
                                color: paletteTokens.fieldSurface
                                border.width: paletteTokens.appBorderWidth
                                border.color: videoUrlField.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                                radius: paletteTokens.controlRadius
                            }
                        }

                        PlasmaComponents3.ToolButton {
                            id: downloadButton
                            Layout.preferredHeight: 41
                            icon.name: "download"
                            icon.color: paletteTokens.text
                            display: PlasmaComponents3.AbstractButton.TextBesideIcon
                            text: i18n("Import")
                            flat: false
                            // Enabled for an unsupported paste too, on purpose: a click then
                            // reports why it was refused instead of the button looking dead.
                            enabled: !fullRoot.downloadInFlight
                                && fullRoot.downloadReady
                                && videoUrlField.text.trim() !== ""
                            onClicked: fullRoot.downloadRequested(videoUrlField.text)
                            Kirigami.Theme.textColor: paletteTokens.text

                            background: Rectangle {
                                color: downloadButton.hovered ? paletteTokens.buttonSurfaceHover : paletteTokens.buttonSurface
                                radius: paletteTokens.controlRadius
                                border.width: paletteTokens.appBorderWidth
                                border.color: downloadButton.hovered ? paletteTokens.buttonBorderHover : paletteTokens.buttonBorder
                            }

                            // A PC3 ToolTip only renders when its parent is an AbstractButton,
                            // so this one works here and would not work on the TextField above.
                            PlasmaComponents3.ToolTip {
                                text: i18n("Download this video with yt-dlp, using your configured cookies browser")
                            }
                        }

                        PlasmaComponents3.BusyIndicator {
                            Layout.preferredWidth: Kirigami.Units.iconSizes.small
                            Layout.preferredHeight: Kirigami.Units.iconSizes.small
                            running: fullRoot.downloadInFlight
                            visible: fullRoot.downloadInFlight
                        }
                    }

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        text: fullRoot.cookiesBrowserDisplay !== ""
                            ? i18nc("@info", "Cookies from: %1", fullRoot.cookiesBrowserDisplay)
                            : i18nc("@info", "Cookies: not used")
                        color: paletteTokens.muted
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                    }

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        visible: fullRoot.pastedLinkUnsupported
                        text: i18n("Only YouTube and X (Twitter) links are supported.")
                        color: Kirigami.Theme.negativeTextColor
                        wrapMode: Text.WordWrap
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                    }

                    // The dot carries the severity, exactly as in the header: no second
                    // severity-to-colour switch is allowed to exist.
                    RowLayout {
                        Layout.fillWidth: true
                        visible: fullRoot.downloadFeedback !== ""
                        spacing: 6

                        SeverityDot {
                            Layout.alignment: Qt.AlignVCenter
                            severity: fullRoot.downloadFeedbackSeverity
                        }

                        PlasmaComponents3.Label {
                            Layout.fillWidth: true
                            text: fullRoot.downloadFeedback
                            color: paletteTokens.text
                            wrapMode: Text.WordWrap
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.subtlePixelSize
                        }
                    }
                }
            }
        }

        // --- Countdown to Extinction -----------------------------------------
        // The countdown itself is owned by main.qml: this representation only renders the
        // local deadline and emits start/stop. Play disables the instant the sequence starts,
        // so it can only ever be armed once; stop is the only way to cancel and, because
        // cancel is purely local, it needs no privilege. The power-off adds no polkit rule
        // and does not widen the grant (ALLOWED_VERBS stays ["start"]); unlike the daemon
        // stop it does not prompt, because logind's default policy for
        // org.freedesktop.login1.power-off is allow_active=yes. The safeguards are the
        // deliberate activation, the more-than-10-minute countdown, the visible countdown
        // and the cancel button, not a password gate (adr-0009).
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: countdownBody.implicitHeight + 32
            radius: paletteTokens.cardRadius
            border.width: paletteTokens.appBorderWidth
            border.color: paletteTokens.line
            color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
            clip: true

            ColumnLayout {
                id: countdownBody
                anchors.fill: parent
                anchors.margins: 16
                spacing: 0

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 5

                        PlasmaComponents3.Label {
                            text: i18n("Countdown to Extinction")
                            color: paletteTokens.text
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.sectionTitlePixelSize
                            font.weight: 650
                        }

                        PlasmaComponents3.Label {
                            Layout.fillWidth: true
                            text: i18n("Schedule an automatic power-off")
                            color: paletteTokens.muted
                            wrapMode: Text.WordWrap
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.labelPixelSize
                        }
                    }

                    Rectangle {
                        Layout.preferredWidth: 35
                        Layout.preferredHeight: 35
                        Layout.alignment: Qt.AlignTop
                        radius: paletteTokens.controlRadius
                        color: paletteTokens.iconTileSurface

                        Text {
                            anchors.centerIn: parent
                            text: "◷"
                            color: paletteTokens.iconTileTextAlt
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.titlePixelSize
                        }
                    }
                }

                // The countdown length is editable here, not only in the config page, because
                // this is the surface where the play button and its disabled state actually
                // live. The field deliberately refuses no keystrokes: a non-number has to be
                // typeable so the error cue below can explain why play is disabled. The
                // seed/sync pair exists because a plain `text:` binding would be destroyed by
                // the first user edit -- the same trap the config page's cookies combo
                // documents -- so the stored value is copied in once and afterwards only
                // mirrored while the field is unfocused.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 17
                    spacing: 10

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        text: i18n("Minutes until power-off:")
                        color: paletteTokens.labelText
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.labelPixelSize
                    }

                    PlasmaComponents3.TextField {
                        id: shutdownMinutesField
                        Layout.preferredWidth: 92
                        Layout.preferredHeight: 41
                        placeholderText: i18n("15")
                        leftPadding: 12
                        rightPadding: 12
                        // Disabled while a countdown is pending or in flight: the deadline is
                        // snapshotted in main.qml, so editing here could only imply a running
                        // deadline would change.
                        enabled: !fullRoot.shutdownPending && !fullRoot.shutdownInFlight
                        // No new severity mapping: an invalid value just tints the text, and
                        // the hint below says what to fix. The dot stays reserved for status
                        // severity, and the tint keeps the theme's functional error colour
                        // (not a palette accent) exactly as the config page does.
                        color: fullRoot.shutdownMinutesFieldValid ? paletteTokens.text : Kirigami.Theme.negativeTextColor

                        background: Rectangle {
                            color: paletteTokens.fieldSurface
                            border.width: paletteTokens.appBorderWidth
                            border.color: shutdownMinutesField.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                            radius: paletteTokens.controlRadius
                        }

                        // seeded flips LAST in Component.onCompleted, after programmatic is
                        // cleared, so the seed write can never look like a user edit and emit.
                        property bool seeded: false
                        property bool programmatic: false

                        Component.onCompleted: {
                            programmatic = true;
                            text = fullRoot.shutdownMinutesText;
                            programmatic = false;
                            seeded = true;
                        }

                        onTextChanged: {
                            if (!shutdownMinutesField.seeded || shutdownMinutesField.programmatic) return;
                            fullRoot.shutdownMinutesEdited(shutdownMinutesField.text);
                        }

                        // A stored value that changed while this field had focus would
                        // otherwise never be mirrored: onShutdownMinutesTextChanged skips a
                        // focused field, and nothing re-runs on blur. Only a VALID text is
                        // mirrored -- invalid text is the user's to fix and must stay visible,
                        // and a valid user-typed value is already persisted, so a
                        // valid-but-different text on blur can only be an external change that
                        // was missed.
                        onActiveFocusChanged: {
                            if (activeFocus || !shutdownMinutesField.seeded || shutdownMinutesField.programmatic) return;
                            if (shutdownMinutesField.text === fullRoot.shutdownMinutesText) return;
                            if (DockerStatus.resolveShutdownMinutes(shutdownMinutesField.text) === null) return;
                            shutdownMinutesField.programmatic = true;
                            shutdownMinutesField.text = fullRoot.shutdownMinutesText;
                            shutdownMinutesField.programmatic = false;
                        }
                    }

                    PlasmaComponents3.Label {
                        text: i18n("min")
                        color: paletteTokens.muted
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.labelPixelSize
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 16
                    spacing: 9

                    PlasmaComponents3.Button {
                        id: shutdownPlayButton
                        Layout.fillWidth: true
                        icon.name: "media-playback-start"
                        icon.color: paletteTokens.buttonPrimaryText
                        text: fullRoot.shutdownPending
                            ? i18n("Shutting down…")
                            : i18n("Shut down")
                        enabled: fullRoot.shutdownPlayEnabled
                        opacity: enabled ? 1 : 0.38
                        onClicked: fullRoot.shutdownStartRequested()
                        Kirigami.Theme.textColor: paletteTokens.buttonPrimaryText

                        background: Rectangle {
                            color: shutdownPlayButton.hovered ? paletteTokens.buttonPrimaryHover : paletteTokens.buttonPrimary
                            radius: paletteTokens.controlRadius
                            border.width: paletteTokens.appBorderWidth
                            border.color: paletteTokens.buttonPrimary
                        }

                        PlasmaComponents3.ToolTip {
                            text: i18nc("@info", "Arm a %1-minute countdown; the machine powers off when it expires", fullRoot.shutdownMinutes)
                        }
                    }

                    PlasmaComponents3.Button {
                        id: shutdownCancelButton
                        icon.name: "media-playback-stop"
                        text: i18n("Cancel")
                        enabled: fullRoot.shutdownPending
                        opacity: enabled ? 1 : 0.38
                        onClicked: fullRoot.shutdownStopRequested()
                        Kirigami.Theme.textColor: paletteTokens.text

                        background: Rectangle {
                            color: shutdownCancelButton.hovered ? paletteTokens.buttonSurfaceHover : paletteTokens.buttonSurface
                            radius: paletteTokens.controlRadius
                            border.width: paletteTokens.appBorderWidth
                            border.color: shutdownCancelButton.hovered ? paletteTokens.buttonBorderHover : paletteTokens.buttonBorder
                        }

                        PlasmaComponents3.ToolTip {
                            text: i18n("Cancel the pending shutdown")
                        }
                    }
                }

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    Layout.topMargin: 8
                    visible: fullRoot.shutdownPending
                    text: i18nc("@info", "Powering off in %1", DockerStatus.formatCountdown(fullRoot.shutdownRemainingSeconds))
                    color: paletteTokens.muted
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.subtlePixelSize
                }

                // A disabled play button must never look dead without a reason: the inline
                // value that failed validation says what to fix. The countdown is editable on
                // this surface, so pointing at the config page would be stale.
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    Layout.topMargin: 8
                    visible: !fullRoot.shutdownMinutesFieldValid
                    text: i18n("Enter a whole number of minutes greater than 10.")
                    color: Kirigami.Theme.negativeTextColor
                    wrapMode: Text.WordWrap
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.subtlePixelSize
                }

                // The dot carries the severity, exactly as in the header: no second
                // severity-to-colour switch is allowed to exist.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 8
                    visible: fullRoot.shutdownFeedback !== ""
                    spacing: 6

                    SeverityDot {
                        Layout.alignment: Qt.AlignVCenter
                        severity: fullRoot.shutdownFeedbackSeverity
                    }

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        text: fullRoot.shutdownFeedback
                        color: paletteTokens.text
                        wrapMode: Text.WordWrap
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                    }
                }
            }
        }

        // --- Tagline ----------------------------------------------------------
        // Configured text (default "Persiguiendo la singularidad"), not a status message: it
        // is deliberately muted so it never competes with the daemon state for the reader's
        // attention, and it disappears entirely when the setting is empty. This is the only
        // surface allowed to carry text -- the panel representation stays icon-sized.
        PlasmaComponents3.Label {
            Layout.fillWidth: true
            text: fullRoot.taglineText
            visible: fullRoot.taglineText !== ""
            horizontalAlignment: Text.AlignHCenter
            color: paletteTokens.muted
            opacity: 0.5
            font.family: paletteTokens.fontFamily
            font.pixelSize: paletteTokens.subtlePixelSize
        }

        // --- Footer -----------------------------------------------------------
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 0

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 1
                color: paletteTokens.line
            }

            RowLayout {
                Layout.fillWidth: true
                Layout.topMargin: 13
                Layout.bottomMargin: 13
                spacing: 12

                PlasmaComponents3.Label {
                    text: i18n("Docker Status") + " · " + i18n("Local panel")
                    color: paletteTokens.footerText
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.subtlePixelSize
                }

                Item {
                    Layout.fillWidth: true
                }

                RowLayout {
                    Layout.alignment: Qt.AlignVCenter
                    spacing: 6

                    // The footer dot reads the header dot's colour: one severity, one mapping.
                    Rectangle {
                        Layout.alignment: Qt.AlignVCenter
                        Layout.preferredWidth: 5
                        Layout.preferredHeight: 5
                        radius: 2.5
                        color: statusDot.severityColor
                    }

                    PlasmaComponents3.Label {
                        text: fullRoot.daemonRunning
                            ? i18n("All systems available")
                            : i18nc("@info", "Docker daemon is %1", fullRoot.daemonState)
                        color: paletteTokens.footerText
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                    }
                }
            }
        }
    }
}
