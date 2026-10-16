import pkg from "../../package.json" with { type: "json" };

/** The tool's version; CHANGELOG.md lists what each one changed. */
export const VERSION: string = pkg.version;
/**
 * Version of the agent contract: the shape of facts.json and explanation.json. Explanations written for another
 * contract are stale.
 */
export const CONTRACT_VERSION = 3;
/**
 * Part of the change key. Bump it when a change to the analysis (parsers, mapping, dependencies, symbols, outline)
 * can change facts.json for the same diff, so explanations written against the old analysis turn stale, not valid.
 */
export const ANALYSIS_VERSION = 7;

/** The GitHub repository: releases, issues, the published schemas and the examples site. */
export const REPOSITORY = "denjamio/explain-change";

export const CONFIG_NAME = ".explain-change.toml";
export const WORK_DIR = ".explain-change";
export const FILES = {
  facts: "facts.json",
  digest: "digest.md",
  explanation: "explanation.json",
  saved: "explanations", // explanations/<key>.json: the explanation of each change, kept when switching changes
  reports: "out",
} as const;

export const MAX_SCAN_FILES = 20_000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_DIFF_LINES = 30_000;
export const DEFAULT_BUDGET = 12_000; // digest characters, ~3k tokens
export const BUDGET_RANGE = [2_000, 100_000] as const;

export const AZ_TIMEOUT_MS = 60_000; // one az call
export const GH_TIMEOUT_MS = 60_000; // one gh call
export const LOGIN_TIMEOUT_MS = 300_000; // finishing `az login` in the browser
export const FETCH_TIMEOUT_MS = 600_000; // one git fetch of a PR
export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"; // Azure DevOps, for `az account get-access-token`

/** Pinned so a user's git config (diff.noprefix, diff.algorithm, diff.relative…) cannot change the diff or the key. */
export const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--diff-algorithm=myers",
  "--indent-heuristic",
  "-M",
  "-U3",
];

/** Markers of generated files, read from their first lines (plus `linguist-generated` in .gitattributes). */
export const GENERATED_RE =
  /@generated|do not (?:edit|modify)|auto-?generated|(?:this|the) file (?:is|was|has been) (?:auto-?)?generated|<meta name="generator"/i;
export const GENERATED_HEAD = 10;

export const DEFAULT_TESTS = [
  "**/test/**",
  "**/tests/**",
  "**/spec/**",
  "**/__tests__/**",
  "**/e2e/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/*_spec.rb",
  "**/test_*.py",
  "**/*Tests/**",
  "**/*.Tests/**",
  "**/*Tests.cs",
  "**/*Test.cs",
];
export const DEFAULT_IGNORE = [
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/Gemfile.lock",
  "**/poetry.lock",
  "**/*.min.js",
  "**/*.map",
  "**/*.generated.*",
  "**/*.g.cs",
  "**/*.Designer.cs",
  "**/dist/**",
  "**/build/**",
  "**/bin/**",
  "**/obj/**",
  "**/node_modules/**",
  "**/vendor/**",
  "db/schema.rb",
  "**/__snapshots__/**",
  "**/*.snap",
];
export const FRAMEWORK_CONFIG = [
  "config/initializers/**",
  "config/environments/**",
  "config/*.rb",
  "bin/**",
  "Rakefile",
  "config.ru",
  "**/settings.py",
  "**/settings/*.py",
  "**/wsgi.py",
  "**/asgi.py",
  "manage.py",
];
export const MIGRATION_PATTERNS = ["**/migrations/**", "**/Migrations/**", "db/migrate/**", "**/db/migrate/**"];
/** Architecture decision records: the evidence behind a change's decisions. */
export const ADR_PATTERNS = ["**/adr/**", "**/adrs/**", "**/decisions/**", "**/architecture/decisions/**"];
export const CONFIG_EXT = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".xml",
  ".csproj",
  ".sln",
  ".props",
  ".targets",
  ".config",
  ".env",
  ".gradle",
]);
export const CONFIG_NAMES = new Set([
  "Gemfile",
  "Dockerfile",
  "Makefile",
  "Procfile",
  "Rakefile",
  "settings.py",
  "routes.rb",
  "angular.json",
  "package.json",
  "requirements.txt",
  "pyproject.toml",
]);
export const DOC_EXT = new Set([".md", ".mdx", ".rst", ".txt", ".adoc"]);

/** Layer guesses from folder names, for `init` and the no-config fallback: [id, name, folder names]. */
export const LAYER_HINTS: [string, string, Set<string>][] = [
  [
    "web",
    "Web / API",
    new Set([
      "api",
      "apis",
      "controllers",
      "controller",
      "web",
      "ui",
      "views",
      "pages",
      "components",
      "routes",
      "endpoints",
      "graphql",
      "frontend",
      "client",
      "app",
      "presentation",
      "handlers",
      "channels",
      "mailers",
    ]),
  ],
  [
    "application",
    "Application",
    new Set([
      "services",
      "service",
      "application",
      "usecases",
      "use_cases",
      "jobs",
      "workers",
      "commands",
      "queries",
      "features",
      "interactors",
      "operations",
      "tasks",
      "store",
      "state",
    ]),
  ],
  [
    "domain",
    "Domain",
    new Set([
      "domain",
      "models",
      "model",
      "core",
      "entities",
      "entity",
      "aggregates",
      "policies",
      "contracts",
      "shared",
    ]),
  ],
  [
    "infrastructure",
    "Infrastructure",
    new Set([
      "infra",
      "infrastructure",
      "repositories",
      "repository",
      "db",
      "data",
      "persistence",
      "adapters",
      "clients",
      "integrations",
      "gateways",
      "lib",
      "external",
      "storage",
    ]),
  ],
];
export const CONTAINER_DIRS = new Set([
  "src",
  "app",
  "apps",
  "lib",
  "libs",
  "packages",
  "services",
  "modules",
  "projects",
  "backend",
  "frontend",
  "server",
  "internal",
  "pkg",
  "engines",
]);
