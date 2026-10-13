#!/usr/bin/env python3
"""Installs or updates explain-change, without cloning. Needs only Python 3.11+.

    macOS, Linux, WSL:
        curl -fsSL https://raw.githubusercontent.com/denjamio/explain-change/main/install.py | python3 -
    Windows PowerShell:
        irm https://raw.githubusercontent.com/denjamio/explain-change/main/install.py | py -3 -
    Later updates:       explain-change update

Downloads the latest release (or EXPLAIN_CHANGE_VERSION, a tag such as v0.1.0), keeps it in
~/.local/share/explain-change (%LOCALAPPDATA%\\explain-change on Windows) and runs `explain_change.py install` from
there, which sets up the skill for the agents and the `explain-change` command.
"""
import sys

if sys.version_info < (3, 11):
    sys.exit("explain-change needs Python 3.11 or newer; this is %s (%s)." % (sys.version.split()[0], sys.executable))

import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
import tarfile  # noqa: E402
import tempfile  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
from pathlib import Path  # noqa: E402

REPO = "denjamio/explain-change"
API = f"https://api.github.com/repos/{REPO}"


def home_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "explain-change"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "explain-change"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "explain-change-installer",
                                               "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def latest_tag() -> str:
    """The latest GitHub release, else the highest vX.Y.Z tag."""
    try:
        return json.loads(get(f"{API}/releases/latest"))["tag_name"]
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    tags = [t["name"] for t in json.loads(get(f"{API}/tags?per_page=100"))
            if re.fullmatch(r"v\d+\.\d+\.\d+", t["name"])]
    if not tags:
        sys.exit(f"No release of {REPO} yet. Set EXPLAIN_CHANGE_VERSION to a tag or branch.")
    return max(tags, key=lambda t: tuple(int(x) for x in t[1:].split(".")))


def download(tag: str, into: Path) -> Path:
    """Extracts the source of `tag` into `into` and returns its folder."""
    archive = into / "src.tar.gz"
    archive.write_bytes(get(f"https://codeload.github.com/{REPO}/tar.gz/{tag}"))
    with tarfile.open(archive) as tar:
        root = into.resolve()
        for m in tar.getmembers():  # no absolute paths, `..` or links out of the folder
            if not (root / m.name).resolve().is_relative_to(root) or m.issym() or m.islnk():
                sys.exit(f"Unexpected entry in the release archive: {m.name}")
        tar.extractall(into, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))
    archive.unlink()
    (folder,) = [p for p in into.iterdir() if p.is_dir()]
    return folder


def main() -> int:
    tag = os.environ.get("EXPLAIN_CHANGE_VERSION") or latest_tag()
    target = home_dir()
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"explain-change {tag} → {target}")
    with tempfile.TemporaryDirectory(dir=target.parent, prefix=".explain-change-") as tmp:
        new = download(tag, Path(tmp))
        (new / ".release").write_text(tag + "\n", encoding="utf-8")
        old = Path(tmp) / "previous"
        if target.exists():
            target.rename(old)  # same filesystem, so the swap is quick; the links keep pointing at `target`
        try:
            new.rename(target)
        except OSError:
            if old.exists():
                old.rename(target)  # put the previous version back
            raise
    return subprocess.call([sys.executable, str(target / "explain_change.py"), "install"])


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as e:
        sys.exit(f"Download failed: {e}. Check your connection or proxy, then run the installer again.")
