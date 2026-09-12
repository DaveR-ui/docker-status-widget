---
id: adr-0004-scoped-polkit-grant
category: adrs
tags: [adr, privilege, polkit, security]
aliases: [ADR-0004]
related: [adr-index, privilege-slice, installer-slice]
version: 1.0
status: active
---

# ADR-0004: A scoped polkit rule, not `pkexec` and not sudoers

## Problem

`systemctl start docker` needs root, and the whole point of the widget is a one-click start without a
password prompt. Three options were on the table, all of them a real trade-off between convenience
and the size of the grant:

1. **`pkexec` per click** — zero setup, and the grant is exactly one command. But it prompts every
   single time, which defeats the widget.
2. **A `sudoers` NOPASSWD entry** — no prompt, but the unit of the grant is a whole binary. It is not
   auditable per action, and it is coarse enough to hand out far more than "start this one unit".
3. **A scoped polkit rule** — no prompt, and the grant can be expressed as *this action id, this unit,
   this verb, this kind of session*.

The force against all three is the same: this is a status widget in a panel, one misclick away from
the user's running containers. Whatever is granted must be narrow enough that a mistake is boring.

## Solution

A single polkit JavaScript rule, `polkit/49-docker-status-widget.rules`, installed by hand into
`/etc/polkit-1/rules.d/`. It returns `polkit.Result.YES` only when **all** of these hold, and
`NOT_HANDLED` otherwise:

| Condition | Value |
|---|---|
| Action id | `org.freedesktop.systemd1.manage-units` |
| Unit | `docker.service` |
| Verb | present in `ALLOWED_VERBS`, which contains exactly `"start"` |
| Subject session | `subject.local && subject.active` — no remote/SSH, no inactive session |
| Subject group | `wheel` |

`NOT_HANDLED` means polkit falls through to its normal authentication agent, so a denial shows up as
the ordinary password prompt rather than as a dead button.

Two supporting decisions belong to the grant's correctness rather than to convenience:

- **The verb lookup is never replaced by a wildcard.** Widening means editing the `ALLOWED_VERBS`
  array deliberately; that edit is the review surface for the whole privilege model.
- **The `isInGroup` compatibility shim stays.** polkit 0.121 and later expose `isInGroup()` as a
  method; older releases exposed it as a boolean property. Without the shim the rule can become
  silently dead on one of the two — a grant that fails closed but for the wrong reason.

Installing and removing the rule are separate, explicitly privileged commands (`install-polkit`,
`remove-polkit`); they are never folded into the plasmoid install.

## When to use

Read this record before touching the rule, before widening it, and before copying its shape for any
other grant. Verify a live install with:

```bash
pkcheck --action-id org.freedesktop.systemd1.manage-units \
        --process $$ --detail unit docker.service --detail verb start
```

## When not to use

Do not use this rule as a template for granting anything else — copy the *shape* (one action, one
unit, one verb, session-scoped, group-scoped), never the scope. Do not replace it with a sudoers
entry to "simplify" install: that trades a reviewable grant for an opaque one. And if the widget's
start button is not wanted at all, socket activation is the alternative —
`systemctl enable --now docker.socket` — which turns the widget into a read-only status display and
makes this record moot.

## Examples

- The rule: [../privilege/privilege-slice.md](../privilege/privilege-slice.md)
- The rejected alternatives and their reasons are the three options in **Problem** above; the
  selected one is item 3, and `pkexec` survives only as the fallback polkit itself invokes.
- Behaviour without the rule installed: the button still starts the daemon, and polkit asks for a
  password — see
  [../verification/troubleshooting.md](../verification/troubleshooting.md#the-start-button-asks-for-a-password-every-time).
- The unit is currently `disabled` on the reference machine, so the daemon does not return after a
  reboot until it is started — either by this button or by enabling socket activation.

## Common mistakes

- **Tolerated fallout:** the grant is group-based (`wheel`) with no configurable group, so a user
  outside `wheel` gets a password prompt and no hint why.
- **Tolerated fallout:** no automated test exercises the rule. A polkit release could dead-end it
  silently; the `isInGroup` shim is the only mitigation in place, and a probe after a polkit update
  is manual work.
- Adding a verb to `ALLOWED_VERBS` "just in case" — every added verb is a new destructive action one
  click away, and `stop`/`restart` were rejected for exactly that reason.
- Assuming installing the rule also enables the service: it does not, and the widget cannot make it
  persist across reboots.
- Debugging a password prompt by editing the widget instead of checking `subject.local` and group
  membership first.

## References

- [../privilege/privilege-slice.md](../privilege/privilege-slice.md) — the slice map for the rule file.
- [../installer/installer-slice.md](../installer/installer-slice.md) — which command installs it, and why that command is separate.
- [../verification/troubleshooting.md](../verification/troubleshooting.md) — the symptom-keyed write-ups for a prompt that should not appear.
- [adr-0003-slice-taxonomy](adr-0003-slice-taxonomy.md) — why the rule file is its own slice.

## Addendum

**2026-09-11 — the machine-state claim above is a dated observation.** The Common mistakes section
states that `docker.service` is `disabled` on the reference machine. That is environment state recorded
in the project README, not a property of the grant, and it can change without this record changing.
Verify it before relying on it: `./install.sh status` prints both `is-active` and `is-enabled`.

The original text above is left untouched — this record is append-only.

**2026-09-11 — a stop button arrived, and this record still stands.**
[adr-0007](adr-0007-stop-button-confirmation-and-narrow-grant.md) reversed the project's earlier
"no stop button" anti-goal: the widget now offers a stop that requires a second, expiring
confirmation. Nothing in this record changed. `ALLOWED_VERBS` is still exactly `["start"]`, and that
is precisely what makes the stop path prompt for a password while starting stays passwordless — the
asymmetry point 3 above argues for. The grant was not widened for the feature, and adding `"stop"`
would still be the deliberate, reviewable edit that **Common mistakes** describes. Two lines elsewhere in
this record have since drifted. The **Common mistakes** note that no automated test exercises the rule is
now partly outdated: a test pins `ALLOWED_VERBS` and the gates as text, while the rule's runtime behaviour
against polkit is still untested. And the **When not to use** claim that socket activation "turns the
widget into a read-only status display" no longer describes the widget: with a stop button present, socket
activation makes the *start* button unnecessary, but the widget is not read-only.
