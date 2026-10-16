#!/usr/bin/env python3
"""Moves a 0.1.x install (Python) to the 0.2 standalone binary. Python standard library only.

`explain-change update` in 0.1.x downloads the latest release's source and runs `explain_change.py install` from it.
This file answers that call: it downloads the binary for this machine into ~/.local/bin (replacing the old link to
the Python script) and lets it install the agent skills. Anything else points to the new installer.
Remove this file once 0.1.x installs are gone.
"""
import os
import platform
import stat
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "denjamio/explain-change"
INSTALLER = f"curl -fsSL https://raw.githubusercontent.com/{REPO}/main/install.sh | sh"


def asset() -> str:
    os_name = {"Linux": "linux", "Darwin": "darwin", "Windows": "windows"}.get(platform.system())
    arch = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower())
    if not os_name or not arch:
        sys.exit(f"explain-change: no binary for {platform.system()} {platform.machine()}; "
                 "install with npm: npm install -g explain-change")
    return f"explain-change-{os_name}-{arch}" + (".exe" if os_name == "windows" else "")


def main() -> int:
    if sys.argv[1:2] != ["install"]:
        sys.exit(f"explain-change 0.2 is a standalone binary. Install it with:\n  {INSTALLER}")
    if os.name == "nt":
        bindir = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "explain-change" / "bin"
        target = bindir / "explain-change.exe"
    else:
        bindir = Path.home() / ".local" / "bin"
        target = bindir / "explain-change"
    tag = os.environ.get("EXPLAIN_CHANGE_VERSION")
    base = os.environ.get("EXPLAIN_CHANGE_RELEASES", f"https://github.com/{REPO}/releases")
    url = f"{base}/download/{tag}/{asset()}" if tag else f"{base}/latest/download/{asset()}"
    bindir.mkdir(parents=True, exist_ok=True)
    print(f"explain-change: moving to the 0.2 binary from {url}", flush=True)
    with tempfile.NamedTemporaryFile(dir=bindir, delete=False) as tmp:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "explain-change"}), timeout=120) as r:
            tmp.write(r.read())
    new = Path(tmp.name)
    new.chmod(new.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    if target.is_symlink() or target.exists():
        target.unlink()  # the 0.1 link to this script; never write through it
    new.rename(target)
    code = subprocess.call([str(target), "install"])
    print(f"explain-change: {target} is now the 0.2 binary. The old Python copy can be deleted.")
    return code


if __name__ == "__main__":
    sys.exit(main())
