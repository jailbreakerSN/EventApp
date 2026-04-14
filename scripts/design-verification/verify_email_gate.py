#!/usr/bin/env python3
"""H6 — verify hard email-verification gate on dashboard routes.

GATED: pending TASK-P1-H6.
Runtime test requires Firebase Auth emulator with two seeded users
(one verified, one unverified > grace period).
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True

TARGET = "apps/web-backoffice/src/app/(dashboard)/layout.tsx"


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    text = (repo_root / TARGET).read_text()
    if "emailVerified" not in text:
        return False, "dashboard layout does not reference emailVerified"
    if "/verify-email" not in text:
        return False, "no redirect to /verify-email found"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H6", "email verification hard gate")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H6 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("email verification gate wired in DashboardLayout")


if __name__ == "__main__":
    sys.exit(main())
