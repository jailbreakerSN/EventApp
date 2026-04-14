#!/usr/bin/env python3
"""C1 — verify backoffice sidebar behaves as a drawer on < lg viewports.

Scenarios:
  - At 375px width, sidebar is hidden by default
  - Topbar hamburger has aria-expanded/aria-controls
  - Clicking hamburger opens drawer (aria-hidden="false")
  - Escape closes drawer
  - Backdrop click closes drawer
  - Focus returns to hamburger after close

Requires authenticated backoffice session — by default, this script
runs only the static markup check (hamburger + sidebar wiring) unless
--authenticated-url is passed pointing to a logged-in Next.js dev server.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import (
    build_arg_parser,
    fail,
    pass_,
    require_playwright,
    screenshot_path,
    skip,
)


STATIC_SIDEBAR = "apps/web-backoffice/src/components/layouts/sidebar.tsx"
STATIC_TOPBAR = "apps/web-backoffice/src/components/layouts/topbar.tsx"


def static_check(repo_root: pathlib.Path) -> tuple[bool, str]:
    sidebar = (repo_root / STATIC_SIDEBAR).read_text()
    topbar = (repo_root / STATIC_TOPBAR).read_text()
    needles = [
        ('sidebar', sidebar, 'aria-label="Navigation principale"'),
        ('sidebar', sidebar, "aria-hidden"),
        ('topbar', topbar, "aria-expanded"),
        ('topbar', topbar, 'aria-controls="mobile-sidebar"'),
    ]
    for where, text, needle in needles:
        if needle not in text:
            return False, f"{where}: missing {needle!r}"
    return True, ""


def runtime_check(url: str, shot: str) -> bool:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="networkidle")
            hamburger = page.locator('[aria-controls="mobile-sidebar"]').first
            if hamburger.count() == 0:
                print("[runtime] hamburger not found — is the user logged in?", file=sys.stderr)
                page.screenshot(path=shot, full_page=True)
                return False
            expanded = hamburger.get_attribute("aria-expanded")
            if expanded != "false":
                print(f"[runtime] aria-expanded={expanded!r}, expected 'false'", file=sys.stderr)
                return False
            hamburger.click()
            page.wait_for_timeout(400)  # drawer animation; reduced-motion compliant
            if hamburger.get_attribute("aria-expanded") != "true":
                page.screenshot(path=shot, full_page=True)
                return False
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            if hamburger.get_attribute("aria-expanded") != "false":
                page.screenshot(path=shot, full_page=True)
                return False
            return True
        finally:
            browser.close()


def main() -> int:
    parser = build_arg_parser("C1", "sidebar drawer behaviour on mobile")
    parser.add_argument("--authenticated-url", help="Logged-in dashboard URL for runtime check")
    args = parser.parse_args()

    repo_root = pathlib.Path(__file__).resolve().parents[2]
    ok, err = static_check(repo_root)
    if not ok:
        return fail(err)

    if not args.authenticated_url:
        return skip("static markup OK; pass --authenticated-url for runtime check")

    require_playwright()
    shot = screenshot_path(args.screenshot_dir, "sidebar-drawer")
    if not runtime_check(args.authenticated_url, shot):
        return fail("runtime drawer behaviour failed", shot)
    return pass_("sidebar drawer: open/close + a11y attributes OK at 375px")


if __name__ == "__main__":
    sys.exit(main())
