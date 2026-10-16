# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `explain-change share`: attaches the finished report to its Azure DevOps PR and comments with the link; only people
  who can open the PR can download it. It refuses a report of other commits than the PR's, and does not attach the
  same change twice (`--force` does). `local`, `pr` and `render` say when a report can be shared (`share` in
  `--json`); the skill mentions it and runs it only when asked.
- The examples are published at https://denjamio.github.io/explain-change/, all in English: real pull requests, a
  feature tour, and a table of what each report shows, read from the data it embeds. Each card links to its inputs
  (and, for real pull requests, the upstream commit).
- The README explains which parts of ASD-STE100 (Simplified Technical English) the explanation follows, and which
  prose rules `render` enforces.
- CI compiles the standalone binary on Linux, macOS and Windows and runs it through pipes on a temporary repository
  (`bun run smoke`), so the Windows binary runs before it ships.

### Removed
- C# support: `using`, namespaces, project references, ASP.NET endpoints and the .NET test, generated and build
  patterns. The `namespaces` component key is now an unknown key (an error). `ANALYSIS_VERSION` is 4, so explanations
  written before turn stale.

### Fixed
- Folders are created one at a time: on Windows, Bun's recursive mkdir could throw EEXIST under existing parents with
  another spelling (8.3 short names such as `RUNNER~1`), not only for existing folders. Scripts set the exit code
  instead of calling `process.exit()`, as the CLI does.

### Changed
- A logo: a lit bulb (`report/logo.svg`), in the report's top bar and as its favicon, in the examples gallery and in
  the README.
- Docs and skills no longer point to npm, which is not published yet: an agent that does not find the CLI asks the
  user to install it with `install.sh`. The README says how to release; the architecture doc describes `check`.

## [0.2.0] - 2026-10-16

A rewrite in TypeScript with one contract between the CLI, the agent and the report. The analysis gives the same facts
as 0.1.9 (checked on Rails, Django, TypeScript and C# repositories), and the agent's work becomes a draft to fill and a
state machine to follow.

### Added
- `explanation.json` is drafted by the CLI: ids, views, focus, code references and evidence are already right; the
  agent replaces each `"<…>"`. Placeholders left are reported once, as `placeholder`, and nothing else about them.
- `--json` on every command, with the agent's `next.action` (`write-explanation`, `fix-explanation`,
  `collect-change`, `done`). Issues come as `{path, code, message}` with stable codes.
- `explain-change status`: the explanation's state and the next step, without writing anything.
- `explain-change schema config|facts|explanation`: JSON Schemas generated from the contract, also in `schemas/`.
- Standalone binaries for Linux, macOS and Windows (`install.sh`, `install.ps1`, `explain-change update`), and an npm
  package (`npx explain-change`) for Node ≥ 20. No Python needed.
- A Claude Code plugin (`/plugin marketplace add denjamio/explain-change`), and a separate
  `explain-change-configure` skill, so configuring loads only when it is asked for.
- `docs/CONCEPTS.md` (the vocabulary) and `docs/ARCHITECTURE.md`.
- `explain-change check` measures how the config fits the code at HEAD: dependencies that break `[rules]` today,
  components that depend on each other, and components that change together in the git history (`--history N`).
- `[glossary]` in the config: the team's ubiquitous language. The digest gives it to the agent, which writes every
  explanation with those terms.
- The configure skill models the architecture as an architect would: the style behind the lanes, bounded contexts
  named in domain language with a fixed suffix set, rules as decisions (debt shows apart from new violations), and
  boundaries checked against `check`'s evidence.
- The story outline and the flows detected from the entry points are part of `facts.json` (`outline`).

### Changed
- One vocabulary everywhere: every element of the map has a `delta` (`added`, `changed`, `removed`,
  `unchanged`), replacing `new`/`same`/`context` and per-section status words. `context.json` is `facts.json`
  (`context` named two things); `insight.json` is `explanation.json`; `intent` is `goal`; `hero` is
  `keyDependencies`; `changes` is `components`; `spec` is `requirements` and `n/a` is `not-applicable`; a story
  step's `stage` is its `view`, and the `spec` view is `requirements`; a flow step's `msg` is its `call`.
- A dependency whose number of references changes is `changed`, drawn in blue, and counts as a key-dependency
  candidate.
- Unknown keys in `.explain-change.toml` are errors (a typo no longer passes silently). A component may share its id
  with a layer only when it lives in that layer: rules name both.
- `render` exits 1 until the explanation is valid; `render --force` and `validate` are gone (`status` replaces
  `validate`).
- Explanations are kept per change in `.explain-change/explanations/`.
- The prose rules live in `src/explanation/prose/en.json` and `es.json`.
- Big repositories are read in chunks; a change runs about twice as fast.
- The map is a desktop workspace as tall as the window: the map and the step's code on the left, the story on the
  right, so one step fits one screen; stepping brings it into view. One splitter sets the code's height.
- Untouched components appear only when the change alters their link to them, or the story points at them; the
  rest is behind a Context button.
- The report moves only where the reader looks: the arrows of the current story step and the key dependency. The
  rest of the map stays still, and neighbor components and unchanged dependencies are quieter.
- The legend groups what it explains (Components · Dependencies, Steps, Entities), so "new" never names two things.
- Each story step names its view and ends with a Next button; the last one goes back to the start.
- A local branch with one commit is titled with that commit's message (the branch still shows above it).
- Plainer labels: "83% of the code on the map", tooltips on Changes / After / Before, singular and plural counts.

### Fixed
- A UTF-8 byte order mark no longer hides the first line of a file: C# `using` and `namespace` lines there now count.
- Django layouts: a package of nested apps that is also an app is one component, not two.
- `models.py` counts as a data-model file; a leading `.` folder in a path glob (`.github/**`) is kept.
- An HTML comment (`<!--`) in the code or the PR no longer breaks the page's embedded data.
- Task items point at the right group when a tasks.md heading has no tasks.
- Key-dependency labels sit beside their arrow, never over a box, and fit their text.

### Upgrading from 0.1.x
- Install again with `install.sh`, `install.ps1` or npm: 0.1's Python updater does not move to the binary.
- Explanations written with 0.1 are stale: the first run on each change drafts a new one.

### Removed
- The Python implementation, `install.py`, `explain_change.py` and the root `SKILL.md`, `PROMPT.md` and
  `CONFIGURE.md` (now in `skills/`).

## [0.1.9] - 2026-10-14

Map tabs without the story-step count.

### Removed
- The number beside each map tab (the story steps told on it): it read as a count of the view's contents.

## [0.1.8] - 2026-10-14

Flows are outlined from the code that starts them, and name it.

### Added
- The digest outlines the runtime paths of the change from its entry points: a request handler, job or command whose
  added lines call another component, then the calls onward. Each path comes with its trigger
  (`OrdersController#create`) and its steps with the call the code makes (`Order.new`). The story visits the first
  one. Same change, same paths.
- A flow can name its `trigger`: the code that starts it, shown under the diagram ("Starts at") and in the tab's
  tooltip. Its names must exist in the change or the repository.

### Changed
- A flow title must not be a component's name, repeat another flow's title or end in a period.
- The digest asks for step messages as the call the code makes, or a short verb phrase.

## [0.1.7] - 2026-10-14

Map tabs show the whole flow title.

### Changed
- Map tabs show the whole title: no cut at 34 characters. Only a flow tab shrinks, and only when the bar has no
  room, after the view buttons move to a second row; its tooltip then shows the full title.
- The "Flows ▸" label is gone; a thin rule still separates architecture, flows and data model.
- The digest asks for flow titles as precise as the code: the starting action with its object.

## [0.1.6] - 2026-10-14

The map tabs say what kind of view each one is and how much of the story it tells.

### Changed
- The map tabs are grouped by kind of view: Architecture │ Flows ▸ one tab per flow │ Data model ("Data" was
  ambiguous next to the flows). Each tab counts the story steps told on it, and its tooltip shows the full title.
- The digest asks for flow titles that name the action that starts the flow, verb first, without the word "flow".

## [0.1.5] - 2026-10-14

The digest outlines the story from the facts, the validator checks the prose harder, and the report ends with
the changes by component.

### Added
- A "Changes by component" section closes the report: one row per changed component with its status, layer, the
  agent's one-line summary and its files, then the tests and the files outside the map. Rows open by default up to
  24 files. "Show on the map" opens the component in the inspector.
- Each section names its figures beside its title (decisions, requirements met, components and files), and the top
  bar shows the same counts.
- The digest pre-fills the insight from the facts: a story outline (stage, focus and code of each step, overview
  last), the `hero` candidates, the reference flow and the data-model evidence. The agent writes the words. The
  same change gets the same outline.
- When less than 80% of the changed code is on the map, a note names the folders no component holds, so the config
  does not drift from the code.
- The validator refuses, besides marketing words: the future and modals (`will`, `should`; `podría`, `va a`),
  filler (`just`, `simplemente`), judgements (`better`, `mejor`) and numbers in words (`two`, `tres`). Each error
  says why and what to write. Code names in the prose (snake_case, CamelCase, `Module::Name`, `obj.method()`) must
  exist in the change or the repository.

### Changed
- Scenarios are drawn as a flow: the starting state, an arrow to the action, and the outcomes branching out of it.
  Several preconditions join into the arrow. A requirement with several scenarios stacks one flow per scenario on
  the same columns, and a column equal to the one above fades.
- The digest's `## Task` shows a rule only when the change has what it is about (flows, data model, hero, spec),
  and lists every refused word of the report's language. Its JSON is valid and ready to fill.
- `SKILL.md` and `PROMPT.md` no longer repeat the digest's rules.
- The sections below the map read from why to where: design decisions, then SDD · OpenSpec, then the changes.
- The goal is a short labelled line under the title; the TL;DR follows it. The digest asks for an `intent` that
  names the need behind the change and does not repeat the TL;DR.
- Section titles are larger and a rule separates the sections.
- A test keeps the two copies of the dark palette (system preference, theme button) identical.

## [0.1.4] - 2026-10-13

SDD · OpenSpec moves out of the map into its own section, built for review.

### Changed
- SDD · OpenSpec is a section below the map instead of a map tab. Each change shows its pipeline as a stepper;
  a step opens its document (proposal, design, tasks) in place. A bar shows how many requirements are met.
- Requirements form one matrix: requirement, status, tests, and one column per component that implements them.
  Hovering a row lights its columns and the other way round. Partial and missing requirements open by default.
- Scenarios read as GIVEN → WHEN → THEN panels. A requirement with several scenarios shows them as a table, and a
  cell equal to the one above fades, so what differs stands out. The flow caption uses the same panels.
- A story step on the spec lights, on the architecture, the components that implement its requirements, and links
  to them in the SDD section. The header's requirements chip links there too.

## [0.1.3] - 2026-10-13

Fixes the code panel handle of 0.1.2.

### Fixed
- The handle below the code panel did nothing when dragged down on a short excerpt: it only set a maximum height.
  It now sets the height of the code area.

### Changed
- The report footer names the explain-change version that rendered it, so an old report is easy to tell apart.
- The Spec tab is now called SDD · OpenSpec.

## [0.1.2] - 2026-10-13

Report: a full-width code panel and a simpler Spec view.

### Changed
- The Spec view draws each fact once. The OpenSpec pipeline is one row of stages (proposal, specs, design, tasks
  with progress, code, archive); click a stage for its content. Tests sit as chips inside the requirement they
  cover instead of a third column, and a requirement shows its status once, in its header. Two columns instead
  of three, so the diagram is drawn larger.
- The code panel spans the full width of the map, under the story too, and is taller by default (up to 60% of the
  window). A second handle below it sets its height, also remembered per browser.
- Long code lines wrap, so the code only scrolls vertically; on small screens lines stay whole and scroll sideways.

## [0.1.1] - 2026-10-13

Report layout: easier to read and to follow.

### Changed
- The code of the active story step sits in a wide panel below the map, not squeezed into the story column.
- A handle between the map and the code sets the map height (drag, arrow keys; double-click resets). The height is
  remembered per browser, and resizing keeps the zoom.
- Larger text in the story, the inspector, the code and the Spec diagram; the Spec pipeline is only as tall as its
  content, so the diagram is drawn bigger.
- The map bar only holds what the diagram shows (stage tabs, and before/after for the architecture). Zoom, fit and
  pause float over the canvas, faded until the pointer is over the map.
- The legend lists only what the current diagram draws.
- The header groups its figures by question: size (files · lines), components (new · changed · removed), coverage
  and broken rules when they apply, and OpenSpec (requirements · tasks).

## [0.1.0] - 2026-10-13

First release, for use in practice on Rails and Django repositories before a stable 1.0.0. Expect the config, the
insight schema and the report to change between 0.x versions.

### Added

**Collecting a change**
- `explain-change local` explains the current branch (`--base`, `--include-uncommitted`); `explain-change pr <id|url>`
  an Azure DevOps PR, detected from the URL or the remotes; `explain-change pr` the active PR from the current
  branch.
  Maps files to components, builds the dependency delta and checks `[rules]`.
- Azure DevOps PRs by id, `!id` or a URL pasted from the browser. The code comes from git (`refs/pull/<id>/merge`,
  or the PR branches when there is no merge ref); title, description and file links come from `az`. The remote is
  the one that holds the PR. git never prompts: it uses the user's credentials, then the `az` token. When `az` has
  no session or it expired, `az login` runs once in the browser. Anything missing is reported with its fix, and
  every call has a timeout.
- Dependency analysis for Ruby on Rails and Python/Django. TypeScript and C# imports are parsed but not tuned.
- OpenSpec: proposals, design decisions, tasks and requirement deltas parsed from the diff (or added with `--spec`)
  and traced to components and tests.
- Paths are read exactly as git stores them, spaces, quotes, tabs and non-ASCII names included.
- Generated files (`linguist-generated`, `@generated`, `DO NOT EDIT`, `<meta name="generator">`) are ignored and
  never use the digest budget.

**The agent's part**
- `digest.md`: a budgeted summary for the agent (`--budget` or `project.budget`, default 12000 chars ≈ 3k tokens).
  Its `## Task` section is the only source of the insight rules, generated from the validator's limits.
- PR descriptions and other quoted text are marked as data, not instructions.
- `explain-change render` and `validate`: check `insight.json` field by field, with the exact path of each issue.
- Every accepted insight is kept as `.explain-change/insights/<key>.json`, so going back to a change that was
  already explained costs no tokens.
- `SKILL.md` for agents with skill support, `PROMPT.md` for the rest.

**The report**
- The finished report opens in the browser (from WSL, in Windows); `--no-open`, `CI` or `EXPLAIN_CHANGE_NO_OPEN`
  turn it off. The work folder is excluded from git in `.git/info/exclude`, so reports are never committed.
- One self-contained, offline HTML page: architecture map, guided story, data flows, data model, OpenSpec
  traceability and design decisions, in English or Spanish, light or dark.
- Deterministic: byte-identical HTML for the same change and config. The diff options are pinned against the
  user's git config. The insight key includes the analysis version, so a change to the analysis marks earlier
  insights stale.

**Setup**
- One-line install without cloning (`install.py`, run with `curl … | python3 -` or `irm … | py -3 -`), and
  `explain-change update` (`--version <tag>` for a given release).
- `explain-change install` links the runtime files into `~/.agents/skills` and `~/.claude/skills` (copies on
  Windows) and adds `explain-change` to `~/.local/bin`, with the PATH line to add when needed.
- `explain-change init` and `check`: draft and verify `.explain-change.toml`, which `CONFIGURE.md` guides an agent
  through. `local`, `pr` and `check` exit with 2 on config errors.
- `explain-change --version`: the version, the analysis version and the folder it runs from.

**Quality**
- JSON Schemas for the config and the insight, and example reports.
- Unit, contract, end-to-end and installer tests, plus a smoke test of the report template under Node.
- CI on Linux (Python 3.11–3.13) and Windows, lint, and a check that the committed examples are up to date.
  Failures show as annotations on the run page, which GitHub shows without signing in (unlike the logs).
