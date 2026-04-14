#!/usr/bin/env python3
"""H4 — verify raw <table> migrations to DataTable.

GATED: pending TASK-P1-H4 sub-PRs (a/b/c/d).
Allow-list holds legitimate non-DataTable semantic tables (pricing comparison).
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

# Files allowed to remain as raw <table>:
# - PlanComparisonTable: semantic pricing comparison (not a data grid)
# - Scope-excluded pages for H4b/c/d (sub-PRs not yet merged)
ALLOW_LIST = {
    "apps/web-backoffice/src/components/plan/PlanComparisonTable.tsx",
    # H4b scope — event detail + check-in: MIGRATED.
    # (files removed from allow-list; any new <table> in these would fail.)
    # H4c scope — finance / analytics / dashboard / events / venues[venueId]:
    # MIGRATED (files removed from allow-list).
    # H4d scope — participant side: MIGRATED.
    # events/compare/page.tsx is intentionally kept as raw <table> — it is a
    # side-by-side comparison grid where events are the columns (not rows),
    # so the DataTable row-per-item model does not apply. Same rationale as
    # PlanComparisonTable.tsx above.
    "apps/web-participant/src/app/(public)/events/compare/page.tsx",
}


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    offenders: list[str] = []
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            rel = f.relative_to(repo_root).as_posix()
            if rel in ALLOW_LIST:
                continue
            if "<table" in f.read_text():
                offenders.append(rel)
    if offenders:
        return False, f"{len(offenders)} file(s) still use raw <table>: {offenders[:5]}..."
    return True, ""


def main() -> int:
    parser = build_arg_parser("H4", "DataTable migration")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H4 not yet fully shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("all tabular views use DataTable (except pricing comparison)")


if __name__ == "__main__":
    sys.exit(main())
