import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents3

import "dockerstatus.js" as DockerStatus

/*
 * Popup / desktop representation.
 *
 * Two things worth knowing about the action row:
 *  - There IS a stop button, but it never fires on one click: stopping the
 *    daemon is destructive to every running container, so the first click arms
 *    a confirmation, a deliberate second click confirms, and the arming expires
 *    on its own.
 *  - Swallowing failures. When the privileged start fails, the exit code and
 *    stderr are shown verbatim, so a polkit denial is visible instead of the
 *    button appearing to do nothing.
 */
ColumnLayout {
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

    spacing: Kirigami.Units.smallSpacing

    Layout.preferredWidth: Kirigami.Units.gridUnit * 16
    Layout.minimumWidth: Kirigami.Units.gridUnit * 12

    // --- Header --------------------------------------------------------------
    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        SeverityDot {
            Layout.alignment: Qt.AlignVCenter
            severity: DockerStatus.daemonSeverity(fullRoot.daemonState)
        }

        PlasmaComponents3.Label {
            Layout.fillWidth: true
            text: fullRoot.daemonRunning
                ? i18n("Docker daemon is running")
                : i18nc("@info", "Docker daemon is %1", fullRoot.daemonState)
        }

        PlasmaComponents3.ToolButton {
            icon.name: "view-refresh"
            display: PlasmaComponents3.AbstractButton.IconOnly
            onClicked: fullRoot.refreshRequested()

            PlasmaComponents3.ToolTip {
                text: i18n("Refresh now")
            }
        }
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: fullRoot.daemonRunning
        text: i18nc("@info", "Containers running: %1", DockerStatus.summarizeContainers(fullRoot.containers))
        opacity: 0.7
        font: Kirigami.Theme.smallFont
    }

    // --- Action --------------------------------------------------------------
    // Both buttons are always visible, so the position never moves; only the enabled
    // state and the label change. Stop never fires on the first click: requestStop()
    // arms it and the second click confirms.
    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.Button {
            Layout.fillWidth: true
            icon.name: "media-playback-start"
            text: fullRoot.startInFlight
                ? i18n("Starting…")
                : i18n("Start daemon")
            enabled: !fullRoot.actionInFlight && !fullRoot.daemonRunning
            onClicked: fullRoot.startRequested()
        }

        PlasmaComponents3.Button {
            icon.name: "media-playback-stop"
            // The narrow fixed width is deliberate: it keeps the destructive action's
            // button visually smaller than Start, and the row never reflows between
            // "Stop daemon" and "Confirm stop".
            Layout.fillWidth: false
            Layout.preferredWidth: Kirigami.Units.gridUnit * 7
            text: fullRoot.stopInFlight
                ? i18n("Stopping…")
                : (fullRoot.stopArmed ? i18n("Confirm stop") : i18n("Stop daemon"))
            enabled: !fullRoot.actionInFlight && fullRoot.daemonRunning
            onClicked: fullRoot.requestStop()
        }
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: fullRoot.stopArmed
        text: i18n("Stopping the daemon stops every running container. Press again to confirm.")
        color: Kirigami.Theme.negativeTextColor
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
    }

    PlasmaComponents3.BusyIndicator {
        Layout.alignment: Qt.AlignHCenter
        Layout.preferredWidth: Kirigami.Units.iconSizes.small
        Layout.preferredHeight: Kirigami.Units.iconSizes.small
        running: fullRoot.actionInFlight
        visible: fullRoot.actionInFlight
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: fullRoot.actionFeedback !== ""
        text: fullRoot.actionFeedback
        color: Kirigami.Theme.negativeTextColor
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
    }

    // --- Container list ------------------------------------------------------
    Rectangle {
        Layout.fillWidth: true
        Layout.preferredHeight: 1
        color: Kirigami.Theme.disabledTextColor
        opacity: 0.3
        visible: fullRoot.containerListEnabled && fullRoot.containers.length > 0
    }

    ListView {
        id: containerList
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(contentHeight, Kirigami.Units.gridUnit * 10)
        clip: true
        visible: fullRoot.containerListEnabled && fullRoot.containers.length > 0
        model: fullRoot.containers

        delegate: RowLayout {
            required property var modelData

            width: containerList.width
            spacing: Kirigami.Units.smallSpacing

            SeverityDot {
                Layout.alignment: Qt.AlignVCenter
                severity: DockerStatus.containerSeverity(modelData.state)
            }

            PlasmaComponents3.Label {
                Layout.fillWidth: true
                text: modelData.name
                elide: Text.ElideMiddle
            }

            PlasmaComponents3.Label {
                text: modelData.state
                opacity: 0.7
                font: Kirigami.Theme.smallFont
            }
        }
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.smallSpacing
        visible: fullRoot.containerListEnabled && fullRoot.containers.length === 0
        text: fullRoot.daemonRunning
            ? i18n("No containers found.")
            : i18n("Start the daemon to list containers.")
        opacity: 0.7
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
    }

    // --- Video download ------------------------------------------------------
    // The one place this widget accepts input. The URL is validated twice: here, to
    // arm the button and to show a hint; and again inside
    // buildVideoDownloadCommand(), which refuses it and shell-quotes it before it
    // becomes a command. An unsupported paste is reported, never silently ignored.
    Rectangle {
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.smallSpacing
        Layout.preferredHeight: 1
        color: Kirigami.Theme.disabledTextColor
        opacity: 0.3
        visible: fullRoot.downloaderEnabled
    }

    RowLayout {
        Layout.fillWidth: true
        visible: fullRoot.downloaderEnabled
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.TextField {
            id: videoUrlField
            Layout.fillWidth: true
            placeholderText: i18n("Paste a YouTube or X link")
            enabled: !fullRoot.downloadInFlight
            onAccepted: {
                if (downloadButton.enabled) {
                    fullRoot.downloadRequested(videoUrlField.text);
                }
            }
        }

        PlasmaComponents3.ToolButton {
            id: downloadButton
            icon.name: "download"
            display: PlasmaComponents3.AbstractButton.IconOnly
            // Enabled for an unsupported paste too, on purpose: a click then reports
            // why it was refused instead of the button looking dead.
            enabled: !fullRoot.downloadInFlight
                && fullRoot.downloadReady
                && videoUrlField.text.trim() !== ""
            onClicked: fullRoot.downloadRequested(videoUrlField.text)

            // A PC3 ToolTip only renders when its parent is an AbstractButton, so this
            // one works here and would not work on the TextField above.
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
        visible: fullRoot.downloaderEnabled
        text: fullRoot.cookiesBrowserDisplay !== ""
            ? i18nc("@info", "Cookies from: %1", fullRoot.cookiesBrowserDisplay)
            : i18nc("@info", "Cookies: not used")
        opacity: 0.7
        font: Kirigami.Theme.smallFont
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: fullRoot.downloaderEnabled && fullRoot.pastedLinkUnsupported
        text: i18n("Only YouTube and X (Twitter) links are supported.")
        color: Kirigami.Theme.negativeTextColor
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
    }

    // The dot carries the severity, exactly as in the header: no second
    // severity-to-colour switch is allowed to exist.
    RowLayout {
        Layout.fillWidth: true
        visible: fullRoot.downloaderEnabled && fullRoot.downloadFeedback !== ""
        spacing: Kirigami.Units.smallSpacing

        SeverityDot {
            Layout.alignment: Qt.AlignVCenter
            severity: fullRoot.downloadFeedbackSeverity
        }

        PlasmaComponents3.Label {
            Layout.fillWidth: true
            text: fullRoot.downloadFeedback
            wrapMode: Text.WordWrap
            font: Kirigami.Theme.smallFont
        }
    }

    // --- Countdown to Extinction ---------------------------------------------
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
        Layout.topMargin: Kirigami.Units.smallSpacing
        Layout.preferredHeight: 1
        color: Kirigami.Theme.disabledTextColor
        opacity: 0.3
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        text: i18n("Countdown to Extinction")
        font.bold: true
    }

    // The countdown length is editable here, not only in the config page, because this is
    // the surface where the play button and its disabled state actually live. The field
    // deliberately refuses no keystrokes: a non-number has to be typeable so the error cue
    // below can explain why play is disabled. The seed/sync pair exists because a plain
    // `text:` binding would be destroyed by the first user edit -- the same trap the config
    // page's cookies combo documents -- so the stored value is copied in once and afterwards
    // only mirrored while the field is unfocused.
    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.Label {
            text: i18n("Minutes until power-off:")
        }

        PlasmaComponents3.TextField {
            id: shutdownMinutesField
            Layout.fillWidth: false
            Layout.preferredWidth: Kirigami.Units.gridUnit * 5
            placeholderText: i18n("15")
            // Disabled while a countdown is pending or in flight: the deadline is snapshotted
            // in main.qml, so editing here could only imply a running deadline would change.
            enabled: !fullRoot.shutdownPending && !fullRoot.shutdownInFlight
            // No new severity mapping: an invalid value just tints the text, and the hint
            // below says what to fix. The dot stays reserved for status severity.
            color: fullRoot.shutdownMinutesFieldValid ? Kirigami.Theme.textColor : Kirigami.Theme.negativeTextColor

            // seeded flips LAST in Component.onCompleted, after programmatic is cleared, so
            // the seed write can never look like a user edit and emit.
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

            // A stored value that changed while this field had focus would otherwise never be
            // mirrored: onShutdownMinutesTextChanged skips a focused field, and nothing re-runs
            // on blur. Only a VALID text is mirrored -- invalid text is the user's to fix and
            // must stay visible, and a valid user-typed value is already persisted, so a
            // valid-but-different text on blur can only be an external change that was missed.
            onActiveFocusChanged: {
                if (activeFocus || !shutdownMinutesField.seeded || shutdownMinutesField.programmatic) return;
                if (shutdownMinutesField.text === fullRoot.shutdownMinutesText) return;
                if (DockerStatus.resolveShutdownMinutes(shutdownMinutesField.text) === null) return;
                shutdownMinutesField.programmatic = true;
                shutdownMinutesField.text = fullRoot.shutdownMinutesText;
                shutdownMinutesField.programmatic = false;
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.Button {
            Layout.fillWidth: true
            icon.name: "media-playback-start"
            text: fullRoot.shutdownPending
                ? i18n("Shutting down…")
                : i18n("Shut down")
            enabled: fullRoot.shutdownPlayEnabled
            onClicked: fullRoot.shutdownStartRequested()

            PlasmaComponents3.ToolTip {
                text: i18nc("@info", "Arm a %1-minute countdown; the machine powers off when it expires", fullRoot.shutdownMinutes)
            }
        }

        PlasmaComponents3.Button {
            Layout.fillWidth: false
            Layout.preferredWidth: Kirigami.Units.gridUnit * 7
            icon.name: "media-playback-stop"
            text: i18n("Cancel")
            enabled: fullRoot.shutdownPending
            onClicked: fullRoot.shutdownStopRequested()

            PlasmaComponents3.ToolTip {
                text: i18n("Cancel the pending shutdown")
            }
        }
    }

    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: fullRoot.shutdownPending
        text: i18nc("@info", "Powering off in %1", DockerStatus.formatCountdown(fullRoot.shutdownRemainingSeconds))
        opacity: 0.7
        font: Kirigami.Theme.smallFont
    }

    // A disabled play button must never look dead without a reason: the inline value that
    // failed validation says what to fix. The countdown is now editable on this surface, so
    // pointing at the config page would be stale.
    PlasmaComponents3.Label {
        Layout.fillWidth: true
        visible: !fullRoot.shutdownMinutesFieldValid
        text: i18n("Enter a whole number of minutes greater than 10.")
        color: Kirigami.Theme.negativeTextColor
        wrapMode: Text.WordWrap
        font: Kirigami.Theme.smallFont
    }

    // The dot carries the severity, exactly as in the header: no second
    // severity-to-colour switch is allowed to exist.
    RowLayout {
        Layout.fillWidth: true
        visible: fullRoot.shutdownFeedback !== ""
        spacing: Kirigami.Units.smallSpacing

        SeverityDot {
            Layout.alignment: Qt.AlignVCenter
            severity: fullRoot.shutdownFeedbackSeverity
        }

        PlasmaComponents3.Label {
            Layout.fillWidth: true
            text: fullRoot.shutdownFeedback
            wrapMode: Text.WordWrap
            font: Kirigami.Theme.smallFont
        }
    }

    // --- Tagline --------------------------------------------------------------
    // Configured text (default "Persiguiendo la singularidad"), not a status message: it is
    // deliberately muted so it never competes with the daemon state for the reader's
    // attention, and it disappears entirely when the setting is empty. This is the only
    // surface allowed to carry text -- the panel representation stays icon-sized.
    PlasmaComponents3.Label {
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.smallSpacing
        text: fullRoot.taglineText
        visible: fullRoot.taglineText !== ""
        horizontalAlignment: Text.AlignHCenter
        opacity: 0.5
        font: Kirigami.Theme.smallFont
    }
}
