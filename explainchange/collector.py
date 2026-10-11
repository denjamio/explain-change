"""Collects a change: diff, components, dependency delta, symbols and stats, into context.json."""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

from .constants import (
    ANALYSIS_VERSION, CONFIG_NAME, DIFF_FLAGS, GENERATED_HEAD, GENERATED_RE, MAX_DIFF_LINES, MAX_FILE_BYTES,
    MAX_SCAN_FILES, SCHEMA_VERSION, WORK_DIR,
)
from .util import BlobReader, Fail, git, git_paths, lang_of
from .config import Mapper
from .diff import parse_diff, resolve_base, untracked_as_diff
from .deps import SideIndex, build_edges, extract, extract_symbols, load_tsconfigs, rule_violation
from .openspec import collect_openspec
from .ado import ado_source

__all__ = [
    "repo_root", "ensure_workdir", "looks_generated", "generated_paths", "collect", "change_source",
    "changed_files", "scan_sides", "relevant_edges", "component_rows", "change_stats", "insight_key", "public_config",
]


def repo_root() -> Path:
    out = git(["rev-parse", "--show-toplevel"], Path.cwd(), check=False).strip()
    if not out:
        raise Fail("Not inside a git repository.")
    return Path(out)


def ensure_workdir(root: Path) -> Path:
    work = root / WORK_DIR
    (work / "out").mkdir(parents=True, exist_ok=True)
    exclude = Path(git(["rev-parse", "--git-path", "info/exclude"], root).strip())
    exclude = exclude if exclude.is_absolute() else root / exclude
    try:
        text = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
        if f"/{WORK_DIR}/" not in text.split("\n"):
            exclude.parent.mkdir(parents=True, exist_ok=True)
            with exclude.open("a", encoding="utf-8") as fh:
                fh.write(("" if text.endswith("\n") or not text else "\n") + f"/{WORK_DIR}/\n")
    except OSError:
        pass
    return work


def looks_generated(f: dict) -> bool:
    """A generator marker in the first lines of the file (only visible when the first hunk starts at the top)."""
    if not f["hunks"] or f["hunks"][0]["new_start"] > GENERATED_HEAD:
        return False
    head = [body for t, body in f["hunks"][0]["lines"] if t != "-"][:GENERATED_HEAD]
    return any(GENERATED_RE.search(line) for line in head)


def generated_paths(root: Path, paths: list[str]) -> set[str]:
    """Paths marked `linguist-generated` in .gitattributes."""
    if not paths:
        return set()
    p = subprocess.run(["git", "-c", "core.quotepath=off", "check-attr", "-z", "--stdin", "linguist-generated"],
                       cwd=root, input="\0".join(paths).encode() + b"\0", capture_output=True)
    parts = p.stdout.decode("utf-8", errors="replace").split("\0") if p.returncode == 0 else []
    return {parts[i] for i in range(0, len(parts) - 2, 3) if parts[i + 2] in ("set", "true")}


def collect(root: Path, cfg: dict, base_arg: str | None, uncommitted: bool, ado: str | None,
            specs: list[str] | None = None) -> dict:
    """The whole change as context.json: source, files, components, dependency delta, symbols, stats, OpenSpec."""
    mapper = Mapper(cfg)
    notes: list[str] = []
    src, mb, head_rev = change_source(root, cfg, base_arg, uncommitted, ado, notes)
    files, raw_diff, total_lines = changed_files(root, mapper, mb, head_rev, uncommitted and not ado)
    if total_lines >= MAX_DIFF_LINES:
        notes.append(f"Diff larger than {MAX_DIFF_LINES} lines: some files are listed without hunks.")

    base_files = set(git_paths(["ls-tree", "-r", "--name-only", mb], root))
    head_files = (base_files - {f["old_path"] or f["path"] for f in files if f["status"] in "DR"}) | {
        f["path"] for f in files if f["status"] != "D"}
    touched = {f["component"] for f in files if f["component"] and f["category"] not in ("test", "ignored")}
    scan = scan_sides(root, mapper, files, base_files, head_files, touched, mb, head_rev, specs or [], notes)

    symbols = [s for f in files if f["category"] in ("code", "config") and f["hunks"] for s in extract_symbols(f)]
    edges = relevant_edges(cfg, files, symbols, scan["base_edges"], scan["head_edges"], touched)
    return {"version": SCHEMA_VERSION, "key": insight_key(root, raw_diff, specs), "source": src,
            "config": public_config(cfg, root), "files": files,
            "components": component_rows(cfg, mapper, files, edges, touched, base_files, head_files),
            "edges": edges, "symbols": symbols, "stats": change_stats(files, edges, scan["head_unresolved"]),
            "notes": notes, "openspec": scan["openspec"], "deps": sorted([a, b] for a, b in scan["head_edges"])}


def change_source(root: Path, cfg: dict, base_arg: str | None, uncommitted: bool, ado: str | None,
                  notes: list[str] | None = None) -> tuple[dict, str, str | None]:
    """(source metadata, merge base, head revision). The head revision is None for the working tree."""
    if ado:
        src = ado_source(root, ado, notes)
        mb, head_rev = src["merge_base"], src["head_sha"]
    else:
        base = resolve_base(root, base_arg, cfg["base"])
        mb = git(["merge-base", base, "HEAD"], root).strip()
        branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root).strip()
        head_sha = git(["rev-parse", "HEAD"], root).strip()
        detached = branch == "HEAD"
        branch = head_sha[:8] if detached else branch
        subject = git(["log", "-1", "--format=%s", "HEAD"], root).strip()
        src = {"mode": "local", "base_ref": base, "branch": branch, "head_ref": "HEAD", "head_sha": head_sha,
               "merge_base": mb, "title": subject if detached else branch, "description": "",
               "pr_id": "", "url": "", "include_uncommitted": uncommitted}
        head_rev = None if uncommitted else head_sha
    src["head_date"] = git(["log", "-1", "--format=%cI", src["head_sha"]], root).strip()
    src["commits"] = int(git(["rev-list", "--count", f"{mb}..{src['head_sha']}"], root).strip() or 0)
    return src, mb, head_rev


def changed_files(root: Path, mapper: Mapper, mb: str, head_rev: str | None,
                  untracked: bool) -> tuple[list[dict], str, int]:
    """(files with component and category, raw diff text for the key, diff lines kept)."""
    diff_args = ["diff", *DIFF_FLAGS, mb] + ([head_rev] if head_rev else [])
    raw_diff = git(diff_args, root)
    files = parse_diff(raw_diff)
    if untracked:
        extra = untracked_as_diff(root)
        files += extra
        raw_diff += "".join(f"\nuntracked {f['path']}\n" + "\n".join(ln[1] for h in f["hunks"] for ln in h["lines"])
                            for f in extra)
    files.sort(key=lambda f: f["path"])
    total_lines = 0
    generated = generated_paths(root, [f["path"] for f in files if f["status"] != "D"])
    for f in files:
        f["component"] = mapper.component(f["path"]) or (mapper.component(f["old_path"]) if f["old_path"] else None)
        f["category"] = "ignored" if f["path"] in generated or looks_generated(f) else mapper.category(f["path"])
        n = sum(len(h["lines"]) for h in f["hunks"])
        f["truncated"] = False
        if total_lines + n > MAX_DIFF_LINES or f["category"] == "ignored":
            f["truncated"] = bool(f["hunks"])
            f["hunks"] = []
        else:
            total_lines += n
    return files, raw_diff, total_lines


def scan_sides(root: Path, mapper: Mapper, files: list[dict], base_files: set[str], head_files: set[str],
               touched: set[str], mb: str, head_rev: str | None, specs: list[str], notes: list[str]) -> dict:
    """Reads the source files on both sides of the change: dependency edges at base and head, and OpenSpec."""
    changed_new = {f["path"] for f in files if f["status"] != "D"}
    changed_old = {f["old_path"] or f["path"] for f in files if f["status"] != "A"}

    def scannable(p: str) -> bool:
        return bool(lang_of(p)) and mapper.category(p) in ("code", "config")

    base_scan = sorted(p for p in base_files if scannable(p))
    partial = len(base_scan) > MAX_SCAN_FILES
    if partial:
        base_scan = [p for p in base_scan if mapper.component(p) in touched]
        notes.append(f"Large repository: dependency scan limited to touched components ({len(base_scan)} files).")
    reader = BlobReader(root)
    try:
        def read_base(p: str) -> str | None:
            return reader.read(mb, p)

        def read_head(p: str) -> str | None:
            if head_rev:
                return reader.read(head_rev, p)
            try:
                data = (root / p).read_bytes()
            except OSError:
                return None
            if b"\0" in data[:8000] or len(data) > MAX_FILE_BYTES:
                return None
            return data.decode("utf-8", errors="replace")

        base_ex = {p: extract(p, read_base(p)) for p in base_scan}
        head_ex = {p: ex for p, ex in base_ex.items() if p not in changed_old}
        for p in sorted(changed_new):
            if scannable(p) and (not partial or mapper.component(p) in touched):
                head_ex[p] = extract(p, read_head(p))
        base_ts = load_tsconfigs(sorted(base_files), read_base)
        tsconfig_changed = any("tsconfig" in p for p in changed_new)
        head_ts = load_tsconfigs(sorted(head_files), read_head) if tsconfig_changed else base_ts
        openspec = collect_openspec(files, head_files, base_files, read_head, read_base, specs)
    finally:
        reader.close()
    base_edges, _ = build_edges(base_ex, SideIndex(base_files, mapper, base_ts, base_ex), mapper)
    head_edges, head_unresolved = build_edges(head_ex, SideIndex(head_files, mapper, head_ts, head_ex), mapper)
    return {"base_edges": base_edges, "head_edges": head_edges, "head_unresolved": head_unresolved,
            "openspec": openspec}


def relevant_edges(cfg: dict, files: list[dict], symbols: list[dict], base_edges: dict, head_edges: dict,
                   touched: set[str]) -> list[dict]:
    """Edges of touched components that the change creates, removes or makes relevant, with rule violations.
    An unchanged edge is relevant only if a changed file creates it, or it points at a file whose public surface
    changed (callers may break). Everything else is background and would only add noise."""
    layer_of = {c["id"]: c["layer"] for c in cfg["components"]}
    changed_paths = {f["path"] for f in files} | {f["old_path"] for f in files if f["old_path"]}
    surface_changed = ({f["path"] for f in files if f["status"] in "DR"}
                       | {f["old_path"] for f in files if f["status"] == "R"}
                       | {s["file"] for s in symbols if s["change"] in ("removed", "modified")})
    edges = []
    for key in sorted(set(base_edges) | set(head_edges)):
        if key[0] not in touched and key[1] not in touched:
            continue
        b, h = base_edges.get(key), head_edges.get(key)
        status = "same" if b and h else ("new" if h else "removed")
        sources = {**(b or {}).get("lines", {}), **(h or {}).get("lines", {})}
        targets = (b or {}).get("targets", set()) | (h or {}).get("targets", set())
        grew = status == "same" and b["count"] != h["count"]
        if status == "same" and not grew and not (set(sources) & changed_paths) and not (targets & surface_changed):
            continue
        refs = [f"{f}:{ln}" for f, ln in sorted(sources.items(), key=lambda x: (x[0] not in changed_paths, x[0]))[:3]]
        e = {"from": key[0], "to": key[1], "status": status,
             "base_count": b["count"] if b else 0, "head_count": h["count"] if h else 0,
             "refs": refs, "violation": None}
        if h:
            rule = rule_violation(key[0], key[1], cfg, layer_of)
            if rule:
                e["violation"] = {"rule": rule, "existing": bool(b)}
        edges.append(e)
    return edges


def component_rows(cfg: dict, mapper: Mapper, files: list[dict], edges: list[dict], touched: set[str],
                   base_files: set[str], head_files: set[str]) -> list[dict]:
    """Touched components (new, changed or removed) and their neighbours on drawn edges (context), in config order."""
    base_has = {mapper.component(p) for p in base_files}
    head_has = {mapper.component(p) for p in head_files}
    context_ids = {x for e in edges for x in (e["from"], e["to"])} - touched
    rows = []
    for c in cfg["components"]:
        cid = c["id"]
        if cid in touched:
            status = "new" if cid not in base_has else ("removed" if cid not in head_has else "changed")
        elif cid in context_ids:
            status = "context"
        else:
            continue
        cf = [f for f in files if f["component"] == cid and f["category"] not in ("test", "ignored")]
        rows.append({"id": cid, "status": status, "files": len(cf),
                     "add": sum(f["add"] for f in cf), "del": sum(f["del"] for f in cf)})
    return rows


def change_stats(files: list[dict], edges: list[dict], unresolved: int) -> dict:
    code = [f for f in files if f["category"] != "ignored"]
    # How much of the code change the map can show: lines in code/config/migration files that belong to a component.
    mappable = [f for f in files if f["category"] in ("code", "config", "migration")]
    return {
        "files": len(files), "add": sum(f["add"] for f in code), "del": sum(f["del"] for f in code),
        "test_add": sum(f["add"] for f in files if f["category"] == "test"),
        "test_del": sum(f["del"] for f in files if f["category"] == "test"),
        "unmapped": sorted(f["path"] for f in files if not f["component"] and f["category"] == "code"),
        "unresolved": unresolved,
        "violations_new": sum(1 for e in edges if e["violation"] and not e["violation"]["existing"]),
        "code_lines": sum(f["add"] + f["del"] for f in mappable),
        "mapped_lines": sum(f["add"] + f["del"] for f in mappable if f["component"]),
    }


def insight_key(root: Path, raw_diff: str, specs: list[str] | None) -> str:
    """Identifies the change an insight was written for: the diff, the config, the contract and the analysis.
    CRLF from a Windows checkout must not change the key."""
    cfg_path = root / CONFIG_NAME
    cfg_bytes = cfg_path.read_bytes().replace(b"\r\n", b"\n") if cfg_path.exists() else b""
    parts = [raw_diff.encode(), cfg_bytes, str(SCHEMA_VERSION).encode(), ",".join(sorted(specs or [])).encode(),
             str(ANALYSIS_VERSION).encode()]
    return hashlib.sha256(b"\0".join(parts)).hexdigest()[:16]


def public_config(cfg: dict, root: Path) -> dict:
    """The part of the config the digest and the report show."""
    out = {k: cfg[k] for k in ("inferred", "name", "direction", "lang", "layers", "flows")}
    out["name"] = out["name"] or root.name
    out["components"] = [{k: c[k] for k in ("id", "name", "layer", "desc")} for c in cfg["components"]]
    out["rules"] = {"allow": [f"{a} -> {b}" for a, b in cfg["rules"]["allow"]],
                    "forbid": [f"{a} -> {b}" for a, b in cfg["rules"]["forbid"]]}
    return out
