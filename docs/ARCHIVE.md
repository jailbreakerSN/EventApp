# Archive Notice

> **This directory (`docs/`) is archived.** It contains legacy documentation written during the initial platform build (Waves 0–3, through April 2026).
>
> **The current documentation is at [`docs-v2/`](../docs-v2/README.md).**

---

## Why archived?

The `docs/` directory was written incrementally alongside code development. It contains:

- Wave delivery checklists (some still partially useful for historical context)
- Design system audits and design tokens (superseded by `packages/shared-config/`)
- System audits and security reviews from the Wave 1–2 period
- UX/UI audit findings from April 2026

The new `docs-v2/` documentation was derived directly from source code analysis and follows the [Diátaxis framework](https://diataxis.fr/) with arc42-style architecture documentation and ADRs.

---

## File Index

### Root

| File | Contents |
|---|---|
| `agenda-publish-design.md` | Design notes for the event publish flow |
| `badge-journey-review-2026-04-20.md` | QR badge credential journey review (historically accurate — see `docs-v2/20-architecture/concepts/qr-v4-and-offline-sync.md` for current state) |
| `system-audit-2026-04-17.md` | Security and architecture audit post-Wave 1 |
| `ux-ui-audit-2026-04-07.md` | UX/UI audit findings |

### `delivery-plan/`

Wave-by-wave task checklists. Still useful to understand what was planned in each wave. Cross-reference with `docs-v2/10-product/roadmap.md` for current delivery state.

### `design-system/`

Design token definitions, brand identity guidelines, component patterns, and UX guidelines. The canonical design tokens are now in `packages/shared-config/`. The design system docs here describe the intent; `packages/shared-ui/` is the implementation.

---

## Do not update this directory

Bug fixes, new features, and architecture decisions should be documented in `docs-v2/`. The archived files are kept for historical reference only.
