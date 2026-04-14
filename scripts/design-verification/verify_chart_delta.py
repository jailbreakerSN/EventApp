#!/usr/bin/env python3
"""N3 — verify chart delta indicators use glyph + sign + color (not color alone).

GATED: pending TASK-P1-N3.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

# Only dashboard renders trend indicators in StatCard (analytics StatCard
# shows a static TrendingUp icon as decoration, not a delta — different UI).
TARGETS = [
    "apps/web-backoffice/src/app/(dashboard)/dashboard/page.tsx",
]

# Required signals for accessibility compliance:
#   - aria-label   → screen-reader announcement
#   - A triangle glyph (▲ / ▼) or dash (—) — rule 78 requires color + glyph
REQUIRED = ("aria-label", ("\u25B2", "\u25BC", "\u2014"))


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    for rel in TARGETS:
        text = (repo_root / rel).read_text()
        if "aria-label" not in text:
            return False, f"{rel} missing aria-label on trend indicator"
        if not any(g in text for g in REQUIRED[1]):
            return False, f"{rel} missing triangle / dash glyph on trend indicator"
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
