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
 *  4. Stopping the daemon is a destructive action (the power-off in note 5 is the
 *     other), and it is offered but never on a single click. The first click arms a
 *     confirmation that expires on its own; only the second click runs the stop. The
 *     polkit grant is deliberately NOT widened for it, so stopping keeps the interactive
 *     password prompt while starting stays passwordless. That asymmetry is the point, not
 *     a gap: adding "stop" to ALLOWED_VERBS would delete it by decision, not by
 *     oversight (adr-0007).
 *
 *  5. "Countdown to Extinction" is a second destructive action, and its countdown is
 *     deliberately WIDGET-OWNED. The configured duration only sizes a local
 *     datetime; the widget then runs one fixed command (`systemctl poweroff`) at
 *     expiry. A plasmashell/widget reload therefore CANCELS a pending shutdown --
 *     that is the intended fail-safe, not a bug: an armed countdown does not survive
 *     the thing that would fire it being replaced. Cancel is purely local and needs
 *     no privilege. The power-off adds no polkit rule and does not widen the grant
 *     (ALLOWED_VERBS stays ["start"]), and unlike the docker stop it does NOT prompt:
 *     logind's default policy for org.freedesktop.login1.power-off is allow_active=yes,
 *     so a local active session powers off without a password. The safeguards are
 *     therefore the deliberate activation, the more-than-10-minute countdown, the
 *     visible countdown and the cancel button -- not a password gate (adr-0009). The
 *     duration is editable inline in the popup as well as on the config page; the
 *     popup emits raw text and this file stays the SINGLE writer of the kcfg entry,
 *     refusing anything the resolver cannot use so both surfaces cannot drift.
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

    // Fixed, exactly like the docker commands above: the configured countdown sizes a
    // local deadline and is never interpolated into this string. This is the second
    // destructive action the widget performs: it adds no polkit rule and does not widen
    // the grant (ALLOWED_VERBS stays ["start"]), and unlike `systemctl stop docker` it
    // does not prompt -- logind's default policy for org.freedesktop.login1.power-off is
    // allow_active=yes, so a local active session powers off without a password. The
    // safeguards are the deliberate activation, the more-than-10-minute countdown, the
    // visible countdown and the cancel button, not a password gate (adr-0009).
    readonly property string powerOffCommand: "systemctl poweroff"

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

    // The countdown is widget-owned: these fields hold the local deadline the ticker
    // reads, while the configured setting only sizes it. shutdownFeedback is neutral
    // while the power-off is in flight and negative when it fails.
    property bool shutdownPending: false
    property bool shutdownInFlight: false
    property double shutdownDeadlineMs: 0
    property int shutdownRemainingSeconds: 0
    property string shutdownFeedback: ""
    property string shutdownFeedbackSeverity: DockerStatus.SEVERITY_MUTED

    // Deliberately `var`, not `int`: the resolver answers null for a value that cannot
    // arm a countdown, and an int property could not hold that.
    readonly property var resolvedShutdownMinutes: DockerStatus.resolveShutdownMinutes(Plasmoid.configuration.shutdownCountdownMinutes)
    readonly property bool shutdownReady: resolvedShutdownMinutes !== null
    readonly property int shutdownMinutes: shutdownReady ? resolvedShutdownMinutes : 0

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

    /*
     * Countdown to Extinction. Play arms a local deadline and disables itself until the
     * sequence is cancelled or completes; stop is the only way to cancel and needs no
     * privilege. At expiry firePowerOff() runs the fixed constant. A widget reload drops
     * all of this state, which silently cancels a pending shutdown -- the intended
     * fail-safe (adr-0009).
     */
    function startShutdownCountdown() {
        if (root.shutdownPending || root.shutdownInFlight || !root.shutdownReady) {
            return;
        }
        root.shutdownPending = true;
        root.shutdownFeedback = "";
        root.shutdownFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
        root.shutdownDeadlineMs = Date.now() + root.shutdownMinutes * 60 * 1000;
        root.shutdownRemainingSeconds = root.shutdownMinutes * 60;
    }

    function stopShutdownCountdown() {
        if (!root.shutdownPending) {
            return;
        }
        root.shutdownPending = false;
        root.shutdownDeadlineMs = 0;
        root.shutdownRemainingSeconds = 0;
        root.shutdownFeedback = "";
        root.shutdownFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
    }

    function firePowerOff() {
        if (!root.shutdownPending) {
            return;
        }
        root.shutdownPending = false;
        root.shutdownDeadlineMs = 0;
        root.shutdownRemainingSeconds = 0;
        root.shutdownInFlight = true;
        root.shutdownFeedback = i18n("Powering off…");
        root.shutdownFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
        powerAction.connectedSources = [
            DockerStatus.withRunToken(root.powerOffCommand, root.nextRunToken())
        ];
    }

    // The inline field in the popup is a second editing surface for the same setting. The
    // representation emits the raw text; this is the only place the kcfg entry is written,
    // so the config page and the inline field cannot drift. An unusable value is refused
    // (never persisted) and the representation disables play on its own.
    function setShutdownMinutes(raw) {
        const resolved = DockerStatus.resolveShutdownMinutes(raw);
        if (resolved === null) {
            return;
        }
        if (raw === Plasmoid.configuration.shutdownCountdownMinutes) {
            return;
        }
        Plasmoid.configuration.shutdownCountdownMinutes = raw;
    }

    // The countdown is a wall-clock deadline, not one long Timer interval: a 15-minute
    // interval would not survive suspend/resume or a clock adjustment, and the user could
    // not watch it count down. One second is only the display resolution; each tick
    // recomputes the remaining time from Date.now() and the fixed deadline, so the
    // deadline never drifts no matter how late a tick arrives. That is deliberate
    // absolute-deadline semantics with one accepted consequence: a forward system-clock
    // step, or a resume after the deadline has already passed while suspended, makes the
    // next tick fire immediately. The cancel button and the configurable countdown length
    // are the mitigations for that debt (adr-0009).
    Timer {
        id: shutdownTicker
        interval: 1000
        repeat: true
        running: root.shutdownPending

        onTriggered: {
            root.shutdownRemainingSeconds = DockerStatus.shutdownRemainingSeconds(
                root.shutdownDeadlineMs, Date.now()
            );
            if (root.shutdownRemainingSeconds === 0) {
                root.firePowerOff();
            }
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

    // One-shot: the power-off. A single source that clears the in-flight flag, mirroring
    // daemonAction. The exit code and stderr are surfaced verbatim so a polkit denial is
    // never swallowed. The command is the fixed constant above; the configured countdown
    // sized only the local deadline and is nowhere in this string.
    P5Support.DataSource {
        id: powerAction
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.shutdownInFlight = false;

            const exitCode = Number(data["exit code"]);
            if (exitCode === 0) {
                root.shutdownFeedback = i18n("Powering off…");
                root.shutdownFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
                return;
            }

            const stderr = DockerStatus.normalizeOutput(data["stderr"]);
            root.shutdownFeedback = stderr !== ""
                ? stderr
                : i18nc("@info", "Powering off failed (exit code %1).", exitCode);
            root.shutdownFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
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
        shutdownReady: root.shutdownReady
        shutdownMinutes: root.shutdownMinutes
        shutdownMinutesText: Plasmoid.configuration.shutdownCountdownMinutes
        shutdownPending: root.shutdownPending
        shutdownInFlight: root.shutdownInFlight
        shutdownRemainingSeconds: root.shutdownRemainingSeconds
        shutdownFeedback: root.shutdownFeedback
        shutdownFeedbackSeverity: root.shutdownFeedbackSeverity

        onStartRequested: root.startDaemon()
        onStopRequested: root.stopDaemon()
        onRefreshRequested: root.refreshDaemonState()
        onDownloadRequested: (url) => root.downloadVideo(url)
        onShutdownStartRequested: root.startShutdownCountdown()
        onShutdownStopRequested: root.stopShutdownCountdown()
        onShutdownMinutesEdited: (text) => root.setShutdownMinutes(text)
    }
}
