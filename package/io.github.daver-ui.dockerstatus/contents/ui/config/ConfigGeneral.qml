import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kirigami as Kirigami

import "../dockerstatus.js" as DockerStatus

// The palette lives one directory up, in contents/ui/. QML's implicit
// same-directory import covers only this config/ directory, so the parent must
// be imported explicitly for DockerStatusPalette to resolve.
import ".."

/*
 * General configuration page.
 *
 * RESTYLE: the page now paints the mockup's fixed dark palette instead of the
 * Kirigami theme (see DockerStatusPalette.qml for why this is a sanctioned
 * override). Every colour below is read from that palette; the page no longer
 * follows the system colour scheme on purpose.
 *
 * The severity -> colour mapping still lives in SeverityDot.qml and nowhere
 * else. Nothing on this page is a severity today, but if a colour here ever
 * means severity it must be routed through that helper -- introducing a second
 * severity -> colour mapping in this file is forbidden.
 */
Kirigami.FormLayout {
    id: configPage

    // Plasma binds every "cfg_<entryName>" alias to the corresponding entry in
    // contents/config/main.xml. The alias target must stay a plain writable
    // property: aliasing an expression is a silent no-op on save.
    property alias cfg_pollIntervalSeconds: pollInterval.value
    property alias cfg_iconName: iconName.text
    property alias cfg_showContainerList: showContainerList.checked
    property alias cfg_showVideoDownloader: showVideoDownloader.checked
    property alias cfg_downloadDirectory: downloadDirectory.text
    property alias cfg_jsRuntime: jsRuntime.text
    property alias cfg_ytDlpBinary: ytDlpBinary.text
    property alias cfg_taglineText: taglineText.text
    property alias cfg_shutdownCountdownMinutes: shutdownCountdownMinutes.text

    // The countdown setting is a String on purpose: its control is a plain TextField, so a
    // non-numeric value can reach this page and must be able to surface an error. An
    // Int/SpinBox could never produce one, which would make the error requirement vacuous.
    // The value is a local duration that never reaches a command; this same pure resolver
    // decides in main.qml whether the value can arm a countdown at all.
    readonly property bool shutdownMinutesValid: DockerStatus.resolveShutdownMinutes(configPage.cfg_shutdownCountdownMinutes) !== null

    // The one setting that is NOT an alias. Plasma hands every stored value to this page as an
    // initial property, and that write reaches an editText alias before the combo initialises:
    // the combo then adopts index 0 and rewrites editText to "brave", so the page opened on
    // "brave" -- and, because cfg_cookiesBrowser read editText back, saving the page wrote
    // "brave" over whatever was stored. A plain property survives the write and is what the
    // combo is seeded from below.
    property string cfg_cookiesBrowser

    // The page background is OPTIONAL and cheap. The mockup look -- the sanctioned
    // default -- paints the app's own dark surface behind the sections; flipping this
    // to false leaves only the Plasma host chrome, which is the one-line change the
    // pending decision needs.
    readonly property bool paintPageBackground: true

    // The FormLayout renders its label buddies as Kirigami Headings that take their
    // colour from the theme, not from a property we can reach; the mockup wants those
    // labels in the muted label colour, so the theme text colour is redirected here.
    // The controls below set their own colours explicitly and are unaffected.
    Kirigami.Theme.textColor: paletteTokens.labelText

    // Non-visual helper. It is a QtObject, so it lands in this layout's resources
    // (data) rather than its children and therefore claims no layout space.
    DockerStatusPalette {
        id: paletteTokens
    }

    // -------------------------------------------------------------------------
    // Sections. Each group is a rounded, hairline-bordered card holding a 13px
    // heading, an 11px muted subtitle and the controls, which stay in a nested
    // FormLayout so every control keeps its Kirigami.FormData.label pairing.
    // Kirigami.FormData.isSection makes the card span both form columns.
    // -------------------------------------------------------------------------

    // --- Docker --------------------------------------------------------------
    Rectangle {
        Kirigami.FormData.isSection: true
        Layout.fillWidth: true
        implicitWidth: Math.max(dockerBody.implicitWidth, Kirigami.Units.gridUnit * 16)
            + Kirigami.Units.largeSpacing * 4
        implicitHeight: dockerBody.implicitHeight + Kirigami.Units.largeSpacing * 4
        radius: paletteTokens.cardRadius
        // panelSunken at 45% over the page background, as in the mockup.
        color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.line

        ColumnLayout {
            id: dockerBody
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 2
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                text: i18n("Docker")
                color: paletteTokens.text
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.sectionTitlePixelSize
            }

            QQC2.Label {
                Layout.fillWidth: true
                text: i18n("How often the daemon state is polled.")
                color: paletteTokens.muted
                wrapMode: Text.WordWrap
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.subtlePixelSize
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing

                QQC2.SpinBox {
                    id: pollInterval
                    Kirigami.FormData.label: i18n("Poll interval (seconds):")
                    from: 1
                    to: 60
                    stepSize: 1

                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    palette.text: paletteTokens.text
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: pollInterval.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Docker state is re-read from systemd this often.")
                    QQC2.ToolTip.visible: hovered
                }
            }
        }
    }

    // --- Container list ------------------------------------------------------
    Rectangle {
        Kirigami.FormData.isSection: true
        Layout.fillWidth: true
        implicitWidth: Math.max(containersBody.implicitWidth, Kirigami.Units.gridUnit * 16)
            + Kirigami.Units.largeSpacing * 4
        implicitHeight: containersBody.implicitHeight + Kirigami.Units.largeSpacing * 4
        radius: paletteTokens.cardRadius
        color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.line

        ColumnLayout {
            id: containersBody
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 2
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                text: i18n("Container list")
                color: paletteTokens.text
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.sectionTitlePixelSize
            }

            QQC2.Label {
                Layout.fillWidth: true
                text: i18n("What the popup shows about your containers.")
                color: paletteTokens.muted
                wrapMode: Text.WordWrap
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.subtlePixelSize
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing

                QQC2.CheckBox {
                    id: showContainerList
                    Kirigami.FormData.label: i18n("Containers:")
                    text: i18n("List containers in the popup")

                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                }
            }
        }
    }

    // --- Video download ------------------------------------------------------
    Rectangle {
        Kirigami.FormData.isSection: true
        Layout.fillWidth: true
        implicitWidth: Math.max(videoBody.implicitWidth, Kirigami.Units.gridUnit * 16)
            + Kirigami.Units.largeSpacing * 4
        implicitHeight: videoBody.implicitHeight + Kirigami.Units.largeSpacing * 4
        radius: paletteTokens.cardRadius
        color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.line

        ColumnLayout {
            id: videoBody
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 2
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                text: i18n("Video download")
                color: paletteTokens.text
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.sectionTitlePixelSize
            }

            QQC2.Label {
                Layout.fillWidth: true
                text: i18n("Where and how yt-dlp fetches a pasted link.")
                color: paletteTokens.muted
                wrapMode: Text.WordWrap
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.subtlePixelSize
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing

                QQC2.CheckBox {
                    id: showVideoDownloader
                    Kirigami.FormData.label: i18n("Video download:")
                    text: i18n("Show the download row in the popup")

                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize

                    QQC2.ToolTip.text: i18n("The row where a YouTube or X link is pasted and downloaded.")
                    QQC2.ToolTip.visible: hovered
                }

                QQC2.TextField {
                    id: downloadDirectory
                    Kirigami.FormData.label: i18n("Download folder:")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: downloadDirectory.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Videos are written here. A leading '~/' expands to your home directory.")
                    QQC2.ToolTip.visible: hovered
                }

                QQC2.TextField {
                    id: jsRuntime
                    Kirigami.FormData.label: i18n("JS runtime:")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: jsRuntime.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Passed to yt-dlp as --js-runtimes; YouTube needs it to solve challenges. Leave empty to omit the flag.")
                    QQC2.ToolTip.visible: hovered
                }

                QQC2.TextField {
                    id: ytDlpBinary
                    Kirigami.FormData.label: i18n("yt-dlp binary:")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: ytDlpBinary.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Executable name or path. A leading '~/' expands to your home directory.")
                    QQC2.ToolTip.visible: hovered
                }

                QQC2.ComboBox {
                    id: cookiesBrowser
                    Kirigami.FormData.label: i18n("Cookies browser:")
                    editable: true
                    model: ["brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"]

                    // False until the stored value has been pushed into the control. Measured on Qt 6.11.2:
                    // the stored value arrives BEFORE the combo initialises, the combo's own startup then
                    // sets index 0 and editText "brave" -- firing onEditTextChanged -- and only afterwards
                    // does this component's Component.onCompleted run. The push-back below therefore stays
                    // muted until the seed is in, or merely opening the page would write "brave" over the
                    // stored browser in the setting Plasma is about to save.
                    property bool seeded: false

                    // Config -> control, once the combo has finished initialising. The stored value is read
                    // into a local before anything is written: setting currentIndex makes the combo rewrite
                    // editText from the model, and an index of -1 blanks it, so a free-form value such as
                    // "chrome:Default" has to be restored afterwards or it would be lost before it is shown.
                    Component.onCompleted: {
                        const stored = configPage.cfg_cookiesBrowser;
                        cookiesBrowser.currentIndex = cookiesBrowser.find(stored);
                        cookiesBrowser.editText = stored;
                        cookiesBrowser.seeded = true;
                    }

                    // Control -> config: a pick from the list and a free-form edit both reach the setting,
                    // which is what Plasma reads when the page is saved. The index then follows an exact
                    // match so the popup highlight points at the value on screen; a value the model does not
                    // contain matches nothing and leaves the index where it was.
                    onActivated: (index) => { configPage.cfg_cookiesBrowser = cookiesBrowser.textAt(index); }
                    onEditTextChanged: {
                        if (!cookiesBrowser.seeded) {
                            return;
                        }

                        configPage.cfg_cookiesBrowser = cookiesBrowser.editText;

                        const match = cookiesBrowser.find(cookiesBrowser.editText);
                        if (match >= 0 && match !== cookiesBrowser.currentIndex) {
                            cookiesBrowser.currentIndex = match;
                        }
                    }

                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    palette.text: paletteTokens.text
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: cookiesBrowser.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Passed to yt-dlp as --cookies-from-browser. Leave empty to download without cookies.")
                    QQC2.ToolTip.visible: hovered
                }
            }
        }
    }

    // --- Shutdown countdown --------------------------------------------------
    Rectangle {
        Kirigami.FormData.isSection: true
        Layout.fillWidth: true
        implicitWidth: Math.max(countdownBody.implicitWidth, Kirigami.Units.gridUnit * 16)
            + Kirigami.Units.largeSpacing * 4
        implicitHeight: countdownBody.implicitHeight + Kirigami.Units.largeSpacing * 4
        radius: paletteTokens.cardRadius
        color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.line

        ColumnLayout {
            id: countdownBody
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 2
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                text: i18n("Shutdown countdown")
                color: paletteTokens.text
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.sectionTitlePixelSize
            }

            QQC2.Label {
                Layout.fillWidth: true
                text: i18n("How long after you press Shut down the machine powers off.")
                color: paletteTokens.muted
                wrapMode: Text.WordWrap
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.subtlePixelSize
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing

                QQC2.TextField {
                    id: shutdownCountdownMinutes
                    Kirigami.FormData.label: i18n("Shutdown countdown (minutes):")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: shutdownCountdownMinutes.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Whole number of minutes greater than 10. The widget powers the machine off this long after you press Shut down.")
                    QQC2.ToolTip.visible: hovered
                }

                // A value the resolver refuses disables the play button in the popup, so this row is
                // what stops the button looking dead for no reason. The setting is validated by the
                // same pure function main.qml uses to decide whether a countdown can be armed.
                // The negative colour stays the theme's functional error colour: this hint is not
                // decoration, and it is not a severity accent, so it must not be recoloured.
                QQC2.Label {
                    Layout.fillWidth: true
                    visible: !configPage.shutdownMinutesValid
                    text: i18n("Enter a whole number of minutes greater than 10.")
                    color: Kirigami.Theme.negativeTextColor
                    wrapMode: Text.WordWrap
                    font: Kirigami.Theme.smallFont
                }
            }
        }
    }

    // --- Appearance ----------------------------------------------------------
    Rectangle {
        Kirigami.FormData.isSection: true
        Layout.fillWidth: true
        implicitWidth: Math.max(appearanceBody.implicitWidth, Kirigami.Units.gridUnit * 16)
            + Kirigami.Units.largeSpacing * 4
        implicitHeight: appearanceBody.implicitHeight + Kirigami.Units.largeSpacing * 4
        radius: paletteTokens.cardRadius
        color: Qt.rgba(paletteTokens.panelSunken.r, paletteTokens.panelSunken.g, paletteTokens.panelSunken.b, 0.45)
        border.width: paletteTokens.appBorderWidth
        border.color: paletteTokens.line

        ColumnLayout {
            id: appearanceBody
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing * 2
            spacing: Kirigami.Units.smallSpacing

            QQC2.Label {
                text: i18n("Appearance")
                color: paletteTokens.text
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.sectionTitlePixelSize
            }

            QQC2.Label {
                Layout.fillWidth: true
                text: i18n("The panel icon and the widget's bottom text.")
                color: paletteTokens.muted
                wrapMode: Text.WordWrap
                font.family: paletteTokens.fontFamily
                font.pixelSize: paletteTokens.subtlePixelSize
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing

                QQC2.TextField {
                    id: iconName
                    Kirigami.FormData.label: i18n("Panel icon:")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: iconName.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Any icon name from the active theme, e.g. folder-docker-symbolic.")
                    QQC2.ToolTip.visible: hovered
                }

                QQC2.TextField {
                    id: taglineText
                    Kirigami.FormData.label: i18n("Bottom text:")

                    color: paletteTokens.text
                    placeholderTextColor: paletteTokens.placeholder
                    font.family: paletteTokens.fontFamily
                    font.pixelSize: paletteTokens.labelPixelSize
                    background: Rectangle {
                        color: paletteTokens.fieldSurface
                        border.width: 1
                        border.color: taglineText.activeFocus ? paletteTokens.fieldBorderFocus : paletteTokens.fieldBorder
                        radius: paletteTokens.controlRadius
                    }

                    QQC2.ToolTip.text: i18n("Muted text shown at the bottom of the widget. Leave empty to hide it.")
                    QQC2.ToolTip.visible: hovered
                }
            }
        }
    }

    // The page background, declared LAST on purpose. Kirigami.FormLayout.relayout()
    // walks every direct child and gives each one a grid row, so a background declared
    // before the controls would claim the first row and push the form's leading label
    // spacing down. Anchored to fill and drawn behind the sections (z: -1), it still
    // covers the whole page while leaving the form rows untouched. Hidden when the
    // background is opted out, in which case it takes no row at all.
    Rectangle {
        anchors.fill: parent
        z: -1
        visible: configPage.paintPageBackground
        color: paletteTokens.appBackground
    }
}
