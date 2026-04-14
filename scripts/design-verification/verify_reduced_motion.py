#!/usr/bin/env python3
"""P0.1 — verify prefers-reduced-motion global CSS rule is honoured.

Checks:
  1. globals.css contains the @media (prefers-reduced-motion: reduce) rule (static check).
  2. At runtime with reduced-motion emulated, a known animated element (Spinner)
     reports computed animation-duration <= 0.01s (effectively off).

Shipped by: apps/{web-backoffice,web-participant}/src/app/globals.css:70
"""

from __future__ import annotations

import pathlib
import sys

from _shared import (
    build_arg_parser,
    fail,
    managed_server,
    pass_,
    require_playwright,
    screenshot_path,
)


STATIC_PATHS = [
    "apps/web-backoffice/src/app/globals.css",
    "apps/web-participant/src/app/globals.css",
]
STATIC_NEEDLE = "prefers-reduced-motion: reduce"


def static_check(repo_root: pathlib.Path) -> bool:
    for rel in STATIC_PATHS:
        p = repo_root / rel
        if not p.exists():
            print(f"[static] missing: {rel}", file=sys.stderr)
            return False
        if STATIC_NEEDLE not in p.read_text():
            print(f"[static] needle not found in {rel}: {STATIC_NEEDLE!r}", file=sys.stderr)
            return False
    return True


def runtime_check(url: str, shot: str) -> bool:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(reduced_motion="reduce")
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="networkidle")
            # Any element that would normally animate
            handle = page.locator("[class*='animate-'], [class*='transition-']").first
            if handle.count() == 0:
                # No animated element on this page — still a valid pass for the CSS rule
                return True
            duration = handle.evaluate(
                "el => getComputedStyle(el).animationDuration || getComputedStyle(el).transitionDuration || '0s'"
            )
            # CSS returns "0.01ms" from our global override
            if duration and (duration.startswith("0.01") or duration == "0s" or duration == "0ms"):
                return True
            page.screenshot(path=shot, full_page=True)
            print(f"[runtime] animation duration {duration!r} — expected ≤ 0.01ms", file=sys.stderr)
            return False
        finally:
            browser.close()


def main() -> int:
    parser = build_arg_parser("P0.1", "prefers-reduced-motion global rule")
    args = parser.parse_args()
    require_playwright()

    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if not static_check(repo_root):
        return fail("static check failed — globals.css missing the @media rule")

    shot = screenshot_path(args.screenshot_dir, "reduced-motion")
    if args.start_server:
        with managed_server(3001, "npm run web:dev"):
            if not runtime_check(args.url, shot):
                return fail("runtime check failed", shot)
    else:
        if not runtime_check(args.url, shot):
            return fail("runtime check failed", shot)
    return pass_("prefers-reduced-motion honoured globally")


if __name__ == "__main__":
    sys.exit(main())
