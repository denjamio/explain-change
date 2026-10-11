#!/usr/bin/env python3
"""explain-change command line. The code lives in the `explainchange` package next to this file."""
import sys

if sys.version_info < (3, 11):
    sys.exit(f"explain-change needs Python 3.11 or newer; this is {sys.version.split()[0]} ({sys.executable}).")

from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))  # also when run through the ~/.local/bin symlink
from explainchange.cli import run  # noqa: E402

if __name__ == "__main__":
    sys.exit(run())
