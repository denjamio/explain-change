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

The draft from `init` comes from folders. Folders are not architecture: expect to rename, merge and split.

## 2. Layers: the architecture style, not the folder kinds

Identify the style the code actually follows, and draw its lanes with its own words, entry points on top:

- **Layered** (Rails/Django default): web → application → domain → infrastructure.
- **Hexagonal / clean**: adapters in (HTTP, jobs, CLI) → application (use cases) → domain; adapters out
  (persistence, gateways) depend on the domain's ports. Infrastructure sits below, but points *up* to the domain.
- **Modular monolith** (packs, engines, apps as modules): lanes are usually still technical (entry, core, shared);
  the modules are the components.

3–5 lanes. The order only draws; `[rules]` decides. Name lanes as the team does ("API", "Use cases", "Domain",
"Adapters"); the defaults are only defaults.

## 3. Components: bounded contexts and capabilities, in domain language

A component is a unit of ownership a reviewer names in one word of the domain. Aim for 8–20.

- **Domain first.** Each bounded context or business capability is a component: Orders, Billing, Refunds,
  Catalog, Identity. Split a context across lanes only where the code separates it, and then name the parts with a
  fixed suffix set:
  - `<Context>` for its domain core (entities, aggregates, rules): **Orders**
  - `<Context> API` / `<Context> UI` for its entry points: **Orders API**
  - `<Context> jobs` for its background work: **Orders jobs**
  - `<Capability> adapter` or the provider's role for an outbound integration: **Payment gateway**, **Email delivery**
- **Never a framework artifact as a name**: no "Controllers", "Models", "Services", "Helpers", "Serializers",
  "Mailers" boxes. When the code is organized by artifact (all models in `app/models`), group by the domain concept
  anyway: `paths` take globs, and the most specific one wins (`app/models/order.rb`, `app/models/order/**`).
  A technical component exists only for a real cross-cutting capability, named by what it does: **Web UI** (views,
  assets, JS), **Persistence**, **Messaging**, **Observability**.
- **No dumping grounds.** "common", "shared", "utils", "core", "misc" hide coupling. If a shared kernel exists, call it
  **Shared kernel**, keep it to value objects and ids, and say so in `desc`.
- **Granularity.** Split when two parts have different aggregates, lifecycles or owners; merge when they always
  change together (step 6 measures it). A component with 0 files is wrong; one with far more files than the rest
  usually hides several contexts.
- **Fields.**
  - `id`: kebab-case of the name (`orders-api`), stable: rules, flows and explanations reference it.
  - `name`: the domain noun, ≤ 20 characters, in the team's language (`project.lang`), singular or plural as the
    team says it, the same style for every box.
  - `desc`: one sentence, "Owns <aggregates or data>; <what it guarantees or decides>": *Owns Order and LineItem; an
    order's total and what can still be refunded.*
  - `paths` decide ownership; `constants` (Ruby), `imports` (Python, TypeScript) and `namespaces` (C#) only for code
    owned outside them. A component may share its id with a layer only when it lives in that layer.

## 4. Rules: the dependency rule as an architecture decision

- Encode the rule the team agrees on, **even when today's code breaks it**: the map draws pre-existing violations
  apart (dashed), and each change's new ones in red. That is the signal to track, change by change.
- Layered: allow each lane to depend on the ones below it (`web -> application`, `application -> domain`, …).
  Hexagonal: everything points at the domain; the domain depends on nothing outside it
  (`forbid = ["domain -> infrastructure"]`), adapters may depend on the domain (`infrastructure -> domain`).
- Between contexts, prefer `forbid` for the boundaries that matter (`orders -> billing` when Orders must call Billing
  through its API): a short list of meaningful red lines beats a long one nobody reads.
- Copy rules the team already enforces (packwerk, import-linter…) as they are. With no agreed rule, leave `allow`
  out and say so: invented rules only paint the map red.

## 5. Language: glossary, direction and flows

- `[glossary]`: 5–20 terms of the domain, each with a one-line definition, as the business uses them
  (`refund = "Money returned to a customer for an order, in part or in full"`). One term per concept: when the code
  has two words for one thing (`purchase`, `order`), pick the team's word and note the other in its definition.
  Component names, flow titles and every explanation use these terms.
- `project.direction`: 1–2 sentences naming the style and the dependency rule, and the target when the code is
  moving toward one: *Hexagonal: use cases in app/services own the business flow; models hold the rules; adapters
  in app/clients implement the gateways. New logic leaves controllers and callbacks.*
- `[[flows]]`: 1–3 use cases the business runs on, titled as a command on a domain object (**Place an order**,
  **Refund an order**), with their steps as `"component -> component : call"`. A change that touches one is
  compared with it.
- `project.lang`: the language the team writes PRs in (`en` or `es`).
- `project.host`: only when the remotes do not tell where the PRs live (a mirror on both hosts, or none): `azure-devops`
  or `github`. Leave it out otherwise; the remotes decide.

`explain-change schema config` prints the full JSON Schema of the file.

## 6. Test the model against the code

```bash
explain-change check      # --history N reads more commits for "change together"
```

`check` measures how the config fits the code at HEAD:
- **Dependencies that break `[rules]` today**: real debt or a wrong rule. Keep the rule and accept the dashed lines
  when it is debt; fix the rule or the component when the code is right.
- **Components that depend on each other** (A ↔ B): usually one context split in two, or a missing boundary (an
  interface, an event). Merge them, or keep them and name the cycle in `direction` as debt.
- **Components that change together** (share of commits): above ~70% between two domain components, they are one
  context for the team; merge them. Between a context's parts across lanes (Orders API + Orders) it is expected.
- **Unmapped folders**: give them an owner or add them to `[ignore]`.

Then explain 2–3 recent PRs:

```bash
explain-change local --base <merge base of a recent merged PR> --json   # or: explain-change pr <id> --json
```

A good model shows a typical PR as 3–8 boxes the author would name the same way, with arrows that mean something.
When a PR spreads over many tiny boxes, merge them; when one box hides the point of the change, split it.

## 7. Hand it over

Show the user the file with a short architecture note: the style you identified and the evidence for it; each
context and why it is one; the rules and where they come from; the debt `check` found (violations, cycles, coupled
components) and what you recommend; and anything you were unsure about. Do not commit without asking.
