# Design-verification scripts

Black-box Playwright scripts, one per task from `docs/design-system/execution-plan-2026-04-13.md`. Produced per the `webapp-testing` skill (`.claude/skills/webapp-testing/SKILL.md`).

## Running

Prerequisites:

```bash
# Python side (one-time)
python -m venv .venv && source .venv/bin/activate
pip install playwright
playwright install chromium

# JS side (if not already done at repo root)
npm install
```

Each script is standalone. They all use `scripts/with_server.py` (from the webapp-testing skill bundle, vendored at `.claude/skills/webapp-testing/scripts/with_server.py`) to manage server lifecycle. Run with `--help`:

```bash
python scripts/design-verification/verify_reduced_motion.py --help
```

Typical invocation against a **running** dev environment (fastest feedback loop):

```bash
# Terminal 1
firebase emulators:start

# Terminal 2
npm run web:dev

# Terminal 3
python scripts/design-verification/verify_reduced_motion.py \
  --url http://localhost:3001
```

Or let the script boot its own server:

```bash
python scripts/design-verification/verify_reduced_motion.py --start-server
```

All scripts:

- launch headless chromium
- wait for `networkidle` before DOM inspection
- write a PNG screenshot to `/tmp/teranga-verify-<slug>.png` on failure
- exit `0` on pass, `1` on failure

## Inventory

| Script                          | Covers | Task             | Status in 2026-04-13 audit |
| ------------------------------- | ------ | ---------------- | -------------------------- |
| `verify_reduced_motion.py`      | WCAG 2.3.3 | P0.1 (shipped) | pending execution          |
| `verify_font_swap.py`           | Font-loading perf | P0.2 (shipped) | pending execution   |
| `verify_sidebar_drawer.py`      | Mobile nav | C1 (shipped)  | pending execution          |
| `verify_modal_focus_trap.py`    | Dialog a11y | H5 (shipped) | pending execution          |
| `verify_discovery_chips.py`     | Chip filters | H1 (pending) | gated                    |
| `verify_detail_tabs.py`         | Event tabs  | H2 (pending) | gated                    |
| `verify_onblur_validation.py`   | Form UX    | H3 (pending)  | gated                    |
| `verify_datatable_migration.py` | Tables     | H4 (pending)  | gated                    |
| `verify_email_gate.py`          | Auth gate  | H6 (pending)  | gated                    |
| `verify_badge_darkmode.py`      | Dark-mode  | H7 (pending)  | gated                    |
| `verify_skeleton_coverage.py`   | Loading UX | H8 (pending)  | gated                    |
| `verify_empty_states.py`        | Empty UX   | N2 (pending)  | gated                    |
| `verify_chart_delta.py`         | Chart a11y | N3 (pending)  | gated                    |
| `verify_toast_placement.py`     | Toast UX   | N4 (pending)  | gated                    |
| `verify_i18n_coverage.py`       | i18n       | I1 (pending)  | gated                    |

**Gated** scripts skip the check (exit 0 with a message) if the feature isn't shipped yet — they're templates for the task-owner to flip the gate once their task lands.

## Contributing

One script per task. Keep under 150 lines. Prefer standard stdlib + Playwright; no extra deps.

Shared helpers live in `_shared.py` — import, don't duplicate.
