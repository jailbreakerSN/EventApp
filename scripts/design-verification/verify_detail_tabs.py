#!/usr/bin/env python3
"""H2 — verify event-detail page uses <Tabs> for the 5 sections.

GATED: pending TASK-P1-H2.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True

TARGET = "apps/web-participant/src/app/(public)/events/[slug]/page.tsx"


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    text = (repo_root / TARGET).read_text()
    if "<Tabs" not in text:
        return False, "no <Tabs> found — tab structure not implemented"
    if 'role="tabpanel"' not in text and "TabsPanel" not in text:
        return False, "no tabpanel role — incomplete a11y"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H2", "event-detail tabs")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H2 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("event-detail uses <Tabs> with tabpanel semantics")


if __name__ == "__main__":
    sys.exit(main())
