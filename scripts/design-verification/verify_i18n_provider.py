#!/usr/bin/env python3
"""I1b — verify NextIntlClientProvider wiring + cookie-based language switcher.

Sub-PR I1b of 4 for TASK-P1-I1. Wires the next-intl provider into both
web apps' root layouts, reads the locale from a cookie, and exposes a
<LanguageSwitcher> primitive from shared-ui.

Checks:
  1. Each app's root layout imports NextIntlClientProvider and
     getLocale/getMessages from next-intl/server.
  2. Each app's i18n/request.ts reads from a cookie (LOCALE_COOKIE).
  3. supportedLocales now includes "wo" (Wolof seed ships in I1b).
  4. Each app ships a messages/wo.json file, even if only a seed.
  5. shared-ui exports <LanguageSwitcher>.
  6. Each app has a next/navigation wrapper at components/language-switcher.tsx
     that calls router.refresh() on locale change.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

APPS = ("web-backoffice", "web-participant")


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    for app in APPS:
        app_root = repo_root / "apps" / app / "src"
        # 1. NextIntlClientProvider in root layout
        layout = (app_root / "app" / "layout.tsx").read_text()
        if "NextIntlClientProvider" not in layout:
            return False, f"{app}/src/app/layout.tsx missing NextIntlClientProvider"
        if "getMessages" not in layout or "getLocale" not in layout:
            return False, f"{app}/src/app/layout.tsx missing getLocale/getMessages"
        # 2. i18n/request.ts reads cookie
        req = (app_root / "i18n" / "request.ts").read_text()
        if "cookies" not in req or "LOCALE_COOKIE" not in req:
            return False, f"{app}/src/i18n/request.ts does not read the locale cookie"
        # 3. supportedLocales includes wo
        if '"wo"' not in req:
            return False, f'{app}/src/i18n/request.ts does not list "wo" in supportedLocales'
        # 4. messages/wo.json exists
        wo = app_root / "i18n" / "messages" / "wo.json"
        if not wo.exists():
            return False, f"{app}/src/i18n/messages/wo.json missing (Wolof seed)"
        # 6. LanguageSwitcher wrapper
        switcher = (app_root / "components" / "language-switcher.tsx").read_text()
        if "router.refresh" not in switcher:
            return False, f"{app}/src/components/language-switcher.tsx does not call router.refresh()"

    # 5. shared-ui exports LanguageSwitcher
    index = (repo_root / "packages" / "shared-ui" / "src" / "index.ts").read_text()
    if "LanguageSwitcher" not in index:
        return False, "packages/shared-ui/src/index.ts does not export LanguageSwitcher"

    return True, ""


def main() -> int:
    parser = build_arg_parser("I1b", "next-intl provider + language selector")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-I1b not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("NextIntlClientProvider + cookie locale + LanguageSwitcher wired")


if __name__ == "__main__":
    sys.exit(main())
