"""Parses `git diff` output and resolves the base ref."""
from __future__ import annotations

import re
from pathlib import Path

from .constants import MAX_FILE_BYTES
from .util import Fail, git


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$")


def parse_diff(text: str) -> list[dict]:
    files: list[dict] = []
    cur = hunk = None
    old_rem = new_rem = 0
    for raw in text.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        if hunk is not None and (old_rem > 0 or new_rem > 0):
            if line.startswith("\\"):
                continue
            t, body = (line[:1] or " "), line[1:]
            if t == "+":
                new_rem -= 1
                cur["add"] += 1
            elif t == "-":
                old_rem -= 1
                cur["del"] += 1
            else:
                t = " "
                old_rem -= 1
                new_rem -= 1
            hunk["lines"].append([t, body])
            continue
        hunk = None if not line.startswith("@@") else hunk
        if line.startswith("diff --git "):
            m = re.match(r"^diff --git \"?a/(.*?)\"? \"?b/(.*?)\"?$", line)
            cur = {"path": m.group(2) if m else "", "old_path": m.group(1) if m else "",
                   "status": "M", "binary": False, "add": 0, "del": 0, "hunks": []}
            files.append(cur)
        elif cur is None:
            continue
        elif line.startswith("new file mode"):
            cur["status"] = "A"
        elif line.startswith("deleted file mode"):
            cur["status"] = "D"
        elif line.startswith("rename from "):
            cur["old_path"], cur["status"] = line[12:], "R"
        elif line.startswith("rename to "):
            cur["path"] = line[10:]
        elif line.startswith("Binary files") or line.startswith("GIT binary patch"):
            cur["binary"] = True
        elif line.startswith("--- ") and line[4:] != "/dev/null":
            cur["old_path"] = line[6:] if line.startswith("--- a/") else line[4:]
        elif line.startswith("+++ ") and line[4:] != "/dev/null":
            cur["path"] = line[6:] if line.startswith("+++ b/") else line[4:]
        elif line.startswith("@@"):
            m = HUNK_RE.match(line)
            if not m:
                continue
            old_len = int(m.group(2)) if m.group(2) is not None else 1
            new_len = int(m.group(4)) if m.group(4) is not None else 1
            hunk = {"old_start": int(m.group(1)), "old_len": old_len, "new_start": int(m.group(3)),
                    "new_len": new_len, "header": m.group(5).strip(), "lines": []}
            cur["hunks"].append(hunk)
            old_rem, new_rem = old_len, new_len
    for f in files:
        if f["status"] == "D":
            f["path"] = f["old_path"] or f["path"]
        if f["status"] == "M" and f["old_path"] and f["old_path"] != f["path"]:
            f["status"] = "R"
        if f["status"] != "R":
            f["old_path"] = None
    return files


def untracked_as_diff(root: Path) -> list[dict]:
    out = []
    for path in git(["ls-files", "--others", "--exclude-standard"], root).splitlines():
        p = root / path
        try:
            data = p.read_bytes()
        except OSError:
            continue
        binary = b"\0" in data[:8000] or len(data) > MAX_FILE_BYTES
        lines = [] if binary else data.decode("utf-8", errors="replace").splitlines()
        out.append({"path": path, "old_path": None, "status": "A", "binary": binary,
                    "add": len(lines), "del": 0,
                    "hunks": [] if binary else [{"old_start": 0, "old_len": 0, "new_start": 1,
                                                 "new_len": len(lines), "header": "",
                                                 "lines": [["+", ln] for ln in lines]}]})
    return out


def resolve_base(root: Path, base_arg: str | None, cfg_base: str) -> str:
    if base_arg or cfg_base:
        cands = [base_arg or cfg_base]
    else:
        head = git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], root, check=False).strip()
        cands = ([head] if head else []) + ["origin/main", "origin/master", "main", "master",
                                            "origin/develop", "develop"]
    for c in cands:
        if git(["rev-parse", "--verify", "-q", f"{c}^{{commit}}"], root, check=False).strip():
            return c
    raise Fail(f"Could not resolve a base branch (tried: {', '.join(cands)}). Use --base <ref>.")
