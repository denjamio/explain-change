# Limitations

What explain-change does not see, and what it checks only in part. Each limit is a choice of cost or scope; the
report and the digest say when one applies (unresolved references are counted, an inferred config is labelled).
See [ARCHITECTURE.md](ARCHITECTURE.md) for how the analysis works.

## Languages

References and public symbols are read for these languages only:

| Language | Files | What is read |
|---|---|---|
| TypeScript, JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs`, and the `<script>` of `.vue` `.svelte` | `import`, `export … from`, `require("…")`, `import("…")`, `tsconfig` paths and `baseUrl`, interfaces and `implements` |
| Python | `.py` | `import`, `from … import`, Django string references (`ForeignKey("app.Model")`, `get_model`, `include("app.urls")`), dotted calls, app labels |
| Ruby | `.rb` `.rake`, the Ruby inside `.erb` | Zeitwerk constants with lexical nesting, associations, `require`, Rails inflections |
| C# | `.cs` `.csproj`, and `.sql` for stored procedures | `using`, namespaces, project references, interfaces, `[dbo].[Proc]` calls |

Files in other languages (Go, Java, Kotlin, PHP, Rust, Swift…) still map to components, count in the change and
show in the digest's hunks. They add no dependency, symbol or detected flow: the map draws their boxes without
arrows, and the story falls back to the lines they change.

## The analysis reads text, not a syntax tree

References come from regular expressions written for the declarations a dependency graph needs. They miss:

- references built at run time: a `require` or `import()` of a variable, `importlib`, `constantize`, `send`,
  reflection, dependency-injection containers, routes declared outside the file that handles them (Django's
  `include` is the exception);
- metaprogramming: a Ruby constant defined by a macro, a class opened in an unusual indentation (nesting follows
  indentation);
- C#: a `using` is a dependency on the namespace, whether or not the file uses it; an interface is a type named
  `I` + a capital letter.

A reference that resolves to no file is counted in the facts, never dropped silently.

## Flows and the story

- A detected flow starts at an entry point found by path (`controllers/`, `views.py`, `jobs/`, `workers/`,
  `management/commands/`…) whose **added** lines call another component, and follows at most 6 calls. An entry point
  in a folder with another name is not detected; a reference flow in the config covers it.
- The story's outline ranks components by public symbols, dependencies gained or lost, migrations and lines of code.
  Its size follows the lines of code the change rewrites: 4 steps under 150 lines, 6 under 600, up to 8 above.

## Large repositories

Over 20,000 source files, only the components the change touches are scanned. Dependencies between 2 untouched
components are not read, so the map can miss a link that runs through them.

## What the validator checks, and what it does not

- Prose: the parts of ASD-STE100 listed in the README (sentence length, refused words, the passive with its agent,
  code names). A passive without `by`, a complex verb or 2 words for one thing pass: they are guidance only.
  Explanations are written in English only.
- A code name must exist at the head of the change; the validator does not check that what a sentence says about it
  is true.
- A decision's `basis` is accepted only when its source exists (a PR description, an OpenSpec change, an evidence
  line). Whether that source states the why is what `bun run eval --judge` measures; `render` does not.

## Determinism

The CLI is deterministic: the same change, config and version give byte-identical facts, digest, draft and page.
The prose is the agent's, so 2 runs write 2 explanations. A valid explanation is saved under the change's key, so
the same change renders the same page again without the agent.

The one exception is **since your review**: a PR's page also carries what changed since the latest other head of it
that a valid report showed in this clone, so it depends on that history. Its limits:

- A review is a valid report written, not a review on the host: the votes and comments of Azure DevOps and GitHub
  are not read.
- A file compares by its own added and removed lines, not their numbers. A binary file, or one whose hunks the diff
  left out (generated, too large), compares by its counts only. A renamed file counts as new, its old path as gone.
- The delta is deterministic. The agent writes what it means (`since`) from the interdiff of each file, up to 300
  patch lines a file at your review and 3,000 characters in the digest; the story still explains the whole PR.
- Steps you read live in the browser's storage of that page: another browser or a cleared storage starts over.

## Hosts

PRs are read from Azure DevOps (`az`) and GitHub (`gh`). On GitHub, a code reference opens the PR at its lines when
a hunk holds them. Azure DevOps has no link to a line of a PR's diff: a code reference opens the file at the head
(or the merge base) with its lines selected, outside the PR. A GitLab or Bitbucket PR works through its branch
(`explain-change local`).
