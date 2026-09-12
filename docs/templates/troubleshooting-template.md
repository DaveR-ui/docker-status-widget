---
id: troubleshooting-template
category: templates
tags: [template, troubleshooting, symptoms]
aliases: [Troubleshooting Template]
related: [project, document-template]
version: 1.0
status: active
---

# Troubleshooting Template

## Problem

Failures recur verbatim — same error string, same hunt. When root causes live as prose buried in
slice docs, the next reader greps the error text, finds nothing, and re-diagnoses from zero.
Symptom-keyed sheets make a once-diagnosed failure findable by the exact string that woke someone up.

## Solution

Two shapes, one interplay rule. The **quick-ref sheet** is symptom-keyed: each entry is an H2 whose
text *is* the exact symptom string, carrying `**Context:**` → `**Root cause:**` → `**Fix:**` →
`**Reference:**`, where Reference points at a deep-dive. The **deep-dive spoke** unpacks one failure
class: Diagnosis summary, Anatomy of the failure (a File/Symbol/Role checkpoint table), Debug &
verify steps. The interplay rule: the entry point's Common Lookups table ([[project]]) routes exact
symptom strings to these headings, the folder's hub lists the sheet, and the write-up lives in
EXACTLY ONE place — the sheet. The symptom heading is a contract: the string doubles as grep pattern
and routing key. The body shape is a contracted exception under
[the upstream document contract §2](https://github.com/DaveR-ui/DocumentationAsAService); the
frontmatter is the standard note contract. Rationale:
[[adr-0005-doc-classes-and-body-shape-exceptions|ADR-0005]].

## When to use

When a failure has been diagnosed once and can plausibly recur — a build break, a runtime error, a
behavior that surprises users the same way every time. One quick-ref sheet per area; a deep-dive
spoke only where the anatomy will not fit four fields.

## When not to use

Conceptual explanation (that is a plain note); one-off incidents with no recurrence risk (git holds
them); root causes pasted into `project.md`'s Common Lookups — the table routes, it does not hold;
speculative entries for failures nobody has hit yet (an untested fix is folklore).

## Examples

Quick-ref sheet — entries keyed by the verbatim symptom:

```markdown
# <Area> Troubleshooting — Quick Ref

## ECONNREFUSED on every internal call after the proxy change
**Context:** service-to-service calls routed through the sidecar proxy.
**Root cause:** the config rewrite dropped the upstream port mapping.
**Fix:** restore the mapping, restart the sidecar, re-run the smoke check.
**Reference:** proxy-failure-deep-dive.md — the anatomy and why the rewrite lost it.

## build fails: "Module not found: payments/config"
**Context:** any build right after a folder rename in the payments area.
**Root cause:** a stale barrel import survived the rename.
**Fix:** update the import path; the rename checklist now catches this.
**Reference:** none
```

Deep-dive spoke — one failure class, unpacked:

```markdown
# Proxy ECONNREFUSED — Deep Dive

## Diagnosis summary
What fails, why it fails that way, and when this became understood. One paragraph.

## Anatomy of the failure
| File | Symbol | Role |
|---|---|---|
| proxy/config.ts | upstreamPort | reads the port mapping |
| proxy/route.ts | resolveUpstream | silently defaults on miss |

## Debug & verify
1. Reproduce with the proxy disabled: `npm run dev -- --no-proxy`.
2. Confirm the mapping is present in the rendered config.
3. Apply the fix; verify the smoke check exits 0.

## Related
- Quick-ref entry: the area's Troubleshooting sheet, heading "ECONNREFUSED on every internal call…".
```

## Common mistakes

- Paraphrasing the symptom in the heading: "proxy problems" greps nothing — the heading must be the
  string the reader pastes from their terminal.
- Pasting root causes into project.md's Common Lookups: duplication — the table points, the sheet
  holds; two homes means two versions.
- Deep-dives without a quick-ref pointer: the reader holding the error string never learns the
  spoke exists.
- Dropping the Reference field when the fix is one line: keep the field and say "none" — the shape
  is the contract, and "none" is information.

## References

- [[project]] — Common Lookups, the routing layer.
- [[document-template]] — the base note shape.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream
  class decision behind the quick-ref/deep-dive split.
