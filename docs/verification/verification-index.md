---
id: verification-index
category: verification
tags: [hub, index, verification, tests, evidence]
aliases: [Verification Index, Testing]
related: [verification-slice, troubleshooting]
version: 1.0
status: active
---

# Verification Index

What belongs here: how this project is proven — the Node harness over the shipped JavaScript, the QML
lint, the documented probe evidence, the honest list of what is *not* verified, and the symptom-keyed
write-ups for failures that recur.

What belongs elsewhere: the logic under test is the [../status/status-slice.md](../status/status-slice.md)
slice; the QML under lint is the [../widget/widget-slice.md](../widget/widget-slice.md) slice; the
command that runs the harness is [../installer/installer-slice.md](../installer/installer-slice.md).

## Contents

- [[verification-slice]] — the map of this slice: the evidence layers and their limits.
- [[troubleshooting]] — quick-ref sheet keyed by exact symptom strings, routed from `project.md`.

## Elsewhere

- The functions the harness loads byte-for-byte: [../status/status-slice.md](../status/status-slice.md)
- The engine behaviour the probes measured: [../status/data-engine-contract.md](../status/data-engine-contract.md)
- Running the suite: [../installer/installer-slice.md](../installer/installer-slice.md)
