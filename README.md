# Docker Status

**The two things every developer actually needs, one click away in the panel: a Docker daemon that is
running, and the meme video saved before it disappears.**

A KDE Plasma 6 widget for the Docker daemon. It shows the daemon state at a glance, starts it without a
password prompt, stops it behind a deliberate confirmation, and downloads the YouTube or X link you just
pasted — no terminal, no browser tab, no `sudo` dance.

![The panel popup: daemon state, container count and list, the start/stop row, the download row, and the bottom text](screenshots/widget-popup.png)
![The config page: polling, panel icon, container list, the whole download row, and the bottom text](screenshots/settings-general.png)

## Install

```bash
git clone https://github.com/DaveR-ui/docker-status-widget.git
cd docker-status-widget
./install.sh install          # the widget itself — unprivileged, reversible
./install.sh install-polkit   # optional, sudo: makes "Start daemon" passwordless
./install.sh status           # what is installed, and whether Docker is up
```

Then right-click the panel or the desktop → **Add Widgets…** → search **"Docker Status"**. On the desktop
the full widget is shown directly; in the panel it collapses to the icon and the severity dot and expands
into a popup. If it does not appear, restart plasmashell:

```bash
kquitapp6 plasmashell && kstart plasmashell
```

To take it out again:

```bash
./install.sh uninstall
./install.sh remove-polkit
```

## What it shows

| Surface | Content |
| --- | --- |
| Panel (compact) | Theme icon (dimmed when stopped) + severity dot |
| Popup / desktop (full) | Daemon state, `running/total` container count, container list, start/stop buttons, refresh button, download row, bottom text |

The daemon state is reported in four levels instead of two, so that a probe that fails is never mistaken
for a daemon that is stopped:

| State | Colour | Meaning |
| --- | --- | --- |
| `active` | green | the daemon is running |
| `inactive` | orange | the daemon is stopped |
| `failed` | red | the unit failed |
| `unknown` | grey | the probe could not tell |

## Starting and stopping the daemon

`systemctl start docker` needs root, and this widget wants that to be one click. The rule in
`polkit/49-docker-status-widget.rules` grants exactly one action id, one unit, one verb, from a local
active session only. It does not grant stop, restart, disable or mask.

**Start** is one click, and passwordless once that rule is installed. **Stop** is deliberately different:
stopping the daemon kills every running container, so the first click only arms a confirmation, the
confirmation expires after five seconds, and a second deliberate click — at least half a second later, so
an accidental double-click does nothing — runs `systemctl stop docker`. Stop is not covered by the polkit
rule and asks for your password. There is no stop entry in the context menu either: a right-click menu is
still a one-click surface.

## Downloading a video

Paste a YouTube or X (Twitter) link in the download row and press the button. `yt-dlp` fetches the video
into the configured folder, reading cookies from the configured browser (Firefox by default):

```
'yt-dlp' --cookies-from-browser '<browser>' --js-runtimes '<runtime>' --no-playlist --no-progress -P '<dir>' -o '%(title)s [%(id)s].%(ext)s' '<url>'
```

- Only https links on YouTube and X/Twitter hosts are accepted, and every value in that command is
  single-quoted before a shell ever sees it.
- `--no-playlist` is deliberate: a link carrying `&list=...&start_radio=1` downloads that video, not the
  radio mix it belongs to.
- Leave the browser setting empty to send no cookies at all; the `--cookies-from-browser` flag is then
  omitted entirely.
- yt-dlp's own `~/.config/yt-dlp/config` still applies, so a PO-token plugin or a format preference
  survives.

What it needs: `yt-dlp` reachable on plasmashell's `PATH` (or an absolute path in the setting), a
JavaScript runtime such as `node` or `deno` for YouTube, and cookies from a signed-in browser profile for
X/Twitter and for age-gated YouTube. The row lives in the full representation only — the desktop widget or
the panel popup — never in the panel icon.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Poll interval (seconds) | `3` | How often the daemon state is re-read from systemd. |
| Panel icon | `folder-docker-symbolic` | Any icon name from the active theme. |
| List containers in the popup | on | Turns the container list off without hiding the count. |
| Show the download row | on | Hides the row entirely when off. |
| Download folder | `~/Downloads` | Videos are written here; `~/` expands to your home directory. |
| JS runtime | `node` | Passed as `--js-runtimes`; leave empty to omit the flag. |
| yt-dlp binary | `yt-dlp` | Executable name or path; `~/` expands. |
| Cookies browser | `firefox` | Passed as `--cookies-from-browser`; accepts yt-dlp syntax such as `chrome:Default` or `firefox+gnomekeyring`. |
| Bottom text | `Persiguiendo la singularidad` | Muted text at the bottom of the widget. Leave empty to hide it. |

## Requirements

- KDE Plasma 6 on Wayland, developed on Plasma 6.7.4 / plasma5support 6.7.4 / polkit 127 (CachyOS).
- Docker with `docker.service`. Only that unit is supported: no rootless Docker and no user-scoped daemon.
- For downloads, the optional extras listed above: `yt-dlp`, a JavaScript runtime for YouTube, and a
  signed-in browser profile for cookies.

## License

MIT — see [LICENSE](LICENSE).
