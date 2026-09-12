---
id: widget-index
category: widget
tags: [hub, index, widget, qml]
aliases: [Widget Index, QML Surfaces]
related: [widget-slice, ui-surfaces]
version: 1.0
status: active
---

# Widget Index

What belongs here: the QML surfaces Plasma renders — representation selection, data-source wiring,
contextual actions, the config page, and the single mapping from severity to colour. If a change
needs a running Plasma session to be observed, it belongs here.

What belongs elsewhere: the *decisions* about parsing, state and severity are the
[../status/status-slice.md](../status/status-slice.md) slice; the grant that makes the start button
passwordless is [../privilege/privilege-slice.md](../privilege/privilege-slice.md); installing the
package at all is [../installer/installer-slice.md](../installer/installer-slice.md).

## Contents

- [[widget-slice]] — the map of this slice: boundaries, flows, conventions, known gaps.
- [[ui-surfaces]] — UI inventory sheet: which surface to pick for a change, and what each one is.

## Elsewhere

- The severity values these surfaces render: [../status/status-slice.md](../status/status-slice.md)
- The engine contract behind the data sources: [../status/data-engine-contract.md](../status/data-engine-contract.md)
- Why the stop button exists but confirms on a second click, and why it keeps the interactive
  polkit prompt while start stays passwordless:
  [../adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md](../adrs/adr-0007-stop-button-confirmation-and-narrow-grant.md)
