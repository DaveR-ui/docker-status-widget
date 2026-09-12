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
    property alias cfg_cookiesBrowser: cookiesBrowser.editText

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

        // QQuickComboBox does NOT refresh editText when the activated index is already
        // currentIndex, so that pick is lost. Measured on Qt 6.11 with the stored value
        // "firefox": clicking "brave" (index 0, the default currentIndex) emitted
        // activated(0) with currentText "brave" and left editText "firefox" -- the setting
        // would have been saved unchanged. Writing the text on activation is what makes
        // cfg_cookiesBrowser truthful for every pick.
        onActivated: (index) => { cookiesBrowser.editText = cookiesBrowser.textAt(index); }

        // Keep the popup highlight on the stored browser instead of on index 0, which
        // would otherwise show a value the user never chose.
        onEditTextChanged: {
            const match = cookiesBrowser.find(cookiesBrowser.editText);
            if (match >= 0 && match !== cookiesBrowser.currentIndex) {
                cookiesBrowser.currentIndex = match;
            }
        }

        QQC2.ToolTip.text: i18n("Passed to yt-dlp as --cookies-from-browser. Leave empty to download without cookies.")
        QQC2.ToolTip.visible: hovered
    }
}
