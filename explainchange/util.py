"""Small helpers: git, globs, names and text."""
from __future__ import annotations

import bisect
import posixpath
import re
import subprocess
from pathlib import Path

from .constants import LANG_BY_EXT, MAX_FILE_BYTES

__all__ = [
    "Fail", "git", "git_paths", "BlobReader", "glob_re", "matches_any", "strip_jsonc", "camelize", "IRREGULAR_PLURALS",
    "singularize", "slugify", "lang_of", "line_index",
]


class Fail(Exception):
    """User-facing error: printed without traceback."""


def git(args: list[str], cwd: Path, check: bool = True) -> str:
    p = subprocess.run(["git", "-c", "core.quotepath=off", *args], cwd=cwd, capture_output=True)
    if check and p.returncode != 0:
        raise Fail(f"git {' '.join(args)} failed: {p.stderr.decode(errors='replace').strip()}")
    return p.stdout.decode("utf-8", errors="replace")


def git_paths(args: list[str], cwd: Path) -> list[str]:
    """Paths listed by `git ls-files` or `git ls-tree --name-only`, NUL-separated so no name is ever quoted."""
    return [p for p in git([*args, "-z"], cwd).split("\0") if p]


class BlobReader:
    """Streams file contents at a revision through a single `git cat-file --batch`."""

    def __init__(self, cwd: Path):
        self.p = subprocess.Popen(["git", "cat-file", "--batch"], cwd=cwd,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, rev: str, path: str) -> str | None:
        self.p.stdin.write(f"{rev}:{path}\n".encode())
        self.p.stdin.flush()
        header = self.p.stdout.readline().decode(errors="replace").split()
        if len(header) < 3:  # "<object> missing"
            return None
        size = int(header[2])
        data = self.p.stdout.read(size)
        self.p.stdout.read(1)
        if header[1] != "blob" or size > MAX_FILE_BYTES or b"\0" in data[:8000]:
            return None
        return data.decode("utf-8", errors="replace")

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()
        finally:
            self.p.stdout.close()


_glob_cache: dict[str, re.Pattern] = {}


def glob_re(pattern: str) -> re.Pattern:
    """Glob with `**` support. A pattern without wildcards also matches everything below it."""
    if pattern in _glob_cache:
        return _glob_cache[pattern]
    p = pattern.strip().lstrip("./").rstrip("/") if pattern.strip() not in (".", "./") else ""
    if not any(c in p for c in "*?["):
        rx = re.compile(re.escape(p) + r"(?:/.*)?$") if p else re.compile(".*")
    else:
        out, i = "", 0
        while i < len(p):
            c = p[i]
            if p.startswith("**/", i):
                out += r"(?:.*/)?"
                i += 3
            elif p.startswith("/**", i) and i + 3 == len(p):
                out += r"(?:/.*)?"
                i += 3
            elif p.startswith("**", i):
                out += ".*"
                i += 2
            elif c == "*":
                out += "[^/]*"
                i += 1
            elif c == "?":
                out += "[^/]"
                i += 1
            else:
                out += re.escape(c)
                i += 1
        rx = re.compile(out + "$")
    _glob_cache[pattern] = rx
    return rx


def matches_any(path: str, patterns: list[str]) -> bool:
    return any(glob_re(p).match(path) for p in patterns)


def strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas (tsconfig is JSONC)."""
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            out.append(c)
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        else:
            out.append(c)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def camelize(segment: str, acronyms: dict | None = None, inflections: dict | None = None) -> str:
    """Zeitwerk-style camelize. acronyms: {"api": "API"}; inflections: {"html_parser": "HTMLParser"}."""
    if inflections and segment in inflections:
        return inflections[segment]
    acronyms = acronyms or {}
    return "".join(acronyms.get(part, part[:1].upper() + part[1:]) for part in segment.split("_") if part)


IRREGULAR_PLURALS = {"people": "person", "men": "man", "women": "woman", "children": "child", "feet": "foot",
                     "teeth": "tooth", "mice": "mouse", "geese": "goose", "data": "datum", "criteria": "criterion"}


def singularize(word: str) -> str:
    """Enough of ActiveSupport's rules for association names."""
    if word in IRREGULAR_PLURALS:
        return IRREGULAR_PLURALS[word]
    for suffix, repl in (("ies", "y"), ("sses", "ss"), ("shes", "sh"), ("ches", "ch"), ("xes", "x"), ("zzes", "zz"),
                         ("uses", "us"), ("oes", "o"), ("ves", "f")):
        if word.endswith(suffix) and len(word) > len(suffix) + 1:
            return word[: -len(suffix)] + repl
    return word[:-1] if word.endswith("s") and not word.endswith("ss") else word


def slugify(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-")[:80] or "change"


def lang_of(path: str) -> str | None:
    return LANG_BY_EXT.get(posixpath.splitext(path)[1].lower())


def line_index(text: str):
    starts = [0] + [m.end() for m in re.finditer("\n", text)]
    return lambda pos: bisect.bisect_right(starts, pos)
