"""Extracts references from source files (Ruby, Python, TypeScript, C#) and builds the component dependency graph."""
from __future__ import annotations

import fnmatch
import json
import posixpath
import re

from .util import camelize, lang_of, line_index, singularize, strip_jsonc
from .config import Mapper


TS_RE = re.compile(r"""(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?|\bexport\s+(?:type\s+)?[\w*{}\s,$]*?\s*from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"\n]+)['"]""")
PY_IMPORT = re.compile(r"^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)", re.M)
PY_FROM = re.compile(r"^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)", re.M)
RB_REQ = re.compile(r"""^[ \t]*require(_relative)?[ \t(]+['"]([^'"]+)['"]""", re.M)
RB_DECL = re.compile(r"^(\s*)(?:module|class)\s+((?:::)?[A-Z]\w*(?:::[A-Z]\w*)*)(.*)$")
RB_ASSOC = re.compile(r"^\s*(has_many|has_one|belongs_to|has_and_belongs_to_many)\s+:(\w+)(.*)$")
RB_CLASS_NAME = re.compile(r"""class_name:?\s*(?:=>\s*)?['"]((?:::)?[A-Z][\w:]*)['"]""")
RB_ACRONYM = re.compile(r"""\.acronym\s*\(?\s*['"]([A-Za-z0-9]+)['"]""")
RB_INFLECT = re.compile(r"""['"]([a-z0-9_]+)['"]\s*=>\s*['"]([A-Z][A-Za-z0-9]*)['"]""")
PY_DJ_MODEL = re.compile(r"""\b(?:ForeignKey|OneToOneField|ManyToManyField|ForeignObject)\(\s*(?:to\s*=\s*)?['"]([\w.]+)['"]""")
PY_GET_MODEL = re.compile(r"""\bget_model\(\s*['"](\w+)(?:\.(\w+)['"]|['"]\s*,\s*['"](\w+)['"])""")
PY_DOTTED_CALL = re.compile(r"""\b(?:include|import_string|import_module|send_task|autodiscover_tasks)\(\s*\[?\s*['"]([A-Za-z_][\w.]*)['"]""")
PY_APP_LABEL = re.compile(r"""^\s*label\s*=\s*['"](\w+)['"]""", re.M)
RB_CONST = re.compile(r"(?<![\w:@$])(?:::)?([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)")
RB_STR = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'')
CS_USING = re.compile(r"^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([A-Za-z_][\w.]*)[ \t]*;", re.M)
CS_NS = re.compile(r"^[ \t]*namespace[ \t]+([A-Za-z_][\w.]*)", re.M)
CSPROJ_REF = re.compile(r"""<ProjectReference\s+Include\s*=\s*["']([^"']+)["']""", re.I)


def extract(path: str, text: str) -> dict:
    """Raw references of one file: {"refs": [(kind, raw, line, extra)], "ns": [namespaces]}."""
    lang = lang_of(path)
    refs: list[tuple] = []
    ns: list[str] = []
    extra: dict = {}
    if not lang or text is None:
        return {"refs": refs, "ns": ns}
    lineno = line_index(text)
    if lang == "ts":
        for m in TS_RE.finditer(text):
            refs.append(("ts", m.group(1), lineno(m.start(1)), None))
    elif lang == "py":
        for m in PY_IMPORT.finditer(text):
            for part in m.group(1).split(","):
                mod = part.strip().split()[0] if part.strip() else ""
                if mod:
                    refs.append(("py", mod, lineno(m.start()), ()))
        for m in PY_FROM.finditer(text):
            names = tuple(n.strip().split()[0] for n in m.group(2).strip("() \t\n").split(",")
                          if n.strip() and n.strip() != "*")
            refs.append(("py", m.group(1), lineno(m.start()), names))
        # Django references by string: lazy model relations, get_model(), include("app.urls"), celery tasks
        for m in PY_DJ_MODEL.finditer(text):
            refs.append(("dj_model", m.group(1), lineno(m.start()), None))
        for m in PY_GET_MODEL.finditer(text):
            refs.append(("dj_model", f"{m.group(1)}.{m.group(2) or m.group(3)}", lineno(m.start()), None))
        for m in PY_DOTTED_CALL.finditer(text):
            refs.append(("py", m.group(1), lineno(m.start()), ()))
        if path.endswith("apps.py"):
            label = PY_APP_LABEL.search(text)
            if label:
                extra["dj_label"] = label.group(1)
    elif lang == "erb":  # only the Ruby inside <% %>; HTML text would produce false constants
        seen_erb: set = set()
        for block in re.finditer(r"<%[=-]?(.*?)-?%>", text, re.S):
            code = RB_STR.sub("", block.group(1))
            for m in RB_CONST.finditer(code):
                if m.group(1) not in seen_erb:
                    seen_erb.add(m.group(1))
                    refs.append(("rb_const", m.group(1), lineno(block.start()), ()))
    elif lang == "rb":
        for m in RB_REQ.finditer(text):
            refs.append(("rb_rel" if m.group(1) else "rb_req", m.group(2), lineno(m.start()), None))
        if "inflect" in text:  # Zeitwerk / ActiveSupport inflection config
            extra["rb_acronyms"] = RB_ACRONYM.findall(text)
            extra["rb_inflections"] = RB_INFLECT.findall(text)
        # Lexical nesting follows indentation: a line at or left of an open module/class closes it.
        stack: list[tuple[int, str]] = []
        seen: set = set()

        def add_const(c: str, i: int):
            key = (c, tuple(n for _, n in stack))
            if key not in seen:
                seen.add(key)
                refs.append(("rb_const", c, i, key[1]))

        for i, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("require"):
                continue
            indent = len(line) - len(line.lstrip())
            while stack and stack[-1][0] >= indent:
                stack.pop()
            decl = RB_DECL.match(line)
            if decl:
                superclass = decl.group(3).split("<", 1)[1] if "<" in decl.group(3) else ""
                for m in RB_CONST.finditer(RB_STR.sub("", superclass).split(" #")[0]):
                    add_const(m.group(1), i)
                name = decl.group(2).lstrip(":")
                stack.append((indent, f"{stack[-1][1]}::{name}" if stack and not decl.group(2).startswith("::") else name))
                continue
            assoc = RB_ASSOC.match(line)
            if assoc and "polymorphic" not in assoc.group(3) and "through:" not in assoc.group(3):
                named = RB_CLASS_NAME.search(assoc.group(3))
                plural = assoc.group(1) in ("has_many", "has_and_belongs_to_many")
                target = named.group(1).lstrip(":") if named else camelize(singularize(assoc.group(2)) if plural else assoc.group(2))
                add_const(target, i)
            for m in RB_CONST.finditer(RB_STR.sub("", line).split(" #")[0]):
                add_const(m.group(1), i)
    elif lang == "cs":
        for m in CS_USING.finditer(text):
            refs.append(("cs_using", m.group(1), lineno(m.start()), None))
        ns = [m.group(1) for m in CS_NS.finditer(text)]
    elif lang == "csproj":
        for m in CSPROJ_REF.finditer(text):
            refs.append(("csproj", m.group(1), lineno(m.start()), None))
    return {"refs": refs, "ns": ns, **extra}


class SideIndex:
    """Resolves raw references to components for one side (base or head) of the change."""

    EXTERNAL, UNRESOLVED = "__external__", "__unresolved__"
    TS_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs",
                   "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]

    def __init__(self, files: set[str], mapper: Mapper, tsconfigs: list[dict], extracted: dict[str, dict]):
        self.files = files
        self.lower = {f.lower(): f for f in files}
        self.mapper = mapper
        self.tsconfigs = tsconfigs
        self.overrides = {k: [(c["id"], c[k]) for c in mapper.comps if c[k]]
                          for k in ("imports", "namespaces", "constants")}
        self.py_index: dict[str, str] = {}
        # Python roots: repo, src/, every manage.py dir and the parent of every Django app (apps/<app>/apps.py).
        app_files = sorted(f for f in files if posixpath.basename(f) == "apps.py")
        roots = [""] + sorted(({posixpath.dirname(f) for f in files if posixpath.basename(f) == "manage.py"}
                               | {posixpath.dirname(posixpath.dirname(f)) for f in app_files}) - {""})
        if any(f.startswith("src/") for f in files) and "src" not in roots:
            roots.append("src")
        self.dj_apps: dict[str, str] = {}  # app label → app dir
        for f in app_files:
            label = (extracted.get(f) or {}).get("dj_label") or posixpath.basename(posixpath.dirname(f))
            self.dj_apps.setdefault(label, posixpath.dirname(f))
        for root in roots:
            for f in sorted(files):
                if f.endswith(".py") and (not root or f.startswith(root + "/")):
                    mod = (f[len(root) + 1:] if root else f)[:-3].replace("/", ".")
                    mod = mod[:-9] if mod.endswith(".__init__") else mod
                    self.py_index.setdefault(mod, f)
        acronyms: dict[str, str] = {}
        inflections: dict[str, str] = {}
        for f in sorted(extracted):
            for a in extracted[f].get("rb_acronyms", []):
                acronyms[a.lower()] = a
            inflections.update(dict(extracted[f].get("rb_inflections", [])))
        self.rb_index: dict[str, str] = {}
        for f in sorted(files):
            if not f.endswith(".rb"):
                continue
            parts = f[:-3].split("/")
            for rel in self._zeitwerk_rels(parts):
                self.rb_index.setdefault("::".join(camelize(s, acronyms, inflections) for s in rel), f)
        self.cs_ns: dict[str, set[str]] = {}
        for f, ex in extracted.items():
            comp = mapper.component(f)
            for n in ex["ns"]:
                if comp:
                    self.cs_ns.setdefault(n, set()).add(comp)

    @staticmethod
    def _zeitwerk_rels(parts: list[str]) -> list[list[str]]:
        for i, p in enumerate(parts):
            if p == "app" and i + 2 < len(parts):
                rels = [parts[i + 2:]]
                if parts[i + 2] == "concerns" and i + 3 < len(parts):
                    rels.append(parts[i + 3:])
                return rels
            if p == "lib" and i + 1 < len(parts):
                return [parts[i + 1:]]
        return []

    def _override(self, kind: str, raw: str) -> str | None:
        for comp, pats in self.overrides[kind]:
            if any(fnmatch.fnmatchcase(raw, p) for p in pats):
                return comp
        return None

    def _file(self, path: str) -> str | None:
        path = posixpath.normpath(path)
        return path if path in self.files else None

    def resolve(self, src: str, ref: tuple) -> tuple[str, str | None]:
        """Returns (component id | EXTERNAL | UNRESOLVED, target file or None)."""
        kind, raw, _, extra = ref
        override_kind = {"cs_using": "namespaces", "rb_const": "constants", "dj_model": "imports"}.get(kind, "imports")
        comp = self._override(override_kind, raw)
        if comp:
            return comp, None
        target = None
        if kind == "ts":
            target = self._resolve_ts(src, raw)
            if target in (self.EXTERNAL, self.UNRESOLVED):
                return target, None
        elif kind == "py":
            target = self._resolve_py(src, raw, extra)
            if target in (self.EXTERNAL, self.UNRESOLVED):
                return target, None
        elif kind == "rb_rel":
            base = posixpath.join(posixpath.dirname(src), raw)
            target = self._file(base if base.endswith(".rb") else base + ".rb")
            if not target:
                return self.UNRESOLVED, None
        elif kind == "rb_req":
            target = next((t for t in (f"lib/{raw}.rb", f"{raw}.rb", f"app/{raw}.rb") if self._file(t)), None)
            if not target:
                return self.EXTERNAL, None
        elif kind == "rb_const":
            target = self._resolve_rb_const(raw, extra)
            if not target or target == src:
                return self.EXTERNAL, None
        elif kind == "dj_model":
            if "." not in raw:  # same app
                return self.EXTERNAL, None
            app_dir = self.dj_apps.get(raw.split(".")[0])
            if app_dir is None:  # e.g. auth.User
                return self.EXTERNAL, None
            target = next((t for t in (f"{app_dir}/models.py", f"{app_dir}/models/__init__.py", f"{app_dir}/apps.py")
                           if self._file(t)), None)
        elif kind == "cs_using":
            comps = self.cs_ns.get(raw)
            if not comps:
                return self.EXTERNAL, None
            return sorted(comps)[0] if len(comps) == 1 else ",".join(sorted(comps)), None
        elif kind == "csproj":
            path = posixpath.normpath(posixpath.join(posixpath.dirname(src), raw.replace("\\", "/")))
            target = self._file(path) or self.lower.get(path.lower())
            if not target:
                return self.UNRESOLVED, None
        if not target:
            return self.UNRESOLVED, None
        return self.mapper.component(target) or "__unmapped__", target

    def _resolve_ts(self, src: str, spec: str) -> str:
        if spec.startswith("."):
            return self._try_ts(posixpath.join(posixpath.dirname(src), spec)) or self.UNRESOLVED
        for tc in self.tsconfigs:
            if tc["dir"] and not src.startswith(tc["dir"] + "/"):
                continue
            for alias, targets in tc["paths"]:
                if "*" in alias:
                    pre, post = alias.split("*", 1)
                    if not (spec.startswith(pre) and spec.endswith(post) and len(spec) >= len(pre) + len(post)):
                        continue
                    star = spec[len(pre):len(spec) - len(post)]
                elif spec == alias:
                    star = ""
                else:
                    continue
                for t in targets:
                    hit = self._try_ts(posixpath.join(tc["base"], t.replace("*", star)))
                    if hit:
                        return hit
            if tc["has_base_url"]:
                hit = self._try_ts(posixpath.join(tc["base"], spec))
                if hit:
                    return hit
        return self.EXTERNAL

    def _try_ts(self, base: str) -> str | None:
        base = posixpath.normpath(base)
        stems = [base]
        if re.search(r"\.(m|c)?js$", base):
            stems.append(re.sub(r"\.(m|c)?js$", "", base))
        for stem in stems:
            for suf in self.TS_SUFFIXES:
                if stem + suf in self.files:
                    return stem + suf
        return None

    def _resolve_py(self, src: str, mod: str, names: tuple) -> str:
        if mod.startswith("."):
            level = len(mod) - len(mod.lstrip("."))
            pkg = posixpath.dirname(src)
            for _ in range(level - 1):
                pkg = posixpath.dirname(pkg)
            rest = mod.lstrip(".").replace(".", "/")
            base = posixpath.join(pkg, rest) if rest else pkg
            cands = [f"{base}/{n}.py" for n in names or ()] + [f"{base}/{n}/__init__.py" for n in names or ()]
            cands += [f"{base}.py", f"{base}/__init__.py"]
            return next((self._file(c) for c in cands if self._file(c)), None) or self.UNRESOLVED
        cands = [f"{mod}.{n}" for n in names or ()] + [mod]
        for cand in cands:
            parts = cand.split(".")
            while parts:
                hit = self.py_index.get(".".join(parts))
                if hit:
                    return hit
                parts.pop()
        return self.EXTERNAL

    def _resolve_rb_const(self, const: str, nesting: tuple) -> str | None:
        prefixes = list(reversed(nesting or ())) + [""]
        parts = const.split("::")
        while parts:
            name = "::".join(parts)
            for pre in prefixes:
                hit = self.rb_index.get(f"{pre}::{name}" if pre else name)
                if hit:
                    return hit
            parts.pop()
        return None


def load_tsconfigs(files: list[str], read) -> list[dict]:
    out = []
    for f in files:
        name = posixpath.basename(f)
        if not (name.startswith("tsconfig") and name.endswith(".json")) or f.count("/") > 3:
            continue
        text = read(f)
        if not text:
            continue
        try:
            opts = json.loads(strip_jsonc(text)).get("compilerOptions", {}) or {}
        except (json.JSONDecodeError, AttributeError):
            continue
        if not opts.get("paths") and not opts.get("baseUrl"):
            continue
        d = posixpath.dirname(f)
        base = posixpath.normpath(posixpath.join(d, opts.get("baseUrl", "."))) if d or opts.get("baseUrl") else ""
        base = "" if base == "." else base
        out.append({"dir": d, "base": base, "has_base_url": "baseUrl" in opts,
                    "paths": sorted((k, list(v)) for k, v in (opts.get("paths") or {}).items())})
    return sorted(out, key=lambda t: (-len(t["dir"]), t["dir"]))


def build_edges(extracted: dict[str, dict], index: SideIndex, mapper: Mapper) -> tuple[dict, int]:
    edges: dict[tuple[str, str], dict] = {}
    unresolved = 0
    for src in sorted(extracted):
        scomp = mapper.component(src)
        if not scomp:
            continue
        seen: set[str] = set()
        for ref in extracted[src]["refs"]:
            target, tfile = index.resolve(src, ref)
            if target == index.UNRESOLVED:
                unresolved += 1
                continue
            if target in (index.EXTERNAL, "__unmapped__"):
                continue
            for dcomp in target.split(","):
                if dcomp == scomp:
                    continue
                key = f"{dcomp}|{tfile or ref[1]}"
                if key in seen:
                    continue
                seen.add(key)
                e = edges.setdefault((scomp, dcomp), {"count": 0, "lines": {}, "targets": set()})
                e["count"] += 1
                e["lines"].setdefault(src, ref[2])
                if tfile:
                    e["targets"].add(tfile)
    return edges, unresolved


def rule_violation(src: str, dst: str, cfg: dict, layer_of: dict) -> str | None:
    rules = cfg["rules"]
    pairs = [(a, b) for a in (src, layer_of[src]) for b in (dst, layer_of[dst])]
    for a, b in pairs:
        if (a, b) in rules["forbid"]:
            return f"forbidden: {a} -> {b}"
    if not rules["allow"]:
        return None
    if rules["same_layer"] and layer_of[src] == layer_of[dst]:
        return None
    if any(p in rules["allow"] for p in pairs):
        return None
    return f"not allowed: {layer_of[src]} -> {layer_of[dst]}"


# ───────────────────────────── symbols ─────────────────────────────

SYMBOL_RES = {  # each regex exposes (?P<k>kind) or a fixed kind, and (?P<n>name)
    "ts": [(None, re.compile(r"^\s*export\s+(?:default\s+)?(?:abstract\s+|declare\s+)?(?P<k>class|interface|function|const|type|enum)\s+(?P<n>[A-Za-z_$][\w$]*)"))],
    "py": [(None, re.compile(r"^(?:async\s+)?(?P<k>class|def)\s+(?P<n>[A-Za-z]\w*)")),
           ("method", re.compile(r"^\s{4}(?:async\s+)?def\s+(?P<n>[a-zA-Z]\w*)"))],
    "rb": [(None, re.compile(r"^\s*(?P<k>class|module)\s+(?P<n>[A-Z][\w:]*)")),
           ("def", re.compile(r"^\s*def\s+(?P<n>(?:self\.)?[a-z_]\w*[?!=]?)"))],
    "cs": [(None, re.compile(r"^\s*public\s+(?:(?:static|sealed|abstract|partial|readonly|ref)\s+)*(?P<k>class|interface|record|struct|enum)\s+(?P<n>\w+)")),
           ("method", re.compile(r"^\s*public\s+(?:(?:static|async|override|virtual|abstract|sealed|new|extern)\s+)*(?!class\b|interface\b|record\b|struct\b|enum\b)[\w.?\[\],]+(?:<[^>]*>)?\??\s+(?P<n>\w+)\s*[(<]"))],
}
ENDPOINT_RES = [  # Rails routes, Django urls, ASP.NET attributes, Angular routes
    re.compile(r"^\s*(?P<k>get|post|put|patch|delete|resources|resource)\s+['\":]?(?P<n>[\w/:{}.-]+)"),
    re.compile(r"\b(?P<k>re_path|path)\(\s*r?['\"](?P<n>[^'\"]*)['\"]"),
    re.compile(r"\[(?P<k>Http(?:Get|Post|Put|Patch|Delete)|Route)(?:\(\s*\"(?P<n>[^\"]*)\"[^)]*\))?\]"),
    re.compile(r"\b(?P<k>path)\s*:\s*['\"](?P<n>[^'\"]*)['\"]\s*,\s*(?:component|loadComponent|loadChildren|children|redirectTo)"),
    re.compile(r"\b(?P<k>register)\(\s*r?['\"](?P<n>[^'\"]+)['\"]\s*,"),
]


def extract_symbols(f: dict) -> list[dict]:
    lang = lang_of(f["path"])
    found: dict[tuple, dict] = {}
    for h in f["hunks"]:
        old, new = h["old_start"], h["new_start"]
        for t, body in h["lines"]:
            if t in "+-":
                hits = []
                for kind, rx in SYMBOL_RES.get(lang or "", []):
                    m = rx.match(body)
                    if m and not m.group("n").startswith("_"):
                        hits.append((kind or m.group("k"), m.group("n")))
                        break
                if lang and lang != "erb":
                    for rx in ENDPOINT_RES:
                        m = rx.search(body)
                        if m:
                            hits.append(("endpoint", f"{m.group('k')} {m.group('n') or ''}".strip()))
                            break
                for kind, name in hits:
                    e = found.setdefault((kind, name), {"file": f["path"], "line": new if t == "+" else old,
                                                        "kind": kind, "name": name, "added": False, "removed": False})
                    e["added" if t == "+" else "removed"] = True
                    if t == "+":
                        e["line"] = new
            if t != "-":
                new += 1
            if t != "+":
                old += 1
    return [{"file": e["file"], "line": e["line"], "kind": e["kind"], "name": e["name"],
             "change": "modified" if e["added"] and e["removed"] else ("added" if e["added"] else "removed")}
            for e in found.values()]
