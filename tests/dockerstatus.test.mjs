import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

/*
 * Runs the exact shipped dockerstatus.js inside a bare V8 context.
 *
 * QML's ".pragma library" directive is not valid JavaScript, so the pragma line
 * is stripped before evaluation. Everything else is the real file, byte for
 * byte, so these tests exercise what actually ships in the plasmoid.
 */
const sourceUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/ui/dockerstatus.js",
    import.meta.url,
);

const source = readFileSync(sourceUrl, "utf8").replace(/^\s*\.pragma\b.*$/gm, "");

const sandbox = {};
runInContext(source, createContext(sandbox));

/*
 * Objects built inside the vm context belong to a different realm, so their
 * prototypes are not reference-equal to this realm's Object.prototype and
 * deepStrictEqual rejects them even when the values match. Round-tripping
 * through JSON moves them into this realm so the comparison is meaningful.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

const {
    DAEMON_ACTIVE,
    DAEMON_INACTIVE,
    DAEMON_FAILED,
    DAEMON_UNKNOWN,
    ACTION_START,
    ACTION_STOP,
    SEVERITY_POSITIVE,
    SEVERITY_NEUTRAL,
    SEVERITY_NEGATIVE,
    SEVERITY_MUTED,
    UPDATE_CHECK_URL,
    UPDATE_PAGE_URL,
    UPDATE_CHECK_MAX_TIME_SECONDS,
    UPDATE_CHECK_MARKER,
    UPDATE_CHECK_CURL_BINARY,
    PACKAGE_ID,
    INSTALLED_METADATA_PATH,
    parseDaemonState,
    parseContainers,
    countByState,
    summarizeContainers,
    withRunToken,
    daemonSeverity,
    containerSeverity,
    COMPOSE_PROJECT_STANDALONE,
    COMPOSE_ACTION_START,
    COMPOSE_ACTION_STOP,
    PODMAN_DESKTOP_DEFAULT,
    groupContainersByComposeProject,
    buildComposeProjectCommand,
    resolvePodmanDesktopPath,
    buildPodmanDesktopCommand,
    VIDEO_KIND_YOUTUBE,
    VIDEO_KIND_TWITTER,
    VIDEO_OUTPUT_TEMPLATE,
    YTDLP_DEFAULT_BINARY,
    COOKIES_BROWSER_DEFAULT,
    JS_RUNTIME_DEFAULT,
    classifyVideoUrl,
    shellQuote,
    expandTilde,
    resolveDownloadDirectory,
    formatDownloadDirectory,
    buildFolderUrl,
    resolveYtDlpBinary,
    resolveCookiesBrowser,
    resolveJsRuntime,
    buildVideoDownloadCommand,
    parseDownloadedFile,
    extractErrorLine,
    SHUTDOWN_MINUTES_DEFAULT,
    SHUTDOWN_MINUTES_MINIMUM,
    resolveShutdownMinutes,
    shutdownRemainingSeconds,
    formatCountdown,
    buildUpdateCheckCommand,
    splitUpdateCheckOutput,
    parseWidgetVersion,
    parseLatestVersion,
    compareVersions,
    isUpdateAvailable,
} = sandbox;

test("the shipped module exposes the documented constants", () => {
    assert.equal(DAEMON_ACTIVE, "active");
    assert.equal(DAEMON_INACTIVE, "inactive");
    assert.equal(DAEMON_FAILED, "failed");
    assert.equal(DAEMON_UNKNOWN, "unknown");
});

/*
 * The widget's two privileged actions share one one-shot DataSource and one in-flight
 * flag, so QML distinguishes them by these identity values. This test pins the values
 * themselves; the QML-reading test below asserts that main.qml and FullRepresentation.qml
 * actually reference the constants, so neither side can drift alone.
 */
test("the action identities are stable and distinct", () => {
    assert.equal(ACTION_START, "start");
    assert.equal(ACTION_STOP, "stop");
    assert.notEqual(ACTION_START, ACTION_STOP);
});

/*
 * Why this test exists. adr-0007 adds a stop button whose whole safety argument is
 * that the polkit grant was NOT widened for it: stopping prompts for a password while
 * starting stays passwordless. This test pins the shipped rule as text -- the literal
 * ALLOWED_VERBS array, a single polkit.addRule() call, and the membership check that
 * still reads that array. It is not a runtime test of polkit: the companion test below
 * executes the captured predicate instead.
 */
test("the polkit rule grants exactly the start verb and nothing more", () => {
    const rulesUrl = new URL("../polkit/49-docker-status-widget.rules", import.meta.url);
    const rules = readFileSync(rulesUrl, "utf8");

    const match = /var ALLOWED_VERBS = (\[[^\]]*\]);/.exec(rules);
    assert.ok(match, "ALLOWED_VERBS must be assigned a literal array");

    assert.deepEqual(
        JSON.parse(match[1]),
        ["start"],
        "adr-0007: the stop button deliberately relies on the interactive polkit prompt. "
            + "Widening ALLOWED_VERBS to include stop is a security decision, not a bug fix, "
            + "and it must arrive as a deliberate, reviewed change to the grant.",
    );

    // The verb list is only meaningful inside a rule that still pins the action, the
    // unit and the session, so assert those stay put too.
    assert.ok(rules.includes('action.id !== "org.freedesktop.systemd1.manage-units"'));
    assert.ok(rules.includes('action.lookup("unit") !== "docker.service"'));
    assert.ok(rules.includes("!subject.local || !subject.active"));

    // Cheap structural guards: a second rule returning YES, or a verb check that no longer
    // consults the array, would leave the literal above true and still widen the grant.
    assert.equal(
        (rules.match(/polkit\.addRule\(/g) || []).length,
        1,
        "the file must register exactly one polkit rule",
    );
    assert.ok(
        rules.includes('ALLOWED_VERBS.indexOf(action.lookup("verb")) === -1'),
        "the verb check must still go through ALLOWED_VERBS",
    );
});

/*
 * Why this test exists. The text check above can be defeated without editing the
 * ALLOWED_VERBS literal at all: a second polkit.addRule() returning YES, an
 * ALLOWED_VERBS.push("stop"), a deleted verb gate, or a rule that grants a different
 * action id outright. The shipped rule is plain ES5 that calls polkit.addRule(fn), so these
 * tests execute the real bytes with a stubbed polkit and drive the captured predicate over
 * its whole decision surface. This is the grant as written, evaluated against a stub: it is
 * not polkit's own enforcement, and it is not a real authentication prompt.
 */
const RULE_NOT_HANDLED = Object.freeze({ result: "not-handled" });
const RULE_YES = Object.freeze({ result: "yes" });

function loadShippedPolkitRule() {
    const rulesUrl = new URL("../polkit/49-docker-status-widget.rules", import.meta.url);
    const source = readFileSync(rulesUrl, "utf8");

    const registered = [];
    const polkit = {
        Result: { NOT_HANDLED: RULE_NOT_HANDLED, YES: RULE_YES },
        addRule: (rule) => { registered.push(rule); },
    };

    runInContext(source, createContext({ polkit }));

    return registered;
}

const shippedRules = loadShippedPolkitRule();

const MANAGE_UNITS_ACTION = "org.freedesktop.systemd1.manage-units";

/* The rule only reaches action.id, action.lookup("unit") and action.lookup("verb"), so the
 * stub exposes exactly that surface. The action id defaults to the documented one, so the
 * gate tests below can stay terse. */
const polkitAction = (unit, verb, id = MANAGE_UNITS_ACTION) => ({
    id,
    lookup: (key) => (key === "unit" ? unit : key === "verb" ? verb : undefined),
});

const subjectWithMemberMethod = (inWheel) => ({
    local: true,
    active: true,
    isInGroup: (group) => inWheel && group === "wheel",
});

const subjectWithMemberFlag = (inWheel) => ({
    local: true,
    active: true,
    isInGroup: inWheel,
});

/* The one combination the grant may allow, defined once so the matrix and the gate test
 * cannot drift apart. */
const GRANTED_COMBINATION = [MANAGE_UNITS_ACTION, "docker.service", "start"];

test("the shipped polkit predicate is default-deny across its whole decision surface", () => {
    assert.equal(shippedRules.length, 1, "exactly one rule must be registered");
    const rule = shippedRules[0];

    const actionIds = [
        MANAGE_UNITS_ACTION,
        "org.freedesktop.systemd1.manage-unit-files",
        "org.freedesktop.systemd1.reload-daemon",
        "org.freedesktop.udisks2.filesystem-mount",
    ];
    const units = ["docker.service", "docker.socket", "docker", "docker.service.d", "sshd.service", ""];
    const verbs = [
        "start", "stop", "restart", "reload", "try-restart",
        "enable", "disable", "mask", "unmask", "kill",
    ];

    const granted = [];
    for (const id of actionIds) {
        for (const unit of units) {
            for (const verb of verbs) {
                if (rule(polkitAction(unit, verb, id), subjectWithMemberMethod(true)) === RULE_YES) {
                    granted.push([id, unit, verb]);
                }
            }
        }
    }

    // The whole grant, in one assertion: one action id, one unit, one verb. Anything else
    // reaching YES -- another unit, another verb (stop included), another action id -- is a
    // security decision rather than a bug fix, and it must fail here (adr-0007).
    assert.deepEqual(
        granted,
        [GRANTED_COMBINATION],
        "adr-0007: the polkit grant must remain exactly one action id, one unit and one verb.",
    );
});

test("flipping any single session or group gate denies the granted combination", () => {
    assert.equal(shippedRules.length, 1, "exactly one rule must be registered");
    const rule = shippedRules[0];
    const grantedAction = polkitAction("docker.service", "start");

    // Both isInGroup shim shapes the rule supports, on the granted subject.
    assert.equal(rule(grantedAction, subjectWithMemberMethod(true)), RULE_YES);
    assert.equal(rule(grantedAction, subjectWithMemberFlag(true)), RULE_YES);

    const oneGateFlipped = [
        { local: false, active: true, isInGroup: () => true },
        { local: true, active: false, isInGroup: () => true },
        subjectWithMemberMethod(false),
        subjectWithMemberFlag(false),
    ];

    for (const subject of oneGateFlipped) {
        assert.equal(
            rule(grantedAction, subject),
            RULE_NOT_HANDLED,
            "flipping any single session or group gate must deny the granted combination",
        );
    }
});

/*
 * Why this test exists. The executable engine runs its source through a shell and the
 * run token appends a trailing comment, which is only safe for command strings the
 * project builds itself. The Docker side never assembles a command from input, so both
 * privileged commands must stay fixed literals -- interpolation here would quietly undo
 * the boundary the run-token mechanism depends on. The same test reads both QML files and
 * counts the exact actionKind assignments and comparisons, because a change to a bare
 * literal would leave the constant used elsewhere and pass a plain presence check.
 */
test("the privileged commands stay fixed and both representations use the action identities", () => {
    const mainQmlUrl = new URL(
        "../package/io.github.daver-ui.dockerstatus/contents/ui/main.qml",
        import.meta.url,
    );
    const mainQml = readFileSync(mainQmlUrl, "utf8");

    assert.ok(mainQml.includes('readonly property string daemonStartCommand: "systemctl start docker"'));
    assert.ok(mainQml.includes('readonly property string daemonStopCommand: "systemctl stop docker"'));
    assert.ok(
        !/readonly property string daemon(?:Start|Stop)Command:[^\n]*\$\{/.test(mainQml),
        "a privileged command must not interpolate anything into its string",
    );

    // Presence is not intent: a drifted assignment to a bare literal would still contain the
    // constant elsewhere in the file and pass a plain includes() check. Count the exact
    // expressions instead, so an altered or duplicated assignment cannot slip in.
    const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

    assert.equal(
        occurrences(mainQml, "root.actionKind = DockerStatus.ACTION_START"),
        1,
        "main.qml must assign DockerStatus.ACTION_START to root.actionKind exactly once",
    );
    assert.equal(
        occurrences(mainQml, "root.actionKind = DockerStatus.ACTION_STOP"),
        1,
        "main.qml must assign DockerStatus.ACTION_STOP to root.actionKind exactly once",
    );

    const fullQmlUrl = new URL(
        "../package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml",
        import.meta.url,
    );
    const fullQml = readFileSync(fullQmlUrl, "utf8");

    assert.equal(
        occurrences(fullQml, "fullRoot.actionKind === DockerStatus.ACTION_START"),
        1,
        "FullRepresentation.qml must compare fullRoot.actionKind to DockerStatus.ACTION_START exactly once",
    );
    assert.equal(
        occurrences(fullQml, "fullRoot.actionKind === DockerStatus.ACTION_STOP"),
        1,
        "FullRepresentation.qml must compare fullRoot.actionKind to DockerStatus.ACTION_STOP exactly once",
    );
});

test("parseDaemonState maps real systemctl is-active output", () => {
    // Captured from this machine: `systemctl is-active docker` -> "active\n".
    assert.equal(parseDaemonState("active\n"), DAEMON_ACTIVE);
    // Captured from this machine: `systemctl is-active sshd` -> "inactive\n", exit 3.
    assert.equal(parseDaemonState("inactive\n"), DAEMON_INACTIVE);
    assert.equal(parseDaemonState("failed\n"), DAEMON_FAILED);
});

test("parseDaemonState normalises case, whitespace and CRLF", () => {
    assert.equal(parseDaemonState("ACTIVE"), DAEMON_ACTIVE);
    assert.equal(parseDaemonState("  active \r\n"), DAEMON_ACTIVE);
    assert.equal(parseDaemonState("activating\n"), DAEMON_ACTIVE);
    assert.equal(parseDaemonState("reloading\n"), DAEMON_ACTIVE);
    assert.equal(parseDaemonState("deactivating\n"), DAEMON_INACTIVE);
});

test("parseDaemonState degrades to unknown instead of claiming stopped", () => {
    // A failed probe must never be reported as a healthy "inactive" reading.
    assert.equal(parseDaemonState(""), DAEMON_UNKNOWN);
    assert.equal(parseDaemonState(undefined), DAEMON_UNKNOWN);
    assert.equal(parseDaemonState(null), DAEMON_UNKNOWN);
    assert.equal(parseDaemonState("bash: docker: command not found"), DAEMON_UNKNOWN);
    assert.equal(parseDaemonState("unknown"), DAEMON_UNKNOWN);
});

test("parseContainers parses the real catan-lan stack output with its compose project", () => {
    const raw =
        "catan-lan-player-1|running|catan-lan\n" +
        "catan-lan-admin-1|running|catan-lan\n" +
        "catan-lan-api-1|running|catan-lan\n";

    const containers = parseContainers(raw);

    assert.equal(containers.length, 3);
    assert.deepEqual(plain(containers[0]), {
        name: "catan-lan-player-1",
        state: "running",
        project: "catan-lan",
    });
    assert.deepEqual(plain(containers[2]), {
        name: "catan-lan-api-1",
        state: "running",
        project: "catan-lan",
    });
});

test("parseContainers returns an empty list for empty output", () => {
    assert.deepEqual(plain(parseContainers("")), []);
    assert.deepEqual(plain(parseContainers("\n")), []);
    assert.deepEqual(plain(parseContainers("   \n  \n")), []);
    assert.deepEqual(plain(parseContainers(undefined)), []);
});

test("parseContainers skips malformed lines rather than half-building entries", () => {
    const raw = [
        "good|running",
        "no-separator-here",
        "|running",
        "missing-state|",
        "also-good|exited",
    ].join("\n");

    assert.deepEqual(plain(parseContainers(raw)), [
        { name: "good", state: "running", project: "" },
        { name: "also-good", state: "exited", project: "" },
    ]);
});

test("parseContainers tolerates CRLF and trailing newlines", () => {
    const containers = parseContainers("a|running|proj-a\r\nb|exited|proj-b\r\n");
    assert.equal(containers.length, 2);
    assert.deepEqual(plain(containers[1]), { name: "b", state: "exited", project: "proj-b" });
});

test("parseContainers splits at the first two separators and keeps the rest whole", () => {
    // The name ends at the FIRST '|', the state at the SECOND, and the project is the
    // entire remainder -- never split again -- so a project value carrying a '|' survives.
    assert.deepEqual(plain(parseContainers("weird|running|extra")), [
        { name: "weird", state: "running", project: "extra" },
    ]);
    assert.deepEqual(plain(parseContainers("svc|running|proj|extra")), [
        { name: "svc", state: "running", project: "proj|extra" },
    ]);
});

test("parseContainers parses the reference machine's three-field probe output", () => {
    // Measured on the reference machine, docker 29.9.0: one compose stack named
    // odysseus, four exited containers (adr-0014).
    const raw =
        "odysseus-odysseus-1|exited|odysseus\n" +
        "odysseus-searxng-1|exited|odysseus\n" +
        "odysseus-chromadb-1|exited|odysseus\n" +
        "odysseus-ntfy-1|exited|odysseus\n";

    const containers = parseContainers(raw);

    assert.equal(containers.length, 4);
    assert.deepEqual(plain(containers[0]), {
        name: "odysseus-odysseus-1",
        state: "exited",
        project: "odysseus",
    });
    assert.deepEqual(plain(containers[3]), {
        name: "odysseus-ntfy-1",
        state: "exited",
        project: "odysseus",
    });
});

test("parseContainers still parses a two-field line into the standalone bucket", () => {
    // A docker too old to answer the label emits only two fields. The line must still
    // parse with an empty project -- degrading to one flat group rather than to nothing
    // -- and a three-field line beside it keeps its project.
    const containers = parseContainers([
        "lonely|running",
        "stacked|exited|proj",
        "trailing|created|",
    ].join("\n"));

    assert.deepEqual(plain(containers), [
        { name: "lonely", state: "running", project: "" },
        { name: "stacked", state: "exited", project: "proj" },
        { name: "trailing", state: "created", project: "" },
    ]);
});

test("countByState and summarizeContainers produce the compact badge", () => {
    const containers = parseContainers("a|running\nb|exited\nc|running\nd|created\n");

    assert.equal(countByState(containers, "running"), 2);
    assert.equal(countByState(containers, "exited"), 1);
    assert.equal(summarizeContainers(containers), "2/4");
});

test("summarizeContainers handles the no-container and null cases", () => {
    assert.equal(summarizeContainers([]), "0/0");
    assert.equal(summarizeContainers(null), "0/0");
    assert.equal(summarizeContainers(undefined), "0/0");
});

test("withRunToken makes repeated runs of the same command distinct", () => {
    const command = "systemctl start docker";

    const first = withRunToken(command, 1);
    const second = withRunToken(command, 2);

    assert.notEqual(first, second);
    assert.ok(first.startsWith(command), "token must be appended, not replace");
    assert.ok(first.endsWith("# plasma-run-1"));
});

test("withRunToken keeps the command a single shell line", () => {
    // The data engine runs the source through a shell, so the appended comment
    // must not introduce a newline that would break the command.
    assert.ok(!withRunToken("docker ps", 7).includes("\n"));
});

test("withRunToken cannot let a token escape the trailing comment", () => {
    // A caller that passed a newline would otherwise end the comment and append a real
    // command. The token is an integer in the shipped wiring; this keeps the guarantee
    // local to the function. Found by adversarial verification, not by the widget.
    const command = withRunToken("docker ps", "1\ntouch /tmp/must-not-exist");

    assert.ok(!command.includes("\n"), command);
    assert.ok(command.startsWith("docker ps # plasma-run-1touch"), command);
});

test("daemonSeverity distinguishes healthy, stopped, broken and unknown", () => {
    assert.equal(daemonSeverity(DAEMON_ACTIVE), SEVERITY_POSITIVE);
    assert.equal(daemonSeverity(DAEMON_INACTIVE), SEVERITY_NEUTRAL);
    assert.equal(daemonSeverity(DAEMON_FAILED), SEVERITY_NEGATIVE);
    // Unknown must NOT be silent: it gets its own muted severity, never neutral.
    assert.equal(daemonSeverity(DAEMON_UNKNOWN), SEVERITY_MUTED);
    assert.notEqual(daemonSeverity(DAEMON_UNKNOWN), daemonSeverity(DAEMON_INACTIVE));
});

test("containerSeverity flags a crash loop as negative, not neutral", () => {
    assert.equal(containerSeverity("running"), SEVERITY_POSITIVE);
    assert.equal(containerSeverity("exited"), SEVERITY_NEUTRAL);
    assert.equal(containerSeverity("created"), SEVERITY_NEUTRAL);
    // A restarting container is a problem, not a stopped one.
    assert.equal(containerSeverity("restarting"), SEVERITY_NEGATIVE);
    assert.equal(containerSeverity("dead"), SEVERITY_NEGATIVE);
    assert.equal(containerSeverity("paused"), SEVERITY_NEGATIVE);
});

test("containerSeverity normalises case and an unknown state", () => {
    assert.equal(containerSeverity("RUNNING"), SEVERITY_POSITIVE);
    assert.equal(containerSeverity(" removing "), SEVERITY_MUTED);
    assert.equal(containerSeverity(undefined), SEVERITY_MUTED);
});

/*
 * ---------------------------------------------------------------------------
 * Compose groups, per-project start/stop and the Podman Desktop launch
 * ---------------------------------------------------------------------------
 * The second sanctioned command-building boundary (adr-0014). It is narrow in the
 * same shape as the download: the project name is a value INTERPOLATED into one
 * shell-quoted argument, the verb is picked from a fixed pair of constants, and the
 * standalone bucket or an unknown action yields "" so no caller can run a command
 * built from an unvalidated choice. The Podman launch is the one place a configured
 * value IS the command, so its command is the quoted path and nothing else.
 */

test("the compose and Podman constants are stable", () => {
    assert.equal(COMPOSE_PROJECT_STANDALONE, "");
    assert.equal(COMPOSE_ACTION_START, "start");
    assert.equal(COMPOSE_ACTION_STOP, "stop");
    assert.equal(PODMAN_DESKTOP_DEFAULT, "podman-desktop");
});

test("groupContainersByComposeProject keeps first-seen order and appends standalone last", () => {
    const containers = parseContainers([
        "a|running|beta",
        "b|running|alpha",
        "c|exited|beta",
        "d|created|",
        "e|running|gamma",
    ].join("\n"));

    const groups = plain(groupContainersByComposeProject(containers));

    // beta is seen first even though alpha sorts earlier: the probe's own order is kept.
    assert.deepEqual(
        groups.map((group) => group.project),
        ["beta", "alpha", "gamma", COMPOSE_PROJECT_STANDALONE],
    );
    assert.deepEqual(
        groups[0].containers.map((container) => container.name),
        ["a", "c"],
    );
    assert.deepEqual(
        groups[3].containers.map((container) => container.name),
        ["d"],
    );
});

test("groupContainersByComposeProject omits the standalone bucket when no container is in it", () => {
    const containers = [
        { name: "a", state: "running", project: "p" },
        { name: "b", state: "running", project: "q" },
    ];

    const groups = plain(groupContainersByComposeProject(containers));

    assert.deepEqual(groups.map((group) => group.project), ["p", "q"]);
    assert.ok(!groups.some((group) => group.project === COMPOSE_PROJECT_STANDALONE));
});

test("groupContainersByComposeProject puts a machine with no compose project in one group", () => {
    const containers = [
        { name: "a", state: "running", project: "" },
        { name: "b", state: "exited", project: "" },
    ];

    const groups = plain(groupContainersByComposeProject(containers));

    assert.deepEqual(groups, [{ project: COMPOSE_PROJECT_STANDALONE, containers }]);
});

test("groupContainersByComposeProject degrades to an empty list and never throws", () => {
    assert.deepEqual(plain(groupContainersByComposeProject([])), []);
    assert.deepEqual(plain(groupContainersByComposeProject(null)), []);
    assert.deepEqual(plain(groupContainersByComposeProject(undefined)), []);
});

test("groupContainersByComposeProject returns fresh groups and never mutates its input", () => {
    const containers = [
        { name: "a", state: "running", project: "p" },
        { name: "b", state: "running", project: "p" },
    ];
    const snapshot = JSON.stringify(containers);

    const groups = groupContainersByComposeProject(containers);

    assert.notEqual(groups, containers, "the group list is a new array");
    assert.notEqual(groups[0].containers, containers, "the group's list is a new array");

    const again = groupContainersByComposeProject(containers);
    assert.notEqual(groups[0], again[0], "each call yields independent group objects");
    assert.equal(JSON.stringify(containers), snapshot, "the input must not be mutated");
});

test("groupContainersByComposeProject treats a hostile project name as ordinary data", () => {
    // A plain object keyed by the project name would treat "__proto__" as a prototype
    // write and lose the group; the parallel-array grouping must not.
    const containers = [
        { name: "a", state: "running", project: "__proto__" },
        { name: "b", state: "running", project: "constructor" },
        { name: "c", state: "running", project: "__proto__" },
    ];

    const groups = plain(groupContainersByComposeProject(containers));

    assert.deepEqual(groups.map((group) => group.project), ["__proto__", "constructor"]);
    assert.deepEqual(
        groups[0].containers.map((container) => container.name),
        ["a", "c"],
    );
});

test("buildComposeProjectCommand assembles the label-filtered start and stop commands", () => {
    assert.equal(
        buildComposeProjectCommand({ project: "odysseus", action: COMPOSE_ACTION_START }),
        "docker start $(docker ps -aq --filter 'label=com.docker.compose.project=odysseus')",
    );
    assert.equal(
        buildComposeProjectCommand({ project: "odysseus", action: COMPOSE_ACTION_STOP }),
        "docker stop $(docker ps -aq --filter 'label=com.docker.compose.project=odysseus')",
    );
});

test("buildComposeProjectCommand refuses the standalone bucket and an unknown action", () => {
    // An empty string is the contract "there is no command", and main.qml refuses it.
    assert.equal(buildComposeProjectCommand({ project: "", action: COMPOSE_ACTION_START }), "");
    assert.equal(
        buildComposeProjectCommand({
            project: COMPOSE_PROJECT_STANDALONE,
            action: COMPOSE_ACTION_STOP,
        }),
        "",
    );
    assert.equal(buildComposeProjectCommand({ project: "odysseus", action: "restart" }), "");
    assert.equal(buildComposeProjectCommand({ project: "odysseus", action: undefined }), "");
    assert.equal(buildComposeProjectCommand({ project: "odysseus" }), "");
    assert.equal(buildComposeProjectCommand({}), "");
    assert.equal(buildComposeProjectCommand(undefined), "");
});

test("buildComposeProjectCommand shell-quotes a project name that carries a quote", () => {
    assert.equal(
        buildComposeProjectCommand({ project: "ody'sseus", action: COMPOSE_ACTION_START }),
        "docker start $(docker ps -aq --filter 'label=com.docker.compose.project=ody'\\''sseus')",
    );
});

test("buildComposeProjectCommand appends a run token only when one is given", () => {
    const bare = buildComposeProjectCommand({ project: "odysseus", action: COMPOSE_ACTION_START });

    assert.ok(!bare.includes("# plasma-run"), bare);
    assert.equal(
        buildComposeProjectCommand({ project: "odysseus", action: COMPOSE_ACTION_START, token: 9 }),
        bare + " # plasma-run-9",
    );
    assert.equal(
        buildComposeProjectCommand({ project: "odysseus", action: COMPOSE_ACTION_START, token: null }),
        bare,
    );
});

test("resolvePodmanDesktopPath mirrors the yt-dlp binary rule", () => {
    assert.equal(resolvePodmanDesktopPath("", "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath("   ", "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath(undefined, "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath(null, "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath("podman-desktop", "/home/x"), "podman-desktop");
    assert.equal(
        resolvePodmanDesktopPath("/usr/bin/podman-desktop", "/home/x"),
        "/usr/bin/podman-desktop",
    );
    assert.equal(
        resolvePodmanDesktopPath(" ~/.local/bin/podman-desktop ", "/home/x"),
        "/home/x/.local/bin/podman-desktop",
    );
});

test("resolvePodmanDesktopPath refuses anything shell-shaped", () => {
    assert.equal(resolvePodmanDesktopPath("podman-desktop; rm -rf ~", "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath("podman-desktop $(id)", "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(resolvePodmanDesktopPath("/tmp/my podman-desktop", "/home/x"), PODMAN_DESKTOP_DEFAULT);
    assert.equal(
        resolvePodmanDesktopPath("podman-desktop\n--exec whoami", "/home/x"),
        PODMAN_DESKTOP_DEFAULT,
    );
});

test("buildPodmanDesktopCommand is the quoted path and nothing else", () => {
    assert.equal(buildPodmanDesktopCommand({ path: "podman-desktop", home: "/home/x" }), "'podman-desktop'");
    assert.equal(
        buildPodmanDesktopCommand({ path: "/usr/bin/podman-desktop", home: "/home/x" }),
        "'/usr/bin/podman-desktop'",
    );
    assert.equal(
        buildPodmanDesktopCommand({ path: "~/bin/podman-desktop", home: "/home/x" }),
        "'/home/x/bin/podman-desktop'",
    );
    assert.equal(buildPodmanDesktopCommand({}), "'" + PODMAN_DESKTOP_DEFAULT + "'");
    assert.equal(buildPodmanDesktopCommand(undefined), "'" + PODMAN_DESKTOP_DEFAULT + "'");
});

test("buildPodmanDesktopCommand ignores a shell-shaped path and appends a token only when given", () => {
    assert.equal(
        buildPodmanDesktopCommand({ path: "podman-desktop; rm -rf ~", home: "/home/x" }),
        "'" + PODMAN_DESKTOP_DEFAULT + "'",
    );

    const bare = buildPodmanDesktopCommand({ path: "podman-desktop" });
    assert.equal(bare, "'podman-desktop'");
    assert.equal(
        buildPodmanDesktopCommand({ path: "podman-desktop", token: 3 }),
        bare + " # plasma-run-3",
    );
    assert.equal(buildPodmanDesktopCommand({ path: "podman-desktop", token: null }), bare);
});

/*
 * The strongest available check for a command builder, the same shape as the yt-dlp and
 * update-check proofs: run the REAL assembled command through /bin/sh with a stub on PATH
 * that records its argv to a file -- so a command that invokes the stub twice, like
 * `docker start $(docker ps ...)`, is readable per invocation -- then assert the arguments
 * arrived exactly as intended. buildCommand receives the path of an injection marker inside
 * the temp dir, so a quoting failure shows up as that file existing. Nothing is ever written
 * outside the temp dir this helper creates.
 */
function runStubArgvTranscript(stubName, buildCommand) {
    const stubDir = mkdtempSync(join(tmpdir(), "dockerstatus-stub-"));
    const stub = join(stubDir, stubName);
    const argsFile = join(stubDir, "argv.txt");
    const marker = join(stubDir, "injected");
    writeFileSync(
        stub,
        "#!/bin/sh\n"
            + "printf 'CALL\\n' >> \"" + argsFile + "\"\n"
            + "for a in \"$@\"; do printf '%s\\n' \"$a\" >> \"" + argsFile + "\"; done\n",
        "utf8",
    );
    chmodSync(stub, 0o755);

    try {
        execFileSync("/bin/sh", ["-c", buildCommand(marker)], {
            encoding: "utf8",
            env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
        });

        const calls = [];
        if (existsSync(argsFile)) {
            for (const line of readFileSync(argsFile, "utf8").split("\n")) {
                if (line === "CALL") {
                    calls.push([]);
                } else if (line !== "" && calls.length > 0) {
                    calls[calls.length - 1].push(line);
                }
            }
        }

        return { calls, injected: existsSync(marker) };
    } finally {
        rmSync(stubDir, { recursive: true, force: true });
    }
}

const callTo = (calls, program) => calls.find((argv) => argv[0] === program);

test("a compose project name carrying shell syntax reaches docker as one inert argument", () => {
    let markerPath = "";
    const { calls, injected } = runStubArgvTranscript("docker", (marker) => {
        markerPath = marker;
        return buildComposeProjectCommand({
            project: "odysseus; touch " + marker,
            action: COMPOSE_ACTION_START,
        });
    });

    assert.equal(injected, false, "the injected touch must never run");

    const resolve = callTo(calls, "ps");
    assert.ok(resolve, "the label filter must be resolved with `docker ps -aq --filter`");
    assert.deepEqual(
        resolve,
        ["ps", "-aq", "--filter", "label=com.docker.compose.project=odysseus; touch " + markerPath],
        "the filter must arrive as exactly one inert argument",
    );
    assert.ok(callTo(calls, "start"), "the outer start must still run");
});

test("a compose project name carrying a single quote stays one inert argument", () => {
    let markerPath = "";
    const { calls, injected } = runStubArgvTranscript("docker", (marker) => {
        markerPath = marker;
        return buildComposeProjectCommand({
            project: "odysseus'; touch " + marker,
            action: COMPOSE_ACTION_STOP,
        });
    });

    assert.equal(injected, false, "the escaped quote must not break out of the argument");

    const resolve = callTo(calls, "ps");
    assert.ok(resolve);
    assert.deepEqual(
        resolve,
        ["ps", "-aq", "--filter", "label=com.docker.compose.project=odysseus'; touch " + markerPath],
    );
    assert.ok(callTo(calls, "stop"), "the outer stop must still run");
});

test("the Podman command reaches the executable as a bare, argument-free path", () => {
    const { calls, injected } = runStubArgvTranscript("podman-desktop", () =>
        buildPodmanDesktopCommand({ path: "podman-desktop", home: "/home/x" }),
    );

    assert.equal(injected, false);
    assert.deepEqual(calls, [[]], "the command is the quoted path and nothing else");
});

test("a shell-shaped Podman path degrades to the default and runs no injected command", () => {
    const { calls, injected } = runStubArgvTranscript("podman-desktop", (marker) =>
        buildPodmanDesktopCommand({ path: "podman-desktop; touch " + marker, home: "/home/x" }),
    );

    assert.equal(injected, false, "the injected touch must never run");
    assert.deepEqual(calls, [[]], "the refused path falls back to the plain default, with no arguments");
});

test("a Podman run token stays a trailing comment, never an argument", () => {
    const { calls } = runStubArgvTranscript("podman-desktop", () =>
        buildPodmanDesktopCommand({ path: "podman-desktop", token: 5 }),
    );

    assert.deepEqual(calls, [[]], "the token must not become an argument");
});

/*
 * ---------------------------------------------------------------------------
 * Video downloads
 * ---------------------------------------------------------------------------
 * The download command embeds a URL the human pasted, and the executable engine
 * runs its source through a shell. These tests are therefore mostly about the
 * boundary: what is refused outright, and what survives quoting intact.
 */

const YOUTUBE_URL =
    "https://www.youtube.com/watch?v=ucRulNQsuYQ&list=RDucRulNQsuYQ&start_radio=1";
const TWITTER_URL = "https://x.com/vinoypastillas/status/2098437080359502066";

test("classifyVideoUrl accepts the two URL shapes this widget promises", () => {
    assert.equal(classifyVideoUrl(YOUTUBE_URL), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl(TWITTER_URL), VIDEO_KIND_TWITTER);
});

test("classifyVideoUrl accepts the YouTube host and path variants yt-dlp handles", () => {
    assert.equal(classifyVideoUrl("https://www.youtube.com/watch?v=abc"), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl("https://youtu.be/abc?t=30"), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl("https://m.youtube.com/watch?v=abc"), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl("https://music.youtube.com/watch?v=abc"), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl("https://www.youtube.com/shorts/abc"), VIDEO_KIND_YOUTUBE);
    assert.equal(classifyVideoUrl("https://www.youtube.com/live/abc?si=x"), VIDEO_KIND_YOUTUBE);
});

test("classifyVideoUrl accepts the X and twitter.com host variants", () => {
    assert.equal(classifyVideoUrl("https://twitter.com/foo/status/123"), VIDEO_KIND_TWITTER);
    assert.equal(classifyVideoUrl("https://www.twitter.com/foo/status/123"), VIDEO_KIND_TWITTER);
    assert.equal(classifyVideoUrl("https://mobile.twitter.com/foo/status/123"), VIDEO_KIND_TWITTER);
    assert.equal(classifyVideoUrl("https://www.x.com/foo/status/123"), VIDEO_KIND_TWITTER);
});

test("classifyVideoUrl tolerates the whitespace a paste brings along", () => {
    assert.equal(classifyVideoUrl("  " + YOUTUBE_URL + "\n"), VIDEO_KIND_YOUTUBE);
});

test("classifyVideoUrl refuses anything that is not an https URL", () => {
    assert.equal(classifyVideoUrl(""), null);
    assert.equal(classifyVideoUrl("   "), null);
    assert.equal(classifyVideoUrl(undefined), null);
    assert.equal(classifyVideoUrl(null), null);
    assert.equal(classifyVideoUrl("not a url"), null);
    assert.equal(classifyVideoUrl("youtube.com/watch?v=abc"), null, "no scheme");
    assert.equal(classifyVideoUrl("http://www.youtube.com/watch?v=abc"), null, "https only");
    assert.equal(classifyVideoUrl("file:///etc/passwd"), null);
    assert.equal(classifyVideoUrl("javascript:alert(1)"), null);
});

test("classifyVideoUrl refuses other hosts, sufficed or not", () => {
    assert.equal(classifyVideoUrl("https://vimeo.com/123"), null);
    assert.equal(classifyVideoUrl("https://youtube.com.evil.tld/watch?v=abc"), null);
    assert.equal(classifyVideoUrl("https://evil.tld/youtube.com/watch?v=abc"), null);
    assert.equal(classifyVideoUrl("https://notyoutube.com/watch?v=abc"), null);
    assert.equal(classifyVideoUrl("https://youtube.com:8443/watch?v=abc"), null, "ports are not a host");
    assert.equal(classifyVideoUrl("https://user@youtube.com/watch?v=abc"), null);
});

test("classifyVideoUrl refuses shell metacharacters that never belong in a URL", () => {
    assert.equal(classifyVideoUrl("https://youtube.com/watch?v=1'; rm -rf ~; echo '"), null);
    assert.equal(classifyVideoUrl('https://youtube.com/watch?v="1"'), null);
    assert.equal(classifyVideoUrl("https://youtube.com/watch?v=1`id`"), null);
    assert.equal(classifyVideoUrl("https://youtube.com/watch?v=1\\;id"), null);
    assert.equal(classifyVideoUrl("https://youtube.com/watch?v=1\nrm -rf ~"), null);
    assert.equal(classifyVideoUrl("https://youtube.com/watch?v=1\u0000"), null);
});

test("classifyVideoUrl refuses an oversized paste", () => {
    const huge = "https://youtu.be/" + "a".repeat(4096);
    assert.equal(classifyVideoUrl(huge), null);
});

test("classifyVideoUrl is not fooled by Object.prototype members", () => {
    // A plain object lookup would answer "constructor" with a function, i.e. truthy.
    assert.equal(classifyVideoUrl("https://constructor/watch?v=1"), null);
    assert.equal(classifyVideoUrl("https://toString/watch?v=1"), null);
});

test("shellQuote wraps a value in single quotes", () => {
    assert.equal(shellQuote("abc"), "'abc'");
    assert.equal(shellQuote(""), "''");
    assert.equal(shellQuote("/home/x/Downloads"), "'/home/x/Downloads'");
    assert.equal(shellQuote(undefined), "''");
    assert.equal(shellQuote(null), "''");
});

test("shellQuote escapes an embedded single quote instead of ending the quote", () => {
    assert.equal(shellQuote("it's"), "'it'\\''s'");
    assert.equal(shellQuote("a'b'c"), "'a'\\''b'\\''c'");
});

test("shellQuote output survives a real shell byte for byte", () => {
    // The executable engine runs its source through /bin/sh, so quoting is proven
    // against a real shell rather than against a regex.
    const hostile = [
        "plain",
        "it's",
        "'; rm -rf /tmp/should-not-exist; echo '",
        "$(id)",
        "`id`",
        "a b\tc",
        "new\nline",
        '"double"',
        "back\\slash",
        "%\$\u00e1\u00f1 \u4e2d\u6587",
    ];

    for (const value of hostile) {
        const output = execFileSync("/bin/sh", ["-c", "printf %s " + shellQuote(value)], {
            encoding: "utf8",
        });
        assert.equal(output, value, `shellQuote round-trip failed for ${JSON.stringify(value)}`);
    }
});

test("expandTilde expands only a leading tilde", () => {
    assert.equal(expandTilde("~/Downloads", "/home/x"), "/home/x/Downloads");
    assert.equal(expandTilde("~", "/home/x"), "/home/x");
    assert.equal(expandTilde("/abs/path", "/home/x"), "/abs/path");
    assert.equal(expandTilde("relative", "/home/x"), "relative");
    assert.equal(expandTilde("/a/~/b", "/home/x"), "/a/~/b", "a tilde in the middle is literal");
    assert.equal(expandTilde("~other/x", "/home/x"), "~other/x", "~user is not expanded here");
    assert.equal(expandTilde(undefined, "/home/x"), "");
});

test("resolveDownloadDirectory defaults to the XDG Download folder", () => {
    assert.equal(resolveDownloadDirectory("", "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory(undefined, "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory("   ", "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory("~/Downloads", "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory("~/videos", "/home/x"), "/home/x/videos");
    assert.equal(resolveDownloadDirectory("/mnt/media/videos", "/home/x"), "/mnt/media/videos");
});

test("resolveDownloadDirectory refuses a relative or unquotable path", () => {
    // A relative path would resolve against plasmashell's cwd, which is not a place
    // the user can predict; falling back is safer than writing somewhere random.
    assert.equal(resolveDownloadDirectory("videos", "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory("~/a\nb", "/home/x"), "/home/x/Downloads");
    assert.equal(resolveDownloadDirectory("/mnt/media/", "/home/x"), "/mnt/media");
    assert.equal(resolveDownloadDirectory("/", "/home/x"), "/");
});

/*
 * The download row shows the configured folder on hover and offers a shortcut to it after a
 * successful download. Both surfaces read these two pure helpers, so the display form can
 * never disagree with the directory the command actually writes into: they both resolve
 * through resolveDownloadDirectory().
 */
test("formatDownloadDirectory shows the resolved folder and never a raw tilde", () => {
    assert.equal(formatDownloadDirectory("~/Downloads", "/home/x"), "/home/x/Downloads");
    assert.equal(formatDownloadDirectory("~/videos", "/home/x"), "/home/x/videos");
    assert.equal(formatDownloadDirectory("/mnt/media/", "/home/x"), "/mnt/media");
});

test("formatDownloadDirectory falls back for an empty or unusable value", () => {
    assert.equal(formatDownloadDirectory("", "/home/x"), "/home/x/Downloads");
    assert.equal(formatDownloadDirectory(undefined, "/home/x"), "/home/x/Downloads");
    assert.equal(formatDownloadDirectory("   ", "/home/x"), "/home/x/Downloads");
    // A relative path would resolve against plasmashell's cwd, and a control character is
    // never a real directory: both fall back, exactly as the command builder does.
    assert.equal(formatDownloadDirectory("videos", "/home/x"), "/home/x/Downloads");
    assert.equal(formatDownloadDirectory("~/a\nb", "/home/x"), "/home/x/Downloads");
});

test("formatDownloadDirectory is empty until $HOME is known", () => {
    // The same condition that gates downloadReady: with no home there is no absolute path to
    // show, so the tooltip stays empty instead of rendering a bare "~" or "Downloads".
    assert.equal(formatDownloadDirectory("~/Downloads", ""), "");
    assert.equal(formatDownloadDirectory("/mnt/media", ""), "");
    assert.equal(formatDownloadDirectory("", undefined), "");
});

test("buildFolderUrl percent-encodes every path segment", () => {
    assert.equal(buildFolderUrl("~/Downloads", "/home/x"), "file:///home/x/Downloads");
    // A space and a "#" must survive as data: encodeURI would leave the "#" as a fragment
    // separator, and a global encodeURIComponent would escape the "/" separators too.
    assert.equal(
        buildFolderUrl("/home/x/My Videos#1", "/home/x"),
        "file:///home/x/My%20Videos%231",
    );
    assert.equal(buildFolderUrl("/mnt/my folder/videos", "/home/x"), "file:///mnt/my%20folder/videos");
});

test("buildFolderUrl refuses to build a URL without an absolute path", () => {
    // No home means resolveDownloadDirectory would answer a relative "Downloads", which is not
    // a file:// URL the file manager could open; the caller disables the button on "".
    assert.equal(buildFolderUrl("~/Downloads", ""), "");
    assert.equal(buildFolderUrl("/mnt/media", undefined), "");
});

test("resolveYtDlpBinary accepts a path and refuses anything shell-shaped", () => {
    assert.equal(resolveYtDlpBinary("", "/home/x"), YTDLP_DEFAULT_BINARY);
    assert.equal(resolveYtDlpBinary(undefined, "/home/x"), YTDLP_DEFAULT_BINARY);
    assert.equal(resolveYtDlpBinary("yt-dlp", "/home/x"), "yt-dlp");
    assert.equal(resolveYtDlpBinary("/usr/local/bin/yt-dlp", "/home/x"), "/usr/local/bin/yt-dlp");
    assert.equal(resolveYtDlpBinary(" ~/.local/bin/yt-dlp ", "/home/x"), "/home/x/.local/bin/yt-dlp");
    assert.equal(resolveYtDlpBinary("yt-dlp; rm -rf ~", "/home/x"), YTDLP_DEFAULT_BINARY);
    assert.equal(resolveYtDlpBinary("yt-dlp $(id)", "/home/x"), YTDLP_DEFAULT_BINARY);
    assert.equal(resolveYtDlpBinary("/tmp/my yt-dlp", "/home/x"), YTDLP_DEFAULT_BINARY);
});

test("resolveCookiesBrowser defaults to firefox and opts out on an empty value", () => {
    assert.equal(COOKIES_BROWSER_DEFAULT, "firefox");
    assert.equal(resolveCookiesBrowser(undefined), "firefox");
    assert.equal(resolveCookiesBrowser(null), "firefox");
    // An empty value is meaningful: it omits the flag entirely, which is the escape
    // hatch for a machine with no supported browser or a public video that needs no
    // session.
    assert.equal(resolveCookiesBrowser(""), "");
    assert.equal(resolveCookiesBrowser("   "), "");
});

test("resolveCookiesBrowser passes the yt-dlp BROWSER[+KEYRING][:PROFILE] grammar through", () => {
    assert.equal(resolveCookiesBrowser("firefox"), "firefox");
    assert.equal(resolveCookiesBrowser(" chrome:Default "), "chrome:Default");
    assert.equal(resolveCookiesBrowser("firefox+gnomekeyring"), "firefox+gnomekeyring");
    assert.equal(resolveCookiesBrowser("chromium::Personal"), "chromium::Personal");
});

test("resolveCookiesBrowser falls back to the default on shell-shaped input", () => {
    assert.equal(resolveCookiesBrowser("firefox; rm -rf ~"), COOKIES_BROWSER_DEFAULT);
    assert.equal(resolveCookiesBrowser("firefox $(id)"), COOKIES_BROWSER_DEFAULT);
    assert.equal(resolveCookiesBrowser("fire fox"), COOKIES_BROWSER_DEFAULT);
    assert.equal(resolveCookiesBrowser("firefox\n--exec whoami"), COOKIES_BROWSER_DEFAULT);
});

test("buildVideoDownloadCommand still reads Firefox cookies when no browser is configured", () => {
    const command = buildVideoDownloadCommand({
        directory: "/home/x/Downloads",
        home: "/home/x",
        url: TWITTER_URL,
    });

    assert.ok(command.includes("--cookies-from-browser 'firefox'"), command);
});

test("buildVideoDownloadCommand uses the configured cookies browser", () => {
    const command = buildVideoDownloadCommand({
        directory: "/home/x/Downloads",
        home: "/home/x",
        cookiesBrowser: "chrome:Default",
        url: TWITTER_URL,
    });

    assert.ok(command.includes("--cookies-from-browser 'chrome:Default'"), command);
});

test("buildVideoDownloadCommand omits the cookies flag when it is opted out", () => {
    const command = buildVideoDownloadCommand({
        directory: "/home/x/Downloads",
        home: "/home/x",
        cookiesBrowser: "",
        url: TWITTER_URL,
    });

    assert.ok(!command.includes("--cookies-from-browser"), command);
});

test("buildVideoDownloadCommand ignores a shell-shaped cookies browser", () => {
    const command = buildVideoDownloadCommand({
        directory: "/home/x/Downloads",
        home: "/home/x",
        cookiesBrowser: "firefox; rm -rf ~",
        url: TWITTER_URL,
    });

    assert.ok(command.includes("--cookies-from-browser 'firefox'"), command);
    assert.ok(!command.includes("rm -rf"), command);
});

test("resolveJsRuntime defaults to node, and an empty value opts out", () => {
    assert.equal(resolveJsRuntime(undefined), JS_RUNTIME_DEFAULT);
    assert.equal(resolveJsRuntime(null), JS_RUNTIME_DEFAULT);
    assert.equal(resolveJsRuntime("node"), "node");
    assert.equal(resolveJsRuntime("deno"), "deno");
    assert.equal(resolveJsRuntime(" node "), "node");
    // Clearing the setting is how a user tells an older yt-dlp to not get the flag.
    assert.equal(resolveJsRuntime(""), "");
    assert.equal(resolveJsRuntime("   "), "");
    // Anything shell-shaped falls back to the default rather than being trusted.
    assert.equal(resolveJsRuntime("node; rm -rf ~"), JS_RUNTIME_DEFAULT);
    assert.equal(resolveJsRuntime("node --exec whoami"), JS_RUNTIME_DEFAULT);
});

test("buildVideoDownloadCommand assembles the documented option set", () => {
    const command = buildVideoDownloadCommand({
        binary: "yt-dlp",
        directory: "~/Downloads",
        home: "/home/x",
        url: YOUTUBE_URL,
        token: 4,
    });

    assert.ok(command.startsWith("'yt-dlp'"), command);
    assert.ok(command.includes("--cookies-from-browser 'firefox'"), command);
    assert.ok(command.includes("--js-runtimes 'node'"), command);
    assert.ok(command.includes("--no-playlist"), command);
    assert.ok(command.includes("--no-progress"), command);
    assert.ok(command.includes("-P '/home/x/Downloads'"), command);
    assert.ok(command.includes("-o '" + VIDEO_OUTPUT_TEMPLATE + "'"), command);
    assert.ok(command.includes("'" + YOUTUBE_URL + "'"), command);
    assert.ok(command.endsWith("# plasma-run-4"), command);
    assert.ok(!command.includes("\n"), "the engine gets a single shell line");
});

test("buildVideoDownloadCommand omits the runtime flag when it is opted out", () => {
    const command = buildVideoDownloadCommand({
        directory: "/home/x/Downloads",
        home: "/home/x",
        jsRuntime: "",
        url: TWITTER_URL,
    });

    assert.ok(!command.includes("--js-runtimes"), command);
});

test("buildVideoDownloadCommand falls back on unquotable configuration", () => {
    const command = buildVideoDownloadCommand({
        binary: "yt-dlp; rm -rf ~",
        directory: "relative/dir",
        home: "/home/x",
        jsRuntime: "node; rm -rf ~",
        url: TWITTER_URL,
    });

    assert.ok(command.startsWith("'yt-dlp'"), command);
    assert.ok(command.includes("--cookies-from-browser 'firefox'"), command);
    assert.ok(command.includes("--js-runtimes 'node'"), command);
    assert.ok(command.includes("-P '/home/x/Downloads'"), command);
    assert.ok(!command.includes("rm -rf"), command);
    assert.ok(!command.endsWith("# plasma-run-undefined"), "no token means no comment");
});

/*
 * The strongest available check that user input never becomes shell syntax: run the
 * real assembled command through /bin/sh with a stub on PATH that prints its argv,
 * then assert the arguments arrived exactly as intended. If quoting failed, the URL
 * would split into extra arguments or the injected command would run. The builder
 * receives the path a hostile URL would try to touch, so the test can prove it does
 * not exist after the run.
 */
function runCommandWithArgvStub(buildCommand) {
    const stubDir = mkdtempSync(join(tmpdir(), "dockerstatus-stub-"));
    const stub = join(stubDir, "yt-dlp");
    const marker = join(stubDir, "injected");
    writeFileSync(stub, '#!/bin/sh\nprintf "ARG:%s\\n" "$@"\n', "utf8");
    chmodSync(stub, 0o755);

    try {
        const command = buildCommand(marker);
        const stdout = execFileSync("/bin/sh", ["-c", command], {
            encoding: "utf8",
            env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
        });

        return {
            argv: stdout
                .split("\n")
                .filter((line) => line.startsWith("ARG:"))
                .map((line) => line.slice("ARG:".length)),
            injected: existsSync(marker),
        };
    } finally {
        rmSync(stubDir, { recursive: true, force: true });
    }
}

test("the assembled command reaches yt-dlp as separate, intact arguments", () => {
    const { argv, injected } = runCommandWithArgvStub(() =>
        buildVideoDownloadCommand({
            directory: "~/Downloads",
            home: "/home/x",
                url: TWITTER_URL,
        }),
    );

    assert.equal(injected, false);
    assert.deepEqual(argv, [
        "--cookies-from-browser",
        "firefox",
        "--js-runtimes",
        "node",
        "--no-playlist",
        "--no-progress",
        "-P",
        "/home/x/Downloads",
        "-o",
        VIDEO_OUTPUT_TEMPLATE,
        TWITTER_URL,
    ]);
});

test("a URL carrying shell syntax stays one inert argument", () => {
    const { argv, injected } = runCommandWithArgvStub((marker) => {
        const hostile = "https://youtu.be/abc;touch " + marker;
        return buildVideoDownloadCommand({
            directory: "/home/x/Downloads",
            home: "/home/x",
                url: hostile,
        });
    });

    assert.equal(injected, false, "the injected touch must never run");
    assert.equal(argv.length, 11, "the URL must stay a single argument");
    assert.ok(argv[10].startsWith("https://youtu.be/abc;touch "), argv[10]);
});

test("the real YouTube URL with its &list= stays one argument", () => {
    // An unquoted '&' would background the first half of the command and truncate the
    // URL, which is exactly the failure this test exists to catch.
    const { argv, injected } = runCommandWithArgvStub(() =>
        buildVideoDownloadCommand({
            directory: "/home/x/Downloads",
            home: "/home/x",
                url: YOUTUBE_URL,
        }),
    );

    assert.equal(injected, false);
    assert.equal(argv.length, 11, "the URL must stay a single argument");
    assert.equal(argv[10], YOUTUBE_URL);
});

test("a URL containing a quote cannot break out of the argument", () => {
    const { argv, injected } = runCommandWithArgvStub((marker) => {
        const hostile = `https://youtu.be/abc'; touch ${marker}; echo '`;
        return buildVideoDownloadCommand({
            directory: "/home/x/Downloads",
            home: "/home/x",
                url: hostile,
        });
    });

    assert.equal(injected, false, "the injected touch must never run");
    assert.equal(argv.length, 11, "the URL must stay a single argument");
    assert.ok(argv[10].startsWith("https://youtu.be/abc'; touch "), argv[10]);
});

test("parseDownloadedFile reports the destination yt-dlp printed", () => {
    const output = [
        "[youtube] ucRulNQsuYQ: Downloading webpage",
        "[download] Destination: /home/x/Downloads/Video [ucRulNQsuYQ].webm",
        "[download] 100% of 3.42MiB",
        "",
    ].join("\n");

    assert.equal(parseDownloadedFile(output), "/home/x/Downloads/Video [ucRulNQsuYQ].webm");
});

test("parseDownloadedFile prefers the merged file name", () => {
    const output = [
        "[download] Destination: /home/x/Downloads/Video [abc].f137.mp4",
        "[download] Destination: /home/x/Downloads/Video [abc].f251.webm",
        '[Merger] Merging formats into "/home/x/Downloads/Video [abc].mp4"',
        "Deleting original file /home/x/Downloads/Video [abc].f137.mp4",
        "",
    ].join("\n");

    assert.equal(parseDownloadedFile(output), "/home/x/Downloads/Video [abc].mp4");
});

test("parseDownloadedFile returns nothing when yt-dlp printed no destination", () => {
    assert.equal(parseDownloadedFile(""), "");
    assert.equal(parseDownloadedFile(undefined), "");
    assert.equal(parseDownloadedFile("ERROR: [youtube] abc: The page needs to be reloaded."), "");
});

test("extractErrorLine surfaces the real yt-dlp error, not a warning", () => {
    const output = [
        "WARNING: Falling back on generic information extractor",
        "[twitter] 123: Downloading graphql json",
        "ERROR: [twitter] 123: No video could be found in this tweet",
        "",
    ].join("\n");

    assert.equal(extractErrorLine(output), "ERROR: [twitter] 123: No video could be found in this tweet");
});

test("extractErrorLine falls back to the last line and stays bounded", () => {
    assert.equal(extractErrorLine(""), "");
    assert.equal(extractErrorLine(undefined), "");
    assert.equal(extractErrorLine("just one line\n"), "just one line");

    const long = "ERROR: " + "x".repeat(2000);
    const extracted = extractErrorLine(long);
    assert.ok(extracted.length <= 240, `expected a bounded message, got ${extracted.length}`);
    assert.ok(extracted.startsWith("ERROR: xxx"), extracted);
    assert.ok(extracted.endsWith("\u2026"), extracted);
});

/*
 * ---------------------------------------------------------------------------
 * Countdown to Extinction
 * ---------------------------------------------------------------------------
 * The countdown is widget-owned: the configured string only sizes a local deadline
 * and never reaches a shell, but an unusable value must not arm a nonsense deadline.
 * The resolver is where that is decided, so it is tested like the other boundary
 * functions above.
 */

test("resolveShutdownMinutes treats a missing value as the default, not an error", () => {
    assert.equal(SHUTDOWN_MINUTES_DEFAULT, 15);
    assert.equal(SHUTDOWN_MINUTES_MINIMUM, 10);
    assert.equal(resolveShutdownMinutes(undefined), SHUTDOWN_MINUTES_DEFAULT);
    assert.equal(resolveShutdownMinutes(null), SHUTDOWN_MINUTES_DEFAULT);
    assert.equal(resolveShutdownMinutes(""), SHUTDOWN_MINUTES_DEFAULT);
    assert.equal(resolveShutdownMinutes("   "), SHUTDOWN_MINUTES_DEFAULT);
    assert.equal(resolveShutdownMinutes("\r\n"), SHUTDOWN_MINUTES_DEFAULT);
});

test("resolveShutdownMinutes accepts a plain whole number above the minimum", () => {
    assert.equal(resolveShutdownMinutes("15"), 15);
    assert.equal(resolveShutdownMinutes(" 20 "), 20);
    assert.equal(resolveShutdownMinutes("11"), 11);
    assert.equal(resolveShutdownMinutes("3600"), 3600);
});

test("resolveShutdownMinutes refuses a value at or below the minimum", () => {
    // The minimum is inclusive of rejection: "more than 10", not "10 or more".
    assert.equal(resolveShutdownMinutes("10"), null);
    assert.equal(resolveShutdownMinutes("0"), null);
    assert.equal(resolveShutdownMinutes("1"), null);
});

test("resolveShutdownMinutes refuses anything that is not a plain run of digits", () => {
    assert.equal(resolveShutdownMinutes("abc"), null);
    assert.equal(resolveShutdownMinutes("12abc"), null);
    assert.equal(resolveShutdownMinutes("12.5"), null);
    assert.equal(resolveShutdownMinutes("1e3"), null);
    assert.equal(resolveShutdownMinutes(" 1 2"), null);
    assert.equal(resolveShutdownMinutes("-5"), null);
    assert.equal(resolveShutdownMinutes("+15"), null);
    assert.equal(resolveShutdownMinutes("15m"), null);
});

test("shutdownRemainingSeconds counts whole seconds and never goes negative", () => {
    assert.equal(shutdownRemainingSeconds(10000, 0), 10);
    assert.equal(shutdownRemainingSeconds(10000, 9000), 1, "exactly one second left");
    assert.equal(shutdownRemainingSeconds(10000, 9001), 1, "999 ms left rounds up to one second");
    assert.equal(shutdownRemainingSeconds(10000, 10000), 0, "at the deadline");
    assert.equal(shutdownRemainingSeconds(10000, 20000), 0, "past the deadline");
});

test("shutdownRemainingSeconds treats unusable input as zero", () => {
    assert.equal(shutdownRemainingSeconds(undefined, 0), 0);
    assert.equal(shutdownRemainingSeconds(0, undefined), 0);
    assert.equal(shutdownRemainingSeconds(null, null), 0);
    assert.equal(shutdownRemainingSeconds(NaN, 0), 0);
    assert.equal(shutdownRemainingSeconds(Infinity, 0), 0);
    assert.equal(shutdownRemainingSeconds(0, Infinity), 0);
    assert.equal(shutdownRemainingSeconds("soon", 0), 0);
});

test("formatCountdown renders M:SS and grows to H:MM:SS past an hour", () => {
    assert.equal(formatCountdown(0), "0:00");
    assert.equal(formatCountdown(59), "0:59");
    assert.equal(formatCountdown(60), "1:00");
    assert.equal(formatCountdown(899), "14:59");
    assert.equal(formatCountdown(900), "15:00");
    assert.equal(formatCountdown(3600), "1:00:00");
    assert.equal(formatCountdown(3661), "1:01:01");
});

test("formatCountdown refuses negatives, non-finite values and garbage", () => {
    assert.equal(formatCountdown(-1), "0:00");
    assert.equal(formatCountdown(NaN), "0:00");
    assert.equal(formatCountdown(Infinity), "0:00");
    assert.equal(formatCountdown(undefined), "0:00");
    assert.equal(formatCountdown(null), "0:00");
    assert.equal(formatCountdown("later"), "0:00");
});

/*
 * ---------------------------------------------------------------------------
 * Update check
 * ---------------------------------------------------------------------------
 * A human-approved reversal of the "no network code" goal: the installed widget
 * fetches a release manifest from a FIXED URL, compares it with its own
 * metadata.json, and shows one line. The command is the THIRD sanctioned
 * boundary and mints no command-building exception because it is assembled
 * entirely from fixed constants -- so these tests are mostly about the version
 * maths that must never cry wolf, and about the one-shot degrading to silence.
 * The shell test mirrors the download one: a stub curl on PATH, a real
 * metadata.json under a temp $HOME, and the assembled run through /bin/sh.
 */

const REAL_METADATA_URL = new URL(
    "../package/io.github.daver-ui.dockerstatus/metadata.json",
    import.meta.url,
);
const realMetadataBytes = readFileSync(REAL_METADATA_URL, "utf8");

test("the update-check constants are exactly as specified", () => {
    // The URL is the one thing that would make this configurable, and it is a
    // constant on purpose: a misconfiguration must not be able to point the widget
    // elsewhere. Pin it, its scheme and its file name.
    assert.equal(
        UPDATE_CHECK_URL,
        "https://dave-r-ui.github.io/docker-status-widget/latest.json",
    );
    assert.ok(UPDATE_CHECK_URL.indexOf("https://") === 0, "https only");
    assert.ok(UPDATE_CHECK_URL.slice(-"/latest.json".length) === "/latest.json");

    assert.equal(UPDATE_CHECK_MAX_TIME_SECONDS, 5);
    assert.equal(UPDATE_CHECK_MARKER, "@dockerstatus-manifest@");
    assert.equal(UPDATE_CHECK_CURL_BINARY, "curl");
    assert.equal(PACKAGE_ID, "io.github.daver-ui.dockerstatus");

    // Literal double quotes so the shell expands ${XDG_DATA_HOME:-$HOME/.local/share}
    // itself; the path names the widget's own package id.
    assert.equal(
        INSTALLED_METADATA_PATH,
        '"${XDG_DATA_HOME:-$HOME/.local/share}/plasma/plasmoids/'
            + "io.github.daver-ui.dockerstatus/metadata.json\"",
    );
});

test("UPDATE_PAGE_URL is the fixed release-page constant", () => {
    assert.equal(UPDATE_PAGE_URL, "https://dave-r-ui.github.io/docker-status-widget/");
    assert.ok(/^https:\/\//.test(UPDATE_PAGE_URL), "the page is https, exactly like the manifest URL");
    assert.notEqual(UPDATE_PAGE_URL, UPDATE_CHECK_URL, "the page root and the manifest are distinct constants");
});

test("buildUpdateCheckCommand assembles the documented fixed command", () => {
    assert.equal(
        buildUpdateCheckCommand(),
        "cat \"${XDG_DATA_HOME:-$HOME/.local/share}/plasma/plasmoids/"
            + "io.github.daver-ui.dockerstatus/metadata.json\" 2>/dev/null; "
            + "printf '\\n%s\\n' '@dockerstatus-manifest@'; "
            + "curl -fsSL --max-time 5 "
            + "'https://dave-r-ui.github.io/docker-status-widget/latest.json'",
    );
});

test("buildUpdateCheckCommand's marker printf starts a fresh line whatever cat ends with", () => {
    // The leading \n is the whole reason splitUpdateCheckOutput can match an exact line:
    // an installed metadata.json without its trailing newline fuses its last line with
    // the marker's output, and the marker still has to begin its own line.
    const command = buildUpdateCheckCommand();
    assert.ok(
        command.includes("printf '\\n%s\\n' '@dockerstatus-manifest@'"),
        command,
    );

    // Prove it against a real shell: a metadata file with NO trailing newline, then the
    // real command's marker, then the manifest. The marker must be its own line.
    const home = mkdtempSync(join(tmpdir(), "dockerstatus-marker-"));
    try {
        const metaDir = join(
            home,
            ".local/share/plasma/plasmoids/io.github.daver-ui.dockerstatus",
        );
        mkdirSync(metaDir, { recursive: true });
        writeFileSync(join(metaDir, "metadata.json"), '{"Version":"0.5.0"}', "utf8");

        const stubDir = mkdtempSync(join(tmpdir(), "dockerstatus-stub-"));
        try {
            writeFileSync(join(stubDir, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
            const stdout = execFileSync("/bin/sh", ["-c", buildUpdateCheckCommand()], {
                encoding: "utf8",
                env: { ...process.env, HOME: home, XDG_DATA_HOME: "", PATH: `${stubDir}:/usr/bin:/bin` },
            });
            assert.deepEqual(plain(splitUpdateCheckOutput(stdout)), {
                installed: '{"Version":"0.5.0"}',
                manifest: "",
            });
        } finally {
            rmSync(stubDir, { recursive: true, force: true });
        }
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test("buildUpdateCheckCommand is fixed, one shell line, and never hangs", () => {
    const command = buildUpdateCheckCommand();

    // --max-time is the guarantee that the one-shot can never hang the engine.
    assert.ok(command.includes("--max-time 5"), command);
    // curl -fsSL bundles the four documented flags in one token: -f fails on an HTTP
    // status >= 400, -s silences the progress meter, -S lets curl's OWN stderr through,
    // and -L follows redirects. Pin the exact token and its position.
    assert.ok(command.includes("curl -fsSL --max-time 5 "), command);
    // The whole command, token aside, is a single shell line: the engine gets no newline.
    assert.ok(!command.includes("\n"), "the engine gets a single shell line");

    // 2>/dev/null guards only the cat, never curl: curl's stderr is deliberately let
    // through and simply ignored, so there is no second redirection meant to silence it.
    assert.equal(
        command.split("2>/dev/null").length - 1,
        1,
        "2>/dev/null guards the cat only, never curl",
    );
});

test("buildUpdateCheckCommand appends a run token only when one is given", () => {
    const bare = buildUpdateCheckCommand({});
    assert.equal(bare, buildUpdateCheckCommand(), "an empty options mints no token");
    assert.ok(!bare.includes("# plasma-run"), "no token means no trailing comment");

    const tokened = buildUpdateCheckCommand({ token: 7 });
    assert.ok(tokened.startsWith(bare), "token is appended, not replaces the command");
    assert.ok(tokened.endsWith("# plasma-run-7"), tokened);
});

test("buildUpdateCheckCommand ignores a null token like the other builders", () => {
    assert.equal(buildUpdateCheckCommand({ token: null }), buildUpdateCheckCommand());
    assert.equal(buildUpdateCheckCommand({ token: undefined }), buildUpdateCheckCommand());
});

/*
 * The strongest available check for this boundary, mirroring the download command's:
 * run the REAL assembled command through /bin/sh with a stub curl on PATH and a real
 * metadata.json under a temp $HOME, then assert the stub received the URL as exactly one
 * argument and that the single stdout splits cleanly into the installed half (the file
 * cat printed) and the manifest half (the stub curl printed). A quoting failure would
 * show up as a split URL or a corrupted split, and --max-time keeps the run bounded even
 * if a real curl somehow blocked.
 */
function runUpdateCheckInShell() {
    const stubDir = mkdtempSync(join(tmpdir(), "dockerstatus-updatecheck-"));
    const homeDir = join(stubDir, "home");
    const metadataDir = join(homeDir, ".local/share/plasma/plasmoids", PACKAGE_ID);
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(join(metadataDir, "metadata.json"), realMetadataBytes, "utf8");

    const argsFile = join(stubDir, "curl-args.txt");
    const stub = join(stubDir, "curl");
    const manifest = '{"version":"0.99.0"}';
    // Record argv one-per-line to a file (NOT stdout, which must stay clean for the split),
    // then emit the manifest on stdout with no trailing newline.
    writeFileSync(
        stub,
        "#!/bin/sh\n"
            + "for a in \"$@\"; do printf '%s\\n' \"$a\" >> \"" + argsFile + "\"; done\n"
            + "printf '%s' '" + manifest + "'\n",
        "utf8",
    );
    chmodSync(stub, 0o755);

    try {
        const command = buildUpdateCheckCommand();
        const stdout = execFileSync("/bin/sh", ["-c", command], {
            encoding: "utf8",
            // XDG_DATA_HOME: "" forces ${XDG_DATA_HOME:-$HOME/.local/share} to fall back to
            // the temp HOME, which is where the real metadata.json was written. The timeout
            // is a belt-and-braces guard; --max-time is the real one.
            env: {
                ...process.env,
                HOME: homeDir,
                PATH: `${stubDir}:${process.env.PATH}`,
                XDG_DATA_HOME: "",
            },
            timeout: 10000,
        });

        const curlArgs = readFileSync(argsFile, "utf8").split("\n").filter((line) => line !== "");
        return { stdout, curlArgs };
    } finally {
        rmSync(stubDir, { recursive: true, force: true });
    }
}

test("the assembled update check runs through a real shell and splits into two halves", () => {
    const { stdout, curlArgs } = runUpdateCheckInShell();

    // The stub curl got the URL as exactly one argument, with the documented flags.
    assert.deepEqual(curlArgs, ["-fsSL", "--max-time", "5", UPDATE_CHECK_URL]);
    assert.equal(curlArgs[curlArgs.length - 1], UPDATE_CHECK_URL);

    // The marker is present exactly once, so the one-shot carries both halves.
    assert.equal(stdout.split(UPDATE_CHECK_MARKER).length - 1, 1);

    // Each half parses, and the comparison is a true, strictly-greater answer.
    const halves = splitUpdateCheckOutput(stdout);
    assert.equal(parseWidgetVersion(halves.installed), "0.5.0");
    assert.equal(parseLatestVersion(halves.manifest), "0.99.0");
    assert.equal(
        isUpdateAvailable(parseWidgetVersion(halves.installed), parseLatestVersion(halves.manifest)),
        true,
    );
});

test("parseWidgetVersion reads the real shipped metadata.json version", () => {
    assert.equal(parseWidgetVersion(realMetadataBytes), "0.5.0");
});

test("parseWidgetVersion accepts one-to-three numeric segments", () => {
    assert.equal(parseWidgetVersion('{"Version":"1.2.3"}'), "1.2.3");
    assert.equal(parseWidgetVersion('{"Version":"2"}'), "2");
    assert.equal(parseWidgetVersion('{"Version":"0"}'), "0");
    assert.equal(parseWidgetVersion('{"Version": "10.20.30"}'), "10.20.30");
});

test("parseWidgetVersion refuses empty, missing-key, non-numeric and malformed input", () => {
    assert.equal(parseWidgetVersion(""), "");
    assert.equal(parseWidgetVersion(undefined), "");
    assert.equal(parseWidgetVersion(null), "");
    assert.equal(parseWidgetVersion('{"KPackageStructure":"Plasma/Applet"}'), "", "missing key");
    assert.equal(parseWidgetVersion('{"Version":""}'), "", "empty value");
    assert.equal(parseWidgetVersion('{"Version":"v1.2"}'), "", "non-numeric");
    assert.equal(parseWidgetVersion('{"Version":"1.2.3.4"}'), "", "too many segments");
    assert.equal(parseWidgetVersion('{"Version":"1.a"}'), "", "non-numeric segment");
    assert.equal(parseWidgetVersion('{"Version":"01.2"}'), "", "leading-zero segment");
    assert.equal(parseWidgetVersion("this is not json"), "", "malformed");
    // A different key that merely contains "Version" must not match.
    assert.equal(parseWidgetVersion('{"X-Plasma-API-Minimum-Version":"6.0"}'), "");
});

test("parseLatestVersion reads the version from a valid manifest", () => {
    assert.equal(parseLatestVersion('{"version":"1.2.3"}'), "1.2.3");
    assert.equal(parseLatestVersion('{"version":"1.2.3","url":"https://x/y"}'), "1.2.3");
    assert.equal(parseLatestVersion('{ "version" : "0.10" }'), "0.10");
});

test("parseLatestVersion refuses wrong shape, invalid JSON, empty, null and array", () => {
    assert.equal(parseLatestVersion('{"release":"1.2.3"}'), "", "wrong key");
    assert.equal(parseLatestVersion('{"version":"v1"}'), "", "non-numeric");
    assert.equal(parseLatestVersion('{"version":123}'), "", "not a string");
    assert.equal(parseLatestVersion('{"version":1.2}'), "", "not a string");
    assert.equal(parseLatestVersion('{"version":"1.2.3.4"}'), "", "too many segments");
    assert.equal(parseLatestVersion("not json"), "", "invalid JSON");
    assert.equal(parseLatestVersion(""), "");
    assert.equal(parseLatestVersion(undefined), "");
    assert.equal(parseLatestVersion(null), "");
    assert.equal(parseLatestVersion("null"), "", "JSON null");
    assert.equal(parseLatestVersion("[1,2,3]"), "", "array");
    assert.equal(parseLatestVersion("[]"), "", "empty array");
});

test("splitUpdateCheckOutput separates the two halves at the marker", () => {
    const raw = '{"KPlugin":{}}\n' + UPDATE_CHECK_MARKER + '\n{"version":"1.0.0"}';
    assert.deepEqual(plain(splitUpdateCheckOutput(raw)), {
        installed: '{"KPlugin":{}}',
        manifest: '{"version":"1.0.0"}',
    });
});

test("splitUpdateCheckOutput treats a marker-less run as an empty install", () => {
    assert.deepEqual(plain(splitUpdateCheckOutput('{"version":"1.0.0"}')), {
        installed: "",
        manifest: '{"version":"1.0.0"}',
    });
});

test("splitUpdateCheckOutput handles an empty manifest half", () => {
    const raw = '{"KPlugin":{}}\n' + UPDATE_CHECK_MARKER + "\n";
    assert.deepEqual(plain(splitUpdateCheckOutput(raw)), {
        installed: '{"KPlugin":{}}',
        manifest: "",
    });
});

test("splitUpdateCheckOutput only splits at a marker that begins its own line", () => {
    // This is exactly why buildUpdateCheckCommand()'s marker printf carries a LEADING
    // newline: the split is an exact LINE match, so a marker that does not begin a line is
    // not a split point. The consequence is the safe direction -- the whole run is treated
    // as an unreadable manifest and the widget says nothing -- and it is unreachable in
    // the command as assembled, which prints the leading newline unconditionally.
    const raw = '{"KPlugin":{"Version":"0.5.0"}}' + UPDATE_CHECK_MARKER + '\n{"version":"1.0.0"}';
    assert.deepEqual(plain(splitUpdateCheckOutput(raw)), {
        installed: "",
        manifest: raw,
    });
});

test("splitUpdateCheckOutput cannot be spoofed by manifest content", () => {
    // A manifest carrying the marker on its own line must not be able to forge an install
    // half: only the FIRST marker splits, so everything after it becomes the manifest, and
    // a two-JSON-body manifest is not JSON at all -- parseLatestVersion answers "".
    const raw = UPDATE_CHECK_MARKER + '\n{"version":"1.0.0"}\n'
        + UPDATE_CHECK_MARKER + '\n{"version":"9.9.9"}';
    const halves = plain(splitUpdateCheckOutput(raw));
    assert.equal(halves.installed, "");
    assert.equal(parseLatestVersion(halves.manifest), "", "the doubled marker poisons the manifest");
});

test("splitUpdateCheckOutput never throws and always returns both string keys", () => {
    for (const bad of [undefined, null, "", "   ", 123, "no-marker-at-all"]) {
        const halves = splitUpdateCheckOutput(bad);
        assert.equal(typeof halves, "object");
        assert.equal(typeof halves.installed, "string");
        assert.equal(typeof halves.manifest, "string");
    }
});

test("compareVersions compares numerically, not lexicographically", () => {
    assert.equal(compareVersions("0.9", "0.10"), -1, "0.9 is older than 0.10");
    assert.equal(compareVersions("0.10", "0.9"), 1);
    assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
    assert.equal(compareVersions("1.2", "1.3"), -1);
    assert.equal(compareVersions("2.0", "1.9"), 1);
});

test("compareVersions lets a longer run of segments win a shared prefix", () => {
    assert.equal(compareVersions("1.2", "1.2.1"), -1, "1.2 is older than 1.2.1");
    assert.equal(compareVersions("1.2.1", "1.2"), 1);
    assert.equal(compareVersions("1.2", "1.2"), 0);
});

test("compareVersions returns null when either side is not a version string", () => {
    assert.equal(compareVersions("", "1.0"), null);
    assert.equal(compareVersions("1.0", ""), null);
    assert.equal(compareVersions("1.a", "1.0"), null);
    assert.equal(compareVersions("1.0", "1.b"), null);
    assert.equal(compareVersions("1.2.3.4", "1.2.3"), null);
    assert.equal(compareVersions("1.2.3", "1.2.3.4"), null);
    assert.equal(compareVersions("v1", "1.0"), null);
    assert.equal(compareVersions(undefined, "1.0"), null);
    assert.equal(compareVersions("1.0", null), null);
    assert.equal(compareVersions("", ""), null);
});

test("compareVersions refuses a leading-zero segment on either side", () => {
    assert.equal(compareVersions("01.2", "1.2"), null);
    assert.equal(compareVersions("1.2", "01.2"), null);
    assert.equal(compareVersions("1.02", "1.2"), null);
    assert.equal(compareVersions("1.2", "1.2.03"), null);
});

test("isUpdateAvailable is true only when latest is strictly greater", () => {
    assert.equal(isUpdateAvailable("0.5.0", "0.6.0"), true);
    assert.equal(isUpdateAvailable("0.9", "0.10"), true);
    assert.equal(isUpdateAvailable("1.2", "1.2.1"), true);
});

test("isUpdateAvailable is false for identical or remote-lower versions", () => {
    assert.equal(isUpdateAvailable("0.6.0", "0.6.0"), false, "identical");
    assert.equal(isUpdateAvailable("1.0.0", "0.9.0"), false, "remote lower");
    assert.equal(isUpdateAvailable("0.10", "0.9"), false, "remote lower");
});

test("isUpdateAvailable never cries wolf on garbage on either side", () => {
    assert.equal(isUpdateAvailable("", "1.0.0"), false);
    assert.equal(isUpdateAvailable("1.0.0", ""), false);
    assert.equal(isUpdateAvailable("garbage", "1.0.0"), false);
    assert.equal(isUpdateAvailable("1.0.0", "later"), false);
    assert.equal(isUpdateAvailable(undefined, "1.0.0"), false);
    assert.equal(isUpdateAvailable("1.0.0", null), false);
    assert.equal(isUpdateAvailable("", ""), false);
    assert.equal(isUpdateAvailable("1.0.0", "1.2.3.4"), false);
    assert.equal(isUpdateAvailable("01.0.0", "1.0.1"), false);
});

/*
 * ---------------------------------------------------------------------------
 * Pinned popup layout, cookies feedback and the action row geometry
 * ---------------------------------------------------------------------------
 * Shipped QML that a runtime test cannot reach: the removal of the configurable bottom
 * text and the footer, the scroll card that now holds the container list, the reserved
 * update-notice row, the bindings that carry the cookies setting into the popup, and the
 * width of the stop button. They are pinned as text because every one of them compiles
 * and renders when it is silently dropped -- or silently returns -- and the failure only
 * shows up as a removed surface reappearing, a region that resizes the widget, or a button
 * that moves under the cursor.
 *
 * The cookies combo joins them below for the same reason, with a sharper failure mode:
 * a missing seed does not render wrong, it SAVES wrong.
 */

const mainXmlUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/config/main.xml",
    import.meta.url,
);
const configGeneralUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/ui/config/ConfigGeneral.qml",
    import.meta.url,
);
const mainQmlUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/ui/main.qml",
    import.meta.url,
);
const fullQmlUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/ui/FullRepresentation.qml",
    import.meta.url,
);

const mainXml = readFileSync(mainXmlUrl, "utf8");
const configGeneral = readFileSync(configGeneralUrl, "utf8");
const mainQml = readFileSync(mainQmlUrl, "utf8");
const fullQml = readFileSync(fullQmlUrl, "utf8");

/*
 * The opening tag and the body of one kcfg entry, so a default is asserted against the
 * entry that owns it instead of against the whole file: another entry can carry the same
 * default, and a file-wide includes() would not notice one entry losing its own.
 */
function kcfgEntry(xml, name) {
    const match = new RegExp(`<entry name="${name}"([^>]*)>([\\s\\S]*?)</entry>`).exec(xml);
    assert.ok(match, `main.xml must declare the ${name} entry`);
    return { attributes: match[1], body: match[2] };
}

/*
 * Strips QML comments so a code assertion cannot be satisfied -- or defeated -- by prose.
 * The removed tagline, footer and update-notice copy is still named in the surrounding
 * comments, so the "gone from the code" assertions below must read code only. It is
 * regex-level and therefore approximate; it is only used where a comment could otherwise
 * stand in for the code the test is pinning.
 */
const stripQmlComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("main.xml still declares the cookies browser and defaults it to firefox", () => {
    const cookies = kcfgEntry(mainXml, "cookiesBrowser");

    assert.ok(cookies.attributes.includes('type="String"'), cookies.attributes);
    assert.ok(cookies.body.includes("<default>firefox</default>"), cookies.body);
});

test("ConfigGeneral.qml no longer configures the bottom text", () => {
    const code = stripQmlComments(configGeneral);

    assert.ok(
        !code.includes("cfg_taglineText"),
        "the removed bottom-text setting must leave no cfg_ alias behind",
    );
    assert.ok(
        !code.includes("id: taglineText"),
        "the removed bottom-text TextField must not come back",
    );
    assert.ok(
        !configGeneral.includes("Bottom text:"),
        "the removed bottom-text label must not come back",
    );
});

/*
 * The cookies combo is the one config control whose failure mode is not cosmetic: opening the
 * page on the wrong item also SAVES the wrong item, because Plasma reads cfg_<entryName> back
 * when the page is applied. The arrangement below was measured, not reasoned about: the shipped
 * file was instantiated against Qt 6.11.2 through PyQt6, with the stored value passed as an
 * initial property exactly the way AppletConfiguration.qml passes it. Measured order on Qt
 * 6.11.2 -- the stored value lands in the page, the combo's own startup adopts index 0 and
 * rewrites editText to "brave", and only after that does the combo's Component.onCompleted run.
 *
 * A plain `node --test` suite cannot reach any of that, so these two tests pin the shape the
 * measurement produced. They cannot prove the combo seeds correctly; they fail when the
 * arrangement that was measured to be correct is replaced by another one.
 */
test("ConfigGeneral.qml keeps the cookies browser in a plain property, not an editText alias", () => {
    const code = stripQmlComments(configGeneral);

    assert.ok(
        code.includes("property string cfg_cookiesBrowser"),
        "the setting must live in a plain property that Plasma's initial write survives",
    );
    assert.ok(
        !/property\s+alias\s+cfg_cookiesBrowser/.test(code),
        "an editText alias cannot hold the stored value: the combo initialises afterwards, "
            + "adopts index 0 and rewrites editText to \"brave\", so the page opens -- and "
            + "then saves -- a browser the user never chose",
    );
});

test("ConfigGeneral.qml seeds the cookies combo from the setting, then unmutes the push-back", () => {
    const code = stripQmlComments(configGeneral);
    const comboStart = code.indexOf("QQC2.ComboBox {");

    assert.ok(comboStart >= 0, "the config page must still show the cookies combo");

    const combo = code.slice(comboStart);

    assert.ok(
        /Component\.onCompleted:\s*\{\s*const stored = configPage\.cfg_cookiesBrowser;[\s\S]*?cookiesBrowser\.editText = stored;\s*cookiesBrowser\.seeded = true;/
            .test(combo),
        "the seed must read the setting once, write currentIndex before editText (an index of "
            + "-1 blanks editText, so a free-form value like \"chrome:Default\" has to be "
            + "restored afterwards) and only then mark itself done",
    );

    assert.ok(
        /onEditTextChanged:\s*\{\s*if \(!cookiesBrowser\.seeded\)\s*\{\s*return;\s*\}/.test(combo),
        "the push-back must stay muted until the seed is in: the combo's startup fires "
            + "editTextChanged with \"brave\" before Component.onCompleted, so an unmuted "
            + "handler writes that over the stored browser",
    );

    assert.ok(
        combo.includes("configPage.cfg_cookiesBrowser = cookiesBrowser.textAt(index)"),
        "a pick from the list must still reach the setting",
    );
});

test("main.qml forwards the cookies browser but no tagline into the full representation", () => {
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");

    const fullRepresentationBlock = mainQml.slice(blockStart);

    assert.ok(
        fullRepresentationBlock.includes("cookiesBrowser: Plasmoid.configuration.cookiesBrowser"),
        "the cookies browser must still reach the popup representation",
    );
    assert.ok(
        !fullRepresentationBlock.includes("taglineText"),
        "the removed bottom text must not be forwarded into the popup representation",
    );
});

test("FullRepresentation.qml no longer carries the bottom text in code", () => {
    const code = stripQmlComments(fullQml);

    assert.ok(!code.includes("taglineText"), "the removed bottom-text property must be gone");
    assert.ok(
        !code.includes("Persiguiendo la singularidad"),
        "the shipped code must not carry the removed motto",
    );
});

test("FullRepresentation.qml no longer renders the footer", () => {
    const code = stripQmlComments(fullQml);

    assert.ok(!code.includes('i18n("All systems available")'), "the footer's state label must be gone");
    assert.ok(
        !code.includes('i18n("Docker Status") + " · " + i18n("Local panel")'),
        "the static footer label must be gone",
    );
    assert.ok(!code.includes("paletteTokens.footerText"), "the footer text token must not be read");
    assert.ok(!fullQml.includes("--- Footer"), "the footer section comment must be gone");
});

test("FullRepresentation.qml pins the column order: status, container, update, Miscelanea", () => {
    const statusIndex = fullQml.indexOf("--- Status card");
    const containerIndex = fullQml.indexOf("--- Container section");
    const updateIndex = fullQml.indexOf("--- Update notice");
    const miscIndex = fullQml.indexOf("--- Miscelanea section");

    assert.ok(statusIndex >= 0, "the status card section must be present");
    assert.ok(containerIndex >= 0, "the container section must be present");
    assert.ok(updateIndex >= 0, "the update notice section must be present");
    assert.ok(miscIndex >= 0, "the Miscelanea section must be present");

    assert.ok(statusIndex < containerIndex, "the status card must be pinned above the container section");
    assert.ok(containerIndex < updateIndex, "the update notice must sit below the container section");
    assert.ok(updateIndex < miscIndex, "the Miscelanea section must be the last region, below the update notice");

    // Nothing follows the Miscelanea section: no other section marker can come after it.
    assert.equal(
        fullQml.indexOf("// ---", miscIndex + 1),
        -1,
        "no section may follow the pinned Miscelanea section",
    );
});

test("FullRepresentation.qml makes the container section the scrollable middle region", () => {
    const containerStart = fullQml.indexOf("--- Container section");
    const updateStart = fullQml.indexOf("--- Update notice");
    const miscStart = fullQml.indexOf("--- Miscelanea section");

    assert.ok(
        containerStart >= 0 && updateStart >= 0 && miscStart >= 0,
        "the section markers must be present",
    );

    const containerBlock = fullQml.slice(containerStart, updateStart);
    const miscBlock = fullQml.slice(miscStart);

    assert.ok(
        containerBlock.includes("Layout.fillHeight: true"),
        "the middle region must fill the widget's height",
    );
    assert.ok(
        containerBlock.includes("Layout.minimumHeight: fullRoot.containerScrollFloor"),
        "the middle region must never collapse below the scroll floor",
    );
    assert.ok(
        containerBlock.includes("Layout.preferredHeight: fullRoot.containerScrollFloor"),
        "the middle region's preferred height must be the scroll floor",
    );

    const listViewStart = containerBlock.indexOf("ListView {");
    assert.ok(listViewStart >= 0, "the container list must still exist");
    const listViewBlock = containerBlock.slice(
        listViewStart,
        containerBlock.indexOf("delegate:", listViewStart),
    );
    assert.ok(
        listViewBlock.includes("Layout.fillHeight: true"),
        "the list must fill and scroll instead of capping its own height",
    );

    assert.ok(
        !miscBlock.includes("Layout.fillHeight"),
        "the pinned Miscelanea section must not participate in the height fill",
    );

    assert.ok(
        !fullQml.includes("Math.min(contentHeight"),
        "the removed 13-grid-unit list cap must not come back",
    );
});

test("FullRepresentation.qml sizes the scroll floor to one and a half rows", () => {
    assert.ok(
        fullQml.includes("readonly property int containerRowHeight: 52"),
        "the row height must be a named constant",
    );
    assert.ok(
        fullQml.includes("readonly property int containerScrollFloor: fullRoot.containerRowHeight * 3 / 2"),
        "the floor must be one and a half rows, written against the row height",
    );
    assert.equal(52 * 3 / 2, 78, "one and a half rows must be 78px");
});

test("FullRepresentation.qml floors the root implicit width at the fixed popup width", () => {
    assert.ok(
        fullQml.includes("Layout.preferredWidth: Kirigami.Units.gridUnit * 34"),
        "the popup's fixed preferred width must stay 34 grid units",
    );

    // The root is a plain Item whose content column is anchored to fill, so its implicit
    // width excludes the column's margins; the widest natural-width child used to be the
    // footer's row. With the footer gone a content-derived width collapses to the card's
    // gutters alone, so the binding must take the wider of the card and the fixed popup.
    assert.ok(
        /implicitWidth:\s*Math\.max\(\s*content\.implicitWidth\s*\+\s*content\.anchors\.leftMargin\s*\+\s*content\.anchors\.rightMargin,\s*Kirigami\.Units\.gridUnit\s*\*\s*34\s*\)/
            .test(fullQml),
        "implicitWidth must take a Math.max whose second argument is the fixed popup width",
    );
});

test("FullRepresentation.qml reserves the update-notice row so it cannot resize the widget", () => {
    const updateStart = fullQml.indexOf("--- Update notice");
    const miscStart = fullQml.indexOf("--- Miscelanea section");

    assert.ok(
        updateStart >= 0 && miscStart > updateStart,
        "the update notice must sit before the Miscelanea section",
    );

    const updateBlock = fullQml.slice(updateStart, miscStart);

    assert.ok(
        updateBlock.includes("Layout.preferredHeight: Kirigami.Units.gridUnit"),
        "the notice must occupy a reserved row of one grid unit",
    );
    assert.ok(
        updateBlock.includes('text: fullRoot.updateAvailable ? fullRoot.updateFeedback : ""'),
        "the text must be emptied rather than the label hidden, so the row never collapses",
    );
    assert.ok(
        !updateBlock.includes("visible:"),
        "the notice must not have a visible gate that would collapse the reserved row",
    );
});

test("FullRepresentation.qml resolves the displayed browser through the command's own resolver", () => {
    assert.ok(
        fullQml.includes(
            "readonly property string cookiesBrowserDisplay: "
                + "DockerStatus.resolveCookiesBrowser(fullRoot.cookiesBrowser)",
        ),
        "the label must resolve through the same function that builds the yt-dlp command, "
            + "so it can never claim a browser the download is not using",
    );

    assert.ok(
        fullQml.includes('? i18nc("@info", "Cookies from: %1", fullRoot.cookiesBrowserDisplay)'),
        "the resolved browser must actually be the text that is shown",
    );
    assert.ok(fullQml.includes(': i18nc("@info", "Cookies: not used")'));
});

test("both action buttons fill the row, so the row cannot reflow between labels", () => {
    // Select by the button's own label, not by icon name: the Countdown to Extinction
    // play/cancel buttons reuse the same media-playback-start/stop icons, so an
    // icon-name match would silently depend on file order.
    const buttonBlocks = fullQml.split("PlasmaComponents3.Button {");
    const startBlock = buttonBlocks.find((block) => block.includes('i18n("Start daemon")'));
    const stopBlock = buttonBlocks.find(
        (block) => block.includes('i18n("Stop daemon")') || block.includes('i18n("Confirm stop")'),
    );

    assert.ok(startBlock, "the action row must still have a start button");
    assert.ok(stopBlock, "the action row must still have a stop button");

    // Comments are stripped before matching. The stop block names the superseded narrow
    // rule in prose, so a pin a comment can satisfy would guard the comment instead of
    // the code -- and would keep passing after the equal-width rule was deleted.
    const startCode = stripQmlComments(startBlock);
    const stopCode = stripQmlComments(stopBlock);

    assert.ok(startCode.includes("Layout.fillWidth: true"), "Start must fill the row");

    // Read from the stop button's own block and from its own line on, so a fillWidth that
    // belongs to another widget cannot stand in for the stop button's.
    const stopHeader = stopCode
        .slice(stopCode.indexOf('icon.name: "media-playback-stop"'))
        .split("\n")
        .slice(0, 10)
        .join("\n");

    assert.ok(
        stopHeader.includes("Layout.fillWidth: true"),
        "Stop must fill the row too, so the row cannot reflow between "
            + "\"Stop daemon\" and \"Confirm stop\": both buttons keep their width and "
            + "only their labels change",
    );
});

/*
 * ---------------------------------------------------------------------------
 * Countdown to Extinction: the config entry, the config control, and the wiring
 * ---------------------------------------------------------------------------
 * The countdown crosses three files that cannot be exercised together here: a kcfg
 * entry, a config-page control, and the state machine in main.qml driven by
 * FullRepresentation's signals. Every one of these compiles and renders when it is
 * silently dropped, and the failure only shows up as a setting that does nothing, a
 * dead-looking button with no reason, or a countdown that can never be cancelled.
 */

test("main.xml declares the shutdown countdown as a String defaulting to 15", () => {
    const entry = kcfgEntry(mainXml, "shutdownCountdownMinutes");

    // A String, not an Int: the control is a TextField so a non-number can reach the page
    // and surface an error. An Int entry could never carry one.
    assert.ok(entry.attributes.includes('type="String"'), entry.attributes);
    assert.ok(entry.body.includes("<default>15</default>"), entry.body);
});

test("ConfigGeneral.qml aliases the countdown to a plain TextField and shows the invalid cue", () => {
    assert.ok(
        configGeneral.includes("property alias cfg_shutdownCountdownMinutes: shutdownCountdownMinutes.text"),
        "Plasma reads the setting through the cfg_<entryName> alias",
    );

    // The alias target must stay a plain writable property: aliasing an expression is a
    // silent no-op on save, the trap the file's own header comment documents.
    assert.ok(
        /QQC2\.TextField\s*\{\s*\n\s*id: shutdownCountdownMinutes/.test(configGeneral),
        "the alias target must be a QQC2.TextField with id shutdownCountdownMinutes",
    );

    assert.ok(
        configGeneral.includes(
            "readonly property bool shutdownMinutesValid: "
                + "DockerStatus.resolveShutdownMinutes(configPage.cfg_shutdownCountdownMinutes) !== null",
        ),
        "the page must validate through the same pure resolver main.qml uses",
    );

    assert.ok(
        configGeneral.includes("Enter a whole number of minutes greater than 10."),
        "an unusable value must surface an explanation instead of leaving play looking dead",
    );
});

test("main.qml keeps the power-off command a fixed literal the countdown never reaches", () => {
    assert.ok(mainQml.includes('readonly property string powerOffCommand: "systemctl poweroff"'));

    // Interpolation and concatenation are exactly how a configured duration could reach a
    // shell, which is the one thing this feature must never do.
    assert.ok(
        !/readonly property string powerOffCommand:[^\n]*\$\{/.test(mainQml),
        "the power-off command must not interpolate anything into its string",
    );
    assert.ok(
        !/readonly property string powerOffCommand:[^\n]*\+/.test(mainQml),
        "the power-off command must not be assembled from configuration",
    );
    assert.ok(
        !/powerOffCommand[^\n]*shutdownMinutes/.test(mainQml),
        "the configured countdown must never reach the command string",
    );
});

test("main.qml owns the countdown state and its three functions", () => {
    for (const pin of [
        "property bool shutdownPending: false",
        "property bool shutdownInFlight: false",
        "function startShutdownCountdown()",
        "function stopShutdownCountdown()",
        "function firePowerOff()",
    ]) {
        assert.ok(mainQml.includes(pin), `main.qml must declare ${pin}`);
    }

    // The deadline is a timestamp, not a long Timer interval: it survives a late tick.
    assert.ok(
        mainQml.includes("Date.now() + root.shutdownMinutes * 60 * 1000"),
        "the countdown must be a wall-clock deadline",
    );
    // Every one-shot command goes through the run token, power-off included.
    assert.ok(
        mainQml.includes("DockerStatus.withRunToken(root.powerOffCommand, root.nextRunToken())"),
        "the power-off must go through withRunToken like every other one-shot command",
    );
});

test("main.qml forwards the shutdown state and handles both shutdown signals", () => {
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");

    const block = mainQml.slice(blockStart);

    for (const forwarding of [
        "shutdownReady: root.shutdownReady",
        "shutdownMinutes: root.shutdownMinutes",
        "shutdownPending: root.shutdownPending",
        "shutdownInFlight: root.shutdownInFlight",
        "shutdownRemainingSeconds: root.shutdownRemainingSeconds",
        "shutdownFeedback: root.shutdownFeedback",
        "shutdownFeedbackSeverity: root.shutdownFeedbackSeverity",
    ]) {
        assert.ok(block.includes(forwarding), `the popup must receive ${forwarding}`);
    }

    assert.ok(block.includes("onShutdownStartRequested: root.startShutdownCountdown()"));
    assert.ok(block.includes("onShutdownStopRequested: root.stopShutdownCountdown()"));
});

test("FullRepresentation.qml carries the shutdown section, disables play and builds no command", () => {
    assert.ok(fullQml.includes('i18n("Countdown to Extinction")'), "the section needs its title");

    // Play must be disabled the instant the sequence starts, so one activation cannot arm
    // twice; stop is the only cancellation path and is enabled only while pending. The
    // inline field's validity is a second gate: an unusable value disables play rather
    // than being rounded to something else.
    assert.ok(
        fullQml.includes(
            "readonly property bool shutdownPlayEnabled: fullRoot.shutdownReady "
                + "&& fullRoot.shutdownMinutesFieldValid "
                + "&& !fullRoot.shutdownPending && !fullRoot.shutdownInFlight",
        ),
        "play must include shutdownMinutesFieldValid and !shutdownPending",
    );
    assert.ok(
        /text: fullRoot\.shutdownPending\s*\?\s*i18n\("Shutting down…"\)\s*:\s*i18n\("Shut down"\)/
            .test(fullQml),
        "the play label must say that the sequence is running",
    );
    assert.ok(
        /enabled: fullRoot\.shutdownPending\b/.test(fullQml),
        "stop must only be enabled while a shutdown is pending",
    );

    // The popup is a pure consumer: it renders state and emits signals, and never names a
    // shell command or the fixed power-off constant.
    assert.ok(!fullQml.includes("systemctl poweroff"), "the popup must not build a command");
    assert.ok(!fullQml.includes("powerOffCommand"), "the popup must not know the command");

    // The feedback row reuses SeverityDot, so no second severity-to-colour mapping exists.
    const section = fullQml.slice(fullQml.indexOf('i18n("Countdown to Extinction")'));
    assert.ok(
        section.includes("severity: fullRoot.shutdownFeedbackSeverity"),
        "the shutdown feedback must reuse SeverityDot",
    );
    assert.ok(
        section.includes("DockerStatus.formatCountdown(fullRoot.shutdownRemainingSeconds)"),
        "the pending line must render the live countdown",
    );
});

/*
 * ---------------------------------------------------------------------------
 * Countdown to Extinction: the inline editor and the single kcfg writer
 * ---------------------------------------------------------------------------
 * The popup gains a second editing surface for the same setting, so the two halves
 * that must not drift get pinned as text: the representation carries the raw value
 * and emits edits, and main.qml remains the ONLY writer of the kcfg entry. The
 * resolver stays the single validator on both sides.
 */

test("FullRepresentation.qml carries the inline minutes field's inbound property and outbound signal", () => {
    assert.ok(
        fullQml.includes("property string shutdownMinutesText:"),
        "the raw stored value must enter the representation as a string",
    );
    assert.ok(
        fullQml.includes("signal shutdownMinutesEdited(string text)"),
        "the representation must emit the raw text of an edit",
    );
});

test("main.qml forwards the raw countdown string and handles the edit signal", () => {
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");
    const block = mainQml.slice(blockStart);

    assert.ok(
        block.includes("shutdownMinutesText: Plasmoid.configuration.shutdownCountdownMinutes"),
        "the popup must receive the canonical raw stored string",
    );
    assert.ok(
        block.includes("onShutdownMinutesEdited: (text) => root.setShutdownMinutes(text)"),
        "the edit signal must reach the single writer",
    );
});

test("the inline field is pure: only main.qml touches Plasmoid.configuration", () => {
    assert.ok(
        !fullQml.includes("Plasmoid.configuration"),
        "the representation must stay a pure consumer and never read or write configuration",
    );
    assert.ok(
        !fullQml.includes("Plasmoid.configuration.shutdownCountdownMinutes ="),
        "the kcfg entry must not be written from the representation",
    );
    assert.ok(
        mainQml.includes("Plasmoid.configuration.shutdownCountdownMinutes ="),
        "main.qml must remain the single writer of the kcfg entry",
    );
});

test("main.qml writes back only a resolvable, changed value", () => {
    const fnStart = mainQml.indexOf("function setShutdownMinutes(raw)");
    assert.ok(fnStart >= 0, "main.qml must define setShutdownMinutes(raw)");

    // Slice the whole function by matching braces, since a nested block's closing brace
    // must not be able to cut the slice short and hide the write. setShutdownMinutes is
    // the last function in the file, so the next-function boundary is unavailable.
    let fnDepth = 0;
    let fnEnd = -1;
    for (let i = fnStart; i < mainQml.length; i += 1) {
        if (mainQml[i] === "{") fnDepth += 1;
        if (mainQml[i] === "}") {
            fnDepth -= 1;
            if (fnDepth === 0) {
                fnEnd = i + 1;
                break;
            }
        }
    }
    assert.ok(fnEnd > fnStart, "setShutdownMinutes' body must close");
    const fn = mainQml.slice(fnStart, fnEnd);

    assert.ok(
        fn.includes("DockerStatus.resolveShutdownMinutes(raw)"),
        "the writer must validate through the same pure resolver",
    );
    assert.ok(
        fn.includes("return;"),
        "an unusable value must return early instead of being persisted",
    );
    assert.ok(
        fn.includes("raw === Plasmoid.configuration.shutdownCountdownMinutes"),
        "an unchanged value must not trigger a redundant kcfg write",
    );
    assert.ok(
        fn.includes("Plasmoid.configuration.shutdownCountdownMinutes = raw"),
        "the writer must persist the validated raw value into the kcfg entry",
    );
});

test("FullRepresentation.qml validates through the single resolver and parses nothing itself", () => {
    assert.ok(
        fullQml.includes("DockerStatus.resolveShutdownMinutes("),
        "the field must validate through the shared resolver",
    );
    assert.ok(
        !fullQml.includes("parseInt("),
        "the representation must not carry a second integer parser",
    );
    assert.ok(
        !fullQml.includes("/^[0-9"),
        "the representation must not carry a second digits regex",
    );
});

test("the inline field seeds once and mirrors inbound changes with both guards", () => {
    assert.ok(fullQml.includes("property bool seeded: false"), "the field needs its seeded latch");
    assert.ok(
        fullQml.includes("property bool programmatic: false"),
        "the field needs its programmatic-write latch",
    );

    const seedStart = fullQml.indexOf("Component.onCompleted:");
    assert.ok(seedStart >= 0, "the field must seed itself on completion");
    const seed = fullQml.slice(seedStart, fullQml.indexOf("\n            }", seedStart));
    assert.ok(
        seed.includes("text = fullRoot.shutdownMinutesText;"),
        "seeding must copy the raw stored string once, not bind a live expression",
    );

    const syncStart = fullQml.indexOf("onShutdownMinutesTextChanged:");
    assert.ok(syncStart >= 0, "the root must handle inbound changes to the stored string");
    const sync = fullQml.slice(syncStart, fullQml.indexOf("\n    }", syncStart));
    assert.ok(
        sync.includes("shutdownMinutesField.activeFocus"),
        "an inbound change must never clobber what the user is typing",
    );
    assert.ok(
        sync.includes("shutdownMinutesField.programmatic"),
        "an inbound change must skip a programmatic text write instead of echoing it back",
    );
});

test("the inline field mirrors an external change on focus loss without clobbering the user's error", () => {
    // A stored change that arrives while the field is focused is skipped by the inbound
    // sync, and nothing re-runs on blur; focus loss is the only moment it can still be
    // mirrored. The mirror must therefore exist and must keep every gate the sync has.
    const focusStart = fullQml.indexOf("onActiveFocusChanged:");
    assert.ok(focusStart >= 0, "a focus change must mirror an external change the focused sync skipped");
    const focus = fullQml.slice(focusStart, fullQml.indexOf("\n            }", focusStart));

    assert.ok(
        focus.includes("if (activeFocus || !shutdownMinutesField.seeded || shutdownMinutesField.programmatic) return;"),
        "the focus-loss mirror must bail while focused, before seeding and on a programmatic write",
    );
    assert.ok(
        focus.includes("shutdownMinutesField.text === fullRoot.shutdownMinutesText"),
        "an unchanged text must not trigger a redundant mirror",
    );
    assert.ok(
        focus.includes("DockerStatus.resolveShutdownMinutes(shutdownMinutesField.text) === null"),
        "the focus-loss mirror must only mirror a valid text, never overwrite the user's error",
    );
    assert.ok(
        focus.includes("shutdownMinutesField.programmatic = true;")
            && focus.includes("shutdownMinutesField.programmatic = false;"),
        "the mirror must latch the programmatic flag around the write so it cannot echo as an edit",
    );
});

test("the inline field reaches its error path and is disabled while a countdown runs", () => {
    // The error must remain typeable: a digits-only input or mask would make it unreachable.
    assert.ok(
        !fullQml.includes("ImhDigitsOnly"),
        "the field must accept non-digits so the error path stays reachable",
    );
    assert.ok(
        !fullQml.includes("inputMask"),
        "an input mask would block the invalid states the cue exists for",
    );

    assert.ok(
        fullQml.includes("visible: !fullRoot.shutdownMinutesFieldValid"),
        "the cue must show while the field's own value is invalid",
    );
    assert.ok(
        fullQml.includes('i18n("Enter a whole number of minutes greater than 10.")'),
        "the cue must say what to fix",
    );
    assert.ok(
        fullQml.includes("Kirigami.Theme.negativeTextColor"),
        "the field must tint itself through the theme, not a new severity mapping",
    );

    assert.ok(
        fullQml.includes("enabled: !fullRoot.shutdownPending && !fullRoot.shutdownInFlight"),
        "the field must be disabled while a countdown is pending or in flight",
    );
});

/*
 * ---------------------------------------------------------------------------
 * Collapsible sections: the one merged header, its body and the +- affordance
 * ---------------------------------------------------------------------------
 * Tapping the one section header collapses its body and the popup shrinks with
 * it, because a hidden child contributes no height to the column. The state is
 * LOCAL VIEW STATE and nothing else: it is not persisted, and it travels
 * through no signal, so main.qml and Plasmoid.configuration stay unaware of it
 * and the popup stays a pure consumer of configuration. The header, the
 * separator and each sub-block's identity glyph never collapse.
 *
 * Pinned as text because every one of these compiles and renders when it is
 * silently dropped: a missing MouseArea turns the +/- into a decoration that
 * answers to nothing, and a header RowLayout that keeps Layout margins while
 * carrying anchors is exactly the undefined behaviour the file's own header
 * warns about.
 */

const paletteQmlUrl = new URL(
    "../package/io.github.daver-ui.dockerstatus/contents/ui/DockerStatusPalette.qml",
    import.meta.url,
);
const paletteQml = readFileSync(paletteQmlUrl, "utf8");

// Section state -> its header RowLayout's id, its body's visible gates. The
// download and countdown blocks no longer own a flag each: adr-0019 merged them
// into ONE "Miscelánea" section, so a single collapsible flag and a single header
// RowLayout now cover both. The countdown's three conditional cues fold their own
// rule in, so their pinned expressions appear with the flag first and the cue's
// own condition second -- except the invalid cue, which keeps the leading test a
// separate pin below. The containers section is NOT here: its header row is gone
// entirely (adr-0016), so it owns no collapse state and no separator any more.
const COLLAPSIBLE_SECTIONS = [
    {
        flag: "miscSectionExpanded",
        row: "miscHeaderRow",
        headerToggle: "fullRoot.miscSectionExpanded = !fullRoot.miscSectionExpanded",
        // The merged body gates on miscBodyVisible, not the raw section bool: an
        // armed shutdown is the one collapse that must be refused.
        gates: [
            "visible: fullRoot.miscBodyVisible",
            "visible: fullRoot.miscBodyVisible && fullRoot.shutdownFeedback !== \"\"",
            "visible: !fullRoot.shutdownMinutesFieldValid && fullRoot.miscBodyVisible",
            // The pending line is deliberately NOT gated by the collapse flag at
            // all -- see the armed-countdown test below.
            "visible: fullRoot.shutdownPending",
        ],
    },
];

test("each collapsible section declares its own local view state, open by default", () => {
    for (const section of COLLAPSIBLE_SECTIONS) {
        assert.ok(
            fullQml.includes(`property bool ${section.flag}: true`),
            `the popup must declare ${section.flag}, defaulting to true so nothing `
                + "regresses visually before a header is tapped",
        );
    }

    // Local view state only: no signal is minted for it, and the one write each
    // flag ever receives is its own header flipping itself -- nothing else, and in
    // particular nothing in main.qml, may assign it. The comment above the array
    // explains why the containers section is absent: with its header row gone
    // (adr-0016) there is no collapse state left to own.
    for (const section of COLLAPSIBLE_SECTIONS) {
        assert.ok(
            !fullQml.includes(`signal ${section.flag}`),
            `the collapse state is view state, not an event: no signal for ${section.flag}`,
        );
        const assignments = fullQml.split(`${section.flag} = `).length - 1;
        assert.equal(
            assignments,
            1,
            `${section.flag} may only be assigned by its own header's toggle`,
        );
    }

    // The merged section carries its own accented Spanish title, and it is the
    // single flag both former blocks now share.
    assert.ok(
        fullQml.includes("property bool miscSectionExpanded: true"),
        "the merged section must declare its one local view-state flag, open by default",
    );
    assert.ok(
        fullQml.includes('i18n("Miscelánea")'),
        "the merged section header must carry its accented Spanish title",
    );

    // No orphaned state may survive the merge: the two per-block flags and the old
    // countdown gate are gone for good, so nothing can read a flag no header flips.
    assert.ok(!fullQml.includes("downloadSectionExpanded"), "no per-block download flag may survive the merge");
    assert.ok(!fullQml.includes("countdownSectionExpanded"), "no per-block countdown flag may survive the merge");
    assert.ok(!fullQml.includes("countdownBodyVisible"), "the old countdown gate must be replaced by the merged one");

    assert.ok(!fullQml.includes("Plasmoid.configuration"), "still a pure consumer");
});

test("tapping a section header toggles that section, and only that section", () => {
    for (const section of COLLAPSIBLE_SECTIONS) {
        // The header RowLayout is re-parented into a plain Item that carries only
        // Layout.* insets -- a layout-managed item must not carry anchors -- and the
        // MouseArea that does the toggling fills that Item.
        assert.ok(fullQml.includes(section.headerToggle), `${section.flag} needs its toggle`);

        const rowStart = fullQml.indexOf(`id: ${section.row}`);
        assert.ok(rowStart > 0, `the ${section.flag} header must keep a RowLayout with id ${section.row}`);

        const row = fullQml.slice(rowStart, fullQml.indexOf("spacing: 12", rowStart));
        assert.ok(row.includes("anchors.fill: parent"), `${section.row} fills its wrapper Item`);
        assert.ok(
            !row.includes("Layout.leftMargin") && !row.includes("Layout.rightMargin")
                && !row.includes("Layout.topMargin") && !row.includes("Layout.bottomMargin"),
            `${section.row} must move its insets onto the wrapper Item's Layout margins`,
        );
    }

    // The one merged header drives the one flag: one handler body for the section.
    const toggles = COLLAPSIBLE_SECTIONS.filter((section) => fullQml.includes(section.headerToggle));
    assert.equal(toggles.length, 1, "the merged Miscelánea header must be tappable");
});

test("each collapsible section hides its body, never its header or separator", () => {
    for (const section of COLLAPSIBLE_SECTIONS) {
        for (const gate of section.gates) {
            assert.ok(fullQml.includes(gate), `${section.flag} must gate: ${gate}`);
        }
    }

    // The status card's equal-width action row is NOT collapsible and must never
    // become one: both buttons stay visible whatever the section state is.
    const actionRowStart = fullQml.indexOf("text: fullRoot.startInFlight");
    assert.ok(actionRowStart > 0, "the status card must keep its action row");
    assert.ok(
        !/visible: fullRoot\.(?:container|download|countdown|misc)SectionExpanded/.test(
            fullQml.slice(actionRowStart, fullQml.indexOf("stopDaemonButton", actionRowStart) + 200),
        ),
        "the status card's action row must not be gated on any collapse flag",
    );

    // The merged header keeps its separator Rectangle: it closes the one header off
    // from the merged body and it never collapses.
    for (const flag of ["miscSectionExpanded"]) {
        const row = COLLAPSIBLE_SECTIONS.find((section) => section.flag === flag).row;
        assert.ok(
            new RegExp(`id: ${row}[\\s\\S]{0,4000}Rectangle \\{\\s*Layout.fillWidth: true\\s*Layout.preferredHeight: 1`)
                .test(fullQml),
            `${flag}'s header must keep its separator Rectangle`,
        );
    }

    // The countdown has no header row of its own any more: it is an inner title
    // INSIDE the merged body column, below the merged header, so it must not open a
    // second card or carry a second separator. Anchor on the merged header and prove
    // the inner countdown title lives below the merged body's own visible gate.
    const miscHeaderStart = fullQml.indexOf("id: miscHeaderRow");
    assert.ok(miscHeaderStart > 0, "the merged header must keep its RowLayout");
    const mergedBody = fullQml.slice(miscHeaderStart);
    assert.ok(
        mergedBody.indexOf('i18n("Countdown to Extinction")')
            > mergedBody.indexOf("visible: fullRoot.miscBodyVisible"),
        "the inner countdown title must live inside the merged body column, below its visible gate",
    );
    assert.ok(
        !fullQml.includes("id: countdownHeaderRow"),
        "the countdown must not keep a header RowLayout of its own in the merged section",
    );
});

/*
 * Why this test exists. adr-0009 and the project's own Overview name "the visible
 * countdown and the cancel button" among the safeguards that let the power-off run
 * without a password prompt. Collapsing a section is therefore a rest-state
 * declutter only: while a shutdown is pending, the merged "Miscelánea" body -- the
 * live "Powering off in M:SS" figure and the Cancel button included -- has to come
 * back and stay visible. An armed destructive state must never be hideable, and a
 * section affordance that can hide one turns the widget's own safety argument into
 * a lie.
 *
 * Pinned as text because every one of these compiles and renders when it is
 * dropped: gating the pending line on the collapse flag alone would hide the
 * countdown exactly when it matters, and the visible failure is not a crash but a
 * machine that powers off with nothing on screen counting down.
 */
test("an armed countdown cannot be collapsed away", () => {
    // The one gate the whole merged section reads, and the derived flag that
    // un-collapses it while a shutdown is pending.
    assert.ok(
        fullQml.includes(
            "readonly property bool miscBodyVisible: "
                + "fullRoot.miscSectionExpanded || fullRoot.shutdownPending",
        ),
        "the merged body must be visible whenever the section is open OR a shutdown is pending",
    );

    // Every body item except the pending line reads that gate, so none of them can
    // disappear while the deadline runs. The pending line is stricter still.
    for (const gate of [
        "visible: fullRoot.miscBodyVisible",
        "visible: fullRoot.miscBodyVisible && fullRoot.shutdownFeedback !== \"\"",
        "visible: !fullRoot.shutdownMinutesFieldValid && fullRoot.miscBodyVisible",
    ]) {
        assert.ok(fullQml.includes(gate), `the merged body must gate on ${gate}`);
    }

    // The live countdown line is gated on shutdownPending and nothing else: it only
    // exists while a shutdown is armed, and that is exactly when it must never hide.
    const pendingLine = fullQml
        .split("PlasmaComponents3.Label {")
        .find((block) => block.includes("DockerStatus.formatCountdown(fullRoot.shutdownRemainingSeconds)"));
    assert.ok(pendingLine, "the pending line must render the live countdown");
    assert.ok(
        /visible: fullRoot\.shutdownPending\s*\n/.test(pendingLine),
        "the pending line's visibility must be shutdownPending alone, ending the clause",
    );
    assert.ok(
        !/visible:.*(miscBodyVisible|miscSectionExpanded)/.test(pendingLine),
        "no collapse flag may hide the live countdown line",
    );

    // The header's tap still toggles the section bool, so a pending countdown is
    // restored in full -- the user never sees a half-rendered armed state.
    assert.ok(
        fullQml.includes("onClicked: fullRoot.miscSectionExpanded = !fullRoot.miscSectionExpanded"),
        "the header toggle must keep flipping the section bool",
    );
});

/* The indicator is a functional affordance, so it is neither a severity accent nor
 * neutral chrome: it gets its own neon yellow token and a pixel size one step
 * above body text. No hardcoded colour hex is allowed at a call site. */
test("the +/- indicator is a neon yellow token, bigger than body text, with a halo", () => {
    assert.ok(
        paletteQml.includes("// --- Section toggle affordance ---"),
        "the palette must group the toggle tokens under their own heading",
    );
    assert.ok(
        paletteQml.includes("readonly property color toggleIndicator: \"#FFE500\""),
        "the toggle affordance needs its own saturated neon yellow",
    );
    assert.ok(
        paletteQml.includes("readonly property int toggleIndicatorPixelSize: 22"),
        "the toggle affordance is deliberately a bit bigger than body text",
    );

    const indicatorSize = 22;
    const bodySize = /readonly property int bodyPixelSize: (\d+)/.exec(paletteQml);
    assert.ok(bodySize, "the palette must keep its body text token");
    assert.ok(
        indicatorSize > Number(bodySize[1]),
        "the indicator must read larger than body text",
    );

    // U+2212 MINUS SIGN when open, "+" when collapsed -- not an ASCII hyphen,
    // whose stroke weight and width do not match the plus it stands beside. Two
    // headers carry the pair now: the merged "Miscelánea" section header plus the
    // per-compose-group header inside the containers list. The exact count is
    // pinned -- rather than a ">= 2" floor -- so a third header added later fails
    // loudly here instead of silently expanding the affordance's surface.
    const glyph = `? "\u2212" : "+"`;

    // Each header is anchored by its own state expression, so a regression that
    // rewired one header's glyph to the wrong flag still fails below.
    assert.ok(
        fullQml.includes(`fullRoot.miscBodyVisible ${glyph}`),
        "the merged Miscelánea header must render the +/- glyph pair off effective visibility",
    );
    assert.ok(
        fullQml.includes(`containerGroup.groupOpen ${glyph}`),
        "the per-compose-group header must render the +/- glyph pair",
    );

    assert.equal(
        fullQml.split(glyph).length - 1,
        2,
        "exactly two headers may carry the +/- glyph pair: the merged section and the group header",
    );

    // Every indicator reads the palette: no colour hex at any call site. Each of the
    // two headers draws a crisp copy and a larger halo copy, so each token is read
    // four times. The exact counts are pinned so a third header cannot slip in.
    assert.equal(
        (fullQml.match(/paletteTokens\.toggleIndicator(?!PixelSize)/g) || []).length,
        4,
        "the crisp glyph and its halo must both read the palette colour token, across both headers",
    );
    assert.equal(
        (fullQml.match(/paletteTokens\.toggleIndicatorPixelSize/g) || []).length,
        4,
        "the crisp glyph and its halo must both read the pixel size token, across both headers",
    );

    // The halo is a second, larger, low-opacity copy of the SAME glyph: plain
    // Text, no shader effect and no extra import.
    assert.equal(
        fullQml.split("opacity: 0.3").length - 1,
        2,
        "each of the two headers' halos is a low-opacity copy of the same glyph",
    );

    // The decorative arrow glyph is gone: the affordance replaced it.
    assert.ok(!fullQml.includes("\u21b3"), "the old arrow glyph must be replaced by the +/-");
    assert.ok(
        !fullQml.includes("paletteTokens.blue"),
        "the arrow glyph's accent token must not survive it",
    );
});

/*
 * ---------------------------------------------------------------------------
 * Compose grouping and per-group actions, pinned in FullRepresentation.qml
 * ---------------------------------------------------------------------------
 * The containers list is grouped by compose project in the core
 * (DockerStatus.groupContainersByComposeProject) and the popup only renders what that
 * function returns. The grouping, the per-group collapse state and the compose-only
 * controls all compile and render when they are silently dropped -- a view that
 * re-groups in QML would drift from the tested core, and a play/stop pair that lost
 * its isComposeGroup gate would offer `docker start` on the standalone bucket. Pinned
 * as text, in the established style.
 */

test("FullRepresentation.qml renders the grouped compose model and never re-groups in QML", () => {
    assert.ok(
        fullQml.includes("model: DockerStatus.groupContainersByComposeProject(fullRoot.containers)"),
        "the containers list must render the core's grouping",
    );

    // The grouping is pure data prep in the core. A second model bound straight to
    // fullRoot.containers would render the flat list again -- or a second, untested
    // grouping -- so the raw list must never be a model.
    assert.ok(
        !fullQml.includes("model: fullRoot.containers"),
        "no model may iterate fullRoot.containers directly",
    );
    assert.equal(
        fullQml.split("model:").length - 1,
        2,
        "the section has exactly two models: the grouped list and the group's own rows Repeater",
    );
});

test("FullRepresentation.qml gives each compose group its own local collapse state", () => {
    assert.ok(
        fullQml.includes("property bool groupOpen: true"),
        "each group delegate declares its own open/closed state, defaulting open",
    );
    assert.ok(
        fullQml.includes("onClicked: containerGroup.groupOpen = !containerGroup.groupOpen"),
        "the group header's tap must flip its own state",
    );
    assert.equal(
        fullQml.split("containerGroup.groupOpen = ").length - 1,
        1,
        "the group collapse state is assigned by its own header and nothing else",
    );

    // The group's OWN flag is the only collapse state the body reads: the section
    // flag it used to be ANDed with is gone with the header row (adr-0016), so a
    // collapsed section can no longer hide a group body.
    assert.ok(
        fullQml.includes("visible: containerGroup.groupOpen"),
        "the group body must be gated on its own flag, with no section flag left to AND in",
    );
    assert.ok(
        !fullQml.includes("visible: containerGroup.groupOpen && fullRoot.containerSectionExpanded"),
        "the removed section flag must not survive in the group body's gate",
    );
});

test("the compose controls are offered only on a real compose group", () => {
    assert.equal(
        fullQml.split("visible: containerGroup.isComposeGroup").length - 1,
        2,
        "both the play and stop controls must be hidden on the standalone bucket",
    );
    assert.ok(
        fullQml.includes(
            "readonly property bool isComposeGroup: "
                + "containerGroup.modelData.project !== DockerStatus.COMPOSE_PROJECT_STANDALONE",
        ),
        "isComposeGroup must compare against the exported constant, not a bare \"\"",
    );
    assert.ok(
        !fullQml.includes('containerGroup.modelData.project !== ""'),
        "the standalone test must not be written as a bare empty-string literal",
    );

    assert.ok(
        fullQml.includes('i18n("Other containers")'),
        "the standalone bucket must show a translated label, never the empty project name",
    );
});

test("the compose controls carry both the in-flight gate and their no-op gate", () => {
    // One action at a time: both controls go inert while anything is in flight. Start is
    // additionally a no-op when every container already runs; stop is a no-op when none
    // does. Pin the exact operands so a dropped gate cannot slip past.
    assert.ok(
        /enabled: !fullRoot\.composeActionInFlight\s*\n\s*&& containerGroup\.runningCount !== containerGroup\.modelData\.containers\.length/
            .test(fullQml),
        "start must be disabled while in flight and when the whole group already runs",
    );
    assert.ok(
        /enabled: !fullRoot\.composeActionInFlight\s*\n\s*&& containerGroup\.runningCount !== 0/
            .test(fullQml),
        "stop must be disabled while in flight and when nothing in the group runs",
    );
});

test("the compose controls emit the frozen signals with the model's project", () => {
    assert.ok(
        fullQml.includes("fullRoot.composeStartRequested(containerGroup.modelData.project)"),
        "start must name the project from the group's own modelData",
    );
    assert.ok(
        fullQml.includes("fullRoot.composeStopRequested(containerGroup.modelData.project)"),
        "stop must name the project from the group's own modelData",
    );
});

test("the group body reuses the original container-row markup", () => {
    // The move into a grouped list must not have regressed the row itself: the hover
    // tint, the hover-only MouseArea, the 32px glyph tile and the severity dot are all
    // still there, and the row still reads its data through containerRow.modelData.
    assert.ok(
        fullQml.includes('color: rowHover.containsMouse ? paletteTokens.rowHoverTint : "transparent"'),
        "the row keeps its hover tint",
    );
    assert.ok(
        fullQml.includes("acceptedButtons: Qt.NoButton"),
        "the row's hover area must accept no button, so it never swallows a click",
    );
    assert.ok(
        fullQml.includes("containerRow.modelData.name") && fullQml.includes("containerRow.modelData.state"),
        "the row must read its data through the delegate's modelData",
    );
    assert.ok(
        fullQml.includes("DockerStatus.containerSeverity(containerRow.modelData.state)"),
        "the row's severity must still come from the core, not a second mapping",
    );

    // The 32x32 glyph tile, as in the mockup, lives inside the group body.
    const groupBody = fullQml.slice(
        fullQml.indexOf("property bool groupOpen: true"),
        fullQml.indexOf("// --- Miscelanea section"),
    );
    assert.ok(
        groupBody.includes("Layout.preferredWidth: 32") && groupBody.includes("Layout.preferredHeight: 32"),
        "the row keeps its 32x32 glyph tile",
    );
});

/*
 * ---------------------------------------------------------------------------
 * The flat containers section, pinned in FullRepresentation.qml
 * ---------------------------------------------------------------------------
 * The human operator asked for the containers list as a flat row list with a Docker
 * glyph, small right-aligned action icons and no section header (adr-0016). Every
 * piece of that compiles and renders when it is dropped -- a resurrected header is
 * exactly the kind of silent re-addition the pins exist to catch -- so the absence
 * is pinned as text alongside the two visible gates that replaced it.
 */

test("the containers section is a flat list: no header, no section flag, a Docker glyph", () => {
    assert.ok(!fullQml.includes('i18n("Containers")'), "the Containers title row is gone (adr-0016)");
    assert.ok(!fullQml.includes("%1 services"), "the N services meta row went with the header");
    assert.ok(!fullQml.includes("containerSectionExpanded"), "no section flag is left with no header to tap it");
    assert.ok(!fullQml.includes("containersHeaderRow"), "the header RowLayout is gone");
    assert.ok(fullQml.includes("visible: fullRoot.containers.length > 0"), "the list shows whenever there are containers");
    assert.ok(fullQml.includes("visible: fullRoot.containers.length === 0"), "the empty state shows whenever there are none");
    assert.ok(
        fullQml.includes('source: Qt.resolvedUrl("../icons/dockerstatus.svg")'),
        "the group tile draws the bundled Docker box glyph",
    );
    assert.equal(
        fullQml.split('Qt.resolvedUrl("../icons/dockerstatus.svg")').length - 1,
        1,
        "exactly one bundled-glyph call site, on the group tile",
    );
});

/*
 * Why this test exists. The compose play/stop were 38x38 ToolButtons carrying
 * overridden `background` Rectangles in the daemon action's mint and pink, which
 * the human operator flagged as disproportionate and off-centre next to the group
 * name (adr-0016). They are now 28x28 flat icon-only buttons with muted glyphs.
 * Pinned as the REMOVAL of the old surface plus the new size, not as a size ceiling
 * on everything: the refresh button and the download row keep their own dimensions.
 */
test("the compose controls are small flat icon buttons, not the 38px surfaces", () => {
    const region = fullQml.slice(
        fullQml.indexOf("// --- Container section"),
        fullQml.indexOf("// --- Miscelanea section"),
    );
    assert.equal(
        region.split("Layout.preferredWidth: 28").length - 1,
        3,
        "the tile, the play and the stop are the three 28px items of the group header",
    );
    assert.ok(!region.includes("flat: false"), "no chunky button surface remains in the containers section");
    assert.ok(!region.includes("paletteTokens.buttonPrimaryHover"), "the mint compose background is gone");
    assert.ok(!region.includes("paletteTokens.buttonDanger"), "the pink compose background is gone");
});

/*
 * Why this test exists. The compose group header row used to sit flush against the
 * sunken card's borders while the container rows below it carried an 8px inset, so
 * the leading glyph tile and the trailing +/- toggle hugged the card edge and the
 * header did not line up with its own rows. The gutter now rides on the header ROW,
 * matching containerRowLayout's 8px inset, and NOT on the wrapper Item above it --
 * that wrapper's full-width MouseArea is the group's tap target, so insetting the
 * wrapper would silently shrink the click area. Pinned as text because the wrapper's
 * Layout margins are the tempting wrong fix: the merged Miscelanea header insets its
 * wrapper, and copying that here would look right while breaking the tap target.
 */
test("the compose group header shares its rows' 8px gutter without shrinking the tap target", () => {
    const headerRowStart = fullQml.indexOf("id: containerGroupHeaderRow");
    assert.ok(headerRowStart > 0, "the group header must keep its RowLayout");
    const headerRowSpacing = fullQml.indexOf("spacing: 12", headerRowStart);
    assert.ok(headerRowSpacing > headerRowStart, "the header row must keep its spacing");
    const headerSlice = fullQml.slice(headerRowStart, headerRowSpacing);
    assert.ok(headerSlice.includes("anchors.leftMargin: 8"), "the group header carries the left gutter");
    assert.ok(headerSlice.includes("anchors.rightMargin: 8"), "the group header carries the right gutter");

    const rowStart = fullQml.indexOf("id: containerRowLayout");
    assert.ok(rowStart > 0, "the container row must keep its layout");
    const rowSpacing = fullQml.indexOf("spacing: 11", rowStart);
    assert.ok(rowSpacing > rowStart, "the container row must keep its spacing");
    const rowSlice = fullQml.slice(rowStart, rowSpacing);
    assert.ok(rowSlice.includes("anchors.leftMargin: 8"), "the container rows still carry the left gutter");
    assert.ok(rowSlice.includes("anchors.rightMargin: 8"), "the container rows still carry the right gutter");

    const wrapperStart = fullQml.indexOf("implicitHeight: containerGroupHeaderRow.implicitHeight + 12");
    assert.ok(wrapperStart > 0, "the header wrapper must keep its implicit height");
    assert.ok(wrapperStart < headerRowStart, "the header wrapper must sit above the header row");
    const wrapperSlice = fullQml.slice(wrapperStart, headerRowStart);
    assert.ok(
        !wrapperSlice.includes("Layout.leftMargin"),
        "the header wrapper has no left Layout margin -- the tap target stays full-width",
    );
    assert.ok(
        !wrapperSlice.includes("Layout.rightMargin"),
        "the header wrapper has no right Layout margin either",
    );
});

/*
 * The Podman Desktop launch returned as a square status-card button (adr-0017)
 * after the ADR-0016 section removal: the section, its collapse and its full-width
 * card are gone, but the launch itself came back -- not as a surface the popup
 * owns, but as a 28x28 button beside the daemon-status label whose click emits
 * into main.qml. Pinned as text because the surface moved rather than simply
 * vanishing: the topbar's removal is what took the old "Workspace"/refresh row
 * with it, and a resurrected card or a resurrected topbar is exactly the kind of
 * silent re-addition these pins exist to catch.
 */
test("FullRepresentation.qml renders the relocated Podman launch button in the status card", () => {
    // The signal the button emits, and the properties main.qml forwards back into it.
    assert.ok(fullQml.includes("signal podmanLaunchRequested()"), "the launch signal must return with the button");

    // The relocated controls live between the status-card marker and the stats row.
    const headRegion = fullQml.slice(
        fullQml.indexOf("// --- Status card"),
        fullQml.indexOf("// stats:"),
    );
    for (const pin of [
        "id: refreshButton",
        "onClicked: fullRoot.refreshRequested()",
        "running: fullRoot.actionInFlight",
        "id: podmanButton",
        'icon.name: "system-run"',
        "onClicked: fullRoot.podmanLaunchRequested()",
    ]) {
        assert.ok(headRegion.includes(pin), `the status head row must carry ${pin}`);
    }

    // The topbar and the removed section leave nothing behind.
    assert.ok(!fullQml.includes('i18n("Workspace")'), "the Workspace eyebrow is gone with the topbar (adr-0017)");
    assert.ok(!fullQml.includes("podmanSectionExpanded"), "the launch is a button, not a collapsible section (adr-0017)");
});

/*
 * ---------------------------------------------------------------------------
 * Compose and Podman wiring in main.qml, pinned as text
 * ---------------------------------------------------------------------------
 * main.qml owns the two new unprivileged mutations: it forwards the project name to the
 * pure builder, runs one one-shot per action, and surfaces the outcome. None of that is
 * reachable from a Node test -- it needs a live data engine -- so the wiring is pinned
 * as text, in the same style as the daemon action and the update check.
 */

test("main.qml carries the labelled compose probe exactly", () => {
    assert.ok(
        mainQml.includes(
            "readonly property string containerListCommand: "
                + `"docker ps -a --format '{{.Names}}|{{.State}}|{{.Label \\"com.docker.compose.project\\"}}'"`,
        ),
        "the probe must select the compose project label as its third field, in this exact shape",
    );
});

test("main.qml declares the compose one-shot source and its handler", () => {
    const blocks = mainQml.split("P5Support.DataSource {");
    const compose = blocks.find((block) => block.includes("id: composeAction"));

    assert.ok(compose, "main.qml must declare the composeAction source");

    assert.ok(compose.includes("interval: 0"), "composeAction must be a one-shot");
    assert.ok(compose.includes("connectedSources: []"), "composeAction must start disconnected");
    assert.ok(compose.includes('Number(data["exit code"])'), "composeAction must read the exit code as a number");
    assert.ok(
        compose.includes('DockerStatus.normalizeOutput(data["stderr"])'),
        "composeAction must surface stderr verbatim on a failure",
    );

    // The launch source the removed section took with it (adr-0016) returned as the
    // retained boundary's caller (adr-0017); its own declaration is pinned by the
    // dedicated test below, not here.

    // The handler clears its own in-flight flag and clears the feedback on success.
    assert.ok(compose.includes("root.composeActionInFlight = false;"), compose);
    assert.ok(compose.includes('root.composeActionFeedback = "";'), compose);
});

test("main.qml refuses the standalone bucket before it burns a run token", () => {
    const fnStart = mainQml.indexOf("function runComposeProject(project, action)");
    assert.ok(fnStart >= 0, "main.qml must define runComposeProject");
    const fn = mainQml.slice(fnStart, mainQml.indexOf("function downloadVideo(url)", fnStart));

    assert.ok(
        fn.includes("project === null || project === undefined || project === DockerStatus.COMPOSE_PROJECT_STANDALONE"),
        "the standalone bucket and a null/undefined project must be refused",
    );

    // A refused action must not burn a token: the guard has to run BEFORE nextRunToken().
    const refusal = fn.indexOf("DockerStatus.COMPOSE_PROJECT_STANDALONE");
    const token = fn.indexOf("root.nextRunToken()");
    assert.ok(
        refusal >= 0 && token >= 0 && refusal < token,
        "the standalone/null refusal must precede nextRunToken()",
    );
});

test("main.qml builds the compose command only through the pure builder", () => {
    assert.ok(
        mainQml.includes("DockerStatus.buildComposeProjectCommand("),
        "the compose command must come from the pure builder",
    );

    // The compose command is builder output, never assembled here. The probe's fixed
    // `docker ps -a --format ...` is the one sanctioned docker literal in this file, so
    // the ban is on the compose fragments rather than on `docker ps` itself.
    const code = stripQmlComments(mainQml);
    assert.ok(!code.includes("docker start"), "no literal `docker start` may be assembled in QML");
    assert.ok(!code.includes("docker stop"), "no literal `docker stop` may be assembled in QML");
    assert.ok(!code.includes("docker ps -aq"), "the label-filter resolve must not be assembled in QML");
    assert.ok(!code.includes("--filter"), "the filter flag must not be assembled in QML");
    assert.ok(
        !code.includes("label=com.docker.compose.project="),
        "the label filter must not be assembled in QML",
    );
});

test("main.qml wires the retained Podman Desktop launch back to its surface", () => {
    // The removed section took its caller off this surface (adr-0016); the retained
    // boundary (builder, kcfg entry, resolver) is put back into use as a status-card
    // button (adr-0017), so the launcher and its one-shot return here.
    assert.ok(mainQml.includes("function launchPodmanDesktop()"), "the launcher function must return");
    assert.ok(mainQml.includes("DockerStatus.buildPodmanDesktopCommand("), "the launch must come from the pure builder");
    assert.ok(mainQml.includes("path: Plasmoid.configuration.podmanDesktopPath,"), "the path comes from the kcfg entry");
    assert.ok(mainQml.includes("home: root.homeDirectory,"), "the home directory is the resolver's tilde base");
    assert.ok(mainQml.includes("token: root.nextRunToken()"), "every one-shot assignment carries a run token");
    assert.ok(mainQml.includes("property bool podmanLaunchInFlight: false"), "the in-flight state must return");

    const blocks = mainQml.split("P5Support.DataSource {");
    const podman = blocks.find((block) => block.includes("id: podmanLaunch"));

    assert.ok(podman, "main.qml must declare the podmanLaunch source");
    assert.ok(podman.includes("interval: 0"), "podmanLaunch must be a one-shot");
    assert.ok(podman.includes("connectedSources: []"), "podmanLaunch must start disconnected");
});

test("main.qml forwards the compose state into the popup", () => {
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");
    const block = mainQml.slice(blockStart);

    for (const forwarding of [
        "composeActionInFlight: root.composeActionInFlight",
        "composeActionProject: root.composeActionProject",
        "composeActionKind: root.composeActionKind",
        "composeActionFeedback: root.composeActionFeedback",
        "composeActionFeedbackSeverity: root.composeActionFeedbackSeverity",
        "podmanLaunchInFlight: root.podmanLaunchInFlight",
        "podmanLaunchFeedback: root.podmanLaunchFeedback",
        "podmanLaunchFeedbackSeverity: root.podmanLaunchFeedbackSeverity",
    ]) {
        assert.ok(block.includes(forwarding), `the popup must receive ${forwarding}`);
    }

    for (const handler of [
        "onComposeStartRequested: (project) => root.startComposeProject(project)",
        "onComposeStopRequested: (project) => root.stopComposeProject(project)",
        "onPodmanLaunchRequested: root.launchPodmanDesktop()",
    ]) {
        assert.ok(block.includes(handler), `the popup must wire ${handler}`);
    }
});

test("main.qml's source-count comment stays consistent with the new sources", () => {
    const commentStart = mainQml.indexOf("// Update check: two sources");
    assert.ok(commentStart >= 0, "the source-count comment must survive");
    const comment = mainQml.slice(
        commentStart,
        mainQml.indexOf("P5Support.DataSource {", commentStart),
    );

    assert.ok(comment.includes("tenth and eleventh"), comment);
    assert.ok(comment.includes("nine before them"), comment);
    assert.ok(comment.includes("composeAction"), comment);
    assert.ok(comment.includes("podmanLaunch"), "the restored launch source must be counted");

    // The comment is only honest if the file really declares eleven sources.
    assert.equal(
        mainQml.split("P5Support.DataSource {").length - 1,
        11,
        "main.qml must declare eleven data sources, as its own comment says",
    );
});

/*
 * ---------------------------------------------------------------------------
 * The Podman path setting in the config surface, pinned as text
 * ---------------------------------------------------------------------------
 * The setting is the one configured value that becomes a command, so it is a plain
 * String entry aliased to a plain writable TextField, exactly like the yt-dlp binary
 * field. Pinned as text because a broken alias or a wrongly-typed duplicate entry
 * compiles fine and only shows up as a setting that does not stick.
 */

test("main.xml declares the Podman Desktop path as a String defaulting to podman-desktop", () => {
    const entry = kcfgEntry(mainXml, "podmanDesktopPath");
    assert.ok(entry.attributes.includes('type="String"'), entry.attributes);
    assert.ok(entry.body.includes("<default>podman-desktop</default>"), entry.body);

    // Exactly one entry by that name: a second, differently-typed duplicate would shadow
    // the one the config page aliases.
    assert.equal(
        mainXml.split('<entry name="podmanDesktopPath"').length - 1,
        1,
        "main.xml must declare exactly one podmanDesktopPath entry",
    );
});

test("ConfigGeneral.qml aliases the Podman path to a plain writable TextField", () => {
    assert.ok(
        configGeneral.includes("property alias cfg_podmanDesktopPath: podmanDesktopPath.text"),
        "Plasma reads the setting through the cfg_<entryName> alias",
    );
    assert.ok(
        /QQC2\.TextField\s*\{\s*\n\s*id: podmanDesktopPath/.test(configGeneral),
        "the alias target must be a plain QQC2.TextField with id podmanDesktopPath",
    );
});

/*
 * ---------------------------------------------------------------------------
 * Update check: the QML wiring and the config surface, pinned as text
 * ---------------------------------------------------------------------------
 * The update check crosses the four surfaces a runtime test cannot reach: two
 * DataSources and one handler in main.qml, the context-menu action plus the forwarding
 * that carry it into the popup, the single line in FullRepresentation.qml, and the kcfg
 * entry with its SpinBox. Every one of them compiles and renders when it is silently
 * dropped, and the failure only shows up as a check that never runs or a line that never
 * appears -- so the wiring is pinned as static text, in the established style.
 */

test("main.qml wires the two update-check sources against the fixed command", () => {
    // The command is a constant assembled in the pure core, never in QML.
    assert.ok(
        mainQml.includes(
            "readonly property string updateCheckCommand: DockerStatus.buildUpdateCheckCommand({})",
        ),
    );
    assert.ok(
        mainQml.includes(
            "readonly property int updateCheckIntervalMs: "
                + "Math.max(0, Plasmoid.configuration.updateCheckIntervalHours * 3600 * 1000)",
        ),
    );

    // Read each source by its own block, so a binding belonging to one cannot stand in
    // for the other's.
    const blocks = mainQml.split("P5Support.DataSource {");
    const polled = blocks.find((block) => block.includes("id: updateCheckSource"));
    const forced = blocks.find((block) => block.includes("id: updateCheckForced"));

    assert.ok(polled, "main.qml must declare updateCheckSource");
    assert.ok(forced, "main.qml must declare updateCheckForced");

    // The polled source IS the load-time check: the engine runs it once on connect, and
    // it disconnects itself ([]) when the interval is 0.
    assert.ok(
        polled.includes("connectedSources: root.updateCheckIntervalMs > 0 ? [root.updateCheckCommand] : []"),
        polled,
    );

    // The one-shot is assigned per click through the run token, because a polled source's
    // connectedSources is a binding and cannot be reassigned.
    assert.ok(forced.includes("interval: 0"), forced);
    assert.ok(
        mainQml.includes("DockerStatus.withRunToken(root.updateCheckCommand, root.nextRunToken())"),
        "the manual one-shot must tokenise the fixed command like every other one-shot",
    );
});

test("main.qml's update-check handler degrades to silence, never to text", () => {
    assert.ok(mainQml.includes("function checkForUpdates()"), "the action needs a function to call");
    assert.ok(
        mainQml.includes("function handleUpdateCheck(sourceName, data)"),
        "both sources deliver to one named handler",
    );

    const handlerStart = mainQml.indexOf("function handleUpdateCheck(sourceName, data)");
    assert.ok(handlerStart >= 0);

    // Slice the whole function by matching braces, so a nested block's closing brace
    // cannot cut the slice short and hide the guarantees below.
    let depth = 0;
    let handlerEnd = -1;
    for (let i = handlerStart; i < mainQml.length; i += 1) {
        if (mainQml[i] === "{") {
            depth += 1;
        }
        if (mainQml[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                handlerEnd = i + 1;
                break;
            }
        }
    }
    assert.ok(handlerEnd > handlerStart, "handleUpdateCheck's body must close");
    const handler = mainQml.slice(handlerStart, handlerEnd);

    // The event-without-exit-code guard, the split, and the conservative decision.
    assert.ok(handler.includes('const exitCode = data["exit code"]'), handler);
    assert.ok(handler.includes("if (exitCode === undefined)"), handler);
    assert.ok(handler.includes('DockerStatus.splitUpdateCheckOutput(data["stdout"])'), handler);
    assert.ok(
        handler.includes("DockerStatus.isUpdateAvailable(installed, latest)"),
        handler,
    );

    // The decision is made on THIS run's parsed installed copy, never on the cached
    // property: a package swapped under a live widget must not leave a stale version to be
    // compared against a fresh manifest.
    assert.ok(
        handler.includes("const installed = halves.installed !== \"\""),
        handler,
    );
    assert.ok(!handler.includes("root.installedVersion, latest"), handler);

    // The silent path is the explicit offline branch: an empty manifest OR an empty
    // installed version, both read from this run's own bytes.
    assert.ok(
        handler.includes('if (latest === "" || installed === "")'),
        handler,
    );

    // stderr is NEVER read from this source, in any branch: there is no error text
    // anywhere in the update check.
    assert.ok(
        !handler.includes('data["stderr"]'),
        "the update check must never surface stderr; it fails silently by design",
    );
});

test("main.qml adds the check-for-updates action and forwards the update state to the popup", () => {
    const actionsStart = mainQml.indexOf("Plasmoid.contextualActions:");
    const representationsStart = mainQml.indexOf("// --- Representations");
    assert.ok(actionsStart >= 0 && representationsStart > actionsStart);
    const actions = mainQml.slice(actionsStart, representationsStart);

    // The third action, after Refresh and Start Docker daemon. The widget opens no
    // browser, so it only re-runs the check.
    assert.ok(actions.includes('text: i18n("Check for updates")'), actions);
    assert.ok(actions.includes('icon.name: "system-software-update"'), actions);
    assert.ok(actions.includes("enabled: !root.updateCheckInFlight"), actions);
    assert.ok(actions.includes("onTriggered: root.checkForUpdates()"), actions);

    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");
    const block = mainQml.slice(blockStart);

    assert.ok(block.includes("updateAvailable: root.updateAvailable"), "the popup must receive the flag");
    assert.ok(block.includes("updateFeedback: root.updateFeedback"));
    assert.ok(block.includes("onUpdateCheckRequested: root.checkForUpdates()"));

    // The version travels inside updateFeedback (i18nc("Version %1 is available.", ...)),
    // so the representation is deliberately not handed a second copy of it to ignore.
    assert.ok(!block.includes("latestVersion: root.latestVersion"));
});

test("FullRepresentation.qml carries the reserved update line and its signal", () => {
    // Inbound properties and the outbound signal.
    assert.ok(fullQml.includes("property bool updateAvailable: false"));
    assert.ok(fullQml.includes('property string updateFeedback: ""'));
    assert.ok(fullQml.includes("signal updateCheckRequested()"));

    // It is a Label, not a button. adr-0015 reverses adr-0013's "not a link" clause
    // for exactly ONE fixed target: the indicator beside the daemon status opens the
    // constant, and the muted version line itself stays a non-clickable label.
    const updateLine = fullQml
        .split("PlasmaComponents3.Label {")
        .find((block) => block.includes('text: fullRoot.updateAvailable ? fullRoot.updateFeedback : ""'));
    assert.ok(updateLine, "the update line must be a PlasmaComponents3.Label");

    const lineBody = updateLine.slice(0, updateLine.indexOf("\n        }"));
    assert.ok(
        lineBody.includes('text: fullRoot.updateAvailable ? fullRoot.updateFeedback : ""'),
        "the line must empty its text when no update is available, so its reserved row never grows",
    );
    assert.ok(!lineBody.includes("onClicked"), "the update line must not be a button");

    // adr-0015 authorised exactly ONE browser-opening call, to the fixed release-page
    // constant. The human-approved open-folder shortcut adds a SECOND call site: a click on
    // the download row's folder button. That URL is not a browser page and is never raw
    // configuration -- it is built by DockerStatus.buildFolderUrl() from the resolved download
    // directory -- so the two are pinned by their exact argument text and by set equality,
    // not by a mere count that could silently accept a third, different target.
    const code = stripQmlComments(fullQml);

    assert.ok(
        code.includes("onClicked: Qt.openUrlExternally(DockerStatus.UPDATE_PAGE_URL)"),
        "the indicator must open the fixed release-page constant",
    );
    assert.ok(
        code.includes("onClicked: Qt.openUrlExternally(fullRoot.downloadFolderUrl)"),
        "the folder shortcut must open the URL the pure builder produced",
    );

    const openArgs = [...code.matchAll(/Qt\.openUrlExternally\(([^)]*)\)/g)]
        .map((match) => match[1].trim())
        .sort();
    assert.deepEqual(
        openArgs,
        ["DockerStatus.UPDATE_PAGE_URL", "fullRoot.downloadFolderUrl"].sort(),
        "the popup opens exactly these two targets and no other URL",
    );

    assert.equal(
        fullQml.split("visible: fullRoot.updateAvailable").length - 1,
        1,
        "only the indicator keeps the silence gate; the line's reserved row stays blank instead",
    );
});

test("the download row shows the configured folder and offers the open-folder shortcut", () => {
    // main.qml reads configuration and resolves both strings; the representation only renders
    // them, asserted as text exactly like the other forwarded properties.
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");
    const block = mainQml.slice(blockStart);

    assert.ok(
        block.includes("downloadDirectoryDisplay: root.downloadDirectoryDisplay"),
        "the resolved folder must reach the tooltip",
    );
    assert.ok(
        block.includes("downloadFolderUrl: root.downloadFolderUrl"),
        "the built file:// URL must reach the folder shortcut",
    );

    // The title is a ToolButton purely so its ToolTip renders: a PlasmaComponents3.ToolTip
    // only shows when its parent is an AbstractButton. The text names the resolved folder, or
    // stays empty until $HOME is known -- and an empty text is what hides the ToolTip.
    const titleBlock = fullQml
        .split("PlasmaComponents3.ToolButton {")
        .find((candidate) => candidate.includes("id: downloadDirectoryTitle"));
    assert.ok(titleBlock, "the title must be the ToolTip's legal AbstractButton parent");
    assert.ok(
        titleBlock.includes(
            'i18nc("@info:tooltip", "Download folder: %1", fullRoot.downloadDirectoryDisplay)',
        ),
        "the tooltip must name the resolved download folder",
    );
    assert.ok(
        titleBlock.includes('text: fullRoot.downloadDirectoryDisplay !== ""'),
        "an unknown $HOME must leave the tooltip empty (an empty text hides it)",
    );

    // The shortcut rides the post-download feedback row and only appears on a POSITIVE result:
    // a failed download must never offer a folder, and neither must an in-flight/neutral state.
    const folderBlock = fullQml
        .split("PlasmaComponents3.ToolButton {")
        .find((candidate) => candidate.includes('icon.name: "folder-open"'));
    assert.ok(folderBlock, "the feedback row must carry the open-folder button");
    const folderCode = stripQmlComments(folderBlock);
    assert.ok(
        folderCode.includes("fullRoot.downloadFeedbackSeverity === DockerStatus.SEVERITY_POSITIVE"),
        "only a successful download may offer the folder",
    );
    assert.ok(
        folderCode.includes('fullRoot.downloadFolderUrl !== ""'),
        "the button must guard on a usable URL as well as the success severity",
    );
    assert.ok(
        folderCode.includes("onClicked: Qt.openUrlExternally(fullRoot.downloadFolderUrl)"),
        "the click opens the URL the pure builder produced",
    );
});

test("main.xml declares the update-check interval as an Int defaulting to 6", () => {
    const entry = kcfgEntry(mainXml, "updateCheckIntervalHours");

    assert.ok(entry.attributes.includes('type="Int"'), entry.attributes);
    assert.ok(entry.body.includes("<default>6</default>"), entry.body);
    assert.ok(entry.body.includes("<min>0</min>"), entry.body);
    assert.ok(entry.body.includes("<max>168</max>"), entry.body);
    // The label explains the hours between checks and that 0 disables them.
    assert.ok(/0 disables/.test(entry.body), entry.body);
});

test("ConfigGeneral.qml aliases the update-check interval to a plain SpinBox value", () => {
    assert.ok(
        configGeneral.includes(
            "property alias cfg_updateCheckIntervalHours: updateCheckIntervalHours.value",
        ),
        "Plasma reads the setting through the cfg_<entryName> alias",
    );

    // The alias target is a SpinBox's own writable value property, modelled exactly on
    // the poll interval's cfg_pollIntervalSeconds alias.
    assert.ok(
        /QQC2\.SpinBox\s*\{\s*\n\s*id: updateCheckIntervalHours/.test(configGeneral),
        "the alias target must be a QQC2.SpinBox with id updateCheckIntervalHours",
    );
});

