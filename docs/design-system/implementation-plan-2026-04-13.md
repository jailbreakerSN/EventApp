# Teranga UX/UI Implementation & Testing Plan — Phase 4

**Date:** 2026-04-13
**Companion docs:** [`audit-2026-04-13.md`](audit-2026-04-13.md) (findings) + [`execution-plan-2026-04-13.md`](execution-plan-2026-04-13.md) (backlog).
**Purpose:** Orchestration layer — turns the P1 backlog into shippable branches, with explicit skill + agent invocations at each gate.

Read the audit and execution plan first. This doc answers *how* to ship them.

---

## 1. Operating model

**One task = one short-lived branch off `main`**, named per CLAUDE.md §Git Branching:

- `feature/p1-h7-badge-darkmode-sweep`
- `feature/p1-h4a-datatable-admin`
- `feature/p1-i1a-shared-ui-i18n-extraction`

### Standard per-task loop

Repeat for every `TASK-P1-*` in `execution-plan-2026-04-13.md`:

```
1. DESIGN
   └─ Invoke: teranga-design-review skill (.claude/skills/teranga-design-review/SKILL.md)
              — the adapter routes to frontend-design, theme-factory,
                webapp-testing, ui-ux-pro-max as the task requires.
   └─ Output: 1-page design note in the PR description, referencing the
              task's acceptance criteria + skill rule citations.

2. IMPLEMENT
   └─ Small commits per acceptance-criterion item ([ ] → [x]).
   └─ Run the verification script while iterating:
        python scripts/design-verification/verify_<task>.py --url <running-dev-url>
   └─ Flip GATED=False in that script once the first AC lands
     (activates the CI check for subsequent pushes).

3. VERIFY LOCALLY
   └─ vitest:  cd apps/api && npx vitest run            (regression guard)
   └─ lint:    npm run lint
   └─ types:   npm run types:build                      (if shared-types touched)
   └─ static:  python scripts/design-verification/verify_<task>.py  → PASS
   └─ manual:  375 / 768 / 1280 px × light/dark × keyboard-only

4. PRE-COMMIT AGENTS
   └─ @l10n-auditor           (mandatory on every UI change — regression guard)
   └─ @security-reviewer      (ONLY for H6 and I1b — tasks touching auth / providers)

5. COMMIT + PR
   └─ Conventional Commit per CLAUDE.md §6 (body explains *why*, includes test status).
   └─ PR body: ## Summary grouped by AC + ## Test plan checklist (per CLAUDE.md §7).

6. REVIEW
   └─ Self-review via the Plan agent: "is this the smallest correct change?"
   └─ Optional: gh workflow run claude-review.yml -f pr_number=<N>   (advisory).

7. MERGE + DELETE BRANCH
```

---

## 2. Skill × task matrix

Every task is routed through the `teranga-design-review` adapter skill. The matrix below shows which *upstream* skills each task exercises, so the adapter can load the right rules.

| Task                         | frontend-design | theme-factory | webapp-testing | ui-ux-pro-max | Notes                                                 |
| ---------------------------- | :-------------: | :-----------: | :------------: | :-----------: | ----------------------------------------------------- |
| H8 skeleton coverage         |        ·        |       ·       |       ✅       |    rule 41    | Mechanical; minimal design input                      |
| H7 badge dark-mode           |        ·        |      ✅       |       ✅       |       ·       | Token discipline is the whole task                    |
| N4 toast placement           |        ·        |       ·       |       ✅       |    rule 55    | SSR hydration pitfall — test deliberately             |
| N2 empty states              |        ✅       |      ✅       |       ✅       |    rule 62    | Illustration style needs theme-factory                |
| H3 onBlur forms              |        ✅       |       ·       |       ✅       |       ·       | *Never leave the user guessing*                       |
| H1 discovery chips           |        ✅       |      ✅       |       ✅       |    rule 12    | Biggest UX shift for participants                     |
| H2 event-detail tabs         |        ✅       |       ·       |       ✅       |  rule 29, 78  | Largest SSR refactor in P1                            |
| N3 chart delta a11y          |        ·        |      ✅       |       ✅       |    rule 78    | Can ride with N2                                      |
| H4 DataTable migration (a-d) |        ✅       |       ·       |       ✅       |    rule 58    | 4 sub-PRs; per-scope allow-list in verifier            |
| H6 email gate                |        ✅       |       ·       |       ✅       |       ·       | **+ security-reviewer mandatory**                     |
| I1 next-intl (a-d)           |        ✅       |       ·       |       ✅       |       ·       | Sub-PRs; I1a unblocks all consumers                   |

Rule citations are already in the execution plan — copy them into the PR body to speed review.

---

## 3. Agent × task matrix

Only the agents that apply. Running non-applicable agents is noise.

| Agent                              | Applies to                | When                      |
| ---------------------------------- | ------------------------- | ------------------------- |
| `@l10n-auditor`                    | **every task**            | Pre-commit, every PR      |
| `@security-reviewer`               | H6, I1b only              | Pre-commit, these PRs     |
| `@firestore-transaction-auditor`   | — (no API changes)        | n/a                       |
| `@plan-limit-auditor`              | — (no gated features)     | n/a                       |
| `@domain-event-auditor`            | — (no service mutations)  | n/a                       |

**Rule:** if a task drifts into `apps/api/` or `apps/functions/`, stop and re-evaluate. No P1 task is supposed to — drift = scope signal to split.

---

## 4. Phase-based rollout

### Phase A — Quick wins (low risk, high signal)

Ship first to establish visual-regression baselines.

| # | Task          | Scope                          |
| - | ------------- | ------------------------------ |
| 1 | TASK-P1-H8    | Skeleton coverage (10 files)   |
| 2 | TASK-P1-N4    | Toast placement (1 shared-ui)  |
| 3 | TASK-P1-H7    | Badge dark-mode sweep (31)     |

### Phase B — Component & form polish

| # | Task          | Scope                          |
| - | ------------- | ------------------------------ |
| 4 | TASK-P1-N2    | Empty-state migration          |
| 5 | TASK-P1-H3    | onBlur validation + FormField  |
| 6 | TASK-P1-N3    | Chart delta a11y (rides w/ N2) |

### Phase C — Discovery rework (participant)

| # | Task          | Scope                          |
| - | ------------- | ------------------------------ |
| 7 | TASK-P1-H1    | Chip filters                   |
| 8 | TASK-P1-H2    | Event-detail tabs              |

### Phase D — DataTable migration (4 sub-PRs, sequential)

| #  | Task         | Scope                                                  |
| -- | ------------ | ------------------------------------------------------ |
| 9  | TASK-P1-H4a  | Admin tables (5 files)                                 |
| 10 | TASK-P1-H4b  | Event detail + check-in (3 files)                      |
| 11 | TASK-P1-H4c  | Finance / analytics / dashboard / events (4 files)     |
| 12 | TASK-P1-H4d  | Participant side (3 files)                             |

### Phase E — Auth enforcement

| #  | Task         | Scope                                              |
| -- | ------------ | -------------------------------------------------- |
| 13 | TASK-P1-H6   | Email-verification hard gate + security-reviewer   |

### Phase F — i18n mini-wave (4 sub-PRs)

Parallelisable with D once I1a + I1b land.

| #  | Task         | Scope                                                      |
| -- | ------------ | ---------------------------------------------------------- |
| 14 | TASK-P1-I1a  | shared-UI extraction (highest leverage — unblocks others)  |
| 15 | TASK-P1-I1b  | Provider wiring + language selector                        |
| 16 | TASK-P1-I1c  | Top-10 offender extraction                                 |
| 17 | TASK-P1-I1d  | Long-tail (73 files, mechanical)                           |

**Parallelisation:** A, C, D, F can interleave once predecessors land. B should finish before C starts (FormField `state` prop is reused).

---

## 5. Testing strategy

Three layers, each with a clear trigger.

### Layer 1 — Static guards (every commit, <10s)

- `npm run lint` (ESLint + `eslint-plugin-jsx-a11y`)
- `npm run types:build` (catches schema drift if shared-types touched)
- `python scripts/design-verification/verify_<task>.py` (static-only branch runs in <1s)

### Layer 2 — Unit / integration (every PR)

- `cd apps/api && npx vitest run` — must stay at 558 passing
- Web apps: add lightweight render tests **only** for new primitives (`chip.tsx`, `delta-pill.tsx`, `FormField` `state` prop). No test sprawl.

### Layer 3 — Visual + a11y (per PR, CI-gated once the task ships)

- Playwright scripts with Firebase emulators (local or CI runner).
- Matrix: **375 × 768 × 1280 px × light/dark × keyboard-only**.
- Failure artefacts: `/tmp/teranga-verify-<task>.png` (captured by `scripts/design-verification/_shared.py`).

### Manual QA checklist (goes in every PR body)

```
## Test plan
- [ ] Keyboard-only nav (Tab / Shift-Tab / Enter / Escape)
- [ ] Dark mode parity (ThemeToggle)
- [ ] Screen-reader pass (VoiceOver iOS or NVDA Windows)
- [ ] Mobile viewport at 375px (DevTools or real device)
- [ ] Slow-3G throttle → no layout shift during font load
- [ ] prefers-reduced-motion: reduce → animations respected
- [ ] @l10n-auditor diff clean (no new hardcoded strings)
```

---

## 6. CI hookup (advisory)

Add a new workflow — **advisory only, does not fail main**:

```yaml
# .github/workflows/design-verify.yml (proposed — to be added with Phase A)
name: Design Verify (advisory)
on:
  pull_request:
    paths:
      - 'apps/web-*/**'
      - 'packages/shared-ui/**'
      - 'scripts/design-verification/**'
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Run static verifiers
        run: |
          for s in scripts/design-verification/verify_*.py; do
            python "$s" || echo "::warning::$s failed"
          done
```

Static-only scripts run without Playwright — cheap, fast, catches regressions. A later iteration can add a separate job that installs Playwright and boots emulators.

---

## 7. Definition of Done (per task)

Every row must be ✅ before merge:

| Gate                      | Check                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| Acceptance criteria       | All `[x]` in the execution plan                                             |
| Verification script       | Green locally; `GATED = False` in the script                                |
| Unit / integration tests  | `cd apps/api && npx vitest run` — no regressions (558 passing floor)        |
| Static script suite       | All `verify_*.py` with `GATED=False` pass                                   |
| Manual QA                 | All checklist boxes ticked in PR body                                       |
| Pre-commit agents         | `@l10n-auditor` clean; `@security-reviewer` clean (H6, I1b only)            |
| Commit hygiene            | Conventional format, body with *why*, test status included                  |
| PR description            | Updated on every push (CLAUDE.md §7)                                        |
| No scope creep            | Zero file changes in `apps/api/` or `apps/functions/`                       |

---

## 8. Risks & mitigations

| Risk                                                                       | Mitigation                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| H4 DataTable migration regresses sort/filter UX on admin pages             | Ship H4a first; use its outcome as reference shape for H4b–d                               |
| I1 i18n pipeline breaks SSR on participant event detail page               | I1b must ship with a runtime test in `verify_i18n_coverage.py`                             |
| H6 email-gate creates lockout for legitimate users                         | 7-day grace + configurable env + super-admin exemption + staging soak before prod          |
| Toast top-center collision with sticky headers on specific mobile browsers | Test on iOS Safari + Android Chrome real devices during N4; fallback `bottom-center`       |
| Playwright install fails in CI runners (known flakiness)                   | Static-only job is the floor; Playwright job is advisory-only                              |
| Parallel lanes create merge conflicts in shared-ui                         | I1a (shared-ui extraction) freezes Phase B/C touchpoints for 1 day during merge            |

---

## 9. Explicit non-goals

- **No new waves** in `docs/delivery-plan/` — P1 fits inside Wave 10 polish.
- **No feature flags** — UI changes are immediately visible; grace mechanisms (H6 7-day window) handle risk instead.
- **No backend/API changes** — if a task requires one, stop and re-scope.
- **No mobile (Flutter) work** — all P1 is web-only; mobile is Wave 9.
- **No P2 scheduling** — execution plan §P2 stays as one-liners until promoted.

---

## 10. First move

**Start with Phase A, TASK-P1-H8** (skeleton coverage — 10 files, lowest-risk, establishes the loop).

Workflow for the very first branch:

```
git checkout main && git pull
git checkout -b feature/p1-h8-skeleton-coverage
# Invoke teranga-design-review skill to confirm the Skeleton shapes per page
# Edit the 10 files; commit atomically (one per 2-3 files)
python scripts/design-verification/verify_skeleton_coverage.py   # flip GATED=False once the first file is migrated
cd apps/api && npx vitest run                                     # must stay green
@l10n-auditor                                                     # regression guard
git commit -m "feat(web): migrate Chargement text to Skeleton shapes (TASK-P1-H8)"
git push -u origin feature/p1-h8-skeleton-coverage
# Open PR, paste the manual QA checklist, tick all boxes, merge.
```

The loop runs identically for every subsequent task. Each merge retires one row from `execution-plan-2026-04-13.md`.
