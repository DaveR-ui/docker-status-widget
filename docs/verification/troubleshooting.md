---
id: troubleshooting
category: verification
tags: [troubleshooting, symptoms, verification, failures]
aliases: [Troubleshooting, Symptom Write-ups]
related: [verification-index, data-engine-contract, privilege-slice, installer-slice, widget-slice, status-slice]
version: 1.2
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
`qmllint`, preview the representations' render without a session through the harness in `tools/`
([[render-preview]]), and observe the wrapper only inside a real session. The message appears verbatim when an
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

## the widget never says an update is available

**Context:** the widget has been running for a while, the repository advertises a newer version, and the
popup shows no update notice.
**Root cause:** silence is the contract, not a fault. The notice appears only when the fetched manifest's
`version` is *strictly* greater than the widget's own; there is no "up to date" message and no error text
anywhere in the feature, so any of these renders nothing — `updateCheckIntervalHours` is `0` (the check is
disabled); the machine is offline or `curl` is not on plasmashell's `PATH`; the installed `metadata.json`
is absent or unreadable (for example a plain-copy install in a directory plasmashell is not reading); the
manifest fetch returns an empty or non-JSON body; or the remote version is equal to or lower than the
installed one. The comparison is numeric and strictly-greater, so `1.2` and `1.2.0` compare equal and show
nothing.
**Fix:** none is needed while the widget is current. To check on demand, use the "Check for updates" entry
in the widget's right-click menu, and confirm on the config page that the interval is not `0` (default 6
hours). If a newer release genuinely exists and the line still does not appear, confirm plasmashell can
reach the network and has `curl`, then compare the installed version (`./install.sh status`) with the
manifest at `https://dave-r-ui.github.io/docker-status-widget/latest.json`. A stale manifest in a source
checkout is a maintenance fault, not a widget fault: regenerate it with
`node .github/scripts/sync-manifest.mjs --write`. Note that the static version text in `site/index.html` is
hand-maintained and is **not** guarded by `sync-manifest.mjs --check`, which checks the manifest only.
**Reference:** [../adrs/adr-0013-widget-update-check-and-release-site.md](../adrs/adr-0013-widget-update-check-and-release-site.md)
— the reversal, the manifest contract and the silence contract; [status-slice.md](../status/status-slice.md)
— `isUpdateAvailable` and `compareVersions`.

## every container lands in one group and the play/stop buttons are missing

**Context:** the popup shows a single container group, and no compose project carries play/stop controls.
**Root cause:** the daemon answered no `com.docker.compose.project` label for any container, so
`groupContainersByComposeProject()` folded every container into the standalone bucket
(`COMPOSE_PROJECT_STANDALONE`, `""`) — which is emitted last and has no controls by design. That
happens when the containers were not started by Compose (nothing carries the label), or when `docker ps`
is older than the `.Label` template function and the label never resolves. The list degrades to one
standalone group, never to an empty list.
**Fix:** run `docker ps -a --format '{{.Names}}|{{.State}}|{{.Label "com.docker.compose.project"}}'` as
the widget's user. If the third field is empty for a container you know belongs to a stack, the label is
genuinely absent, not the grouping. Upgrade docker only if the template function itself is unsupported.
**Reference:** [../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md](../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md)
— the probe format and the grouping contract; [widget-slice.md](../widget/widget-slice.md) — the grouped
container section.

## the compose play/stop button says a container argument is required

**Context:** clicking a project's play or stop control shows docker's own
`requires at least 1 container argument` on the feedback line.
**Root cause:** the per-group command is
`docker start|stop $(docker ps -aq --filter 'label=com.docker.compose.project=<project>')`. The filter is
re-evaluated at execution time, so a stack that disappeared between the last poll and the click expands to
no arguments and docker exits non-zero with that message. It is surfaced verbatim on purpose, rather than
swallowed.
**Fix:** none is needed beyond the next poll — refresh and the group disappears from the list. If the
group is still shown, confirm the project label is still on its containers with the `docker ps` probe in
the entry above.
**Reference:** [../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md](../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md)
— the label form and the vanished-stack behaviour; [widget-slice.md](../widget/widget-slice.md) — the
per-group controls.

## the Podman Desktop launch was removed (it reported podman-desktop: not found)

**Context:** historically, the popup's Podman Desktop button failed immediately, reporting
`podman-desktop: not found` on its feedback line.
**Root cause:** the default is the PATH name `podman-desktop`, resolved by `resolvePodmanDesktopPath()`.
plasmashell's `PATH` is not the interactive shell's, so an executable outside it was not found — and the
failure appeared at click time, not at load time, because the path was only resolved and run on click.
**Fix:** the launch surface returned as the square button beside the daemon status in the status card
([[adr-0017-podman-launch-button-and-topbar-removal]]), so the failure is visible again on the card's
feedback row, exactly as the removed section reported it. Set "Podman Desktop path" in the widget's options to an
absolute or `~/`-expanded path, for example `~/.local/bin/podman-desktop`, or make the executable
reachable on the session `PATH` (check `systemctl --user show-environment`); clearing the field re-arms
the `podman-desktop` default.
**Reference:** [status-slice.md](../status/status-slice.md) — `resolvePodmanDesktopPath`;
[../adrs/adr-0016-containers-flat-rows-and-podman-section-removal.md](../adrs/adr-0016-containers-flat-rows-and-podman-section-removal.md)
— the removal; [../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md](../adrs/adr-0014-compose-grouping-and-podman-desktop-launch.md)
— the Podman Desktop path boundary.

## the stop button says the download could not be stopped

**Context:** the full representation, a download in flight; pressing STOP ends with a failure line instead
of a clean "cancelled".
**Root cause:** expected behaviour in one specific case. The stop program signals the pid the run wrote
for itself, and it refuses to sweep after a kill that was **not accepted**: when `kill -TERM` returns
non-zero it writes `docker-status: kill failed for pid <N>` to stderr, exits 1 and deletes nothing.
Deleting a partial whose writer could not be signalled is a race against a process the widget failed to
stop, so the widget would rather leave the file than take it
([[adr-0022-download-cancellation-and-partial-cleanup]]). The other honest answer is `killed no-sweep`:
the process died, but there was no video id to anchor a sweep on, so the partial may well still be there.
**Fix:** read it as "not stopped, nothing deleted". Check the writer by hand — `kill -0 <pid>` against the
pid in the run's `~/.local/state/docker-status/download-<sessionStamp>-<runToken>.pid` file — and finish
the job yourself if it survived. Do **not** "fix" this by making the stop sweep unconditionally: the
refusal is the safeguard. If the signal keeps being refused for a process you know is a yt-dlp run, check
whether another tool already reaped it; an exited process answers `not-running` instead.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `buildDownloadStopCommand` and
the stop outcomes `DOWNLOAD_STOP_KILLED`, `DOWNLOAD_STOP_KILLED_UNSWEPT` and `DOWNLOAD_STOP_NOT_RUNNING`.

## the partial file is still in the download folder after cancelling

**Context:** STOP reported a cancel, but `.part` files — or a `*.ytdl` or a `*.part-Frag*` file — are
still in the configured download folder.
**Root cause:** one of five, all deliberate. The cancel answered `killed no-sweep`: the process died but
`extractVideoId()` could not recover an id from the URL, and the widget never sweeps without an anchor.
The kill was refused, so nothing was swept at all (see the sibling symptom above). The partials are not
under the configured directory at all: a user `~/.config/yt-dlp/config` carrying its own `--paths temp:`
writes them somewhere the widget cannot name, and ADR-0006 keeps that file authoritative on purpose. The
configured directory exists but cannot be read, so the `find` fails — the sweep is the last program in the
run on purpose, which makes that failure the run's exit status rather than a silent skip. Or they are
mid-merge `*.fNNN.*` intermediates, which sit outside the suffixes the sweep targets and are kept rather
than risk unrelated media ([[adr-0022-download-cancellation-and-partial-cleanup]]).
**Fix:** look for `*.part`, `*.part-Frag*` and `*.ytdl` beside the finished file first. If the run
reported a clean `killed`, check `~/.config/yt-dlp/config` for a `--paths temp:` line and re-run the
sweep by hand once you are sure no writer is alive; if it reported an error, fix the directory's
permissions and cancel again. The sweep is deliberately narrow: it anchors on the video id, stays at the
configured directory's first level, never follows symlinks, and emits only when the id resolved — so
anything it did not delete was either unnamed or unanchored, not missed.
**Reference:** [status-slice.md](../status/status-slice.md) — `extractVideoId` and the sweep contract;
[the download finished but no file appeared](#the-download-finished-but-no-file-appeared) for the
adjacent case.

## the download notification cannot be dismissed

**Context:** the download row shows a live run (or a result) and there is no X on its right edge.
**Root cause:** two different things, neither a fault. The widget raises **no system notification** — by
design, so there is nothing waiting in the notification area to dismiss
([[adr-0013-widget-update-check-and-release-site]]); the in-widget feedback row *is* the notification.
And on that row the dismiss X is shown **only when no download is in flight**: while a run is live the
right edge carries STOP instead, because an X that silently cancelled-and-deleted would risk the
in-progress download ([[adr-0022-download-cancellation-and-partial-cleanup]]).
**Fix:** wait for the run to end — the X appears with the result — or press STOP and let the stop finish.
The row also cannot be collapsed away while a download is in flight, so a live STOP is always reachable.
**Reference:** [../widget/ui-surfaces.md](../widget/ui-surfaces.md) — the video download row's usage
pattern.

## the stop button refuses to cancel a download that already finished

**Context:** the run ends in the same instant STOP is pressed: the stop answers `not-running`, the run's
own result then lands on the row, and the row keeps it. This is a race, not a click on a settled row — a
row that already shows `Saved to …` (or a failure) has no STOP at all, because the button is
`visible: downloadInFlight` and the very handler that renders the result clears that flag.
**Root cause:** deliberate, and it is the point of the design. The stop program requires a **live** pid in
the run's pid file; a process that already exited answers `not-running`, so the row keeps the download's
own success or failure rather than overwriting it with a cancel it cannot prove. The click is visibly a
no-op — never a false "cancelled" ([[adr-0022-download-cancellation-and-partial-cleanup]]).
**Fix:** none — read the result. The race is inherent: the engine delivers exactly one event per one-shot,
at process exit ([data-engine-contract.md](../status/data-engine-contract.md)), so the stop's own event can
always arrive after the run's. When the stop does catch a live process, it signals the writer first and
sweeps the partials second; when it does not, it changes nothing. The stop side cannot tell the two apart
by itself — its own predicate even accepts a **zombie** pid — which is why the run's outcome is latched and
a `killed` answer arriving after the run closed is discarded ([[adr-0022-download-cancellation-and-partial-cleanup]]).
If instead the run really is still alive and nothing happens, that is the sibling symptom above
([the stop button says the download could not be stopped](#the-stop-button-says-the-download-could-not-be-stopped)):
an unwritable state directory leaves no pid file to find.
**Reference:** [../status/status-slice.md](../status/status-slice.md) — `parseDownloadStopResult` and the
`not-running` outcome.

## the CI qmllint check fails on a clean widget

**Context:** a pull request into `master` fails the `qmllint` status check with
`qmllint error diagnostics: 0; unparseable/unopenable passes: 2`, while `qmllint` on the development
machine reports the corpus clean.
**Root cause:** the runner cannot resolve the five `org.kde.*` modules this corpus imports — and it
installs none of the QtQuick modules it could resolve either. `ubuntu-24.04` (noble) offers candidates for
`qml6-module-qtquick`, `-controls` and `-layouts` (Qt 6.4.2), but the job's install line passes
`--no-install-recommends` and `qt6-declarative-dev-tools` does not pull them, while `org.kde.kirigami`,
`libplasma6`, `qml6-module-org-kde-plasma` and `libkf6plasma5support6` have no candidate at all; so the
linter emits 11 `Failed to import` (eight distinct modules), 253 `was not found` warnings and exits **255**
over a corpus with zero error diagnostics and no parse-failure or `Failed to open file` diagnostic — CI
runs `39055120672` (PR #5) and `38177079659`, same signature. The old gate read the bare exit status as a
defect signal, so it was measuring the runner's package set instead of the code
([[adr-0023-qmllint-gate-contract-correction]]).
**Fix:** the gate now fails a pass on four legs — an `Error:`-severity diagnostic, a parse failure (the
`[syntax]` category **or** the parser's untagged message text `Syntax error` / `Expected token` /
`Unexpected token`, because the runner's Qt 6.4.2 prints parse failures with no category at all), a
`Failed to open file` diagnostic, or a non-zero exit status **from a pass that resolved every import** —
and the whole diagnostic stream is still printed. So if the check still fails, read the stream: a
parse-failure line is a genuine parse error and an `Error:` line a genuine defect; fix those rather than
silencing the job. Do **not** try to install the KDE modules on the runner: no such apt package exists on
`ubuntu-24.04`, which is exactly why the gate is written the way it is. The job is pinned to
`ubuntu-24.04` on purpose — its Qt is what all four legs were measured against, and `ubuntu-latest`
migrates to Ubuntu 26 on 2026-10-19 ([[adr-0023-qmllint-gate-contract-correction]]).
**Reference:** [verification-slice.md](verification-slice.md) — the CI evidence row and the
diagnostic-stream convention;
[../adrs/adr-0023-qmllint-gate-contract-correction.md](../adrs/adr-0023-qmllint-gate-contract-correction.md)
— the measurement and the four legs.
