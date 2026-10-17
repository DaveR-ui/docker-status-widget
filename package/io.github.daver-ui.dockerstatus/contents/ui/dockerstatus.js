.pragma library

/*
 * Pure helpers for the Docker Status plasmoid.
 *
 * This file is deliberately free of QML types: everything here can be executed
 * by a plain JavaScript engine, which is what tests/dockerstatus.test.mjs does.
 * Keep it that way. Side effects and running processes belong in the QML layer.
 */

var DAEMON_ACTIVE = "active";
var DAEMON_INACTIVE = "inactive";
var DAEMON_FAILED = "failed";
var DAEMON_UNKNOWN = "unknown";

/*
 * Identifiers for the two privileged actions the widget can run. QML only uses
 * them to tell which action owns an in-flight reply; they are compared against,
 * never parsed, so their spelling is an internal contract between main.qml and
 * FullRepresentation.qml and carries no user-facing meaning.
 */
var ACTION_START = "start";
var ACTION_STOP = "stop";

var CONTAINER_RUNNING = "running";

/*
 * Identifiers for the compose helpers. COMPOSE_PROJECT_STANDALONE is deliberately the
 * empty string: it is the bucket a container with no compose project label falls into,
 * and it is a named constant so the QML and the tests compare against it rather than a
 * bare "". COMPOSE_ACTION_START / _STOP are the only two actions
 * buildComposeProjectCommand() accepts; an action that is neither yields "" (the
 * "there is no command" contract). These live up here with the other enum-like values
 * so every identity constant is declared in one place.
 */
var COMPOSE_PROJECT_STANDALONE = "";
var COMPOSE_ACTION_START = "start";
var COMPOSE_ACTION_STOP = "stop";

/**
 * Normalises raw command output: null/undefined -> "", CRLF -> LF, trimmed.
 */
function normalizeOutput(raw) {
    if (raw === undefined || raw === null) {
        return "";
    }
    return String(raw).replace(/\r/g, "").trim();
}

/**
 * Maps the stdout of `systemctl is-active docker` to one of the DAEMON_* values.
 *
 * Note that `systemctl is-active` reports the unit state on stdout AND uses the
 * exit code to signal it, so stdout is the authoritative source here. An
 * unrecognised value deliberately degrades to DAEMON_UNKNOWN rather than being
 * reported as "stopped", so a broken probe never looks like a healthy reading.
 */
function parseDaemonState(rawOutput) {
    var text = normalizeOutput(rawOutput).toLowerCase();

    switch (text) {
    case "active":
    case "activating":
    case "reloading":
        return DAEMON_ACTIVE;
    case "inactive":
    case "deactivating":
        return DAEMON_INACTIVE;
    case "failed":
        return DAEMON_FAILED;
    default:
        return DAEMON_UNKNOWN;
    }
}

/**
 * Parses `docker ps -a --format '{{.Names}}|{{.State}}|{{.Label
 * "com.docker.compose.project"}}'` output into `{name, state, project}`.
 *
 * Only the first two separators are meaningful: the name ends at the FIRST `|`, the
 * state ends at the SECOND, and the project is the entire remainder -- never split
 * again -- so a label value that itself carries a `|` survives intact. A two-field
 * line (a docker that does not answer the label) still parses with an empty project,
 * which is COMPOSE_PROJECT_STANDALONE: a docker that cannot report the label degrades
 * to one flat group instead of to nothing. Malformed lines -- blank, no separator, or
 * an empty name or state -- are skipped, never half-built.
 */
function parseContainers(rawOutput) {
    var text = normalizeOutput(rawOutput);
    var containers = [];

    if (text === "") {
        return containers;
    }

    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();
        if (line === "") {
            continue;
        }

        var first = line.indexOf("|");
        if (first < 0) {
            continue;
        }

        var name = line.substring(0, first).trim();

        // Split at the SECOND separator only; the project is everything after it and
        // is deliberately never split again.
        var second = line.indexOf("|", first + 1);
        var state;
        var project;
        if (second < 0) {
            state = line.substring(first + 1).trim();
            project = COMPOSE_PROJECT_STANDALONE;
        } else {
            state = line.substring(first + 1, second).trim();
            project = line.substring(second + 1).trim();
        }

        if (name === "" || state === "") {
            continue;
        }

        containers.push({ name: name, state: state, project: project });
    }

    return containers;
}

function countByState(containers, state) {
    var count = 0;
    for (var i = 0; i < containers.length; i += 1) {
        if (containers[i].state === state) {
            count += 1;
        }
    }
    return count;
}

/** Compact "running/total" badge, e.g. "3/5". Never throws on empty input. */
function summarizeContainers(containers) {
    if (!containers || containers.length === 0) {
        return "0/0";
    }
    return countByState(containers, CONTAINER_RUNNING) + "/" + containers.length;
}

/**
 * The "executable" data engine treats connectedSources as a SET: assigning the
 * same command string twice is a no-op and the command is NOT re-executed.
 * Verified against plasma5support 6.7.4. Appending a unique trailing shell
 * comment makes each assignment a distinct source, which forces a re-run.
 *
 * Only safe for commands that end their own logic before the comment, i.e. the
 * fixed command strings this widget builds internally. Never use with a command
 * supplied by configuration.
 */
function withRunToken(command, token) {
    // A newline in the token would end the trailing comment and let whatever follows
    // run as a command. Every caller passes an integer today; stripping CR and LF here
    // keeps that guarantee a property of this function instead of a habit of its
    // callers (found by an adversarial verification pass, not by the widget's wiring).
    var safeToken = String(token).replace(/[\r\n]/g, "");
    return command + " # plasma-run-" + safeToken;
}

/*
 * Severity is the single source of truth for "how bad is this state". The QML
 * layer only maps these four values onto theme colours, so the meaning of a
 * state lives here (and is unit tested) instead of being duplicated across
 * every representation.
 */
var SEVERITY_POSITIVE = "positive";
var SEVERITY_NEUTRAL = "neutral";
var SEVERITY_NEGATIVE = "negative";
var SEVERITY_MUTED = "muted";

function daemonSeverity(state) {
    switch (state) {
    case DAEMON_ACTIVE:
        return SEVERITY_POSITIVE;
    case DAEMON_INACTIVE:
        return SEVERITY_NEUTRAL;
    case DAEMON_FAILED:
        return SEVERITY_NEGATIVE;
    default:
        return SEVERITY_MUTED;
    }
}

function containerSeverity(state) {
    switch (normalizeOutput(state).toLowerCase()) {
    case "running":
        return SEVERITY_POSITIVE;
    case "exited":
    case "created":
        return SEVERITY_NEUTRAL;
    case "restarting":
    case "dead":
    case "paused":
        return SEVERITY_NEGATIVE;
    default:
        return SEVERITY_MUTED;
    }
}

/*
 * Compose groups and per-project start/stop.
 *
 * This is the SECOND sanctioned command-building boundary, and it is a NEW kind of
 * mutation: before adr-0014 the widget had never run a `docker start` or `docker
 * stop`. It is narrow in the same shape as the video download -- the project name is
 * a value INTERPOLATED into exactly one shell-quoted argument, never a command, and
 * the verb is chosen from a fixed pair of constants, so no caller can turn an
 * unvalidated choice into a command.
 *
 * Why `docker start|stop $(docker ps -aq --filter 'label=...=<project>')` and not
 * `docker compose -p <project> start|stop`: the compose file is not available -- the
 * widget cannot know the working directory the stack was started from -- so the
 * label-filtered form needs no file, re-resolves membership at execution time, and
 * is a no-op for containers already in the target state, which is exactly what a
 * partially-running stack means. A stack that vanished between the last poll and the
 * click makes docker exit non-zero with "requires at least 1 container argument",
 * which the caller surfaces verbatim rather than swallowing.
 *
 * The project name reaches the shell ONLY through shellQuote(). Compose project names
 * are [a-z0-9][a-z0-9_-]* in practice, but a container can carry any label, so quoting
 * is the protection rather than the naming rule. buildComposeProjectCommand() returns
 * "" for the standalone bucket and for an action that is neither start nor stop, and
 * main.qml refuses an empty command before it reaches the engine: an empty string is
 * the contract "there is no command".
 */

/**
 * Groups parsed containers by their compose project label, preserving the probe's own
 * order: groups come back in FIRST-SEEN order (not alphabetical -- re-sorting a list
 * the user did not sort is a surprise), and the no-project bucket
 * (COMPOSE_PROJECT_STANDALONE) is emitted LAST and only when it is not empty. A machine
 * with no compose project therefore produces exactly one group, and a container with no
 * project never disappears.
 *
 * Never mutates its input and never throws: []/null/undefined in, [] out. Each group is
 * a fresh object holding a fresh array, so editing one call's answer cannot corrupt the
 * next. Grouping runs over parallel arrays rather than an object keyed by the project
 * name on purpose: a container can carry any label, and a plain object would treat a
 * project literally named "__proto__" as a prototype write and lose that group.
 */
function groupContainersByComposeProject(containers) {
    var groups = [];

    if (!containers || containers.length === 0) {
        return groups;
    }

    var standalone = [];

    for (var i = 0; i < containers.length; i += 1) {
        var container = containers[i];
        var project = container === undefined || container === null
            || container.project === undefined || container.project === null
            ? COMPOSE_PROJECT_STANDALONE
            : String(container.project);

        if (project === COMPOSE_PROJECT_STANDALONE) {
            standalone.push(container);
            continue;
        }

        var index = -1;
        for (var g = 0; g < groups.length; g += 1) {
            if (groups[g].project === project) {
                index = g;
                break;
            }
        }

        if (index < 0) {
            groups.push({ project: project, containers: [container] });
        } else {
            groups[index].containers.push(container);
        }
    }

    if (standalone.length > 0) {
        groups.push({ project: COMPOSE_PROJECT_STANDALONE, containers: standalone });
    }

    return groups;
}

/**
 * Builds the one-shot `docker start|stop $(docker ps -aq --filter 'label=...' )` command
 * for one compose project, or "" when there is no command to build.
 *
 * The label filter is assembled as a single shell argument through shellQuote(), so a
 * project name carrying shell syntax (a `;`, a quote, anything) stays inert. The action
 * is validated against COMPOSE_ACTION_START / COMPOSE_ACTION_STOP before a verb exists;
 * anything else -- an unknown action, a missing project, the standalone bucket -- returns
 * "" and the QML refuses to run it. That is why the runner can never be handed a command
 * built from an unvalidated choice.
 *
 * `token` makes the command a distinct source for the executable engine, exactly like the
 * other builders; it is appended by withRunToken() and is safe only because every byte
 * before it was built here.
 */
function buildComposeProjectCommand(options) {
    var opts = options || {};
    var verb;

    if (opts.action === COMPOSE_ACTION_START) {
        verb = "start";
    } else if (opts.action === COMPOSE_ACTION_STOP) {
        verb = "stop";
    } else {
        return "";
    }

    var project = normalizeOutput(opts.project);
    if (project === COMPOSE_PROJECT_STANDALONE) {
        return "";
    }

    var command = "docker " + verb
        + " $(docker ps -aq --filter "
        + shellQuote("label=com.docker.compose.project=" + project)
        + ")";

    if (opts.token === undefined || opts.token === null) {
        return command;
    }

    return withRunToken(command, opts.token);
}

/*
 * Podman Desktop launch.
 *
 * This is the boundary that contradicts adr-0006 most openly -- the configured path IS
 * the command -- and it is deliberate and bounded in adr-0014: one setting, one validated
 * shape, one default, and NO flag channel. The path is a plain executable name or a
 * `~`-relative/absolute path matching PODMAN_DESKTOP_PATH_PATTERN, never free-form text;
 * it goes through shellQuote() like every other value, and the assembled command is the
 * quoted path plus the run token and NOTHING else -- no arguments, no URL, no flags -- so
 * there is no channel through which configuration could inject one.
 *
 * The default is a PATH name on purpose (measured: `podman-desktop` is /usr/bin/podman-desktop
 * on the reference machine): the widget works where the executable is installed normally,
 * and the setting is the escape hatch for a machine where it is not. Clearing the setting
 * re-arms the default; it does not hide the button.
 */

var PODMAN_DESKTOP_DEFAULT = "podman-desktop";

/*
 * The shape gate for the configured path, mirroring YTDLP_BINARY_PATTERN: a plain
 * executable name or a `~`-relative/absolute path, and nothing else. Whitespace and
 * every shell metacharacter are outside it, so a value that matches can never carry
 * shell syntax even before shellQuote() wraps it.
 */
var PODMAN_DESKTOP_PATH_PATTERN = /^(~\/)?[A-Za-z0-9._\/+-]+$/;

/**
 * Resolves the configured Podman Desktop path, mirroring resolveYtDlpBinary() exactly:
 * empty/null/undefined or a value that is not a plain name or path -- it carries a space,
 * a quote or any other shell metacharacter -- falls back to PODMAN_DESKTOP_DEFAULT, and a
 * leading "~/" is expanded against home. The setting is a validated value, never a command
 * line; a field that could hold one is exactly what adr-0006 exists to prevent.
 */
function resolvePodmanDesktopPath(configured, home) {
    var text = normalizeOutput(configured);

    if (text === "" || !PODMAN_DESKTOP_PATH_PATTERN.test(text)) {
        return PODMAN_DESKTOP_DEFAULT;
    }

    return expandTilde(text, home);
}

/**
 * Builds the one-shot Podman Desktop launch: the shell-quoted resolved path, plus
 * withRunToken() when a token is given, and nothing else. The command IS the quoted path,
 * which is why there is no flag or argument channel to abuse. The token makes the
 * assignment a distinct source for the executable engine.
 */
function buildPodmanDesktopCommand(options) {
    var opts = options || {};
    var command = shellQuote(resolvePodmanDesktopPath(opts.path, opts.home));

    if (opts.token === undefined || opts.token === null) {
        return command;
    }

    return withRunToken(command, opts.token);
}

/*
 * Video downloads.
 *
 * This widget normally executes fixed command constants and never assembles a
 * command from input. A download needs a URL a human pasted, so that rule is bent
 * deliberately, in a narrow way:
 *
 *   1. The URL is refused unless it is an https URL on an allow-listed host
 *      (exact host match, never a suffix) and free of whitespace, quotes, backslash
 *      and control characters. A paste that is not a real video URL never reaches a
 *      shell at all.
 *   2. Everything interpolated into the command line goes through shellQuote(),
 *      including the URL. Quoting is the actual protection; step 1 is the UX half.
 *   3. Configuration (binary, directory, runtime, cookies browser) is validated here
 *      and silently falls back to a safe default rather than being trusted. It never
 *      supplies a command, only values inside one. The cookies browser is configuration
 *      now, but the rule stands: it is a validated value *inside* a command, never a
 *      command, quoting is still the protection, and an empty value opts out of the
 *      flag entirely.
 *
 * tests/dockerstatus.test.mjs runs the assembled command through a real /bin/sh with
 * a stub executable on PATH and asserts the arguments arrive intact, so the quoting
 * claim is tested, not asserted.
 */

var VIDEO_KIND_YOUTUBE = "youtube";
var VIDEO_KIND_TWITTER = "twitter";

var VIDEO_URL_MAX_LENGTH = 2048;
var FEEDBACK_MAX_LENGTH = 240;

var VIDEO_OUTPUT_TEMPLATE = "%(title)s [%(id)s].%(ext)s";
var YTDLP_DEFAULT_BINARY = "yt-dlp";

var COOKIES_BROWSER_DEFAULT = "firefox";

/*
 * yt-dlp's --cookies-from-browser accepts BROWSER[+KEYRING][:PROFILE][::CONTAINER].
 * Letters, digits, dot, underscore, plus, colon, comma and hyphen cover that grammar
 * ("firefox", "chrome:Default", "firefox+gnomekeyring", "chromium::Personal").
 * Whitespace and every shell metacharacter are outside it, so a value that matches
 * can never carry shell syntax even before shellQuote() wraps it.
 */
var COOKIES_BROWSER_PATTERN = /^[A-Za-z0-9._+:,-]+$/;

/**
 * Resolves the browser the cookies are read from.
 *
 * An empty value is meaningful and opts out: the flag is omitted entirely, which is
 * the escape hatch for a machine with no supported browser, or for a public video
 * that needs no session. Garbage falls back to the default instead of being trusted,
 * exactly like resolveJsRuntime().
 */
function resolveCookiesBrowser(configured) {
    if (configured === undefined || configured === null) {
        return COOKIES_BROWSER_DEFAULT;
    }
    var text = String(configured).replace(/\r/g, "").trim();
    if (text === "") {
        return "";
    }
    if (!COOKIES_BROWSER_PATTERN.test(text)) {
        return COOKIES_BROWSER_DEFAULT;
    }
    return text;
}

/*
 * yt-dlp needs a JavaScript runtime to solve YouTube's signature and "n" challenges;
 * without one, YouTube fails with "The page needs to be reloaded" (measured on this
 * machine: yt-dlp 2026.08.19, node 26). An unknown runtime name is harmless -- yt-dlp
 * warns and carries on, and X downloads do not use it at all.
 */
var JS_RUNTIME_DEFAULT = "node";

/*
 * Hosts are matched exactly. A suffix test would accept "youtube.com.evil.tld", and a
 * plain object lookup would happily answer "constructor" with a function, so the
 * lookup below is guarded by hasOwnProperty.
 */
var VIDEO_KIND_BY_HOST = {
    "youtube.com": VIDEO_KIND_YOUTUBE,
    "www.youtube.com": VIDEO_KIND_YOUTUBE,
    "m.youtube.com": VIDEO_KIND_YOUTUBE,
    "music.youtube.com": VIDEO_KIND_YOUTUBE,
    "youtu.be": VIDEO_KIND_YOUTUBE,
    "www.youtu.be": VIDEO_KIND_YOUTUBE,
    "x.com": VIDEO_KIND_TWITTER,
    "www.x.com": VIDEO_KIND_TWITTER,
    "twitter.com": VIDEO_KIND_TWITTER,
    "www.twitter.com": VIDEO_KIND_TWITTER,
    "mobile.twitter.com": VIDEO_KIND_TWITTER
};

var YTDLP_BINARY_PATTERN = /^(~\/)?[A-Za-z0-9._\/+-]+$/;
var JS_RUNTIME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Classifies a pasted link, returning VIDEO_KIND_YOUTUBE, VIDEO_KIND_TWITTER or null.
 * null means "do not build a command at all".
 */
function classifyVideoUrl(rawUrl) {
    var text = normalizeOutput(rawUrl);

    if (text === "" || text.length > VIDEO_URL_MAX_LENGTH) {
        return null;
    }

    // Whitespace, quotes, backslash and control characters never appear in a real
    // URL; refusing them keeps shell syntax out of the pipeline entirely.
    if (/[\s"'`\\\x00-\x1f\x7f]/.test(text)) {
        return null;
    }

    var match = /^https:\/\/([A-Za-z0-9.-]+)([\/?#][^\s]*)?$/.exec(text);
    if (!match) {
        return null;
    }

    var host = match[1].toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(VIDEO_KIND_BY_HOST, host)) {
        return null;
    }

    return VIDEO_KIND_BY_HOST[host];
}

/*
 * yt-dlp substitutes %(id)s with the HOST-SPECIFIC id, and that id is what every partial
 * file of a run carries immediately before its extension, because the output template is
 * "%(title)s [%(id)s].%(ext)s". It is therefore the only anchor a sweep can safely use:
 * a suffix-only "*.part" glob would also delete an unrelated partial sitting in the
 * default ~/Downloads -- Firefox writes its own .part files there -- which is collateral
 * damage on a live browser download.
 *
 * The charset is load-bearing for the same reason: an id that matches /^[A-Za-z0-9_-]+$/
 * cannot contain a glob metacharacter, so it cannot widen the `find` pattern that carries
 * it. The length bound is 32 -- a YouTube id is 11 characters and an X status id is a
 * snowflake currently 19 digits with room to grow, so 32 sits well above both while
 * keeping the emitted pattern short and bounded. Anything longer, anything outside the
 * charset, a host that is not allow-listed and a path shape that names no single video
 * (a playlist link) all answer "".
 *
 * classifyVideoUrl() IS the allow-list and is not re-implemented here: this function only
 * picks the id out of a URL that already passed it.
 */
var VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
var VIDEO_ID_MAX_LENGTH = 32;

var YOUTUBE_PATH_ID_PATTERN = /^\/(?:shorts|live)\/([^\/?#]+)/;
var YOUTUBE_WATCH_ID_PATTERN = /[?&]v=([^&#]+)/;
var YOUTUBE_BARE_ID_PATTERN = /^\/([^\/?#]+)/;
var TWITTER_STATUS_ID_PATTERN = /\/status\/([^\/?#]+)/;

/**
 * The id yt-dlp would substitute for %(id)s in the output template, or "".
 *
 * Refuses everything classifyVideoUrl() refuses (it calls it, so a non-allow-listed host,
 * a non-https URL and a paste carrying quotes or control characters never get this far),
 * plus a playlist-only link, an empty or oversized id and any id outside the charset
 * above.
 */
function extractVideoId(rawUrl) {
    var text = normalizeOutput(rawUrl);
    var kind = classifyVideoUrl(text);

    if (kind === null) {
        return "";
    }

    /*
     * Splitting a URL classifyVideoUrl() already accepted is parsing validated data, not
     * a second host check: the authority ends at the first "/", "?" or "#", exactly the
     * tail separator that function's own regex uses. The youtu.be test below is a ROUTING
     * decision between the two YouTube URL shapes -- the short host's first path segment
     * is the id, youtube.com's is a verb like "watch" -- and grants nothing; the
     * allow-list has already run.
     */
    var rest = text.substring("https://".length);
    var tailStart = rest.search(/[\/?#]/);
    var host = (tailStart < 0 ? rest : rest.substring(0, tailStart)).toLowerCase();
    var tail = tailStart < 0 ? "" : rest.substring(tailStart);

    var match = null;
    if (kind === VIDEO_KIND_TWITTER) {
        match = TWITTER_STATUS_ID_PATTERN.exec(tail);
    } else if (host === "youtu.be" || host === "www.youtu.be") {
        match = YOUTUBE_BARE_ID_PATTERN.exec(tail);
    } else {
        match = YOUTUBE_PATH_ID_PATTERN.exec(tail) || YOUTUBE_WATCH_ID_PATTERN.exec(tail);
    }

    var candidate = match === null ? "" : match[1];

    if (candidate === "" || candidate.length > VIDEO_ID_MAX_LENGTH
            || !VIDEO_ID_PATTERN.test(candidate)) {
        return "";
    }

    return candidate;
}

/**
 * Wraps a value in single quotes for /bin/sh. An embedded single quote is closed,
 * escaped and reopened ('it'\''s') so the value can never end the quoting itself.
 */
function shellQuote(value) {
    var text = value === undefined || value === null ? "" : String(value);
    return "'" + text.replace(/'/g, "'\\''") + "'";
}

/** Expands a leading "~/" or a bare "~" against the home directory. */
function expandTilde(path, home) {
    var text = normalizeOutput(path);
    var base = normalizeOutput(home);

    if (text === "~") {
        return base;
    }
    if (text.indexOf("~/") === 0) {
        return base + text.substring(1);
    }
    return text;
}

/**
 * Resolves the configured download directory to an absolute path.
 *
 * An empty, relative or control-character-tainted value falls back to the XDG
 * Download folder: the engine would otherwise resolve a relative path against
 * plasmashell's working directory, which the user cannot predict.
 */
function resolveDownloadDirectory(configured, home) {
    var base = normalizeOutput(home);
    var fallback = base !== "" ? base + "/Downloads" : "Downloads";
    var text = expandTilde(configured, base);

    if (text === "" || /[\x00-\x1f\x7f]/.test(text) || text.charAt(0) !== "/") {
        return fallback;
    }

    while (text.length > 1 && text.charAt(text.length - 1) === "/") {
        text = text.substring(0, text.length - 1);
    }

    return text;
}

/**
 * The DISPLAY form of the configured download directory, for the download row's tooltip.
 *
 * Resolves through resolveDownloadDirectory() -- so "~/Downloads" expands against home, an
 * empty or relative value falls back to "$HOME/Downloads", trailing slashes are stripped and
 * control characters are refused -- which means a raw "~" can never reach the tooltip.
 *
 * Returns "" while `home` is empty ($HOME not reported yet): the same condition that gates
 * downloadReady, so the tooltip simply shows nothing until the one-shot has answered instead
 * of claiming a directory nobody can compute.
 */
function formatDownloadDirectory(configured, home) {
    if (normalizeOutput(home) === "") {
        return "";
    }

    return resolveDownloadDirectory(configured, home);
}

/**
 * The file:// URL behind the download row's open-folder shortcut.
 *
 * Resolves the configured directory exactly as the command builder does, then builds the URL
 * with every path segment percent-encoded by hand: a global encodeURIComponent() would escape
 * the "/" separators too, and encodeURI() leaves "#" and "?" dangerous (a directory named
 * "My Videos#1" must become My%20Videos%231, not a URL fragment). encodeURIComponent() per
 * segment is ES5, so it runs under the bare engine the tests use.
 *
 * Returns "" while `home` is empty ($HOME not reported yet, the same condition that gates
 * downloadReady) and whenever the resolved path is empty or not absolute, so the caller
 * disables the button instead of opening a bogus URL. The home gate is load-bearing on its
 * own: with no base, a configured "~/Downloads" resolves to a bare "/Downloads", which is
 * absolute but is not a directory anyone can open.
 */
function buildFolderUrl(directory, home) {
    if (normalizeOutput(home) === "") {
        return "";
    }

    var path = resolveDownloadDirectory(directory, home);

    if (path === "" || path.charAt(0) !== "/") {
        return "";
    }

    var segments = path.split("/");
    var encoded = [];
    for (var i = 0; i < segments.length; i += 1) {
        encoded.push(encodeURIComponent(segments[i]));
    }

    return "file://" + encoded.join("/");
}

/*
 * Download cancellation: the pid file.
 *
 * The engine hands out no handle on a running command. `connectedSources = []`
 * disconnects the source without killing the child, and a one-shot delivers exactly one
 * `onNewData`, at process exit, so a download that runs for minutes looks identical to a
 * download that never started. Stopping one therefore needs a SECOND one-shot that
 * signals the process, and that one-shot can only find the process if the first one
 * published its pid -- which is why buildVideoDownloadCommand() now opens with
 * `mkdir -p ... ; echo $$ > ... ; exec yt-dlp`. `exec` is load-bearing there: it
 * replaces the very process the engine spawned, so the pid `$$` wrote IS yt-dlp's pid
 * and a SIGTERM to it kills the download instead of orphaning it behind a shell.
 *
 * The file lives under XDG's state home, ~/.local/state/docker-status, rather than in
 * the download folder: it is widget state, not user content, and a user who points the
 * download at a folder they clean by hand must not have a pid file linger there.
 */

var DOWNLOAD_STATE_DIRECTORY = "/.local/state/docker-status";

/*
 * Both halves of the file name are gated by the same shape rule as JS_RUNTIME_PATTERN,
 * and for the same reason: a stamp or a token carrying whitespace or shell syntax would
 * produce a path the download command cannot write and the stop command cannot read.
 * shellQuote() still wraps every path that reaches a shell, so this is a shape gate that
 * keeps the name sane, never the protection.
 */
var DOWNLOAD_STOP_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * The per-user directory the pid files live in, or "" when there is no home to build it
 * from.
 *
 * The gate deliberately mirrors resolveDownloadDirectory() instead of growing a third
 * copy of the rule: normalizeOutput() does the trimming, and an empty, relative or
 * control-character-tainted home is refused outright. The difference is the answer on
 * refusal -- the download directory has a safe fallback, "where do I find my own pid
 * file" does not, and a wrong guess would make the stop command signal a stranger's
 * process. expandTilde() has nothing to expand here on purpose: $HOME is absolute, and a
 * "~"-bearing home is exactly the not-absolute case this refuses.
 */
function resolveDownloadStopDirectory(home) {
    var base = normalizeOutput(home);

    if (base === "" || base.charAt(0) !== "/" || /[\x00-\x1f\x7f]/.test(base)) {
        return "";
    }

    while (base.length > 1 && base.charAt(base.length - 1) === "/") {
        base = base.substring(0, base.length - 1);
    }

    return base + DOWNLOAD_STATE_DIRECTORY;
}

/**
 * The pid file of ONE download run, or "" when it cannot be resolved.
 *
 * The name carries the widget instance's session stamp AND the run token. The stamp is
 * the part that is easy to think is redundant and is not: a reloaded widget's run-token
 * counter restarts at 0, so a token-only name would collide with a previous instance's
 * still-running download, and STOP would kill that orphan while reporting a success the
 * user never asked for. The stamp makes every instance's file names unique, so the worst
 * a reload can do is leave an orphan no stop command will ever find.
 *
 * `token` is the DOWNLOAD's run token -- the same value buildVideoDownloadCommand()
 * wrote into the name -- not the stop command's own token.
 */
function resolveDownloadStopFile(home, sessionStamp, token) {
    var directory = resolveDownloadStopDirectory(home);

    if (directory === "") {
        return "";
    }

    var stamp = normalizeOutput(sessionStamp);
    var runToken = normalizeOutput(token);

    if (!DOWNLOAD_STOP_NAME_PATTERN.test(stamp) || !DOWNLOAD_STOP_NAME_PATTERN.test(runToken)) {
        return "";
    }

    return directory + "/download-" + stamp + "-" + runToken + ".pid";
}

/**
 * Only a plain executable name or a path is accepted; anything with a space or a shell
 * metacharacter falls back to the plain name. A leading "~/" is expanded against home,
 * because `~/.local/bin/yt-dlp` is exactly where a user-installed yt-dlp lives.
 */
function resolveYtDlpBinary(configured, home) {
    var text = normalizeOutput(configured);

    if (text === "" || !YTDLP_BINARY_PATTERN.test(text)) {
        return YTDLP_DEFAULT_BINARY;
    }

    return expandTilde(text, home);
}

/**
 * Resolves the JavaScript runtime yt-dlp uses for YouTube challenges.
 *
 * Unlike the other resolvers, an empty value is meaningful: it opts out and omits the
 * flag entirely, which is the escape hatch for a yt-dlp old enough to not know
 * `--js-runtimes`. Garbage falls back to the default instead of being trusted.
 */
function resolveJsRuntime(configured) {
    if (configured === undefined || configured === null) {
        return JS_RUNTIME_DEFAULT;
    }

    var text = String(configured).replace(/\r/g, "").trim();

    if (text === "") {
        return "";
    }

    if (!JS_RUNTIME_PATTERN.test(text)) {
        return JS_RUNTIME_DEFAULT;
    }

    return text;
}

/**
 * Builds the one-shot yt-dlp command for the pasted link.
 *
 * `--cookies-from-browser` reads a validated configuration value and falls back to
 * Firefox (COOKIES_BROWSER_DEFAULT) when garbage reaches it; an empty value omits the
 * flag entirely. The browser is a value inside the command, never a command, so quoting
 * is still the protection. `--no-playlist` is deliberate: the YouTube link in the wild
 * carries `&list=` and `&start_radio=1`, and the user pastes it to get THAT video, not a
 * radio mix.
 * `--js-runtimes` is what makes YouTube work at all (see JS_RUNTIME_DEFAULT).
 * `--no-progress` keeps the captured output small; the widget shows a busy indicator
 * instead of a progress bar. The user's own yt-dlp configuration is respected (no
 * --ignore-config), so a PO-token plugin or a format preference still applies.
 *
 * The command now OPENS with the pid hand-off, because a one-shot the engine cannot stop
 * needs a second one-shot to stop it and that one needs a pid:
 *
 *   mkdir -p '<stateDir>' ; echo $$ > '<stopFile>' ; exec 'yt-dlp' ...
 *
 * `exec` is what makes the published pid the right one: it replaces the very process the
 * engine spawned, so `$$` names yt-dlp itself and a SIGTERM to it kills the download.
 * Without `exec` the pid would name a shell that outlives the download, and signalling it
 * would orphan yt-dlp with nobody left to kill it. The separators are ` ; ` on purpose
 * (fail-open): a read-only state directory, or a $HOME that does not exist yet, must
 * degrade to "this download cannot be cancelled" rather than break the download outright,
 * and the stop side reports the missing pid file honestly instead of guessing.
 *
 * `token` keeps its existing meaning -- the run token, appended by withRunToken() so a
 * repeated paste re-runs -- and now serves a second purpose: together with the new
 * `sessionStamp` it NAMES the stop file. That is why a download with no token has nothing
 * to be found by and returns "": the refusal contract below.
 *
 * `token` makes the command a distinct source for the executable engine even when the
 * same URL is pasted twice; it is appended by withRunToken() and must therefore be a
 * command this file built itself.
 */
function buildVideoDownloadCommand(options) {
    var opts = options || {};
    var jsRuntime = resolveJsRuntime(opts.jsRuntime);
    var cookiesBrowser = resolveCookiesBrowser(opts.cookiesBrowser);

    var stopDirectory = resolveDownloadStopDirectory(opts.home);
    var stopFile = resolveDownloadStopFile(opts.home, opts.sessionStamp, opts.token);

    // No home, or a stamp/token that is not a plain name, means no stop file, which means
    // no way to cancel this run. Refusing the command mirrors buildComposeProjectCommand()'s
    // empty-command contract: main.qml refuses "" before it reaches the engine.
    if (stopFile === "") {
        return "";
    }

    var command = "mkdir -p " + shellQuote(stopDirectory)
        + " ; echo $$ > " + shellQuote(stopFile)
        + " ; exec " + shellQuote(resolveYtDlpBinary(opts.binary, opts.home));

    if (cookiesBrowser !== "") {
        command += " --cookies-from-browser " + shellQuote(cookiesBrowser);
    }

    if (jsRuntime !== "") {
        command += " --js-runtimes " + shellQuote(jsRuntime);
    }

    command += " --no-playlist --no-progress"
        + " -P " + shellQuote(resolveDownloadDirectory(opts.directory, opts.home))
        + " -o " + shellQuote(VIDEO_OUTPUT_TEMPLATE)
        + " " + shellQuote(opts.url);

    if (opts.token === undefined || opts.token === null) {
        return command;
    }

    return withRunToken(command, opts.token);
}

/**
 * Extracts the file yt-dlp reported, preferring the merged result over the
 * per-format downloads that live in front of it in the log.
 */
function parseDownloadedFile(output) {
    var text = normalizeOutput(output);

    if (text === "") {
        return "";
    }

    var lines = text.split("\n");
    var found = "";

    for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();

        var destination = /^\[download\]\s+Destination:\s*(.+)$/.exec(line);
        if (destination) {
            found = destination[1].trim();
            continue;
        }

        var merge = /^\[Merger\]\s+Merging formats into\s+"(.+)"$/.exec(line);
        if (merge) {
            found = merge[1].trim();
        }
    }

    return found;
}

/**
 * Picks the line worth showing when a download fails: the last ERROR line if there is
 * one, otherwise the last non-empty line, always bounded so a chatty failure cannot
 * stretch the popup.
 */
function extractErrorLine(output) {
    var text = normalizeOutput(output);

    if (text === "") {
        return "";
    }

    var lines = text.split("\n");
    var last = "";
    var lastError = "";

    for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();
        if (line === "") {
            continue;
        }

        last = line;
        if (line.indexOf("ERROR:") !== -1) {
            lastError = line;
        }
    }

    var chosen = lastError !== "" ? lastError : last;
    if (chosen.length > FEEDBACK_MAX_LENGTH) {
        return chosen.substring(0, FEEDBACK_MAX_LENGTH - 1) + "\u2026";
    }

    return chosen;
}

/*
 * The four outcomes of a stop run, plus the empty string for "this run told us nothing".
 *
 * They travel on STDOUT behind a fixed prefix so that stderr stays the operating system's
 * error channel, and parseDownloadStopResult() is the only thing that reads them.
 * DOWNLOAD_STOP_KILLED_UNSWEPT is the honest half of the pair: "killed" claims the
 * partials are gone, "killed no-sweep" says the process died but the leftovers may still
 * be there, which is what the row must show when there was no id to anchor a sweep on.
 * DOWNLOAD_STOP_UNKNOWN is "" so a run that failed to say anything -- a kill that could
 * not be delivered, a `find` that could not read the directory -- is never mistaken for a
 * clean cancel.
 */
var DOWNLOAD_STOP_MARKER_PREFIX = "docker-status: ";
var DOWNLOAD_STOP_KILLED = "killed";
var DOWNLOAD_STOP_KILLED_UNSWEPT = "killed no-sweep";
var DOWNLOAD_STOP_NOT_RUNNING = "not-running";
var DOWNLOAD_STOP_UNKNOWN = "";

/**
 * Builds the one-shot that cancels ONE running download, or "" when the pid file cannot
 * be resolved (an unusable home, or a stamp/token that is not a plain name).
 *
 * `runToken` locates the pid file -- it is the DOWNLOAD's run token, the same value
 * buildVideoDownloadCommand() folded into the file name. `token` is this stop command's
 * OWN trailing run token, and the two are different numbers on purpose: the engine treats
 * connectedSources as a set, so a second STOP click has to be a distinct source or it
 * would be a no-op.
 *
 * The emitted program, in order:
 *
 *   1. Poll for the run's pid file for about a second (5 x 0.2s), accepting only a pid
 *      that is ALIVE (`kill -0`). The live-pid requirement is the anti-lie guard: a
 *      download that already ended, leaving its pid file behind, must never be reported
 *      as cancelled, and a download that started a moment ago may not have written the
 *      file yet.
 *   2. `kill -TERM` the live pid. A failed kill writes a stderr marker and exits 1
 *      WITHOUT sweeping: the partials of a process that is still running are not ours to
 *      delete.
 *   3. Wait about a second for it to die, then `kill -KILL` if it is still there.
 *   4. `rm -f` the pid file.
 *   5. Run the sweep, but only when the URL resolved an id to anchor on.
 *   6. Print the stdout marker.
 *
 * The sweep is LAST on purpose, so its exit status is the run's: an existing-but-
 * unreadable directory makes `find` fail on stderr and the whole command exit non-zero,
 * which the caller surfaces like any other failed one-shot. A MISSING directory skips the
 * sweep and still exits 0 -- no partial can exist where yt-dlp never created the output
 * folder -- and that case reports the plain "killed" marker.
 *
 * Every interpolated value goes through shellQuote(). Both windows are fixed rather than
 * parameterised: how long a click waits is the behaviour of a click, not a preference.
 */
function buildDownloadStopCommand(options) {
    var opts = options || {};

    var stopFile = resolveDownloadStopFile(opts.home, opts.sessionStamp, opts.runToken);
    if (stopFile === "") {
        return "";
    }

    var quotedStopFile = shellQuote(stopFile);
    var videoId = extractVideoId(opts.url);
    var directory = resolveDownloadDirectory(opts.directory, opts.home);

    var command = "pid=''; n=0"
        + "; while [ \"$n\" -lt 5 ]"
        + "; do if [ -f " + quotedStopFile + " ]"
        + "; then p=$(cat " + quotedStopFile + " 2>/dev/null)"
        + "; case \"$p\" in ''|*[!0-9]*) ;; *) kill -0 \"$p\" 2>/dev/null"
        + " && { pid=\"$p\"; break; } ;; esac; fi"
        + "; sleep 0.2; n=$((n+1)); done";

    command += "; if [ -n \"$pid\" ]"
        + "; then kill -TERM \"$pid\" 2>/dev/null"
        + " || { printf " + shellQuote(DOWNLOAD_STOP_MARKER_PREFIX + "kill failed for pid %s\\n")
        + " \"$pid\" 1>&2; exit 1; }"
        + "; n=0; while [ \"$n\" -lt 5 ]"
        + "; do kill -0 \"$pid\" 2>/dev/null || break; sleep 0.2; n=$((n+1)); done"
        + "; kill -0 \"$pid\" 2>/dev/null && kill -KILL \"$pid\" 2>/dev/null"
        + "; rm -f " + quotedStopFile
        + "; printf " + shellQuote(DOWNLOAD_STOP_MARKER_PREFIX
            + (videoId === "" ? DOWNLOAD_STOP_KILLED_UNSWEPT : DOWNLOAD_STOP_KILLED)
            + "\\n");

    /*
     * The sweep. `[[]` and `[]]` are bracket expressions matching a literal "[" and "]", so
     * the pattern means `* [<id>]*` -- every partial of THIS run carries " [<id>]"
     * immediately before the extension. The directory is one shell-quoted literal,
     * `-maxdepth 1` prevents descent, `-type f` with no `-L` refuses symlinked entries, and
     * no other value reaches the pattern, so the sweep's reach is exactly the download's
     * reach: a configured directory bearing ".." resolves to the same folder yt-dlp wrote
     * into, which is no new reach at all.
     */
    if (videoId !== "") {
        command += "; if [ -d " + shellQuote(directory) + " ]"
            + "; then find " + shellQuote(directory)
            + " -maxdepth 1 -type f \\( -name '*.part' -o -name '*.part-Frag*'"
            + " -o -name '*.ytdl' \\) -name " + shellQuote("* [[]" + videoId + "[]]*")
            + " -delete; fi";
    }

    command += "; else rm -f " + quotedStopFile
        + "; printf " + shellQuote(DOWNLOAD_STOP_MARKER_PREFIX + DOWNLOAD_STOP_NOT_RUNNING + "\\n")
        + "; fi";

    if (opts.token === undefined || opts.token === null) {
        return command;
    }

    return withRunToken(command, opts.token);
}

/**
 * Reads a stop run's outcome out of its stdout, or DOWNLOAD_STOP_UNKNOWN.
 *
 * The FIRST "docker-status: "-prefixed line decides, and it has to match one of the three
 * markers exactly: "killed" and "killed no-sweep" are two different claims, so a line
 * that matches neither -- a future marker this build does not know, or a stderr marker
 * that arrived in the wrong stream -- degrades to "" instead of being read as a clean
 * cancel. stderr is never consulted here; it is the caller's error channel.
 */
function parseDownloadStopResult(rawOutput) {
    var lines = normalizeOutput(rawOutput).split("\n");

    for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();
        if (line.indexOf(DOWNLOAD_STOP_MARKER_PREFIX) !== 0) {
            continue;
        }

        var value = line.substring(DOWNLOAD_STOP_MARKER_PREFIX.length);
        if (value === DOWNLOAD_STOP_KILLED
                || value === DOWNLOAD_STOP_KILLED_UNSWEPT
                || value === DOWNLOAD_STOP_NOT_RUNNING) {
            return value;
        }

        return DOWNLOAD_STOP_UNKNOWN;
    }

    return DOWNLOAD_STOP_UNKNOWN;
}

/*
 * Countdown to extinction.
 *
 * The configured minutes size a LOCAL deadline owned by the widget; the number
 * itself never reaches a shell and is never interpolated into a command. The
 * power-off command is a fixed constant in main.qml and this value is a duration,
 * not a fragment of it. Validation exists so that an unusable value disables the
 * play control with an explanation instead of arming a nonsense countdown.
 */

var SHUTDOWN_MINUTES_DEFAULT = 15;
var SHUTDOWN_MINUTES_MINIMUM = 10;

/**
 * Resolves the configured countdown length to a whole number of minutes strictly
 * greater than SHUTDOWN_MINUTES_MINIMUM, or null when the value cannot be used.
 *
 * undefined/null and an empty string mean "nothing configured" and yield the
 * default rather than an error. Anything that is not a plain run of digits --
 * "abc", "12abc", "12.5", "1e3", " 1 2", "-5", "+15" -- is refused, as is any
 * integer at or below the minimum (0 included). Returning null is what keeps a
 * nonsensical value from arming a countdown: callers disable play instead.
 */
function resolveShutdownMinutes(raw) {
    if (raw === undefined || raw === null) {
        return SHUTDOWN_MINUTES_DEFAULT;
    }

    var text = String(raw).replace(/\r/g, "").trim();

    if (text === "") {
        return SHUTDOWN_MINUTES_DEFAULT;
    }

    if (!/^[0-9]+$/.test(text)) {
        return null;
    }

    var minutes = parseInt(text, 10);
    if (!isFinite(minutes) || minutes <= SHUTDOWN_MINUTES_MINIMUM) {
        return null;
    }

    return minutes;
}

/**
 * Whole seconds left until a millisecond deadline, rounded up and floored at zero.
 * Any input that cannot be used as a timestamp yields 0, so the ticker can never
 * show a negative or garbage countdown.
 */
function shutdownRemainingSeconds(deadlineMs, nowMs) {
    if (deadlineMs === undefined || deadlineMs === null
            || nowMs === undefined || nowMs === null) {
        return 0;
    }

    var deadline = Number(deadlineMs);
    var now = Number(nowMs);

    if (!isFinite(deadline) || !isFinite(now)) {
        return 0;
    }

    var seconds = Math.ceil((deadline - now) / 1000);
    return seconds > 0 ? seconds : 0;
}

/**
 * Renders whole seconds as "M:SS", growing to "H:MM:SS" once the value reaches an
 * hour. Zero, negatives, non-finite values and garbage all render as "0:00".
 * No padStart: this file must run under a bare ES5 engine, so padding is manual.
 */
function formatCountdown(seconds) {
    var total = Number(seconds);
    if (!isFinite(total) || total <= 0) {
        return "0:00";
    }

    total = Math.floor(total);

    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    var secsText = secs < 10 ? "0" + secs : String(secs);

    if (hours > 0) {
        var minutesText = minutes < 10 ? "0" + minutes : String(minutes);
        return hours + ":" + minutesText + ":" + secsText;
    }

    return minutes + ":" + secsText;
}

/*
 * Update check.
 *
 * This is the THIRD sanctioned boundary, and it is a reversal of the project's
 * "no network code" goal that a human approved. The installed widget periodically
 * fetches a machine-readable release manifest from a FIXED GitHub Pages URL,
 * compares it with the version in its own installed metadata.json, and shows one
 * "update available" line. It is deliberately the OPPOSITE of a command-building
 * exception: the command below is assembled ENTIRELY from the fixed constants above
 * it. No configuration value and no user input reaches it, so it mints no new
 * command-building exception alongside the video download -- it is the same class of
 * thing as the fixed daemon commands, just with one extra URL folded in.
 *
 * The one thing that WOULD make this configurable is the URL, and it is deliberately
 * a constant (UPDATE_CHECK_URL): a misconfiguration must not be able to point the
 * widget at another host. It is a fixed https URL, and curl fails silently on any
 * host it cannot reach, so an offline machine is a non-event, not an error.
 *
 * The whole check must fail SILENTLY. A missing curl, a missing metadata.json, an
 * offline machine or an unparseable manifest all collapse to "no update available",
 * never to a word the user has to read. isUpdateAvailable() is the function that must
 * never cry wolf.
 */

var UPDATE_CHECK_URL = "https://dave-r-ui.github.io/docker-status-widget/latest.json";
/*
 * The release page the widget's "an update is available" indicator opens. Fixed
 * for the same reason UPDATE_CHECK_URL is fixed: a misconfiguration must not be
 * able to point the widget at another host, and the human-approved reversal of
 * adr-0013's "not a link" clause (adr-0015) authorises exactly ONE click target
 * -- this constant, the GitHub Pages site root, never a value from
 * configuration and never assembled from parts.
 */
var UPDATE_PAGE_URL = "https://dave-r-ui.github.io/docker-status-widget/";
var UPDATE_CHECK_MAX_TIME_SECONDS = 5;
var UPDATE_CHECK_MARKER = "@dockerstatus-manifest@";
var UPDATE_CHECK_CURL_BINARY = "curl";
var PACKAGE_ID = "io.github.daver-ui.dockerstatus";

/*
 * The shipped metadata.json path, resolved by the shell at run time. Double quotes
 * are literal here on purpose, exactly like main.qml's homeDirectoryCommand: the
 * shell must expand ${XDG_DATA_HOME:-$HOME} itself, so this path must not be
 * shell-quoted -- shellQuote() would freeze the whole thing into a literal file name
 * with no $HOME (and no XDG_DATA_HOME) left to expand.
 */
var INSTALLED_METADATA_PATH = "\"${XDG_DATA_HOME:-$HOME/.local/share}/plasma/plasmoids/" + PACKAGE_ID + "/metadata.json\"";

/*
 * A version is one to three dot-separated numeric segments, each either a bare 0 or a
 * run of digits that does not start with 0. That single shape rule is shared by
 * parseWidgetVersion, parseLatestVersion and compareVersions, which is why a
 * leading-zero segment ("01") or a non-numeric one ("1.a") is refused everywhere at
 * once rather than half-parsed in one place.
 */
var VERSION_PATTERN = /^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$/;

/*
 * metadata.json is scanned as text, not JSON.parse'd: the shipped file is valid JSON,
 * but a half-written or mid-upgrade install might not be, and the widget answers ""
 * (no version) rather than throwing. Only the exact "Version" key is matched; the
 * leading quote is what keeps "X-Plasma-API-Minimum-Version" from matching too.
 */
var WIDGET_VERSION_PATTERN = /"Version"\s*:\s*"([^"]*)"/;

/** True when text is a version string under VERSION_PATTERN; the one shape gate. */
function isVersionString(text) {
    return VERSION_PATTERN.test(text);
}

/**
 * Builds the one-shot update check. It is a FIXED command: cat the installed
 * metadata.json (its own error silenced with 2>/dev/null so a missing file is not
 * noise), print the marker line, then curl the fixed manifest URL. The marker is what
 * lets ONE one-shot deliver both halves of the answer, so the engine's set semantics
 * and the run token only have to be reasoned about once.
 *
 * cat's flags, each deliberate: -f fails on an HTTP status >= 400 (a 404 prints
 * nothing and exits non-zero, which the silent path already absorbs), -s silences the
 * progress meter, -S lets curl's OWN stderr through (the caller ignores it -- there is
 * no error text anywhere in this feature), -L follows GitHub Pages' redirects, and
 * --max-time 5 guarantees the one-shot can never hang the engine. 2>/dev/null guards
 * only the cat, never curl: the point is that curl has nothing worth showing even when
 * it fails.
 *
 * The marker printf carries a LEADING newline ('\n%s\n', not '%s\n') on purpose: it
 * means the marker begins a fresh line whatever the installed metadata.json ended with,
 * so a package whose file lost its trailing newline still splits cleanly instead of
 * fusing its last line with the marker and silently degrading every check.
 *
 * `token` makes the command a distinct source for the executable engine, exactly like
 * buildVideoDownloadCommand(); it is appended by withRunToken() and is safe only
 * because every byte of this command is a fixed constant.
 */
function buildUpdateCheckCommand(options) {
    var opts = options || {};

    var command = "cat " + INSTALLED_METADATA_PATH + " 2>/dev/null"
        + "; printf '\\n%s\\n' " + shellQuote(UPDATE_CHECK_MARKER)
        + "; " + UPDATE_CHECK_CURL_BINARY + " -fsSL --max-time " + UPDATE_CHECK_MAX_TIME_SECONDS
        + " " + shellQuote(UPDATE_CHECK_URL);

    if (opts.token === undefined || opts.token === null) {
        return command;
    }

    return withRunToken(command, opts.token);
}

/**
 * Splits the one-shot's stdout into the installed half and the manifest half at the line
 * that is exactly UPDATE_CHECK_MARKER. When the marker is absent -- cat failed and curl
 * printed nothing -- installed is "" and manifest is the whole normalised text, so the
 * caller's silent path (empty manifest OR empty installed version) fires and shows nothing.
 *
 * The comparison is an exact line match, which is sound because the printf in
 * buildUpdateCheckCommand() prints a LEADING newline before the marker: whatever the
 * installed metadata.json ends with, the marker always begins a fresh line. A manifest
 * cannot forge the marker either -- its lines carry JSON quoting and a comma, so never
 * equal the bare marker -- and only the FIRST marker counts, because the installed half
 * always precedes it.
 *
 * Always returns an object; never throws.
 */
function splitUpdateCheckOutput(rawOutput) {
    var text = normalizeOutput(rawOutput);
    var lines = text.split("\n");

    var markerIndex = -1;
    for (var i = 0; i < lines.length; i += 1) {
        if (lines[i] === UPDATE_CHECK_MARKER) {
            markerIndex = i;
            break;
        }
    }

    if (markerIndex < 0) {
        return { installed: "", manifest: text };
    }

    return {
        installed: normalizeOutput(lines.slice(0, markerIndex).join("\n")),
        manifest: normalizeOutput(lines.slice(markerIndex + 1).join("\n"))
    };
}

/**
 * Extracts the installed version from the shipped metadata.json bytes: the value of
 * "Version", or "" when the key is missing, empty, garbage or not version-shaped. The
 * value is digits and dots only, so there is nothing further to sanitise.
 */
function parseWidgetVersion(rawMetadata) {
    var text = normalizeOutput(rawMetadata);
    var match = WIDGET_VERSION_PATTERN.exec(text);
    if (!match) {
        return "";
    }

    var version = match[1].trim();
    return isVersionString(version) ? version : "";
}

/**
 * Reads the "version" field from the fetched manifest JSON, or "" when the body is not
 * JSON, not an object, carries no string "version", or a version that is not the
 * shared shape. Never throws: null, an array, a number or junk all fail to "".
 */
function parseLatestVersion(rawManifest) {
    var text = normalizeOutput(rawManifest);
    if (text === "") {
        return "";
    }

    var parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return "";
    }

    if (parsed === null || typeof parsed !== "object") {
        return "";
    }

    var version = parsed.version;
    if (typeof version !== "string") {
        return "";
    }

    var trimmed = version.trim();
    return isVersionString(trimmed) ? trimmed : "";
}

/**
 * Compares two version strings segment by segment, numerically: -1 when left is older,
 * 1 when newer, 0 when equal, and null when EITHER side is not a version string (so a
 * caller degrades instead of guessing). A longer run of segments wins when the shared
 * prefix is equal, so 1.2 < 1.2.1. Never localeCompare and never a lexicographic
 * string compare: "0.10" must be greater than "0.9".
 */
function compareVersions(left, right) {
    var leftText = left === undefined || left === null ? "" : String(left).trim();
    var rightText = right === undefined || right === null ? "" : String(right).trim();

    if (!isVersionString(leftText) || !isVersionString(rightText)) {
        return null;
    }

    var leftSegments = leftText.split(".");
    var rightSegments = rightText.split(".");
    var length = Math.max(leftSegments.length, rightSegments.length);

    for (var i = 0; i < length; i += 1) {
        var leftSegment = i < leftSegments.length ? parseInt(leftSegments[i], 10) : 0;
        var rightSegment = i < rightSegments.length ? parseInt(rightSegments[i], 10) : 0;

        if (leftSegment < rightSegment) {
            return -1;
        }
        if (leftSegment > rightSegment) {
            return 1;
        }
    }

    return 0;
}

/**
 * True only when both sides are version strings AND the latest is STRICTLY greater
 * than the installed one. Everything else -- identical versions, a remote version that
 * is lower, garbage on either side -- is false. This is the single place the widget
 * decides "there is an update", and the reason it errs conservative: a false true is a
 * line the user reads that turns out to be wrong.
 */
function isUpdateAvailable(installed, latest) {
    var comparison = compareVersions(installed, latest);
    return comparison !== null && comparison < 0;
}
