"""Parses OpenSpec changes and specs touched by the diff. Everything is parsed, never guessed."""
from __future__ import annotations

import re
import unicodedata

__all__ = [
    "OS_CHANGE", "OS_SPEC", "OS_OPS", "kebab", "md_plain", "md_sections", "first_paragraph", "trunc_text", "bullets",
    "parse_requirements", "parse_tasks", "parse_proposal", "parse_design", "requirement_shape", "diff_requirements",
    "change_of", "collect_openspec", "parse_change", "main_spec_edits", "spec_requirements",
]


# Spec-driven changes live in openspec/changes/<id>/ (proposal.md, design.md, tasks.md and requirement deltas in
# specs/<capability>/spec.md); archiving moves them to changes/archive/<date>-<id>/ and merges the deltas into
# openspec/specs/<capability>/spec.md. Everything here is parsed, never guessed: the agent only maps requirements
# to code.

OS_CHANGE = re.compile(r"^(?P<root>(?:.*/)?openspec)/changes/"
                       r"(?:(?P<arch>archive)/(?:\d{4}-\d{2}-\d{2}-)?)?(?P<id>[^/]+)/(?P<rest>.+)$")
OS_SPEC = re.compile(r"^(?P<root>(?:.*/)?openspec)/specs/(?P<cap>[^/]+)/spec\.md$")
OS_OPS = ("ADDED", "MODIFIED", "REMOVED", "RENAMED")


def kebab(text: str) -> str:
    ascii_ = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()  # "Confirmación" → "confirmacion"
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")[:60] or "x"


def md_plain(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*|__([^_]+)__", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def md_sections(text: str, level: int = 2) -> list[tuple[str, list[tuple[int, str]]]]:
    """[(heading, [(line_no, line), …])] for headings of exactly `level`; content before the first one is ('', …)."""
    out: list = [("", [])]
    mark = "#" * level + " "
    for i, line in enumerate(text.splitlines(), 1):
        if line.startswith(mark):
            out.append((md_plain(line[len(mark):]), []))
        else:
            out[-1][1].append((i, line))
    return out


def first_paragraph(lines: list[tuple[int, str]], limit: int) -> str:
    para: list[str] = []
    for _, line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            if para:
                break
            continue
        para.append(line.strip().lstrip("-* ").strip() if not para else line.strip())
    return trunc_text(md_plain(" ".join(para)), limit)


def trunc_text(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def bullets(lines: list[tuple[int, str]], limit: int, n: int) -> list[str]:
    items = [ln for _, ln in lines if re.match(r"^[-*]\s+\S", ln)]
    return [trunc_text(md_plain(re.sub(r"^\s*[-*]\s+", "", ln)), limit) for ln in items][:n]


def parse_requirements(text: str, cap: str, path: str, default_op: str | None) -> list[dict]:
    """Requirements with their scenarios, in file order. `op` comes from '## ADDED Requirements' etc."""
    reqs: list[dict] = []
    op, cur, scen, body = default_op, None, None, []

    def close():
        if cur is not None:
            cur["text"] = trunc_text(md_plain(" ".join(body)), 280)
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^##\s+(\w+)\s+Requirements\b", line, re.I)
        if m:
            close()
            op, cur, scen, body = (m.group(1).upper() if m.group(1).upper() in OS_OPS else default_op), None, None, []
            continue
        m = re.match(r"^###\s+Requirement:\s*(.+?)\s*$", line)
        if m:
            close()
            name = md_plain(m.group(1))
            cur = {"id": f"{cap}/{kebab(name)}", "cap": cap, "name": trunc_text(name, 120), "op": op or "SPEC",
                   "text": "", "scenarios": [], "file": path, "line": i}
            scen, body = None, []
            reqs.append(cur)
            continue
        if cur is None:
            if op == "RENAMED":  # - FROM: `### Requirement: Old` / - TO: `### Requirement: New`
                fm = re.match(r"^\s*-\s*(FROM|TO):\s*`?(?:###\s*)?(?:Requirement:\s*)?(.+?)`?\s*$", line, re.I)
                if fm and fm.group(1).upper() == "FROM":
                    reqs.append({"id": "", "cap": cap, "name": "", "op": "RENAMED", "from": md_plain(fm.group(2)),
                                 "text": "", "scenarios": [], "file": path, "line": i})
                elif fm and reqs and reqs[-1]["op"] == "RENAMED" and not reqs[-1]["name"]:
                    name = md_plain(fm.group(2))
                    reqs[-1].update({"id": f"{cap}/{kebab(name)}", "name": trunc_text(name, 120)})
            continue
        m = re.match(r"^####\s+Scenario:\s*(.+?)\s*$", line)
        if m:
            scen = {"id": kebab(m.group(1)), "name": trunc_text(md_plain(m.group(1)), 120), "steps": [], "line": i}
            cur["scenarios"].append(scen)
            continue
        if line.startswith("## "):
            close()
            op, cur, scen = None, None, None
            continue
        if scen is not None:
            sm = re.match(r"^\s*[-*]\s+(?:\*\*)?(GIVEN|WHEN|THEN|AND|BUT)(?:\*\*)?\s+(.*)$", line, re.I)
            if sm and len(scen["steps"]) < 8:
                scen["steps"].append({"k": sm.group(1).upper(), "t": trunc_text(md_plain(sm.group(2)), 160)})
        elif line.strip() and not line.startswith("#") and len(" ".join(body)) < 400:
            body.append(line.strip())
    close()
    return [r for r in reqs if r["id"]]


def parse_tasks(text: str) -> dict:
    groups, items = [], []
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^#{2,3}\s+(.+)$", line)
        if m:
            groups.append({"title": trunc_text(md_plain(m.group(1)), 80), "done": 0, "total": 0})
            continue
        m = re.match(r"^\s*[-*]\s+\[([ xX])\]\s+(.+)$", line)
        if m:
            if not groups:
                groups.append({"title": "", "done": 0, "total": 0})
            done = m.group(1) != " "
            groups[-1]["total"] += 1
            groups[-1]["done"] += done
            if len(items) < 60:
                items.append({"t": trunc_text(md_plain(m.group(2)), 140), "done": done, "line": i,
                              "group": len(groups) - 1})
    groups = [g for g in groups if g["total"]]
    return {"done": sum(g["done"] for g in groups), "total": sum(g["total"] for g in groups),
            "groups": groups, "items": items}


def parse_proposal(text: str) -> dict:
    out = {"why": "", "what": [], "impact": []}
    for title, lines in md_sections(text):
        t = title.lower()
        if t.startswith("why") and not out["why"]:
            out["why"] = first_paragraph(lines, 400)
        elif t.startswith("what") and not out["what"]:
            out["what"] = bullets(lines, 160, 8)
        elif t.startswith("impact") and not out["impact"]:
            out["impact"] = bullets(lines, 160, 6)
    return out


def parse_design(text: str) -> list[str]:
    decisions: list[str] = []
    for title, lines in md_sections(text):
        if not title.lower().startswith("decision"):
            continue
        heads = [md_plain(re.sub(r"^#+\s*", "", ln)) for _, ln in lines if re.match(r"^###\s+\S", ln)]
        bold = [md_plain(m.group(1)) for _, ln in lines for m in [re.match(r"^[-*]\s+\*\*(.+?)\*\*", ln)] if m]
        decisions = [trunc_text(re.sub(r"^(Decision\s*\d*[:.]?\s*)", "", d, flags=re.I), 100)
                     for d in (heads or bold)][:8]
    return decisions


def requirement_shape(r: dict) -> tuple:
    """What makes two versions of a requirement differ: its text and its scenarios."""
    return r["text"], [(s["name"], s["steps"]) for s in r["scenarios"]]


def diff_requirements(base: list[dict], head: list[dict]) -> list[dict]:
    """Main spec changed in the diff (usually an archive merge): requirement-level ADDED/MODIFIED/REMOVED."""
    b = {r["id"]: r for r in base}
    h = {r["id"]: r for r in head}
    out = []
    for r in head:
        if r["id"] not in b:
            out.append({**r, "op": "ADDED"})
        elif requirement_shape(r) != requirement_shape(b[r["id"]]):
            out.append({**r, "op": "MODIFIED"})
    out += [{**r, "op": "REMOVED"} for r in base if r["id"] not in h]
    return out


def change_of(path: str | None) -> tuple[str, str] | None:
    """(openspec root, change id) when `path` is inside an OpenSpec change, active or archived."""
    m = OS_CHANGE.match(path or "")
    return (m.group("root"), m.group("id")) if m and m.group("id") != "archive" else None


def collect_openspec(files: list[dict], head_files: set, base_files: set, read_head, read_base,
                     extra: list[str]) -> dict | None:
    """OpenSpec changes the diff touches (plus `extra` ids from --spec) and the main specs it edits."""
    changes = {key for f in files for key in (change_of(f["path"]), change_of(f.get("old_path"))) if key}
    for cid in extra:  # --spec <id>: an active change the branch implements without touching it
        roots = sorted({key[0] for p in head_files if (key := change_of(p)) and key[1] == cid})
        changes |= {(r, cid) for r in roots[:1]}
    out_changes = [ch for key in sorted(changes) if (ch := parse_change(key, files, head_files, base_files,
                                                                        read_head, read_base))]
    delta_ids = {r["id"] for c in out_changes for r in c["requirements"]}
    specs = main_spec_edits(files, read_head, read_base, delta_ids)
    if not out_changes and not specs:
        return None
    return {"changes": out_changes, "specs": specs}


def parse_change(key: tuple[str, str], files: list[dict], head_files: set, base_files: set, read_head,
                 read_base) -> dict | None:
    """One change: where it lives at HEAD (active dir, or its archive dir, moved in this diff or earlier), or at
    the base when the diff deletes it; its proposal, design, tasks and requirement deltas."""
    cid = key[1]
    paths = sorted(p for p in head_files if change_of(p) == key)
    side_files, read = paths, read_head
    if not paths:  # deleted by the diff: read it at the base
        side_files, read = sorted(p for p in base_files if change_of(p) == key), read_base
    if not side_files:
        return None
    m0 = OS_CHANGE.match(side_files[0])
    cdir = side_files[0][: len(side_files[0]) - len(m0.group("rest"))].rstrip("/")
    archived = bool(m0.group("arch"))
    moved_here = any((old := OS_CHANGE.match(f.get("old_path") or "")) and not old.group("arch")
                     for f in files if f["path"].startswith(cdir + "/"))
    ch = {"id": cid, "dir": cdir, "archived": archived, "deleted": not paths,
          "moved_to_archive": archived and moved_here, "artifacts": [], "why": "", "what": [], "impact": [],
          "decisions": [], "tasks": None, "requirements": []}
    status = {f["path"]: f["status"] for f in files}
    for p in side_files:
        rest = p[len(cdir) + 1:]
        st = status.get(p, "=")
        text = read(p) or ""
        if rest == "proposal.md":
            ch.update(parse_proposal(text))
            ch["artifacts"].append({"kind": "proposal", "path": p, "status": st})
        elif rest == "design.md":
            ch["decisions"] = parse_design(text)
            ch["artifacts"].append({"kind": "design", "path": p, "status": st})
        elif rest == "tasks.md":
            ch["tasks"] = parse_tasks(text)
            ch["artifacts"].append({"kind": "tasks", "path": p, "status": st})
        elif (sm := re.match(r"^specs/([^/]+)/spec\.md$", rest)):
            ch["requirements"] += parse_requirements(text, sm.group(1), p, None)
            ch["artifacts"].append({"kind": "spec", "path": p, "status": st, "cap": sm.group(1)})
    for r in ch["requirements"]:
        r["change"] = cid
    return ch


def main_spec_edits(files: list[dict], read_head, read_base, delta_ids: set[str]) -> list[dict]:
    """Main specs touched by the diff (archive merges, or direct edits), as requirement-level diffs."""
    specs = []
    for f in files:
        m = OS_SPEC.match(f["path"])
        if not m:
            continue
        cap = m.group("cap")
        head_text = (read_head(f["path"]) or "") if f["status"] != "D" else ""
        base_text = (read_base(f.get("old_path") or f["path"]) or "") if f["status"] != "A" else ""
        reqs = diff_requirements(parse_requirements(base_text, cap, f["path"], "SPEC"),
                                 parse_requirements(head_text, cap, f["path"], "SPEC"))
        for r in reqs:
            r["change"] = None
            r["merged"] = r["id"] in delta_ids
        specs.append({"cap": cap, "path": f["path"], "status": f["status"], "requirements": reqs})
    return specs


def spec_requirements(ctx: dict) -> list[dict]:
    """Requirements the change must account for: every delta of its OpenSpec changes, plus main-spec edits not
    already covered by a delta. RENAMED-only entries carry no behaviour and are informational."""
    os_ = ctx.get("openspec") or {}
    out = [r for c in os_.get("changes", []) for r in c["requirements"]]
    seen = {r["id"] for r in out}
    out += [r for s in os_.get("specs", []) for r in s["requirements"] if r["id"] not in seen]
    return out
