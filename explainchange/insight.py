"""Validates and normalises the agent-written insight.json."""
from __future__ import annotations

import re
from pathlib import Path

from .openspec import spec_requirements


# Single source of truth for the agent contract: the validator, the digest template and the
# schema test (tests/test_contract.py) all read these.
INSIGHT_LIMITS = {
    "tldr": 280, "intent": 200,
    "changes.summary": 140, "decisions": 5, "decisions.title": 80, "decisions.why": 200,
    "decisions.alternative": 140, "flows": 3, "flows.title": 60, "flows.steps": 12, "flows.steps.msg": 50,
    "hero": 2, "hero.label": 40, "story": 8, "story.heading": 60, "story.body": 160, "story.focus": 6,
    "spec": 80, "spec.components": 6, "spec.tests": 4, "spec.note": 160,
    "flows.steps.data.type": 40, "flows.steps.data.fields": 8, "flows.steps.data.fields.item": 60,
    "data_model.entities": 12, "data_model.entities.name": 40, "data_model.entities.fields": 12,
    "data_model.entities.fields.item": 60, "data_model.relations": 16, "data_model.relations.label": 30,
}
INSIGHT_ENUMS = {
    "flows.steps.status": ["same", "changed", "new", "removed"],
    "spec.status": ["implemented", "partial", "missing", "n/a"],
    "data_model.entities.change": ["added", "changed", "removed", "same"],
    "data_model.relations.change": ["added", "changed", "removed", "same"],
}
INSIGHT_FIELDS = ["version", "key", "lang", "tldr", "intent", "story", "hero", "changes", "decisions",
                  "flows", "data_model", "spec"]

# Prose: the parts of ASD-STE100 (Simplified Technical English) that help a design document, not its restricted
# dictionary: technical names are the content and stay exactly as in the code. Two rules are enforced (sentence
# length and a short list of vague words, English and Spanish); the rest is guidance in the digest.
MAX_SENTENCE_WORDS = 25
REF_RE = re.compile(r"^(.+?):(\d+)(?:-(\d+))?$")  # file:line or file:a-b
VAGUE_WORDS = [
    "leverage", "leverages", "leveraging", "utilize", "utilizes", "orchestrate", "orchestrates", "seamless",
    "seamlessly", "robust", "facilitate", "facilitates", "in order to", "streamline", "streamlines", "enhance",
    "enhances", "comprehensive", "holistic", "crucial", "empower", "empowers", "ensures", "delve",
    "aprovecha", "aprovechar", "orquesta", "orquestar", "robusto", "robusta", "de cara a", "con el fin de",
    "a nivel de", "potencia", "potenciar", "integral", "garantiza", "optimiza",
]
PROSE_RULES = (
    "Simplified Technical English (ASD-STE100) style, adapted to design documents, in the report's language: "
    "one idea per sentence; at most 25 words per sentence (enforced); active voice, present tense; say what the "
    "change does and its effect, not how good it is; simple common verbs (adds, sends, stores, calls, checks, "
    "replaces); the same word for the same thing, and component, type and field names exactly as in the code and "
    "on the map; numbers as digits; no idioms, no filler, no marketing words (refused: "
    + ", ".join(VAGUE_WORDS[:9]) + " …).")
STORY_MIN = 2


def hunk_ranges(f: dict) -> list[tuple[int, int]]:
    side = "old" if f["status"] == "D" else "new"
    return [(h[f"{side}_start"], h[f"{side}_start"] + max(h[f"{side}_len"], 1) - 1) for h in f["hunks"]]


def touched_components(ctx: dict) -> list[str]:
    return [c["id"] for c in ctx["components"] if c["status"] != "context"]


def insight_components(ctx: dict) -> list[str]:
    """Component ids the agent may use in flows: this change and its neighbours first, then the rest of the config."""
    shown = [c["id"] for c in ctx["components"]]
    return shown + [c["id"] for c in ctx["config"]["components"] if c["id"] not in shown]


def validate_insight(ins, ctx: dict, root: Path | None = None) -> list[str]:
    errs: list[str] = []
    if not isinstance(ins, dict):
        return ["insight: must be a JSON object"]
    L, E = INSIGHT_LIMITS, INSIGHT_ENUMS
    comp_ids = set(insight_components(ctx))
    files = {f["path"]: f for f in ctx["files"]}
    for k in ins:
        if k not in INSIGHT_FIELDS:
            errs.append(f"{k}: unknown field (allowed: {', '.join(INSIGHT_FIELDS)})")
    if ins.get("key") not in (None, ctx["key"]):
        errs.append(f"key: '{ins.get('key')}' is stale; the change now has key '{ctx['key']}'. Re-read the digest and regenerate.")

    def text(path, value, limit, required=True):
        if value is None or value == "":
            if required:
                errs.append(f"{path}: required")
        elif not isinstance(value, str) or not value.strip():
            errs.append(f"{path}: must be a non-empty string")
        elif len(value) > limit:
            errs.append(f"{path}: {len(value)} chars, max {limit}")
        else:
            prose(path, value)

    def prose(path, value):
        for sentence in re.split(r"(?<=[.!?;])\s+", value):
            n = len(re.findall(r"[\wÀ-ÿ'’-]+", sentence))
            if n > MAX_SENTENCE_WORDS:
                errs.append(f"{path}: a sentence has {n} words, max {MAX_SENTENCE_WORDS}; split it (Simplified Technical English)")
                break
        low = value.lower()
        vague = [w for w in VAGUE_WORDS if re.search(r"(?<![\w])" + re.escape(w) + r"(?![\w])", low)]
        if vague:
            errs.append(f"{path}: replace vague word(s) {', '.join(vague)} with what actually happens")

    def fields(path, value, max_items, limit):
        """'+email: string' added | '-fax' removed | '~total: number' changed | 'id: string' unchanged."""
        if value is None:
            return
        if not isinstance(value, list):
            errs.append(f"{path}: must be an array of strings")
            return
        if len(value) > max_items:
            errs.append(f"{path}: {len(value)} items, max {max_items}; keep the fields that matter for this change")
        for k, f in enumerate(value):
            if not isinstance(f, str) or not f.strip() or len(f) > limit:
                errs.append(f"{path}[{k}]: a field like '+email: string' (max {limit} chars)")

    def enum(path, value, key):
        if value not in E[key]:
            errs.append(f"{path}: '{value}' must be one of {'|'.join(E[key])}")

    def lst(path, value, max_items):
        if value is None:
            return []
        if not isinstance(value, list):
            errs.append(f"{path}: must be an array")
            return []
        if len(value) > max_items:
            errs.append(f"{path}: {len(value)} items, max {max_items}")
        return [v for v in value if isinstance(v, dict)]

    def location(path, value, required):
        """file:line or file:a-b, inside a hunk of a changed file (so the report can show it)."""
        if value in (None, ""):
            if required:
                errs.append(f"{path}: required (file:line inside a hunk)")
            return
        m = REF_RE.match(str(value))
        if not m:
            errs.append(f"{path}: '{value}' must be 'file:line' or 'file:a-b'")
            return
        lines_in_hunk(path, m.group(1), int(m.group(2)), int(m.group(3) or m.group(2)))

    def lines_in_hunk(path, file, a, b):
        f = files.get(file)
        if not f:
            errs.append(f"{path}: file '{file}' is not part of this change")
        elif f["hunks"] and not any(a <= hi and b >= lo for lo, hi in hunk_ranges(f)):
            errs.append(f"{path}: {a}-{b} is outside the hunks of {file} "
                        f"({', '.join(f'{lo}-{hi}' for lo, hi in hunk_ranges(f))})")

    text("tldr", ins.get("tldr"), L["tldr"])
    text("intent", ins.get("intent"), L["intent"])

    touched = touched_components(ctx)
    described: set = set()
    changes = ins.get("changes")
    if changes is not None and not isinstance(changes, list):
        errs.append("changes: must be an array")
        changes = []
    for i, c in enumerate(x for x in changes or [] if isinstance(x, dict)):
        cid = c.get("id")
        if cid not in touched:
            errs.append(f"changes[{i}].id: '{cid}' is not a changed component (use: {', '.join(touched)})")
        elif cid in described:
            errs.append(f"changes[{i}].id: '{cid}' is described twice")
        described.add(cid)
        text(f"changes[{i}].summary", c.get("summary"), L["changes.summary"])
    undescribed = [c for c in touched if c not in described]
    if undescribed:
        errs.append(f"changes: missing a one-line summary for {', '.join(undescribed)}")

    for i, d in enumerate(lst("decisions", ins.get("decisions"), L["decisions"])):
        text(f"decisions[{i}].title", d.get("title"), L["decisions.title"])
        text(f"decisions[{i}].why", d.get("why"), L["decisions.why"])
        text(f"decisions[{i}].alternative", d.get("alternative"), L["decisions.alternative"], required=False)
        location(f"decisions[{i}].evidence", d.get("evidence"), required=False)

    reqs = spec_requirements(ctx)
    req_ids = [r["id"] for r in reqs]
    scenario_ids = {f"{r['id']}#{sc['id']}" for r in reqs for sc in r["scenarios"]}
    flow_ids: set = set()
    flow_steps: dict = {}
    for i, fl in enumerate(lst("flows", ins.get("flows"), L["flows"])):
        if isinstance(fl.get("steps"), list):
            flow_steps[str(fl.get("id", ""))] = [x for x in fl["steps"] if isinstance(x, dict)]
        fid = str(fl.get("id", ""))
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", fid):
            errs.append(f"flows[{i}].id: '{fid}' must be kebab-case")
        elif fid in flow_ids:
            errs.append(f"flows[{i}].id: '{fid}' is used twice")
        flow_ids.add(fid)
        text(f"flows[{i}].title", fl.get("title"), L["flows.title"])
        if fl.get("scenario") is not None and fl.get("scenario") not in scenario_ids:
            errs.append(f"flows[{i}].scenario: '{fl.get('scenario')}' is not a scenario of this change "
                        f"(use '<requirement-id>#<scenario-id>': {', '.join(sorted(scenario_ids)[:12]) or 'none'})")
        steps = fl.get("steps")
        if not isinstance(steps, list) or not steps:
            errs.append(f"flows[{i}].steps: at least one step")
            continue
        for j, s in enumerate(lst(f"flows[{i}].steps", steps, L["flows.steps"])):
            for end in ("from", "to"):
                if s.get(end) not in comp_ids:
                    errs.append(f"flows[{i}].steps[{j}].{end}: '{s.get(end)}' is not a component of this change "
                                f"(use: {', '.join(insight_components(ctx))})")
            text(f"flows[{i}].steps[{j}].msg", s.get("msg"), L["flows.steps.msg"])
            enum(f"flows[{i}].steps[{j}].status", s.get("status"), "flows.steps.status")
            data = s.get("data")
            if data is not None:
                if not isinstance(data, dict):
                    errs.append(f"flows[{i}].steps[{j}].data: must be an object {{type, fields}}")
                else:
                    text(f"flows[{i}].steps[{j}].data.type", data.get("type"), L["flows.steps.data.type"])
                    fields(f"flows[{i}].steps[{j}].data.fields", data.get("fields"), L["flows.steps.data.fields"], L["flows.steps.data.fields.item"])

    # data_model: the entities and relations this change touches, as the agent reads them from models/migrations.
    entity_ids: set = set()
    dm = ins.get("data_model")
    if dm is not None and not isinstance(dm, dict):
        errs.append("data_model: must be an object {entities, relations}")
        dm = None
    for i, en in enumerate(lst("data_model.entities", (dm or {}).get("entities"), L["data_model.entities"])):
        eid = str(en.get("id", ""))
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", eid):
            errs.append(f"data_model.entities[{i}].id: '{eid}' must be kebab-case")
        elif eid in entity_ids:
            errs.append(f"data_model.entities[{i}].id: '{eid}' is used twice")
        entity_ids.add(eid)
        text(f"data_model.entities[{i}].name", en.get("name"), L["data_model.entities.name"])
        enum(f"data_model.entities[{i}].change", en.get("change"), "data_model.entities.change")
        fields(f"data_model.entities[{i}].fields", en.get("fields"), L["data_model.entities.fields"], L["data_model.entities.fields.item"])
        if en.get("component") is not None and en.get("component") not in comp_ids:
            errs.append(f"data_model.entities[{i}].component: '{en.get('component')}' is not a component")
        location(f"data_model.entities[{i}].evidence", en.get("evidence"), required=en.get("change") != "same")
    for i, rl in enumerate(lst("data_model.relations", (dm or {}).get("relations"), L["data_model.relations"])):
        for end in ("from", "to"):
            if rl.get(end) not in entity_ids:
                errs.append(f"data_model.relations[{i}].{end}: '{rl.get(end)}' is not an entity (use: {', '.join(sorted(entity_ids)) or 'none'})")
        text(f"data_model.relations[{i}].label", rl.get("label"), L["data_model.relations.label"], required=False)
        enum(f"data_model.relations[{i}].change", rl.get("change"), "data_model.relations.change")

    # spec: every behavioural requirement delta must be mapped to the code (or declared missing).
    covered: set = set()
    for i, sp in enumerate(lst("spec", ins.get("spec"), L["spec"])):
        rid = sp.get("req")
        if rid not in req_ids:
            errs.append(f"spec[{i}].req: '{rid}' is not a requirement of this change (use: {', '.join(req_ids) or 'none'})")
        elif rid in covered:
            errs.append(f"spec[{i}].req: '{rid}' is mapped twice")
        covered.add(rid)
        enum(f"spec[{i}].status", sp.get("status"), "spec.status")
        comps = sp.get("components") or []
        tests = sp.get("tests") or []
        if not isinstance(comps, list) or not isinstance(tests, list):
            errs.append(f"spec[{i}]: components and tests must be arrays")
            continue
        if len(comps) > L["spec.components"]:
            errs.append(f"spec[{i}].components: {len(comps)} items, max {L['spec.components']}")
        if len(tests) > L["spec.tests"]:
            errs.append(f"spec[{i}].tests: {len(tests)} items, max {L['spec.tests']}")
        for c in comps:
            if c not in comp_ids:
                errs.append(f"spec[{i}].components: '{c}' is not a component (use: {', '.join(insight_components(ctx))})")
        for t in tests:
            path = re.sub(r":\d+(?:-\d+)?$", "", str(t))
            if path not in files and not (root and (root / path).is_file()):
                errs.append(f"spec[{i}].tests: '{path}' does not exist")
        if sp.get("status") == "implemented" and not comps and not tests:
            errs.append(f"spec[{i}]: 'implemented' needs at least one component or test")
        text(f"spec[{i}].note", sp.get("note"), L["spec.note"], required=sp.get("status") in ("partial", "missing"))
    must = [r["id"] for r in reqs if r["op"] in ("ADDED", "MODIFIED") and not r.get("merged")]
    unmapped = [r for r in must if r not in covered]
    if unmapped:
        errs.append(f"spec: map every ADDED/MODIFIED requirement to its implementation; missing {', '.join(unmapped)}")

    edge_pairs = {(e["from"], e["to"]) for e in ctx["edges"]}
    for i, hr in enumerate(lst("hero", ins.get("hero"), L["hero"])):
        if (hr.get("from"), hr.get("to")) not in edge_pairs:
            errs.append(f"hero[{i}]: {hr.get('from')} -> {hr.get('to')} is not a dependency drawn for this change "
                        f"(use one of: {', '.join(f'{a} -> {b}' for a, b in sorted(edge_pairs)[:15]) or 'none'})")
        text(f"hero[{i}].label", hr.get("label"), L["hero.label"], required=False)

    drawn = {c["id"] for c in ctx["components"]}
    story = lst("story", ins.get("story"), L["story"])
    if ctx["components"] and len(story) < STORY_MIN:
        errs.append(f"story: {len(story)} steps; write {STORY_MIN}-{L['story']} steps, the headline change first")
    for i, stp in enumerate(story):
        text(f"story[{i}].heading", stp.get("heading"), L["story.heading"])
        text(f"story[{i}].body", stp.get("body"), L["story.body"])
        stage = str(stp.get("stage", "architecture"))
        focus = stp.get("focus") or []
        if not isinstance(focus, list):
            errs.append(f"story[{i}].focus: must be an array")
            focus = []
        if len(focus) > L["story.focus"]:
            errs.append(f"story[{i}].focus: {len(focus)} items, max {L['story.focus']}; light the change, not the diagram")
        if stage == "architecture":
            allowed, hint = drawn, ", ".join(c["id"] for c in ctx["components"])
        elif stage.startswith("flow:"):
            steps = flow_steps.get(stage[5:])
            if steps is None:
                errs.append(f"story[{i}].stage: '{stage}' names no flow (use: {', '.join('flow:' + f for f in flow_steps) or 'none'})")
                continue
            allowed = {x.get("from") for x in steps} | {x.get("to") for x in steps} | {f"#{n}" for n in range(1, len(steps) + 1)}
            hint = f"participants or step numbers #1-#{len(steps)}"
        elif stage == "data" and entity_ids:
            allowed, hint = entity_ids, "entity ids"
        elif stage == "spec" and reqs:
            allowed, hint = set(req_ids) | comp_ids, "requirement ids or component ids"
        else:
            errs.append(f"story[{i}].stage: '{stage}' must be architecture | flow:<id>" + (" | data" if entity_ids else "") + (" | spec" if reqs else ""))
            continue
        for x in focus:
            if x not in allowed:
                errs.append(f"story[{i}].focus: '{x}' is not on stage '{stage}' (use: {hint})")
        location(f"story[{i}].code", stp.get("code"), required=False)
    return errs


def normalize_insight(ins: dict, ctx: dict) -> dict:
    """Deterministic ordering regardless of how the agent wrote the lists, plus computed annotations."""
    cfg = ctx["config"]
    layer_rank = {layer["id"]: i for i, layer in enumerate(cfg["layers"])}
    comp_rank = {c["id"]: (layer_rank.get(c["layer"], 99), i) for i, c in enumerate(cfg["components"])}
    # A flow step is "verified" when the code has a dependency between both components, in either direction,
    # or both depend on a common component (dependency inversion: app calls a port that infra implements, and
    # neither imports the other). `deps` holds every component dependency at HEAD, not only the drawn ones.
    deps = [tuple(d) for d in ctx["deps"]]
    linked = {d for d in deps} | {(b, a) for a, b in deps}
    uses: dict = {}
    for a, b in deps:
        uses.setdefault(a, set()).add(b)

    def check(st: dict) -> dict:
        if st["from"] == st["to"] or (st["from"], st["to"]) in linked:
            return {**st, "verified": True}
        via = sorted(uses.get(st["from"], set()) & uses.get(st["to"], set()))
        return {**st, "verified": bool(via), **({"via": via[0]} if via else {})}
    out = {k: ins[k] for k in INSIGHT_FIELDS if k in ins}
    out["changes"] = sorted(ins.get("changes", []), key=lambda c: comp_rank.get(c["id"], (99, 999)))
    out["decisions"] = ins.get("decisions", [])
    out["flows"] = [{**fl, "steps": [check(s) for s in fl["steps"]]} for fl in ins.get("flows", [])]
    out["story"] = [{**x, "stage": x.get("stage", "architecture"), "focus": x.get("focus", [])} for x in ins.get("story", [])]
    out["hero"] = ins.get("hero", [])
    dm = ins.get("data_model") or {}
    out["data_model"] = {"entities": [{**e, "fields": e.get("fields", [])} for e in dm.get("entities", [])],
                         "relations": dm.get("relations", [])}
    r_order = {r["id"]: i for i, r in enumerate(spec_requirements(ctx))}
    out["spec"] = sorted(({**x, "components": x.get("components", []), "tests": x.get("tests", [])}
                          for x in ins.get("spec", [])), key=lambda x: r_order.get(x["req"], 999))
    return out
