#!/usr/bin/env python3
"""N2 — verify EmptyState component is used on list pages that can render zero rows.

GATED: pending TASK-P1-N2. Target: ≥ 10 files import EmptyState.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False
FLOOR = 10


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    using = set()
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            text = f.read_text()
            if "EmptyState" in text:
                using.add(f.relative_to(repo_root).as_posix())
    if len(using) < FLOOR:
        return False, f"only {len(using)} file(s) use EmptyState (floor: {FLOOR})"
    return True, ""


def main() -> int:
    parser = build_arg_parser("N2", "empty-state migration")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-N2 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_(f"EmptyState used in ≥ {FLOOR} files")


if __name__ == "__main__":
    sys.exit(main())
