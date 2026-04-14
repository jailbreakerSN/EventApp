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


GATED = False

# Inline Badge lookalike signature: `rounded-full` co-occurring with
# `bg-<color>-(50|100)` and `text-<color>-(700|800)` on the same
# className string. This targets hand-rolled Badge pills only.
# Alert cards (rounded-md / rounded-lg with bg-*-50 and an explicit
# dark: utility class) and buttons (bg-*-500/600) are out of scope.
# Status-config lookup records (const KEY: { className: "bg-*-100 text-*-700" })
# are also targeted — they feed hand-rolled Badges.
BADGE_PATTERN = re.compile(
    r"(?:rounded-full[^\"']*?bg-(?:emerald|amber|red|green)-(?:50|100)[^\"']*?text-(?:emerald|amber|red|green)-(?:700|800)"
    r"|bg-(?:emerald|amber|red|green)-(?:50|100)[^\"']*?text-(?:emerald|amber|red|green)-(?:700|800)[^\"']*?rounded-full"
    r"|className:\s*[\"']bg-(?:emerald|amber|red|green)-(?:50|100)\s+text-(?:emerald|amber|red|green)-(?:700|800))"
)
CEILING = 5  # legitimate Badge-color remnants (documented inline)


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    offending_files = set()
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            if BADGE_PATTERN.search(f.read_text()):
                offending_files.add(f.relative_to(repo_root).as_posix())
    if len(offending_files) > CEILING:
        return False, f"{len(offending_files)} files still carry Badge-style bg-*-100 / text-*-700-800 pairs (ceiling: {CEILING}): {sorted(offending_files)[:10]}"
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
