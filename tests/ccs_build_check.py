#!/usr/bin/env python3
"""Run the repository R3 cl2000 compile/link gate from the tests directory."""

from __future__ import annotations

import pathlib
import runpy
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if __name__ == "__main__":
    namespace = runpy.run_path(str(ROOT / "ccs_build_check.py"))
    sys.exit(namespace["main"]())
