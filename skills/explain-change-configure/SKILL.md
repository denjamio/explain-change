---
name: explain-change-configure
description: Set up or improve a repository's .explain-change.toml — the layers, components, dependency rules, reference flows and glossary the explain-change map is drawn from — so the map shows the architecture as a senior architect would draw it, in the team's domain language. Use when the user asks to configure explain-change, when explain-change reports that the architecture was guessed (no config), or when its map shows components that do not match the code.
---

# Configure explain-change: the architecture as the team should read it

Work as the architect of the codebase. The config is a small, versioned model of the system: the map every change is
drawn on, and the vocabulary every explanation is written in. A newcomer should recognize each box; a senior should
agree with each line between them. Work from the repository root.

The model has three parts, each with one job:

| Part | Answers | Drawn as |
|---|---|---|
| `[[layers]]` | Which way may dependencies point? (the architecture style) | lanes |
| `[[components]]` | Who owns what? (bounded contexts and capabilities, in domain language) | boxes |
| `[rules]` | What is the agreed dependency rule, and what breaks it? | red arrows |

`[glossary]` holds the ubiquitous language; `[[flows]]` the use cases the business runs on.

## 1. Gather the evidence

```bash
explain-change init       # a draft from the folder layout (--force replaces an existing file)
explain-change check      # file counts, unmapped folders, and how the config fits the code (see step 6)
```

Then read, only what exists, and stop when the picture is clear:
- `README.md`, `docs/` (architecture, ADRs, context maps), `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`.
- Rules the team already enforces, the best source for `[rules]`: packwerk (`packwerk.yml`, `**/package.yml`),
  import-linter (`.importlinter`, `[tool.importlinter]`), dependency-cruiser, eslint `boundaries` or
  `no-restricted-paths`, ArchUnit-style tests.
- The domain's words: model and table names, route namespaces, Django apps, Rails packs and engines, module names,
  and the nouns in recent PR titles. List them; they are the glossary's first draft.

The draft from `init` comes from folders. Folders are not architecture: expect to rename, merge and split. The same
holds for the team's docs: a layout in `AGENTS.md` or the README ("models, services, queries") describes the lanes
of step 2, never the components of step 3.

## 2. Layers: the architecture style, not the folder kinds

Identify the style the code follows, and draw its lanes with its own words, entry points on top:

- **Layered** (Rails/Django default): web → application → domain → infrastructure.
- **Hexagonal / clean**: adapters in (HTTP, jobs, CLI) → application (use cases) → domain; adapters out
  (persistence, gateways) depend on the domain's ports. Infrastructure sits below, but points *up* to the domain.
- **Modular monolith** (packs, engines, apps as modules): lanes are usually still technical (entry, core, shared);
  the modules are the components.

3–5 lanes. The order only draws; `[rules]` decides. Name lanes as the team does ("API", "Use cases", "Domain",
"Adapters"); the defaults are only defaults.

## 3. Components: bounded contexts and capabilities, in domain language

A component is a unit of ownership a reviewer names in one word of the domain. Aim for 8–20. Domain first: each
bounded context or business capability is a box (Orders, Billing, Refunds), never a framework artifact
("Controllers", "Models", "Services"), even when the code and its docs are organized that way, and never a dumping
ground ("common", "utils"). Name a context's parts with a
fixed suffix set (`Orders`, `Orders API`, `Orders jobs`, `Payment gateway`).

Before you write the `[[components]]`, read [references/components.md](references/components.md): the naming
suffixes, granularity (when to split and merge), what each field holds and how to write `paths` that keep up with new
files.

## 4–5. Rules and language

- `[rules]`: encode the dependency rule the team agrees on, even when today's code breaks it; copy rules the team
  already enforces (packwerk, import-linter…) as they are; with no agreed rule, leave `allow` out.
- `[glossary]` (5–20 terms), `project.direction` (1–2 sentences: the style and its rule), `[[flows]]` (1–3 use cases
  titled as a command on a domain object), and `project.names` / `project.host` only when needed.

Before you write them, read [references/rules-and-language.md](references/rules-and-language.md): the rule per
architecture style, how to word each glossary term, and when `names` and `host` apply.

`explain-change schema config` prints the full JSON Schema of the file.

## 6. Test the model against the code

```bash
explain-change check      # --history N reads more commits for "change together"
```

`check` reports the dependencies that break `[rules]` today, the components that depend on each other, the ones that
change together or rarely change, the components that list single files and the unmapped folders. Read
[references/check.md](references/check.md) for what each finding means and what to change, then explain 2–3 recent
PRs:

```bash
explain-change local --base <merge base of a recent merged PR> --json   # or: explain-change pr <id> --json
```

A good model shows a typical PR as 3–8 boxes the author would name the same way, with arrows that mean something.
That is how you judge the model, not a condition for building it: a PR that lights Models, Services and Queries
means those boxes still have to split by context, now.

## 7. Hand it over

Show the user the file with a short architecture note: the style you identified and the evidence for it; each
context and why it is one; the rules and where they come from; the debt `check` found (violations, cycles, coupled
components) and what you recommend; and anything you were unsure about. Do not commit without asking.
