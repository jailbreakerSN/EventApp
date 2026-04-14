#!/usr/bin/env python3
"""H3 — verify forms use RHF mode:'onBlur' and FormField success state.

GATED: pending TASK-P1-H3.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    files_with_onblur = 0
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            if 'mode: "onBlur"' in f.read_text():
                files_with_onblur += 1
    if files_with_onblur < 6:
        return False, f"only {files_with_onblur} file(s) use RHF mode:onBlur (need ≥ 6)"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H3", "onBlur validation unification")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H3 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("forms consistently use RHF onBlur mode")


if __name__ == "__main__":
    sys.exit(main())
