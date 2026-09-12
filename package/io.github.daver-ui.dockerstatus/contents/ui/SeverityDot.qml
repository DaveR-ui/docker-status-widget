import QtQuick

import org.kde.kirigami as Kirigami

/*
 * A small coloured dot encoding a severity produced by dockerstatus.js.
 * Shared by every representation so the severity -> colour mapping exists once.
 */
Rectangle {
    id: dot

    property string severity: "muted"
    property int diameter: Math.round(Kirigami.Units.gridUnit / 3)

    readonly property color severityColor: {
        switch (dot.severity) {
        case "positive":
            return Kirigami.Theme.positiveTextColor;
        case "negative":
            return Kirigami.Theme.negativeTextColor;
        case "neutral":
            return Kirigami.Theme.neutralTextColor;
        default:
            // Muted, never neutral: an unknown state must not read as "fine".
            return Kirigami.Theme.disabledTextColor;
        }
    }

    implicitWidth: dot.diameter
    implicitHeight: dot.diameter
    radius: dot.diameter / 2
    color: dot.severityColor
}
