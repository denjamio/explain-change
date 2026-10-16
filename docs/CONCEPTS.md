# Concepts

One word per thing, everywhere: the CLI, `facts.json`, `explanation.json`, the digest, the report and these docs.
When two words could name the same thing, this page says which one is used.

## The change

| Term | Meaning |
|---|---|
| **Change** | What is explained: the diff between a **base** and a **head**. |
| **Source** | Where the change comes from: `local` (the current branch, optionally with uncommitted work) or `pr` (an Azure DevOps or GitHub pull request). `host` names where the PR lives (or would, for a branch). |
| **Base**, **merge base** | The ref the change is compared with (`--base`, `project.base`, else `origin/HEAD`, `main`…), and the commit where head and base diverge. The diff starts at the merge base. |
| **Key** | A hash of the diff, the config, the contract version and the analysis version. Same key = same change; an explanation is valid only for the key it was written for. |
| **File category** | `code`, `test`, `config`, `migration`, `docs`, or `ignored` (generated or vendored). |

## The architecture (the config, `.explain-change.toml`)

| Term | Meaning |
|---|---|
| **Layer** | A lane of the map, drawn top to bottom (entry points first, core last). Its order only draws; it decides nothing. |
| **Component** | A box of the map: a part with one responsibility, owning files by path globs (the most specific match wins). Each lives in one layer. |
| **Rule** | `allow` / `forbid` entries `a -> b` between layers or components. A dependency that breaks one is a **violation**. |
| **Reference flow** | A runtime path the team calls central, declared in the config (`[[flows]]`). An explained flow with the same id is compared with it. |
| **Glossary** | The team's ubiquitous language (`[glossary]`): one term per concept, with its definition. Component names, flow titles and explanations use it. |
| **Co-change** | How often two components change in the same commits (`check`): above ~70% between domain components, they behave as one context. |
| **Inferred config** | The layers and components guessed from folders when the repository has no config. Reported as such everywhere. |

## The analysis (`facts.json`, computed, no LLM)

| Term | Meaning |
|---|---|
| **Facts** | Everything the tool knows about one change. Same change + config + tool version → byte-identical facts. |
| **Delta** | How an element of the map differs between base and head: `added`, `changed`, `removed` or `unchanged`. The same four values for files, components, dependencies, symbols, flow steps, entities and relations. |
| **Neighbor** | A component with delta `unchanged` that a dependency of the change reaches. The report labels it "untouched", and draws it by default only when the change alters its link (a dependency added, removed, changed or broken, or the key dependency) or the story points at it; the others are **context**, shown on demand. |
| **Dependency** | Component A uses component B in code (import, constant, association, `using`, project reference). Drawn as an arrow. `changed` = it exists on both sides with a different number of references. |
| **Dependency graph** | Every component dependency at the head, drawn or not; used to verify flow steps. |
| **Symbol** | A public declaration (class, function, endpoint…) the change adds, changes or removes. |
| **Outline** | The story's skeleton computed from the facts: steps with their view, focus and code; detected flows; key-dependency candidates; data files. |
| **Detected flow** | A runtime path read from the code: an entry point (request handler, job, command) whose added lines call another component, then the calls onward. |

## The explanation (`explanation.json`, written by the agent)

| Term | Meaning |
|---|---|
| **Explanation** | The agent's prose about one change, validated against the facts. The CLI drafts it; the agent replaces each **placeholder** (`"<…>"`). |
| **TL;DR**, **goal** | What changes and its effect; the need behind it. |
| **Story** | The guided tour over the map: 2–8 steps, headline first, overview last. Each step has a **view**, a **focus** and optional **code**. |
| **View** | What the map shows: `architecture`, `flow:<id>`, `data`, or `requirements` (which lights the components that implement them). A view is a tab of the map. |
| **Focus** | The ids a story step lights on its view: components, flow participants or steps (`#2`), entities, requirements. |
| **Key dependency** | The dependency the change is really about (at most 2), highlighted on the map. |
| **Flow** | An explained runtime path: steps in call order, each with the **call** the code makes and its delta. A step with no dependency in the code is **unverified** (drawn with `?`). |
| **Data model** | The entities and relations the change touches, with changed fields (`+` added, `-` removed, `~` changed). |
| **Decision** | A design choice: what was chosen, why, the main alternative, and its evidence (`file:line`). |
| **Basis** | Where a decision's why comes from: `pr` (the PR description), `spec` (the OpenSpec proposal or design), `code` (the code at its evidence: a comment, a name, an ADR), or `inferred` (the agent's reading). The validator accepts `pr` and `spec` only when the change has that source, and `code` only with evidence; the report labels each one. |
| **Requirement status** | How the code meets an OpenSpec requirement: `implemented`, `partial`, `missing`, `not-applicable`. |
| **Prose rules** | The parts of ASD-STE100 (Simplified Technical English) the validator enforces: sentences of at most 25 words (an abbreviation such as *e.g.* does not end one), refused words (future and modal, judgements, marketing, filler, numbers in words; `prose/en.json`, where `word*` refuses every form), the passive with its agent (*is sent by the job*), and code names that exist at the head of the change. Code names are exempt from the word rules. The rest (simple verbs, one word per thing) is guidance in the digest. |

**Explanation state**: `missing` (no file), `stale` (written for another key), `draft` (placeholders left),
`invalid` (issues to fix), `valid`. The CLI's `--json` output turns it into the agent's **next action**:
`write-explanation`, `fix-explanation`, `collect-change` or `done`.

**Issue**: one problem with the explanation: `{path, code, message}`. The path is a JSON path (`story[2].heading`);
the code is stable (`too-long`, `unknown-id`, `placeholder`, `refused-word`…); the message says what to write.

## OpenSpec

| Term | Meaning |
|---|---|
| **Spec change** | An OpenSpec change folder (`openspec/changes/<id>/`): proposal, design, tasks and requirement deltas. |
| **Requirement** | `### Requirement:` in a spec, with its **scenarios** (GIVEN / WHEN / THEN). Its id is `<capability>/<kebab-name>`. |
| **Operation** | The delta a change states for a requirement: `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` (OpenSpec's own words), or `SPEC` when none is stated. |
| **Main-spec edit** | A change to `openspec/specs/<capability>/spec.md`; **merged** when it repeats a delta of a change in the same diff (an archive). |

## The work folder (`.explain-change/`, never committed)

`facts.json`, `digest.md` (what the agent reads), `explanation.json` (what it writes), `explanations/<key>.json`
(each change's explanation, restored when the change comes back) and `out/<branch>.html` (the reports).
