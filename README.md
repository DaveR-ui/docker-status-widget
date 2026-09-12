# Docker Status — a KDE Plasma 6 widget for the Docker daemon

A panel/desktop widget that shows whether the Docker daemon is running, lets
you start it with one click without a password prompt, and lets you stop it
behind a confirmation — stopping asks for a password, because the privilege
grant is deliberately not widened for it.

Target: **KDE Plasma 6 on Wayland**, developed and verified against
**Plasma 6.7.4 / plasma5support 6.7.4 / polkit 127 on CachyOS**.

---

## What it shows

| Surface | Content |
| --- | --- |
| Panel (compact) | Theme icon (dimmed when stopped) + severity dot |
| Popup / desktop (full) | Daemon state, `running/total` container count, container list, start/stop buttons, refresh button, video-download row |

State is reported honestly in four levels, not two:

| State | Severity | Colour |
| --- | --- | --- |
| `active` | positive | green |
| `inactive` | neutral | orange |
| `failed` | negative | red |
| `unknown` (probe failed) | muted | grey |

`unknown` is deliberately *not* rendered as "stopped": a broken probe must never
look like a healthy reading.

---

## Install

```bash
./install.sh install          # plasmoid, unprivileged, reversible
./install.sh install-polkit   # ONLY if you want the passwordless button (sudo)
./install.sh status           # what is installed right now
./install.sh test             # run the parsing unit tests
```

Then: right-click the panel or desktop → **Add Widgets…** → search
**"Docker Status"**. On the desktop the full widget is shown directly; in the
panel it collapses to the icon+dot and expands into a popup.

Uninstall:

```bash
./install.sh uninstall
./install.sh remove-polkit
```

---

## Two design decisions worth knowing

### 1. Two-tier polling

`systemctl is-active docker` is a few milliseconds and is the only thing polled
unconditionally. `docker ps` is polled **only while the daemon is up**, because
against a dead daemon it blocks on the socket timeout — a widget that polls
`docker ps` every second with the daemon down would hang itself.

Verified: with the daemon simulated down, the container command never executed.

### 2. The `connectedSources` re-run trap

The `executable` data engine treats `connectedSources` as a **set**. Assigning
an identical command string twice is a **no-op** and the command is *not*
re-executed. A naive start button therefore works exactly once: the second click
does nothing, silently.

Measured against plasma5support 6.7.4:

| Action | Events |
| --- | --- |
| `connectedSources = ["echo A"]` | 1 |
| `connectedSources = ["echo A"]` again | **0** |
| `connectedSources = []` then `["echo A"]` | 1 |
| `connectedSources = ["echo A # run1"]` then `["echo A # run2"]` | 1 each |

This widget uses the last approach: `withRunToken()` appends a unique trailing
shell comment so every click is a distinct source.

Because that trick appends a shell comment, **executed commands are fixed
constants in `main.qml`**, with one deliberate exception: the video-download command. It is assembled
in `dockerstatus.js` from a validated URL and validated configuration values, and every interpolated
value is shell-quoted. Configuration never supplies a command, only values inside one — the boundary is
recorded in [ADR-0006](docs/adrs/adr-0006-video-downloader-command-boundary.md). Do not wire other
`command`-style config entries into the engine without changing this mechanism; a second exception
needs its own decision record.

---

## Video downloads

The full representation has a download row: paste a YouTube or X (Twitter) link, press the button, and
`yt-dlp` fetches the video into the configured folder using the cookies from **Firefox** — the browser is
not a setting, it is a fixed constant in the command. The row exists only
in the full representation — the desktop widget or the panel popup — never in the panel icon.

The assembled command is exactly this, with every value single-quoted by `shellQuote()`:

```
'yt-dlp' --cookies-from-browser 'firefox' --js-runtimes '<runtime>' --no-playlist --no-progress -P '<dir>' -o '%(title)s [%(id)s].%(ext)s' '<url>' # plasma-run-N
```

The `--js-runtimes` pair is omitted entirely when that setting is empty. The trailing comment is the
pre-existing `withRunToken()` mechanism that makes a repeated one-shot re-run.

Two flags are deliberate:

- `--no-playlist`: the YouTube links people paste carry `&list=...&start_radio=1`; you want *that*
  video, not the radio mix it belongs to.
- `--no-progress`: keeps the captured output small. The widget shows a busy indicator instead of a
  progress bar.

### Safety model

This is the one place user input reaches a command, and it is bounded on purpose:

- **URL validation before a command exists.** https only; the host must match exactly one of
  `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, `www.youtu.be`,
  `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com`, `mobile.twitter.com`; at most 2048
  characters; once surrounding whitespace is trimmed, refused if it contains inner whitespace, a single
  quote, a double quote, a backtick, a backslash or a control character. A refused link never reaches a
  shell, and the popup says
  "Paste a YouTube or X (Twitter) link first."
- **Quoting is the actual protection.** `shellQuote()` wraps every interpolated value — URL and
  configuration alike — in single quotes and escapes an embedded quote as `'\''`. The unit tests run
  the assembled command through a real `/bin/sh` with a stub `yt-dlp` on `PATH` and assert the argv
  arrives intact.
- **Configuration supplies validated values, never a command.** A bad binary or runtime name falls back
  to its safe default; a relative or control-character download directory falls back to `~/Downloads`.
  The browser is not configurable at all: the cookies come from Firefox.
- **yt-dlp's own configuration still applies.** There is no `--ignore-config`, so
  `~/.config/yt-dlp/config` (a PO-token plugin, a format preference) survives.

The full boundary and the rejected alternatives are recorded in
[ADR-0006](docs/adrs/adr-0006-video-downloader-command-boundary.md).

### Prerequisites

- `yt-dlp` reachable on plasmashell's `PATH`, or an absolute path in the setting. On this machine it
  lives in `~/.local/bin`, which is on plasmashell's environment.
- For YouTube, a JavaScript runtime (`node` or `deno`). Without it, YouTube fails with
  "The page needs to be reloaded".
- Firefox cookies for X/Twitter and for age-gated YouTube. The command always passes
  `--cookies-from-browser firefox`; yt-dlp resolves the profile itself.

### Settings

These four settings are on the widget's config page:

| Setting | Default | Meaning |
| --- | --- | --- |
| Show the download row | on | Hides the row entirely when off. |
| Download folder | `~/Downloads` | Videos are written here; `~/` expands to your home directory. |
| JS runtime | `node` | Passed as `--js-runtimes`; leave empty to omit the flag entirely. |
| yt-dlp binary | `yt-dlp` | Executable name or path; `~/` expands. |

---

## Privilege model

`systemctl start docker` needs root. Three options were on the table:

1. **`pkexec` per click** — works with zero setup, but prompts every time.
2. **`sudoers NOPASSWD`** — coarse: it grants a whole binary, and is not
   auditable per action.
3. **Scoped polkit rule** — chosen. Grants exactly one action id, one unit, one
   verb, from a local active session only.

See `polkit/49-docker-status-widget.rules`. It does **not** grant stop, restart,
disable or mask. To widen it, edit the `ALLOWED_VERBS` array deliberately rather
than replacing the lookup with a wildcard.

Note that `docker.service` is currently `disabled` on this machine: the daemon
does not come back after a reboot. If you would rather the widget not start it,
`systemctl enable --now docker.socket` gives you socket activation instead: the
daemon comes up on demand, and the widget's start button becomes unnecessary.

There **is** a stop button, and it is the only stop path. Stopping the daemon is
destructive to every running container, so the button never fires on one click:
the first click arms a confirmation that expires after five seconds, a
deliberate second click at least half a second later runs `systemctl stop docker`
(an immediate double-click counts as one gesture and does nothing), and a warning
under the row says exactly what is at stake. The stop is deliberately **not**
covered by the polkit grant, so it asks for a password while start stays
passwordless — that asymmetry is the point, not an oversight. There is no stop
entry in the context menu either: a right-click menu is still a one-click surface.
See [ADR-0007](docs/adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md).

---

## Layout

```
package/io.github.daver-ui.dockerstatus/
├── metadata.json                     # KPackageStructure: Plasma/Applet
└── contents/
    ├── config/main.xml               # kcfg entries -> cfg_* aliases
    ├── icons/dockerstatus.svg        # bundled app icon (metadata.json Icon: /icons/dockerstatus.svg)
    └── ui/
        ├── main.qml                  # PlasmoidItem: commands, polling, download wiring, state
        ├── CompactRepresentation.qml # panel icon + severity dot
        ├── FullRepresentation.qml    # popup/desktop: state, list, start/stop buttons, download row
        ├── SeverityDot.qml           # single severity -> colour mapping
        ├── dockerstatus.js           # pure logic incl. download boundary, unit tested in Node
        └── config/ConfigGeneral.qml  # config page (poll, icon, list, download settings)
polkit/49-docker-status-widget.rules
tests/dockerstatus.test.mjs
docs/                                 # documentation corpus — entry point: docs/readme.md
```

Notes on the layout, both learned the hard way:

- The config page lives in `contents/ui/config/`, and `source:` in
  `contents/config/config.qml` is resolved relative to `contents/ui/` — not
  relative to `contents/`.
- `dockerstatus.js` is deliberately free of QML types so it can run under a bare
  JavaScript engine. Keep it that way.

---

## Documentation

The documentation corpus lives in [`docs/`](docs/readme.md). Start at
[`docs/readme.md`](docs/readme.md) for the navigation map, or at
[`docs/project.md`](docs/project.md) for the routing entry point: stack, slices, commands
and symptom lookups.

Two conventions worth knowing before editing it. Every file and folder name under `docs/`
is lower-case, and the corpus is machine-checked — errors block, warnings advise:

```bash
node docs/validate.js          # read-only; exit 1 on errors
node docs/validate.js --write  # regenerate docs/index.md and docs/tag-index.md, then check
```

---

## Verification status

| Layer | How it was verified |
| --- | --- |
| Node unit suite | 58 unit tests (16 before the download feature), `node --test`; the bulk run against the exact shipped `dockerstatus.js`, and the suite also pins the action identities and their exact QML `actionKind` expressions, both fixed privileged commands, and the polkit rule as text plus a default-deny predicate matrix |
| Download command boundary | Unit tests run the assembled command through a real `/bin/sh` with a stub `yt-dlp` on `PATH`; the argv arrives intact, including a real YouTube URL and a quote-injection URL |
| Data engine contract (keys, polling, re-run trap) | Probe QML executed against live plasma5support 6.7.4 |
| Full pipeline against live Docker | Probe harness parsed the real 3-container `catan-lan` stack |
| End-to-end download | Probe: an X link exited 0 and wrote a 10,365,309-byte mp4 (cookies extracted from Firefox); a YouTube `--simulate` run selected format 401+251 via node |
| All QML files | Two binaries measured. The `qmllint` on `PATH` is Qt5 (`qt5-declarative 5.15.19`): exit 0, no output, and a deliberate `property int x: "boom"` probe also exited 0 — syntax-only. `/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.11.2`, the tool matching the Plasma 6 target): exit 0, **0 errors, 66 warnings all `[unqualified]`, 37 infos of which 3 are `[unused-imports]`**, and no `[missing-property]`, `[incompatible-type]`, `[unresolved-type]` or `[import]` diagnostic |
| `main.qml` as a `PlasmoidItem` | **Not executable outside plasmashell** |

That last row is an honest limitation: instantiating `PlasmoidItem` outside a
running plasmashell fails with
`Could not create attached properties object 'PlasmaQuick::PlasmoidAttached'`,
and `Plasmoid.configuration` does not exist there either. The inner pipeline was
verified through an equivalent harness, but the widget wrapper itself — and the
download row it now hosts — is only validated by `qmllint` and review until it runs in a real session.
The `qmllint` claim is narrower than it sounds on this machine: that build exits 0 for syntax errors
only, and a deliberate type-mismatch probe (`property int x: "boom"`) also exited 0. Read it as QML
**syntax** validation, not semantic validation.

The two binaries are not interchangeable. The `qmllint` on `PATH` is Qt5
(`qt5-declarative 5.15.19`), which is why the probe above proves it reports syntax only. The matching
`/usr/lib/qt6/bin/qmllint` (`qt6-declarative 6.11.2`) does report semantics, and it is the relevant
tool for a Plasma 6 target: on all six QML files it produced 0 errors, 66 warnings, every one of them
`[unqualified]`, and 37 infos of which 3 are `[unused-imports]`, with no `[missing-property]`,
`[incompatible-type]`, `[unresolved-type]` or `[import]` diagnostic. Its exit code is still 0 unless
`--max-warnings` is set, so the diagnostic stream — not the exit code — is the evidence.

`tests/dockerstatus.test.mjs` strips the `.pragma library` line before
evaluating, because that directive is QML-specific and not valid JavaScript.
Everything else is the shipped file, byte for byte.

---

## Known edges

- `interval` on the executable engine appears to quantise to roughly 1 second
  regardless of the requested value; polls below ~1s are pointless.
- The widget reads `systemctl is-active` for the daemon and `docker ps` for
  containers. It does not subscribe to `docker events`, so container churn is
  visible at the poll interval, not instantly.
- Only `docker.service` is supported; there is no support for rootless Docker or
  a user-scoped daemon.
- Video downloads need `yt-dlp` on plasmashell's `PATH`. YouTube additionally needs a JavaScript
  runtime (`node` or `deno`); without it, YouTube fails with "The page needs to be reloaded".
- X/Twitter downloads need cookies from a signed-in Firefox profile, and so does age-gated YouTube;
  the command always reads them from Firefox.
- `--no-playlist` is intentional: a YouTube link carrying `&list=...` downloads that video, not the
  radio mix it belongs to.
- The download row exists only in the full representation (desktop widget or panel popup), never in the
  panel icon.
