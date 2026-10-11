"""Parses `git diff` output and resolves the base ref."""
from __future__ import annotations

import re
from pathlib import Path

from .constants import MAX_FILE_BYTES
from .util import Fail, git, git_paths

__all__ = [
    "HUNK_RE", "QUOTED", "C_ESCAPES", "diff_path", "strip_prefix", "header_paths", "parse_diff", "untracked_as_diff",
    "resolve_base",
]


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$")
QUOTED = r'"(?:[^"\\]|\\.)*"'
C_ESCAPES = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13}


def diff_path(text: str) -> str:
    """A path as git prints it in a diff header: C-quoted with octal UTF-8 bytes when it has special characters
    (quotes, backslashes, control characters), and followed by a TAB on ---/+++ lines when it has spaces."""
    if len(text) < 2 or text[0] != '"' or text[-1] != '"':
        return text.rstrip("\t")
    body, out, i = text[1:-1], bytearray(), 0
    while i < len(body):
        if body[i] == "\\" and i + 1 < len(body):
            octal = re.match(r"[0-7]{3}", body[i + 1:i + 4])
            if octal:
                out.append(int(octal.group(), 8))
                i += 4
            else:
                out.append(C_ESCAPES.get(body[i + 1], ord(body[i + 1])))
                i += 2
        else:
            out += body[i].encode()
            i += 1
    return out.decode("utf-8", errors="replace")


def strip_prefix(path: str, prefix: str) -> str:
    return path[len(prefix):] if path.startswith(prefix) else path


def header_paths(rest: str) -> tuple[str, str]:
    """(old, new) from 'diff --git a/x b/y'. Unquoted paths with spaces are ambiguous: equal halves win, else the
    first ' b/'. The ---/+++ and rename lines, when present, override these."""
    half = (len(rest) - 1) // 2
    if len(rest) % 2 == 1 and rest[half] == " " and rest[2:half] == rest[half + 3:]:
        a, b = rest[:half], rest[half + 1:]
    else:
        m = re.fullmatch(f"({QUOTED}|.+?) ({QUOTED}|b/.*)", rest)
        a, b = (m.group(1), m.group(2)) if m else ("", "")
    return strip_prefix(diff_path(a), "a/"), strip_prefix(diff_path(b), "b/")


def parse_diff(text: str) -> list[dict]:
    """Files of a `git diff` with DIFF_FLAGS: path, old_path (renames), status A|M|D|R, binary, +/- counts, hunks."""
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
            old, new = header_paths(line[len("diff --git "):])
            cur = {"path": new, "old_path": old,
                   "status": "M", "binary": False, "add": 0, "del": 0, "hunks": []}
            files.append(cur)
        elif cur is None:
            continue
        elif line.startswith("new file mode"):
            cur["status"] = "A"
        elif line.startswith("deleted file mode"):
            cur["status"] = "D"
        elif line.startswith("rename from "):
            cur["old_path"], cur["status"] = diff_path(line[12:]), "R"
        elif line.startswith("rename to "):
            cur["path"] = diff_path(line[10:])
        elif line.startswith("Binary files") or line.startswith("GIT binary patch"):
            cur["binary"] = True
        elif line.startswith("--- ") and diff_path(line[4:]) != "/dev/null":
            cur["old_path"] = strip_prefix(diff_path(line[4:]), "a/")
        elif line.startswith("+++ ") and diff_path(line[4:]) != "/dev/null":
            cur["path"] = strip_prefix(diff_path(line[4:]), "b/")
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
    for path in git_paths(["ls-files", "--others", "--exclude-standard"], root):
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
