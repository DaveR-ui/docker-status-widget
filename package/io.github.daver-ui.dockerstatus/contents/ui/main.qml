/*
 * Docker Status plasmoid.
 *
 * Design notes, all verified against Plasma 6.7.4 / plasma5support 6.7.4 on this
 * machine -- see README.md for the evidence.
 *
 *  1. Two-tier polling. The daemon state is the cheap probe
 *     (`systemctl is-active docker`, a few ms) and the only thing polled
 *     unconditionally. `docker ps` is polled only while the daemon is up,
 *     because against a dead daemon it blocks on the socket timeout.
 *
 *  2. Every one-shot command goes through withRunToken(). The "executable" data
 *     engine treats connectedSources as a *set*: assigning an identical command
 *     string twice is a no-op, so without the token a second button click would
 *     silently do nothing.
 *
 *  3. Executed commands are fixed constants below, with ONE deliberate exception:
 *     the video download. It needs the URL the user pasted, so it is assembled by
 *     DockerStatus.buildVideoDownloadCommand(), which validates the URL against a
 *     host allow-list and shell-quotes every interpolated value -- including the
 *     configuration. That is what makes the trailing shell-comment token safe
 *     everywhere else. Do not add a second exception without reading dockerstatus.js
 *     and the tests that run the assembled command through a real shell.
 *
 *  4. Stop is the one destructive action this widget performs, and it is offered --
 *     but never on a single click. The first click arms a confirmation that expires
 *     on its own; only the second click runs the stop. The polkit grant is
 *     deliberately NOT widened for it, so stopping keeps the interactive password
 *     prompt while starting stays passwordless. That asymmetry is the point, not a
 *     gap: adding "stop" to ALLOWED_VERBS would delete it by decision, not by
 *     oversight (adr-0007).
 */

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.plasma5support as P5Support

import "dockerstatus.js" as DockerStatus

PlasmoidItem {
    id: root

    // --- Fixed commands (never user-supplied) --------------------------------
    //
    // These three are constants on purpose. The Docker side of this widget never
    // assembles a command from input.
    readonly property string daemonStateCommand: "systemctl is-active docker"
    readonly property string containerListCommand: "docker ps -a --format '{{.Names}}|{{.State}}'"
    readonly property string daemonStartCommand: "systemctl start docker"
    readonly property string daemonStopCommand: "systemctl stop docker"

    // The video download is the one deliberate exception: the user pastes a URL, so
    // DockerStatus.buildVideoDownloadCommand() builds the command from a validated
    // URL and validated configuration, shell-quoting every value. The full rules
    // live next to the function in dockerstatus.js; the tests run the assembled
    // command through a real shell and assert the arguments arrive intact.
    readonly property string homeDirectoryCommand: "printf %s \"$HOME\""

    readonly property int effectivePollIntervalMs: Math.max(1000, Plasmoid.configuration.pollIntervalSeconds * 1000)

    // --- Observable state ----------------------------------------------------
    property string daemonState: DockerStatus.DAEMON_UNKNOWN
    property var containers: []
    property bool actionInFlight: false
    // Start and stop mutate the same unit, so one actionInFlight flag guards both.
    // actionKind records which of the two owns the reply, so the failure message
    // and the buttons can name the action that actually ran.
    property string actionKind: ""
    property string actionFeedback: ""
    property int runToken: 0

    property string homeDirectory: ""
    property bool downloadInFlight: false
    property string downloadFeedback: ""
    property string downloadFeedbackSeverity: DockerStatus.SEVERITY_MUTED
    property string downloadStdout: ""
    property string downloadStderr: ""

    readonly property bool daemonRunning: daemonState === DockerStatus.DAEMON_ACTIVE
    readonly property bool containerListEnabled: daemonRunning && Plasmoid.configuration.showContainerList

    // --- Plasmoid metadata ---------------------------------------------------
    Plasmoid.title: i18n("Docker Status")
    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground | PlasmaCore.Types.ConfigurableBackground

    // On the desktop show the full widget; in a panel fall back to the compact
    // representation, which expands into a popup on click.
    preferredRepresentation: Plasmoid.formFactor === PlasmaCore.Types.Planar ? fullRepresentation : null

    toolTipMainText: i18n("Docker")
    toolTipSubText: daemonRunning
        ? i18nc("@info", "Containers running: %1", DockerStatus.summarizeContainers(containers))
        : i18nc("@info", "Daemon: %1", daemonState)

    // --- Actions -------------------------------------------------------------
    function nextRunToken() {
        root.runToken += 1;
        return root.runToken;
    }

    function refreshDaemonState() {
        forcedDaemonRead.connectedSources = [
            DockerStatus.withRunToken(root.daemonStateCommand, root.nextRunToken())
        ];
    }

    function startDaemon() {
        if (root.actionInFlight || root.daemonRunning) {
            return;
        }
        root.actionInFlight = true;
        root.actionFeedback = "";
        root.actionKind = DockerStatus.ACTION_START;
        daemonAction.connectedSources = [
            DockerStatus.withRunToken(root.daemonStartCommand, root.nextRunToken())
        ];
    }

    // Only reachable after the UI confirmation in FullRepresentation: the button arms
    // on the first click and calls this on the second. Stopping is not covered by the
    // polkit grant, so the interactive password prompt is expected here -- that
    // asymmetry with the passwordless start is deliberate (adr-0007).
    function stopDaemon() {
        if (root.actionInFlight || !root.daemonRunning) {
            return;
        }
        root.actionInFlight = true;
        root.actionFeedback = "";
        root.actionKind = DockerStatus.ACTION_STOP;
        daemonAction.connectedSources = [
            DockerStatus.withRunToken(root.daemonStopCommand, root.nextRunToken())
        ];
    }

    // Pasted links are validated before a command exists, and again inside
    // buildVideoDownloadCommand() before anything is shell-quoted into one.
    function downloadVideo(url) {
        if (root.downloadInFlight) {
            return;
        }

        const kind = DockerStatus.classifyVideoUrl(url);
        if (kind === null) {
            root.downloadFeedback = i18n("Paste a YouTube or X (Twitter) link first.");
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        root.downloadInFlight = true;
        root.downloadFeedback = kind === DockerStatus.VIDEO_KIND_YOUTUBE
            ? i18n("Downloading the video from YouTube…")
            : i18n("Downloading the video from X…");
        root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
        root.downloadStdout = "";
        root.downloadStderr = "";

        downloadAction.connectedSources = [
            DockerStatus.buildVideoDownloadCommand({
                binary: Plasmoid.configuration.ytDlpBinary,
                directory: Plasmoid.configuration.downloadDirectory,
                jsRuntime: Plasmoid.configuration.jsRuntime,
                cookiesBrowser: Plasmoid.configuration.cookiesBrowser,
                home: root.homeDirectory,
                url: url,
                token: root.nextRunToken()
            })
        ];
    }

    onDaemonRunningChanged: {
        if (!root.daemonRunning) {
            // Drop stale data; containerSource disconnects on its own because its
            // connectedSources binding evaluates to [].
            root.containers = [];
        }
    }

    // --- Data sources --------------------------------------------------------

    // Always-on cheap probe of the systemd unit.
    P5Support.DataSource {
        id: daemonSource
        engine: "executable"
        interval: root.effectivePollIntervalMs
        connectedSources: [root.daemonStateCommand]

        onNewData: (sourceName, data) => {
            root.daemonState = DockerStatus.parseDaemonState(data["stdout"]);
        }
    }

    // Polled only while the daemon is up.
    P5Support.DataSource {
        id: containerSource
        engine: "executable"
        interval: root.containerListEnabled ? root.effectivePollIntervalMs : 0
        connectedSources: root.containerListEnabled ? [root.containerListCommand] : []

        onNewData: (sourceName, data) => {
            root.containers = DockerStatus.parseContainers(data["stdout"]);
        }
    }

    // One-shot: re-read the daemon state immediately after an action, without
    // waiting for the next poll tick.
    P5Support.DataSource {
        id: forcedDaemonRead
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.daemonState = DockerStatus.parseDaemonState(data["stdout"]);
        }
    }

    // One-shot: the privileged action, start or stop. One source serves both because
    // only one action can be in flight, and having a single place that clears the flag
    // is deliberate. Reaching polkit is the point; the exit code and stderr are
    // surfaced verbatim so a denial is never swallowed.
    P5Support.DataSource {
        id: daemonAction
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            const kind = root.actionKind;

            root.actionInFlight = false;
            root.actionKind = "";

            const exitCode = Number(data["exit code"]);
            if (exitCode === 0) {
                root.actionFeedback = "";
                root.refreshDaemonState();
                return;
            }

            const stderr = DockerStatus.normalizeOutput(data["stderr"]);
            root.actionFeedback = stderr !== ""
                ? stderr
                : (kind === DockerStatus.ACTION_STOP
                    ? i18nc("@info", "Stopping the daemon failed (exit code %1).", exitCode)
                    : i18nc("@info", "Starting the daemon failed (exit code %1).", exitCode));
        }
    }

    // One-shot at load: the shell expands $HOME because quoting it would defeat the
    // purpose. The command itself is a constant, and its only output is a path that
    // is validated again before it is used.
    P5Support.DataSource {
        id: homeSource
        engine: "executable"
        interval: 0
        connectedSources: [root.homeDirectoryCommand]

        onNewData: (sourceName, data) => {
            root.homeDirectory = DockerStatus.normalizeOutput(data["stdout"]);
        }
    }

    // One-shot: the video download. A download can run for minutes with no event in
    // between, because the engine delivers exactly one onNewData, at process exit,
    // carrying the whole run plus the exit code (measured on plasma5support 6.7.5 --
    // see docs/status/data-engine-contract.md). The chunks are still accumulated and an
    // event without an exit code is still ignored: that is defence against a future
    // engine that streams, and it costs nothing today.
    P5Support.DataSource {
        id: downloadAction
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.downloadStdout += String(data["stdout"] !== undefined ? data["stdout"] : "");
            root.downloadStderr += String(data["stderr"] !== undefined ? data["stderr"] : "");

            const exitCode = data["exit code"];
            if (exitCode === undefined) {
                return;
            }

            root.downloadInFlight = false;

            // stdout first, stderr last: the last line wins, and the real error is on
            // stderr. parseDownloadedFile() only reads the [download]/[Merger] lines,
            // which yt-dlp writes to stdout.
            const output = DockerStatus.normalizeOutput(
                root.downloadStdout + "\n" + root.downloadStderr
            );

            if (Number(exitCode) === 0) {
                const file = DockerStatus.parseDownloadedFile(output);
                root.downloadFeedback = file !== ""
                    ? i18nc("@info", "Saved to %1", file)
                    : i18n("Download finished.");
                root.downloadFeedbackSeverity = DockerStatus.SEVERITY_POSITIVE;
                return;
            }

            const detail = DockerStatus.extractErrorLine(output);
            root.downloadFeedback = detail !== ""
                ? detail
                : i18nc("@info", "The download failed (exit code %1).", Number(exitCode));
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
        }
    }

    // --- Contextual actions --------------------------------------------------
    // There is deliberately no stop entry here. A context menu is still a one-click
    // surface, and the stop is destructive enough that the confirmation is the whole
    // point; the popup button is the single stop path (adr-0007).
    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: i18n("Refresh")
            icon.name: "view-refresh"
            onTriggered: root.refreshDaemonState()
        },
        PlasmaCore.Action {
            text: i18n("Start Docker daemon")
            icon.name: "media-playback-start"
            enabled: !root.daemonRunning && !root.actionInFlight
            onTriggered: root.startDaemon()
        }
    ]

    // --- Representations -----------------------------------------------------
    compactRepresentation: CompactRepresentation {
        daemonState: root.daemonState
        daemonRunning: root.daemonRunning
    }

    fullRepresentation: FullRepresentation {
        daemonState: root.daemonState
        containers: root.containers
        daemonRunning: root.daemonRunning
        containerListEnabled: root.containerListEnabled
        actionInFlight: root.actionInFlight
        actionKind: root.actionKind
        actionFeedback: root.actionFeedback
        downloaderEnabled: Plasmoid.configuration.showVideoDownloader
        taglineText: Plasmoid.configuration.taglineText
        cookiesBrowser: Plasmoid.configuration.cookiesBrowser
        downloadReady: root.homeDirectory !== ""
        downloadInFlight: root.downloadInFlight
        downloadFeedback: root.downloadFeedback
        downloadFeedbackSeverity: root.downloadFeedbackSeverity

        onStartRequested: root.startDaemon()
        onStopRequested: root.stopDaemon()
        onRefreshRequested: root.refreshDaemonState()
        onDownloadRequested: (url) => root.downloadVideo(url)
    }
}
