# explain-change

A visual, architecture-first explanation of a code change, as **one self-contained HTML page**: **what the change
does, where it sits in the architecture, how data flows and why it is built this way**.

It explains; it does not review. Bugs, gaps and merge readiness belong to your reviewer, and the line-level diff
belongs to the PR.

The page reads from what to where:

1. **What and why**: title, the goal of the change and a TL;DR.
2. **The map and its story**: a map you can pan and zoom, with the **architecture** as lanes (layers), the **data
   flows** in call order and the **data model**. A story of 2–8 steps walks through it: each step moves to what
   changed and shows the code excerpt. Click a component to see what it now does, its files and its dependencies.
3. **Design decisions**: what was chosen, why, and the main alternative.
4. **SDD · OpenSpec**, for spec-driven changes: the change's pipeline (proposal, specs, design, tasks), and each
   requirement traced to the components and tests that implement it. Scenarios are drawn as flows: the starting
   state, then the action, then each outcome.
5. **Changes by component**: each changed component with what it now does and its files, then the tests and the
   files outside the map.

Color encodes the delta (green new, blue changed, gray removed); a dependency that breaks one of your `[rules]` is a
red arrow. For an Azure DevOps PR, each file reference links to the file in the PR. The page works offline, in light
and dark mode, and carries only the code excerpts it shows.

## Install

```bash
# macOS, Linux, WSL
curl -fsSL https://raw.githubusercontent.com/denjamio/explain-change/main/install.py | python3 -
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/denjamio/explain-change/main/install.py | py -3 -
```

That is all: no clone, no dependencies. It needs Python 3.11+ and git, and, for Azure DevOps PRs, the `az` CLI with
the `azure-devops` extension. Update with `explain-change update`.

The installer downloads the latest release into `~/.local/share/explain-change` (`%LOCALAPPDATA%\explain-change` on
Windows), sets up the skill for your agents (`~/.agents/skills` and `~/.claude/skills`) and the `explain-change`
command (`~/.local/bin`; if that folder is not on your PATH, it prints the line to add).

## Use

Ask your agent, in your own words:

| You ask | It runs |
|---|---|
| "explain PR 1234", or paste the PR URL | `explain-change pr 1234` |
| "explain this PR", on the PR's branch | `explain-change pr` (finds the branch's active PR) |
| "explain my changes", "what does this branch do" | `explain-change local` |
| the same, with work not committed yet | `explain-change local --include-uncommitted` |

The agent reads a short digest, writes the explanation and renders the page, which **opens in your browser** (from
WSL, in the Windows one). Explaining the same change again costs nothing: the explanation is reused until the
change or the config changes, also after switching to another PR and back.

The first time in a repository, ask it to **"configure explain-change for this repo"** (see [Configure](#configure)).

Agents with skill support (Claude Code and others reading `~/.agents/skills`) pick the skill up by themselves. For any
other agent, reference `~/.agents/skills/explain-change/PROMPT.md` from your `AGENTS.md`.

### Commands

```bash
explain-change local                   # the current branch vs its base (--base <ref> to choose it)
explain-change local --include-uncommitted
explain-change pr 1234                 # an Azure DevOps PR: id, !id or the URL from the browser
explain-change pr                      # the active Azure DevOps PR from the current branch
explain-change local --spec add-2fa    # also an OpenSpec change the code implements without touching it
explain-change render                  # after writing or fixing the explanation
explain-change init | check            # draft and verify .explain-change.toml
explain-change update | --version
```

- Without an agent, `local` and `pr` still render the map, with an automatic story built from the dependency changes.
- Reports go to `.explain-change/out/<branch>.html` (`--out <path>` writes elsewhere). The work folder is added to
  `.git/info/exclude`, which stays in your clone, so reports never show in `git status` and are never committed.
- The report opens only once the explanation is valid. `--no-open`, `CI` or `EXPLAIN_CHANGE_NO_OPEN=1` turn it off.
- The base is `--base`, else `project.base`, else the first that exists of `origin/HEAD`, `origin/main`,
  `origin/master`, `main`, `master`, `origin/develop` and `develop`.
- GitHub and GitLab PRs work through their branch: `gh pr checkout 123 && explain-change local`.
- Exit codes: 2 for config or usage errors, 1 when `render` rejects the explanation (`render --force` renders the
  page without it).

## Azure DevOps

`explain-change pr` explains a PR without checking it out. Azure DevOps is detected from the URL or, for an id, from
the repository's remotes. Without an id, it finds the active PR from the current branch (and asks for the id when
there are several).

- **Login**: it uses `az`. When `az` has no session or it expired, it runs `az login` once, in the browser, and goes
  on. git uses your own credentials first (SSH key or credential manager) and, on an HTTPS remote, the `az` token
  next, passed through the environment and never stored. Nothing else ever prompts.
- **Code** comes from git: `refs/pull/<id>/merge`, the PR applied to its target, the same change the PR page shows.
  A PR without one (merge conflicts, completed, abandoned) is explained as its source branch against the merge base
  with its target, and the CLI says so.
- **Title, description and file links** come from `az repos pr show`, with the organization and project detected
  from the git remote. If they are not, run
  `az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>`. Without `az`, the
  page still renders from git alone, and the CLI says what is missing and how to fix it.
- Fetched refs live under `refs/explain-change/`, away from your branches. Every call has a timeout (60 s per `az`
  call, 5 min for `az login`, 10 min per fetch).

## Configure

Without a config, layers and components are guessed from folder names, and the CLI and the page say so. To set it
up, ask your agent to **"configure explain-change for this repo"**: following `CONFIGURE.md`, it drafts the file with
`explain-change init`, reads the README and docs, names layers and components the way your team talks about the app,
and tries the result on recent PRs. `explain-change check` lists each lane with its components and file counts, and
the files no component covers.

The config is `.explain-change.toml` at the repository root (example: `examples/explain-change.toml`, schema:
`schemas/config.schema.json`):

| Key | Purpose |
|---|---|
| `project.name` | Shown in the report. Default: the repository folder name. |
| `project.direction` | One or two sentences on the intended architecture, context for the story and the decisions. |
| `project.lang` | Report language: `en` (default) or `es`. |
| `project.base` | Default base for `local`. |
| `project.budget` | Digest size in characters (2000–100000, default 12000 ≈ 3k tokens). `--budget` overrides it. |
| `[[layers]]` | Diagram lanes, top to bottom in the listed order (for example web first, core last). The order does not define allowed dependencies: `[rules]` does. |
| `[rules] allow` | Allowed dependency directions (`"a -> b"`, layer or component ids). When present, any other edge between layers is a violation. |
| `[rules] forbid` | Always a violation, even if `allow` matches. |
| `[rules] same_layer` | Allow edges inside a layer (default `true`). |
| `[[components]]` | `id`, `layer`, `paths` (globs: `*` stays inside one folder, `**` crosses folders; the most specific match wins, so `app/models/billing/**` beats `app/models/**`). Optional `name`, `desc`, and `imports`, `namespaces` (C#), `constants` (Ruby) for code owned outside `paths`; their `*` matches anything, `.` and `::` included (`billing.*`, `Billing::*`). |
| `[[flows]]` | Reference runtime flows (`"compA -> compB : message"`). An explanation's flow with the same id is compared with it. |
| `[ignore] paths / tests` | Generated or vendored files, and test patterns. Each list **replaces** its default (lockfiles, `dist/`, `vendor/`, `node_modules/`…; `test/`, `spec/`, `*_test.*`…), so copy the defaults you still need from `explainchange/constants.py`. |

## How it works

```
git diff / Azure DevOps PR + .explain-change.toml
        │  explain-change local | pr
        ▼
.explain-change/context.json        the whole change, analyzed without any LLM
.explain-change/digest.md           ≈3k-token summary for the agent
        │  the agent writes .explain-change/insight.json (≈1–2k tokens)
        ▼  explain-change render    validates it and rejects each issue precisely
.explain-change/out/<branch>.html   the page
```

The script does all the structural work: the diff, components, dependency graph, rule checks, layout and HTML. The
agent only writes the prose, within limits the validator enforces.

- **Deterministic**: the same change and config give a byte-identical page on any machine. The diff options are
  pinned, so nobody's git config changes the result.
- **Cheap**: the agent reads a budgeted digest, never the full diff. The digest inlines hunks by priority (public
  symbols, dependency changes, then config and migrations) and skips generated files (`linguist-generated`,
  `@generated`, `DO NOT EDIT`…). Each accepted explanation is kept per change in `.explain-change/insights/`, keyed by
  the diff, the config and the tool's analysis version.
- **Safe input**: PR descriptions, specs and code are passed to the agent as data, never as instructions.
- The rules for the agent live in one place, the `## Task` section of the digest, generated from the validator, so
  they always match what `render` accepts.

### Dependency analysis

Built and tested for Ruby on Rails and Python/Django. TypeScript and C# imports are parsed, but not tested or tuned.

**Rails**
- Constants resolved with Zeitwerk conventions (`app/*/`, `concerns/`, `lib/`, packs and engines), honoring
  `inflect.acronym` and `inflector.inflect` (`API::V1::…`), with lexical nesting as Ruby does.
- Associations (`has_many`, `belongs_to`, `has_one`, `habtm`, `class_name:`), skipping `polymorphic` and `through`.
- ERB views (only the Ruby inside `<% %>`), `require` / `require_relative`, and routes in `config/routes.rb` and
  `config/routes/*.rb`, listed as endpoints.

**Django**
- `import` / `from … import` and relative imports, rooted at the repo, `src/`, every `manage.py` folder and the parent
  of every app.
- String references: `ForeignKey("app_label.Model")` (with `AppConfig.label`), `apps.get_model()`,
  `include("x.urls")`, `import_string`, `send_task`.
- Endpoints: `path()`, `re_path()` and DRF `router.register()` in `urls.py`, `routers.py`, `routes.py` and
  `routing.py`.

**Without a config**, layers and components are guessed as a starting point. Rails: Web, Application, Domain and
Infrastructure, with one component per `app/<kind>` folder, big ones split by namespace (a namespace owns its root
model: **Family** = `app/models/family.rb` + `app/models/family/**`). Django: Web, Apps and Shared, with one component
per app.

**What the map shows**: the changed components, plus neighbors reached by an edge that the change creates or that
points at a changed public surface; long-standing, unrelated edges are left out. Unresolved references are counted,
never hidden. Flow steps are checked against the code, and unverified ones are drawn dashed with a `?`.

### OpenSpec

When the change touches `openspec/changes/<id>/` (active or archived) or `openspec/specs/<capability>/spec.md`, the
script parses the proposal, design decisions, tasks and requirement deltas (`ADDED`, `MODIFIED`, `REMOVED`,
`RENAMED`, with their GIVEN/WHEN/THEN scenarios). The SDD section below the map shows the spec-driven pipeline
(proposal → specs → design → tasks → code → archive) as a stepper, a bar of how many requirements are met, and a
requirement × component matrix with tests and status (`implemented | partial | missing | n/a`). A requirement opens
to its scenarios as GIVEN → WHEN → THEN panels, or as a table when it has several, so what differs between them
stands out. The map does not redraw the spec: a story step on it lights the components that implement the
requirement. A data flow can realize a scenario and shows it next to the flow.

## Develop

```bash
git clone git@github.com:denjamio/explain-change.git && cd explain-change
python3 explain_change.py install          # links your clone instead of a release; `git pull` updates it
python3 -m unittest discover -s tests      # Node also runs the report template, if it is on PATH
python3 examples/build_examples.py         # after changing the template or the analysis; CI checks it
```

`explain_change.py` is the command and `install.py` the installer. The code is the `explainchange/` package, one
module per stage, none importing a later one: `config` → `diff` → `deps` → `openspec` → `ado` → `collector`
(context.json) → `insight` (validation) → `digest` → `render` (HTML from `template/`), wired into commands by `cli`.
Bump `ANALYSIS_VERSION` in `explainchange/constants.py` when the analysis can draw a different map for the same
diff, so earlier explanations are reported stale. Changes go in [CHANGELOG.md](CHANGELOG.md).

## Roadmap

- `explain-change spec <change-id>`: an OpenSpec change on its own, before any code exists.
- npm CLI (`npx explain-change`) reusing the template and schemas unchanged.

## License

MIT. See [LICENSE](LICENSE).
