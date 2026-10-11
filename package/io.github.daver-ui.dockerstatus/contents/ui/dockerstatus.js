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
