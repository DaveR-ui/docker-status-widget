import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
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
    parseDaemonState,
    parseContainers,
    countByState,
    summarizeContainers,
    withRunToken,
    daemonSeverity,
    containerSeverity,
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

test("parseContainers parses the real catan-lan stack output", () => {
    const raw =
        "catan-lan-player-1|running\n" +
        "catan-lan-admin-1|running\n" +
        "catan-lan-api-1|running\n";

    const containers = parseContainers(raw);

    assert.equal(containers.length, 3);
    assert.deepEqual(plain(containers[0]), { name: "catan-lan-player-1", state: "running" });
    assert.deepEqual(plain(containers[2]), { name: "catan-lan-api-1", state: "running" });
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
        { name: "good", state: "running" },
        { name: "also-good", state: "exited" },
    ]);
});

test("parseContainers tolerates CRLF and trailing newlines", () => {
    const containers = parseContainers("a|running\r\nb|exited\r\n");
    assert.equal(containers.length, 2);
    assert.deepEqual(plain(containers[1]), { name: "b", state: "exited" });
});

test("parseContainers tolerates a name containing the separator is not split twice", () => {
    // Only the FIRST separator is honoured, so a state containing '|' survives.
    const containers = parseContainers("weird|running|extra");
    assert.deepEqual(plain(containers), [{ name: "weird", state: "running|extra" }]);
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
 * Configurable tagline, cookies feedback and the action row geometry
 * ---------------------------------------------------------------------------
 * Four pieces of shipped QML that a runtime test cannot reach: a kcfg default, the
 * config-page alias target, the bindings that carry both values into the popup, and
 * the width of the stop button. They are pinned as text because every one of them
 * compiles and renders when it is silently dropped, and the failure only shows up as
 * a setting that does nothing or a button that moves under the cursor.
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
 * default, and a file-wide includes() would not notice the tagline losing its own.
 */
function kcfgEntry(xml, name) {
    const match = new RegExp(`<entry name="${name}"([^>]*)>([\\s\\S]*?)</entry>`).exec(xml);
    assert.ok(match, `main.xml must declare the ${name} entry`);
    return { attributes: match[1], body: match[2] };
}

/*
 * Strips QML comments so a code assertion cannot be satisfied -- or defeated -- by prose.
 * The tagline block deliberately names its shipped default in a comment, so the
 * "no hardcoded literal" assertion below must read code only. It is regex-level and
 * therefore approximate; it is only used on the tagline literal, which shares no line
 * with a URL or a regex literal.
 */
const stripQmlComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("main.xml declares the configurable tagline with the existing motto as its default", () => {
    const tagline = kcfgEntry(mainXml, "taglineText");

    assert.ok(tagline.attributes.includes('type="String"'), tagline.attributes);
    assert.ok(
        tagline.body.includes("<default>Persiguiendo la singularidad</default>"),
        "the widget must keep its current wording as the out-of-the-box default",
    );
});

test("main.xml still declares the cookies browser and defaults it to firefox", () => {
    const cookies = kcfgEntry(mainXml, "cookiesBrowser");

    assert.ok(cookies.attributes.includes('type="String"'), cookies.attributes);
    assert.ok(cookies.body.includes("<default>firefox</default>"), cookies.body);
});

test("ConfigGeneral.qml aliases the bottom text to a plain writable TextField", () => {
    assert.ok(
        configGeneral.includes("property alias cfg_taglineText: taglineText.text"),
        "Plasma reads the setting through the cfg_<entryName> alias",
    );

    // The alias target has to stay a plain writable property: aliasing an expression is a
    // silent no-op on save, which is what the file's own header comment warns about.
    assert.ok(
        /QQC2\.TextField\s*\{\s*\n\s*id: taglineText/.test(configGeneral),
        "the alias target must be a QQC2.TextField with id taglineText",
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

test("main.qml forwards the tagline and the cookies browser into the full representation", () => {
    const blockStart = mainQml.indexOf("fullRepresentation: FullRepresentation {");
    assert.ok(blockStart >= 0, "main.qml must define the full representation");

    const fullRepresentationBlock = mainQml.slice(blockStart);

    assert.ok(
        fullRepresentationBlock.includes("taglineText: Plasmoid.configuration.taglineText"),
        "the tagline setting must reach the popup representation",
    );
    assert.ok(
        fullRepresentationBlock.includes("cookiesBrowser: Plasmoid.configuration.cookiesBrowser"),
        "the cookies browser must reach the popup representation",
    );
});

test("FullRepresentation.qml binds the tagline to the setting and drops the hardcoded motto", () => {
    const code = stripQmlComments(fullQml);

    assert.ok(code.includes("text: fullRoot.taglineText"), "the tagline must be the configured text");
    assert.ok(
        code.includes('visible: fullRoot.taglineText !== ""'),
        "an empty setting must hide the tagline instead of leaving a blank row",
    );
    assert.ok(
        !code.includes("Persiguiendo la singularidad"),
        "the shipped code must not hardcode the motto any more",
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

test("the stop button is fixed-width while the start button still fills the row", () => {
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

    assert.ok(startBlock.includes("Layout.fillWidth: true"), "Start must keep sharing the row");

    // Read from the stop button's own block and from its own line on, so a fillWidth that
    // belongs to another widget cannot stand in for the stop button's.
    const stopHeader = stopBlock
        .slice(stopBlock.indexOf('icon.name: "media-playback-stop"'))
        .split("\n")
        .slice(0, 10)
        .join("\n");

    assert.ok(
        stopHeader.includes("Layout.fillWidth: false"),
        "the stop button must not fill the row",
    );
    assert.ok(
        stopHeader.includes("Layout.preferredWidth: Kirigami.Units.gridUnit * 7"),
        "the stop button must keep one fixed narrow width, so the row cannot reflow "
            + "between \"Stop daemon\" and \"Confirm stop\"",
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

