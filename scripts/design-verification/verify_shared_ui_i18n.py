#!/usr/bin/env python3
"""I1a — verify shared-UI strings are hoisted into the labels dictionary.

I1a is the first sub-PR of TASK-P1-I1 (next-intl wiring). It hoists
every hardcoded French string in `@teranga/shared-ui` into a typed
labels interface with French defaults. Consumers pass translated
strings per render (or a full dictionary) without shared-ui depending
on any specific i18n runtime.

Checks enforced:
  1. packages/shared-ui/src/lib/i18n.ts exists and exports
     `TerangaUILocale` + `DEFAULT_UI_LOCALE_FR`.
  2. The following components import from the i18n module (their
     strings now come from the dictionary, not inline literals):
       - pagination.tsx  → PaginationLabels
       - toaster.tsx     → ToasterLabels
       - offline-banner.tsx → OfflineBannerLabels
       - file-upload.tsx → FileUploadLabels
  3. Legacy hardcoded aria-labels removed from those files
     (regex check — no literal "Page précédente" etc.).
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False

I18N_MODULE = "packages/shared-ui/src/lib/i18n.ts"

REQUIRED_IMPORTS = {
    "packages/shared-ui/src/components/pagination.tsx": "PaginationLabels",
    "packages/shared-ui/src/components/toaster.tsx": "ToasterLabels",
    "packages/shared-ui/src/components/offline-banner.tsx": "OfflineBannerLabels",
    "packages/shared-ui/src/components/file-upload.tsx": "FileUploadLabels",
}

# If any of these literals remain in the listed file, the component is
# still rendering hardcoded French (I1a incomplete for that component).
FORBIDDEN_LITERALS = {
    "packages/shared-ui/src/components/pagination.tsx": [
        'aria-label="Pagination"',
        'aria-label="Page précédente"',
        'aria-label="Page suivante"',
    ],
    "packages/shared-ui/src/components/toaster.tsx": [
        'aria-label="Notifications"',
    ],
    "packages/shared-ui/src/components/file-upload.tsx": [
        'aria-label="Supprimer le fichier"',
        '"Type de fichier non accepté"',
    ],
}


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    i18n_path = repo_root / I18N_MODULE
    if not i18n_path.exists():
        return False, f"{I18N_MODULE} missing — shared-UI i18n module not created"
    i18n_text = i18n_path.read_text()
    if "TerangaUILocale" not in i18n_text or "DEFAULT_UI_LOCALE_FR" not in i18n_text:
        return False, f"{I18N_MODULE} does not export TerangaUILocale + DEFAULT_UI_LOCALE_FR"

    for rel, import_name in REQUIRED_IMPORTS.items():
        text = (repo_root / rel).read_text()
        if import_name not in text:
            return False, f"{rel} does not import {import_name} from ../lib/i18n"
        if 'from "../lib/i18n"' not in text:
            return False, f"{rel} does not reference ../lib/i18n"

    for rel, literals in FORBIDDEN_LITERALS.items():
        text = (repo_root / rel).read_text()
        for lit in literals:
            if lit in text:
                return False, f"{rel} still contains hardcoded literal: {lit}"

    return True, ""


def main() -> int:
    parser = build_arg_parser("I1a", "shared-UI i18n extraction")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-I1a not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("shared-UI strings hoisted into TerangaUILocale dictionary")


if __name__ == "__main__":
    sys.exit(main())
