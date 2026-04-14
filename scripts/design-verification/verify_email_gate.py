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


GATED = False

LAYOUT = "apps/web-backoffice/src/app/(dashboard)/layout.tsx"
PAGE = "apps/web-backoffice/src/app/(auth)/verify-email/page.tsx"


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    layout = (repo_root / LAYOUT).read_text()
    if "emailVerified" not in layout:
        return False, "dashboard layout does not reference emailVerified"
    if "/verify-email" not in layout:
        return False, "dashboard layout does not redirect to /verify-email"
    if "GRACE_DAYS" not in layout and "grace" not in layout.lower():
        return False, "no grace period logic — would lock out users immediately"
    if "super_admin" not in layout:
        return False, "super_admin exemption missing"
    if not (repo_root / PAGE).exists():
        return False, f"{PAGE} does not exist"
    page = (repo_root / PAGE).read_text()
    if "resendVerification" not in page:
        return False, "/verify-email page missing resend affordance"
    if "getIdToken" not in page and "reload" not in page:
        return False, "/verify-email page missing refresh/check affordance"
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
