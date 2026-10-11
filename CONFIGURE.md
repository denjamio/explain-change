# Configure explain-change for a repository

Follow this when the user asks to set up, write or improve `.explain-change.toml`. The goal is a map that reads the
way the team talks about the app: a newcomer should recognise every lane and box. Work from the repository root.

## 1. Draft

```bash
explain-change init     # writes a draft from the folder layout (add --force to replace an existing file)
explain-change check    # lanes, components with their file counts, unmapped folders
```

The draft is a starting point. Folders are not architecture: expect to rename, merge and split.

## 2. Read how the team describes the app

Read only what exists, in this order, and stop when the picture is clear:
- `README.md`, `docs/` (architecture, overview, ADRs), `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`.
- Dependency rules the team already enforces. These are the best source for `[rules]`:
  - Rails: `packwerk.yml`, `**/package.yml` (packages and their `dependencies`).
  - Django: `.importlinter`, `[importlinter]` in `setup.cfg`, `[tool.importlinter]` in `pyproject.toml` (layers and
    forbidden imports).
- Rails: `config/routes.rb` namespaces, `app/` kinds, `packs/` or `engines/`, namespaces under `app/models`.
- Django: `INSTALLED_APPS` in settings, root `urls.py`, the apps and what each one owns.

Write down the words the team uses for its parts (for example "billing", "the API", "ledger"). Use them as names.

## 3. Decide the layers

- 3–5 lanes, top to bottom from the way in (web, API, workers) to the core (domain, shared).
- Name them the way the team does. "Web / Application / Domain / Infrastructure" is only a default.
- Order only draws the map. What may depend on what is decided by `[rules]`.

## 4. Decide the components

A component is a part with one responsibility that a reviewer would name in a sentence.
- Aim for 8–20 components. Fewer hides the design; more turns the map into a folder tree.
- Group by responsibility, not by folder:
  - Presentation (views, templates, components, helpers, JS) is usually 1 component.
  - Controllers and their routes belong together.
  - Domain areas with their own vocabulary (`billing`, `payments`, a model with its namespace) are their own
    components. Name them after the concept, not the syntax: **Family** owns `app/models/family.rb` and
    `app/models/family/**`.
- Give each component a `name` the team uses, short enough to label a box (about 20 characters), and a one-line
  `desc` of what it owns.
- `paths` decide ownership; the most specific glob wins. Use `constants` (Ruby) or `imports` (Python) only for code
  that lives outside its paths.
- Check the counts in `explain-change check`:
  - A component with 0 files is wrong: fix its paths or remove it.
  - A component with far more files than the others may hide several responsibilities: split it if the docs name them.
  - Unmapped source folders: give them a component or add them to `[ignore]`.

## 5. Rules, direction and flows

- `[rules] allow`: copy the dependency rules from packwerk or import-linter when they exist. Otherwise allow the
  directions the docs describe (for example web → application → domain). Leave `allow` empty when there is no agreed
  rule: an invented rule only adds red arrows.
- `project.direction`: 1–2 sentences from the docs on how the app is meant to be built. The agent reads it as context.
- `[[flows]]` (optional): 1–3 runtime paths the docs or the team describe as central (checkout, sign-up, sync), as
  `"component -> component : message"`. A change that touches one of them is compared with it.
- `project.lang`: the language the team writes PRs in (`en` or `es`).

## 6. Try it on real changes

```bash
explain-change check
explain-change pr --base <merge-base of a recent merged PR>   # or check out a recent PR branch
```

Open the HTML. A good config shows a typical PR as 3–8 boxes with names the author would use. If a change spreads
over many tiny boxes, merge them; if one box hides the point of the change, split it. Repeat until 2–3 recent PRs
read well.

## 7. Hand it over

Show the user the file with a short note: the sources you used, each layer and why, components you merged or split,
where the rules came from, and anything you were unsure about. Do not commit without asking. The file is versioned
with the repository, so the whole team gets the same map.
