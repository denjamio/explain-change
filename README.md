# explain-change

A visual, architecture-first explanation of a code change, as **one self-contained HTML page**: **what the change
does, where it sits in the architecture, how data flows and why it is built this way**.

It explains; it does not review. Bugs, gaps and merge readiness belong to your reviewer, and the line-level diff
belongs to the PR.

The page reads from what to where:

1. **What and why**: title, the goal of the change and a TL;DR.
2. **The map and its story**: a map you can pan and zoom, with the **architecture** as lanes (layers), the **data
   flows** in call order and the **data model**. A story of 2–8 steps walks through it: each step moves to what
   changed and shows the code. Click a component for what it now does, its files and its dependencies.
3. **Design decisions**: what was chosen, why, and the main alternative.
4. **SDD · OpenSpec**, for spec-driven changes: the pipeline (proposal, specs, design, tasks, code, archive) and each
   requirement traced to the components and tests that implement it, with its scenarios as flows.
5. **Changes by component**: each changed component with what it now does and its files.

Color encodes the delta (green added, blue changed, gray removed); a dependency that breaks one of your `[rules]` is a
red arrow. For an Azure DevOps PR, each file links to the file in the PR. The page works offline, in light and dark
mode, and carries only the code it shows. See the [examples](examples/index.html).

## How it works

A deterministic CLI does all the structural work: the diff, components, dependencies, rule checks, the story outline,
the layout and the page. Your agent writes only the prose, in a JSON file the CLI drafts, within limits the CLI
validates.

```
explain-change local     →  facts.json, digest.md (≈3k tokens) and an explanation.json draft
the agent                →  fills the draft's "<…>" (reading the digest, never the full diff)
explain-change render    →  validates it (exit 1 with precise issues until valid) and writes the page
```

- **Deterministic**: the same change and config give a byte-identical page on any machine.
- **Cheap**: the agent reads a budgeted digest. Each explanation is kept per change, so explaining a change again,
  or going back to an earlier PR, costs nothing.
- **Agent-friendly**: every command takes `--json` and says the `next` action (`write-explanation`,
  `fix-explanation`, `done`); issues come as `{path, code, message}`.
- **Safe input**: PR descriptions, specs and code reach the agent as quoted data, never as instructions.

Vocabulary: [docs/CONCEPTS.md](docs/CONCEPTS.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

```bash
# macOS, Linux, WSL: the standalone binary into ~/.local/bin, and the agent skills
curl -fsSL https://raw.githubusercontent.com/denjamio/explain-change/main/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/denjamio/explain-change/main/install.ps1 | iex
```

Or with Node ≥ 20: `npm install -g explain-change && explain-change install` (or `npx -y explain-change …`
without installing). It needs git and, for Azure DevOps PRs, the `az` CLI with the `azure-devops` extension.

`explain-change install` puts the skills where agents look for them (`~/.agents/skills` and `~/.claude/skills`).
In Claude Code you can also add them as a plugin:

```
/plugin marketplace add denjamio/explain-change
/plugin install explain-change@explain-change
```

Update with `explain-change update` (binary) or `npm install -g explain-change@latest`.

## Use

Ask your agent, in your own words:

| You ask | It runs |
|---|---|
| "explain PR 1234", or paste the PR URL | `explain-change pr 1234` |
| "explain this PR", on the PR's branch | `explain-change pr` (finds the branch's active PR) |
| "explain my changes", "what does this branch do" | `explain-change local` |
| the same, with work not committed yet | `explain-change local --include-uncommitted` |

The report **opens in your browser** once the explanation is valid (from WSL, in the Windows one). The first time in
a repository, ask it to **"configure explain-change for this repo"** (see [Configure](#configure)).

Agents with skill support (Claude Code and others reading `~/.agents/skills`) pick the skills up by themselves. For
any other agent, reference `~/.agents/skills/explain-change/PROMPT.md` from your `AGENTS.md`.

### Commands

```bash
explain-change local [--base REF] [--include-uncommitted]   # the current branch against its base
explain-change pr [ID|URL]                                  # an Azure DevOps PR (without an id: the branch's)
explain-change render                                       # validate explanation.json and write the page
explain-change status                                       # the explanation's state and the next step
explain-change init | check                                 # draft and verify .explain-change.toml
explain-change schema config|facts|explanation              # the JSON Schemas
explain-change install | update | --version
```

- `local` and `pr` also take `--spec <id>` (an OpenSpec change the code implements without touching it),
  `--budget <chars>`, `--out <path>`, `--no-open` and `--json`.
- Without an agent, the page still renders the map with an automatic story built from the facts.
- The map shows the components the change touches, and untouched ones only when the change alters their link to it
  (a dependency added, removed or broken, the key dependency) or the story points at them. The rest is one click
  away (**Context**).
- Reports go to `.explain-change/out/<branch>.html`. The work folder is added to `.git/info/exclude`, so it never
  shows in `git status`.
- The browser never opens with `--no-open`, in CI or with `EXPLAIN_CHANGE_NO_OPEN=1`.
- The base is `--base`, else `project.base`, else the first that exists of `origin/HEAD`, `origin/main`,
  `origin/master`, `main`, `master`, `origin/develop` and `develop`.
- GitHub and GitLab PRs work through their branch: `gh pr checkout 123 && explain-change local`.
- Exit codes: 0 done, 1 the explanation is not valid yet (`render`, `status`), 2 usage or config error.

## Azure DevOps

`explain-change pr` explains a PR without checking it out. Azure DevOps is detected from the URL or, for an id, from
the repository's remotes. Without an id, it finds the active PR from the current branch.

- **Login**: it uses `az`. When `az` has no session or it expired, it runs `az login` once, in the browser. git uses
  your own credentials first (SSH key or credential manager) and, on an HTTPS remote, the `az` token next, passed
  through the environment and never stored. Nothing else ever prompts.
- **Code** comes from git: `refs/pull/<id>/merge`, the PR applied to its target, the change the PR page shows. A PR
  without one (merge conflicts, completed, abandoned) is explained as its source branch against the merge base with
  its target, and the CLI says so.
- **Title, description and file links** come from `az repos pr show`. If the organization is not detected from the
  remote, run `az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>`. Without
  `az`, the page still renders from git alone, and the CLI says what is missing.
- Fetched refs live under `refs/explain-change/`, away from your branches. Every call has a timeout.

## Configure

Without a config, layers and components are guessed from folder names, and the CLI and the page say so. Ask your
agent to **"configure explain-change for this repo"**: the configure skill drafts the file with
`explain-change init`, reads the docs and existing dependency rules, names layers and components the way your team
talks about the app (bounded contexts named in the domain's words, not by framework artifact), and tries the result
on recent PRs. `explain-change check` measures how the config fits the code: each lane with its components and file
counts, the files no component covers, the dependencies that break `[rules]` today, components that depend on each
other, and components that change together in the git history.

The config is `.explain-change.toml` at the repository root (example: `examples/explain-change.toml`; schema:
`schemas/config.schema.json`; unknown keys are errors, so typos never pass silently):

| Key | Purpose |
|---|---|
| `project.name` | Shown in the report. Default: the repository folder name. |
| `project.direction` | One or two sentences on the intended architecture: context for the story and the decisions. |
| `project.lang` | Report language: `en` (default) or `es`. |
| `project.base` | Default base for `local`. |
| `project.budget` | Digest size in characters (2000–100000, default 12000 ≈ 3k tokens). `--budget` overrides it. |
| `[[layers]]` | Map lanes, top to bottom in the listed order (entry points first, core last). The order does not decide what may depend on what: `[rules]` does. |
| `[rules] allow` | Allowed dependency directions (`"a -> b"`, layer or component ids). When present, any other edge between layers is a violation. |
| `[rules] forbid` | Always a violation, even when `allow` matches. |
| `[rules] same_layer` | Allow dependencies inside a layer (default `true`). |
| `[[components]]` | `id`, `layer`, `paths` (globs: `*` stays inside a folder, `**` crosses folders; the most specific match wins). Optional `name`, `desc`, and `imports`, `namespaces` (C#), `constants` (Ruby) for code owned outside `paths` (their `*` matches anything, `.` and `::` included). |
| `[[flows]]` | Reference runtime flows (`"compA -> compB : message"`). An explained flow with the same id is compared with it. |
| `[glossary]` | The team's ubiquitous language: `term = "one-line definition"`. The agent writes every explanation with these terms. |
| `[ignore] paths / tests` | Generated or vendored files, and test patterns. Each list **replaces** its default (`explain-change init` writes the defaults out). |

### Languages

Dependencies are resolved for **Ruby on Rails** (Zeitwerk constants with `inflect.acronym`, lexical nesting,
associations, ERB, routes), **Python/Django** (imports, string model references, `include()`, `import_string`,
celery tasks, URL routes), **TypeScript/JavaScript** (relative imports, `tsconfig` paths and `baseUrl`) and **C#**
(`using`, namespaces, project references). Without a config, Rails and Django layouts are recognized (an app per
component, big Rails namespaces split by concept); other layouts get one component per top-level folder.

### OpenSpec

When the change touches `openspec/changes/<id>/` (active or archived) or `openspec/specs/<capability>/spec.md`, the
CLI parses the proposal, design decisions, tasks and requirement deltas (`ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`,
with their scenarios). The agent maps each requirement to the components and tests that implement it.

## Develop

```bash
git clone git@github.com:denjamio/explain-change.git && cd explain-change
bun install
bun run check                 # typecheck, lint and the tests
bun run dev -- local          # the CLI from source (any command)
bun run install:dev           # this checkout as `explain-change` in ~/.local/bin, skills linked to skills/
bun run examples              # rebuild examples/ after changing the report or the analysis (CI checks it)
bun run eval -- --model haiku # a real agent explains each scenario with the skill (costs tokens)
```

Change the skills or the digest's rules, then run the eval: it reports, per scenario, whether the agent reached a
valid explanation, with its turns, cost and time. Bun runs the toolchain; the published CLI runs on Node ≥ 20 or as a standalone binary. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. Bump `ANALYSIS_VERSION` (`src/core/constants.ts`) when the
analysis can produce different facts for the same diff, and `CONTRACT_VERSION` when `facts.json` or
`explanation.json` change shape. Changes go in [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
