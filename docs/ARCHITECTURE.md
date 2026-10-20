# Architecture

explain-change splits the work by who can do it best. A deterministic CLI computes everything structural; an agent
writes only the prose, inside a contract the CLI drafts and validates. See [CONCEPTS.md](CONCEPTS.md) for the
vocabulary.

```
git diff / Azure DevOps PR + .explain-change.toml
        │  explain-change local | pr
        ▼
facts.json         the change, analyzed: files, components, dependencies, rules, symbols, OpenSpec, outline
digest.md          ≈5–7k tokens for the agent on a real PR: the facts, the best hunks, the rules of the task, and
                   the draft of explanation.json: ids, views, focus, code references already right; "<…>" for the
                   agent's words (also in draft.json)
        │  the agent writes explanation.json: the draft, filled, in 1 call
        ▼  explain-change render
validation         every issue at once, as {path, code, message}; exit 1 until valid
out/<branch>.html  one self-contained page: the report script, its styles and the data
```

## Contract

The contract lives in `src/contract/` as zod schemas, the single source of truth for:

- the TypeScript types the CLI and the report script share (the `report/` modules import them),
- the JSON Schemas in `schemas/` (generated; a test fails when they are stale),
- the limits and enums the validator enforces and the digest's `## Task` states (`LIMITS`, `ENUMS`).

`CONTRACT_VERSION` versions the shape of `facts.json` and `explanation.json`; `ANALYSIS_VERSION` versions what the
analysis computes. Both are part of the change key, so an explanation written against another version turns stale.

## Modules

Each folder depends only on the ones above it:

| Folder | Role |
|---|---|
| `src/core` | Paths (POSIX, as git prints them), globs, git, processes, text (code-point aware), constants, `UserError`. |
| `src/contract` | The schemas: config, facts, explanation. |
| `src/config` | Load and validate `.explain-change.toml`, infer one from the folder layout, map paths to components. |
| `src/hosts` | Where PRs live, as ports and adapters: Azure DevOps and GitHub. See [Hosts](#hosts). |
| `src/analysis` | The facts: diff parsing, references per language, resolution, the dependency graph, rules, symbols, OpenSpec, the outline. |
| `src/review` | Since your review: a snapshot of each PR head a valid report showed (`reviews/`), and the PR now against the latest other one: each file's own patch compared, so a rebase adds nothing, with its interdiff. |
| `src/explanation` | Prose rules (`prose.ts`, the refused words in `prose/en.json`), the draft, the validator, normalization, the per-change store. |
| `src/digest` | `digest.md` from the facts and the contract. |
| `src/report` | The page: excerpts, the embedded data, the assets built from `report/`. |
| `src/cli` | Commands, `--json` output, the work folder, the browser, skill install and self-update. |
| `report/` | The report script, typed against the contract: `app.ts` (the page shell), `header.ts`, `map.ts` (the map, its tabs, camera and story cards), `story.ts` (the views and the story they walk), `arch.ts`, `flow.ts` and `data-view.ts` (the 3 views, drawn on `svg-view.ts`), `sections.ts` (decisions and changes), `camera.ts` (pan, zoom and flights), `inspector.ts` (what a component or an entity shows), `code.ts` (code excerpts), `viewed.ts` (the story steps you read), `sdd.ts` (the OpenSpec section), `model.ts` (the embedded data and its lookups), `ui.ts`, `dom.ts` and `words.ts` (shared pieces and the page's words); its styles and its HTML shell. |
| `skills/` | The agent skills the CLI installs and the Claude Code plugin ships. A skill keeps its detail in `references/`, read at the step that needs it. |

## Hosts

Where PRs live, as ports and adapters:

- `host.ts` is the port: a host's identity (which URLs and remotes are its own) and its two sides. `api` parses a
  PR once into a `PrRef`, finds the open PR of a branch, and reads its metadata. `git` names the remote, the merge
  ref and the PR's own ref, and the token for HTTPS.
- `source.ts` turns a PR into a change source the same way for every host: the merge ref, else its own commits,
  with git fetches that never prompt.
- `index.ts` registers the adapters and picks the host: the PR URL, `--host`, `project.host`, the remotes, then
  Azure DevOps. `links.ts` builds links into a PR page (the report bundles it).
- Each adapter folder wraps its CLI (injectable, so tests replace it) and translates its JSON into `PrMeta` at the
  edge: `azure-devops/` (`az`) and `github/` (`gh`).
- A new host is one adapter folder, registered in `index.ts` and `links.ts`.

## Determinism

- The diff runs with pinned flags (`DIFF_FLAGS`): no user git config changes it.
- Every list is sorted by an explicit key, compared by code unit, never by locale.
- Lengths and cuts count code points; text is decoded as UTF-8 with a BOM dropped.
- The report script is bundled without minification by a pinned Bun, so a release renders the same bytes everywhere.
- The validator reads code names at the head of the change (`git grep` and `git cat-file` at its commit), never the
  checkout, which may be another branch than the PR; only `--include-uncommitted` reads the working tree.
- Tests build every scenario (offline fixtures, never published) twice from scratch and require byte-identical
  pages. The published examples are real PRs only: they rebuild from their GitHub PR with
  `bun run examples -- --real`, through `explain-change pr <url>` as a user runs it, and a build stops when GitHub
  gives the PR another head or merge base than `real.json` records.

## Analysis

References are read with regular expressions written for the declarations that matter to a dependency graph, and
tested on them: Ruby (Zeitwerk constants with lexical nesting, associations, `require`), ERB, Python (imports,
Django string references, URL includes), TypeScript (imports, `tsconfig` paths and `baseUrl`), C# (`using`,
namespaces, project references). Unresolved references are counted, never hidden. Repositories over 20,000 source
files are scanned only in the touched components, and files are read in chunks. [LIMITATIONS.md](LIMITATIONS.md) lists
what this reading misses.

## Config assessment

`explain-change check` reads the whole repository at HEAD (`src/analysis/assess.ts`) and measures how the config fits
the code: dependencies between components that break `[rules]` today, components that depend on each other, and
components that change in the same commits (the git history, mass edits left out), and how often each one changes.
It is the evidence the configure
skill draws boundaries with; it never changes the facts of a change.

## Explanation lifecycle

`local` / `pr` make `explanation.json` belong to the current change: they keep it when it already does, restore the
one saved for this key in `explanations/`, or leave it missing for the agent to write from the draft (saving the
previous change's work under its own key first). The draft is never written to `explanation.json`: an agent that
has it in the digest writes the file in 1 call, without a turn to read it first. `render` validates it; a valid
explanation is saved under its key, so explaining a change again costs nothing.

A valid report of a PR also records its head as a **review** (`reviews/<pr>.json`). The next head of the same PR is
compared with the latest other review: the digest gets `## Since your review` (what moved, and how each patch
changed), the draft gets `since`, the validator checks it against that review, and the page shows the delta. Without
a review, none of these change: the same change gives the same digest, draft and page.

## Distribution

One code base, two ways to run it:

- **npm** (`npm install -g explain-change`): one bundled file for Node ≥ 20, with no runtime dependencies. CI runs it
  on Linux, macOS and Windows (`bun run smoke`); the release workflow publishes it once the repository has an
  `NPM_TOKEN` secret. `explain-change update` runs `npm install -g` for a global install.
- **Source** (`bun src/cli/bin.ts`), for development.

The skills are embedded in the CLI (`explain-change install` writes them to `~/.agents/skills` and
`~/.claude/skills`, `explain-change uninstall` removes them) and shipped as a Claude Code plugin (`.claude-plugin/`).
