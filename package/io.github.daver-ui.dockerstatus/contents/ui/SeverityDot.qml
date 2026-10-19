import QtQuick

import org.kde.kirigami as Kirigami

/*
 * The single severity -> colour mapping, shared by every representation.
 *
 * The colours are the fixed dark palette of the design mockup (see
 * DockerStatusPalette.qml for why this is a sanctioned override of the previous
 * Kirigami-theme mapping). The severity itself still comes from
 * dockerstatus.js, so no state is ever mapped to a colour in two places: the
 * mapping exists in this switch and here alone.
 */
Item {
    id: dot

    property string severity: "muted"
    property int diameter: Math.round(Kirigami.Units.gridUnit / 3)
    // The mockup's status dot carries a soft ring; the six-pixel list dots do
    // not. Consumers opt in rather than getting a bigger dot by accident.
    property bool halo: false

    readonly property color severityColor: {
        switch (dot.severity) {
        case "positive":
            return paletteTokens.green;
        case "negative":
            return paletteTokens.red;
        case "neutral":
            return paletteTokens.orange;
        default:
            // Muted, never neutral: an unknown state must not read as "fine".
            return paletteTokens.muted;
        }
    }

    DockerStatusPalette {
        id: paletteTokens
    }

    readonly property int haloThickness: dot.halo ? 4 : 0

    implicitWidth: dot.diameter + dot.haloThickness * 2
    implicitHeight: dot.diameter + dot.haloThickness * 2

    // The ring is the same severity colour at low alpha, matching the mockup's
    // halo, and it is drawn behind the core dot so the two stay concentric.
    Rectangle {
        anchors.centerIn: parent
        width: dot.implicitWidth
        height: dot.implicitHeight
        radius: width / 2
        visible: dot.halo
        color: Qt.rgba(dot.severityColor.r, dot.severityColor.g, dot.severityColor.b, 0.1)
    }

    Rectangle {
        anchors.centerIn: parent
        width: dot.diameter
        height: dot.diameter
        radius: width / 2
        color: dot.severityColor
    }
}
