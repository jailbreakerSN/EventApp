# ADR-NNNN: <Decision Title>

**Status:** Proposed | Accepted | Deprecated | Superseded by [ADR-NNNN](./NNNN-...md)
**Date:** YYYY-MM
**Deciders:** Platform team

---

## Context

What problem are we solving? What forces are at play?

- 1–3 short paragraphs of context.
- Reference relevant constraints (African network conditions, Senegalese market, freemium tier shape, regulatory or cost requirements).
- If this decision underpins something in `CLAUDE.md` or in `docs-v2/10-product/roadmap.md`, link it.

---

## Decision

A single declarative sentence — what we chose, not what we discussed.

> **We will <do X>.**

Concrete shape, 2–5 bullets:

- Concrete shape bullet 1.
- Concrete shape bullet 2.
- Concrete shape bullet 3.

---

## Reasons

| Concern | Option A (chosen) | Option B (rejected) | … |
|---|---|---|---|
| Concern 1 | … | … | … |
| Concern 2 | … | … | … |

Or 3–5 prose bullets if a comparative table doesn't fit.

---

## Alternatives considered

### Alt A — <name>

- **Pro:** …
- **Con:** …
- **Why rejected:** …

### Alt B — <name>

- **Pro:** …
- **Con:** …
- **Why rejected:** …

---

## Consequences

### Positive

- Consequence 1.
- Consequence 2.

### Negative / accepted trade-offs

- Trade-off 1.
- Trade-off 2.

### Follow-ups required

- [ ] Action 1 — owner: …
- [ ] Action 2 — owner: …

---

## References

- `path/to/code.ts:line` — implementation anchor in the codebase.
- `docs-v2/<chapter>/...md` — companion documentation.
- External link if relevant (RFC, vendor doc, blog post).

---

## How to use this template

1. Copy this file to `docs-v2/20-architecture/decisions/NNNN-<kebab-case-title>.md`, with `NNNN` the next free 4-digit number (current head: see [README.md](./README.md)).
2. Fill in every section. If a section truly does not apply, write `n/a — <one-line reason>` rather than deleting the section, so future readers don't wonder if it was forgotten.
3. After accepting, add the row to the index in [README.md](./README.md).
4. Never edit a past ADR retroactively — supersede it with a new one and update the old ADR's `Status` to `Superseded by [ADR-NNNN](./NNNN-...md)`.
