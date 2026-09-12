---
id: adr-0006-video-downloader-command-boundary
category: adrs
tags: [adr, security, command-boundary, video-download, yt-dlp]
aliases: [ADR-0006]
related: [adr-index, adr-0005-doc-classes-and-body-shape-exceptions, status-slice, widget-slice, data-engine-contract]
version: 1.0
status: superseded
---

# ADR-0006: One validated exception to the fixed-command rule

## Problem

The widget was a read-mostly observer: it ran `systemctl is-active docker`, `docker ps -a ...` and
`systemctl start docker`, and every one of those strings was a fixed constant in `main.qml`. The
run-token mechanism (see [data-engine-contract](../status/data-engine-contract.md)) appends a trailing
shell comment to make a repeated one-shot re-run, and that is safe only for command strings the project
builds itself. The corpus stated the consequence as a rule: commands are fixed constants and are never
taken from configuration.

Then the FULL representation gained a video-download row: the user pastes a YouTube or X (Twitter)
link, presses the download button, and `yt-dlp` fetches the video into a configured folder using the
browser's cookies. The link is genuinely user input, and no command can exist before the paste. The
fixed-command rule as stated would forbid the feature; inventing a quiet exemption would falsify the
rule and leave the safety argument in nobody's memory.

## Solution

One deliberate, narrowly bounded exception, recorded here.

1. **The download row is the only place user input reaches a command.** The Docker probe and start
   commands stay fixed constants. A second exception must arrive as a new ADR, not as an edit of this
   record.
2. **URL validation runs before a command exists.** `classifyVideoUrl()` accepts only an `https` URL
   whose host matches exactly one of `youtube.com`, `www.youtube.com`, `m.youtube.com`,
   `music.youtube.com`, `youtu.be`, `www.youtu.be`, `x.com`, `www.x.com`, `twitter.com`,
   `www.twitter.com`, `mobile.twitter.com`; at most 2048 characters; and, once surrounding whitespace is
   trimmed, it refuses any whitespace inside the value, a single quote, a double quote, a backtick, a
   backslash or a control character. A paste that fails never reaches a shell at all; the popup answers
   "Paste a YouTube or X (Twitter) link first."
3. **Quoting is the actual protection, and it covers everything.** `shellQuote()` wraps every
   interpolated value in single quotes and escapes an embedded single quote as `'\''`, so no value can
   end its own quoting. The assembled command is exactly:

   `'yt-dlp' --cookies-from-browser 'firefox' --js-runtimes '<runtime>' --no-playlist --no-progress -P '<dir>' -o '%(title)s [%(id)s].%(ext)s' '<url>' # plasma-run-N`

   The `--js-runtimes` pair is omitted entirely when the setting is empty. The browser is the literal
   `firefox`, not a placeholder: it is a constant, so no configuration value can reach this flag.
4. **Configuration supplies validated values, never a command.** The binary must match
   `^(~/)?[A-Za-z0-9._/+-]+$` and the runtime `^[A-Za-z0-9._-]+$`. A relative or control-character
   download directory falls back to `<home>/Downloads`. Every invalid value falls back to its safe default
   instead of being trusted. The browser is deliberately not among these values: the cookies live in
   Firefox and always will, so there is nothing to configure and nothing to get wrong.
5. **The widget keeps yt-dlp's own configuration.** There is no `--ignore-config`, so
   `~/.config/yt-dlp/config` still applies: a PO-token plugin or a format preference survives. Note the
   precedence: a flag this row passes explicitly wins over the same flag in that file, which is why the
   browser and the runtime are the two flags where the widget's value, not the user's, is used.
6. **`--no-playlist` and `--no-progress` are deliberate.** The YouTube links people paste carry
   `&list=...&start_radio=1`; the user wants *that* video, not a radio mix. `--no-progress` keeps the
   captured output small, because the widget shows a busy indicator instead of a progress bar.
7. **The trailing run token stays outside user control.** It is appended after every value, the token is
   stripped of CR and LF so it cannot end the comment, and the URL is validated and quoted before it, so
   the comment cannot become injectable text.

Result reporting is part of the contract: exit code `0` gives a positive severity dot and
"Saved to `<path>`" (the path from yt-dlp's `[Merger] Merging formats into "..."`, else the last
`[download] Destination:` line, else a plain "Download finished."); a non-zero exit gives a negative
dot and the last `ERROR:` line, bounded to 240 characters, else the last non-empty line, else a generic
"The download failed (exit code N)."

## When to use

Read this record when changing anything that touches the download row: the URL allow-list, the quoting
helper, the command flags, the four settings, or the download feedback. It is also the reference the
[widget slice](../widget/widget-slice.md) and [status slice](../status/status-slice.md) cite for why a
command is no longer a pure constant.

## When not to use

Do not treat this as permission to assemble other commands from identifiers — a container name (for a
future stop or restart) or a unit name are not on the allow-list, and a second exception is a separate
decision with its own record. Do not edit this record to widen it; supersede it.

## Examples

Files that carry the decision: `dockerstatus.js` carries `classifyVideoUrl`, `shellQuote`, the
`resolve*` helpers, `buildVideoDownloadCommand`, `parseDownloadedFile` and `extractErrorLine`;
`main.qml` carries `downloadVideo()`, `homeSource` and `downloadAction`; `FullRepresentation.qml`
carries the row; `contents/config/main.xml` and `config/ConfigGeneral.qml` carry the four settings.

Evidence: `tests/dockerstatus.test.mjs` runs the assembled command through a real `/bin/sh` with a stub
`yt-dlp` on `PATH` and asserts the argv arrives intact, including the real YouTube URL with its
`&list=` and a quote-injection URL.

## Common mistakes

- **Treated as free-form input.** The URL is not an extra-arguments channel. There is no setting that
  adds flags; a user who needs different yt-dlp behaviour edits `~/.config/yt-dlp/config` — except
  for the flags this row sets explicitly (the browser and the JavaScript runtime), where the widget's
  value wins by command-line precedence.
- **Quoting assumed instead of tested.** Quoting is the protection, and it is unit tested against a
  real shell. Changing `shellQuote` without a test is a regression waiting to happen.
- **Fallbacks silently accepted.** Invalid configuration falls back to a safe default without an error
  message, so a typo looks like a working setting. Accepted debt; the alternative — an unusable broken
  command — is worse.
- **Adding a browser setting back.** Rejected: the cookies live in Firefox, and a settings field that
  can only hold one useful value adds a way to break the download without adding a way to fix it.
  If Firefox ever moved, that would be a code change — and this record is why it would not be an
  accident.
- **Adding `--ignore-config` for "reproducibility".** Rejected on purpose: it would break PO tokens and
  format preferences users already rely on.

## References

- [adr-0005-doc-classes-and-body-shape-exceptions](adr-0005-doc-classes-and-body-shape-exceptions.md)
  — the doc-class contract this record follows.
- [status-slice.md](../status/status-slice.md) — the pure helpers the boundary lives in.
- [widget-slice.md](../widget/widget-slice.md) — the two data sources and the row wiring.
- [data-engine-contract.md](../status/data-engine-contract.md) — the set semantics that make the run
  token necessary.

## Addendum

2026-09-12 — the browser clause of this record is reversed by
[adr-0008-configurable-cookies-browser-and-bottom-text](adr-0008-configurable-cookies-browser-and-bottom-text.md).
`--cookies-from-browser` is no longer the literal `firefox`: the browser is now a validated configuration
value in the `BROWSER[+KEYRING][:PROFILE]` grammar, garbage falls back to `firefox`, and an empty value
omits the flag entirely. Nothing else in this record changes — the download row is still the one sanctioned
exception, the URL is still validated before a command exists, quoting is still the protection, and a
second command-building exception still needs its own ADR.
