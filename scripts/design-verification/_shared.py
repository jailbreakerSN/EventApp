"""Shared helpers for Teranga design-verification scripts.

Kept small on purpose — see .claude/skills/webapp-testing/SKILL.md for
the canonical pattern (with_server.py for lifecycle, headless chromium,
wait_for_load_state('networkidle') before DOM inspection).
"""

from __future__ import annotations

import argparse
import contextlib
import os
import pathlib
import subprocess
import sys
import time
from typing import Iterator


DEFAULT_BACKOFFICE_URL = "http://localhost:3001"
DEFAULT_PARTICIPANT_URL = "http://localhost:3002"


def build_arg_parser(task_id: str, description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=f"{task_id} — {description}",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--url", default=DEFAULT_PARTICIPANT_URL, help="Base URL under test")
    p.add_argument(
        "--start-server",
        action="store_true",
        help="Boot npm run web:dev via with_server.py (otherwise assumes server is running)",
    )
    p.add_argument(
        "--screenshot-dir",
        default="/tmp",
        help="Where to write failure screenshots",
    )
    p.add_argument("--task-id", default=task_id, help=argparse.SUPPRESS)
    return p


@contextlib.contextmanager
def managed_server(port: int, command: str) -> Iterator[None]:
    """Optional server lifecycle — shells out to with_server.py if requested.

    Callers can also just run the server themselves in another terminal and
    pass --url. This helper is only used when --start-server is set.
    """
    helper = pathlib.Path(__file__).resolve().parents[2] / ".claude" / "skills" / "webapp-testing" / "scripts" / "with_server.py"
    if not helper.exists():
        print(f"[warn] {helper} not found — assuming server is already running", file=sys.stderr)
        yield
        return
    proc = subprocess.Popen(
        [sys.executable, str(helper), "--server", command, "--port", str(port), "--", "sleep", "0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(5)  # crude readiness; with_server.py has its own probe logic
        yield
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def screenshot_path(screenshot_dir: str, task_id: str) -> str:
    pathlib.Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
    return os.path.join(screenshot_dir, f"teranga-verify-{task_id.lower()}.png")


def require_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        print(
            "playwright not installed.\n"
            "  pip install playwright && playwright install chromium\n",
            file=sys.stderr,
        )
        sys.exit(2)


def pass_(msg: str) -> int:
    print(f"[PASS] {msg}")
    return 0


def fail(msg: str, screenshot: str | None = None) -> int:
    print(f"[FAIL] {msg}", file=sys.stderr)
    if screenshot:
        print(f"  screenshot: {screenshot}", file=sys.stderr)
    return 1


def skip(msg: str) -> int:
    print(f"[SKIP] {msg}")
    return 0
