import QtQuick

/*
 * Fixed dark palette and type scale of the design mockup this widget restyles to.
 *
 * WHY THIS FILE EXISTS: the human operator asked for the mockup's look verbatim,
 * including its fixed colours and the Inter typeface. That is a deliberate,
 * sanctioned override of the previous rule that every colour came from the
 * Kirigami theme (documented in docs/widget/ui-surfaces.md, "Style tokens").
 * Every value below is therefore a constant, and the widget no longer follows
 * the system colour scheme -- on purpose.
 *
 * WHAT DOES NOT LIVE HERE: the severity -> colour mapping. That stays in
 * SeverityDot.qml and nowhere else; every consumer reads
 * SeverityDot.severityColor instead of mapping a state to a colour itself.
 *
 * The mockup itself is a visual reference that lives outside this repository.
 * It is not bundled, copied or imported by the package: it was translated into
 * these tokens by hand, once, here.
 */
QtObject {
    // --- Surfaces ------------------------------------------------------------
    readonly property color appBackground: "#101417"    // mockup page background
    readonly property color panel: "#1b2227"            // the app card
    readonly property color panelAlt: "#20292f"         // secondary panel
    readonly property color panelSunken: "#141e22"      // inset sections, 45% over the panel
    readonly property color line: "#354149"             // hairline borders
    readonly property color lineStrong: "#3b484f"       // the card outline

    // --- Text ----------------------------------------------------------------
    readonly property color text: "#edf3f5"
    // Contrast-refinement turn: the secondary text tokens were brightened
    // (shade family preserved) at the human operator's request. Measured
    // against the #1b2227 panel (WCAG ratio), the four went from ~4.9:1 to
    // ~10.0:1 up to ~7.6:1 to ~11.5:1. The severity mapping is untouched:
    // SeverityDot still resolves `muted` for the unknown state -- only the
    // shade moved.
    readonly property color muted: "#b3c1c8"
    readonly property color labelText: "#d2dbe0"        // field labels, timer label
    readonly property color footerText: "#a6b5bc"
    readonly property color placeholder: "#7f8d94"
    readonly property color containerStateText: "#bcc7cd" // container row state label

    // --- Severity accents ----------------------------------------------------
    // The mockup's four semantic accents. SeverityDot.qml is the only place a
    // severity resolves to one of these.
    readonly property color green: "#55d69e"
    readonly property color orange: "#ffad5c"
    readonly property color blue: "#84b8ff"
    readonly property color red: "#ff737d"

    // --- Icon tiles ----------------------------------------------------------
    readonly property color iconTileSurface: "#2b343a"  // container icon tile, timer icon tile
    readonly property color iconTileText: "#a9bbc4"     // glyph tint in the container tile
    readonly property color iconTileTextAlt: "#c1cdd2"  // glyph tint in the timer tile

    // --- Controls ------------------------------------------------------------
    readonly property color buttonSurface: "#293238"
    readonly property color buttonSurfaceHover: "#354149"
    readonly property color buttonBorder: "#46535b"
    readonly property color buttonBorderHover: "#5a6a74"
    readonly property color buttonPrimary: "#b9e8d7"
    readonly property color buttonPrimaryHover: "#d0f5e7"
    readonly property color buttonPrimaryText: "#111a1d"
    readonly property color buttonDanger: "#39272b"
    readonly property color buttonDangerBorder: "#70444a"
    readonly property color buttonDangerText: "#ffdfe1"
    readonly property color fieldSurface: "#11171a"
    readonly property color fieldBorder: "#3c484f"
    readonly property color fieldBorderFocus: "#79a8c4"
    readonly property color trackSurface: "#303a40"     // progress track

    // --- Icon buttons --------------------------------------------------------
    // The square header refresh button; its surfaces differ from the plain
    // control surfaces above, so it keeps its own tokens.
    readonly property color iconButtonSurface: "#222b30"      // refresh button, at rest
    readonly property color iconButtonSurfaceHover: "#2c383f" // refresh button, hovered
    readonly property color iconButtonText: "#cbd6db"         // refresh button glyph

    // --- Interaction tints ---------------------------------------------------
    // Neutral chrome washes that are not states: they never carry severity.
    readonly property color rowHoverTint: Qt.rgba(1, 1, 1, 0.025) // faint container-row hover wash

    // --- Section toggle affordance -------------------------------------------
    // The +/- that collapses and reopens a section. This is a functional
    // affordance, not a severity and not neutral chrome, so it keeps its own
    // saturated neon yellow rather than borrowing one of the severity accents
    // above. Measured against the #1b2227 panel it stays well clear of the four
    // severity hues and reads as "touch me" at a glance.
    readonly property color toggleIndicator: "#FFE500"       // the neon +/- glyph
    readonly property int toggleIndicatorPixelSize: 22      // a step above body text

    // --- Pre-composited gradients -------------------------------------------
    readonly property color statusCardTop: Qt.rgba(54 / 255, 75 / 255, 80 / 255, 0.32)
    readonly property color statusCardBottom: Qt.rgba(30 / 255, 38 / 255, 43 / 255, 0.60)

    // --- Radii ---------------------------------------------------------------
    readonly property int appRadius: 20                 // the app card
    readonly property int cardRadius: 14                // status card, sections
    readonly property int controlRadius: 10             // buttons, text fields, timer tile
    readonly property int tileRadius: 9                 // container icon tile, container row
    readonly property int iconButtonRadius: 0           // square icon button: refresh + Podman launch in the status card (adr-0017)
    readonly property int appBorderWidth: 1

    // --- Typography ----------------------------------------------------------
    // QML takes ONE family name, not a CSS stack. Qt's font database substitutes
    // its default face when "Inter" is not installed, so no further fallback chain
    // is expressible and none is needed -- but never hard-code a soft dependency on
    // Inter being present.
    readonly property string fontFamily: "Inter"
    readonly property int bodyPixelSize: 14             // body text, buttons
    readonly property int titlePixelSize: 19            // the app title, logo glyph
    readonly property int sectionTitlePixelSize: 13     // section headings
    readonly property int metricPixelSize: 26           // the running-count figure
    readonly property int subtlePixelSize: 11           // pill, helper, footer, subtitles
    readonly property int labelPixelSize: 12            // field labels, stats caption
    readonly property int progressTrackHeight: 5
}
