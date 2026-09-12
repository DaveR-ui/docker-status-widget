---
id: interface-surface-template
category: templates
tags: [template, interface-surface, catalog, contract]
aliases: [Interface Surface Template]
related: [document-template, slice-generalities-template, project]
version: 1.0
status: active
---

# Interface Surface Template

## Problem

Per-slice API dumps duplicate and rot: the same operation gets described once per referencing slice,
and the first contract change silently rots every copy but one. A functional group's interface needs
ONE sheet — keyed per functional group — that many slices cross-link to, instead of each slice
re-listing what it calls.

## Solution

One class, two modes — one catalog sheet per functional group, plus one contract sheet per mapped
operation; pick the mode per sheet. Record
the mode in `tags`: `interface-catalog` for the group-keyed listing of what exists,
`interface-contract` for the full mapping of one operation. Membership and mode ride on `tags`,
never on invented frontmatter keys (inventing keys is a metadata-outside-contract error — see
[[new-note-checklist]]). The body shape below is a contracted exception under
[the upstream document contract §2](https://github.com/DaveR-ui/DocumentationAsAService) —
registered doc classes keep their documented anatomy — while the frontmatter contract is
unchanged. The rationale for one class instead of two lives in
[[adr-0005-doc-classes-and-body-shape-exceptions|ADR-0005]]; link it, don't restate it.

## When to use

When a group's externally visible surface — operations, endpoints, submit mappings — is referenced
by two or more slices, or when a reader's first question is "what exists here and who calls it?".
One sheet per functional group; slices link to it from their generalities docs and the Slices table.

## When not to use

Not a per-slice private note (that belongs in the slice's own doc); not a payload dump (Request and
Response are pointers to contract sheets, not bodies); not a place for code comments copied out of a
handler. If exactly one slice references a surface and the group has no other callers, keep the list
in the slice doc — a one-reader sheet is a second truth to maintain.

## Examples

Catalog mode — the group-keyed listing of what exists:

```markdown
# <Group> Interface — Catalog

Base address: `https://internal.example/api/<group>` — every path below is relative to it.

## Order intake

### Create order
**Surface:** `POST /orders`
**Operation:** create
**Request:** see *Order submit mapping* (contract sheet)
**Response:** the stored order record — shape in the orders note
**Owner:** orders
**Callers:** checkout, ops-console
**Description:** accepts a draft cart, returns the created order id.
**Notes:** idempotent when the caller sends a key.

### List orders
**Surface:** `GET /orders`
**Operation:** read
**Request:** filter params — pointer to the query note
**Response:** page of order summaries
**Owner:** orders
**Callers:** checkout, reporting
**Description:** paged listing, newest first.

## Refunds

### Issue refund
**Surface:** `POST /refunds`
**Operation:** create
...same fixed fields...

## Related sheets
- order-submit-mapping.md — the contract sheet behind `POST /orders`.
- checkout-slice.md — a slice that drives intake.
```

Contract mode — the full mapping of one operation:

```markdown
# Order Submit Mapping — Contract

## Submit mapping

### Rule
One entry per submitted field: where it lands, how it transforms, what rejects it. The catalog's
Request row points here; payloads live nowhere else.

### Field groups
| Group      | Fields          | Destination     | Validation |
|------------|-----------------|-----------------|------------|
| identity   | customer, channel | order.customer  | required   |
| line items | sku, qty, price   | order.lines[]   | qty > 0    |

### Mode differences
| Aspect | Create              | Update                      |
|--------|---------------------|-----------------------------|
| id     | server-assigned     | caller-supplied, must exist |
| lines  | full set            | delta; absent ≡ unchanged   |

### Normalization rules
- Trim, case-fold, empty-vs-absent: each stated once, here.

## Related sheets
- orders-interface-catalog.md — the catalog sheet this contract backs.
```

## Common mistakes

- Keying entries by resource type instead of capability: readers search by what they want to
  accomplish, and capability keys keep a group's entries together.
- Letting a slice fork its own endpoint list: the fork is a second truth and rots first — the slice
  links to the sheet and lists only what it calls.
- Omitting the base-address line: relative paths go ambiguous the moment a second environment
  exists.
- Smuggling payloads into Request/Response: those fields are pointers to contract sheets; bodies
  belong in exactly one place.

## References

- [[document-template]] — the base note shape this specializes.
- [[slice-generalities-template]] — the slice doc that links here, not vice versa.
- [Documentation as a Service](https://github.com/DaveR-ui/DocumentationAsAService) — the upstream
  one-class, two-modes specification.
