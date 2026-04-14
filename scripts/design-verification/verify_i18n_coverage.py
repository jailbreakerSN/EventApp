#!/usr/bin/env python3
"""I1 — verify next-intl coverage: useTranslations usage + message-file key counts.

GATED: pending TASK-P1-I1 (a/b/c/d sub-PRs).

Floors enforced (for I1c+I1d done):
  - ≥ 50 files call useTranslations / getTranslations
  - fr.json ≥ 450 keys per app
  - en.json mirrors fr.json key count (±10)
  - wo.json exists (values can be TODOs)
"""

from __future__ import annotations

import json
import pathlib
import sys

from _shared import build_arg_parser, fail, pass_, skip


GATED = True
FILES_FLOOR = 50
KEYS_FLOOR = 450


def count_json_keys(path: pathlib.Path) -> int:
    if not path.exists():
        return -1
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return -1

    def walk(obj, acc=0):
        if isinstance(obj, dict):
            for v in obj.values():
                acc = walk(v, acc + 1)
        return acc

    return walk(data)


def check(repo_root: pathlib.Path) -> tuple[bool, str]:
    web_dirs = [repo_root / "apps" / "web-backoffice" / "src", repo_root / "apps" / "web-participant" / "src"]
    using = 0
    for d in web_dirs:
        for f in d.rglob("*.tsx"):
            text = f.read_text()
            if "useTranslations" in text or "getTranslations" in text:
                using += 1
    if using < FILES_FLOOR:
        return False, f"only {using} file(s) use next-intl hooks (floor: {FILES_FLOOR})"

    for app in ("web-backoffice", "web-participant"):
        msgs = repo_root / "apps" / app / "src" / "i18n" / "messages"
        fr_count = count_json_keys(msgs / "fr.json")
        en_count = count_json_keys(msgs / "en.json")
        wo = msgs / "wo.json"
        if fr_count < KEYS_FLOOR:
            return False, f"{app}/fr.json has {fr_count} keys (floor: {KEYS_FLOOR})"
        if en_count < 0:
            return False, f"{app}/en.json missing or invalid JSON"
        if abs(en_count - fr_count) > 10:
            return False, f"{app}/en.json key count {en_count} diverges from fr ({fr_count})"
        if not wo.exists():
            return False, f"{app}/wo.json does not exist"
    return True, ""


def main() -> int:
    parser = build_arg_parser("I1", "next-intl coverage")
    parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parents[2]
    if GATED:
        return skip("TASK-P1-I1 not yet shipped — gate active")
    ok, err = check(repo_root)
    if not ok:
        return fail(err)
    return pass_("i18n coverage within floors; wo.json stubs present")


if __name__ == "__main__":
    sys.exit(main())
