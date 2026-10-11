"""Renders the self-contained HTML report."""
from __future__ import annotations

import json
from html import escape as html_escape
from pathlib import Path

from .constants import TOOL_DIR, WORK_DIR
from .util import slugify
from .openspec import spec_requirements
from .insight import REF_RE, normalize_insight, validate_insight

__all__ = [
    "EXCERPT_MARGIN", "excerpt_ranges", "prune_hunks", "render_html", "cached_insight", "restore_insight",
    "load_insight", "write_render",
]


EXCERPT_MARGIN = 3  # context lines kept around each referenced range (the page shows at most 2)


def excerpt_ranges(ctx: dict, insight: dict | None) -> dict[str, list[tuple[int, int]]]:
    """Line ranges the report shows as code excerpts: story steps, evidence, rule violations and requirements."""
    refs = [r for e in ctx["edges"] if e["violation"] for r in e["refs"][:1]]
    refs += [f"{r['file']}:{r['line']}" for r in spec_requirements(ctx) if r.get("file")]
    if insight:
        refs += [s.get("code") for s in insight.get("story", [])]
        refs += [x.get("evidence") for x in insight.get("decisions", [])]
        refs += [x.get("evidence") for x in (insight.get("data_model") or {}).get("entities", [])]
    out: dict[str, list[tuple[int, int]]] = {}
    for ref in refs:
        m = REF_RE.match(ref or "")
        if m:
            a = int(m.group(2))
            out.setdefault(m.group(1), []).append((a - EXCERPT_MARGIN, int(m.group(3) or a) + EXCERPT_MARGIN))
    return out


def prune_hunks(f: dict, ranges: list[tuple[int, int]]) -> list[dict]:
    """Keeps only the hunk lines inside `ranges`, split into smaller hunks with exact start lines."""
    side_new = f["status"] != "D"
    out: list[dict] = []
    for h in f["hunks"]:
        o, n, cur = h["old_start"], h["new_start"], None
        for t, body in h["lines"]:
            ln = n if side_new else (o if t != "+" else n)
            if any(a <= ln <= b for a, b in ranges):
                if cur is None:
                    cur = {"old_start": o, "old_len": 0, "new_start": n, "new_len": 0,
                           "header": h.get("header", ""), "lines": []}
                    out.append(cur)
                cur["lines"].append([t, body])
                cur["old_len"] += t != "+"
                cur["new_len"] += t != "-"
            else:
                cur = None
            o += t != "+"
            n += t != "-"
    return out


def render_html(ctx: dict, insight: dict | None, status: str, errors: list[str]) -> str:
    # The page shows excerpts, not the full diff (the PR has it): ship only the lines it can show.
    ranges = excerpt_ranges(ctx, insight)
    ctx = {**ctx, "files": [{**f, "hunks": prune_hunks(f, ranges.get(f["path"], []))} for f in ctx["files"]]}
    tpl = TOOL_DIR / "template"
    html = (tpl / "index.html").read_text(encoding="utf-8")
    css = (tpl / "styles.css").read_text(encoding="utf-8")
    js = (tpl / "app.js").read_text(encoding="utf-8")
    data = {"context": ctx, "insight": insight, "insightStatus": status, "insightErrors": errors[:20]}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("<!--", "<\\!--")
    title = f"{ctx['config']['name']} · {ctx['source']['title']}"
    return (html.replace("{{TITLE}}", html_escape(title, quote=False))
                .replace("{{LANG}}", ctx["config"]["lang"])
                .replace("/*{{CSS}}*/", css)
                .replace("/*{{JS}}*/", js.replace("</script", "<\\/script"))
                .replace("{{DATA}}", payload))


def cached_insight(work: Path, key: str) -> Path:
    return work / "insights" / f"{key}.json"


def restore_insight(work: Path, ctx: dict) -> bool:
    """Brings back the insight already accepted for this exact change, so going back to a PR costs no tokens.
    An insight.json being written for this change (or unreadable, so mid-write) is left alone; one for another
    change is archived under its own key first."""
    path, cached = work / "insight.json", cached_insight(work, ctx["key"])
    if not cached.exists():
        return False
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return False
        old = current.get("key") if isinstance(current, dict) else None
        if not isinstance(old, str) or old == ctx["key"]:
            return False
        if not cached_insight(work, old).exists():
            cached_insight(work, old).write_bytes(path.read_bytes())
    path.write_bytes(cached.read_bytes())
    return True


def load_insight(work: Path, ctx: dict) -> tuple[dict | None, str, list[str]]:
    """The insight's status for this change. A valid one is also kept in insights/<key>.json for restore_insight."""
    path = work / "insight.json"
    restore_insight(work, ctx)
    if not path.exists():
        return None, "missing", []
    try:
        ins = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return None, "invalid", [f"insight.json: invalid JSON at line {e.lineno} col {e.colno}: {e.msg}"]
    errs = validate_insight(ins, ctx, work.parent)
    stale = [e for e in errs if e.startswith("key:")]
    if stale:  # other errors are noise until it is regenerated for this change
        return None, "stale", stale
    if errs:
        return None, "invalid", errs
    cached = cached_insight(work, ctx["key"])
    cached.parent.mkdir(exist_ok=True)
    cached.write_text(json.dumps({**ins, "key": ctx["key"]}, ensure_ascii=False, indent=1), encoding="utf-8",
                      newline="\n")
    return normalize_insight(ins, ctx), "fresh", []


def write_render(root: Path, ctx: dict, out: str | None) -> tuple[Path, str, list[str]]:
    work = root / WORK_DIR
    insight, status, errs = load_insight(work, ctx)
    target = Path(out) if out else work / "out" / f"{slugify(ctx['source']['branch'] or 'change')}.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_html(ctx, insight, status, errs), encoding="utf-8", newline="\n")
    return target, status, errs
