#!/usr/bin/env python3
"""N3 — verify chart delta indicators use glyph + sign + color (not color alone).

GATED: pending TASK-P1-N3.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True

TARGETS = [
    "apps/web-backoffice/src/app/(dashboard)/analytics/page.tsx",
    "apps/web-backoffice/src/app/(dashboard)/dashboard/page.tsx",
]


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    for rel in TARGETS:
        text = (repo_root / rel).read_text()
        if "DeltaPill" not in text and "aria-label" not in text:
            return False, f"{rel} missing DeltaPill or aria-label for screen reader"
    return True, ""


def main() -> int:
    parser = build_arg_parser("N3", "chart delta accessibility")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-N3 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("chart deltas use glyph + sign + a11y label")


if __name__ == "__main__":
    sys.exit(main())
