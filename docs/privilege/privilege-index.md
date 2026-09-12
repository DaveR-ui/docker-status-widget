---
id: privilege-index
category: privilege
tags: [hub, index, privilege, polkit]
aliases: [Privilege Index, Polkit Index]
related: [privilege-slice, adr-0004-scoped-polkit-grant]
version: 1.0
status: active
---

# Privilege Index

What belongs here: the single artifact in this project that grants anything to anyone — the polkit
rule — together with the reasoning about what it deliberately does *not* grant. Any change that widens
or narrows what a local user may do unprivileged belongs here, and nowhere else.

What belongs elsewhere: the command that installs the rule is the
[../installer/installer-slice.md](../installer/installer-slice.md) slice; the click that triggers the
privileged action is [../widget/widget-slice.md](../widget/widget-slice.md); the symptom of an
unexpected password prompt is
[../verification/troubleshooting.md](../verification/troubleshooting.md).

## Contents

- [[privilege-slice]] — the map of this slice: boundaries, the grant table, what widening costs.

## Elsewhere

- The decision and its rejected alternatives:
  [../adrs/adr-0004-scoped-polkit-grant.md](../adrs/adr-0004-scoped-polkit-grant.md)
- Installation and removal commands: [../installer/installer-slice.md](../installer/installer-slice.md)
- A prompt that should not appear:
  [../verification/troubleshooting.md](../verification/troubleshooting.md#the-start-button-asks-for-a-password-every-time)
