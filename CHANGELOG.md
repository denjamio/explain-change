# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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
