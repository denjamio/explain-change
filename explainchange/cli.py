"""explain-change: architecture-first visual explanation of a code change.

    explain-change local [--base REF] [--include-uncommitted] [--spec CHANGE_ID]
    explain-change pr [ID|URL] [--spec CHANGE_ID]
    explain-change render | validate | init | check | update | install
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

from .constants import (
    ANALYSIS_VERSION, CONFIG_NAME, DEFAULT_BUDGET, DEFAULT_IGNORE, DEFAULT_TESTS, SCHEMA_VERSION, TOOL_DIR, VERSION,
    WORK_DIR,
)
from .util import Fail, git_paths, lang_of
from .config import Mapper, STRUCTURE_RULES, detect_structure, load_config, structure_layers
from .ado import branch_pr, require_ado
from .collector import collect, ensure_workdir, repo_root
from .digest import build_digest
from .render import load_insight, write_render

__all__ = [
    "load_context", "print_insight_status", "in_wsl", "open_report", "cmd_explain", "cmd_render", "cmd_validate",
    "toml_str", "cmd_init", "OWNERSHIP_HINTS", "draft_config", "cmd_check", "INSTALL_MARKER", "SKILL_FILES", "install_skill", "install_cli",
    "cmd_install", "cmd_update", "main", "run",
]


def load_context(root: Path) -> dict:
    path = root / WORK_DIR / "context.json"
    if not path.exists():
        raise Fail("No context yet. Run `explain-change local` or `explain-change pr <id>` first.")
    ctx = json.loads(path.read_text(encoding="utf-8"))
    if ctx.get("version") != SCHEMA_VERSION:
        raise Fail("The collected context comes from another version. Run `explain-change local` or `pr` again.")
    return ctx


def print_insight_status(status: str, errs: list[str]):
    if status == "fresh":
        print("  insight: valid ✓")
    elif status == "missing":
        print(f"  insight: missing → read {WORK_DIR}/digest.md, write {WORK_DIR}/insight.json, "
              "run `explain-change render`")
    else:
        print(f"  insight: {status} ✗ ({len(errs)} issues) — fix only these fields:")
        for e in errs:
            print(f"    - {e}")


def in_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def open_report(path: Path, args) -> None:
    """Opens the finished report in the default browser, also from WSL. Off with --no-open, in CI or with
    EXPLAIN_CHANGE_NO_OPEN=1."""
    if getattr(args, "no_open", False) or os.environ.get("CI") or os.environ.get("EXPLAIN_CHANGE_NO_OPEN"):
        return
    path = path.resolve()
    try:
        if in_wsl():  # Linux browsers rarely exist there; Windows opens the file instead
            opener = shutil.which("wslview") or shutil.which("explorer.exe") or "/mnt/c/Windows/explorer.exe"
            arg = str(path) if opener.endswith("wslview") else subprocess.run(
                ["wslpath", "-w", str(path)], capture_output=True, text=True, check=True).stdout.strip()
            subprocess.Popen([opener, arg], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif not webbrowser.open(path.as_uri()):
            return
    except (OSError, subprocess.CalledProcessError):
        return
    print("  opened in the browser")


def cmd_explain(args) -> int:
    """`local` (args.pr is None) or `pr`: collect the change, write context and digest, render."""
    root = repo_root()
    cfg, cfg_errs = load_config(root)
    if cfg_errs:
        print(f"{CONFIG_NAME} has errors:", *[f"  - {e}" for e in cfg_errs], sep="\n", file=sys.stderr)
        return 2
    if cfg["inferred"]:
        print(f"⚠ No {CONFIG_NAME}: layers and components are inferred from directory names. "
              "Ask your agent to configure explain-change (CONFIGURE.md), or run `explain-change init`.",
              file=sys.stderr)
    work = ensure_workdir(root)
    if args.cmd == "pr":
        if args.pr:
            require_ado(root, args.pr)
        else:
            args.pr = branch_pr(root)
            print(f"explain-change: PR {args.pr}, the active PR from this branch")
    ctx = collect(root, cfg, args.base, args.include_uncommitted, args.pr, args.spec)
    (work / "context.json").write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    digest = build_digest(ctx, args.budget or cfg["budget"])
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
    if status == "fresh":
        open_report(target, args)
    return 0


def cmd_render(args) -> int:
    root = repo_root()
    ctx = load_context(root)
    target, status, errs = write_render(root, ctx, args.out)
    print_insight_status(status, errs)
    print(f"  html:    {target}{'' if status == 'fresh' else ' (data-only)'}")
    if status == "fresh":
        open_report(target, args)
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
    structure = detect_structure(git_paths(["ls-files"], root))
    path.write_text(draft_config(root.name, structure), encoding="utf-8", newline="\n")
    print(f"Wrote {path}: {structure['kind']} layout, {len(structure['components'])} components in "
          f"{len(structure_layers(structure))} layers. Review it, then run `explain-change check`.")
    return 0


OWNERSHIP_HINTS = {  # the override key that fits each layout, shown commented out under every component
    "rails": '# constants = ["Billing::*"]   # Ruby constants owned by this component (when not under its paths)',
    "django": '# imports = ["billing.*"]      # dotted modules owned by this component (when not under its paths)',
    "generic": '# imports = ["@app/orders/*"]  # import specifiers owned by this component',
}


def draft_config(name: str, structure: dict) -> str:
    """The commented .explain-change.toml that `init` writes for a detected structure."""
    kind, comps, layers = structure["kind"], structure["components"], structure_layers(structure)
    layer_ids = {lid for lid, _ in layers}
    rules = [r for r in STRUCTURE_RULES.get(kind, []) if all(x.strip() in layer_ids for x in r.split("->"))]
    lines = [
        "# explain-change config — the source of truth for components, layers and direction.",
        f"# Drafted by `explain-change init` from a {kind} layout. "
        "Review every section, then run `explain-change check`.",
        "# Layers are drawn top to bottom in this order (web first, core last); "
        "[rules] decides what may depend on what.",
        "# Layers, components and rules are yours: rename, merge or split them so the map reads like this app.",
        "# A file belongs to the component with the most specific matching path.",
        "", "[project]", f"name = {toml_str(name)}",
        'direction = ""  # one or two sentences: the architecture you want PRs to follow',
        'lang = "en"     # en | es', "",
    ]
    for lid, layer_name in layers:
        lines += ["[[layers]]", f"id = {toml_str(lid)}", f"name = {toml_str(layer_name)}", ""]
    lines += ["[rules]",
              "# Allow-list of dependency directions (layer or component ids). Anything else is a violation.",
              "# Suggested for this layout; uncomment once the components below are right.",
              f"# allow = [{', '.join(toml_str(r) for r in rules)}]" if rules else "# allow = []",
              "same_layer = true", ""]
    hint = OWNERSHIP_HINTS.get(kind, OWNERSHIP_HINTS["generic"])
    for c in comps:
        lines += ["[[components]]", f"id = {toml_str(c['id'])}",
                  *([f"name = {toml_str(c['name'])}"] if c.get("name") else []),
                  f"layer = {toml_str(c['layer'])}",
                  f"paths = [{', '.join(toml_str(p) for p in c['paths'])}]",
                  f"desc = {toml_str(c.get('desc', ''))}", hint, ""]
    lines += ["# [[flows]]  # reference runtime flows; the agent compares changed flows against them",
              '# id = "checkout"', '# title = "Checkout"',
              '# steps = ["controllers -> services : PlaceOrder", "services -> models : Order.create!"]', "",
              "[ignore]", f"paths = [{', '.join(toml_str(p) for p in DEFAULT_IGNORE)}]",
              f"tests = [{', '.join(toml_str(p) for p in DEFAULT_TESTS)}]", ""]
    return "\n".join(lines)


def cmd_check(args) -> int:
    root = repo_root()
    if not (root / CONFIG_NAME).exists():
        raise Fail(f"No {CONFIG_NAME}. Run `explain-change init`.")
    cfg, errs = load_config(root)
    if errs:  # a partial config would list a misleading map
        print(f"{CONFIG_NAME} has errors:", *[f"  - {e}" for e in errs], sep="\n", file=sys.stderr)
        return 2
    mapper = Mapper(cfg)
    files = git_paths(["ls-files"], root)
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
    return 0


INSTALL_MARKER = ".explain-change-install"  # marks our install, so a later install may replace it
# What the skill runs on. Tests, examples and git data stay in the source folder.
SKILL_FILES = ["SKILL.md", "CONFIGURE.md", "PROMPT.md", "explain_change.py", "install.py", "explainchange", "schemas",
               "template"]


def install_skill(dest: Path, force: bool) -> str:
    """Installs SKILL_FILES into `dest`: one symlink per entry, so edits to this folder show at once, or copies on
    Windows, where symlinks need Developer Mode. Replaces our own earlier installs; asks for --force before
    replacing anything else."""
    if not dest.is_symlink() and dest.resolve() == TOOL_DIR:  # the source folder itself, cloned in place
        return "ok  "
    copy = os.name == "nt"
    marker = dest / INSTALL_MARKER
    if not copy and not dest.is_symlink() and marker.exists() and all(
            (dest / n).is_symlink() and (dest / n).resolve() == TOOL_DIR / n for n in SKILL_FILES):
        return "ok  "
    ours = dest.is_symlink() or marker.exists()
    if dest.exists() or dest.is_symlink():
        if not (ours or force):
            return "skip"  # caller explains
        if dest.is_symlink() or dest.is_file():
            dest.unlink()
        else:
            shutil.rmtree(dest)  # removes the links, never what they point to
    dest.mkdir(parents=True)
    for name in SKILL_FILES:
        src, dst = TOOL_DIR / name, dest / name
        if not copy:
            dst.symlink_to(src, target_is_directory=src.is_dir())
        elif src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(src, dst)
    marker.write_text(str(TOOL_DIR), encoding="utf-8")
    return "copy" if copy else "link"


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
        rc = {"zsh": "~/.zshrc", "bash": "~/.bashrc"}.get(Path(os.environ.get("SHELL", "")).name)
        how = (f": echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> {rc}, then open a new terminal" if rc else "")
        print(f"note: add {bindir} to your PATH to run `explain-change` from any folder{how}")
    return 1 if skipped else 0


def cmd_update(args) -> int:
    """Installs the latest release (or --version) with install.py, the same installer as the first time."""
    if (TOOL_DIR / ".git").exists():
        raise Fail(f"{TOOL_DIR} is a git clone: update it with `git pull`, then run `explain-change install`.")
    env = {**os.environ, **({"EXPLAIN_CHANGE_VERSION": args.version} if args.version else {})}
    return subprocess.call([sys.executable, str(TOOL_DIR / "install.py")], env=env)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="explain-change", description=__doc__.split("\n\n")[0])
    ap.add_argument("--version", action="version", version=f"explain-change {VERSION} "
                    f"(analysis {ANALYSIS_VERSION}, schema {SCHEMA_VERSION}) · {TOOL_DIR}")
    sub = ap.add_subparsers(dest="cmd", required=True)
    change = argparse.ArgumentParser(add_help=False)  # options shared by `local` and `pr`
    change.add_argument("--spec", action="append", metavar="CHANGE_ID",
                        help="also explain this OpenSpec change when the diff does not touch it (repeatable)")
    change.add_argument("--budget", type=int,
                        help=f"digest size in chars (default: project.budget, else {DEFAULT_BUDGET})")
    change.add_argument("--out", help="output HTML path")
    change.add_argument("--no-open", action="store_true", help="do not open the finished report in the browser")
    p = sub.add_parser("local", parents=[change], help="explain the current branch: write the digest, render")
    p.add_argument("--base", help="base ref (default: project.base, else origin/HEAD, main, master or develop)")
    p.add_argument("--include-uncommitted", action="store_true", help="diff the working tree, incl. untracked files")
    p.set_defaults(fn=cmd_explain, pr=None)
    p = sub.add_parser("pr", parents=[change], help="explain an Azure DevOps PR: write the digest, render")
    p.add_argument("pr", nargs="?", metavar="ID|URL",
                   help="the PR id, !id or URL (Azure DevOps); without it, the active PR from the current branch")
    p.set_defaults(fn=cmd_explain, base=None, include_uncommitted=False)
    p = sub.add_parser("render", help="validate insight.json and render the HTML")
    p.add_argument("--out", help="output HTML path")
    p.add_argument("--no-open", action="store_true", help="do not open the finished report in the browser")
    p.add_argument("--force", action="store_true", help="exit 0 even if the insight is invalid (renders data-only)")
    p.set_defaults(fn=cmd_render)
    sub.add_parser("validate", help="validate insight.json against the collected change").set_defaults(fn=cmd_validate)
    p = sub.add_parser("init", help=f"write a draft {CONFIG_NAME}")
    p.add_argument("--force", action="store_true", help=f"overwrite an existing {CONFIG_NAME}")
    p.set_defaults(fn=cmd_init)
    sub.add_parser("check", help=f"validate {CONFIG_NAME} and list unmapped files").set_defaults(fn=cmd_check)
    p = sub.add_parser("update", help="install the latest release (needs no git)")
    p.add_argument("--version", metavar="TAG", help="a release tag such as v0.1.0 (default: the latest)")
    p.set_defaults(fn=cmd_update)
    p = sub.add_parser("install", help="link the skill into ~/.agents/skills, ~/.claude/skills and ~/.local/bin")
    p.add_argument("--force", action="store_true", help="replace folders that are not an explain-change install")
    p.set_defaults(fn=cmd_install)
    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except Fail as e:
        print(f"explain-change: {e}", file=sys.stderr)
        return 2


def run(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    return main(argv)
