"""Validates and normalises the agent-written insight.json."""
from __future__ import annotations

import re
from pathlib import Path

from .constants import SCHEMA_VERSION
from .openspec import spec_requirements

__all__ = [
    "INSIGHT_LIMITS", "INSIGHT_ENUMS", "INSIGHT_FIELDS", "MAX_SENTENCE_WORDS", "REF_RE", "VAGUE_WORDS", "PROSE_RULES",
    "STORY_MIN", "hunk_ranges", "touched_components", "insight_components", "KEBAB_RE", "validate_insight",
    "InsightValidator", "normalize_insight",
]


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


KEBAB_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def validate_insight(ins, ctx: dict, root: Path | None = None) -> list[str]:
    """Every problem with the agent's insight, as 'field.path: what is wrong (what is allowed)'. Empty when valid."""
    if not isinstance(ins, dict):
        return ["insight: must be a JSON object"]
    return InsightValidator(ctx, root).run(ins)


class InsightValidator:
    """One method per insight section. The field helpers append to `errs` and never raise."""

    def __init__(self, ctx: dict, root: Path | None):
        self.ctx, self.root = ctx, root
        self.errs: list[str] = []
        self.comp_ids = set(insight_components(ctx))
        self.files = {f["path"]: f for f in ctx["files"]}
        self.reqs = spec_requirements(ctx)
        self.req_ids = [r["id"] for r in self.reqs]

    def run(self, ins: dict) -> list[str]:
        self.header(ins)
        self.text("tldr", ins.get("tldr"), INSIGHT_LIMITS["tldr"])
        self.text("intent", ins.get("intent"), INSIGHT_LIMITS["intent"])
        self.changes(ins.get("changes"))
        self.decisions(ins.get("decisions"))
        flow_steps = self.flows(ins.get("flows"))
        entity_ids = self.data_model(ins.get("data_model"))
        self.spec(ins.get("spec"))
        self.hero(ins.get("hero"))
        self.story(ins.get("story"), flow_steps, entity_ids)
        return self.errs

    # ── field helpers ──

    def text(self, path, value, limit, required=True):
        if value is None or value == "":
            if required:
                self.errs.append(f"{path}: required")
        elif not isinstance(value, str) or not value.strip():
            self.errs.append(f"{path}: must be a non-empty string")
        elif len(value) > limit:
            self.errs.append(f"{path}: {len(value)} chars, max {limit}")
        else:
            self.prose(path, value)

    def prose(self, path, value):
        for sentence in re.split(r"(?<=[.!?;])\s+", value):
            n = len(re.findall(r"[\wÀ-ÿ'’-]+", sentence))
            if n > MAX_SENTENCE_WORDS:
                self.errs.append(f"{path}: a sentence has {n} words, max {MAX_SENTENCE_WORDS}; split it "
                                 "(Simplified Technical English)")
                break
        low = value.lower()
        vague = [w for w in VAGUE_WORDS if re.search(r"(?<![\w])" + re.escape(w) + r"(?![\w])", low)]
        if vague:
            self.errs.append(f"{path}: replace vague word(s) {', '.join(vague)} with what actually happens")

    def fields(self, path, value, max_items, limit):
        """'+email: string' added | '-fax' removed | '~total: number' changed | 'id: string' unchanged."""
        if value is None:
            return
        if not isinstance(value, list):
            self.errs.append(f"{path}: must be an array of strings")
            return
        if len(value) > max_items:
            self.errs.append(f"{path}: {len(value)} items, max {max_items}; "
                             "keep the fields that matter for this change")
        for k, f in enumerate(value):
            if not isinstance(f, str) or not f.strip() or len(f) > limit:
                self.errs.append(f"{path}[{k}]: a field like '+email: string' (max {limit} chars)")

    def enum(self, path, value, key):
        if value not in INSIGHT_ENUMS[key]:
            self.errs.append(f"{path}: '{value}' must be one of {'|'.join(INSIGHT_ENUMS[key])}")

    def objects(self, path, value, max_items=None) -> list[tuple[int, dict]]:
        """(index, item) for each object of an optional array; any other item is an error, so indices stay exact."""
        if value is None:
            return []
        if not isinstance(value, list):
            self.errs.append(f"{path}: must be an array")
            return []
        if max_items is not None and len(value) > max_items:
            self.errs.append(f"{path}: {len(value)} items, max {max_items}")
        out = []
        for i, v in enumerate(value):
            if isinstance(v, dict):
                out.append((i, v))
            else:
                self.errs.append(f"{path}[{i}]: must be an object")
        return out

    def location(self, path, value, required):
        """file:line or file:a-b, inside a hunk of a changed file (so the report can show it)."""
        if value in (None, ""):
            if required:
                self.errs.append(f"{path}: required (file:line inside a hunk)")
            return
        m = REF_RE.match(str(value))
        if not m:
            self.errs.append(f"{path}: '{value}' must be 'file:line' or 'file:a-b'")
            return
        file, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        f = self.files.get(file)
        if not f:
            self.errs.append(f"{path}: file '{file}' is not part of this change")
        elif f["hunks"] and not any(a <= hi and b >= lo for lo, hi in hunk_ranges(f)):
            self.errs.append(f"{path}: {a}-{b} is outside the hunks of {file} "
                             f"({', '.join(f'{lo}-{hi}' for lo, hi in hunk_ranges(f))})")

    # ── sections ──

    def header(self, ins: dict):
        for k in ins:
            if k not in INSIGHT_FIELDS:
                self.errs.append(f"{k}: unknown field (allowed: {', '.join(INSIGHT_FIELDS)})")
        if ins.get("key") not in (None, self.ctx["key"]):
            self.errs.append(f"key: '{ins.get('key')}' is stale; the change now has key '{self.ctx['key']}'. "
                             "Re-read the digest and regenerate.")
        if ins.get("version") not in (None, SCHEMA_VERSION):
            self.errs.append(f"version: '{ins.get('version')}' must be {SCHEMA_VERSION}")
        lang = self.ctx["config"].get("lang", "en")
        if ins.get("lang") not in (None, lang):
            self.errs.append(f"lang: '{ins.get('lang')}' must be '{lang}', the report language; write the prose in it")

    def changes(self, value):
        touched = touched_components(self.ctx)
        described: set = set()
        for i, c in self.objects("changes", value):
            cid = c.get("id")
            if cid not in touched:
                self.errs.append(f"changes[{i}].id: '{cid}' is not a changed component (use: {', '.join(touched)})")
            elif cid in described:
                self.errs.append(f"changes[{i}].id: '{cid}' is described twice")
            described.add(cid)
            self.text(f"changes[{i}].summary", c.get("summary"), INSIGHT_LIMITS["changes.summary"])
        undescribed = [c for c in touched if c not in described]
        if undescribed:
            self.errs.append(f"changes: missing a one-line summary for {', '.join(undescribed)}")

    def decisions(self, value):
        L = INSIGHT_LIMITS
        for i, d in self.objects("decisions", value, L["decisions"]):
            self.text(f"decisions[{i}].title", d.get("title"), L["decisions.title"])
            self.text(f"decisions[{i}].why", d.get("why"), L["decisions.why"])
            self.text(f"decisions[{i}].alternative", d.get("alternative"), L["decisions.alternative"], required=False)
            self.location(f"decisions[{i}].evidence", d.get("evidence"), required=False)

    def flows(self, value) -> dict[str, list[dict]]:
        """Returns the steps of each flow by id, for the story's flow stages."""
        L = INSIGHT_LIMITS
        scenario_ids = {f"{r['id']}#{sc['id']}" for r in self.reqs for sc in r["scenarios"]}
        flow_steps: dict[str, list[dict]] = {}
        for i, fl in self.objects("flows", value, L["flows"]):
            fid = str(fl.get("id", ""))
            if not KEBAB_RE.match(fid):
                self.errs.append(f"flows[{i}].id: '{fid}' must be kebab-case")
            elif fid in flow_steps:
                self.errs.append(f"flows[{i}].id: '{fid}' is used twice")
            self.text(f"flows[{i}].title", fl.get("title"), L["flows.title"])
            if fl.get("scenario") is not None and fl.get("scenario") not in scenario_ids:
                known = ", ".join(sorted(scenario_ids)[:12]) or "none"
                self.errs.append(f"flows[{i}].scenario: '{fl.get('scenario')}' is not a scenario of this change "
                                 f"(use '<requirement-id>#<scenario-id>': {known})")
            steps = fl.get("steps")
            if not isinstance(steps, list) or not steps:
                flow_steps.setdefault(fid, [])
                self.errs.append(f"flows[{i}].steps: at least one step")
                continue
            valid_steps = self.objects(f"flows[{i}].steps", steps, L["flows.steps"])
            flow_steps.setdefault(fid, [s for _, s in valid_steps])
            for j, s in valid_steps:
                self.flow_step(f"flows[{i}].steps[{j}]", s)
        return flow_steps

    def flow_step(self, path: str, s: dict):
        L = INSIGHT_LIMITS
        for end in ("from", "to"):
            if s.get(end) not in self.comp_ids:
                self.errs.append(f"{path}.{end}: '{s.get(end)}' is not a component of this change "
                                 f"(use: {', '.join(insight_components(self.ctx))})")
        self.text(f"{path}.msg", s.get("msg"), L["flows.steps.msg"])
        self.enum(f"{path}.status", s.get("status"), "flows.steps.status")
        data = s.get("data")
        if data is None:
            return
        if not isinstance(data, dict):
            self.errs.append(f"{path}.data: must be an object {{type, fields}}")
            return
        self.text(f"{path}.data.type", data.get("type"), L["flows.steps.data.type"])
        self.fields(f"{path}.data.fields", data.get("fields"), L["flows.steps.data.fields"],
                    L["flows.steps.data.fields.item"])

    def data_model(self, dm) -> set[str]:
        """The entities and relations this change touches, as the agent reads them from models and migrations.
        Returns the entity ids, for the story's data stage."""
        L = INSIGHT_LIMITS
        if dm is not None and not isinstance(dm, dict):
            self.errs.append("data_model: must be an object {entities, relations}")
            dm = None
        entity_ids: set[str] = set()
        for i, en in self.objects("data_model.entities", (dm or {}).get("entities"), L["data_model.entities"]):
            path = f"data_model.entities[{i}]"
            eid = str(en.get("id", ""))
            if not KEBAB_RE.match(eid):
                self.errs.append(f"{path}.id: '{eid}' must be kebab-case")
            elif eid in entity_ids:
                self.errs.append(f"{path}.id: '{eid}' is used twice")
            entity_ids.add(eid)
            self.text(f"{path}.name", en.get("name"), L["data_model.entities.name"])
            self.enum(f"{path}.change", en.get("change"), "data_model.entities.change")
            self.fields(f"{path}.fields", en.get("fields"), L["data_model.entities.fields"],
                        L["data_model.entities.fields.item"])
            if en.get("component") is not None and en.get("component") not in self.comp_ids:
                self.errs.append(f"{path}.component: '{en.get('component')}' is not a component")
            self.location(f"{path}.evidence", en.get("evidence"), required=en.get("change") != "same")
        for i, rl in self.objects("data_model.relations", (dm or {}).get("relations"), L["data_model.relations"]):
            for end in ("from", "to"):
                if rl.get(end) not in entity_ids:
                    self.errs.append(f"data_model.relations[{i}].{end}: '{rl.get(end)}' is not an entity "
                                     f"(use: {', '.join(sorted(entity_ids)) or 'none'})")
            self.text(f"data_model.relations[{i}].label", rl.get("label"), L["data_model.relations.label"],
                      required=False)
            self.enum(f"data_model.relations[{i}].change", rl.get("change"), "data_model.relations.change")
        return entity_ids

    def spec(self, value):
        """Every behavioural requirement delta must be mapped to the code (or declared missing)."""
        L = INSIGHT_LIMITS
        covered: set = set()
        for i, sp in self.objects("spec", value, L["spec"]):
            rid = sp.get("req")
            if rid not in self.req_ids:
                self.errs.append(f"spec[{i}].req: '{rid}' is not a requirement of this change "
                                 f"(use: {', '.join(self.req_ids) or 'none'})")
            elif rid in covered:
                self.errs.append(f"spec[{i}].req: '{rid}' is mapped twice")
            covered.add(rid)
            self.enum(f"spec[{i}].status", sp.get("status"), "spec.status")
            comps = sp.get("components") or []
            tests = sp.get("tests") or []
            if not isinstance(comps, list) or not isinstance(tests, list):
                self.errs.append(f"spec[{i}]: components and tests must be arrays")
                continue
            if len(comps) > L["spec.components"]:
                self.errs.append(f"spec[{i}].components: {len(comps)} items, max {L['spec.components']}")
            if len(tests) > L["spec.tests"]:
                self.errs.append(f"spec[{i}].tests: {len(tests)} items, max {L['spec.tests']}")
            for c in comps:
                if c not in self.comp_ids:
                    self.errs.append(f"spec[{i}].components: '{c}' is not a component "
                                     f"(use: {', '.join(insight_components(self.ctx))})")
            for t in tests:
                path = re.sub(r":\d+(?:-\d+)?$", "", str(t))
                if path not in self.files and not (self.root and (self.root / path).is_file()):
                    self.errs.append(f"spec[{i}].tests: '{path}' does not exist")
            if sp.get("status") == "implemented" and not comps and not tests:
                self.errs.append(f"spec[{i}]: 'implemented' needs at least one component or test")
            self.text(f"spec[{i}].note", sp.get("note"), L["spec.note"],
                      required=sp.get("status") in ("partial", "missing"))
        must = [r["id"] for r in self.reqs if r["op"] in ("ADDED", "MODIFIED") and not r.get("merged")]
        unmapped = [r for r in must if r not in covered]
        if unmapped:
            self.errs.append(f"spec: map every ADDED/MODIFIED requirement to its implementation; "
                             f"missing {', '.join(unmapped)}")

    def hero(self, value):
        edge_pairs = {(e["from"], e["to"]) for e in self.ctx["edges"]}
        for i, hr in self.objects("hero", value, INSIGHT_LIMITS["hero"]):
            if (hr.get("from"), hr.get("to")) not in edge_pairs:
                drawn = ", ".join(f"{a} -> {b}" for a, b in sorted(edge_pairs)[:15]) or "none"
                self.errs.append(f"hero[{i}]: {hr.get('from')} -> {hr.get('to')} is not a dependency drawn for this "
                                 f"change (use one of: {drawn})")
            self.text(f"hero[{i}].label", hr.get("label"), INSIGHT_LIMITS["hero.label"], required=False)

    def story(self, value, flow_steps: dict[str, list[dict]], entity_ids: set[str]):
        L = INSIGHT_LIMITS
        story = self.objects("story", value, L["story"])
        if self.ctx["components"] and len(story) < STORY_MIN:
            self.errs.append(f"story: {len(story)} steps; write {STORY_MIN}-{L['story']} steps, "
                             "the headline change first")
        for i, stp in story:
            self.text(f"story[{i}].heading", stp.get("heading"), L["story.heading"])
            self.text(f"story[{i}].body", stp.get("body"), L["story.body"])
            focus = stp.get("focus") or []
            if not isinstance(focus, list):
                self.errs.append(f"story[{i}].focus: must be an array")
                focus = []
            if len(focus) > L["story.focus"]:
                self.errs.append(f"story[{i}].focus: {len(focus)} items, max {L['story.focus']}; "
                                 "light the change, not the diagram")
            stage = str(stp.get("stage", "architecture"))
            allowed = self.stage_ids(f"story[{i}].stage", stage, flow_steps, entity_ids)
            if allowed is None:
                continue
            ids, hint = allowed
            for x in focus:
                if x not in ids:
                    self.errs.append(f"story[{i}].focus: '{x}' is not on stage '{stage}' (use: {hint})")
            self.location(f"story[{i}].code", stp.get("code"), required=False)

    def stage_ids(self, path, stage, flow_steps, entity_ids) -> tuple[set, str] | None:
        """The ids a story step may focus on its stage, with a hint for errors; None (and an error) for a bad stage."""
        if stage == "architecture":
            return {c["id"] for c in self.ctx["components"]}, ", ".join(c["id"] for c in self.ctx["components"])
        if stage.startswith("flow:"):
            steps = flow_steps.get(stage[5:])
            if steps is None:
                self.errs.append(f"{path}: '{stage}' names no flow "
                                 f"(use: {', '.join('flow:' + f for f in flow_steps) or 'none'})")
                return None
            ids = ({x.get("from") for x in steps} | {x.get("to") for x in steps}
                   | {f"#{n}" for n in range(1, len(steps) + 1)})
            return ids, f"participants or step numbers #1-#{len(steps)}"
        if stage == "data" and entity_ids:
            return entity_ids, "entity ids"
        if stage == "spec" and self.reqs:
            return set(self.req_ids) | self.comp_ids, "requirement ids or component ids"
        self.errs.append(f"{path}: '{stage}' must be architecture | flow:<id>" + (" | data" if entity_ids else "")
                         + (" | spec" if self.reqs else ""))
        return None


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
    out["story"] = [{**x, "stage": x.get("stage", "architecture"), "focus": x.get("focus", [])}
                    for x in ins.get("story", [])]
    out["hero"] = ins.get("hero", [])
    dm = ins.get("data_model") or {}
    out["data_model"] = {"entities": [{**e, "fields": e.get("fields", [])} for e in dm.get("entities", [])],
                         "relations": dm.get("relations", [])}
    r_order = {r["id"]: i for i, r in enumerate(spec_requirements(ctx))}
    out["spec"] = sorted(({**x, "components": x.get("components", []), "tests": x.get("tests", [])}
                          for x in ins.get("spec", [])), key=lambda x: r_order.get(x["req"], 999))
    return out
