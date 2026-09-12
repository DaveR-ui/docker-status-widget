---
id: privilege-slice
category: privilege
tags: [slice, generality, privilege, polkit, security]
aliases: [Privilege slice, Polkit slice]
related: [privilege-index, adr-0004-scoped-polkit-grant]
version: 1.0
status: active
---

# Privilege — Slice Generalities

## What this slice is

The whole privilege boundary of the project, in one file: a polkit JavaScript rule that grants exactly
one verb on exactly one systemd unit to a local, active member of `wheel`. Its form is a declarative
predicate — every branch either returns `YES` or `NOT_HANDLED`, and `NOT_HANDLED` means polkit's normal
authentication applies. Nothing in the widget can escalate by itself; this file is the only place
where "may do this unprivileged" is ever answered.

## Boundaries

**In:** the rule file, its five gates, the compatibility shim for `isInGroup`, and the reasoning about
what must never be granted.

**Out:** installing the file ([installer-slice](../installer/installer-slice.md)); the action that
reaches polkit ([widget-slice](../widget/widget-slice.md)); how a prompt is diagnosed
([troubleshooting](../verification/troubleshooting.md)); the rejected alternative models, which are
archaeology and live in [adr-0004](../adrs/adr-0004-scoped-polkit-grant.md).

## Entry points

- `polkit/49-docker-status-widget.rules` — the rule, and its comment block stating the intent.
- [../adrs/adr-0004-scoped-polkit-grant.md](../adrs/adr-0004-scoped-polkit-grant.md) — why this model
  and not `pkexec` or a sudoers entry.
- `./install.sh install-polkit` and `./install.sh remove-polkit` — the only sanctioned way in or out.

## How it works

`polkit.addRule` runs for every action polkit is asked about. The predicate short-circuits through five
gates; **all five** must pass:

| Gate | Lookup | Must be |
|---|---|---|
| Action id | `action.id` | `org.freedesktop.systemd1.manage-units` |
| Unit | `action.lookup("unit")` | `docker.service` |
| Verb | `action.lookup("verb")` | a member of `ALLOWED_VERBS`, which contains exactly `"start"` |
| Session | `subject.local && subject.active` | both true — no remote session, no inactive one |
| Group | `subject.isInGroup("wheel")` — a method on polkit ≥ 0.121, a boolean property before that | true |

A miss on any gate returns `NOT_HANDLED`, which hands the decision back to polkit's normal agent: the
user sees the ordinary password prompt. All five passing returns `YES`. The file is installed to
`/etc/polkit-1/rules.d/49-docker-status-widget.rules` as `root:root`, mode `0644`, and polkit (or
`polkitd`) is restarted best-effort afterwards.

## Conventions of this slice

- The verb check stays an array membership test. Widening the grant means editing `ALLOWED_VERBS`
  deliberately; replacing the lookup with a wildcard is the one edit this slice forbids outright.
- Session scoping is never relaxed. A remote or SSH session must go through normal authentication
  even when the user is in `wheel`.
- The group is fixed to `wheel`. A configurable group would move privilege policy into the widget's
  settings, where a click could change it.
- The `isInGroup` compatibility shim stays in place: without it the rule can be silently dead on one
  of the two polkit API generations — failing closed, but for the wrong reason.
- Installing or removing the rule is always an explicit, `sudo`-gated command. It is never folded into
  the plasmoid install.

## Dependencies

**Upstream:** polkit's rule API (verified on polkit 127), systemd's unit naming (`docker.service`), and
the existence of the `wheel` group.
**Downstream:** the widget's start button becomes passwordless only when this rule is installed. No
code depends on the rule existing — without it the button still works and simply prompts. The stop
button always prompts, installed rule or not: it is outside the grant by decision, not by omission
([[adr-0007-stop-button-confirmation-and-narrow-grant]]).

## Known gaps & accepted debt

- The rule's **text** is now pinned by a test: `tests/dockerstatus.test.mjs` reads the shipped rule file
  and asserts `ALLOWED_VERBS` is exactly `["start"]` plus the action-id, unit and session gates. Nothing
  exercises the rule **at runtime** against polkit, so a polkit release could still dead-end the grant
  silently, and `pkcheck` remains the only runtime confirmation.
- The grant is bound to the `wheel` group with no configurable alternative, so a user outside it gets a
  password prompt and no explanation from the widget.
- Only `start` is supported. `stop`, `restart`, `enable`, `disable` and `mask` were all deliberately
  excluded, so "widen the array" is the only supported change and it is a security decision. The
  widget's stop button deliberately relies on polkit's interactive prompt instead of a grant, which is
  what keeps the destructive verb out of the passwordless path
  ([[adr-0007-stop-button-confirmation-and-narrow-grant]]).
- The rule does not enable `docker.service` at boot; that stays a separate, deliberate system
  decision.
