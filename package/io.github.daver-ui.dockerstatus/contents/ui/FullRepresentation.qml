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
 * -- the header dot, the pill and the progress fill -- is read from
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
    // True while the stop one-shot is settling: STOP goes inert rather than firing a second
    // kill-and-sweep for a run the first one already claimed (adr-0022). main.qml owns it.
    property bool downloadStopInFlight: false
    property string downloadFeedback: ""
    property string downloadFeedbackSeverity: "muted"
    property string cookiesBrowser: ""
    // Display and open-folder forms of the configured download directory. main.qml owns
    // both -- it reads configuration and calls the pure helpers -- and this representation
    // only renders the finished strings; it reads no configuration itself, exactly like
    // every other consumer here. downloadDirectoryDisplay is "" until $HOME is known, and
    // downloadFolderUrl is "" in the same case, so the shortcut stays disabled rather than
    // opening a bogus URL.
    property string downloadDirectoryDisplay: ""
    property string downloadFolderUrl: ""
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

    // Compose grouping and per-project actions. All of this is view state or a signal
    // out: nothing here reads configuration and nothing here runs a command. main.qml
    // owns the in-flight flag, the captured action kind and the feedback string, and
    // resolves the project name into a command through DockerStatus; this representation
    // only renders those values and emits a request naming the project. The two unused
    // here (composeActionProject, composeActionKind) are still declared because main.qml
    // is wired against these exact names.
    property bool composeActionInFlight: false
    property string composeActionProject: ""
    // DockerStatus.COMPOSE_ACTION_START / _STOP while an action is in flight, "" when idle.
    property string composeActionKind: ""
    property string composeActionFeedback: ""
    property string composeActionFeedbackSeverity: "muted"

    // Podman Desktop launch. main.qml owns the resolved path and the one-shot; this file
    // only renders the in-flight flag and a failure, never a command. The launch returned
    // as a square status-card button (adr-0017) after its section was removed (adr-0016);
    // a failed launch is surfaced, never swallowed.
    property bool podmanLaunchInFlight: false
    property string podmanLaunchFeedback: ""
    property string podmanLaunchFeedbackSeverity: "muted"

    // Local view state and nothing else: whether the ONE collapsible section --
    // the merged "Miscelánea" card that now holds both the video-download row and
    // the shutdown countdown -- has its body open. This is deliberately NOT
    // persisted and NOT routed through a signal: main.qml still owns every shell
    // and kcfg boundary, and the popup stays a pure consumer of configuration. The
    // single piece of state that belongs to the popup itself is whether that one
    // section is open. It defaults to true, so nothing regresses visually until the
    // header is tapped, and the header, separator and each sub-block's inner title
    // never collapse.
    //
    // The containers section has NO collapse state any more: its header row is
    // gone entirely, so there is no header left to tap and no flag that could
    // keep a body closed behind a list that is always shown. The download and
    // countdown blocks used to carry one flag each; adr-0019 merged them into this
    // single section, so they share this one flag and collapse together.
    //
    // Assigned EXACTLY ONCE: the merged header's MouseArea is the only writer.
    property bool miscSectionExpanded: true

    // The countdown is the one part with an ARMED state, and adr-0009 names "the
    // visible countdown and the cancel button" among the safeguards that let the
    // power-off run without a password prompt. So collapse is a rest-state declutter
    // only: while a shutdown is pending the merged body comes back whatever the
    // section bool says, and an armed destructive state can never be collapsed away.
    // The header's own toggle still flips the section bool, so a pending countdown
    // is restored in full and stays that way until the user cancels it.
    //
    // The download row's STOP is the SECOND live control, and adr-0022 applies adr-0009's
    // own reasoning to it: while a download is in flight the merged body comes back too,
    // so a live STOP can never be collapsed away either. A settled row can still be
    // collapsed, and its X dismisses the feedback.
    readonly property bool miscBodyVisible: fullRoot.miscSectionExpanded || fullRoot.shutdownPending || fullRoot.downloadInFlight

    // The collapse-all request, as a generation counter. The control bumps it; a group that
    // has not been tapped since absorbs it by closing. A counter rather than a bool because
    // the control is repeatable: pressing it again must re-close the groups the human
    // reopened in between.
    property int groupsCollapseEpoch: 0

    // Update check. main.qml owns the whole check; this representation only renders the one
    // line it produces and can ask for a manual re-check. No severity here: the line reuses
    // the muted, centred line style the bottom text used to carry, so there is deliberately
    // no updateSeverity property.
    property bool updateAvailable: false
    property string updateFeedback: ""

    signal startRequested()
    signal stopRequested()
    signal refreshRequested()
    signal downloadRequested(string url)
    // The row's two live controls (adr-0022): STOP asks main.qml to kill the run and sweep
    // its partials; the X dismisses the row's own feedback. Both are requests out -- the
    // representation builds no command and touches no data source, exactly like every other
    // signal here.
    signal downloadStopRequested()
    signal downloadDismissed()
    signal shutdownStartRequested()
    signal shutdownStopRequested()
    signal shutdownMinutesEdited(string text)
    signal updateCheckRequested()
    // The Podman Desktop launch request: the representation emits it and builds no command,
    // exactly like every other action here -- main.qml owns the resolved path and the
    // one-shot (adr-0014, adr-0017).
    signal podmanLaunchRequested()
    // Per-project compose actions name the project; the representation builds no command
    // and reaches for no data source -- it hands the project back to main.qml.
    signal composeStartRequested(string project)
    signal composeStopRequested(string project)

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

    // --- Middle-region sizing -------------------------------------------------
    // The height of one container row: the 32px glyph tile plus the 20px of
    // vertical padding the row's own layout carries (see containerRow below).
    // The scroll floor is written against this unit rather than as a magic
    // number, so "one and a half rows" survives a type-scale change.
    readonly property int containerRowHeight: 52

    // The collapse-all strip is card chrome, so its height is folded into the scroll floor:
    // ADR-0020 sized that floor at one and a half container rows so the next row always
    // peeks in, and letting the strip eat into it would quietly shrink the scroll area
    // instead of growing the popup once.
    readonly property int containerCollapseStripHeight: 32

    // The middle region never collapses below one and a half rows, so the bottom
    // half of the next row peeks in and the operator can tell there is more
    // below -- and that the region scrolls. The region also never drives the
    // widget's height (see the container section below), so a list that grows or
    // shrinks cannot resize the widget.
    readonly property int containerScrollFloor: fullRoot.containerRowHeight * 3 / 2 + fullRoot.containerCollapseStripHeight

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
    //
    // The width also takes a floor of its own: the popup is a FIXED 34 grid units
    // (Layout.preferredWidth below), and the widest natural-width child used to be
    // the footer's row. With the footer gone, a content-derived width collapses to
    // the card's gutters alone, so the wider of the two is what the card advertises.
    implicitWidth: Math.max(
        content.implicitWidth + content.anchors.leftMargin + content.anchors.rightMargin,
        Kirigami.Units.gridUnit * 34
    )
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

        // --- Status card -----------------------------------------------------
        // Pinned at the top of the column: it carries the whole daemon state and is
        // never part of a scroll region, so it stays put while the middle region
        // below scrolls.
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

                    // Relocated from the removed topbar (adr-0017): the in-flight busy
                    // state lives in the status card's head row now, so actionInFlight is
                    // never orphaned. Kept verbatim from the topbar it left.
                    PlasmaComponents3.BusyIndicator {
                        Layout.alignment: Qt.AlignVCenter
                        Layout.preferredWidth: Kirigami.Units.iconSizes.small
                        Layout.preferredHeight: Kirigami.Units.iconSizes.small
                        running: fullRoot.actionInFlight
                        visible: fullRoot.actionInFlight
                    }

                    // Relocated from the removed topbar (adr-0017) and rendered SQUARE: a
                    // 28x28 tile with no rounded radius (iconButtonRadius is 0). Kept a
                    // ToolButton so its ToolTip renders (a PlasmaComponents3.ToolTip only
                    // shows when its parent is an AbstractButton); the square surface is
                    // supplied by the overridden background, which reads the palette token.
                    PlasmaComponents3.ToolButton {
                        id: refreshButton
                        Layout.preferredWidth: 28
                        Layout.preferredHeight: 28
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

                    // Re-added to the popup as a SQUARE status-card button (adr-0017): its
                    // launch section was removed (adr-0016), so the launch returns here, the
                    // same 28x28 surface as the refresh button. main.qml owns the resolved
                    // path and the one-shot; this only emits the request.
                    PlasmaComponents3.ToolButton {
                        id: podmanButton
                        Layout.preferredWidth: 28
                        Layout.preferredHeight: 28
                        Layout.alignment: Qt.AlignVCenter
                        icon.name: "system-run"
                        icon.color: paletteTokens.iconButtonText
                        display: PlasmaComponents3.AbstractButton.IconOnly
                        flat: false
                        enabled: !fullRoot.podmanLaunchInFlight
                        opacity: enabled ? 1 : 0.38
                        onClicked: fullRoot.podmanLaunchRequested()

                        background: Rectangle {
                            radius: paletteTokens.iconButtonRadius
                            color: podmanButton.hovered ? paletteTokens.iconButtonSurfaceHover : paletteTokens.iconButtonSurface
                            border.width: paletteTokens.appBorderWidth
                            border.color: paletteTokens.line
                        }

                        PlasmaComponents3.ToolTip {
                            text: i18n("Open Podman Desktop")
                        }
                    }

                    // Shown ONLY while an update is actually available, so an offline machine, a
                    // missing curl or an unparseable manifest still renders nothing -- the silence
                    // contract of adr-0013 is unchanged. A click opens the release page: the widget's
                    // ONE browser-opening call, authorised by adr-0015 and pinned to the fixed
                    // DockerStatus.UPDATE_PAGE_URL constant, never to a value from configuration.
                    PlasmaComponents3.ToolButton {
                        Layout.alignment: Qt.AlignVCenter
                        Layout.preferredWidth: 24
                        Layout.preferredHeight: 24
                        visible: fullRoot.updateAvailable
                        icon.name: "emblem-important"
                        icon.color: Kirigami.Theme.negativeTextColor
                        display: PlasmaComponents3.AbstractButton.IconOnly
                        flat: true
                        onClicked: Qt.openUrlExternally(DockerStatus.UPDATE_PAGE_URL)

                        PlasmaComponents3.ToolTip {
                            text: i18n("A new version is available. Open the release page.")
                        }
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

                // A failed Podman launch is surfaced, never swallowed (adr-0014, adr-0017):
                // the same feedback contract the removed section used, restored as a small
                // row in the status card. Invisible rows take no layout space.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.topMargin: 9
                    visible: fullRoot.podmanLaunchFeedback !== ""
                    spacing: 6

                    SeverityDot {
                        Layout.alignment: Qt.AlignVCenter
                        severity: fullRoot.podmanLaunchFeedbackSeverity
                    }

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        text: fullRoot.podmanLaunchFeedback
                        color: paletteTokens.text
                        wrapMode: Text.WordWrap
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
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
                        // Space between the left border and the content, matching
                        // the 12px padding the text fields already carry.
                        leftPadding: 12
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
                        // Space between the left border and the content, matching
                        // the 12px padding the text fields already carry.
                        leftPadding: 12
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
        // The MIDDLE region of the popup: pinned between the status card above and
        // the Miscelanea section below. It fills whatever height the widget has and
        // scrolls its own content, so the list growing or shrinking never resizes
        // the widget, and it can never collapse below one and a half container rows
        // (containerScrollFloor) so the next row always peeks in.
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: fullRoot.containerScrollFloor
            Layout.preferredHeight: fullRoot.containerScrollFloor
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

                // The collapse-all action, as a compact strip above the list. It is an
                // ACTION, not a section header: adr-0016 removed the header row on purpose,
                // so this strip carries no title and no state of its own. Its click bumps
                // the root's generation counter; each group answers it by closing, and a
                // group's own ± can still reopen just that one (see the delegate below).
                Item {
                    Layout.fillWidth: true
                    implicitHeight: fullRoot.containerCollapseStripHeight
                    visible: fullRoot.containers.length > 0

                    PlasmaComponents3.ToolButton {
                        id: collapseAllButton
                        anchors.right: parent.right
                        anchors.rightMargin: 8
                        anchors.verticalCenter: parent.verticalCenter
                        text: i18n("Collapse all")
                        display: PlasmaComponents3.AbstractButton.TextOnly
                        flat: true
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                        Kirigami.Theme.textColor: paletteTokens.muted
                        onClicked: fullRoot.groupsCollapseEpoch += 1

                        PlasmaComponents3.ToolTip {
                            text: i18nc("@info", "Close every container group at once. Tap a group's ± to open just that one.")
                        }
                    }
                }

                // The grouped list: one collapsible group per compose project, the
                // standalone bucket last, exactly as DockerStatus.groupContainersByComposeProject()
                // returns them. The grouping is pure data prep done in the core, so this
                // view stays a renderer and never reaches for a data source.
                ListView {
                    id: containerGroupList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    // No fixed cap any more: the list is the scrollable middle region,
                    // so it fills the card and scrolls when its content is taller,
                    // instead of capping itself at a fixed 13 grid units and growing the
                    // widget with the content.
                    clip: true
                    // An empty list hides the view and shows the empty state below
                    // instead. With the section header gone there is no collapse gate
                    // left to read: the list is either there or the empty state is.
                    visible: fullRoot.containers.length > 0
                    model: DockerStatus.groupContainersByComposeProject(fullRoot.containers)

                    delegate: Item {
                        id: containerGroup
                        required property var modelData

                        // Per-group open/closed view state, the same rule the section flags
                        // follow: local to this instantiated group, never persisted and never
                        // signalled. groupEpoch records the collapse-all generation the group
                        // last answered, so a group created after a collapse-all also starts
                        // closed.
                        property bool groupOpen: true
                        property int groupEpoch: 0
                        // What the body and the ± glyph read: the group's own state, gated on
                        // having answered every collapse-all so far. The group's own tap
                        // re-absorbs the current generation, so the ± always wins over the
                        // control.
                        readonly property bool groupBodyVisible: groupOpen && groupEpoch === fullRoot.groupsCollapseEpoch

                        // The standalone bucket carries no project name, so it shows a
                        // translated label instead of the empty string.
                        readonly property bool isComposeGroup: containerGroup.modelData.project !== DockerStatus.COMPOSE_PROJECT_STANDALONE
                        readonly property string headerTitle: containerGroup.isComposeGroup
                            ? containerGroup.modelData.project
                            : i18n("Other containers")
                        readonly property int runningCount: DockerStatus.countByState(containerGroup.modelData.containers, "running")

                        width: containerGroupList.width
                        implicitHeight: containerGroupColumn.implicitHeight

                        ColumnLayout {
                            id: containerGroupColumn
                            anchors.fill: parent
                            spacing: 0

                            // One-line group header: icon tile, project name, running/total
                            // count, the compose-only play/stop pair, and the +/- toggle
                            // last, exactly like the section headers.
                            Item {
                                Layout.fillWidth: true
                                implicitHeight: containerGroupHeaderRow.implicitHeight + 12

                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: {
                                        // Invert what the body does right now and answer every
                                        // collapse-all so far, so this tap owns the group from
                                        // here on: the ± closes its own group and nothing else.
                                        containerGroup.groupOpen = !containerGroup.groupBodyVisible
                                        containerGroup.groupEpoch = fullRoot.groupsCollapseEpoch
                                    }
                                }

                                RowLayout {
                                    id: containerGroupHeaderRow
                                    anchors.fill: parent
                                    // The header shares the container rows' gutter: the same
                                    // 8px inset containerRowLayout below carries, so a group
                                    // name and the rows it opens line up on one left edge and
                                    // nothing hugs the sunken card's border. It deliberately
                                    // rides on the ROW, not the wrapper Item above, because
                                    // that wrapper's full-width MouseArea is the group's tap
                                    // target and insetting it would shrink the tap area. The
                                    // merged Miscelanea header insets its wrapper's Layout
                                    // margins instead -- that convention is not copied here.
                                    anchors.leftMargin: 8
                                    anchors.rightMargin: 8
                                    anchors.topMargin: 6
                                    anchors.bottomMargin: 6
                                    spacing: 12

                                    // The group's identity tile: the widget's own
                                    // bundled box glyph on the same tile style a
                                    // container row uses -- 28px here, matching the
                                    // row's flat controls -- so a group reads as a
                                    // grouping of those rows rather than as a second
                                    // kind of card. Resolved from the package, never
                                    // fetched from anywhere.
                                    Rectangle {
                                        Layout.preferredWidth: 28
                                        Layout.preferredHeight: 28
                                        Layout.alignment: Qt.AlignVCenter
                                        radius: paletteTokens.tileRadius
                                        color: paletteTokens.iconTileSurface

                                        Kirigami.Icon {
                                            anchors.centerIn: parent
                                            source: Qt.resolvedUrl("../icons/dockerstatus.svg")
                                            color: paletteTokens.iconTileText
                                            implicitWidth: 16
                                            implicitHeight: 16
                                        }
                                    }

                                    PlasmaComponents3.Label {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                        text: containerGroup.headerTitle
                                        color: paletteTokens.text
                                        elide: Text.ElideMiddle
                                        font.family: paletteTokens.fontFamily
                                        font.pixelSize: paletteTokens.labelPixelSize
                                        font.weight: 600
                                    }

                                    PlasmaComponents3.Label {
                                        Layout.alignment: Qt.AlignVCenter
                                        text: containerGroup.runningCount + "/" + containerGroup.modelData.containers.length
                                        color: paletteTokens.muted
                                        font.family: paletteTokens.fontFamily
                                        font.pixelSize: paletteTokens.subtlePixelSize
                                    }

                                    // Compose-only play control. Disabled while anything is
                                    // in flight and when every container is already running:
                                    // `docker start` on a fully-running stack is a no-op, so
                                    // the button says so by going inert instead of silently
                                    // doing nothing. Flat and icon-only: a 28px muted glyph
                                    // beside the group name, not a second mint slab.
                                    PlasmaComponents3.ToolButton {
                                        id: composeStartButton
                                        Layout.preferredWidth: 28
                                        Layout.preferredHeight: 28
                                        Layout.alignment: Qt.AlignVCenter
                                        visible: containerGroup.isComposeGroup
                                        icon.name: "media-playback-start"
                                        icon.color: paletteTokens.iconButtonText
                                        display: PlasmaComponents3.AbstractButton.IconOnly
                                        flat: true
                                        enabled: !fullRoot.composeActionInFlight
                                            && containerGroup.runningCount !== containerGroup.modelData.containers.length
                                        opacity: enabled ? 1 : 0.38
                                        onClicked: fullRoot.composeStartRequested(containerGroup.modelData.project)

                                        PlasmaComponents3.ToolTip {
                                            text: i18nc("@info", "Start %1", containerGroup.modelData.project)
                                        }
                                    }

                                    // Compose-only stop control, the mirror of the play
                                    // gate: with nothing running, `docker stop` would be a
                                    // no-op, so the button is disabled rather than live.
                                    PlasmaComponents3.ToolButton {
                                        id: composeStopButton
                                        Layout.preferredWidth: 28
                                        Layout.preferredHeight: 28
                                        Layout.alignment: Qt.AlignVCenter
                                        visible: containerGroup.isComposeGroup
                                        icon.name: "media-playback-stop"
                                        icon.color: paletteTokens.iconButtonText
                                        display: PlasmaComponents3.AbstractButton.IconOnly
                                        flat: true
                                        enabled: !fullRoot.composeActionInFlight
                                            && containerGroup.runningCount !== 0
                                        opacity: enabled ? 1 : 0.38
                                        onClicked: fullRoot.composeStopRequested(containerGroup.modelData.project)

                                        PlasmaComponents3.ToolTip {
                                            text: i18nc("@info", "Stop %1", containerGroup.modelData.project)
                                        }
                                    }

                                    // The open/close affordance, pixel-identical to the
                                    // merged Miscelánea section header and deliberately
                                    // LAST in the row, so a group collapse reads the same
                                    // as a section collapse.
                                    Item {
                                        Layout.alignment: Qt.AlignVCenter
                                        implicitWidth: groupToggleGlow.implicitWidth
                                        implicitHeight: groupToggleGlow.implicitHeight

                                        Text {
                                            id: groupToggleGlow
                                            anchors.centerIn: parent
                                            text: containerGroup.groupBodyVisible ? "−" : "+"
                                            color: paletteTokens.toggleIndicator
                                            opacity: 0.3
                                            font.family: paletteTokens.fontFamily
                                            font.pixelSize: paletteTokens.toggleIndicatorPixelSize + 5
                                        }

                                        Text {
                                            anchors.centerIn: parent
                                            text: groupToggleGlow.text
                                            color: paletteTokens.toggleIndicator
                                            font.family: paletteTokens.fontFamily
                                            font.pixelSize: paletteTokens.toggleIndicatorPixelSize
                                        }
                                    }
                                }
                            }

                            // The group body: the container rows, unchanged from the old
                            // flat list. Gated on the group's derived visibility alone: the
                            // section itself has no collapse state left to AND in here, and
                            // the derived flag folds in the collapse-all generation.
                            ColumnLayout {
                                Layout.fillWidth: true
                                visible: containerGroup.groupBodyVisible
                                spacing: 0

                                Repeater {
                                    model: containerGroup.modelData.containers

                                    delegate: Item {
                                        id: containerRow
                                        required property var modelData

                                        Layout.fillWidth: true
                                        implicitHeight: containerRowLayout.implicitHeight + 20

                                        // Faint hover tint behind the row, exactly as the mockup.
                                        Rectangle {
                                            anchors.fill: parent
                                            radius: paletteTokens.tileRadius
                                            color: rowHover.containsMouse ? paletteTokens.rowHoverTint : "transparent"
                                        }

                                        // Hover-only: the row is not clickable, so the area
                                        // accepts no button and never swallows events aimed at
                                        // the list behind it.
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
                            }
                        }
                    }
                }

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    Layout.margins: 20
                    // The counterpart of the list's own gate above: an empty list shows
                    // the empty state instead, with no section flag to keep it shut.
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

                // Feedback for a per-project start/stop, in the same shape as the
                // download row's feedback: a SeverityDot carries the severity and the
                // label wraps the engine's own message.
                RowLayout {
                    Layout.fillWidth: true
                    Layout.leftMargin: 16
                    Layout.rightMargin: 16
                    Layout.topMargin: 8
                    Layout.bottomMargin: 16
                    visible: fullRoot.composeActionFeedback !== ""
                    spacing: 6

                    SeverityDot {
                        Layout.alignment: Qt.AlignVCenter
                        severity: fullRoot.composeActionFeedbackSeverity
                    }

                    PlasmaComponents3.Label {
                        Layout.fillWidth: true
                        text: fullRoot.composeActionFeedback
                        color: paletteTokens.text
                        wrapMode: Text.WordWrap
                        font.family: paletteTokens.fontFamily
                        font.pixelSize: paletteTokens.subtlePixelSize
                    }
                }
            }
        }

        // --- Update notice ---------------------------------------------------
        // Shown ONLY when an update is actually available, on the same
        // fullRoot.updateAvailable gate the indicator above reads, so an offline
        // machine, a missing curl or an unparseable manifest renders nothing at
        // all -- this line is the feature's entire footprint. It is deliberately
        // NOT a button and NOT a SeverityDot: it is neither a health state nor a
        // link. The one click target this file owns is the indicator beside the
        // daemon status above, and it is pinned to the fixed release-page constant.
        //
        // It occupies a RESERVED row of one grid unit between the scroll region and
        // the pinned Miscelanea section: the text is emptied rather than the label
        // being hidden, so the row is blank until an update exists and the widget
        // never grows by a line when one appears.
        PlasmaComponents3.Label {
            Layout.fillWidth: true
            Layout.preferredHeight: Kirigami.Units.gridUnit
            text: fullRoot.updateAvailable ? fullRoot.updateFeedback : ""
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
            color: paletteTokens.muted
            opacity: 0.5
            font.family: paletteTokens.fontFamily
            font.pixelSize: paletteTokens.subtlePixelSize
        }

        // --- Miscelanea section -----------------------------------------------
        // Pinned at the bottom of the column (its last child) and never part of the
        // scroll region: it stays put while the middle region above scrolls.
        // One merged, collapsible card (adr-0019-miscelanea-section-merge) that holds
        // BOTH blocks the popup used to render as two separate collapsible sections: the
        // video-download row and the "Countdown to Extinction" shutdown controls. The
        // single header below collapses or expands both together. Each block keeps its
        // own inner title, so the two remain legible inside the one card, and the
        // countdown's 35x35 timer tile moves inside the body with its title as the
        // countdown's identity.
        //
        // The download sub-block keeps its own visible gate (the downloaderEnabled
        // setting), so the whole sub-block, its inner title and its trailing hairline
        // disappear together when the setting is off. The countdown is unconditional, so
        // the merged card itself carries NO visible gate: only the one detail below reads
        // the collapse flag, and even that is overridden while a shutdown is pending (see
        // miscBodyVisible above).
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: miscBody.implicitHeight
            radius: paletteTokens.cardRadius
            border.width: paletteTokens.appBorderWidth
            border.color: paletteTokens.line
            color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
            clip: true

            ColumnLayout {
                id: miscBody
                anchors.fill: parent
                spacing: 0

                // Single-row header for the merged section: the "Miscelánea" title and
                // the right-side toggle on one line, no subtitle. The toggle states the
                // section's open/closed state directly and collapses BOTH sub-blocks.
                //
                // The row is wrapped in a plain Item so tapping the header can collapse
                // the body below it. The wrapper -- a direct child of this ColumnLayout
                // -- carries the horizontal insets the RowLayout used to, and the
                // RowLayout fills the wrapper, keeping its vertical insets as anchor
                // margins. The header and separator never collapse. This is the one
                // header whose gutter rides on the wrapper: the per-group header's
                // gutter rides on its row's anchors instead, so that row's full-width
                // tap target stays full-width (see the container group header above).
                Item {
                    Layout.fillWidth: true
                    Layout.leftMargin: 16
                    Layout.rightMargin: 16
                    implicitHeight: miscHeaderRow.implicitHeight + 24

                    // The whole header strip is the tap target, including the 16px
                    // gutters and the vertical padding. This MouseArea is the ONLY writer
                    // of miscSectionExpanded.
                    MouseArea {
                        anchors.fill: parent
                        onClicked: fullRoot.miscSectionExpanded = !fullRoot.miscSectionExpanded
                    }

                    RowLayout {
                        id: miscHeaderRow
                        anchors.fill: parent
                        anchors.topMargin: 12
                        anchors.bottomMargin: 12
                        spacing: 12

                        PlasmaComponents3.Label {
                            Layout.fillWidth: true
                            text: i18n("Miscelánea")
                            color: paletteTokens.text
                            elide: Text.ElideRight
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.sectionTitlePixelSize
                            font.weight: 650
                        }

                        // The open/close affordance, identical to the per-compose-group
                        // header's: the MINUS sign (U+2212) when the body is open and a
                        // plus when it is collapsed, with a larger low-opacity copy of the
                        // same glyph behind it as a crude halo. Two plain Text items, no
                        // shader effect and no extra import.
                        //
                        // It reads miscBodyVisible, NOT the raw section bool: the glyph has
                        // to describe what the user can actually see. While a shutdown is
                        // pending or a download is in flight the body is un-collapsible, so
                        // the affordance must show the open state -- a minus next to hidden
                        // controls would be a lie, and could read as "collapse the countdown
                        // away" or "collapse the live STOP away".
                        Item {
                            Layout.alignment: Qt.AlignVCenter
                            implicitWidth: miscToggleGlow.implicitWidth
                            implicitHeight: miscToggleGlow.implicitHeight

                            Text {
                                id: miscToggleGlow
                                anchors.centerIn: parent
                                text: fullRoot.miscBodyVisible ? "−" : "+"
                                color: paletteTokens.toggleIndicator
                                opacity: 0.3
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.toggleIndicatorPixelSize + 5
                            }

                            Text {
                                anchors.centerIn: parent
                                text: miscToggleGlow.text
                                color: paletteTokens.toggleIndicator
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.toggleIndicatorPixelSize
                            }
                        }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 1
                    color: paletteTokens.line
                }

                // Collapsed by a tap on the header above. Nothing inside is deleted --
                // both sub-blocks are only gated on this one flag, so reopening restores
                // them exactly as they were.
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.margins: 16
                    visible: fullRoot.miscBodyVisible
                    spacing: 8

                    // Download sub-block: the one place this widget accepts input. The URL
                    // is validated twice: here, to arm the button and to show a hint; and
                    // again inside buildVideoDownloadCommand(), which refuses it and
                    // shell-quotes it before it becomes a command. An unsupported paste is
                    // reported, never silently ignored.
                    //
                    // The sub-block carries the old card's chrome: the downloaderEnabled
                    // gate moves here, so the inner title, the rows and the trailing
                    // hairline all disappear together when the setting is off.
                    ColumnLayout {
                        Layout.fillWidth: true
                        visible: fullRoot.downloaderEnabled
                        spacing: 8

                        PlasmaComponents3.Label {
                            text: i18n("Import content")
                            color: paletteTokens.text
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.sectionTitlePixelSize
                            font.weight: 650
                        }

                        // The title doubles as the hover target for the configured download
                        // folder, because a PlasmaComponents3.ToolTip renders ONLY when its
                        // parent is an AbstractButton (ToolTip.qml:
                        // `visible: parent instanceof T.AbstractButton`). Hanging a ToolTip
                        // off the Label this used to be would be a silent no-op, so the label
                        // becomes a flat, transparent, focus-less ToolButton that exists purely
                        // to be the ToolTip's legal parent. TextOnly is deliberate: there is no
                        // icon, so TextBesideIcon would reserve icon space for nothing.
                        PlasmaComponents3.ToolButton {
                            id: downloadDirectoryTitle
                            display: PlasmaComponents3.AbstractButton.TextOnly
                            flat: true
                            // A label that steals tab focus would be a regression.
                            focusPolicy: Qt.NoFocus
                            text: i18n("YouTube or X URL")
                            // The label's type is kept verbatim, so the control reads as the
                            // plain label it replaced.
                            font.family: paletteTokens.fontFamily
                            font.pixelSize: paletteTokens.labelPixelSize
                            font.weight: 650
                            // A ToolButton carries padding a Label did not, so it is zeroed
                            // to leave the title's geometry unchanged.
                            leftPadding: 0
                            rightPadding: 0
                            topPadding: 0
                            bottomPadding: 0
                            Kirigami.Theme.textColor: paletteTokens.labelText
                            // Invisible as a button: no surface, and no colour change on
                            // hover or press -- the mockup's fixed palette governs.
                            background: Rectangle {
                                color: "transparent"
                            }

                            PlasmaComponents3.ToolTip {
                                // An empty text keeps the ToolTip invisible, so nothing is
                                // shown until the one-shot has answered $HOME.
                                text: fullRoot.downloadDirectoryDisplay !== ""
                                    ? i18nc("@info:tooltip", "Download folder: %1", fullRoot.downloadDirectoryDisplay)
                                    : ""
                            }
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
                                // Space between the left border and the content,
                                // matching the 12px padding the text fields already
                                // carry.
                                leftPadding: 12
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

                        // The row IS the notification, and it is live (adr-0022): its leading
                        // slot carries the busy indicator while a download is in flight and the
                        // severity dot otherwise, so the row appears in the same synchronous
                        // turn as the click and never depends on the Import button's own
                        // geometry. The fixed-width wrapper reserves the small-icon slot in
                        // both states, so swapping the 6px dot for the 16px spinner cannot
                        // reflow the row. The dot carries the severity, exactly as in the
                        // header: no second severity-to-colour switch is allowed to exist, and
                        // the severity stays NEUTRAL in flight.
                        RowLayout {
                            Layout.fillWidth: true
                            visible: fullRoot.downloadFeedback !== ""
                            spacing: 6

                            Item {
                                Layout.alignment: Qt.AlignVCenter
                                implicitWidth: Kirigami.Units.iconSizes.small
                                implicitHeight: Kirigami.Units.iconSizes.small

                                PlasmaComponents3.BusyIndicator {
                                    anchors.centerIn: parent
                                    width: Kirigami.Units.iconSizes.small
                                    height: Kirigami.Units.iconSizes.small
                                    running: fullRoot.downloadInFlight
                                    visible: fullRoot.downloadInFlight
                                }

                                SeverityDot {
                                    anchors.centerIn: parent
                                    visible: !fullRoot.downloadInFlight
                                    severity: fullRoot.downloadFeedbackSeverity
                                }
                            }

                            PlasmaComponents3.Label {
                                Layout.fillWidth: true
                                text: fullRoot.downloadFeedback
                                color: paletteTokens.text
                                wrapMode: Text.WordWrap
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.subtlePixelSize
                            }

                            // Appended so it sits on the row's right edge: the label above
                            // fills the width, which pushes this control into the corner. Only a
                            // SUCCESSFUL download offers the shortcut -- a failed download
                            // (negative severity) and an in-flight/neutral state must never look
                            // like there is a file to open -- and only once $HOME gave a usable
                            // path (downloadFolderUrl !== ""), the belt-and-braces gate the
                            // disabled state repeats.
                            //
                            // It is no longer the row's LAST child: the live STOP and the dismiss X
                            // follow it, the X last of all, so the dismiss sits on the far right
                            // edge (adr-0022).
                            PlasmaComponents3.ToolButton {
                                Layout.alignment: Qt.AlignVCenter
                                Layout.preferredWidth: 24
                                Layout.preferredHeight: 24
                                icon.name: "folder-open"
                                icon.color: paletteTokens.text
                                display: PlasmaComponents3.AbstractButton.IconOnly
                                flat: true
                                visible: fullRoot.downloadFeedback !== ""
                                    && fullRoot.downloadFeedbackSeverity === DockerStatus.SEVERITY_POSITIVE
                                    && fullRoot.downloadFolderUrl !== ""
                                enabled: fullRoot.downloadFolderUrl !== ""
                                // The widget's SECOND Qt.openUrlExternally call site; the first
                                // is the update indicator opening the fixed
                                // DockerStatus.UPDATE_PAGE_URL release page. This URL is built by
                                // DockerStatus.buildFolderUrl() from the RESOLVED configured
                                // directory -- a file:// target, never a browser page and never a
                                // raw configuration value.
                                onClicked: Qt.openUrlExternally(fullRoot.downloadFolderUrl)

                                PlasmaComponents3.ToolTip {
                                    text: i18n("Open the download folder")
                                }
                            }

                            // The row's cancel, on the right edge and shown ONLY while a download
                            // is in flight: a flat, icon-only 24x24 process-stop. It emits and
                            // builds no command -- main.qml owns the stop one-shot (adr-0022) --
                            // and it is deliberately NOT one of the widget's two
                            // Qt.openUrlExternally call sites. Enabled goes inert while the stop
                            // itself is settling, so one gesture cannot fire two kill-and-sweeps.
                            PlasmaComponents3.ToolButton {
                                Layout.alignment: Qt.AlignVCenter
                                Layout.preferredWidth: 24
                                Layout.preferredHeight: 24
                                icon.name: "process-stop"
                                icon.color: paletteTokens.text
                                display: PlasmaComponents3.AbstractButton.IconOnly
                                flat: true
                                visible: fullRoot.downloadInFlight
                                enabled: !fullRoot.downloadStopInFlight
                                onClicked: fullRoot.downloadStopRequested()

                                PlasmaComponents3.ToolTip {
                                    text: i18n("Cancel the download and remove the partial file")
                                }
                            }

                            // The dismiss X, the row's LAST child and therefore its far-right
                            // control, shown ONLY when no download is in flight. An X that
                            // silently cancelled-and-deleted would risk an in-progress download,
                            // so the two controls are mutually exclusive and the row never shows
                            // two dismiss-ish controls at once (adr-0022).
                            PlasmaComponents3.ToolButton {
                                Layout.alignment: Qt.AlignVCenter
                                Layout.preferredWidth: 24
                                Layout.preferredHeight: 24
                                icon.name: "window-close"
                                icon.color: paletteTokens.text
                                display: PlasmaComponents3.AbstractButton.IconOnly
                                flat: true
                                visible: !fullRoot.downloadInFlight
                                    && fullRoot.downloadFeedback !== ""
                                onClicked: fullRoot.downloadDismissed()

                                PlasmaComponents3.ToolTip {
                                    text: i18n("Dismiss")
                                }
                            }
                        }

                        // Hairline closing the download sub-block, separating it from the
                        // countdown sub-block below. It is the download sub-block's LAST
                        // child, so it disappears with the sub-block when the downloader is
                        // turned off and never leaves a dangling rule.
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 1
                            color: paletteTokens.line
                        }
                    }

                    // Countdown sub-block. The countdown itself is owned by main.qml: this
                    // representation only renders the local deadline and emits start/stop.
                    // Play disables the instant the sequence starts, so it can only ever be
                    // armed once; stop is the only way to cancel and, because cancel is
                    // purely local, it needs no privilege. The power-off adds no polkit rule
                    // and does not widen the grant (ALLOWED_VERBS stays ["start"]); unlike
                    // the daemon stop it does not prompt, because logind's default policy
                    // for org.freedesktop.login1.power-off is allow_active=yes. The
                    // safeguards are the deliberate activation, the more-than-10-minute
                    // countdown, the visible countdown and the cancel button, not a password
                    // gate (adr-0009). The 35x35 timer tile beside the inner title is the
                    // countdown's identity and moves inside the body with it.
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 8

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 12

                            PlasmaComponents3.Label {
                                Layout.fillWidth: true
                                text: i18n("Countdown to Extinction")
                                color: paletteTokens.text
                                elide: Text.ElideRight
                                font.family: paletteTokens.fontFamily
                                font.pixelSize: paletteTokens.sectionTitlePixelSize
                                font.weight: 650
                            }

                            Rectangle {
                                Layout.preferredWidth: 35
                                Layout.preferredHeight: 35
                                Layout.alignment: Qt.AlignVCenter
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
                            visible: fullRoot.miscBodyVisible
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
                            visible: fullRoot.miscBodyVisible
                            spacing: 9

                            PlasmaComponents3.Button {
                                id: shutdownPlayButton
                                Layout.fillWidth: true
                                icon.name: "media-playback-start"
                                icon.color: paletteTokens.buttonPrimaryText
                                // Space between the left border and the content, matching
                                // the 12px padding the text fields already carry.
                                leftPadding: 12
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
                                // Space between the left border and the content, matching
                                // the 12px padding the text fields already carry.
                                leftPadding: 12
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
                            // Ungated by the collapse flag on purpose: this line only exists
                            // while a shutdown is pending, and that armed state must never be
                            // collapsed away (adr-0009's visible-countdown safeguard).
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
                            // Two gates, and this row has to be hidden twice over: the field's
                            // own value must be invalid, and the section must be visible. The
                            // invalid test leads on purpose, because a static-text test pins
                            // this exact expression -- rewording it into a different shape
                            // would silently drop that pin instead of failing.
                            visible: !fullRoot.shutdownMinutesFieldValid && fullRoot.miscBodyVisible
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
                            visible: fullRoot.miscBodyVisible && fullRoot.shutdownFeedback !== ""
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
            }
        }
    }
}
