#!/usr/bin/env python3
"""P0.2 — verify next/font Inter() uses display:"swap" and pinned weights.

Static-only check: parses apps/{web-backoffice,web-participant}/src/app/layout.tsx
and asserts both `display: "swap"` and `weight: ["400","500","600","700"]` appear
inside the Inter() call.

Shipped by: PR #16, commit bc0d179.
"""

from __future__ import annotations

import pathlib
import re
import sys

from _shared import build_arg_parser, fail, pass_


LAYOUT_PATHS = [
    "apps/web-backoffice/src/app/layout.tsx",
    "apps/web-participant/src/app/layout.tsx",
]


INTER_CALL_RE = re.compile(r"Inter\s*\(\s*\{([^}]*)\}\s*\)", re.DOTALL)


def check_layout(path: pathlib.Path) -> tuple[bool, str]:
    text = path.read_text()
    m = INTER_CALL_RE.search(text)
    if not m:
        return False, f"no Inter() call found in {path}"
    body = m.group(1)
    if 'display: "swap"' not in body and "display:'swap'" not in body:
        return False, f"display:'swap' missing in {path}"
    if not re.search(r'weight:\s*\[\s*"400"\s*,\s*"500"\s*,\s*"600"\s*,\s*"700"\s*\]', body):
        return False, f"weight pinning missing in {path}"
    return True, ""


def main() -> int:
    parser = build_arg_parser("P0.2", "next/font display:swap + pinned weights")
    parser.parse_args()  # consume args even if unused
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    errors: list[str] = []
    for rel in LAYOUT_PATHS:
        ok, err = check_layout(repo_root / rel)
        if not ok:
            errors.append(err)
    if errors:
        for e in errors:
            print(f"[FAIL] {e}", file=sys.stderr)
        return fail("font swap static check failed")
    return pass_("next/font Inter() has display:swap and pinned weights in both apps")


if __name__ == "__main__":
    sys.exit(main())
