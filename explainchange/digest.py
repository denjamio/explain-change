"""Builds digest.md: the budgeted summary the agent reads, ending with the rules for insight.json."""
from __future__ import annotations

import re

from .constants import CONFIG_NAME, SCHEMA_VERSION, WORK_DIR
from .openspec import spec_requirements, trunc_text
from .insight import INSIGHT_ENUMS, INSIGHT_LIMITS, PROSE_RULES, STORY_MIN, insight_components, touched_components


def insight_template(ctx: dict) -> str:
    L, E, cfg = INSIGHT_LIMITS, INSIGHT_ENUMS, ctx["config"]
    reqs = spec_requirements(ctx)
    stages = "architecture|flow:<flow-id>|data" + ("|spec" if reqs else "")
    spec = ", ".join('{"req": "%s", "status": "%s", "components": ["<id>"], "tests": ["path[:line]"], "note": "<=%d"}'
                     % (r["id"], "|".join(E["spec.status"]), L["spec.note"]) for r in reqs
                     if r["op"] in ("ADDED", "MODIFIED") and not r.get("merged"))
    changes = ", ".join('{"id": "%s", "summary": "<=%d"}' % (c, L["changes.summary"]) for c in touched_components(ctx))
    fields = [
        f'  "version": {SCHEMA_VERSION}, "key": "{ctx["key"]}", "lang": "{cfg["lang"]}",',
        f'  "tldr": "<={L["tldr"]} chars: what changes and why it matters",',
        f'  "intent": "<={L["intent"]} chars: the goal of the change",',
        f'  "story": [{{"heading": "<={L["story.heading"]}", "body": "<={L["story.body"]}", "stage": "{stages}", '
        f'"focus": ["<id>"], "code": "file:a-b (optional)"}}],',
        f'  "hero": [{{"from": "<id>", "to": "<id>", "label": "<={L["hero.label"]} (optional)"}}],',
        f'  "changes": [{changes}],',
        f'  "decisions": [{{"title": "<={L["decisions.title"]}", "why": "<={L["decisions.why"]}", '
        f'"alternative": "<={L["decisions.alternative"]} (optional)", "evidence": "file:line"}}],',
        f'  "flows": [{{"id": "kebab-id", "title": "<={L["flows.title"]}", "steps": [{{"from": "<id>", "to": "<id>", '
        f'"msg": "<={L["flows.steps.msg"]}", "status": "{"|".join(E["flows.steps.status"])}", '
        f'"data": {{"type": "Order", "fields": ["+email: string", "~total: number", "-fax"]}} (optional)}}]'
        + (', "scenario": "<requirement-id>#<scenario-id> (optional)"' if reqs else "") + "}],",
        f'  "data_model": {{"entities": [{{"id": "kebab-id", "name": "<={L["data_model.entities.name"]}", '
        f'"change": "{"|".join(E["data_model.entities.change"])}", "component": "<id>", '
        f'"fields": ["+email: string"], "evidence": "file:a-b"}}], '
        f'"relations": [{{"from": "<entity>", "to": "<entity>", "label": "1..n", "change": "added"}}]}},',
        *([f'  "spec": [{spec}],'] if spec else []),
    ]
    fields[-1] = fields[-1].rstrip(",")  # valid JSON: no comma after the last field
    return "\n".join(["{", *fields, "}"])


def hunk_score(f: dict, h: dict, sym_lines: set, cross_files: set) -> int:
    """0 = never inline. Code in a component beats config and migrations, which beat anything unmapped."""
    if f["category"] in ("test", "docs", "ignored"):
        return 0
    if f["category"] == "code":
        score = 3 if f["component"] else 1
    else:  # config, migration
        score = 2
    start, end = h["new_start"], h["new_start"] + max(h["new_len"], 1)
    if any((f["path"], n) in sym_lines for n in range(start, end)):
        score += 3
    if f["path"] in cross_files:
        score += 2
    return score


def format_hunk(f: dict, h: dict, max_lines: int = 40) -> str:
    lines = h["lines"]
    shown = lines[:max_lines]
    out = [f"### {f['path']} @@ -{h['old_start']},{h['old_len']} +{h['new_start']},{h['new_len']} {h['header']}".rstrip()]
    out += [f"{t}{body[:160]}" for t, body in shown]
    if len(lines) > max_lines:
        out.append(f"… {len(lines) - max_lines} more lines")
    return "\n".join(out)


def build_digest(ctx: dict, budget: int) -> str:
    cfg, src, st = ctx["config"], ctx["source"], ctx["stats"]
    layer_of = {c["id"]: c["layer"] for c in cfg["components"]}
    out = [f"# explain-change digest (v{SCHEMA_VERSION}, key {ctx['key']})",
           f"Project: {cfg['name']} · lang: {cfg['lang']}" + (" · CONFIG INFERRED" if cfg["inferred"] else "")]
    if cfg["inferred"]:
        out.append(f"WARNING: no {CONFIG_NAME}: layers, components and rules were guessed from directory names. "
                   "Treat layer placement and violations as provisional.")
    if cfg["direction"]:
        out.append(f"Direction: {cfg['direction']}")
    out.append(f"Change: {src['title']} ({src['mode']}) {src['merge_base'][:8]}..{src['head_sha'][:8]}, "
               f"{src['commits']} commits, {st['files']} files, +{st['add']} -{st['del']} "
               f"(tests +{st['test_add']} -{st['test_del']})")
    if src.get("description"):
        out.append("PR description: " + re.sub(r"\s+", " ", src["description"])[:600])
    out.append("\n## Layers (top → bottom)\n" + " > ".join(layer["id"] for layer in cfg["layers"]))
    if cfg["rules"]["allow"] or cfg["rules"]["forbid"]:
        out.append("Allowed: " + ", ".join(cfg["rules"]["allow"]) + ("; Forbidden: " + ", ".join(cfg["rules"]["forbid"]) if cfg["rules"]["forbid"] else ""))
    out.append("\n## Components in this change (id [layer] status files +/-)")
    for c in ctx["components"]:
        desc = next((x["desc"] for x in cfg["components"] if x["id"] == c["id"]), "")
        out.append(f"- {c['id']} [{layer_of[c['id']]}] {c['status']} {c['files']}f +{c['add']}/-{c['del']}" + (f" — {desc}" if desc else ""))
    out.append("\n## Dependency delta (component → component)")
    quiet = 0
    for e in ctx["edges"]:
        grew = e["status"] == "same" and e["base_count"] != e["head_count"]
        if e["status"] == "same" and not e["violation"] and not grew:
            quiet += 1
            continue
        mark = {"new": "+", "removed": "-", "same": "~" if grew else "="}[e["status"]]
        refs = f"{e['base_count']}→{e['head_count']} refs" if grew else f"{e['head_count'] or e['base_count']} refs"
        v = f"  ⚠ {e['violation']['rule']}{' (pre-existing)' if e['violation']['existing'] else ''}" if e["violation"] else ""
        out.append(f"{mark} {e['from']} -> {e['to']} ({refs}, e.g. {e['refs'][0]}){v}")
    if quiet:
        out.append(f"= {quiet} unchanged edges touching changed components")
    if cfg["flows"]:
        out.append("\n## Reference flows (config)")
        for fl in cfg["flows"]:
            out.append(f"- {fl['id']}: " + " ; ".join(f"{s['from']}->{s['to']}:{s['msg']}" for s in fl["steps"]))
    migrations = [f["path"] for f in ctx["files"] if f["category"] == "migration"]
    if migrations:
        out.append("\n## Migrations in this change (data_model evidence)\n" + "\n".join(f"- {m}" for m in migrations[:20]))
    os_ = ctx.get("openspec")
    if os_:
        out.append("\n## OpenSpec (spec-driven change in this diff)")
        for c in os_["changes"]:
            phase = "archived in this diff" if c["moved_to_archive"] else "archived" if c["archived"] else "active"
            arts = ", ".join(f"{a['kind']}{'(' + a['cap'] + ')' if a.get('cap') else ''} {a['status']}" for a in c["artifacts"])
            t = c["tasks"]
            out.append(f"- change `{c['id']}` [{phase}] {arts}" + (f"; tasks {t['done']}/{t['total']} done" if t else ""))
            if c["why"]:
                out.append(f"  why: {c['why']}")
            if c["decisions"]:
                out.append("  design decisions: " + "; ".join(c["decisions"]))
            if t and t["done"] < t["total"]:
                out.append("  open tasks: " + "; ".join(x["t"] for x in t["items"] if not x["done"])[:400])
        reqs = spec_requirements(ctx)
        if reqs:
            out.append("Requirements (id op: statement · scenarios):")
            for r in reqs:
                sc = ", ".join(x["id"] for x in r["scenarios"])
                src = "" if r["change"] else f" [main spec {r['file']}]"
                merged = " (merged from the change's delta)" if r.get("merged") else ""
                out.append(f"- {r['id']} {r['op']}{src}{merged}: {trunc_text(r['text'] or r['name'], 160)}" + (f" · {sc}" if sc else ""))
    if ctx["symbols"]:
        out.append("\n## Public symbols changed")
        cap = 40 if len(ctx["files"]) <= 40 else 20  # big changes: leave room for hunks
        for s in ctx["symbols"][:cap]:
            out.append(f"- {s['change']} {s['kind']} {s['name']} ({s['file']}:{s['line']})")
        if len(ctx["symbols"]) > cap:
            out.append(f"- … {len(ctx['symbols']) - cap} more")
    listed = [f for f in ctx["files"] if f["category"] != "ignored"]
    if len(listed) <= 40:
        out.append("\n## Files (status path component category +/-)")
        for f in listed:
            old = f" (from {f['old_path']})" if f["status"] == "R" else ""
            out.append(f"{f['status']} {f['path']}{old} [{f['component'] or 'unmapped'}] {f['category']} +{f['add']}/-{f['del']}")
    else:  # large change: group by component, show the files with most churn
        out.append(f"\n## Files by component ({len(listed)} files; top 4 by churn each)")
        groups: dict[str, list] = {}
        for f in listed:
            key = "tests" if f["category"] == "test" else f["component"] or f"unmapped {f['category']}"
            groups.setdefault(key, []).append(f)
        order = [c["id"] for c in ctx["components"]]
        for key in sorted(groups, key=lambda k: (order.index(k) if k in order else 999, k)):
            fs = sorted(groups[key], key=lambda f: (-(f["add"] + f["del"]), f["path"]))
            top = ", ".join(f"{f['status']} {f['path']} +{f['add']}/-{f['del']}" for f in fs[:4])
            more = f", +{len(fs) - 4} more" if len(fs) > 4 else ""
            out.append(f"- {key} ({len(fs)} files, +{sum(f['add'] for f in fs)}/-{sum(f['del'] for f in fs)}): {top}{more}")
    ignored = [f for f in ctx["files"] if f["category"] == "ignored"]
    if ignored:
        out.append(f"(+{len(ignored)} ignored/generated files)")
    if ctx["notes"]:
        out.append("\n## Notes\n" + "\n".join(f"- {n}" for n in ctx["notes"]))

    head = "\n".join(out)
    L = INSIGHT_LIMITS
    task = ["\n## Task",
            f"Write {WORK_DIR}/insight.json (JSON only; prose in '{cfg['lang']}'), then run `explain-change render`.",
            "- This explains the change (what it does, where it sits in the architecture, how data flows, why it is built "
            "this way). It is not a review: do not judge readiness or report bugs, gaps, error handling, security or style; "
            "another reviewer covers those.",
            f"- Component ids (only these): in this change {', '.join(c['id'] for c in ctx['components'])}"
            + (f"; elsewhere {', '.join(insight_components(ctx)[len(ctx['components']):])}" if len(insight_components(ctx)) > len(ctx["components"]) else "") + ".",
            "- changes: one line per changed component saying what it now does differently (behaviour, not file names).",
            "- decisions (0-5): the design choices that explain why the change is built this way: what was chosen, why, "
            "and the main alternative.",
            f"- flows (0-{L['flows']}): runtime paths through the changed components, steps in call order. step status: "
            "same = existed unchanged | changed = existed, different data/behaviour | new | removed. "
            "Reuse a reference flow id when it is the same flow.",
            f"- story ({STORY_MIN}-{L['story']}, ideally 3-6): the guided tour a reader plays over the diagrams. One step = one change "
            "(added, removed, now, moved, replaced), headline change first, overview last. heading: the thing + what happened to it, "
            "short common words; body: what behaves differently now (numbers when they matter), not a description of the code. "
            "stage = architecture | flow:<flow-id> | data" + (" | spec" if spec_requirements(ctx) else "") +
            "; focus = 1-3 ids on that stage (components; flow participants or step numbers '#2'"
            + ("; requirement ids" if spec_requirements(ctx) else "") + "); code = optional file:a-b inside a hunk shown beside the step.",
            "- flow step data (optional): what travels on the step: the type a reader of the code knows, and only the fields "
            "that matter; prefix + added, - removed, ~ changed. Put it on steps whose data changed.",
            "- data_model (when entities, tables, schemas or migrations change): the entities touched, with changed fields "
            "(+ - ~) and their relations; unchanged neighbours as change 'same' (no evidence needed). "
            "evidence = file:a-b of the model or migration hunk. Story stage 'data' focuses entity ids.",
            f"- Prose: {PROSE_RULES}",
            "- hero (0-2): the dependency the change is really about, as from/to of a drawn edge; optional short label.",
            "- Open a file only when a hunk is not enough to judge.",
            "```json", insight_template(ctx), "```"]
    if spec_requirements(ctx):
        task.insert(-3, "- spec: one entry per ADDED/MODIFIED requirement (REMOVED optional): does the code implement it? "
                        "implemented = behaviour present (components and/or tests that prove it) | partial | missing | n/a. "
                        "partial/missing need a note. A scenario that is a runtime path can be a flow with \"scenario\": \"<req-id>#<scenario-id>\".")
    tail = "\n".join(task)

    sym_lines = {(s["file"], s["line"]) for s in ctx["symbols"]}
    cross = {r.split(":")[0] for e in ctx["edges"] if e["status"] != "same" or e["violation"] for r in e["refs"]}
    scored = []
    for f in ctx["files"]:
        for i, h in enumerate(f["hunks"]):
            scored.append((-hunk_score(f, h, sym_lines, cross), f["path"], i, f, h))
    scored.sort(key=lambda x: x[:3])
    remaining = max(budget - len(head) - len(tail), int(budget * 0.35))  # hunks always get a real share
    chosen, skipped = [], []
    per_file: dict[str, int] = {}
    for item in scored:
        block = None
        if item[0] < 0 and per_file.get(item[1], 0) < 2:  # score 0 never inlined; max 2 hunks per file
            for max_lines in (40, 12):  # a trimmed hunk beats a skipped one
                candidate = format_hunk(item[3], item[4], max_lines)
                if len(candidate) + 1 <= remaining:
                    block = candidate
                    break
        if block:
            per_file[item[1]] = per_file.get(item[1], 0) + 1
            chosen.append((item[1], item[2], block))
            remaining -= len(block) + 1
        else:
            skipped.append(f"{item[1]}#{item[2] + 1}")
    chosen.sort()
    hunks = "\n## Key hunks (prioritized: public symbols > dependency changes > config/migrations)\n" + "\n".join(c[2] for c in chosen)
    if skipped:
        hunks += f"\n\n(Not shown, {len(skipped)} hunks: " + ", ".join(skipped[:40]) + (" …" if len(skipped) > 40 else "") + ")"
    return head + "\n" + hunks + "\n" + tail + "\n"
