"""Package shape and the report template: module import order, exported names, and a smoke run of app.js."""
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import explainchange as ec  # noqa: E402

# Import order, as README.md and explainchange/__init__.py describe it: no module imports a later one.
MODULES = ["constants", "util", "config", "diff", "deps", "openspec", "ado", "collector", "insight", "digest", "render", "cli"]


def public_names(module: str) -> list[str]:
    tree = ast.parse((ROOT / "explainchange" / f"{module}.py").read_text(encoding="utf-8"))
    names = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.append(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names += [t.id for t in targets if isinstance(t, ast.Name) and t.id != "__all__"]
    return [n for n in names if not n.startswith("_")]


class PackageTests(unittest.TestCase):
    def test_no_module_imports_a_later_one(self):
        for i, module in enumerate(MODULES):
            text = (ROOT / "explainchange" / f"{module}.py").read_text(encoding="utf-8")
            for imported in re.findall(r"^from \.(\w+) import", text, re.M):
                self.assertLess(MODULES.index(imported), i, f"{module} imports {imported}")

    def test_all_lists_every_public_name(self):
        for module in MODULES:
            mod = sys.modules[f"explainchange.{module}"]
            self.assertEqual(sorted(mod.__all__), sorted(public_names(module)), module)

    def test_package_does_not_reexport_the_standard_library(self):
        for name in ("re", "json", "Path", "posixpath", "subprocess", "hashlib"):
            self.assertFalse(hasattr(ec, name), name)


NODE = shutil.which("node")
REPORTS = sorted(p for p in (ROOT / "examples").glob("*.html") if p.name != "index.html")


@unittest.skipUnless(NODE or os.environ.get("CI"), "node is not installed")  # never skipped in CI
class TemplateSmokeTests(unittest.TestCase):
    """Runs every example report in a minimal DOM (tests/js/smoke.js): render, play the story, click everything."""

    def test_examples_run_without_errors(self):
        self.assertTrue(NODE, "node is required in CI")
        self.assertTrue(REPORTS)
        for report in REPORTS:
            with self.subTest(report=report.name):
                p = subprocess.run([NODE, str(ROOT / "tests" / "js" / "smoke.js"), str(report)],
                                   capture_output=True, text=True, encoding="utf-8", timeout=60)
                self.assertEqual(p.returncode, 0, p.stderr[-2000:])
                out = json.loads(p.stdout)
                self.assertGreater(out["elements"], 100)
                self.assertGreater(out["clicks"], 5)
                data = json.loads(re.search(r'id="ec-data">(.*?)</script>', report.read_text(encoding="utf-8"),
                                            re.S).group(1).replace("<\\/", "</"))
                for step in (data["insight"] or {}).get("story", []):
                    self.assertIn(step["heading"], out["text"])


class TemplateStyleTests(unittest.TestCase):
    def test_both_dark_theme_blocks_define_the_same_colors(self):
        """The dark palette is written twice (system preference, and the theme button); the copies must not drift."""
        css = (ROOT / "template" / "styles.css").read_text(encoding="utf-8")
        auto = re.search(r'@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{(.*?)\}', css, re.S)
        forced = re.search(r':root\[data-theme="dark"\] \{(.*?)\}', css, re.S)
        self.assertTrue(auto and forced)

        def decls(block):
            return dict(re.findall(r"([\w-]+)\s*:\s*([^;]+);", block))
        self.assertEqual(decls(auto.group(1)), decls(forced.group(1)))

    def test_every_color_token_has_a_dark_value(self):
        css = (ROOT / "template" / "styles.css").read_text(encoding="utf-8")
        light = re.search(r":root \{(.*?)\n\}", css, re.S).group(1)
        dark = re.search(r':root\[data-theme="dark"\] \{(.*?)\}', css, re.S).group(1)
        layout = re.compile(r"--(s\d|radius|font|mono)")
        missing = sorted(set(re.findall(r"(--[\w-]+)\s*:", light)) - set(re.findall(r"(--[\w-]+)\s*:", dark)))
        self.assertEqual([m for m in missing if not layout.match(m)], [])


if __name__ == "__main__":
    unittest.main()
