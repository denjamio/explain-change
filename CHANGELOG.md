# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

First release, not published yet.

### Added

- `explain-change pr`: collects a local branch diff (`--base`, `--include-uncommitted`) or an Azure DevOps PR
  (`--ado`), maps files to components, builds the dependency delta and checks `[rules]`.
- `digest.md`: a budgeted summary for the agent (`--budget` or `project.budget`, default 12000 chars ≈ 3k tokens).
  Its `## Task` section is the single source of the insight rules, generated from the validator.
- `explain-change render` and `validate`: check the agent-written `insight.json` field by field and render one
  self-contained, offline HTML report (architecture map, guided story, data flows, data model, design decisions).
- OpenSpec support: proposals, design decisions, tasks and requirement deltas parsed from the diff, or added with
  `--spec`, and traced to components and tests.
- Dependency analysis for Ruby on Rails and Python/Django; TypeScript and C# imports parsed but not tuned.
- `explain-change init` and `check`: draft and verify `.explain-change.toml`; `CONFIGURE.md` guides an agent through it.
- `explain-change install`: links only the runtime files into `~/.agents/skills` and `~/.claude/skills` (copies on
  Windows) and adds `explain-change` to `~/.local/bin`.
- Generated files (`linguist-generated`, `@generated`, `DO NOT EDIT`, `<meta name="generator">`) are ignored and
  never use the digest budget.
- PR descriptions and other quoted text are marked as data, not instructions, in the digest.
- Deterministic output: byte-identical HTML for the same change and config; diff options pinned against the user's
  git config; config line endings do not change the insight key.
- `SKILL.md` for agents with skill support, `PROMPT.md` for the rest.
- JSON Schemas for the config and the insight, example reports, unit, contract and end-to-end tests, and CI.
