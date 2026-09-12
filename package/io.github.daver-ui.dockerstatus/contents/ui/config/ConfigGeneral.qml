import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kirigami as Kirigami

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

    // The one setting that is NOT an alias. Plasma hands every stored value to this page as an
    // initial property, and that write reaches an editText alias before the combo initialises:
    // the combo then adopts index 0 and rewrites editText to "brave", so the page opened on
    // "brave" -- and, because cfg_cookiesBrowser read editText back, saving the page wrote
    // "brave" over whatever was stored. A plain property survives the write and is what the
    // combo is seeded from below.
    property string cfg_cookiesBrowser

    QQC2.SpinBox {
        id: pollInterval
        Kirigami.FormData.label: i18n("Poll interval (seconds):")
        from: 1
        to: 60
        stepSize: 1

        QQC2.ToolTip.text: i18n("Docker state is re-read from systemd this often.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.TextField {
        id: iconName
        Kirigami.FormData.label: i18n("Panel icon:")

        QQC2.ToolTip.text: i18n("Any icon name from the active theme, e.g. folder-docker-symbolic.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.CheckBox {
        id: showContainerList
        Kirigami.FormData.label: i18n("Containers:")
        text: i18n("List containers in the popup")
    }

    QQC2.CheckBox {
        id: showVideoDownloader
        Kirigami.FormData.label: i18n("Video download:")
        text: i18n("Show the download row in the popup")

        QQC2.ToolTip.text: i18n("The row where a YouTube or X link is pasted and downloaded.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.TextField {
        id: downloadDirectory
        Kirigami.FormData.label: i18n("Download folder:")

        QQC2.ToolTip.text: i18n("Videos are written here. A leading '~/' expands to your home directory.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.TextField {
        id: jsRuntime
        Kirigami.FormData.label: i18n("JS runtime:")

        QQC2.ToolTip.text: i18n("Passed to yt-dlp as --js-runtimes; YouTube needs it to solve challenges. Leave empty to omit the flag.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.TextField {
        id: ytDlpBinary
        Kirigami.FormData.label: i18n("yt-dlp binary:")

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

        QQC2.ToolTip.text: i18n("Passed to yt-dlp as --cookies-from-browser. Leave empty to download without cookies.")
        QQC2.ToolTip.visible: hovered
    }

    QQC2.TextField {
        id: taglineText
        Kirigami.FormData.label: i18n("Bottom text:")

        QQC2.ToolTip.text: i18n("Muted text shown at the bottom of the widget. Leave empty to hide it.")
        QQC2.ToolTip.visible: hovered
    }
}
