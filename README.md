# explain-change

Visual, architecture-first explanation of a code change, as **one self-contained HTML file**. It sits between the
PR diff and the review: it says **what the change does, where it sits in the architecture, how data flows and why it
is built this way**.

It does not review. Bugs, gaps and merge readiness belong to your reviewer agent, rule enforcement belongs to your
linters (`packwerk` in Rails, `import-linter` in Django), and the line-level diff belongs to the PR.

The page has three parts:
1. **What and why**: title, TL;DR and the goal of the change.
2. **The map and its story**. A map you can pan and zoom shows the **architecture** as lanes (layers), the **data
   flows** as sequences in call order, the **data model**, and, for spec-driven changes, the **OpenSpec requirements**
   traced to the code. A story of 2–8 steps drives it: each step moves to what changed, dims the rest and shows the
   code excerpt. Click a component to see what it now does, its files and its dependencies.
3. **Design decisions**: what was chosen, why, and the main alternative.

Colour encodes the delta (green new, blue changed, grey removed). A dependency that breaks a `[rules]` entry is a red
arrow. The page carries only the code excerpts it shows; each file reference links to the file in the PR (Azure
DevOps).

The script does the deterministic work and works without an agent. With an agent, the agent only writes a small,
validated `insight.json` (~1–2k tokens).

```
git diff / Azure DevOps PR + .explain-change.toml
        │  explain-change pr
        ▼
.explain-change/context.json   full data (no LLM)
.explain-change/digest.md      ≈3k-token summary for the agent
        │  agent writes .explain-change/insight.json
        ▼  explain-change render  (validates, rejects precisely)
.explain-change/out/<branch>.html   self-contained, offline, light/dark
```

## Requirements

- Python 3.11+ and git, already installed. The script uses only the standard library and stops with a clear message
  on an older Python.
- Optional: `az` CLI, to add the Azure DevOps PR title, description and file links.

## Install

`install` sets up the skill for your agents and the `explain-change` command. It installs nothing else.

```bash
python3 explain_change.py install   # py -3 explain_change.py install on Windows
```

- Links this folder into `~/.agents/skills/explain-change` and `~/.claude/skills/explain-change`, and puts
  `explain-change` in `~/.local/bin`.
- On Windows, symlinks need Developer Mode, so the skill is copied and `explain-change.cmd` calls the Python that ran
  the install. Run `install` again after you update this folder.
- Running it again is safe: it replaces its own earlier installs. It leaves any other folder in place unless you add
  `--force`.

## Use

```bash
explain-change init                    # once per repo: draft .explain-change.toml, then edit it
explain-change check                   # validate config, list unmapped files
explain-change pr                      # branch vs the base (--base <ref> to override)
explain-change pr --include-uncommitted
explain-change pr --ado 1234           # Azure DevOps PR (fetches refs/pull/1234/merge)
explain-change pr --spec add-2fa       # also an OpenSpec change the branch implements without touching it
explain-change render                  # after writing or fixing insight.json
explain-change validate                # check insight.json without rendering
```

The base is `--base`, else `project.base`, else the first that exists of `origin/HEAD`, `main`, `master` and `develop` (remote first).

With an agent, ask it to "explain this change". Agents with skill support follow `SKILL.md`; any other agent
follows `PROMPT.md` (reference it from `AGENTS.md`).

Without an agent, `pr` still renders the map with an automatic story built from the dependency changes.

## Config

`.explain-change.toml` at the repository root. See `examples/explain-change.toml` and `schemas/config.schema.json`.

| Key | Purpose |
|---|---|
| `project.name` | Shown in the report. Default: the repository folder name. |
| `project.direction` | One or two sentences on the intended architecture. The agent reads it as context for the story and the decisions. |
| `project.lang` | Report language: `en` (default) or `es`. |
| `project.base` | Default base ref for `pr`. |
| `[[layers]]` | Diagram lanes, drawn in the listed order from top to bottom (for example web first, core last). Name and split them the way your team talks about the app. The order does not define allowed dependencies: `[rules]` does. |
| `[rules] allow` | Allowed dependency directions (`"a -> b"`, layer or component ids). When present, any other edge between layers is a violation. |
| `[rules] forbid` | Always a violation, even if `allow` matches. |
| `[rules] same_layer` | Allow edges inside a layer (default `true`). |
| `[[components]]` | `id`, `layer`, `paths` (globs, `**` supported; the most specific match wins, so `app/models/billing/**` beats `app/models/**`). Optional `name`, `desc`, and `imports`, `namespaces` (C#), `constants` (Ruby) for code owned outside `paths`. |
| `[[flows]]` | Reference runtime flows (`"compA -> compB : message"`). An insight flow with the same id is compared with it. |
| `[ignore] paths / tests` | Generated or vendored files, and test patterns. |

**Setting it up**: ask your agent to "configure explain-change for this repo". It follows `CONFIGURE.md`: drafts the
file with `init`, reads the README, docs and any packwerk or import-linter rules, names layers and components the way
the team does, and tries the result on recent PRs. `explain-change check` lists each lane with its components and
file counts. Without a config the script guesses from folder names (see *Structure detection*), and the CLI and the
report say so first.

## OpenSpec

When the diff touches `openspec/changes/<id>/` (active, or moved to `changes/archive/<date>-<id>/`) or
`openspec/specs/<capability>/spec.md`, the script parses, without any agent:

- `proposal.md` (Why, What Changes, Impact), `design.md` (Decisions), `tasks.md` (done/total per group);
- requirement deltas (`## ADDED|MODIFIED|REMOVED|RENAMED Requirements`, `### Requirement:`, `#### Scenario:` with
  GIVEN/WHEN/THEN), with ids `<capability>/<requirement-slug>`;
- edits to main specs (usually the archive merge) as a requirement-level diff.

The report shows the spec-driven (SDD) pipeline (proposal → specs → design → tasks → code → archive) and a **Spec** stage:
tests ← requirements → components. The agent must map every ADDED/MODIFIED requirement to the code
(`implemented | partial | missing | n/a`); components and test paths are validated, and an `aligned` verdict
is rejected while a requirement is `missing`. A flow can realise a scenario (`"scenario": "<req-id>#<scenario-id>"`),
which shows its WHEN/THEN next to the sequence.

## Dependency analysis

Built and tested for Ruby on Rails and Python/Django. TypeScript and C# imports are also parsed, but they are not tested or tuned.

**Rails**
- Constants resolved with Zeitwerk conventions (`app/*/`, `concerns/`, `lib/`, packs and engines), honouring
  `inflect.acronym` and `inflector.inflect` (`API::V1::…`).
- Lexical nesting follows indentation (`module A; class B` vs compact `class A::B`), like Ruby does.
- Associations: `has_many :line_items`, `belongs_to`, `has_one`, `habtm`, `class_name:`; skips `polymorphic` and `through`.
- ERB views: only the Ruby inside `<% %>` is read, so HTML text never creates edges.
- `require` / `require_relative`.

**Django**
- `import` / `from … import`, relative imports; roots at the repo, `src/`, every `manage.py` dir and the parent of every app.
- String references: `ForeignKey("app_label.Model")` (with `AppConfig.label`), `apps.get_model()`, `include("x.urls")`,
  `import_string`, `send_task`.
- Endpoints: `path()` / `re_path()` and DRF `router.register()`.

**Structure detection (`init` and no-config runs)**: a starting point only. Layers, components and rules are yours to
rename, merge or split in `.explain-change.toml`, so the map reads the way each app is built.
- Rails: layers Web, Application, Domain, Infrastructure. Controllers and `config/routes.rb` form one component;
  views, components, helpers and JS form one `ui` component (their folders mirror screens, not architecture). Other
  `app/<kind>` folders get one component each; big ones (models, services…) split by namespace (≥ 8 files). A model
  namespace is named after its concept and owns its root model: **Family** = `app/models/family.rb` + `app/models/family/**`.
- Django: layers Web, Apps, Shared. One component per app (`apps.py`, `models`, `views`, `admin` or `migrations`); the
  project package keeps only its own modules; a package grouping 6+ small apps (`integrations/<x>`) collapses into one.

**What the diagram shows**: changed components, plus neighbours reached by an edge that a changed file creates or
that points at a file whose public surface changed. Long-standing edges unrelated to the change are left out.
Unresolved local references are counted and shown, never hidden.

## Determinism and cost

- Same change + same config → byte-identical HTML and identical SVG layout.
- The insight is keyed by `sha256(diff + config + schema version + --spec ids)`. If nothing changed, `pr` reports
  `insight: valid ✓` and the agent stops (0 tokens).
- Flow steps are checked against the code: a direct dependency in either direction, or both components depending
  on a common one (a port: dependency inversion). Unverified steps are drawn dashed with a `?`.
- The digest has a fixed budget (`--budget`, default 12000 chars ≈ 3k tokens). It inlines hunks by priority:
  public symbols, then dependency changes, then config and migrations.

## Tests

```bash
python3 -m unittest discover -s tests
```

## Roadmap

- `explain-change spec <change-id>`: an OpenSpec change on its own, before any code exists.
- npm CLI (`npx explain-change`) reusing the template and schemas unchanged.
