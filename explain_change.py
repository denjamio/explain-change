#!/usr/bin/env python3
"""explain-change: architecture-first visual explanation of a code change.

The script decides everything structural (components, dependency edges, rule
violations, section order, diagrams). An agent of any vendor only writes a
small, validated `insight.json`: intent, the story, decisions and data flows. Python stdlib only.

    explain-change pr [--base REF] [--include-uncommitted] [--ado ID|URL] [--spec CHANGE_ID]
    explain-change render | validate | init | check | install
"""
from __future__ import annotations

import argparse
import bisect
import fnmatch
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

if sys.version_info < (3, 11):
    sys.exit(f"explain-change needs Python 3.11 or newer; this is {sys.version.split()[0]} ({sys.executable}).")

import tomllib  # noqa: E402  (after the version check: stdlib only from 3.11)

SCHEMA_VERSION = 1
TOOL_DIR = Path(__file__).resolve().parent
CONFIG_NAME = ".explain-change.toml"
WORK_DIR = ".explain-change"
MAX_SCAN_FILES = 20000
MAX_FILE_BYTES = 512 * 1024
MAX_DIFF_LINES = 30000
DEFAULT_BUDGET = 12000  # digest chars, ~3k tokens

DEFAULT_TESTS = [
    "**/test/**", "**/tests/**", "**/spec/**", "**/__tests__/**", "**/e2e/**",
    "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*_spec.rb", "**/test_*.py",
    "**/*Tests/**", "**/*.Tests/**", "**/*Tests.cs", "**/*Test.cs",
]
DEFAULT_IGNORE = [
    "**/*.lock", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
    "**/Gemfile.lock", "**/poetry.lock", "**/*.min.js", "**/*.map",
    "**/*.generated.*", "**/*.g.cs", "**/*.Designer.cs", "**/dist/**", "**/build/**",
    "**/bin/**", "**/obj/**", "**/node_modules/**", "**/vendor/**", "db/schema.rb",
    "**/__snapshots__/**", "**/*.snap",
]
FRAMEWORK_CONFIG = ["config/initializers/**", "config/environments/**", "config/*.rb", "bin/**", "Rakefile",
                    "config.ru", "**/settings.py", "**/settings/*.py", "**/wsgi.py", "**/asgi.py", "manage.py"]
MIGRATION_PATTERNS = ["**/migrations/**", "**/Migrations/**", "db/migrate/**", "**/db/migrate/**"]
CONFIG_EXT = {".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".xml", ".csproj", ".sln",
              ".props", ".targets", ".config", ".env", ".gradle"}
CONFIG_NAMES = {"Gemfile", "Dockerfile", "Makefile", "Procfile", "Rakefile", "settings.py",
                "routes.rb", "angular.json", "package.json", "requirements.txt", "pyproject.toml"}
DOC_EXT = {".md", ".mdx", ".rst", ".txt", ".adoc"}

LANG_BY_EXT = {
    ".ts": "ts", ".tsx": "ts", ".js": "ts", ".jsx": "ts", ".mjs": "ts", ".cjs": "ts",
    ".py": "py", ".rb": "rb", ".rake": "rb", ".erb": "erb", ".cs": "cs", ".csproj": "csproj",
}

LAYER_HINTS = [  # used by `init` and the no-config fallback
    ("web", "Web / API", {"api", "apis", "controllers", "controller", "web", "ui", "views",
                                   "pages", "components", "routes", "endpoints", "graphql", "frontend",
                                   "client", "app", "presentation", "handlers", "channels", "mailers"}),
    ("application", "Application", {"services", "service", "application", "usecases", "use_cases",
                                     "jobs", "workers", "commands", "queries", "features", "interactors",
                                     "operations", "tasks", "store", "state"}),
    ("domain", "Domain", {"domain", "models", "model", "core", "entities", "entity", "aggregates",
                          "policies", "contracts", "shared"}),
    ("infrastructure", "Infrastructure", {"infra", "infrastructure", "repositories", "repository",
                                          "db", "data", "persistence", "adapters", "clients",
                                          "integrations", "gateways", "lib", "external", "storage"}),
]
CONTAINER_DIRS = {"src", "app", "apps", "lib", "libs", "packages", "services", "modules", "projects",
                  "backend", "frontend", "server", "internal", "pkg", "engines"}


# ───────────────────────────── utilities ─────────────────────────────

class Fail(Exception):
    """User-facing error: printed without traceback."""


def git(args: list[str], cwd: Path, check: bool = True) -> str:
    p = subprocess.run(["git", "-c", "core.quotepath=off", *args], cwd=cwd, capture_output=True)
    if check and p.returncode != 0:
        raise Fail(f"git {' '.join(args)} failed: {p.stderr.decode(errors='replace').strip()}")
    return p.stdout.decode("utf-8", errors="replace")


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


# ───────────────────────────── config ─────────────────────────────

def parse_flow_step(step: str) -> dict | None:
    m = re.match(r"^\s*([\w.-]+)\s*->\s*([\w.-]+)\s*(?::\s*(.*))?$", step)
    if not m:
        return None
    return {"from": m.group(1), "to": m.group(2), "msg": (m.group(3) or "").strip()}


def load_config(root: Path) -> tuple[dict, list[str]]:
    """Returns (normalized config, errors). Falls back to an inferred config."""
    path = root / CONFIG_NAME
    if not path.exists():
        return infer_config(root), []
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise Fail(f"{CONFIG_NAME}: {e}") from None
    return normalize_config(raw, inferred=False)


def normalize_config(raw: dict, inferred: bool) -> tuple[dict, list[str]]:
    errors: list[str] = []
    project = raw.get("project", {}) or {}
    cfg = {
        "inferred": inferred,
        "name": str(project.get("name", "")),
        "direction": str(project.get("direction", "")),
        "lang": str(project.get("lang", "en")),
        "base": str(project.get("base", "")),
        "layers": [], "components": [], "flows": [],
        "rules": {"allow": [], "forbid": [], "same_layer": True},
        "ignore": {"paths": DEFAULT_IGNORE, "tests": DEFAULT_TESTS},
    }
    if cfg["lang"] not in ("en", "es"):
        errors.append(f"project.lang: '{cfg['lang']}' must be 'en' or 'es'")
        cfg["lang"] = "en"
    seen: set[str] = set()
    for i, layer in enumerate(raw.get("layers", []) or []):
        lid = str(layer.get("id", ""))
        if not lid or lid in seen:
            errors.append(f"layers[{i}].id: missing or duplicate '{lid}'")
            continue
        seen.add(lid)
        cfg["layers"].append({"id": lid, "name": str(layer.get("name", lid))})
    layer_ids = {layer["id"] for layer in cfg["layers"]}
    comp_ids: set[str] = set()
    for i, comp in enumerate(raw.get("components", []) or []):
        cid = str(comp.get("id", ""))
        if not re.match(r"^[\w.-]+$", cid) or cid in comp_ids:
            errors.append(f"components[{i}].id: missing, invalid or duplicate '{cid}'")
            continue
        if comp.get("layer") not in layer_ids:
            errors.append(f"components[{i}] '{cid}': layer '{comp.get('layer')}' is not declared in [[layers]]")
            continue
        paths = comp.get("paths") or []
        if isinstance(paths, str):
            paths = [paths]
        if not paths:
            errors.append(f"components[{i}] '{cid}': paths is empty")
        comp_ids.add(cid)
        cfg["components"].append({
            "id": cid, "name": str(comp.get("name", cid)), "layer": comp["layer"],
            "desc": str(comp.get("desc", "")), "paths": [str(p) for p in paths],
            "imports": [str(p) for p in comp.get("imports", []) or []],
            "namespaces": [str(p) for p in comp.get("namespaces", []) or []],
            "constants": [str(p) for p in comp.get("constants", []) or []],
        })
    rules = raw.get("rules", {}) or {}
    names = layer_ids | comp_ids
    for key in ("allow", "forbid"):
        for j, rule in enumerate(rules.get(key, []) or []):
            m = re.match(r"^\s*([\w.-]+)\s*->\s*([\w.-]+)\s*$", str(rule))
            if not m or m.group(1) not in names or m.group(2) not in names:
                errors.append(f"rules.{key}[{j}]: '{rule}' must be 'a -> b' with layer or component ids")
                continue
            cfg["rules"][key].append((m.group(1), m.group(2)))
    cfg["rules"]["same_layer"] = bool(rules.get("same_layer", True))
    for i, fl in enumerate(raw.get("flows", []) or []):
        fid = str(fl.get("id", ""))
        steps = []
        for j, s in enumerate(fl.get("steps", []) or []):
            st = parse_flow_step(str(s))
            if not st or st["from"] not in comp_ids or st["to"] not in comp_ids:
                errors.append(f"flows[{i}].steps[{j}]: '{s}' must be 'compA -> compB : message' with component ids")
                continue
            steps.append(st)
        cfg["flows"].append({"id": fid, "title": str(fl.get("title", fid)), "steps": steps})
    ignore = raw.get("ignore", {}) or {}
    if "paths" in ignore:
        cfg["ignore"]["paths"] = [str(p) for p in ignore["paths"]]
    if "tests" in ignore:
        cfg["ignore"]["tests"] = [str(p) for p in ignore["tests"]]
    return cfg, errors


RAILS_KINDS = {  # app/<kind> → layer; None = not analysed (templates, assets)
    "controllers": "web", "channels": "web", "serializers": "web", "graphql": "web",
    "views": "web", "components": "web", "helpers": "web", "presenters": "web", "decorators": "web",
    "javascript": "web", "frontend": "web", "assets": None,
    "services": "application", "jobs": "application", "workers": "application", "interactors": "application",
    "commands": "application", "queries": "application", "forms": "application", "policies": "application",
    "operations": "application", "use_cases": "application", "validators": "application",
    "models": "domain", "entities": "domain", "value_objects": "domain", "events": "domain",
    "mailers": "infrastructure", "clients": "infrastructure", "adapters": "infrastructure",
    "gateways": "infrastructure", "integrations": "infrastructure", "repositories": "infrastructure",
    "uploaders": "infrastructure", "notifiers": "infrastructure",
}
# Presentation kinds: one "UI" component. Their folders mirror screens, not architecture, so they are never split.
RAILS_UI = ["views", "components", "helpers", "presenters", "decorators", "javascript", "frontend"]
STRUCTURE_LAYERS = {  # short names: they label the diagram bands
    "rails": [("web", "Web"), ("application", "Application"), ("domain", "Domain"),
              ("infrastructure", "Infrastructure"), ("other", "Other")],
    "django": [("web", "Web"), ("apps", "Apps"), ("shared", "Shared"), ("other", "Other")],
}
STRUCTURE_RULES = {
    "rails": ["web -> application", "web -> domain", "application -> domain", "application -> infrastructure",
              "infrastructure -> domain"],
    "django": ["web -> apps", "web -> shared", "apps -> shared"],
}
DJANGO_SHARED = {"core", "common", "shared", "utils", "base", "lib", "libs", "commons"}
DJANGO_WEB = {"api", "apis", "web", "frontend", "gateway", "graphql"}


def detect_structure(files: list[str]) -> dict:
    """Framework-aware component guess, the draft for `init`. Rails: one component per app/<kind>, big kinds split by
    namespace, presentation merged into "ui"; Django: one component per app."""
    src = [f for f in files if not matches_any(f, DEFAULT_IGNORE) and not matches_any(f, DEFAULT_TESTS)]
    is_rails = "config/application.rb" in files or any(f.startswith("app/models/") for f in src) and "Gemfile" in files
    comps: list[dict] = []
    if is_rails:
        by_kind: dict[str, list[str]] = {}
        for f in src:
            parts = f.split("/")
            if len(parts) >= 3 and parts[0] == "app" and (lang_of(f) or parts[1] == "views"):
                by_kind.setdefault(parts[1], []).append(f)
        ui = [k for k in RAILS_UI if k in by_kind]
        if ui:
            comps.append({"id": "ui", "layer": "web", "paths": [f"app/{k}/**" for k in ui], "desc": "Views, components, helpers and JS"})
        for kind in sorted(by_kind, key=lambda k: (list(RAILS_KINDS).index(k) if k in RAILS_KINDS else 99, k)):
            layer = RAILS_KINDS.get(kind, "other")
            if layer is None or kind in RAILS_UI:
                continue
            subs: dict[str, int] = {}
            for f in by_kind[kind]:
                parts = f.split("/")
                if len(parts) > 3 and parts[2] != "concerns":
                    subs[parts[2]] = subs.get(parts[2], 0) + 1
            # Split a kind by namespace only when it is big and the namespace carries real weight (max 6 per kind).
            big = sorted(sorted((sub for sub, n in subs.items() if n >= 8), key=lambda x: (-subs[x], x))[:6]) \
                if len(by_kind[kind]) >= 30 else []
            for sub in big:  # a namespace with its own weight becomes its own component
                # Named after the concept, not the Ruby syntax: Family = app/models/family.rb + app/models/family/**.
                const, label = camelize(sub), sub.replace("_", " ").capitalize()
                root = f"app/{kind}/{sub}.rb"
                comps.append({"id": slugify(f"{kind}-{sub}").lower().replace("_", "-"), "layer": layer,
                              "name": label if kind == "models" else f"{label} {kind}",
                              "paths": ([root] if root in by_kind[kind] else []) + [f"app/{kind}/{sub}/**"],
                              "desc": f"{const} and the {const}:: namespace" if kind == "models" else f"{const}:: {kind}"})
            paths = [f"app/{kind}/**"] + (["config/routes.rb"] if kind == "controllers" and "config/routes.rb" in src else [])
            comps.append({"id": kind.replace("_", "-"), "layer": layer, "paths": paths, "desc": ""})
        if any(f.startswith("lib/") and f.endswith(".rb") for f in src):
            comps.append({"id": "lib", "layer": "infrastructure", "paths": ["lib/**"], "desc": ""})
        for container in ("packs", "engines", "components"):
            packs = sorted({f.split("/")[1] for f in src if f.startswith(container + "/") and f.count("/") >= 2})
            for pack in packs:
                comps.append({"id": slugify(pack).lower().replace("_", "-"), "layer": "other",
                              "paths": [f"{container}/{pack}/**"], "desc": f"{container[:-1]} {pack}"})
        return {"kind": "rails", "components": comps}
    py_dirs = {posixpath.dirname(f) for f in src if f.endswith(".py")}
    # A Django app is a package with apps.py, models or migrations (INSTALLED_APPS entries without apps.py included).
    app_markers = ("apps.py", "models.py", "views.py", "admin.py")
    app_dirs = sorted({posixpath.dirname(f) for f in files if posixpath.basename(f) in app_markers}
                      | {posixpath.dirname(posixpath.dirname(f)) for f in files
                         if f.endswith("/models/__init__.py") or f.endswith("/migrations/__init__.py")})
    settings_dirs = sorted({posixpath.dirname(f) for f in src if posixpath.basename(f) in ("settings.py", "wsgi.py", "asgi.py")}
                           | {posixpath.dirname(posixpath.dirname(f)) for f in src if "/settings/" in f})
    app_dirs = [d for d in app_dirs if d and d not in settings_dirs]
    if app_dirs and any(posixpath.basename(f) == "manage.py" or "/settings" in f for f in files):
        project = next((d for d in settings_dirs if d), None)
        # Sibling packages of the apps that are not apps themselves (lib/, utils/, integrations/) are components too.
        # Nested apps: a package grouping many small apps (integrations/<x>) is one component; a few keep their own.
        nested = {}
        for d in app_dirs:
            parent = next((o for o in app_dirs if d.startswith(o + "/")), None) or posixpath.dirname(d)
            nested.setdefault(parent, []).append(d)
        collapsed = {parent for parent, kids in nested.items() if len(kids) >= 6 and parent not in ("", project)}
        app_dirs = [d for d in app_dirs if not any(d.startswith(c + "/") for c in collapsed)]
        top_apps = [d for d in app_dirs if not any(d.startswith(o + "/") for o in app_dirs)]
        parents = {posixpath.dirname(d) for d in top_apps}
        packages = sorted(set(d for d in py_dirs if d and posixpath.dirname(d) in parents and d not in app_dirs and d != project
                              and not any(d.startswith(a + "/") for a in app_dirs)
                              and posixpath.basename(d) not in ("tests", "migrations", "templatetags", "management"))
                          | collapsed)
        used: set[str] = set()
        for d in sorted(app_dirs + packages, key=lambda d: (d.count("/"), d)):
            label = posixpath.basename(d) or "app"
            cid = slugify(label).lower().replace("_", "-")
            while cid in used:
                cid += "-x"
            used.add(cid)
            is_app = d in app_dirs
            layer = "web" if label in DJANGO_WEB else "shared" if label in DJANGO_SHARED or not is_app else "apps"
            desc = f"Django app {label}" if is_app else f"{len(nested.get(d, []))} apps under {label}/" if d in collapsed else f"package {label}"
            comps.append({"id": cid, "layer": layer, "paths": [f"{d}/**"], "desc": desc})
        if any(f.startswith("templates/") for f in files):
            comps.append({"id": "templates", "layer": "web", "paths": ["templates/**"], "desc": "Project-level templates"})
        if project:
            # Only the project's own modules: apps nested inside the project package keep their own component.
            comps.insert(0, {"id": "project", "layer": "web", "paths": [f"{project}/*.py", f"{project}/settings/**"],
                             "desc": "Settings, root URLs, WSGI/ASGI"})
        return {"kind": "django", "components": comps}
    return {"kind": "generic", "components": infer_components(files)}


def infer_components(files: list[str]) -> list[dict]:
    """Directory-based component guess: first level, or second level under container dirs."""
    groups: dict[str, int] = {}
    for f in files:
        if matches_any(f, DEFAULT_IGNORE) or matches_any(f, DEFAULT_TESTS):
            continue
        parts = f.split("/")
        if len(parts) < 2 or parts[0].startswith("."):
            continue
        key = parts[0]
        if parts[0] in CONTAINER_DIRS and len(parts) > 2:
            key = f"{parts[0]}/{parts[1]}"
        groups[key] = groups.get(key, 0) + 1
    comps = []
    used: set[str] = set()
    for key in sorted(groups):
        cid = slugify(key.replace("/", "-")).lower()
        while cid in used:
            cid += "-x"
        used.add(cid)
        leaf = key.split("/")[-1].lower()
        layer = next((lid for lid, _, words in LAYER_HINTS if leaf in words), "other")
        comps.append({"id": cid, "layer": layer, "paths": [f"{key}/**"], "desc": ""})
    return comps


def structure_layers(structure: dict) -> list[tuple[str, str]]:
    used = {c["layer"] for c in structure["components"]}
    catalog = STRUCTURE_LAYERS.get(structure["kind"]) or [(lid, name) for lid, name, _ in LAYER_HINTS] + [("other", "Other")]
    return [(lid, name) for lid, name in catalog if lid in used]


def infer_config(root: Path) -> dict:
    structure = detect_structure(git(["ls-files"], root).splitlines())
    layers = [{"id": lid, "name": name} for lid, name in structure_layers(structure)]
    cfg, _ = normalize_config({"project": {"name": root.name}, "layers": layers, "components": structure["components"]},
                              inferred=True)
    return cfg


class Mapper:
    """Maps repository paths to components and categories, in config order."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.comps = cfg["components"]
        self.cache: dict[str, str | None] = {}

    def component(self, path: str) -> str | None:
        """The most specific matching pattern wins (longest literal prefix); ties go to config order."""
        if path not in self.cache:
            best = None
            for i, c in enumerate(self.comps):
                for pat in c["paths"]:
                    if glob_re(pat).match(path):
                        key = (len(re.split(r"[*?\[]", pat, maxsplit=1)[0]), -i)
                        if best is None or key > best[0]:
                            best = (key, c["id"])
            self.cache[path] = best[1] if best else None
        return self.cache[path]

    def category(self, path: str) -> str:
        if matches_any(path, self.cfg["ignore"]["paths"]):
            return "ignored"
        if matches_any(path, self.cfg["ignore"]["tests"]):
            return "test"
        if matches_any(path, MIGRATION_PATTERNS):
            return "migration"
        if matches_any(path, FRAMEWORK_CONFIG) or (path.startswith("config/") and not lang_of(path)
                                                    and not path.endswith((".erb", ".haml", ".slim"))):
            return "config"
        name = posixpath.basename(path)
        ext = posixpath.splitext(name)[1].lower()
        if ext in DOC_EXT:
            return "docs"
        if ext in CONFIG_EXT or name in CONFIG_NAMES:
            return "config"
        return "code"


# ───────────────────────────── diff ─────────────────────────────

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


# ───────────────────────────── dependency extraction ─────────────────────────────

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


# ───────────────────────────── collect ─────────────────────────────

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


def ado_source(root: Path, pr: str) -> dict:
    m = re.search(r"(\d+)\s*$", pr.rstrip("/"))
    if not m:
        raise Fail(f"--ado expects a PR id or URL, got '{pr}'")
    pr_id = m.group(1)
    ref = f"refs/explain-change/pr/{pr_id}"
    git(["fetch", "--quiet", "--no-tags", "origin", f"+refs/pull/{pr_id}/merge:{ref}"], root)
    parents = git(["rev-list", "--parents", "-n", "1", ref], root).split()
    if len(parents) < 3:
        raise Fail(f"refs/pull/{pr_id}/merge is not a merge commit; is the PR mergeable?")
    src = {"mode": "ado", "pr_id": pr_id, "head_ref": ref, "head_sha": parents[0], "base_ref": parents[1],
           "merge_base": parents[1], "branch": f"pr-{pr_id}", "title": f"PR {pr_id}", "description": "", "url": ""}
    az = shutil.which("az")  # full path, so az.cmd runs on Windows without a shell
    if az:
        p = subprocess.run([az, "repos", "pr", "show", "--id", pr_id, "-o", "json"],
                           cwd=root, capture_output=True, text=True)
        if p.returncode == 0:
            try:
                meta = json.loads(p.stdout)
                src["title"] = meta.get("title") or src["title"]
                src["description"] = (meta.get("description") or "")[:4000]
                src["branch"] = (meta.get("sourceRefName") or "").replace("refs/heads/", "") or src["branch"]
                src["base_ref"] = (meta.get("targetRefName") or "").replace("refs/heads/", "") or src["base_ref"]
                repo = meta.get("repository", {}) or {}
                if repo.get("webUrl"):
                    src["url"] = f"{repo['webUrl']}/pullrequest/{pr_id}"
            except json.JSONDecodeError:
                pass
    if pr.startswith("http"):
        src["url"] = src["url"] or pr
    return src


def collect(root: Path, cfg: dict, base_arg: str | None, uncommitted: bool, ado: str | None,
            specs: list[str] | None = None) -> dict:
    mapper = Mapper(cfg)
    notes: list[str] = []
    if ado:
        src = ado_source(root, ado)
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

    diff_args = ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", mb]
    if head_rev:
        diff_args.append(head_rev)
    raw_diff = git(diff_args, root)
    files = parse_diff(raw_diff)
    if uncommitted and not ado:
        extra = untracked_as_diff(root)
        files += extra
        raw_diff += "".join(f"\nuntracked {f['path']}\n" + "\n".join(ln[1] for ln in (f["hunks"][0]["lines"] if f["hunks"] else []))
                            for f in extra)
    files.sort(key=lambda f: f["path"])

    total_lines = 0
    for f in files:
        f["component"] = mapper.component(f["path"]) or (mapper.component(f["old_path"]) if f["old_path"] else None)
        f["category"] = mapper.category(f["path"])
        n = sum(len(h["lines"]) for h in f["hunks"])
        f["truncated"] = False
        if total_lines + n > MAX_DIFF_LINES or f["category"] == "ignored":
            f["truncated"] = bool(f["hunks"])
            f["hunks"] = []
        else:
            total_lines += n

    # dependency graph on both sides
    base_files = set(git(["ls-tree", "-r", "--name-only", mb], root).splitlines())
    changed_new = {f["path"] for f in files if f["status"] != "D"}
    changed_old = {f["old_path"] or f["path"] for f in files if f["status"] != "A"}
    head_files = (base_files - {f["old_path"] or f["path"] for f in files if f["status"] in "DR"}) | changed_new
    scannable = lambda p: lang_of(p) and mapper.category(p) in ("code", "config")  # noqa: E731
    touched = {f["component"] for f in files if f["component"] and f["category"] not in ("test", "ignored")}
    base_scan = sorted(p for p in base_files if scannable(p))
    partial = len(base_scan) > MAX_SCAN_FILES
    if partial:
        base_scan = [p for p in base_scan if mapper.component(p) in touched]
        notes.append(f"Large repository: dependency scan limited to touched components ({len(base_scan)} files).")
    reader = BlobReader(root)
    try:
        base_ex = {p: extract(p, reader.read(mb, p)) for p in base_scan}
        head_ex = {p: ex for p, ex in base_ex.items() if p not in changed_old}

        def read_head(p: str) -> str | None:
            if head_rev:
                return reader.read(head_rev, p)
            try:
                data = (root / p).read_bytes()
            except OSError:
                return None
            return None if b"\0" in data[:8000] or len(data) > MAX_FILE_BYTES else data.decode("utf-8", errors="replace")

        for p in sorted(changed_new):
            if scannable(p) and (not partial or mapper.component(p) in touched):
                head_ex[p] = extract(p, read_head(p))
        base_ts = load_tsconfigs(sorted(base_files), lambda p: reader.read(mb, p))
        head_ts = load_tsconfigs(sorted(head_files), read_head) if any(
            "tsconfig" in p for p in changed_new) else base_ts
        openspec = collect_openspec(files, head_files, base_files, read_head, lambda p: reader.read(mb, p), specs or [])
    finally:
        reader.close()
    base_edges, _ = build_edges(base_ex, SideIndex(base_files, mapper, base_ts, base_ex), mapper)
    head_edges, head_unres = build_edges(head_ex, SideIndex(head_files, mapper, head_ts, head_ex), mapper)

    symbols = []
    for f in files:
        if f["category"] in ("code", "config") and f["hunks"]:
            symbols.extend(extract_symbols(f))
    layer_of = {c["id"]: c["layer"] for c in cfg["components"]}
    # An unchanged edge is relevant only if a changed file creates it, or it points at a file whose public
    # surface changed (callers may break). Everything else is background and would only add noise.
    changed_paths = changed_new | changed_old
    surface_changed = {f["path"] for f in files if f["status"] in "DR"} | {f["old_path"] for f in files if f["status"] == "R"} | {
        s["file"] for s in symbols if s["change"] in ("removed", "modified")}
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

    base_has = {mapper.component(p) for p in base_files}
    head_has = {mapper.component(p) for p in head_files}
    context_ids = {x for e in edges for x in (e["from"], e["to"])} - touched
    components = []
    for c in cfg["components"]:
        cid = c["id"]
        if cid in touched:
            status = "new" if cid not in base_has else ("removed" if cid not in head_has else "changed")
        elif cid in context_ids:
            status = "context"
        else:
            continue
        cf = [f for f in files if f["component"] == cid and f["category"] not in ("test", "ignored")]
        components.append({"id": cid, "status": status, "files": len(cf),
                           "add": sum(f["add"] for f in cf), "del": sum(f["del"] for f in cf)})


    code = [f for f in files if f["category"] != "ignored"]
    stats = {
        "files": len(files), "add": sum(f["add"] for f in code), "del": sum(f["del"] for f in code),
        "test_add": sum(f["add"] for f in files if f["category"] == "test"),
        "test_del": sum(f["del"] for f in files if f["category"] == "test"),
        "unmapped": sorted(f["path"] for f in files if not f["component"] and f["category"] == "code"),
        "unresolved": head_unres,
        "violations_new": sum(1 for e in edges if e["violation"] and not e["violation"]["existing"]),
        # How much of the code change the map can show: lines in code/config/migration files that belong to a component.
        "code_lines": sum(f["add"] + f["del"] for f in files if f["category"] in ("code", "config", "migration")),
        "mapped_lines": sum(f["add"] + f["del"] for f in files if f["category"] in ("code", "config", "migration") and f["component"]),
    }
    if total_lines >= MAX_DIFF_LINES:
        notes.append(f"Diff larger than {MAX_DIFF_LINES} lines: some files are listed without hunks.")
    cfg_bytes = (root / CONFIG_NAME).read_bytes() if (root / CONFIG_NAME).exists() else b""
    key = hashlib.sha256(raw_diff.encode() + b"\0" + cfg_bytes + b"\0" + str(SCHEMA_VERSION).encode()
                         + b"\0" + ",".join(sorted(specs or [])).encode()).hexdigest()[:16]
    public_cfg = {k: cfg[k] for k in ("inferred", "name", "direction", "lang", "layers", "flows")}
    public_cfg["name"] = public_cfg["name"] or root.name
    public_cfg["components"] = [{k: c[k] for k in ("id", "name", "layer", "desc")} for c in cfg["components"]]
    public_cfg["rules"] = {"allow": [f"{a} -> {b}" for a, b in cfg["rules"]["allow"]],
                           "forbid": [f"{a} -> {b}" for a, b in cfg["rules"]["forbid"]]}
    return {"version": SCHEMA_VERSION, "key": key, "source": src, "config": public_cfg, "files": files,
            "components": components, "edges": edges, "symbols": symbols, "stats": stats, "notes": notes,
            "openspec": openspec, "deps": sorted([a, b] for a, b in head_edges)}


# ───────────────────────────── OpenSpec ─────────────────────────────
# Spec-driven changes live in openspec/changes/<id>/ (proposal.md, design.md, tasks.md and requirement deltas in
# specs/<capability>/spec.md); archiving moves them to changes/archive/<date>-<id>/ and merges the deltas into
# openspec/specs/<capability>/spec.md. Everything here is parsed, never guessed: the agent only maps requirements to code.

OS_CHANGE = re.compile(r"^(?P<root>(?:.*/)?openspec)/changes/(?:(?P<arch>archive)/(?:\d{4}-\d{2}-\d{2}-)?)?(?P<id>[^/]+)/(?P<rest>.+)$")
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
    return [trunc_text(md_plain(re.sub(r"^\s*[-*]\s+", "", ln)), limit) for _, ln in lines if re.match(r"^[-*]\s+\S", ln)][:n]


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
            cur, scen, body = {"id": f"{cap}/{kebab(name)}", "cap": cap, "name": trunc_text(name, 120), "op": op or "SPEC",
                               "text": "", "scenarios": [], "file": path, "line": i}, None, []
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
                items.append({"t": trunc_text(md_plain(m.group(2)), 140), "done": done, "line": i, "group": len(groups) - 1})
    groups = [g for g in groups if g["total"]]
    return {"done": sum(g["done"] for g in groups), "total": sum(g["total"] for g in groups), "groups": groups, "items": items}


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
        decisions = [trunc_text(re.sub(r"^(Decision\s*\d*[:.]?\s*)", "", d, flags=re.I), 100) for d in (heads or bold)][:8]
    return decisions


def diff_requirements(base: list[dict], head: list[dict]) -> list[dict]:
    """Main spec changed in the diff (usually an archive merge): requirement-level ADDED/MODIFIED/REMOVED."""
    b = {r["id"]: r for r in base}
    h = {r["id"]: r for r in head}
    shape = lambda r: (r["text"], [(s["name"], s["steps"]) for s in r["scenarios"]])  # noqa: E731
    out = []
    for r in head:
        if r["id"] not in b:
            out.append({**r, "op": "ADDED"})
        elif shape(r) != shape(b[r["id"]]):
            out.append({**r, "op": "MODIFIED"})
    out += [{**r, "op": "REMOVED"} for r in base if r["id"] not in h]
    return out


def collect_openspec(files: list[dict], head_files: set, base_files: set, read_head, read_base, extra: list[str]) -> dict | None:
    status = {f["path"]: f["status"] for f in files}
    changes: dict[tuple, dict] = {}
    for f in files:
        for p in (f["path"], f.get("old_path")):
            m = OS_CHANGE.match(p or "")
            if m and m.group("id") != "archive":
                changes.setdefault((m.group("root"), m.group("id")), {})
    for cid in extra:  # --spec <id>: an active change the branch implements without touching it
        roots = sorted({m.group("root") for p in head_files for m in [OS_CHANGE.match(p)] if m and m.group("id") == cid})
        for r in roots[:1]:
            changes.setdefault((r, cid), {})
    out_changes = []
    for (root, cid) in sorted(changes):
        # Where the change lives at HEAD: active dir, or its archive dir (moved in this diff or earlier).
        paths = sorted(p for p in head_files if (m := OS_CHANGE.match(p)) and m.group("root") == root and m.group("id") == cid)
        side_files, read = (paths, read_head) if paths else (
            sorted(p for p in base_files if (m := OS_CHANGE.match(p)) and m.group("root") == root and m.group("id") == cid), read_base)
        if not side_files:
            continue
        m0 = OS_CHANGE.match(side_files[0])
        cdir = side_files[0][: len(side_files[0]) - len(m0.group("rest"))].rstrip("/")
        archived = bool(m0.group("arch"))
        ch = {"id": cid, "dir": cdir, "archived": archived, "deleted": not paths,
              "moved_to_archive": archived and any(OS_CHANGE.match(f.get("old_path") or "") and not OS_CHANGE.match(f["old_path"]).group("arch")
                                                   for f in files if f["path"].startswith(cdir + "/")),
              "artifacts": [], "why": "", "what": [], "impact": [], "decisions": [], "tasks": None, "requirements": []}
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
        out_changes.append(ch)
    # Main specs touched by the diff (archive merges, or direct edits).
    specs = []
    delta_ids = {r["id"] for c in out_changes for r in c["requirements"]}
    for f in files:
        m = OS_SPEC.match(f["path"])
        if not m:
            continue
        cap = m.group("cap")
        head = parse_requirements(read_head(f["path"]) or "", cap, f["path"], "SPEC") if f["status"] != "D" else []
        base = parse_requirements(read_base(f.get("old_path") or f["path"]) or "", cap, f["path"], "SPEC") if f["status"] != "A" else []
        reqs = diff_requirements(base, head)
        for r in reqs:
            r["change"] = None
            r["merged"] = r["id"] in delta_ids
        specs.append({"cap": cap, "path": f["path"], "status": f["status"], "requirements": reqs})
    if not out_changes and not specs:
        return None
    return {"changes": out_changes, "specs": specs}


def spec_requirements(ctx: dict) -> list[dict]:
    """Requirements the change must account for: every delta of its OpenSpec changes, plus main-spec edits not
    already covered by a delta. RENAMED-only entries carry no behaviour and are informational."""
    os_ = ctx.get("openspec") or {}
    out = [r for c in os_.get("changes", []) for r in c["requirements"]]
    seen = {r["id"] for r in out}
    out += [r for s in os_.get("specs", []) for r in s["requirements"] if r["id"] not in seen]
    return out


# ───────────────────────────── digest ─────────────────────────────

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


# ───────────────────────────── insight validation ─────────────────────────────

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


# ───────────────────────────── render ─────────────────────────────

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
                    cur = {"old_start": o, "old_len": 0, "new_start": n, "new_len": 0, "header": h.get("header", ""), "lines": []}
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
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
    return (html.replace("{{TITLE}}", esc(title))
                .replace("{{LANG}}", ctx["config"]["lang"])
                .replace("/*{{CSS}}*/", css)
                .replace("/*{{JS}}*/", js.replace("</script", "<\\/script"))
                .replace("{{DATA}}", payload))


def load_insight(work: Path, ctx: dict) -> tuple[dict | None, str, list[str]]:
    path = work / "insight.json"
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
    return normalize_insight(ins, ctx), "fresh", []


def write_render(root: Path, ctx: dict, out: str | None) -> tuple[Path, str, list[str]]:
    work = root / WORK_DIR
    insight, status, errs = load_insight(work, ctx)
    target = Path(out) if out else work / "out" / f"{slugify(ctx['source']['branch'] or 'change')}.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_html(ctx, insight, status, errs), encoding="utf-8", newline="\n")
    return target, status, errs


# ───────────────────────────── commands ─────────────────────────────

def load_context(root: Path) -> dict:
    path = root / WORK_DIR / "context.json"
    if not path.exists():
        raise Fail("No context yet. Run `explain-change pr` first.")
    ctx = json.loads(path.read_text(encoding="utf-8"))
    if ctx.get("version") != SCHEMA_VERSION:
        raise Fail("The collected context comes from another version. Run `explain-change pr` again.")
    return ctx


def print_insight_status(status: str, errs: list[str]):
    if status == "fresh":
        print("  insight: valid ✓")
    elif status == "missing":
        print(f"  insight: missing → read {WORK_DIR}/digest.md, write {WORK_DIR}/insight.json, run `explain-change render`")
    else:
        print(f"  insight: {status} ✗ ({len(errs)} issues) — fix only these fields:")
        for e in errs:
            print(f"    - {e}")


def cmd_pr(args) -> int:
    root = repo_root()
    cfg, cfg_errs = load_config(root)
    if cfg_errs:
        print(f"{CONFIG_NAME} has errors:", *[f"  - {e}" for e in cfg_errs], sep="\n", file=sys.stderr)
        return 2
    if cfg["inferred"]:
        print(f"⚠ No {CONFIG_NAME}: layers and components are inferred from directory names. "
              "Ask your agent to configure explain-change (CONFIGURE.md), or run `explain-change init`.", file=sys.stderr)
    work = ensure_workdir(root)
    ctx = collect(root, cfg, args.base, args.include_uncommitted, args.ado, args.spec)
    (work / "context.json").write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    digest = build_digest(ctx, args.budget)
    (work / "digest.md").write_text(digest, encoding="utf-8", newline="\n")
    st = ctx["stats"]
    target, status, errs = write_render(root, ctx, args.out)
    touched = sum(1 for c in ctx["components"] if c["status"] != "context")
    print(f"explain-change: {st['files']} files (+{st['add']} −{st['del']}) · {touched} components · "
          f"{st['violations_new']} new violation(s) · key {ctx['key']}")
    print(f"  digest:  {work / 'digest.md'} (~{len(digest) // 4} tokens)")
    print_insight_status(status, errs)
    print(f"  html:    {target}{'' if status == 'fresh' else ' (data-only)'}")
    for n in ctx["notes"]:
        print(f"  note:    {n}")
    return 0


def cmd_render(args) -> int:
    root = repo_root()
    ctx = load_context(root)
    target, status, errs = write_render(root, ctx, args.out)
    print_insight_status(status, errs)
    print(f"  html:    {target}{'' if status == 'fresh' else ' (data-only)'}")
    return 0 if status in ("fresh", "missing") or args.force else 1


def cmd_validate(args) -> int:
    root = repo_root()
    ctx = load_context(root)
    _, status, errs = load_insight(root / WORK_DIR, ctx)
    print_insight_status(status, errs)
    return 0 if status == "fresh" else 1


def toml_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def cmd_init(args) -> int:
    root = repo_root()
    path = root / CONFIG_NAME
    if path.exists() and not args.force:
        raise Fail(f"{CONFIG_NAME} already exists (use --force to overwrite).")
    structure = detect_structure(git(["ls-files"], root).splitlines())
    kind, comps, layers = structure["kind"], structure["components"], structure_layers(structure)
    layer_ids = {lid for lid, _ in layers}
    rules = [r for r in STRUCTURE_RULES.get(kind, []) if all(x.strip() in layer_ids for x in r.split("->"))]
    lines = [
        "# explain-change config — the source of truth for components, layers and direction.",
        f"# Drafted by `explain-change init` from a {kind} layout. Review every section, then run `explain-change check`.",
        "# Layers are drawn top to bottom in this order (web first, core last); [rules] decides what may depend on what.",
        "# Layers, components and rules are yours: rename, merge or split them so the map reads like this app.",
        "# A file belongs to the component with the most specific matching path.",
        "", "[project]", f"name = {toml_str(root.name)}",
        'direction = ""  # one or two sentences: the architecture you want PRs to follow',
        'lang = "en"     # en | es', "",
    ]
    for lid, name in layers:
        lines += ["[[layers]]", f"id = {toml_str(lid)}", f"name = {toml_str(name)}", ""]
    lines += ["[rules]", "# Allow-list of dependency directions (layer or component ids). Anything else is a violation.",
              "# Suggested for this layout; uncomment once the components below are right.",
              f"# allow = [{', '.join(toml_str(r) for r in rules)}]" if rules else "# allow = []",
              "same_layer = true", ""]
    hint = {"rails": '# constants = ["Billing::*"]   # Ruby constants owned by this component (when not under its paths)',
            "django": '# imports = ["billing.*"]      # dotted modules owned by this component (when not under its paths)'}.get(
        kind, '# imports = ["@app/orders/*"]  # import specifiers owned by this component')
    for c in comps:
        lines += ["[[components]]", f"id = {toml_str(c['id'])}", *([f"name = {toml_str(c['name'])}"] if c.get("name") else []),
                  f"layer = {toml_str(c['layer'])}",
                  f"paths = [{', '.join(toml_str(p) for p in c['paths'])}]", f"desc = {toml_str(c.get('desc', ''))}", hint, ""]
    lines += ["# [[flows]]  # reference runtime flows; the agent compares changed flows against them",
              '# id = "checkout"', '# title = "Checkout"', '# steps = ["controllers -> services : PlaceOrder", "services -> models : Order.create!"]', "",
              "[ignore]", f"paths = [{', '.join(toml_str(p) for p in DEFAULT_IGNORE)}]",
              f"tests = [{', '.join(toml_str(p) for p in DEFAULT_TESTS)}]", ""]
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"Wrote {path}: {kind} layout, {len(comps)} components in {len(layers)} layers. Review it, then run `explain-change check`.")
    return 0


def cmd_check(args) -> int:
    root = repo_root()
    if not (root / CONFIG_NAME).exists():
        raise Fail(f"No {CONFIG_NAME}. Run `explain-change init`.")
    cfg, errs = load_config(root)
    mapper = Mapper(cfg)
    files = git(["ls-files"], root).splitlines()
    counts = {c["id"]: 0 for c in cfg["components"]}
    unmapped = []
    for f in files:
        category = mapper.category(f)
        if category in ("test", "ignored", "docs", "migration"):
            continue
        comp = mapper.component(f)
        if not comp and category == "config":
            continue
        if comp:
            counts[comp] += 1
        elif lang_of(f):
            unmapped.append(f)
    for e in errs:
        print(f"error: {e}", file=sys.stderr)
    for cid, n in counts.items():
        if n == 0:
            print(f"warn: component '{cid}' matches no files", file=sys.stderr)
    width = max((len(c["id"]) for c in cfg["components"]), default=0)
    for layer in cfg["layers"]:  # the map's lanes, top to bottom, with what each component owns
        print(layer["id"])
        for c in (c for c in cfg["components"] if c["layer"] == layer["id"]):
            print(f"  {c['id']:<{width}}  {counts[c['id']]:>5} files  {', '.join(c['paths'])}")
    print(f"{len(cfg['components'])} components, {sum(counts.values())} source files mapped, {len(unmapped)} unmapped")
    dirs: dict[str, int] = {}
    for f in unmapped:
        d = posixpath.dirname(f) or "."
        dirs[d] = dirs.get(d, 0) + 1
    for d, n in sorted(dirs.items(), key=lambda x: (-x[1], x[0]))[:20]:
        print(f"  unmapped: {d}/ ({n} files)")
    return 1 if errs else 0


INSTALL_MARKER = ".explain-change-install"  # marks a copied install, so a later install may replace it


def install_skill(dest: Path, force: bool) -> str:
    """Links (or, on Windows, copies) the skill into `dest`. Replaces our own previous installs; asks for
    --force before replacing anything else."""
    if dest.is_symlink() and dest.resolve() == TOOL_DIR:
        return "ok  "
    ours = dest.is_symlink() or (dest / INSTALL_MARKER).exists()
    if dest.exists() or dest.is_symlink():
        if not (ours or force):
            return "skip"  # caller explains
        if dest.is_symlink() or dest.is_file():
            dest.unlink()
        else:
            shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":  # symlinks need Developer Mode on Windows: copy instead
        shutil.copytree(TOOL_DIR, dest, ignore=shutil.ignore_patterns(".git", "__pycache__", "tests", "examples"))
        (dest / INSTALL_MARKER).write_text(str(TOOL_DIR), encoding="utf-8")
        return "copy"
    dest.symlink_to(TOOL_DIR, target_is_directory=True)
    return "link"


def install_cli(bindir: Path) -> Path:
    bindir.mkdir(parents=True, exist_ok=True)
    script = TOOL_DIR / "explain_change.py"
    if os.name == "nt":  # the interpreter running install is known to work; `py` may not exist
        shim = bindir / "explain-change.cmd"
        shim.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n', encoding="utf-8")
        return shim
    shim = bindir / "explain-change"
    if shim.exists() or shim.is_symlink():
        shim.unlink()
    shim.symlink_to(script)
    script.chmod(script.stat().st_mode | 0o111)
    return shim


def cmd_install(args) -> int:
    home = Path.home()
    try:
        skipped = []
        for dest in (home / ".agents" / "skills" / "explain-change", home / ".claude" / "skills" / "explain-change"):
            action = install_skill(dest, args.force)
            print(f"{action} {dest}")
            if action == "skip":
                skipped.append(dest)
        bindir = home / ".local" / "bin"
        print(f"cli  {install_cli(bindir)}")
    except OSError as e:
        raise Fail(f"install failed: {e}") from e
    if skipped:
        print("note: skipped folders that are not an explain-change install; use --force to replace them")
    if os.name == "nt":
        print("note: the skill is a copy; run install again after updating this folder")
    path_dirs = {os.path.normcase(os.path.abspath(p)) for p in os.environ.get("PATH", "").split(os.pathsep) if p}
    if os.path.normcase(str(bindir)) not in path_dirs:
        print(f"note: add {bindir} to your PATH to run `explain-change` from any folder")
    return 1 if skipped else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="explain-change", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pr", help="collect a change (local branch or Azure DevOps PR), write digest, render")
    p.add_argument("--base", help="base ref (default: project.base, else origin/HEAD, main, master or develop)")
    p.add_argument("--include-uncommitted", action="store_true", help="diff the working tree, incl. untracked files")
    p.add_argument("--ado", metavar="ID|URL", help="Azure DevOps PR id or URL (fetches refs/pull/<id>/merge)")
    p.add_argument("--spec", action="append", metavar="CHANGE_ID",
                   help="also explain this OpenSpec change when the diff does not touch it (repeatable)")
    p.add_argument("--budget", type=int, default=DEFAULT_BUDGET, help="digest size in chars (default %(default)s)")
    p.add_argument("--out", help="output HTML path")
    p.set_defaults(fn=cmd_pr)
    p = sub.add_parser("render", help="validate insight.json and render the HTML")
    p.add_argument("--out", help="output HTML path")
    p.add_argument("--force", action="store_true", help="exit 0 even if the insight is invalid (renders data-only)")
    p.set_defaults(fn=cmd_render)
    sub.add_parser("validate", help="validate insight.json against the collected change").set_defaults(fn=cmd_validate)
    p = sub.add_parser("init", help=f"write a draft {CONFIG_NAME}")
    p.add_argument("--force", action="store_true", help=f"overwrite an existing {CONFIG_NAME}")
    p.set_defaults(fn=cmd_init)
    sub.add_parser("check", help=f"validate {CONFIG_NAME} and list unmapped files").set_defaults(fn=cmd_check)
    p = sub.add_parser("install", help="link the skill into ~/.agents/skills, ~/.claude/skills and ~/.local/bin")
    p.add_argument("--force", action="store_true", help="replace folders that are not an explain-change install")
    p.set_defaults(fn=cmd_install)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except Fail as e:
        print(f"explain-change: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
