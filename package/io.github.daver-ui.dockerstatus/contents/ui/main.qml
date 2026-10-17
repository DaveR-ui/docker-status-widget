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
 *  3. Executed commands are fixed constants below, with TWO deliberate, recorded
 *     exceptions. The video download needs the URL the user pasted, so it is assembled
 *     by DockerStatus.buildVideoDownloadCommand(), which validates the URL against a
 *     host allow-list and shell-quotes every interpolated value -- including the
 *     configuration (adr-0006). The per-project compose play/stop and the Podman
 *     Desktop launch are the second: their commands are assembled by
 *     DockerStatus.buildComposeProjectCommand() / buildPodmanDesktopCommand(), which
 *     interpolate a value into one shell-quoted argument and expose no free-form channel
 *     (adr-0014). Both remaining exceptions shell-quote
 *     every interpolated value, and that is what makes the trailing shell-comment token
 *     safe everywhere else. Do not add a third exception without reading
 *     dockerstatus.js and the tests that run the assembled command through a real shell.
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
 *
 *  6. The compose and Podman Desktop actions are UNPRIVILEGED mutations: they run as the
 *     logged-in user against that user's own docker socket and that user's own session, so
 *     they add no polkit rule and ALLOWED_VERBS stays ["start"] (adr-0004, adr-0007,
 *     adr-0014). The per-group stop is a container-level action, NOT `systemctl stop
 *     docker`, so it needs no password: its safeguard is the single shell-quoted label
 *     argument plus the visible feedback line, and a vanished group fails at click time
 *     with docker's own message. The Podman launch is likewise unprivileged -- a wrong
 *     Podman path fails at click time with the binary's own message, never at load time
 *     (adr-0017).
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
    // The third field is the compose project label; a container without one parses as
    // COMPOSE_PROJECT_STANDALONE (the empty string), so a docker that cannot answer the
    // label degrades to one flat standalone group instead of to nothing.
    readonly property string containerListCommand: "docker ps -a --format '{{.Names}}|{{.State}}|{{.Label \"com.docker.compose.project\"}}'"
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

    // Fixed, and it mints no command-building exception: DockerStatus.buildUpdateCheckCommand()
    // assembles this entirely from fixed constants -- it reads one LOCAL file (the widget's own
    // installed metadata.json) and fetches ONE fixed https URL (the release manifest). No configuration
    // value and no user input reaches it, so it is the same class of thing as the daemon commands
    // above, not a second exception like the download row. The URL is deliberately a constant so a
    // misconfiguration cannot point the widget elsewhere. See the Update check section in
    // dockerstatus.js for the full boundary, and note the whole check degrades to silence offline.
    readonly property string updateCheckCommand: DockerStatus.buildUpdateCheckCommand({})

    // Hours between update checks -> milliseconds; 0 disables them entirely. Math.max(0, ...)
    // keeps a stray negative from producing a negative interval.
    readonly property int updateCheckIntervalMs: Math.max(0, Plasmoid.configuration.updateCheckIntervalHours * 3600 * 1000)

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

    // Compose project actions. The action is an UNPRIVILEGED mutation (the user's own
    // docker socket), so it widens no polkit grant and ALLOWED_VERBS stays ["start"]
    // (adr-0004, adr-0007, adr-0014). It mirrors daemonAction's handler: one one-shot
    // source, one in-flight flag, exit code 0 clears the feedback, anything else
    // surfaces stderr verbatim (or a generic fallback) so a vanished stack is never
    // swallowed.
    property bool composeActionInFlight: false
    property string composeActionProject: ""
    property string composeActionKind: ""     // DockerStatus.COMPOSE_ACTION_* ; "" while idle
    property string composeActionFeedback: ""
    property string composeActionFeedbackSeverity: DockerStatus.SEVERITY_MUTED

    // Podman Desktop launch. Mirrors composeAction's handler: an UNPRIVILEGED mutation
    // (the user's own session) that widens no polkit grant, with one one-shot source and
    // one in-flight flag; exit code 0 clears the feedback and anything else surfaces
    // stderr verbatim (or a generic fallback), so a failed launch is never swallowed
    // (adr-0014, adr-0017).
    property bool podmanLaunchInFlight: false
    property string podmanLaunchFeedback: ""
    property string podmanLaunchFeedbackSeverity: DockerStatus.SEVERITY_MUTED

    property string homeDirectory: ""
    property bool downloadInFlight: false
    property string downloadFeedback: ""
    property string downloadFeedbackSeverity: DockerStatus.SEVERITY_MUTED
    property string downloadStdout: ""
    property string downloadStderr: ""

    // The download-cancellation contract (adr-0022). The row is the notification, and a
    // cancel is a real kill: the download writes its OWN pid into a per-run state file and
    // downloadStopAction signals that pid and sweeps the partials behind it.
    //
    // downloadSessionStamp is minted ONCE per widget instance: the pid file is named
    // download-<stamp>-<token>.pid, and the stamp half is what keeps a reloaded widget's
    // restarted run-token counter from colliding with a previous instance's still-running
    // download. It is a millisecond timestamp PLUS a per-instance random nonce, because the
    // timestamp alone is only unique to the millisecond: two instances loaded in the same
    // millisecond -- one applet in a panel and one on the desktop -- would share the stamp
    // and each mint token 1 for its first run, so both would name download-<stamp>-1.pid,
    // the second pid file would overwrite the first, and the first instance's STOP would
    // signal the second instance's download. The nonce is digits joined by a hyphen, which
    // keeps the value inside resolveDownloadStopFile's /^[A-Za-z0-9._-]+$/ charset -- the
    // only shape that names a stop file at all.
    // downloadRunToken is the DOWNLOAD's own run token -- the other half of that name --
    // and downloadUrl is the paste the partial sweep anchors on while downloadDirectory is
    // the folder that sweep runs in; all three are captured before the engine sees the
    // command, because the stop is dispatched later and must resolve against the values
    // THIS run used, never against a configuration the user may have edited meanwhile.
    //
    // The four flags settle the two racing one-shot events, because the stop command waits
    // for the writer to die and then sweeps, so its closing event OUTLIVES the download's:
    //   downloadCancelRequested  a stop was asked for and has not settled yet;
    //   downloadStopSettled      the stop's own closing event has been observed;
    //   downloadRunClosed        the run's own closing event rendered the run's own outcome;
    //   downloadOutcomeRendered  one outcome is latched on the row and must not be rewritten.
    readonly property string downloadSessionStamp: "" + Date.now() + "-" + Math.floor(Math.random() * 1e9)
    property bool downloadStopInFlight: false
    property int downloadRunToken: 0
    property string downloadUrl: ""
    // The configured download folder AS IT WAS when the run started. Captured for exactly
    // the reason downloadRunToken and downloadUrl are: the stop command resolves `-P` from
    // the value in force at download time, and a folder the user picked while the download
    // was running would send the kill to the right pid but the sweep to the wrong
    // directory, so the partial would survive a cancel reported as clean.
    property string downloadDirectory: ""
    property bool downloadCancelRequested: false
    property bool downloadStopSettled: false
    property bool downloadRunClosed: false
    property bool downloadOutcomeRendered: false

    // Display and open-folder forms of the configured download directory. Both are pure
    // helpers resolved HERE, because the representation never reads configuration: it
    // receives the finished strings as plain properties, exactly like cookiesBrowser.
    // downloadDirectoryDisplay is the tooltip's absolute path and downloadFolderUrl is the
    // file:// URL behind the open-folder shortcut; both are "" until $HOME is known, which
    // is what keeps the tooltip empty and the shortcut disabled instead of guessing.
    readonly property string downloadDirectoryDisplay: DockerStatus.formatDownloadDirectory(Plasmoid.configuration.downloadDirectory, root.homeDirectory)
    readonly property string downloadFolderUrl: DockerStatus.buildFolderUrl(Plasmoid.configuration.downloadDirectory, root.homeDirectory)

    // The countdown is widget-owned: these fields hold the local deadline the ticker
    // reads, while the configured setting only sizes it. shutdownFeedback is neutral
    // while the power-off is in flight and negative when it fails.
    property bool shutdownPending: false
    property bool shutdownInFlight: false
    property double shutdownDeadlineMs: 0
    property int shutdownRemainingSeconds: 0
    property string shutdownFeedback: ""
    property string shutdownFeedbackSeverity: DockerStatus.SEVERITY_MUTED

    // Update check state. updateFeedback reuses the popup's muted, centred line style, so there
    // is no updateFeedbackSeverity and no second colour mapping. updateAvailable is the
    // only thing that shows the line; everything else exists to make it never cry wolf.
    // installedVersion is a cache of the last successfully read installed version: every
    // check parses its own copy and never trusts this one, so it is observable state for a
    // future surface rather than an input to the decision.
    property string installedVersion: ""
    property bool updateCheckInFlight: false
    property bool updateAvailable: false
    property string updateFeedback: ""

    // Deliberately `var`, not `int`: the resolver answers null for a value that cannot
    // arm a countdown, and an int property could not hold that.
    readonly property var resolvedShutdownMinutes: DockerStatus.resolveShutdownMinutes(Plasmoid.configuration.shutdownCountdownMinutes)
    readonly property bool shutdownReady: resolvedShutdownMinutes !== null
    readonly property int shutdownMinutes: shutdownReady ? resolvedShutdownMinutes : 0

    readonly property bool daemonRunning: daemonState === DockerStatus.DAEMON_ACTIVE
    readonly property bool containerListEnabled: daemonRunning && Plasmoid.configuration.showContainerList

    // --- Plasmoid metadata ---------------------------------------------------
    Plasmoid.title: i18n("Docker Status")
    // NoBackground is a sanctioned choice: the widget now paints its own 20px-radius dark
    // card (see FullRepresentation.qml), and contents/config/main.xml carries no background
    // entry, so dropping ConfigurableBackground removes no user-facing setting. Plasma's
    // frame would otherwise show through on a light system theme.
    Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground

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

    // Per-project compose play/stop. The representation never builds a command: it emits
    // a signal naming the project, and this assembles the label-filtered docker command.
    function startComposeProject(project) {
        root.runComposeProject(project, DockerStatus.COMPOSE_ACTION_START);
    }

    function stopComposeProject(project) {
        root.runComposeProject(project, DockerStatus.COMPOSE_ACTION_STOP);
    }

    // One mutation at a time: two groups in flight at once would make the feedback
    // untraceable (one source, one feedback line). The standalone bucket and a null
    // project are refused BEFORE nextRunToken(), so a refused action never burns a token;
    // the empty-command guard stays as defence in depth -- it is the builder's "there is
    // no command" contract for the standalone bucket and an unknown action.
    function runComposeProject(project, action) {
        if (root.composeActionInFlight) {
            return;
        }
        if (project === null || project === undefined || project === DockerStatus.COMPOSE_PROJECT_STANDALONE) {
            return;
        }

        const command = DockerStatus.buildComposeProjectCommand({
            project: project,
            action: action,
            token: root.nextRunToken()
        });
        if (command === "") {
            return;
        }

        root.composeActionInFlight = true;
        root.composeActionProject = project;
        root.composeActionKind = action;
        root.composeActionFeedback = "";
        root.composeActionFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
        composeAction.connectedSources = [command];
    }

    // Podman Desktop launch. The retained pure boundary builds the command: its only
    // interpolated value is the configured executable path, resolved and shell-quoted
    // inside buildPodmanDesktopCommand(), so the command is the quoted path plus the run
    // token and nothing else. One guard, one flag, one one-shot -- the same shape
    // runComposeProject() uses (adr-0014, adr-0017).
    function launchPodmanDesktop() {
        if (root.podmanLaunchInFlight) {
            return;
        }

        root.podmanLaunchInFlight = true;
        root.podmanLaunchFeedback = "";
        root.podmanLaunchFeedbackSeverity = DockerStatus.SEVERITY_MUTED;

        podmanLaunch.connectedSources = [
            DockerStatus.buildPodmanDesktopCommand({
                path: Plasmoid.configuration.podmanDesktopPath,
                home: root.homeDirectory,
                token: root.nextRunToken()
            })
        ];
    }

    // Pasted links are validated before a command exists, and again inside
    // buildVideoDownloadCommand() before anything is shell-quoted into one.
    //
    // The order is build-then-guard-then-set, deliberately: the command embeds the run's
    // pid file name, so the builder is the only thing that can say whether this run can be
    // cancelled at all, and a run it refuses never reaches the engine (adr-0006, adr-0022).
    // The feedback is written before the engine assignment in every branch, so the row --
    // which is the notification -- renders in the same synchronous turn as the click,
    // independent of the Import button's own geometry.
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

        // The token is minted BEFORE the command is built, because the command embeds the
        // pid file this token names: the run writes its own pid there, and
        // buildDownloadStopCommand() later locates that file by the same token. A run whose
        // stop file cannot be resolved is refused rather than started uncancellable --
        // unresolvable means $HOME is unknown, the same condition that already gates
        // downloadReady, so this guard is the belt to that braces.
        const token = root.nextRunToken();
        const command = DockerStatus.buildVideoDownloadCommand({
            binary: Plasmoid.configuration.ytDlpBinary,
            directory: Plasmoid.configuration.downloadDirectory,
            jsRuntime: Plasmoid.configuration.jsRuntime,
            cookiesBrowser: Plasmoid.configuration.cookiesBrowser,
            home: root.homeDirectory,
            url: url,
            sessionStamp: root.downloadSessionStamp,
            token: token
        });
        if (command === "") {
            root.downloadFeedback = i18n("The download could not start, because it could not be made cancellable.");
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        // The run's identity is captured before the engine sees the command, and every race
        // flag is cleared, so a second run can never inherit the previous run's state. The
        // directory is captured raw alongside the URL and the token: stopDownload() sweeps
        // from it, and it must be the folder the run resolved -P against rather than
        // whatever the configuration page says by the time STOP is clicked.
        root.downloadRunToken = token;
        root.downloadUrl = url;
        root.downloadDirectory = Plasmoid.configuration.downloadDirectory;
        root.downloadCancelRequested = false;
        root.downloadStopSettled = false;
        root.downloadRunClosed = false;
        root.downloadOutcomeRendered = false;
        root.downloadStopInFlight = false;

        root.downloadInFlight = true;
        root.downloadFeedback = root.downloadInFlightText();
        root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
        root.downloadStdout = "";
        root.downloadStderr = "";

        downloadAction.connectedSources = [ command ];
    }

    // The row's in-flight text, in ONE place: downloadVideo() is now its only writer,
    // because handleDownloadStop() no longer restores it -- a stop that settles as a no-op
    // says so in the negative-feedback line instead -- so the text can never drift into
    // naming a different source.
    function downloadInFlightText() {
        return DockerStatus.classifyVideoUrl(root.downloadUrl) === DockerStatus.VIDEO_KIND_YOUTUBE
            ? i18n("Downloading the video from YouTube…")
            : i18n("Downloading the video from X…");
    }

    // The row's STOP. The stop command is assembled from the captured run identity: the
    // session stamp plus the DOWNLOAD's own run token locate the pid file, the captured
    // URL anchors the partial-file sweep and the captured directory is the folder that
    // sweep runs in -- all three read from the run, never re-read from
    // Plasmoid.configuration, which the user may have edited while the download ran. It is
    // deliberately NOT a disconnect -- connectedSources = [] ends the events, not the
    // process, and a row that reported "cancelled" while yt-dlp kept downloading would be
    // lying (adr-0022).
    //
    // The stop command carries its OWN run token, so a second click is a distinct source
    // for the engine instead of a silent set no-op.
    function stopDownload() {
        if (!root.downloadInFlight || root.downloadStopInFlight) {
            return;
        }

        const command = DockerStatus.buildDownloadStopCommand({
            directory: root.downloadDirectory,
            home: root.homeDirectory,
            sessionStamp: root.downloadSessionStamp,
            runToken: root.downloadRunToken,
            url: root.downloadUrl,
            token: root.nextRunToken()
        });
        if (command === "") {
            // No stop file means no handle: report it honestly and never pretend a cancel
            // happened. The run stays in flight and STOP stays live -- a possibly-running
            // download must not be stranded behind a dead button.
            root.downloadFeedback = i18n("The download could not be stopped; it may still be running.");
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        // The settled flag is cleared on EVERY dispatch, not only on the first: it is the
        // other half of the guard that keeps downloadAction from flashing the run's own
        // failure line while a cancel is pending, and a flag left set by a previous stop
        // would leave a retry unguarded, so the row could paint "the download failed
        // (exit code 143)" for the process the stop command killed.
        root.downloadStopSettled = false;
        root.downloadCancelRequested = true;
        root.downloadStopInFlight = true;
        root.downloadFeedback = i18n("Cancelling…");
        root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
        downloadStopAction.connectedSources = [ command ];
    }

    // The row's X. It clears the row's own feedback and nothing else: the row IS the
    // notification, so dismissing it must not touch the run, the cancel state, or any other
    // surface's feedback line.
    function dismissDownloadFeedback() {
        root.downloadFeedback = "";
        root.downloadFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
    }

    /*
     * The stop one-shot's closing event, and the settlement of the race between it and
     * downloadAction's. The stop command waits for the writer to die and then sweeps, so
     * its event outlives the download's own -- yet either can arrive first, because the
     * engine delivers exactly one event per run at process exit and the two processes exit
     * independently (docs/status/data-engine-contract.md). Every branch therefore reads the
     * flags, never the arrival order, and downloadOutcomeRendered is the single latch that
     * keeps a settled row from being rendered twice.
     */
    function handleDownloadStop(data) {
        root.downloadStopInFlight = false;

        const exitCode = data["exit code"];
        if (exitCode === undefined) {
            return;
        }

        // Accumulated into the run's own accumulators: the download is dead by the time a
        // stop can report, and the stop's stdout carries only its "docker-status: " marker,
        // which parseDownloadStopResult() is the only thing that reads. Its stderr stays
        // the operating system's error channel, surfaced exactly like daemonAction's.
        root.downloadStdout += String(data["stdout"] !== undefined ? data["stdout"] : "");
        root.downloadStderr += String(data["stderr"] !== undefined ? data["stderr"] : "");

        const marker = DockerStatus.parseDownloadStopResult(root.downloadStdout);
        const stderr = DockerStatus.normalizeOutput(root.downloadStderr);
        const output = DockerStatus.normalizeOutput(root.downloadStdout + "\n" + root.downloadStderr);
        root.downloadStopSettled = true;

        if (marker === DockerStatus.DOWNLOAD_STOP_KILLED) {
            // The stop command's own predicate answers "accepted" for a zombie: a pid whose
            // /proc/<pid>/stat state is Z still passes kill -0 and kill -TERM, so a run that
            // already exited -- and whose own closing event already painted its real result
            // -- is reported as killed. That event is the truth and the row is already
            // latched, so a stop that signalled a corpse must never relabel it: only a stop
            // whose run has NOT closed (a genuine kill, whose own failure event the guard in
            // downloadAction withheld) may claim the cancel below.
            if (root.downloadRunClosed) {
                root.downloadCancelRequested = false;
                return;
            }

            root.downloadInFlight = false;
            root.downloadCancelRequested = false;
            root.downloadOutcomeRendered = true;
            if (stderr === "" && Number(exitCode) === 0) {
                // The process died and the sweep ran: the one clean claim.
                root.downloadFeedback = i18n("Download cancelled.");
                root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEUTRAL;
                return;
            }

            // The process died but the sweep could not finish its job: either the kill was
            // refused (stderr marker, exit 1, nothing swept) or `find` could not read the
            // directory (non-zero exit -- the sweep is the last program in the run on
            // purpose, so its failure is the run's exit status). Surface the engine's own
            // error line rather than a bare claim of a clean cancel.
            const detail = DockerStatus.extractErrorLine(output);
            root.downloadFeedback = detail !== ""
                ? i18nc("@info", "Download cancelled, but the partial file could not be removed: %1", detail)
                : i18nc("@info", "Download cancelled, but the partial file could not be removed (exit code %1).", Number(exitCode));
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        if (marker === DockerStatus.DOWNLOAD_STOP_KILLED_UNSWEPT) {
            // Same zombie guard as the KILLED case above: the stop command's predicate
            // answers "accepted" for a pid whose /proc/<pid>/stat state is Z, so a run
            // that already exited -- and whose own closing event already painted its real
            // result -- is reported as killed. That event is the truth and the row is
            // already latched, so a stop that signalled a corpse must never relabel it.
            if (root.downloadRunClosed) {
                root.downloadCancelRequested = false;
                return;
            }

            root.downloadInFlight = false;
            root.downloadCancelRequested = false;
            root.downloadOutcomeRendered = true;
            // The process died, but there was no video id to anchor a sweep on, so the
            // partial may still be there. The honest half of the pair, never a clean claim.
            root.downloadFeedback = i18n("Download cancelled. The partial file could not be removed automatically.");
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        if (marker === DockerStatus.DOWNLOAD_STOP_NOT_RUNNING) {
            // No live pid: the click is visibly a no-op, never a false "cancelled". If the
            // run's own closing event already rendered its outcome, that outcome stands on
            // the row and is never overwritten with a cancel the stop cannot prove.
            root.downloadCancelRequested = false;
            if (root.downloadRunClosed) {
                return;
            }

            // Otherwise the run is still live -- or its own closing event was withheld by
            // this very stop, in which case that event renders as soon as it arrives. The
            // row SAYS the stop did not take instead of restoring the in-flight text
            // silently: a download directory the widget cannot write produces no pid file at
            // all, so this branch would answer not-running on every retry behind a STOP that
            // visibly does nothing and the user would be told nothing (adr-0022 accepts the
            // failure; it does not accept a silent one). downloadInFlight stays true and
            // STOP stays visible and enabled, so a possibly-running download is neither
            // stranded behind a dead button nor left without a way to retry. The dismiss X
            // stays hidden, because it is gated on !downloadInFlight on purpose.
            root.downloadInFlight = true;
            root.downloadFeedback = i18n("The download could not be stopped; it may still be running.");
            root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            return;
        }

        // DOWNLOAD_STOP_UNKNOWN: the kill was refused (stderr marker, exit 1, no sweep) or
        // the run said nothing this build can parse. Never claim a cancel, and leave
        // downloadInFlight untouched so a possibly-live download is not stranded behind a
        // dead button -- STOP stays available and retryable.
        root.downloadFeedback = i18n("The download could not be stopped; it may still be running.");
        root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
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

    /*
     * Update check. checkForUpdates() is the manual one-shot (the context-menu action);
     * the polled updateCheckSource runs the same fixed command in the background and both
     * deliver here. The handler is deliberately quiet: every failure -- no curl, no
     * metadata.json, offline, an unparseable manifest -- lands on the silent branch and
     * produces no text at all. There is no stderr surfacing anywhere in this path.
     */
    function checkForUpdates() {
        if (root.updateCheckInFlight) {
            return;
        }
        root.updateCheckInFlight = true;
        updateCheckForced.connectedSources = [
            DockerStatus.withRunToken(root.updateCheckCommand, root.nextRunToken())
        ];
    }

    function handleUpdateCheck(sourceName, data) {
        // Only the event that closes a run carries "exit code"; ignore anything else. The
        // in-flight flag is cleared on that closing event and nowhere else, the same guard
        // and the same ordering downloadAction uses, so a future engine that streams cannot
        // free the button while the run is still alive.
        const exitCode = data["exit code"];
        if (exitCode === undefined) {
            return;
        }

        root.updateCheckInFlight = false;

        // Every check stands ONLY on what its own run observed. The installed version is
        // parsed from THIS run's bytes and is never inherited from an earlier one: a package
        // swapped under a live widget would otherwise leave a stale cached version to be
        // compared against a fresh manifest -- the exact "the version I just installed is
        // not recognised" window the silent path has to cover. installedVersion therefore
        // becomes a plain cache of the last successful read, observable but never trusted.
        const halves = DockerStatus.splitUpdateCheckOutput(data["stdout"]);
        const installed = halves.installed !== ""
            ? DockerStatus.parseWidgetVersion(halves.installed)
            : "";
        root.installedVersion = installed;

        // The silent path: offline, no curl, a missing metadata.json, an unreadable
        // installed version, or an unparseable manifest. Clear everything and show nothing
        // -- this is the whole offline contract, and it never surfaces stderr.
        const latest = DockerStatus.parseLatestVersion(halves.manifest);
        if (latest === "" || installed === "") {
            root.updateAvailable = false;
            root.updateFeedback = "";
            return;
        }

        // A remote that is not strictly newer is not an update: isUpdateAvailable() is
        // conservative by design and must never be talked into showing a line that is wrong.
        root.updateAvailable = DockerStatus.isUpdateAvailable(installed, latest);
        root.updateFeedback = root.updateAvailable
            ? i18nc("@info", "Version %1 is available.", latest)
            : "";
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

    // One-shot: the unprivileged `docker start|stop` for one compose project, assembled by
    // DockerStatus.buildComposeProjectCommand() and run by runComposeProject(). Mirrors
    // daemonAction: one source, one in-flight flag, exit code 0 clears the feedback and
    // anything else surfaces stderr verbatim (or a generic fallback naming the project and
    // the action that actually ran) so a vanished stack is never swallowed.
    P5Support.DataSource {
        id: composeAction
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            const kind = root.composeActionKind;
            const project = root.composeActionProject;

            root.composeActionInFlight = false;
            root.composeActionKind = "";
            root.composeActionProject = "";

            const exitCode = Number(data["exit code"]);
            if (exitCode === 0) {
                root.composeActionFeedback = "";
                root.composeActionFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
                return;
            }

            const stderr = DockerStatus.normalizeOutput(data["stderr"]);
            root.composeActionFeedback = stderr !== ""
                ? stderr
                : (kind === DockerStatus.COMPOSE_ACTION_STOP
                    ? i18nc("@info", "Stopping compose project %1 failed (exit code %2).", project, exitCode)
                    : i18nc("@info", "Starting compose project %1 failed (exit code %2).", project, exitCode));
            root.composeActionFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
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

            // A completed download is never relabelled a cancel, whatever a stop is doing:
            // the sweep only ever touches .part/.part-Frag*/.ytdl files, so it cannot delete
            // a finished one. This branch renders unconditionally and latches both flags,
            // which is what lets a stop that arrives afterwards answer not-running and
            // still leave this result on the row (adr-0022).
            const okExit = Number(exitCode) === 0;
            const file = okExit ? DockerStatus.parseDownloadedFile(output) : "";
            if (okExit && file !== "") {
                root.downloadFeedback = i18nc("@info", "Saved to %1", file);
                root.downloadFeedbackSeverity = DockerStatus.SEVERITY_POSITIVE;
                root.downloadCancelRequested = false;
                root.downloadRunClosed = true;
                root.downloadOutcomeRendered = true;
                return;
            }

            // Any other outcome renders only when nothing has claimed the row yet and no
            // cancel is waiting to settle: a pending-unsettled stop keeps "Cancelling…" on
            // screen, so the row never flashes "the download failed (exit code 143)" for a
            // process the stop command killed. The numeric code of a killed process is
            // deliberately never depended on; the stop's own marker settles the row.
            if (root.downloadOutcomeRendered
                    || (root.downloadCancelRequested && !root.downloadStopSettled)) {
                return;
            }

            if (okExit) {
                // Exit 0 with no path to name is still a success, never a failure line.
                root.downloadFeedback = i18n("Download finished.");
                root.downloadFeedbackSeverity = DockerStatus.SEVERITY_POSITIVE;
            } else {
                const detail = DockerStatus.extractErrorLine(output);
                root.downloadFeedback = detail !== ""
                    ? detail
                    : i18nc("@info", "The download failed (exit code %1).", Number(exitCode));
                root.downloadFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
            }
            root.downloadRunClosed = true;
            root.downloadOutcomeRendered = true;
        }
    }

    // One-shot: the download cancellation, assembled by
    // DockerStatus.buildDownloadStopCommand() and run by stopDownload(). It waits for the
    // writer to die and then sweeps, so its closing event OUTLIVES the download's own and
    // the two events race; handleDownloadStop() settles that race order-independently
    // (adr-0022). One source, one in-flight flag, exactly like downloadAction.
    P5Support.DataSource {
        id: downloadStopAction
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.handleDownloadStop(data);
        }
    }

    // One-shot: the Podman Desktop launch, assembled by DockerStatus.buildPodmanDesktopCommand()
    // and run by launchPodmanDesktop(). Mirrors composeAction: one source, one in-flight flag,
    // exit code 0 clears the feedback and anything else surfaces stderr verbatim (or a generic
    // fallback) so a failed launch is never swallowed (adr-0014, adr-0017).
    P5Support.DataSource {
        id: podmanLaunch
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.podmanLaunchInFlight = false;

            const exitCode = Number(data["exit code"]);
            if (exitCode === 0) {
                root.podmanLaunchFeedback = "";
                root.podmanLaunchFeedbackSeverity = DockerStatus.SEVERITY_MUTED;
                return;
            }

            const stderr = DockerStatus.normalizeOutput(data["stderr"]);
            root.podmanLaunchFeedback = stderr !== ""
                ? stderr
                : i18nc("@info", "Podman Desktop failed to start (exit code %1).", exitCode);
            root.podmanLaunchFeedbackSeverity = DockerStatus.SEVERITY_NEGATIVE;
        }
    }

    // Update check: two sources, the eleventh and twelfth in this file (the ten before them
    // are the two docker probes, forcedDaemonRead, daemonAction, composeAction, powerAction,
    // homeSource, downloadAction, downloadStopAction and podmanLaunch). A polled source runs
    // the fixed command -- the engine runs it once on connect, so the load-time check is
    // free -- and disconnects itself when the interval is 0 via the connectedSources binding.
    // A one-shot carries the manual "Check for updates": a polled source's connectedSources
    // is a binding and cannot be reassigned per click, so the tokenised command rides this
    // one instead, exactly like the daemon re-read. Both deliver to the single handler above;
    // neither ever surfaces stderr.
    P5Support.DataSource {
        id: updateCheckSource
        engine: "executable"
        interval: root.updateCheckIntervalMs
        connectedSources: root.updateCheckIntervalMs > 0 ? [root.updateCheckCommand] : []

        onNewData: (sourceName, data) => {
            root.handleUpdateCheck(sourceName, data);
        }
    }

    P5Support.DataSource {
        id: updateCheckForced
        engine: "executable"
        interval: 0
        connectedSources: []

        onNewData: (sourceName, data) => {
            root.handleUpdateCheck(sourceName, data);
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
        },
        PlasmaCore.Action {
            text: i18n("Check for updates")
            icon.name: "system-software-update"
            enabled: !root.updateCheckInFlight
            onTriggered: root.checkForUpdates()
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
        cookiesBrowser: Plasmoid.configuration.cookiesBrowser
        downloadReady: root.homeDirectory !== ""
        downloadInFlight: root.downloadInFlight
        downloadStopInFlight: root.downloadStopInFlight
        downloadFeedback: root.downloadFeedback
        downloadFeedbackSeverity: root.downloadFeedbackSeverity
        downloadDirectoryDisplay: root.downloadDirectoryDisplay
        downloadFolderUrl: root.downloadFolderUrl
        shutdownReady: root.shutdownReady
        shutdownMinutes: root.shutdownMinutes
        shutdownMinutesText: Plasmoid.configuration.shutdownCountdownMinutes
        shutdownPending: root.shutdownPending
        shutdownInFlight: root.shutdownInFlight
        shutdownRemainingSeconds: root.shutdownRemainingSeconds
        shutdownFeedback: root.shutdownFeedback
        shutdownFeedbackSeverity: root.shutdownFeedbackSeverity
        updateAvailable: root.updateAvailable
        updateFeedback: root.updateFeedback
        composeActionInFlight: root.composeActionInFlight
        composeActionProject: root.composeActionProject
        composeActionKind: root.composeActionKind
        composeActionFeedback: root.composeActionFeedback
        composeActionFeedbackSeverity: root.composeActionFeedbackSeverity
        podmanLaunchInFlight: root.podmanLaunchInFlight
        podmanLaunchFeedback: root.podmanLaunchFeedback
        podmanLaunchFeedbackSeverity: root.podmanLaunchFeedbackSeverity

        onStartRequested: root.startDaemon()
        onStopRequested: root.stopDaemon()
        onRefreshRequested: root.refreshDaemonState()
        onDownloadRequested: (url) => root.downloadVideo(url)
        onDownloadStopRequested: root.stopDownload()
        onDownloadDismissed: root.dismissDownloadFeedback()
        onShutdownStartRequested: root.startShutdownCountdown()
        onShutdownStopRequested: root.stopShutdownCountdown()
        onShutdownMinutesEdited: (text) => root.setShutdownMinutes(text)
        onUpdateCheckRequested: root.checkForUpdates()
        onComposeStartRequested: (project) => root.startComposeProject(project)
        onComposeStopRequested: (project) => root.stopComposeProject(project)
        onPodmanLaunchRequested: root.launchPodmanDesktop()
    }
}
