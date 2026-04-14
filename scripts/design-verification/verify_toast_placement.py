#!/usr/bin/env python3
"""N4 — verify Toaster uses breakpoint-aware placement (bottom-right ≥sm, top-center <sm).

GATED: pending TASK-P1-N4.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

TARGET = "packages/shared-ui/src/components/toaster.tsx"


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    text = (repo_root / TARGET).read_text()
    has_media = "matchMedia" in text or "useMediaQuery" in text or "window.innerWidth" in text
    has_topcenter = "top-center" in text
    if not (has_media and has_topcenter):
        return False, "Toaster lacks responsive position handling (no matchMedia + top-center)"
    return True, ""


def main() -> int:
    parser = build_arg_parser("N4", "toast breakpoint-aware placement")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-N4 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("Toaster switches position by breakpoint")


if __name__ == "__main__":
    sys.exit(main())
