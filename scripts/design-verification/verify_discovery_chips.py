#!/usr/bin/env python3
"""H1 — verify event-filters use chips for date + price.

GATED: this task is not yet shipped. The script detects the pending state
(still 6 <Select> elements in event-filters.tsx) and exits with SKIP.
Flip the `GATED` flag to False once the task lands.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False  # flip to False when TASK-P1-H1 ships

TARGET = "apps/web-participant/src/components/event-filters.tsx"


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    text = (repo_root / TARGET).read_text()
    # Expect chips with aria-pressed for date + price
    if "aria-pressed" not in text:
        return False, "no aria-pressed found — chips not wired yet"
    if text.count('<Select') >= 5:
        return False, f"still using {text.count('<Select')} <Select>s — chip migration incomplete"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H1", "discovery chip filters")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]

    if GATED:
        return skip("TASK-P1-H1 not yet shipped — gate active")

    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("event-filters uses chips for date + price with aria-pressed")


if __name__ == "__main__":
    sys.exit(main())
