---
id: adr-0014-compose-grouping-and-podman-desktop-launch
category: adrs
tags: [adr, security, command-boundary, compose, podman]
aliases: [ADR-0014]
related: [adr-index, adr-0006-video-downloader-command-boundary, adr-0007-stop-button-confirmation-and-narrow-grant, adr-0004-scoped-polkit-grant, status-slice, widget-slice, data-engine-contract]
version: 1.0
status: active
---

# ADR-0014: Compose grouping, per-project start/stop and a configurable Podman Desktop path

## Problem

The widget runs `systemctl is-active docker`, `docker ps -a ...`, `systemctl start docker`,
`systemctl stop docker` and `systemctl poweroff` as fixed constants in `main.qml`, with one sanctioned
exception: the video-download row ([ADR-0006](adr-0006-video-downloader-command-boundary.md)). It lists
containers as one flat list and can mutate nothing at the container level.

The human operator asked for three things that break that shape: containers grouped by Docker Compose
project; a play and a stop control per project that start and stop that whole stack, styled with the
same +/- collapsible affordance the other sections already use; and a button that opens Podman Desktop,
with an options setting that changes its path for a machine where it is not in the default location.

Two consequences have to be settled before any code exists, because both contradict the recorded rule:

1. Per-group play/stop is a NEW `docker` mutation — the widget has never run a `docker start` or a
   `docker stop`.
2. The Podman Desktop path is a configured value that IS the command. ADR-0006's rule — configuration
   never supplies a command, only values inside one — is contradicted, so a quiet exemption would
   falsify the rule and leave the safety argument in nobody's memory.

## Solution

One deliberate, narrowly bounded successor boundary, recorded here. This is the second exception
[ADR-0006](adr-0006-video-downloader-command-boundary.md) reserved: its "When not to use" names a
container name "for a future stop or restart" as *not* on its allow-list and states that a second
exception is a separate decision with its own record — this is that record. ADR-0006 is not edited and
not superseded; its rule is extended, not reversed, and its own text still governs the video-download
row.

1. **The probe carries the grouping identity.** `containerListCommand` becomes
   `docker ps -a --format '{{.Names}}|{{.State}}|{{.Label "com.docker.compose.project"}}'`.
   `parseContainers()` keeps its shape — name up to the FIRST `|`, state up to the second, the whole
   remainder is the project — and emits `{name, state, project}`. A two-field line still parses, with an
   empty project, so the tolerant-skip rules are unchanged and a docker that does not answer the label
   degrades to one flat standalone group instead of to nothing.
2. **Containers group by that label; the standalone bucket is a group like any other.**
   `groupContainersByComposeProject()` returns `[{project, containers}]` in first-seen order, with the
   no-project bucket (`COMPOSE_PROJECT_STANDALONE`, the empty string) last and only when it is not
   empty. Containers with no compose project therefore never disappear, and a machine with none
   produces exactly one group.
3. **Per-group play/stop acts on the label, not on a compose file.** The command is
   `docker start|stop $(docker ps -aq --filter 'label=com.docker.compose.project=<project>')`. The
   alternative — `docker compose -p <project> start|stop` — was rejected on evidence: it needs the
   stack's compose file, and the widget cannot know the working directory the stack was started from;
   `docker compose ls` reports a config-file path, but resolving one at click time is a second
   dependency on a plugin the widget does not otherwise use. The label-filtered form needs no file,
   re-resolves membership at execution time, and is a no-op for containers already in the target state
   — which is exactly what a partially-running stack means. A stack that vanished between the last poll
   and the click makes docker exit non-zero with `requires at least 1 argument`, which the feedback line
   surfaces verbatim rather than swallowing.
4. **The project name is quoted, and quoting is tested through a real shell.** It is interpolated into
   exactly one shell-quoted argument (`shellQuote("label=com.docker.compose.project=" + project)`).
   Compose project names are `[a-z0-9][a-z0-9_-]*` in practice, but a container can carry any label, so
   quoting is the protection rather than the naming rule. `buildComposeProjectCommand()` returns an
   empty string for the standalone bucket and for an action that is neither `COMPOSE_ACTION_START` nor
   `COMPOSE_ACTION_STOP`, so no caller can build a command from an unvalidated choice; `main.qml`
   refuses an empty command before it reaches the engine.
5. **The Podman Desktop path follows the yt-dlp binary rule, not a new one.**
   `resolvePodmanDesktopPath()` accepts a plain executable name or a path matching
   `^(~/)?[A-Za-z0-9._/+-]+$`, expands a leading `~/` against the probed home directory, and falls back
   to `podman-desktop` for an empty or malformed value — the same contract as `resolveYtDlpBinary()`,
   for the same reason: the default is a PATH name, so the widget works where the executable is
   installed normally, and the setting is the escape hatch for a machine where it is not. The assembled
   command is the quoted path plus the run token and nothing else: no flag channel, no free-form
   arguments, no URL. Clearing the setting does not hide the button; it re-arms the default, exactly
   like the yt-dlp binary field.
6. **Both new mutations are unprivileged.** They run as the logged-in user against that user's own
   docker socket and that user's own session. No polkit rule is added and `ALLOWED_VERBS` stays
   `["start"]` ([ADR-0004](adr-0004-scoped-polkit-grant.md),
   [ADR-0007](adr-0007-stop-button-confirmation-and-narrow-grant.md)): the daemon start keeps its
   passwordless grant, the daemon stop keeps its interactive prompt, and the container-level actions
   need neither.
7. **The trailing run token stays outside user control** — appended after every value, stripped of CR
   and LF, with every value validated and quoted before it. The same argument ADR-0006 makes, unchanged.

## When to use

Read this record when touching the compose probe format, `parseContainers()`,
`groupContainersByComposeProject()`, the two command builders, the per-group play/stop surfaces, the
Podman Desktop path setting, or any of their tests. It is the reference that says why a `docker`
command is no longer a pure constant and why that did not widen the polkit grant.

## When not to use

This is not permission to assemble other commands from identifiers. There is still no free-form
argument channel, no way to add flags, no `docker exec`, no restart or remove action, and no second
Podman path: one setting, one validated shape, one default. Do not edit this record to widen it —
supersede it. The daemon's start/stop asymmetry
([ADR-0007](adr-0007-stop-button-confirmation-and-narrow-grant.md)) is untouched: the per-group stop is
a container-level action for the user's own containers, not a privileged unit action, and it is
deliberately NOT the same thing as `systemctl stop docker`.

## Examples

Files that carry the decision: `dockerstatus.js` carries `COMPOSE_PROJECT_STANDALONE`,
`COMPOSE_ACTION_START`, `COMPOSE_ACTION_STOP`, `PODMAN_DESKTOP_DEFAULT`, the extended `parseContainers`,
`groupContainersByComposeProject`, `resolvePodmanDesktopPath`, `buildComposeProjectCommand` and
`buildPodmanDesktopCommand`; `main.qml` carries the labelled `containerListCommand`, the `composeAction`
and `podmanLaunch` one-shot sources and their handlers; `FullRepresentation.qml` carries the grouped
collapsible list, the per-group controls, the Podman Desktop section and the `podmanDesktopPath` kcfg
entry (`contents/config/main.xml`, `config/ConfigGeneral.qml`).

Probe evidence measured on the reference machine (docker 29.9.0, one compose stack and four
containers):

- `docker ps -a --format '{{.Names}}|{{.State}}|{{.Label "com.docker.compose.project"}}'` answers
  `odysseus-odysseus-1|exited|odysseus`, `odysseus-searxng-1|exited|odysseus`,
  `odysseus-chromadb-1|exited|odysseus`, `odysseus-ntfy-1|exited|odysseus`.
- `docker ps -aq --filter 'label=com.docker.compose.project=odysseus'` answers the four container ids; a
  project that does not exist answers nothing, and `docker start` with no arguments then exits 1 with
  `requires at least 1 container argument`.
- `docker compose ls` names the stack `odysseus` with its config file at a path outside the widget's
  working directory — the reason the label form was chosen.
- `podman-desktop` resolves to `/usr/bin/podman-desktop` on the reference machine, which is why the
  default is a PATH name and not an absolute path.
- `tests/dockerstatus.test.mjs` runs both assembled commands through a real `/bin/sh` with a stub
  `docker` on `PATH` and asserts the argument vector arrives intact, including a project name carrying
  shell metacharacters.

Ids minted: `adr-0014-compose-grouping-and-podman-desktop-launch` (this record).

## Common mistakes

- **Reading the grouping as a restyle.** It is a new data dependency: the probe format is part of the
  contract, and a docker that does not answer the label degrades to one flat standalone group, never to
  an empty list.
- **Reaching for `docker compose -p`.** It needs the compose file the widget does not have; the label
  filter is the whole point.
- **Treating the Podman path as free-form input.** It is a validated executable name or path, quoted,
  with exactly one default. A settings field that can hold a command line is what ADR-0006 exists to
  prevent.
- **Assuming the per-group stop is protected like the daemon stop.** The daemon stop prompts because
  polkit is deliberately not widened (ADR-0007); these actions need no privilege at all, so the
  safeguard is the label-quoted single argument plus the visible feedback, not a password.
- **Quoting assumed instead of tested.** Quoting is the protection and is exercised against a real
  shell with a stub; changing `shellQuote()` without a shell-level test is a regression waiting to
  happen.

## References

- [adr-0006-video-downloader-command-boundary](adr-0006-video-downloader-command-boundary.md) — the
  record whose "second exception needs a new ADR" clause this one discharges.
- [adr-0004-scoped-polkit-grant](adr-0004-scoped-polkit-grant.md) and
  [adr-0007-stop-button-confirmation-and-narrow-grant](adr-0007-stop-button-confirmation-and-narrow-grant.md)
  — the grant this record deliberately leaves alone.
- [status-slice.md](../status/status-slice.md) — the pure helpers the boundary lives in.
- [widget-slice.md](../widget/widget-slice.md) — the data sources and the surfaces that call them.
- [data-engine-contract.md](../status/data-engine-contract.md) — the `connectedSources` set semantics
  that make the run token necessary.
