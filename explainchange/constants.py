"""Shared constants: tool paths, limits, file categories and layer hints."""
from __future__ import annotations

import re
from pathlib import Path

__all__ = [
    "SCHEMA_VERSION", "ANALYSIS_VERSION", "TOOL_DIR", "CONFIG_NAME", "WORK_DIR", "MAX_SCAN_FILES", "MAX_FILE_BYTES",
    "MAX_DIFF_LINES", "DEFAULT_BUDGET", "DIFF_FLAGS", "GENERATED_RE", "GENERATED_HEAD", "DEFAULT_TESTS",
    "DEFAULT_IGNORE", "FRAMEWORK_CONFIG", "MIGRATION_PATTERNS", "CONFIG_EXT", "CONFIG_NAMES", "DOC_EXT", "LANG_BY_EXT",
    "LAYER_HINTS", "CONTAINER_DIRS",
]


SCHEMA_VERSION = 1
# Part of the insight key. Bump it when a change to the analysis (parsers, mapping, edges, symbols) can change
# context.json for the same diff, so insights written against the old analysis are reported stale, not valid.
ANALYSIS_VERSION = 2
TOOL_DIR = Path(__file__).resolve().parent.parent  # the skill folder
CONFIG_NAME = ".explain-change.toml"
WORK_DIR = ".explain-change"
MAX_SCAN_FILES = 20000
MAX_FILE_BYTES = 512 * 1024
MAX_DIFF_LINES = 30000
DEFAULT_BUDGET = 12000  # digest chars, ~3k tokens
# Pinned so a user's git config (diff.noprefix, diff.algorithm, diff.relative…) cannot change the diff, and so the key.
DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-relative", "--src-prefix=a/", "--dst-prefix=b/",
              "--diff-algorithm=myers", "--indent-heuristic", "-M", "-U3"]
# Markers of generated files, read from their first lines (plus `linguist-generated` in .gitattributes).
GENERATED_RE = re.compile(r"@generated|do not edit|auto-?generated|<meta name=\"generator\"", re.I)
GENERATED_HEAD = 10

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
