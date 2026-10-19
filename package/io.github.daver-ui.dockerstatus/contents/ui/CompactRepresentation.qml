import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid

import "dockerstatus.js" as DockerStatus

/*
 * Panel representation: the configured icon plus a severity dot.
 * The dot is what makes the widget readable at a glance, so it is always
 * present -- an unknown state shows a muted dot rather than nothing.
 */
Item {
    id: compactRoot

    property string daemonState: "unknown"
    property bool daemonRunning: false

    implicitWidth: compactLayout.implicitWidth
    implicitHeight: compactLayout.implicitHeight

    RowLayout {
        id: compactLayout
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Icon {
            source: Plasmoid.configuration.iconName
            opacity: compactRoot.daemonRunning ? 1.0 : 0.5
            Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
            Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
        }

        SeverityDot {
            Layout.alignment: Qt.AlignVCenter
            severity: DockerStatus.daemonSeverity(compactRoot.daemonState)
        }
    }
}
