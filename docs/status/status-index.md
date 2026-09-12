---
id: status-index
category: status
tags: [hub, index, status, logic]
aliases: [Status Index, Logic Slice Index]
related: [status-slice, data-engine-contract]
version: 1.0
status: active
---

# Status Index

What belongs here: the pure logic that turns command output into meaning — normalisation, daemon-state
parsing, container parsing, counting and the compact badge, severity mapping, and the run-token helper
that makes a repeated command re-run. Plus the contract sheet for the `executable` data engine, which
is the boundary this slice is written against.

What belongs elsewhere: rendering a severity onto a colour is the
[../widget/widget-slice.md](../widget/widget-slice.md) slice; the privilege grant is
[../privilege/privilege-slice.md](../privilege/privilege-slice.md); the Node harness that proves these
functions is [../verification/verification-slice.md](../verification/verification-slice.md).

## Contents

- [[status-slice]] — the map of this slice: boundaries, flows, conventions, known gaps.
- [[data-engine-contract]] — interface-surface sheet (contract mode): the engine payload this logic
  consumes, and the set semantics that shape the run-token helper.

## Elsewhere

- Who consumes the severity values: [../widget/ui-surfaces.md](../widget/ui-surfaces.md)
- The tests over these functions: [../verification/verification-slice.md](../verification/verification-slice.md)
