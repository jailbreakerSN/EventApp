#!/usr/bin/env python3
"""H7 — verify Badge call-sites use semantic tokens, not raw bg-emerald/amber/red/green.

GATED: pending TASK-P1-H7. Target: reduce hardcoded occurrences from 92 → ≤ ~15
(legitimate non-Badge uses).
"""

from __future__ import annotations

import pathlib
import re
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True

PATTERN = re.compile(r"bg-(emerald|amber|red|green)-\d+")
CEILING = 15  # acceptable legitimate uses (feed indicators, payment cards)


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    offending_files = set()
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            if PATTERN.search(f.read_text()):
                offending_files.add(f.relative_to(repo_root).as_posix())
    if len(offending_files) > CEILING:
        return False, f"{len(offending_files)} files use hardcoded bg colors (ceiling: {CEILING})"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H7", "badge call-site dark-mode sweep")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H7 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("hardcoded bg-emerald/amber/red/green within ceiling")


if __name__ == "__main__":
    sys.exit(main())
