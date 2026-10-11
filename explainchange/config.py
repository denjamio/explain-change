"""Reads .explain-change.toml, or infers layers and components from the folder layout; maps paths to components."""
from __future__ import annotations

import posixpath
import re
import tomllib
from pathlib import Path

from .constants import (
    CONFIG_EXT, CONFIG_NAME, CONFIG_NAMES, CONTAINER_DIRS, DEFAULT_IGNORE, DEFAULT_TESTS, DOC_EXT, FRAMEWORK_CONFIG,
    LAYER_HINTS, MIGRATION_PATTERNS,
)
from .util import Fail, camelize, git, glob_re, lang_of, matches_any, slugify


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
