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
 * Parses `docker ps -a --format '{{.Names}}|{{.State}}'` output.
 * Malformed lines are skipped instead of producing half-built entries.
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

        var separator = line.indexOf("|");
        if (separator < 0) {
            continue;
        }

        var name = line.substring(0, separator).trim();
        var state = line.substring(separator + 1).trim();
        if (name === "" || state === "") {
            continue;
        }

        containers.push({ name: name, state: state });
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
 * `token` makes the command a distinct source for the executable engine even when the
 * same URL is pasted twice; it is appended by withRunToken() and must therefore be a
 * command this file built itself.
 */
function buildVideoDownloadCommand(options) {
    var opts = options || {};
    var jsRuntime = resolveJsRuntime(opts.jsRuntime);
    var cookiesBrowser = resolveCookiesBrowser(opts.cookiesBrowser);

    var command = shellQuote(resolveYtDlpBinary(opts.binary, opts.home));

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
