---
id: adr-0008-configurable-cookies-browser-and-bottom-text
category: adrs
tags: [adr, video-download, yt-dlp, config, ui]
aliases: [ADR-0008]
related: [adr-index, adr-0006-video-downloader-command-boundary, adr-0007-stop-button-confirmation-and-narrow-grant, status-slice, ui-surfaces, troubleshooting]
version: 1.0
status: active
supersedes: adr-0006-video-downloader-command-boundary
---

# ADR-0008: The cookies browser becomes a validated setting

## Problem

ADR-0006 fixed the browser: the assembled command always passed
`--cookies-from-browser firefox`, and that record explicitly rejected a browser setting as a field "that
can only hold one useful value". The reasoning held while the only supported cookie source was Firefox on
the machine the widget was built on. It stops holding as soon as the cookie source is a property of the
user's session rather than of the widget: a person signed into Chromium, or into a non-default Firefox
profile, had no way to make the download row work short of editing `dockerstatus.js`, and the failure mode
— "Sign in to confirm you're not a bot" — points at the account, not at the flag. A rejected alternative is
itself a decision, so reversing it needs a successor record, not an edit of the original.

The same change adds a second setting that is not a command value at all: the muted line at the bottom of
the widget, which was a hardcoded motto. Unlike the browser, this one never reaches a shell; it is copy,
and copy belongs to the person looking at the widget. The confirmation geometry of the stop button changes
in the same pass, and belongs on the record too so nobody later reads it as a safety mechanism.

## Solution

1. **The browser is a setting, and it stays inside the ADR-0006 boundary.** The value goes through
   `resolveCookiesBrowser()` before a command exists: the `BROWSER[+KEYRING][:PROFILE]` grammar only,
   matched by `^[A-Za-z0-9._+:,-]+$`; garbage falls back to `firefox`; an empty value omits the flag
   entirely. `shellQuote()` still wraps it. Configuration supplies a validated **value inside** a command,
   exactly as before — it still never supplies a command. Every other clause of ADR-0006 (URL validation
   before a command exists, quoting as the protection, no `--ignore-config`, the run token) remains in
   force and is not re-decided here.
2. **The UI reports the value the command will use.** The popup resolves the same setting through the same
   function and shows `Cookies from: <browser>`, or `Cookies: not used` when it is opted out, so the label
   cannot disagree with the command.
3. **The bottom text is a setting with no command reach.** `taglineText` is rendered verbatim by the full
   representation and hides itself when empty. Nothing validates or quotes it, because it is never
   concatenated into a command and never leaves Qt's text rendering. The panel representation stays
   icon-only, so the "only the full surface carries text" rule is not widened.
4. **The stop button gets a fixed narrow width.** Start keeps `Layout.fillWidth: true` and absorbs the
   spare width; stop is pinned to `Kirigami.Units.gridUnit * 7` with `Layout.fillWidth: false`, so the
   destructive action stays visually smaller and the row cannot reflow between "Stop daemon" and
   "Confirm stop". This is geometry, not a safety mechanism: ADR-0007's arming dwell and the interactive
   polkit prompt are unchanged.

## When to use

Read this when changing how the download row reads cookies, when adding a setting whose value is
interpolated into a command, or when deciding whether a display string is configuration or a constant.

## When not to use

As licence to put arbitrary configuration into a command. The accepted value set is closed and validated
per setting; a setting that supplies flags, arguments or a whole command is still forbidden, and a second
command-building exception still needs its own record.

## Examples

- `cookiesBrowser` = `firefox` → `--cookies-from-browser 'firefox'`.
- `cookiesBrowser` = `chrome:Default` → `--cookies-from-browser 'chrome:Default'`.
- `cookiesBrowser` = `firefox; rm -rf ~` → falls back to `--cookies-from-browser 'firefox'`.
- `cookiesBrowser` = `""` → the flag is omitted and the popup reads `Cookies: not used`.
- `taglineText` = `""` → the bottom line is hidden, not left blank.

## Common mistakes

- **Treating the browser setting as an argument channel.** It is validated against a character class and
  quoted; it is not a place to add flags. Use `~/.config/yt-dlp/config` for that.
- **Assuming an empty setting means Firefox.** Empty deliberately means "no cookies", the escape hatch for
  a public video or a machine with no supported browser. The default is Firefox; empty is not.
- **Showing the raw setting instead of the resolved one.** The label reads the resolver's output precisely
  so a typo is visible as the fallback the command will actually use.
- **Documenting the bottom text as state.** It is copy with a default, not a status message; binding it to
  daemon state would put meaning where none exists.
- **Reading the fixed stop width as a safety control.** The confirmation and the interactive prompt are the
  control; the width only stops the row from reflowing.

## References

- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the boundary
  this record amends, on one point only.
- [adr-0007-stop-button-confirmation-and-narrow-grant](adr-0007-stop-button-confirmation-and-narrow-grant.md)
  — the confirmation the width change does not touch.
- [status-slice.md](../status/status-slice.md) — `resolveCookiesBrowser`.
- [ui-surfaces.md](../widget/ui-surfaces.md) — the download row and the bottom line.
- [troubleshooting.md](../verification/troubleshooting.md) — the symptom this setting fixes.
