#!/usr/bin/env python3
"""H5 — verify ConfirmDialog uses native <dialog>/showModal() with trap + Escape.

Static check: confirm-dialog.tsx uses <dialog>, showModal(), aria-modal,
aria-labelledby, and theme tokens (bg-card / text-foreground).
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_


TARGET = "packages/shared-ui/src/components/confirm-dialog.tsx"

REQUIRED_NEEDLES = [
    ("showModal", "showModal()"),
    ("dialog-tag", "<dialog"),
    ("aria-modal", "aria-modal"),
    ("aria-labelledby", "aria-labelledby"),
    ("bg-card-token", "bg-card"),
    ("text-foreground-token", "text-foreground"),
]


def main() -> int:
    parser = build_arg_parser("H5", "ConfirmDialog a11y static check")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    text = (repo_root / TARGET).read_text()
    missing = [name for name, needle in REQUIRED_NEEDLES if needle not in text]
    if missing:
        print(f"[FAIL] missing: {', '.join(missing)}", file=sys.stderr)
        return fail("ConfirmDialog static a11y check failed")
    return pass_("ConfirmDialog uses native <dialog>, aria-modal, labelledby, theme tokens")


if __name__ == "__main__":
    sys.exit(main())
