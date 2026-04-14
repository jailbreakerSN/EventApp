#!/usr/bin/env python3
"""I1c — verify a floor of useTranslations consumer pages.

Sub-PR I1c of 4 for TASK-P1-I1. Migrates top-offender pages to
useTranslations / getTranslations so the runtime locale actually
drives visible strings.

Check: ≥ 5 files use useTranslations() or getTranslations(). I1d will
expand coverage; the full I1 gate (verify_i18n_coverage.py, floor = 50)
still fires only once the long-tail lands.
"""

from __future__ import annotations

import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = False
FLOOR = 5


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    hits: list[str] = []
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            text = f.read_text()
            if "useTranslations(" in text or "getTranslations(" in text:
                hits.append(f.relative_to(repo_root).as_posix())
        for f in d.rglob("*.ts"):
            text = f.read_text()
            if "useTranslations(" in text or "getTranslations(" in text:
                hits.append(f.relative_to(repo_root).as_posix())
    if len(hits) < FLOOR:
        return False, f"only {len(hits)} file(s) use useTranslations (floor: {FLOOR}): {hits}"
    return True, ""


def main() -> int:
    parser = build_arg_parser("I1c", "top-offender useTranslations extraction")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-I1c not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_(f"≥ {FLOOR} files consume useTranslations")


if __name__ == "__main__":
    sys.exit(main())
