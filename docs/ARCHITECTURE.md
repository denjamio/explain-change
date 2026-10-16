# Architecture

explain-change splits the work by who can do it best. A deterministic CLI computes everything structural; an agent
writes only the prose, inside a contract the CLI drafts and validates. See [CONCEPTS.md](CONCEPTS.md) for the
vocabulary.

```
git diff / Azure DevOps PR + .explain-change.toml
        │  explain-change local | pr
        ▼
facts.json         the change, analyzed: files, components, dependencies, rules, symbols, OpenSpec, outline
digest.md          ≈2–4k tokens for the agent: the facts, the best hunks, the rules of the task
explanation.json   a draft: ids, views, focus, code references already right; "<…>" for the agent's words
        │  the agent fills explanation.json
        ▼  explain-change render
validation         every issue at once, as {path, code, message}; exit 1 until valid
out/<branch>.html  one self-contained page: the report script, its styles and the data
```

## Contract

The contract lives in `src/contract/` as zod schemas, the single source of truth for:

- the TypeScript types the CLI and the report script share (`report/app.ts` imports them),
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
| `src/hosts` | Where PRs live, as ports and adapters. `host.ts` is the port: a host's identity (which URLs and remotes are its own) and its two sides, `api` (parse a PR once into a `PrRef`, the open PR of a branch, metadata, an optional `share`) and `git` (the remote, the merge ref and the PR's own ref, the token for HTTPS). `source.ts` turns a PR into a change source the same way for every host (merge ref, else its own commits, git fetches that never prompt); `index.ts` registers the adapters and picks the host (PR URL, `--host`, `project.host`, remotes, Azure DevOps); `links.ts` builds links into a PR page (the report bundles it). One folder per adapter, each wrapping its CLI (injectable, so tests replace it) and translating its JSON into `PrMeta` at the edge: `azure-devops/` (`az`; shares reports as PR attachments through the REST API with the `az` token, HTTP injectable) and `github/` (`gh`; no `share`, since GitHub attaches only images and videos). A new host is one adapter folder, registered in `index.ts` and `links.ts`. |
| `src/analysis` | The facts: diff parsing, references per language, resolution, the dependency graph, rules, symbols, OpenSpec, the outline. |
| `src/explanation` | Prose rules (`prose.ts`, the refused words in `prose/en.json`), the draft, the validator, normalization, the per-change store. |
| `src/digest` | `digest.md` from the facts and the contract. |
| `src/report` | The page: excerpts, the embedded data, the assets built from `report/`. |
| `src/cli` | Commands, `--json` output, the work folder, the browser, skill install and self-update. |
| `report/` | The report script, typed against the contract: `app.ts` (the header, the map and the sections below it), `sdd.ts` (the OpenSpec section), `model.ts` (the embedded data and its lookups), `ui.ts`, `dom.ts` and `words.ts` (shared pieces and the page's words); its styles and its HTML shell. |
| `skills/` | The agent skills the CLI installs and the Claude Code plugin ships. |

## Determinism

- The diff runs with pinned flags (`DIFF_FLAGS`): no user git config changes it.
- Every list is sorted by an explicit key, compared by code unit, never by locale.
- Lengths and cuts count code points; text is decoded as UTF-8 with a BOM dropped.
- The report script is bundled without minification by a pinned Bun, so a release renders the same bytes everywhere.
- Tests build every scenario twice from scratch and require byte-identical pages; the real examples rebuild from
  their upstream commit with `bun run examples -- --real`.

## Analysis

References are read with regular expressions written for the declarations that matter to a dependency graph, and
tested on them: Ruby (Zeitwerk constants with lexical nesting, associations, `require`), ERB, Python (imports,
Django string references, URL includes), TypeScript (imports, `tsconfig` paths and `baseUrl`), C# (`using`,
namespaces, project references). Unresolved references are counted, never hidden. Repositories over 20,000 source
files are scanned only in the touched components, and files are read in chunks.

## Config assessment

`explain-change check` reads the whole repository at HEAD (`src/analysis/assess.ts`) and measures how the config fits
the code: dependencies between components that break `[rules]` today, components that depend on each other, and
components that change in the same commits (the git history, mass edits left out), and how often each one changes.
It is the evidence the configure
skill draws boundaries with; it never changes the facts of a change.

## Explanation lifecycle

`local` / `pr` make `explanation.json` belong to the current change: they keep it when it already does, restore the
one saved for this key in `explanations/`, or write a fresh draft (saving the previous change's work under its own
key first). `render` validates it; a valid explanation is saved under its key, so explaining a change again costs
nothing.

## Distribution

One code base, three ways to run it:

- **Standalone binaries** (`bun build --compile`), attached to each GitHub release; `install.sh` / `install.ps1`
  download one, and `explain-change update` replaces it.
- **npm** (`npx explain-change`): one bundled file for Node ≥ 20, with no runtime dependencies. Built and tested in
  CI; published by the release workflow once the repository has an `NPM_TOKEN` secret.
- **Source** (`bun src/cli/bin.ts`), for development.

The skills are embedded in the CLI (`explain-change install` writes them to `~/.agents/skills` and
`~/.claude/skills`) and shipped as a Claude Code plugin (`.claude-plugin/`).
