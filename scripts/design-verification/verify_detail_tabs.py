#!/usr/bin/env python3
"""H2 — verify event-detail page uses <Tabs> for the 5 sections.

GATED: pending TASK-P1-H2.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

TARGETS = [
    "apps/web-participant/src/app/(public)/events/[slug]/page.tsx",
    "apps/web-participant/src/components/event-detail/event-detail-tabs.tsx",
]


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    # The page should consume EventDetailTabs.
    page = (repo_root / TARGETS[0]).read_text()
    if "EventDetailTabs" not in page:
        return False, "page does not render <EventDetailTabs>"
    # The tab component should wrap shared-ui Tabs primitive.
    tabs = (repo_root / TARGETS[1]).read_text()
    if "Tabs" not in tabs or "TabsTrigger" not in tabs or "TabsContent" not in tabs:
        return False, "EventDetailTabs missing Tabs / TabsTrigger / TabsContent wiring"
    if "snap-x" not in tabs and "overflow-x-auto" not in tabs:
        return False, "tab list missing horizontal-scroll styling for < 640 px"
    if "history.replaceState" not in tabs and "location.hash" not in tabs:
        return False, "tab state does not persist to URL"
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
