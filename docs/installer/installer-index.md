---
id: installer-index
category: installer
tags: [hub, index, installer, cli]
aliases: [Installer Index, Lifecycle CLI]
related: [installer-slice, privilege-slice]
version: 1.0
status: active
---

# Installer Index

What belongs here: the lifecycle CLI — install, upgrade, uninstall, grant, revoke, report, run tests —
and the packaging assumptions it makes about the KPackage it copies. A change to how the widget gets
onto a machine belongs here.

What belongs elsewhere: what the copied package contains is the
[../widget/widget-index.md](../widget/widget-index.md) slice; the rule that `install-polkit` places is
[../privilege/privilege-slice.md](../privilege/privilege-slice.md); the tests `install.sh test`
delegates to are [../verification/verification-slice.md](../verification/verification-slice.md).

## Contents

- [[installer-slice]] — the map of this slice: the command table, why privileges stay split, and gaps.

## Elsewhere

- The privileged artifact this CLI installs:
  [../privilege/privilege-slice.md](../privilege/privilege-slice.md)
- The harness this CLI invokes: [../verification/verification-slice.md](../verification/verification-slice.md)
- When the widget does not show up after a successful install:
  [../verification/troubleshooting.md](../verification/troubleshooting.md#docker-status-does-not-appear-in-add-widgets)
