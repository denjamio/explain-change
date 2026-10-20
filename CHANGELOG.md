# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- `explain-change update` could reinstall the version it had: npm keeps a package's versions cached for minutes, so
  right after a release `explain-change@latest` was still the one before, and `update` said `0.15.1 → 0.15.1`. It now
  asks the registry itself which version to install (`npm view --prefer-online`) and installs exactly that one. It
  says when the copy is already up to date, and fails, naming the path, when the copy it runs is not the one npm
  installed.

## [0.16.0] - 2026-10-20

### Removed
- `explain-change share`: neither Azure DevOps nor GitHub PRs take an HTML attachment a reviewer can open, so the
  command, the Azure DevOps upload and the `share` field of the `--json` output are gone. A report is one
  self-contained HTML file: send it the way your team shares files.
- A design decision no longer has an `alternative`. An alternative was mostly the agent's guess at an option nobody
  weighed, and naming the options not taken is a reviewer's work. A decision says what was chosen, why, and where the
  why comes from. An `explanation.json` that still has one renders as before, without it.

### Fixed
- The map no longer cuts its labels with "…". Component and lane names wrap to 2 or 3 lines and their boxes grow;
  a flow call too long for its lifelines takes 2 lines, broken after a code separator (`Folders.` /
  `DeleteMany()`), never inside a name, and the lifelines move apart only when 2 lines do not fit either; a step's
  data fits between its lifelines too; entity boxes take the width of their longest name or field. Only a label
  longer than its room even then ends in "…", with the whole text as its tooltip.

## [0.15.1] - 2026-10-19

### Fixed
- The npm package of 0.15.0 carried a stale build: `explain-change --version` printed 0.14.0, and the skills were
  marked 0.14.0. `npm publish` now rebuilds the bundle first (`prepublishOnly`), so the package always carries the
  version it is published as.
- The README links its images and pages by absolute URL on `main`, so the npm page shows them as GitHub does,
  and an npm badge shows the latest published version. A test keeps the links absolute.

## [0.15.0] - 2026-10-19

### Changed
- npm is the way to install: `npm install -g explain-change`, then `explain-change install` for the skills.
- `explain-change update` runs `npm install -g explain-change@latest` (or the `--version` tag), then refreshes the
  skills. A copy that is not a global npm install says how to update it.
- The npm package no longer ships `skills/`: the CLI carries the skills and `explain-change install` writes them.

### Removed
- The standalone binaries and the install scripts (`install.sh`, `install.ps1`): releases no longer carry binaries.
  A binary from an earlier release cannot update itself any more: delete it, then `npm install -g explain-change`.

### Added
- `explain-change uninstall` removes the skill folders that `install` wrote (it keeps any other folder), then says
  how to remove the CLI itself.

## [0.14.0] - 2026-10-18

### Fixed
- A detected flow no longer takes a class that inherits for a call: `class FamilyExport < ApplicationRecord` gave
  maybe's data export a step `family → shared-kernel: FamilyExport`, the class the line declares, on a dependency
  that is only its parent class. A line that declares a class, module, interface, record or struct is no step of a
  path. ANALYSIS_VERSION 15.

### Added
- `render` rejects an entity whose class the change declares in another component (`wrong-component`): the
  entity belongs to the component of its model, not of its migration. The draft fills it from the models the change
  edits, when they all live in 1 component, instead of the migration's folder.
- `bun run eval -- --calibrate --judge none`: the meta-eval for free, on the structure and `mentions` graders.
- `--baseline` compares PR by PR when 5 or more PRs are in common: the mean of the per-PR differences against a 95%
  interval of it from Student's t (at least 0.05), with the PRs that went up and down and a sign test. A rise above the
  noise is `IMPROVED`; the score of each split is listed, and a drop on one fails the eval. Unpaired runs keep the 0.1
  floor. The gate of the improvement loop runs on all 11 PRs (docs/EVALS.md).

Measured (haiku agent, sonnet judge, all 11 PRs, 2 runs each) against 0.13.0, paired: score 0.76 → 0.76 (+0.01
±0.05, 7 PRs up, 4 down), no measure regressed or improved; on test, score 0.75 → 0.78 (+0.03 ±0.07). With 2
standard errors instead of t, test's prose (+0.13 on 3 of 5 PRs, a field this change does not touch) passed as
improved; the t interval (±0.16) reads it as noise. The paired noise of the
score is ±0.05, against ±0.1 unpaired on the same runs. The step `family → shared-kernel: FamilyExport` reached 1
of 2 maybe runs before, 0 now. Free calibration (`--judge none`, 11 PRs): 51 of 53 measurable mutants caught.

## [0.13.0] - 2026-10-18

### Changed
- The draft's story lights at least 80% of the code the change rewrites when its budget lets it: the largest
  component left out (50+ lines of code) gets a step, ranked right after the first one. Before, 4 ranked components
  filled the story and a component with no public symbol stayed out however large (bitwarden's stored procedures,
  189 of 372 lines; maybe's views, 374 of 961). Drafts that pass `story-coverage`: 7/11 → 11/11. Measured (haiku
  agent, sonnet judge) against 0.12.0: train score 0.76 → 0.82, A/B 3–2; test (2 runs) score 0.74 → 0.76,
  structure 0.88 → 0.98, renders 1.3 → 1.0, A/B 4–3; grounded 0.80 → 0.67 on test (its noise is ±0.34).
  ANALYSIS_VERSION 14.
- The 11 example explanations come from these eval runs (the best valid run of each PR).

## [0.12.0] - 2026-10-18

### Changed
- The draft's tldr, goal, story body and decision why carry a present-tense example and "no would/could" next to
  the field: the modal that still cost a round of fixes in 2 of 6 train runs no longer shows up. Measured (haiku
  agent, sonnet judge) against 0.11.0: train score 0.77 → 0.76, renders 1.33 → 1.0; test (2 runs) score 0.74 → 0.74;
  no `would` in 34 runs; on the 4 train PRs, 12 runs each without a judge, score 0.89 → 0.93, tokens in −5%.
- 5 example explanations (bitwarden bulk folder delete and staged invites, chatwoot branded layouts and WhatsApp
  number health, saleor webhook payloads) come from a current agent run: their flows no longer have a step from a
  component to itself.

## [0.11.0] - 2026-10-18

### Changed
- `render` moves a location up to 20 lines outside a hunk (any line of an added file) onto the nearest hunk,
  writes it back to `explanation.json` and lists the fix (`explanation.fixed`): no round of fixes for it.
- A field too long is checked for prose in the same pass, and its issue says how much to cut and shows the words
  past the limit: 1 round of fixes is enough.
- The eval keeps the messages of the first render's issues (`firstMessages`).
- The draft gives limits in words first (`≤20 words (140 chars)`) and a present-tense example for a decision's why
  and alternative; the prose rules in the digest show how to rewrite a modal ("it would fail" → "it fails").

### Fixed
- A detected flow's id cut at 40 characters could end with a hyphen, so the draft failed its own validator
  (`ANALYSIS_VERSION` 13).

Measured with a haiku agent and a sonnet judge against 0.10.0 graded again by sonnet: train score 0.79 → 0.83,
renders 1.5 → 1.17, tokens in −16%; test (2 runs) score 0.77 → 0.76, renders 1.6 → 1.4. With the prose context:
test renders 1.4 → 1.1, tokens in 153k → 147k, score 0.76 → 0.74 (inside the noise); on the 4 train PRs that
rendered most, 12 runs each, renders 1.58 → 1.0 and turns 7.6 → 6.

## [0.10.0] - 2026-10-18

### Added
- The eval grades each run with pass/fail graders, after `claude plugin eval` and skill-creator, and `score` is the
  share that pass: **structure** (deterministic, against the facts: the story lights at least 80% of the changed
  code, the key dependency is one the change touches, decision evidence points into the change, flow steps exist in
  the code, no field repeats another), **content** (each example's `assertions.json`), **prose** (a rubric of
  PASS/FAIL conditions) and **grounded** (each decision's why against its source). The summary lists the failing
  graders first, with their evidence: what to fix.
- `examples/real/<name>/assertions.json`: what any good explanation of that PR says, written once by a model from
  the PR's title, description and diff, never from the tool's digest or explanation (`bun scripts/eval-assertions.ts`).
- Train and test splits (`real.json` `eval`, `--split`, train by default): an improvement loop reads the failures
  of train only and keeps a change when test does not drop.
- `--calibrate`, the meta-eval: each committed explanation and its mutants (a dropped story step, a key dependency
  the change does not touch, evidence outside the change, generic prose, a TL;DR that lists files, a goal that
  repeats it, decisions that restate the change, a made-up why) graded; it reports which defects the graders catch.
- `--compare results.json`: a blind A/B of 2 evals' explanations, run by run, asked in both orders (a verdict that
  changes with the order is a tie), with a sign test.
- `--max-cost USD` stops starting runs past the cost; `--baseline` also lists the graders an iteration fixed or
  broke.
- The summary lists the issues of each run's first render, most often first: what makes the agent render again.
- Each eval run records its tool calls in order (`tools`, with the size of each input and result), the prompt
  tokens read from and written to the cache, and the refused words behind a first render's issues: where the turns
  and the tokens go.
- `docs/EVALS.md`: the eval's graders, splits, improvement loop, options and the judge's calibration against sonnet.

### Changed
- `local` and `pr` no longer write the draft to `explanation.json`: it ends `digest.md` (and is in `draft.json`),
  and the agent writes `explanation.json` in 1 call. An agent no longer spends a turn reading a file it already has,
  since an existing file must be read before it is overwritten. The explanation is `missing` until then.
- The digest says how to read a source file at the head of a PR (`git show <head>:<path>`): the checkout can be
  another commit, and a failed read cost a turn.
- Counts in words (*two … twelve*) are no longer refused: the page writes them as digits. The refusal made most
  eval runs render twice.
- Each placeholder states its limit in words too (`≤160 chars, ~22 words`): a story body or heading over its limit
  was the commonest cause of a second render.
- The skill asks for the digest and the fixes in as few messages as possible.
- Together they cut the agent's prompt tokens by 23% and its turns by a third, at the same score: on the train
  split (haiku, 1 run) 231k → 177k tokens per run, 10.8 → 8 turns, score 0.88 → 0.88; on the test split (2 runs)
  210k → 161k tokens, 11.6 → 7.6 turns, score 0.82 → 0.83, cost per run −14%.
- The judge's calls are lean (no tools, MCP servers, skills or settings; a 1-line system prompt): about 600 tokens
  of overhead per call instead of 20k+. Haiku stays the default judge.
- The agent under test runs with no MCP server and, unless `--discover`, no other skill: each run is isolated from
  the machine's setup. Tokens do not compare with earlier evals.
- The agent under test gets only the tools it may use (`--tools`): the others' definitions cost ~5.5k tokens on
  every model call.
- `sourceReads` also counts read-only shell commands (`git show`, `sed`, `grep`), which run without a permission.
- The grounded judge reads the whole hunk around a code evidence (at most 80 lines), not the line ±3.
- `fidelity`, `draft` and `lift` stay as a regression check of the structure, not a measure of quality: they compare
  with the committed explanation, which the same tool wrote.

### Removed
- `faithful`: it checked the prose against the digest, which is the tool's own selection, and sat near 0.9 in
  every eval. The content assertions, written from the diff, replace it.

## [0.9.2] - 2026-10-17

### Added
- `bun run eval -- --rejudge results.json --judge MODEL` judges the explanations an `--out` file kept again, with no
  agent: a change to the judge is measured on the same explanations.

### Changed
- The judge gets each decision's source in full: the PR description (the digest cuts it short) and the OpenSpec
  proposal and design (the digest lists the design decisions by title only). `grounded` does not compare with
  earlier versions.

### Fixed
- The judge read a `code` decision's evidence from the working tree, which for a real PR is its base: a file the PR
  adds was an empty excerpt, and the judge accepted the why with no source. It now reads the head of the change.
  `grounded` before 0.9.2 is inflated for `code` decisions on new files.

## [0.9.1] - 2026-10-17

### Changed
- The eval's judge asks 2 questions in 2 calls: the decisions with the prompt of 0.8.2, so `grounded` compares
  across versions, and the statements apart (`faithful`). An unreadable answer leaves only its own measure out.
- `--out` keeps the explanation each agent wrote, so a run can be judged again.
- `--baseline` counts a drop as a regression only beyond 2 standard errors of the difference, and at least 0.1: 2
  evals of the same code differed by 0.06 in lift.

## [0.9.0] - 2026-10-17

### Added
- `docs/LIMITATIONS.md`: the languages the analysis reads, what regular expressions miss, the limits of detected
  flows, large repositories, the validator and the hosts.
- The eval's judge also checks the prose (tldr, goal, story, component summaries) against the digest in the same
  call: `faithful` is the share the digest shows.
- `bun run eval -- --baseline results.json` compares an eval with an earlier `--out` file and fails when the valid
  share drops, or a mean of fidelity, lift, grounded or faithful drops by more than the noise of either side.
- With no agent: a test keeps the draft's fidelity to the scenarios' explanations from dropping, and
  `bun run examples -- --real` prints the draft's fidelity for each real PR.

### Changed
- The draft's story is sized to the change: 4 steps under 150 lines of code, 6 under 600, up to 8 above. The steps
  that stay are, in order of priority, rule violations, the headline component, the requirements, the flow, the data
  model and the other components; the overview closes it. A small change used to get up to 8 steps to trim.
- A story heading's placeholder names what the step is about without proposing the heading (`Orders changed`), and
  the digest asks for the thing and what happened to it, not a delta alone.
- The `explain-change-configure` skill keeps its detail in `references/` (components, rules and language, `check`),
  read at the step that needs it: SKILL.md is half its size. `explain-change install` writes the references.
- `ANALYSIS_VERSION` 12: the outline changes.

### Fixed
- The digest put the change line and the PR description inside the glossary when the config has one: they are now
  under `## Change`.
- The digest says "1 hunk", "1 commit", "1 file".
- The refused-word list said "actually", a word it refuses; `orchestrat*` replaces its 4 forms.

## [0.8.2] - 2026-10-17

### Added
- The eval scores the draft the CLI wrote against the reference (`draft`) and reports `lift`, what the agent adds to
  it: the draft already holds the outline's focus, key dependency and flows, so the fidelity alone partly measured
  whether the agent kept them.
- The eval reads the agent's transcript (`stream-json`): prompt and output tokens, `render` calls (1 = valid at the
  first try), source files read beside the digest, and the digest's size.
- `bun run eval -- --discover` installs the skills in the repository's `.claude/skills` and names none of them: it
  reports whether the agent loads explain-change from its description, as in a user's session.
- `bun run eval -- --out results.json` writes every run and the summary as JSON.
- Tests for the eval's measures (`scripts/eval-metrics.ts`), offline.

### Changed
- `bun run eval` uses haiku by default, the model of the baselines.
- A judge answer that cannot be read, or that has no verdict per claim, is counted (`judgeErrors`) instead of
  silently leaving the run out of `grounded`.
- The agent command (`--agent`) is split on any run of spaces.

## [0.8.1] - 2026-10-17

### Changed
- A component on the map says how it meets its OpenSpec requirements: the spec icon (a page with a check) and
  implemented / mapped (`2/3`), amber when one is partial and red when one is missing, with a tooltip and an entry
  in the legend. A click opens the requirements view. It replaces `◆ 3`, a count with no meaning on the page.
- The report draws its own line icons (`report/icons.ts`), 1 meaning each: *Show on the map* has a crosshair,
  *Show flow* its call arrows, and each story step the icon of the view it moves to. The diamonds `◇`, which meant
  nothing, are gone.

## [0.8.0] - 2026-10-17

### Added
- A real spec-driven example: Ark's dashboard PR #3147 (mckinsey/agents-at-scale-ark, TypeScript), which archives
  its OpenSpec change into the main spec. Its 8 requirements map to the code and the tests, and 4 of its 5
  decisions come from the change's design (`spec`).

### Changed
- Every published example and every eval run is a real pull request. The synthetic OpenSpec scenario leaves the
  gallery, where Ark #3147 takes its place; the scenarios stay as offline test fixtures. `bun run eval` explains the
  real PRs by default (no `--real`); a fixture runs only by name.
- The real examples and the eval go through `explain-change pr <url>`, as a user does: the PR's own diff (its head
  against its merge base, not the squash commit), its title and its description. 3 of the 10 PRs had another merge
  base than the squash commit's parent. The eval asks the agent "Explain <PR URL>"; the scenarios stay "explain my
  changes". `real.json` records the PR, its head and its merge base, and a build stops when GitHub gives others.
- With a PR description, 8 decisions of the examples now state `pr` as their basis: the description says their
  why. The examples' 59 decisions: 21 `code`, 9 `spec`, 8 `pr`, 21 `inferred`.
- The digest quotes the PR description's words, not its markup (template comments, code blocks, images, HTML and
  link targets go), up to 1200 characters, up from 600.
- The digest holds its budget better: the overview gets shorter (10 or 20 symbols, files by component) until the
  key hunks have 35% of the budget, and the list of hunks not shown names only hunks worth reading. On the real PRs
  it is 4–5k tokens; the docs said 2–4k.
- Key hunks: a hunk of imports only, or of a file a framework asks for (`apps.py`, `__init__.py`, assembly
  attributes), ranks last; the hunk that holds a new dependency's reference ranks above the rest of its file. In the
  OpenSpec scenario, the hunk that queues the confirmation email replaces Django's `AppConfig`.
- The outline gives a story step to a component that rewrites at least 50 lines and 30% of the change's code, even
  with no new symbol: a refactor inside existing functions (Ark's `NamespaceProvider`) is no longer left to the
  overview. The analysis is version 11.
- The report script's map, views, story and sections leave `app.ts` for their own modules (`map.ts`, `story.ts`,
  `arch.ts`, `flow.ts`, `data-view.ts`, `header.ts`, `sections.ts`); every example renders the same DOM.

### Fixed
- `explain-change pr` on a PR merged with a merge commit explained an empty diff: its head is already in the
  target, so its merge base was its own head. It now compares the head with the target before the merge commit.

## [0.7.0] - 2026-10-17

### Added
- Each design decision states its `basis`: where its why comes from (`pr`, `spec`, `code` or `inferred`). The
  validator accepts `pr` only with a PR description, `spec` only with an OpenSpec proposal or design, and `code`
  only with evidence; the draft lists only the bases the change has. The report labels each decision, so a guess
  never passes as a fact. The examples' 51 decisions are labelled from their evidence: 16 `code`, 6 `spec`, 29
  `inferred`. The contract is version 5.
- The validator refuses the passive with its agent (*is sent by the job*); *by* for a manner (*sorted by date*,
  *off by default*) passes.
- `project.names`: product names written like code (`FastAPI`) that the prose may use. Glossary terms count as known
  names too.
- `bun run eval -- --runs N` repeats each example and reports mean ± standard deviation; `--judge <model>` asks a
  second agent whether each decision's source states its why (`grounded`) and reports the share labelled
  `inferred`.

### Changed
- Fidelity in the eval is an F1 (precision and recall), not a recall: an explanation that names everything no
  longer scores high.
- ARCHITECTURE.md describes the hosts in their own section.

### Fixed
- Code names are exempt from the refused words, as `prose/en.json` says: `ensure_admin`, `EnsureTenant` or
  `robust_retry` no longer count as *ensure* or *robust*.
- An abbreviation (*e.g.*, *i.e.*, *etc.*, *vs.*) no longer ends a sentence for the 25-word rule.
- Code names are read at the head of the change, not in the checkout: explaining a PR from another branch no
  longer accepts a name that exists only in that branch, or refuses one that exists only in the PR.

## [0.6.0] - 2026-10-17

### Changed
- The examples show what this version produces: their explanations are rewritten for the 0.5 outline, in 4-5
  steps that each say something new, and each story ends with its overview (3 had none). They are also the
  eval's references.
- `bun run eval -- --real` also explains the 10 real PRs; an example can be named (`bun run eval -- maybe-data-exports`).
- `scripts/example-work.ts` rewrites an example's explanation with the current tool: `open` builds its repository
  with a fresh draft and the committed explanation as reference, `save` validates it with `render` and writes it
  back.
- The digest's task is about 10% shorter: the naming rule is 1 line, and flow titles are stated once.
- Key dependency candidates rank the change's own path first (a link between 2 components it touches), then a
  link into a neighbor; a new link into the bottom lane comes last. The draft pre-fills the first one: in the
  examples it is the one the explanation names in 7 of 11, up from 5. The analysis is version 10.
- The map's camera (`camera.ts`), inspector (`inspector.ts`) and code excerpts (`code.ts`) leave `app.ts`; the
  pages render the same.

## [0.5.0] - 2026-10-16

### Changed
- Reports are written in English only: 1 list of refused words to keep, not 1 per language. `project.lang`
  accepts only `en`; the Spanish words, page labels and PR comment are gone.
- The refused words are 1 list, `src/explanation/prose/en.json`, and a trailing `*` refuses every form of a word.
  The validator now refuses what the digest already announced (`leveraged`, `utilizing`, `enhanced`,
  `streamlined`, `delves`), plus `ensure` in every form, the negative modals (`won't`, `wouldn't`…), `obviously`,
  `simpler`, `eleven` and `twelve`. The digest prints the list exactly as the validator reads it.
- Prose guidance: a single thing takes `a` (`a ZIP file`, not `1 ZIP file`); counts stay digits. The examples
  follow it.
- The draft names components as the team does: its headings start from the component's name (`Orders changed`),
  not its id (`models changed`).
- The story outline gives a step only to components with weight (a public symbol, a dependency gained or lost, a
  migration, or being new); the others are in their summary and the overview. The task asks to drop a step that
  says nothing new: a small change reads best in 3-4. The analysis is version 9.
- `SKILL.md` is the only copy of the workflow: `PROMPT.md` points agents without skill support to it, and the
  skill's rules no longer repeat the digest's task.
- `bun run eval` gives the agent `SKILL.md` (the skill Claude Code runs) and scores its fidelity to each scenario's
  reference explanation: key dependencies, flow edges, the components the story lights and the files the decisions
  cite.
- The report script is split into modules: `app.ts` (header, map, sections), `sdd.ts` (the OpenSpec section),
  `model.ts` (the data and its lookups), `ui.ts`, `dom.ts` and `words.ts`. The page renders the same.
- The prose checks live in `prose.ts` (`ProseChecker`); `validate.ts` checks the structure.
- Example scenario 01 names its components by domain (`orders-api`, `orders`, `payment-gateway`,
  `email-delivery`), as the configure skill asks.
- Docs: the digest is 2–4k tokens, not ~3k; the budget is passed when the overview and the task need the room.

## [0.4.1] - 2026-10-16

### Added
- `check` shows how many commits change each component, lists the components that rarely change (1% of the history
  or less) and the ones that list single files. The configure skill turns them into 1 set of rules: a context or a
  team the code names keeps its box however quiet, a quiet part of a context merges into it, framework
  configuration belongs to Platform, and paths are folders and name globs (`app/models/conversation**`), so a new
  file finds its owner instead of falling to the shared kernel.

### Changed
- The draft's story opens where the behavior is decided, the same way for every change: components rank by lane
  first (the inner lanes, then the entry lane, then the bottom one), then by weight. A migration is weight: a new
  model field is no public symbol. In 5 of 40 real PRs the story opened on a GraphQL mutation or a UI component
  while the model changed; now it opens on the model. The analysis is version 8.
- Examples: the real projects' configs follow their code more closely. Chatwoot's enterprise edition, 1 box in
  the web lane, is now Captain, its API, the Voice channel and the overlays, each in its lane; Bitwarden's licensed
  PAM service had no owner (155 files) and Dapper's calls to the stored procedures broke no agreed rule; Saleor's
  account API has its box, and its development seed data is ignored, as Chatwoot's and Bitwarden's already were.
- Examples follow the configure skill's rules: Chatwoot goes from 26 boxes to 22 (campaigns into Inboxes, agent
  notifications into Accounts, event listeners with the jobs, initializers into Platform) and Immich from 23 to 21
  (access control into Identity, the job queues into Platform). Chatwoot, Immich and Maybe list folders and name
  globs instead of single files; 9 files that had fallen to the shared kernel or the enterprise overlay found
  their owner.

### Fixed
- `check` no longer warns that `[ignore]` hides migrations when they are generated files (Entity Framework's
  `.Designer.cs`, marked `<auto-generated />`): they are no evidence of the data model. In Bitwarden it warned
  about 480.

## [0.4.0] - 2026-10-16

### Changed
- A flow step is verified through a port when 1 side implements an interface the other declares (C# `class X :
  IFoo`, TypeScript `implements`), named after the interface its call uses ("Through the port IFolderRepository"),
  else by a dependency in either direction. A third component both use is no evidence any more: in the examples,
  3 of its 4 "linked through" reasons were wrong. `facts.json` lists `ports`; the contract is version 4.
- A flow step's `call` takes up to 80 characters, up from 50: real names such as
  `product_variant_channel_listing_qs_select_for_update` did not fit. The flow view fits the label between its 2
  lifelines and shows the full call as its tooltip.

### Added
- SQL Server: a stored procedure a C# string names (`[dbo].[Folder_DeleteByIds]`, `$"[{Schema}].[…]"`) links to the
  .sql file that creates it, and `DbScripts/` folders are migrations, the data model's evidence. In Bitwarden,
  Dapper now depends on the SQL Server schema (309 references); before, the 2 were not linked.
- Vue and Svelte components are analyzed from their `<script>` blocks, so a Vue or Svelte UI gets its dependencies.
  Imports resolve through bundler aliases (`vite.config`, `vite.shared`, `svelte.config`, SvelteKit's implicit
  `$lib`) and through the repository's own packages by their package.json name (`@immich/sdk` → `packages/sdk`). In
  Immich, the web app now depends on its SDK (322 references); before, it depended on nothing.
- A `configure` next action: when the team's config maps none of the changed code, `local`, `pr` and `render` ask
  to update the config instead of an explanation of an empty map. The skills say what to do with it.

### Fixed
- `check`: components change together only from 5 shared commits up, and never with the bottom lane of 3 or more
  (the shared kernel or the platform); 3 commits gave a coupling of 1.0 by chance. It warns when `[ignore]` hides
  migrations or architecture decision records, and the configure skill says not to ignore them. With 2 lanes the
  bottom one is the domain, so key dependency candidates keep grown links into it.
- The map draws a neighbor only when the change adds or removes its link, breaks a rule with it, or makes it the
  key dependency. A link that only gained references drew 12 of 13 neighbors in the examples. A rule the code broke
  before the change is no longer red, and no longer pulls in neighbors: it shows with the context.
- The draft's story starts at what the change is about: components rank by the public symbols they change and the
  dependencies they gain or lose, then by lines of code, with no config or generated lines. Before, the biggest
  component led, often a client, a schema or an OpenAPI spec. Key dependency candidates put new dependencies first
  and leave out grown links into the bottom lane, which every change touches.
- "References not resolved" counts the changed files only, and says so. It counted the whole repository, so every
  pull request of Immich showed the same 70.
- Generated files are recognized by the first lines of the file, not of the first hunk, so a change in the middle
  of a generated file counts too; "DO NOT MODIFY" and "this file has been generated" are markers now. Immich's
  generated SDK no longer opened the story. `ANALYSIS_VERSION` is 7.
- The draft pre-fills a reference flow from the config only when the change reaches its calls: every name of 1 of
  its steps is on a changed line or names the function a hunk is in. Before, sharing 1 component was enough, and 36
  of 40 surveyed pull requests got an unrelated flow.

## [0.3.1] - 2026-10-16

### Changed
- The gallery shows 10 real pull requests, 2 from each of 5 open-source products: Immich (TypeScript), Saleor
  (Django), Bitwarden (.NET), Chatwoot (Rails) and Maybe (Rails). Each product has a config written with the
  configure skill from its own docs and rules (ADRs, CODEOWNERS, agent guides), and each story is checked against
  the code. Maybe's config is redone the same way, and Healthchecks leaves the gallery: it does not use pull
  requests. The README screenshot shows the new Maybe map.
- The spec-driven example is now a realistic Django shop: catalog, customers, orders, payments with signed
  webhooks, and a new notifications app behind an `EmailGateway` port. Its OpenSpec change modifies 2 requirements,
  adds 2 and leaves 1 task open. The other 2 synthetic scenarios are test fixtures now, not gallery examples; the
  tests still build and click through every scenario page.

### Fixed
- C#: a `using` resolves only to the projects its `.csproj` sees (its own and its `ProjectReference`s, transitively),
  as the compiler does. A namespace that 2 projects declare no longer draws false dependencies: in Bitwarden, an Api
  file in `Bit.Core.Enums` drew 126 Core → API references. `ANALYSIS_VERSION` is 6.

## [0.3.0] - 2026-10-16

### Added
- GitHub PRs: `explain-change pr <id|url>` reads github.com PRs through `gh`, without a checkout. PRs from forks
  work through `refs/pull/<id>/head`; file links open the file in the PR's diff. The host comes from the PR URL,
  `--host`, `project.host`, the remotes (Azure DevOps first), else Azure DevOps.
- `facts.json` names the PR host in `source.host`: where the PR lives, or would for a branch.
- C# / .NET again: `using`, namespaces (and the `namespaces` config key), `.csproj` project references, public
  types and methods, ASP.NET endpoints, EF Core migrations, .NET test and generated files. `ANALYSIS_VERSION` is 5,
  so explanations written against 4 turn stale.

### Changed
- The contract is version 3 (`source.host` in `facts.json`): run `local` or `pr` again on a change collected with
  0.2. The host code moves to `src/hosts`, a port with one adapter per host (see `docs/ARCHITECTURE.md`).
- `share` uses the GA 7.1 attachments API of Azure DevOps instead of 7.1-preview.1.
- `share` on a GitHub PR stops with a clear message: GitHub's API and `gh` attach only images and videos. It
  checks the host before the explanation, so nobody finishes an explanation that cannot be shared.

### Security
- Each release carries a `SHA256SUMS` of its binaries. `install.sh`, `install.ps1` and `explain-change update` refuse
  a binary whose hash does not match it, before they run the binary. Releases before this one have no
  `SHA256SUMS`, so these installers do not install them.

## [0.2.1] - 2026-10-16

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

### Changed
- A logo: a lit bulb. Generated pages (reports and the examples gallery) show it bare, in the accent color, as their
  mark and favicon (`report/bulb.svg`); the README shows it on its square (`report/logo.svg`).
- Docs and skills no longer point to npm, which is not published yet: an agent that does not find the CLI asks the
  user to install it with `install.sh`. The README says how to release; the architecture doc describes `check`.
- The README reads like a product page: a screenshot linking to the live examples, a 3-step quick start, the
  pipeline as a diagram, and reference material folded.

### Removed
- C# support: `using`, namespaces, project references, ASP.NET endpoints and the .NET test, generated and build
  patterns. The `namespaces` component key is now an unknown key (an error). `ANALYSIS_VERSION` is 4, so explanations
  written before turn stale.

### Fixed
- Folders are created one at a time: on Windows, Bun's recursive mkdir could throw EEXIST under existing parents with
  another spelling (8.3 short names such as `RUNNER~1`), not only for existing folders. Scripts set the exit code
  instead of calling `process.exit()`, as the CLI does.

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
