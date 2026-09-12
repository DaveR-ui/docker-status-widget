---
id: installer-slice
category: installer
tags: [slice, generality, installer, cli, packaging]
aliases: [Installer slice, Lifecycle CLI slice]
related: [installer-index, privilege-slice, verification-slice]
version: 1.0
status: active
---

# Installer — Slice Generalities

## What this slice is

The user-facing lifecycle CLI: one Bash script with six commands, each reversible and each safe to
re-run. Its form is a dispatcher over a `case` statement with `set -euo pipefail`, and every path
derived from the script's own directory — so the CLI behaves the same from any working directory. It
is the only part of the project a human invokes directly.

## Boundaries

**In:** install, upgrade and uninstall the plasmoid for the current user; install and remove the polkit
rule; run the test suite; report what is installed; print usage.

**Out:** building anything (there is nothing to build); releasing or packaging for a distribution;
enabling `docker.service` at boot (a system decision, not an install step); the contents of the package
([widget-slice](../widget/widget-slice.md)); the rule itself
([privilege-slice](../privilege/privilege-slice.md)).

## Entry points

- `install.sh` — read `usage()` first for the command surface, then the `case` dispatcher at the
  bottom, then each `cmd_*` function on its own; they do not call one another.
- [../project.md](../project.md) — the Commands table, including the working-directory notes.

## How it works

| Command | What it does | What it touches |
|---|---|---|
| `install` | upgrades when `kpackagetool6 --show` already knows the id, installs otherwise | the user's KPackage store |
| `uninstall` | the exact mirror of `install` | the same store |
| `install-polkit` | copies the rule as `root:root` mode `0644`, then restarts polkit best-effort | `/etc/polkit-1/rules.d/49-docker-status-widget.rules` |
| `remove-polkit` | removes that file and restarts polkit best-effort | the same path |
| `test` | `node --test tests/` | nothing |
| `status` | prints plasmoid, rule and docker-unit state | nothing |

Mechanics worth knowing: `has_kpackagetool()` gates the whole KPackage path, and when `kpackagetool6`
is missing the fallback copies the package into
`${XDG_DATA_HOME:-$HOME/.local/share}/plasma/plasmoids/${PACKAGE_ID}` after `rm -rf` of the target.
`status` prints three sections and tolerates every absence with `|| true`, so it always exits 0. An
unknown command prints usage and exits 2; no argument prints usage and exits 0. The polkit install
prints the `pkcheck` line to run afterwards instead of pretending the restart proved anything.

## Conventions of this slice

- `set -euo pipefail` stays. A partial install must abort loudly rather than half-finish.
- No implicit privilege. `install` never escalates, and only the two polkit commands use `sudo` — with
  the output saying what to verify afterwards.
- Every path derives from `SCRIPT_DIR`. A relative path resolved against the caller's cwd is a bug,
  because the documented usage is `./install.sh` from the repository root.
- Removal mirrors installation exactly. A removal that disagrees with its install path is the classic
  leak, and it is silent.
- Polkit restart failures are tolerated (`|| true`) because a running polkit may pick up rules on its
  own schedule; the verification command is the real check.
- The installer is the only artifact that knows the file layout of the package. The package never
  reaches outward.

## Dependencies

**Upstream:** `bash`, `kpackagetool6` (optional), `systemctl`, `sudo`, `node` for the `test` command,
and the `package/` and `polkit/` trees sitting beside the script.
**Downstream:** nothing depends on it in code. Whether the widget exists on a machine at all is this
slice's entire business.

## Known gaps & accepted debt

- `status` exits 0 whether or not anything is installed, so it cannot serve as a check inside a script.
- Nothing verifies that plasmashell reloaded the widget; the output tells the user to restart it and
  trusts them.
- The plain-copy fallback bypasses KPackage metadata handling and can leave a stale directory behind
  after an upgrade.
- Per-user only: no system-wide install, no uninstall on behalf of another user, no distro packaging,
  and no version pinning beyond what `kpackagetool6 --upgrade` decides.
