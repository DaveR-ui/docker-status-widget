---
id: troubleshooting
category: verification
tags: [troubleshooting, symptoms, verification, failures]
aliases: [Troubleshooting, Symptom Write-ups]
related: [verification-index, data-engine-contract, privilege-slice, installer-slice, widget-slice, status-slice]
version: 1.0
status: active
---

# Verification Troubleshooting — Quick Ref

Each heading below **is** the symptom string: it is the grep target, and it is what
`project.md`'s Common Lookups routes to. The routing table points here; the write-up lives here and
nowhere else.

## The Start daemon button does nothing on the second click

**Context:** any session; the button worked once.
**Root cause:** the `executable` engine treats `connectedSources` as a set, so assigning an identical
command string is a no-op and the command is not re-executed. Fixed in `main.qml` by routing every
one-shot assignment through `withRunToken()`, which appends a unique trailing shell comment.
**Fix:** confirm the assignment still goes through `withRunToken()`. If the command-building code was
touched, restore it — a token that repeats will silently do nothing, with no error anywhere.
**Reference:** [data-engine-contract.md](../status/data-engine-contract.md) — the mode differences and
the measured event counts.

## The start button asks for a password every time

**Context:** the daemon starts, but only after polkit prompts.
**Root cause:** the rule is not installed, or the subject fails one of its five gates — not a member of
`wheel`, or not a local active session. All five must pass for `YES`.
**Fix:** run `./install.sh install-polkit`, then confirm with `./install.sh status` that the rule is in
place and verify the gates with the `pkcheck` line the install prints. A remote or SSH session will
always prompt, by design.
**Reference:** [privilege-slice.md](../privilege/privilege-slice.md) — the gate table.

## the stop button asks for a password

**Context:** the stop is requested, and polkit asks for the user's password. This is expected behaviour,
not a fault.
**Root cause:** the polkit grant is deliberately not widened for stop. `ALLOWED_VERBS` holds exactly
`"start"`, so a stop fails that gate, falls through to polkit's normal authentication agent, and prompts.
Starting stays passwordless on the same machine under the same rule; the asymmetry between the benign
action and the destructive one is the design
([[adr-0007-stop-button-confirmation-and-narrow-grant]]).
**Fix:** none is needed — enter the password, or cancel and leave the daemon running. Do **not** "fix"
the prompt by adding `"stop"` to `ALLOWED_VERBS`: that is a security decision, not a configuration
change, and it removes the only real gate on a destructive verb. If no prompt appears at all and the
widget reports a failure instead, no polkit authentication agent is running in the session.
**Reference:** [privilege-slice.md](../privilege/privilege-slice.md) — the gate table and why only `start`
is supported.

## the stop button needs two clicks

**Context:** the first click on the stop button does not stop the daemon; it relabels the button to
`Confirm stop` and shows a warning under the row.
**Root cause:** the confirmation is deliberate. Stopping is destructive to every running container, so
`requestStop()` only arms on the first click; the second click confirms and emits `stopRequested()`. The
arming expires after five seconds (`stopArmTimer`), so a button armed earlier and forgotten cannot be
completed by a later, unrelated click. A click arriving sooner than half a second after the arming
(`stopConfirmMinDwellMs`) is treated as the tail of the same physical gesture and does not confirm, so a
double-click cannot stop the daemon on its own.
**Fix:** none — click again after half a second and within five seconds to confirm, or wait for the expiry
to cancel. If the second click did nothing, it was most likely too soon: a click inside the half-second
dwell is read as part of the arming gesture, so it neither confirms nor disarms nor reports anything —
wait out the dwell and click again. The other two causes are that the daemon was no longer running or
another action was in flight; both of those disarm the confirmation on purpose.
**Reference:** [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the action row's usage pattern.

## The widget shows a grey dot instead of a stopped daemon

**Context:** the panel icon is dimmed and the dot is grey rather than orange.
**Root cause:** grey is the `muted` severity, which corresponds to the `unknown` state.
`parseDaemonState` returns `unknown` for anything outside the recognised words — empty stdout, a
stripped `PATH`, or a probe that failed outright.
**Fix:** run `systemctl is-active docker` in a shell to see what the probe sees. `unknown` is
deliberate: a broken probe must never be rendered as "stopped". Do not "fix" it by mapping the default
branch to `inactive`.
**Reference:** [status-slice.md](../status/status-slice.md) — the default arms of the parsers.

## The container list is empty while the daemon is running

**Context:** the popup shows the daemon as running and reports no containers.
**Root cause:** one of four things — the container list is switched off in settings; there are genuinely
no containers and the badge reads `0/0`; `docker ps` fails for the widget's user because it cannot reach
the docker socket; or the list was dropped when the daemon briefly went down and the container source
has not reconnected.
**Fix:** check the settings toggle first, then run `docker ps -a --format '{{.Names}}|{{.State}}'` as
the same user. Confirm the daemon state is `active` and not `unknown`: the container source only
connects while the daemon is up.
**Reference:** [widget-slice.md](../widget/widget-slice.md) — the source table.

## Docker Status does not appear in Add Widgets

**Context:** right after an install, or after a Plasma upgrade.
**Root cause:** plasmashell caches its widget list, and the installed package id must be
`io.github.daver-ui.dockerstatus`. A fallback plain-copy install can also land in a directory plasmashell is
not reading.
**Fix:** run `./install.sh status` to confirm `kpackagetool6` knows the package, then restart
plasmashell (`kquitapp6 plasmashell && kstart plasmashell`). With the fallback path, confirm the folder
name matches the package id exactly.
**Reference:** [installer-slice.md](../installer/installer-slice.md) — the install mechanics.

## Could not create attached properties object 'PlasmaQuick::PlasmoidAttached'

**Context:** any attempt to instantiate `main.qml` outside a running plasmashell.
**Root cause:** `PlasmoidItem` and `Plasmoid.configuration` only exist inside plasmashell. There is no
supported way to instantiate the wrapper from a bare QML runtime; this is a documented limitation of the
project, not a bug waiting to be fixed.
**Fix:** test the inner pipeline through the pure module with the Node harness, validate QML files with
`qmllint`, and observe the wrapper only inside a real session. The message appears verbatim when an
attach-based object is created outside Plasma.
**Reference:** [verification-slice.md](verification-slice.md) — the evidence layers and their limits.

## Docker does not come back after a reboot

**Context:** after every restart, the widget reports an inactive daemon.
**Root cause:** `docker.service` is `disabled` on the reference machine (a dated environment
observation recorded in the project README, not a property of this project), so nothing starts it at
boot. Check the current state with `./install.sh status`, which prints `is-enabled`.
The widget can start it on demand and stop it behind a confirmation, but it cannot make the unit persist
across reboots.
**Fix:** decide deliberately. `sudo systemctl enable docker.service` starts it at boot;
`systemctl enable --now docker.socket` gives socket activation instead: the daemon comes up on demand, so
the widget's start button becomes unnecessary — although the widget is not read-only, because the stop
button remains ([ADR-0007](../adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md)). Check the
current state with `./install.sh status`, which prints both `is-active` and `is-enabled`.
**Reference:** [../adrs/adr-0004-scoped-polkit-grant.md](../adrs/adr-0004-scoped-polkit-grant.md) —
what the grant does and does not make persistent.

## the download row is missing or its button is greyed out

**Context:** the full representation, after enabling the video downloader or pasting a link.
**Root cause:** three different gates. The row is hidden when `showVideoDownloader` is off; the button is
disabled while a download is in flight, while the paste field is empty, or until the one-shot
`homeSource` has reported `$HOME`. A URL that is not an allow-listed `https` link does **not** disable
the button — a click reports why it was refused instead.
**Fix:** check the "Show the download row in the popup" setting, then confirm the installed package is
version 0.2.0 or later (`./install.sh status`), because the row does not exist before that. If the row
is present and the field has text but the button stays grey, the running widget has no `$HOME` yet;
restarting plasmashell re-runs `homeSource`.
**Reference:** [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the video download row entry.

## YouTube fails with The page needs to be reloaded

**Context:** a YouTube URL; X downloads work.
**Root cause:** yt-dlp needs a JavaScript runtime to solve YouTube's signature and `n` challenges.
Without one, the download fails with `The page needs to be reloaded` after `Signature solving failed` /
`n challenge solving failed` warnings. yt-dlp 2026.08.19 on this machine needs `node` (or `deno`).
**Fix:** keep the "JS runtime" setting non-empty (`node` is the default). The flag is omitted from the
command only when the setting is deliberately cleared. If the runtime is not installed, install it or
name one yt-dlp can find; X downloads do not use it at all.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `resolveJsRuntime` and the
`--js-runtimes` flag.

## yt-dlp: not found

**Context:** any download; the popup reports the failure quickly.
**Root cause:** the assembled command starts with `'yt-dlp'`, and plasmashell's `PATH` is not the
interactive shell's. A `yt-dlp` installed in `~/.local/bin` only works if that directory is on
plasmashell's environment (check `systemctl --user show-environment`).
**Fix:** set the "yt-dlp binary" setting to an absolute or `~/`-expanded path, for example
`~/.local/bin/yt-dlp`, or make the binary reachable on the session `PATH`. The setting accepts a plain
name or a path and falls back to `yt-dlp` when the value looks shell-shaped.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `resolveYtDlpBinary`.

## Sign in to confirm you're not a bot

**Context:** a YouTube URL (often age-gated or after many automated requests), or an X link.
**Root cause:** the download has no usable cookies, so yt-dlp cannot prove it is a logged-in browser.
The command passes `--cookies-from-browser <your setting>` (default `firefox`), the profile is read for
the user running plasmashell, and an empty setting omits the flag entirely — which produces this error
for anything that needs a session.
**Fix:** set the "cookies browser" setting on the widget's config page to the browser you are signed in
to — yt-dlp syntax is accepted (`chrome:Default`, `firefox+gnomekeyring`, `chromium::Personal`) — or
sign in there and confirm the profile belongs to the user running plasmashell. A profile can live
outside the default location (for example `~/.config/mozilla/firefox/` on this machine); yt-dlp resolves
the browser's own profile list. The widget's explicit flag wins over the same flag in
`~/.config/yt-dlp/config` by command-line precedence, so changing it here is what takes effect.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `resolveCookiesBrowser`.

## the cookies browser setting shows brave after opening the options

**Context:** the widget's options are opened, or applied, and "Cookies browser" reads `brave` — the first
item of the list — whatever was configured before. Downloads then use a browser the user did not choose,
or fail with "Sign in to confirm you're not a bot".
**Root cause:** `cfg_cookiesBrowser` used to be an alias to the combo's `editText`. Plasma hands the stored
value to the page as an initial property, and that write arrives before the combo initialises: the combo's
own startup then adopts index 0 and rewrites `editText` to `brave`, and its `Component.onCompleted` runs
only after that. Because Plasma reads `cfg_<entryName>` back when the page is applied, opening the options
and accepting them wrote `brave` over the configured browser. Order measured on Qt 6.11.2 against the
shipped file, with the stored value passed the way `AppletConfiguration.qml` passes it.
**Fix:** keep `cfg_cookiesBrowser` a plain string property and seed the combo in its own
`Component.onCompleted` — `currentIndex` first, then `editText`, so a free-form value such as
`chrome:Default` survives an index of -1 — with the `onEditTextChanged` push-back muted behind
`cookiesBrowser.seeded`. An unmuted handler writes the combo's startup value into the setting on the way in,
which is the same bug from the other side. `config/ConfigGeneral.qml` carries the arrangement, and the Node
suite pins it as text.
**Reference:** [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the ConfigGeneral Interface section;
[../adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md](../adrs/adr-0008-configurable-cookies-browser-and-bottom-text.md)
— the setting's accepted grammar and validation.

## the download finished but no file appeared

**Context:** the popup reports a positive result, but the folder being inspected is unchanged.
**Root cause:** three candidates — the "Download folder" setting resolves to a different directory than
the one inspected (a relative value silently falls back to `<home>/Downloads`); the directory is not
writable by the user plasmashell runs as; or the file landed under a `%(title)s [%(id)s].%(ext)s` name
that does not match the searched text.
**Fix:** read the path in the "Saved to …" message — it is the path yt-dlp reported, not a guess — and
open that directory. If no path was reported, search the configured folder for `[<video-id>]`. Confirm
the setting is absolute or starts with `~/`, and that the user can write there.
**Reference:** [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the download row's result
feedback.

## the shutdown play button stays disabled

**Context:** the full representation, in the "Countdown to Extinction" section, after typing a value into
its inline "Minutes until power-off" field (or after setting the countdown on the config page).
**Root cause:** the value shown could not arm a countdown, so `resolveShutdownMinutes()` returned `null`
and the play button is disabled on purpose. That happens for anything that is not a plain run of digits —
`abc`, `12abc`, `12.5`, `1e3`, ` 1 2`, `-5`, `+15` — and for any whole number at or below 10 (`10`, `0`,
`1`). An empty or absent value is **not** a failure: it resolves to the default 15.
**Fix:** type a whole number greater than 10 into the inline "Minutes until power-off" field, or set
"Shutdown countdown (minutes)" (the `shutdownCountdownMinutes` kcfg entry) on the config page to the same.
The popup shows "Enter a whole number of minutes greater than 10." under the field while the value is
unusable, so the button is not silently dead; a valid edit persists through `main.qml` immediately, and an
invalid one is never persisted.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `resolveShutdownMinutes`;
[../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the shutdown section;
[../adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md](../adrs/adr-0010-inline-shutdown-minutes-in-the-representation.md)
— the inline field and the single-writer rule.

## the machine powers off without asking for a password

**Context:** the countdown expires and the machine powers off; no polkit prompt appears.
**Root cause:** expected behaviour, not a fault. The widget adds no polkit rule and does not widen the
docker grant (`ALLOWED_VERBS` is untouched, still exactly `["start"]`). The power-off is a logind action,
and `/usr/share/polkit-1/actions/org.freedesktop.login1.policy` gives
`org.freedesktop.login1.power-off` the defaults `allow_any=auth_admin_keep`,
`allow_inactive=auth_admin_keep`, `allow_active=yes` (`power-off-multiple-sessions` is likewise
`allow_active=yes`), so a local active session is authorised without authentication — the `pkcheck` probe
for `org.freedesktop.login1.power-off` exits 0 without interaction. Unlike
`systemctl stop docker`, the power-off does not prompt
([[adr-0009-widget-owned-shutdown-countdown]]).
**Fix:** none is needed. The safeguards are the deliberate activation, the more-than-10-minute countdown,
the live visible countdown and the `Cancel` button ([[adr-0009-widget-owned-shutdown-countdown]]). Do
**not** "fix" the absent prompt by widening `ALLOWED_VERBS` or adding a rule: the power-off is a logind
action, not a systemd `manage-units` verb, so a rule would not create a password gate — it would only
weaken the docker grant. Changing logind's default is a system-policy edit, outside this widget.
**Reference:** [privilege-slice.md](../privilege/privilege-slice.md) — why the power-off is outside the
grant and does not prompt.
