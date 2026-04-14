#!/usr/bin/env python3
"""H8 — verify no page-level "Chargement" text remains (migrated to Skeleton).

GATED: pending TASK-P1-H8. BrandedLoader calls are allowed (branded full-screen).
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True

ALLOW_PATTERNS = ("BrandedLoader", "label={")  # BrandedLoader carries "Chargement" as a prop; acceptable


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    offenders: list[str] = []
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            text = f.read_text()
            if "Chargement" not in text:
                continue
            # If the only occurrences are inside BrandedLoader props, allow
            if all(any(allow in line for allow in ALLOW_PATTERNS) for line in text.splitlines() if "Chargement" in line):
                continue
            offenders.append(f.relative_to(repo_root).as_posix())
    if offenders:
        return False, f"{len(offenders)} files still render 'Chargement' text: {offenders}"
    return True, ""


def main() -> int:
    parser = build_arg_parser("H8", "skeleton coverage completion")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-H8 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("no stray 'Chargement' text outside BrandedLoader")


if __name__ == "__main__":
    sys.exit(main())
